/**
 * Client Acquisition CRM — storage server (Google Apps Script)
 * ------------------------------------------------------------
 * Google Drive is used as a versioned, append-only FILE STORE, not a database.
 *
 * Every save writes one complete, immutable snapshot of the CRM ("state") into
 * the CRM folder. The save protocol is:
 *
 *   1. Take the script lock (only one save at a time, across tabs and devices).
 *   2. Check the client's checksum and that its base version is still the newest
 *      state (otherwise: CONFLICT, the client merges and tries again).
 *   3. Write the snapshot as  pending_crm_state_....json
 *   4. Read the file back from Drive and compare it byte-for-byte.
 *   5. Rename it to  crm_state_000123_....json   <- this rename is the commit.
 *   6. Only now, if more than MAX_STATES committed states exist, move the oldest
 *      ones to Drive trash. If anything before step 5 fails, nothing is removed.
 *
 * Removing an old state removes an old COPY of the database. It never touches
 * leads in the newest state.
 *
 * No credentials, keys or tokens live in this code: the web app runs as you,
 * and Google handles sign-in.
 */

var CRM_CONFIG = {
  // Folder ID of "08_Claude CRM Project" (not a secret; it only works for accounts with access).
  FOLDER_ID: '1bVkFPtIHF8sWQuDu6hr1_IMptwTsXfv2',
  FOLDER_NAME: '08_Claude CRM Project',
  MAX_STATES: 10,
  LOCK_WAIT_MS: 25000,
  STALE_PENDING_MS: 15 * 60 * 1000,
  APP_VERSION: '1.0.0',
  DATA_VERSION: '1.0'
};

var STATE_NAME_RE = /^crm_state_(\d{6,})_(\d{8}T\d{6})\.json$/;
var PENDING_NAME_RE = /^pending_crm_state_(\d{6,})_(\d{8}T\d{6})\.json$/;

/* ------------------------------------------------------------------ web app */

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Client Acquisition CRM')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

/* -------------------------------------------------------------- public API */

/** First call when the app opens: folder info, the newest valid state and the state list. */
function api_bootstrap(req) {
  return run_(function () {
    var tz = safeTz_(req && req.timeZone);
    var folder = crmFolder_();
    var states = listStates_(folder);
    var latest = null;
    var skipped = [];
    for (var i = 0; i < states.length; i++) {
      var loaded = readState_(states[i].file_id);
      if (loaded.ok) { latest = loaded; break; }
      skipped.push({ seq: states[i].seq, reason: loaded.message });
    }
    return {
      ok: true,
      folder: { id: folder.getId(), name: folder.getName(), url: folder.getUrl() },
      user: userEmail_(),
      serverTime: isoNow_(tz),
      latest: latest ? { meta: latest.meta, dataJson: latest.dataJson } : null,
      skippedCorrupt: skipped,
      states: states.map(publicMeta_),
      maxStates: CRM_CONFIG.MAX_STATES
    };
  });
}

/** Cheap check: newest committed state (metadata only). */
function api_head() {
  return run_(function () {
    var states = listStates_(crmFolder_());
    return { ok: true, head: states.length ? publicMeta_(states[0]) : null, statesCount: states.length };
  });
}

/** All committed states, newest first (metadata only). */
function api_listStates() {
  return run_(function () {
    var states = listStates_(crmFolder_());
    return { ok: true, states: states.map(publicMeta_), maxStates: CRM_CONFIG.MAX_STATES };
  });
}

/** Full content of one state, verified against its checksum. */
function api_getState(req) {
  return run_(function () {
    var fileId = req && req.fileId;
    if (!fileId || typeof fileId !== 'string') return fail_('BAD_REQUEST', 'Missing state file id.', false);
    var folder = crmFolder_();
    var states = listStates_(folder);
    var match = null;
    for (var i = 0; i < states.length; i++) if (states[i].file_id === fileId) match = states[i];
    if (!match) return fail_('NOT_FOUND', 'That stored state is no longer available.', false);
    var loaded = readState_(fileId);
    if (!loaded.ok) return fail_('CORRUPT_STATE', loaded.message, false);
    return { ok: true, meta: loaded.meta, dataJson: loaded.dataJson, head: publicMeta_(states[0]) };
  });
}

/**
 * Save a new state.
 * req = { baseSeq, saveId, checksum, dataJson, deviceId, timeZone, counts, restoredFrom, reason }
 */
function api_save(req) {
  return run_(function () {
    var v = validateSave_(req);
    if (v) return v;

    // Transport integrity: the server must see exactly what the client hashed.
    var serverSum = sha256Hex_(req.dataJson);
    if (serverSum !== req.checksum) {
      return fail_('CHECKSUM_MISMATCH', 'The data arrived damaged (checksum mismatch). Nothing was saved.', true);
    }
    try { JSON.parse(req.dataJson); } catch (e) {
      return fail_('INVALID_JSON', 'The data is not valid JSON. Nothing was saved.', false);
    }

    var lock = LockService.getScriptLock();
    if (!lock.tryLock(CRM_CONFIG.LOCK_WAIT_MS)) {
      return fail_('BUSY', 'Another save is still running. Trying again shortly.', true);
    }
    try {
      var tz = safeTz_(req.timeZone);
      var folder = crmFolder_();
      var states = listStates_(folder);
      var head = states.length ? states[0] : null;
      var headSeq = head ? head.seq : 0;

      // Idempotency: a retry of a save that already committed.
      if (head && head.save_id && head.save_id === req.saveId) {
        return { ok: true, duplicate: true, state: publicMeta_(head), statesCount: states.length, pruned: [] };
      }
      // Optimistic concurrency: someone saved after this client last synced.
      if (Number(req.baseSeq || 0) !== headSeq) {
        var latest = head ? readState_(head.file_id) : null;
        return {
          ok: false, code: 'CONFLICT', retryable: true,
          message: 'A newer version was saved from another tab or device.',
          head: head ? publicMeta_(head) : null,
          latest: latest && latest.ok ? { meta: latest.meta, dataJson: latest.dataJson } : null
        };
      }
      // Nothing changed since the newest state.
      if (head && head.checksum === req.checksum && !req.restoredFrom) {
        return { ok: true, unchanged: true, state: publicMeta_(head), statesCount: states.length, pruned: [] };
      }

      var seq = headSeq + 1;
      var now = new Date();
      var stamp = Utilities.formatDate(now, tz, "yyyyMMdd'T'HHmmss");
      var stateId = 'crm_state_' + pad6_(seq) + '_' + Utilities.formatDate(now, tz, 'yyyy_MM_dd_HHmmss');
      var createdAt = Utilities.formatDate(now, tz, "yyyy-MM-dd'T'HH:mm:ssXXX");
      var counts = sanitizeCounts_(req.counts);

      var header = {
        state_id: stateId,
        state_number: seq,
        parent_state_number: headSeq || null,
        created_at: createdAt,
        updated_at: createdAt,
        application_version: String(req.appVersion || CRM_CONFIG.APP_VERSION).slice(0, 20),
        data_version: String(req.dataVersion || CRM_CONFIG.DATA_VERSION).slice(0, 20),
        record_count: counts.prospects,
        counts: counts,
        checksum_sha256: req.checksum,
        save_id: String(req.saveId).slice(0, 80),
        device_id: String(req.deviceId || '').slice(0, 80),
        restored_from: req.restoredFrom ? Number(req.restoredFrom) : null,
        storage_status: 'committed'
      };
      // data goes last so its exact bytes can be sliced back out and re-hashed on read.
      var content = JSON.stringify(header).slice(0, -1) + ',"data":' + req.dataJson + '}';
      var finalName = 'crm_state_' + pad6_(seq) + '_' + stamp + '.json';
      var pendingName = 'pending_' + finalName;

      var file = null;
      try {
        file = folder.createFile(pendingName, content, 'application/json');
        var readBack = DriveApp.getFileById(file.getId()).getBlob().getDataAsString('UTF-8');
        if (readBack !== content) {
          discard_(file);
          return fail_('VERIFY_FAILED', 'Drive returned different data than was written. Nothing was replaced.', true);
        }
        var meta = metaFromHeader_(header, file.getId(), finalName, content.length);
        file.setDescription(JSON.stringify(meta));
        file.setName(finalName); // COMMIT
        if (DriveApp.getFileById(file.getId()).getName() !== finalName) {
          discard_(file);
          return fail_('COMMIT_FAILED', 'Drive did not confirm the save. Nothing was replaced.', true);
        }
      } catch (writeErr) {
        if (file) discard_(file);
        throw writeErr;
      }

      // Prune only after the commit is confirmed, and only if the new state is the newest one listed.
      var after = listStates_(folder);
      var pruned = [];
      var pruneWarning = null;
      if (after.length && after[0].seq === seq) {
        for (var i = CRM_CONFIG.MAX_STATES; i < after.length; i++) {
          try {
            DriveApp.getFileById(after[i].file_id).setTrashed(true);
            pruned.push(after[i].seq);
          } catch (pe) {
            pruneWarning = 'Saved, but an old state could not be removed yet: ' + String(pe && pe.message || pe);
          }
        }
      }
      cleanupStalePending_(folder);

      return {
        ok: true,
        state: publicMeta_(metaFromHeader_(header, file.getId(), finalName, content.length)),
        statesCount: after.length - pruned.length,
        pruned: pruned,
        pruneWarning: pruneWarning
      };
    } finally {
      lock.releaseLock();
    }
  });
}

/* ---------------------------------------------------------------- internals */

function run_(fn) {
  try {
    return fn();
  } catch (e) {
    var msg = String(e && e.message || e);
    var code = 'SERVER_ERROR';
    var retryable = true;
    if (/FOLDER_NOT_FOUND|MULTIPLE_FOLDERS/.test(msg)) { code = msg.split(':')[0]; retryable = false; }
    else if (/authori[sz]|permission|access denied|login/i.test(msg)) { code = 'AUTH'; }
    else if (/limit|quota|rate/i.test(msg)) { code = 'QUOTA'; }
    return { ok: false, code: code, retryable: retryable, message: msg };
  }
}

function fail_(code, message, retryable) {
  return { ok: false, code: code, message: message, retryable: !!retryable };
}

function validateSave_(req) {
  if (!req || typeof req !== 'object') return fail_('BAD_REQUEST', 'Empty save request.', false);
  if (typeof req.dataJson !== 'string' || !req.dataJson.length) return fail_('BAD_REQUEST', 'Missing data.', false);
  if (!/^[0-9a-f]{64}$/.test(String(req.checksum))) return fail_('BAD_REQUEST', 'Missing checksum.', false);
  if (!req.saveId) return fail_('BAD_REQUEST', 'Missing save id.', false);
  return null;
}

function crmFolder_() {
  var props = PropertiesService.getScriptProperties();
  var ids = [props.getProperty('FOLDER_ID'), CRM_CONFIG.FOLDER_ID];
  for (var i = 0; i < ids.length; i++) {
    if (!ids[i]) continue;
    try {
      var f = DriveApp.getFolderById(ids[i]);
      if (f && !f.isTrashed()) return f;
    } catch (e) { /* fall through to lookup by name */ }
  }
  var it = DriveApp.getFoldersByName(CRM_CONFIG.FOLDER_NAME);
  var found = [];
  while (it.hasNext()) { var x = it.next(); if (!x.isTrashed()) found.push(x); }
  if (found.length === 1) {
    props.setProperty('FOLDER_ID', found[0].getId());
    return found[0];
  }
  if (found.length > 1) {
    throw new Error('MULTIPLE_FOLDERS: More than one folder is named "' + CRM_CONFIG.FOLDER_NAME +
      '". Set the script property FOLDER_ID to the one you want.');
  }
  throw new Error('FOLDER_NOT_FOUND: The Drive folder "' + CRM_CONFIG.FOLDER_NAME + '" was not found.');
}

/** Committed states in the folder, newest first, built from file names + descriptions. */
function listStates_(folder) {
  var out = [];
  var it = folder.getFiles();
  while (it.hasNext()) {
    var f = it.next();
    if (f.isTrashed()) continue;
    var name = f.getName();
    var m = STATE_NAME_RE.exec(name);
    if (!m) continue;
    var meta = null;
    try { meta = JSON.parse(f.getDescription() || 'null'); } catch (e) { meta = null; }
    if (!meta || typeof meta !== 'object') meta = {};
    meta.seq = Number(m[1]);
    meta.file_id = f.getId();
    meta.file_name = name;
    if (!meta.created_at) meta.created_at = isoFromStamp_(m[2]);
    out.push(meta);
  }
  out.sort(function (a, b) { return b.seq - a.seq; });
  return out;
}

/** Read a state file and verify its data against the stored checksum. */
function readState_(fileId) {
  var content;
  try {
    content = DriveApp.getFileById(fileId).getBlob().getDataAsString('UTF-8');
  } catch (e) {
    return { ok: false, message: 'Could not read the file: ' + String(e && e.message || e) };
  }
  var parsed;
  try { parsed = JSON.parse(content); } catch (e2) {
    return { ok: false, message: 'The file is not valid JSON.' };
  }
  if (!parsed || typeof parsed !== 'object' || !('data' in parsed)) {
    return { ok: false, message: 'The file has no CRM data.' };
  }
  var header = {};
  for (var k in parsed) if (k !== 'data') header[k] = parsed[k];
  var prefix = JSON.stringify(header).slice(0, -1) + ',"data":';
  var dataJson = null;
  if (content.indexOf(prefix) === 0 && content.charAt(content.length - 1) === '}') {
    dataJson = content.substring(prefix.length, content.length - 1);
  }
  if (dataJson === null) dataJson = JSON.stringify(parsed.data); // older/hand-made file: no exact bytes
  if (header.checksum_sha256 && sha256Hex_(dataJson) !== header.checksum_sha256) {
    return { ok: false, message: 'Checksum does not match; this state is damaged.' };
  }
  var meta = metaFromHeader_(header, fileId, null, content.length);
  return { ok: true, meta: publicMeta_(meta), dataJson: dataJson };
}

function metaFromHeader_(h, fileId, fileName, bytes) {
  return {
    seq: h.state_number,
    state_id: h.state_id,
    created_at: h.created_at,
    record_count: h.record_count,
    counts: h.counts || null,
    checksum: h.checksum_sha256 || null,
    save_id: h.save_id || null,
    device_id: h.device_id || null,
    restored_from: h.restored_from || null,
    application_version: h.application_version || null,
    data_version: h.data_version || null,
    storage_status: h.storage_status || null,
    bytes: bytes || null,
    file_id: fileId,
    file_name: fileName
  };
}

function publicMeta_(m) {
  return {
    seq: m.seq, state_id: m.state_id || null, created_at: m.created_at || null,
    record_count: (m.record_count === undefined ? null : m.record_count), counts: m.counts || null,
    checksum: m.checksum || null, save_id: m.save_id || null, device_id: m.device_id || null,
    restored_from: m.restored_from || null, bytes: m.bytes || null, file_id: m.file_id,
    application_version: m.application_version || null, data_version: m.data_version || null
  };
}

function cleanupStalePending_(folder) {
  var it = folder.getFiles();
  var cutoff = new Date().getTime() - CRM_CONFIG.STALE_PENDING_MS;
  while (it.hasNext()) {
    var f = it.next();
    if (f.isTrashed() || !PENDING_NAME_RE.test(f.getName())) continue;
    try { if (f.getDateCreated().getTime() < cutoff) f.setTrashed(true); } catch (e) { /* best effort */ }
  }
}

function discard_(file) {
  try { file.setTrashed(true); } catch (e) { /* best effort */ }
}

function sanitizeCounts_(c) {
  c = c || {};
  var keys = ['prospects', 'active', 'archived', 'trashed', 'tasks', 'notes', 'activities'];
  var out = {};
  for (var i = 0; i < keys.length; i++) {
    var n = Number(c[keys[i]]);
    out[keys[i]] = isFinite(n) && n >= 0 ? Math.floor(n) : 0;
  }
  return out;
}

function sha256Hex_(s) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8);
  var hex = '';
  for (var i = 0; i < bytes.length; i++) {
    var v = bytes[i] < 0 ? bytes[i] + 256 : bytes[i];
    hex += (v < 16 ? '0' : '') + v.toString(16);
  }
  return hex;
}

function safeTz_(tz) {
  if (typeof tz === 'string' && /^[A-Za-z_]+(\/[A-Za-z0-9_+\-]+){0,2}$/.test(tz)) return tz;
  return Session.getScriptTimeZone() || 'Etc/UTC';
}

function isoNow_(tz) {
  return Utilities.formatDate(new Date(), tz, "yyyy-MM-dd'T'HH:mm:ssXXX");
}

function isoFromStamp_(s) {
  return s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8) + 'T' + s.slice(9, 11) + ':' + s.slice(11, 13) + ':' + s.slice(13, 15);
}

function pad6_(n) {
  var s = String(n);
  while (s.length < 6) s = '0' + s;
  return s;
}

function userEmail_() {
  try { return Session.getActiveUser().getEmail() || ''; } catch (e) { return ''; }
}
