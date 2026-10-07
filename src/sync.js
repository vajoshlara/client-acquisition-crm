/* ============================================================ store + Google Drive sync
 * The browser keeps a working copy (localStorage) so changes survive refreshes,
 * crashes and lost connections. Google Drive holds the durable, versioned states.
 * "Synced" is only ever shown after the server has confirmed a commit. */

const LS_KEY = 'crm_acq_buffer_v1';
const LS_DEVICE = 'crm_acq_device_v1';
const LS_TOKEN = 'crm_acq_token_v2';
const LS_TOKEN_OLD = 'crm_acq_token_v1';   // earlier versions remembered every device; dropped so each device is asked once more

/** Passcode lock: a token proves this browser entered the passcode.
 *  By default it lives in memory only, so a refresh, new tab or reopen asks again.
 *  "Keep this device unlocked" stores it in localStorage (90 days). */
const Auth = {
  token: null,
  remembered: false,
  status: null,   // from the server: { passcodeSet, canSetPasscode, unlocked, devices, sessions }
  load() {
    try {
      localStorage.removeItem(LS_TOKEN_OLD);
      this.token = localStorage.getItem(LS_TOKEN) || null;
    } catch (e) { this.token = null; }
    this.remembered = !!this.token;
  },
  save(t, remember) {
    this.token = t || null;
    this.remembered = !!(t && remember);
    try {
      if (this.remembered) localStorage.setItem(LS_TOKEN, t); else localStorage.removeItem(LS_TOKEN);
    } catch (e) { this.remembered = false; /* kept in memory */ }
  },
  label() {
    const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
    const kind = /iPhone|Android.*Mobile|Mobile Safari/.test(ua) ? 'Phone' : /iPad|Tablet|Android/.test(ua) ? 'Tablet' : 'Computer';
    const br = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
    return kind + ' · ' + br;
  }
};
function isLockedRes(r) { return r && !r.ok && (r.code === 'LOCKED' || r.code === 'SETUP'); }

const Store = {
  data: null,
  version: 0,      // bumps on every change (drives re-render + index rebuild)
  editCounter: 0,  // bumps on every user/automation change (drives "is it saved yet?")
  mutate(label, fn) {
    const result = fn(this.data);
    this.data.meta.updatedAt = nowIso();
    this.version++;
    this.editCounter++;
    Sync.onLocalChange(label);
    UI.render();
    return result;
  },
  replace(data) {
    this.data = normalizeData(data);
    this.version++;
  }
};

function hasGAS() {
  return typeof google !== 'undefined' && google && google.script && google.script.run;
}

function friendlyError(e) {
  const raw = String((e && (e.message || e.error)) || e || '');
  const code = e && e.code;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'You appear to be offline. Changes are kept on this device and will sync when you reconnect.';
  if (code === 'AUTH' || /authori[sz]|login|sign in|permission|ScriptError: .*access/i.test(raw)) return 'Your Google session may have expired. Reload this page to sign in again; your changes are kept on this device.';
  if (code === 'TIMEOUT') return 'Google Drive did not respond in time.';
  if (code === 'BUSY') return 'Another save was still running.';
  if (code === 'QUOTA') return 'Google Drive is rate-limiting requests right now.';
  if (code === 'FOLDER_NOT_FOUND' || code === 'MULTIPLE_FOLDERS') return raw.replace(/^[A-Z_]+:\s*/, '');
  if (/NetworkError|Failed to fetch|network/i.test(raw)) return 'The connection to Google dropped before the save finished.';
  return raw || 'Google Drive returned an unexpected error.';
}

function gas(fn, arg, timeoutMs) {
  return new Promise((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      reject({ code: 'TIMEOUT', message: 'Timed out', retryable: true });
    }, timeoutMs || 90000);
    google.script.run
      .withSuccessHandler(r => { if (done) return; done = true; clearTimeout(timer); resolve(r); })
      .withFailureHandler(err => { if (done) return; done = true; clearTimeout(timer); reject({ code: 'TRANSPORT', message: String(err && err.message || err), retryable: true }); })[fn](Object.assign({}, arg || {}, { token: Auth.token || '' }));
  });
}

function userTimeZone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Manila'; } catch (e) { return 'Asia/Manila'; }
}

const Sync = {
  mode: 'local',        // 'drive' inside Apps Script, 'local' when opened as a plain file
  status: 'idle',       // connecting | pending | syncing | synced | failed | local
  connected: false,
  baseSeq: 0,           // state number this copy is based on
  dirty: false,         // local changes not yet confirmed by Drive
  lastSyncedAt: null,
  lastError: null,
  failures: 0,
  nextRetryAt: null,
  statesCount: null,
  maxStates: MAX_STATES,
  states: [],
  head: null,
  folder: null,
  user: '',
  inFlight: false,
  queued: false,
  timer: null,
  retryTimer: null,
  firstDirtyAt: 0,
  pendingSaveId: null,
  pendingChecksum: null,
  restoreFrom: null,
  localOk: true,
  skippedCorrupt: [],
  deviceId: null,

  init() {
    try {
      this.deviceId = localStorage.getItem(LS_DEVICE);
      if (!this.deviceId) { this.deviceId = uid('dev'); localStorage.setItem(LS_DEVICE, this.deviceId); }
    } catch (e) { this.deviceId = uid('dev'); }
    Auth.load();
    const buf = this.readLocal();
    this.mode = hasGAS() ? 'drive' : 'local';
    if (buf && buf.data) {
      Store.replace(buf.data);
      this.baseSeq = buf.baseSeq || 0;
      this.dirty = !!buf.dirty;
      this.lastSyncedAt = buf.lastSyncedAt || null;
      this.statesCount = buf.statesCount == null ? null : buf.statesCount;
    }
    if (this.mode === 'local') {
      if (!Store.data) Store.replace(newData());
      this.status = 'local';
      this.dirty = false;
      this.persistLocal();
      return Promise.resolve();
    }
    window.addEventListener('online', () => { if (this.status === 'failed') this.retry(); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') this.checkRemote(); });
    window.addEventListener('beforeunload', e => {
      if (this.dirty) { this.persistLocal(); e.preventDefault(); e.returnValue = ''; }
    });
    setInterval(() => this.checkRemote(), 120000);
    return this.connect();
  },

  readLocal() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return null;
      const b = JSON.parse(raw);
      return b && b.v === 1 ? b : null;
    } catch (e) { return null; }
  },

  persistLocal() {
    if (!Store.data) return;
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        v: 1, data: Store.data, baseSeq: this.baseSeq, dirty: this.dirty, lastSyncedAt: this.lastSyncedAt,
        statesCount: this.statesCount, savedAt: nowIso()
      }));
      this.localOk = true;
    } catch (e) {
      this.localOk = false;
    }
  },

  onLocalChange() {
    if (this.mode === 'local') { this.persistLocal(); return; }
    if (!this.dirty) this.firstDirtyAt = nowMs();
    this.dirty = true;
    this.persistLocal();
    if (!this.connected) return;
    if (this.failures > 0) return;          // the retry timer owns the next attempt
    if (!this.inFlight) this.status = 'pending';
    this.schedule(2500);
  },

  /** Debounce: wait for a quiet moment, but never longer than 20 s after the first unsaved change. */
  schedule(delay) {
    clearTimeout(this.timer);
    const maxWait = 20000;
    const wait = Math.max(0, Math.min(delay, (this.firstDirtyAt || nowMs()) + maxWait - nowMs()));
    this.timer = setTimeout(() => this.syncNow(), wait);
  },

  async connect() {
    this.status = 'connecting';
    UI.renderSync();
    clearTimeout(this.retryTimer);
    try {
      const res = await gas('api_bootstrap', { timeZone: userTimeZone() });
      if (isLockedRes(res)) { this.enterLocked(res); return; }
      if (!res || !res.ok) throw res || { message: 'No response' };
      this.locked = null;
      Auth.status = res.auth || null;
      this.folder = res.folder;
      this.user = res.user || '';
      this.states = res.states || [];
      this.statesCount = this.states.length;
      this.maxStates = res.maxStates || MAX_STATES;
      this.skippedCorrupt = res.skippedCorrupt || [];
      let remote = null, remoteSeq = 0;
      if (res.latest) {
        if (res.latest.meta.checksum && sha256Hex(res.latest.dataJson) !== res.latest.meta.checksum) {
          throw { message: 'The data downloaded from Drive failed its integrity check.', retryable: true };
        }
        remote = JSON.parse(res.latest.dataJson);
        remoteSeq = res.latest.meta.seq;
        this.head = res.latest.meta;
      }
      if (!remote) {
        if (!Store.data) Store.replace(newData());
        this.baseSeq = 0;
        this.dirty = true;                      // first run: create state #1
        this.firstDirtyAt = nowMs();
      } else if (!Store.data || !this.dirty) {
        Store.replace(remote);
        this.baseSeq = remoteSeq;
      } else if (this.baseSeq !== remoteSeq) {
        Store.replace(mergeData(Store.data, remote));
        this.baseSeq = remoteSeq;
        UI.toast('Your unsynced changes on this device were merged with the latest version from Drive.');
      }
      this.connected = true;
      this.failures = 0;
      this.lastError = null;
      this.lastSyncedAt = res.serverTime || nowIso(); // a confirmed read from Drive
      this.status = this.dirty ? 'pending' : 'synced';
      this.persistLocal();
      UI.render();
      Engine.start();
      if (this.dirty) this.syncNow();
    } catch (e) {
      this.connected = false;
      this.failures++;
      this.status = 'failed';
      this.lastError = friendlyError(e);
      if (!(e && e.retryable === false)) this.armRetry(() => this.connect());
      UI.render();
    }
  },

  armRetry(fn) {
    const delays = [5, 15, 30, 60, 120, 300];
    const delay = delays[Math.min(this.failures - 1, delays.length - 1)] * 1000;
    clearTimeout(this.retryTimer);
    this.nextRetryAt = nowMs() + delay;
    this.retryTimer = setTimeout(fn, delay);
  },

  retry() {
    clearTimeout(this.retryTimer);
    if (!this.connected) return this.connect();
    return this.syncNow({ force: true, manual: true });
  },

  async syncNow(opts) {
    opts = opts || {};
    if (this.mode !== 'drive' || !this.connected) return;
    if (this.inFlight) { this.queued = true; return; }
    if (!this.dirty && !opts.force) return;
    clearTimeout(this.timer);
    clearTimeout(this.retryTimer);
    this.inFlight = true;
    this.status = 'syncing';
    UI.renderSync();
    let attempts = 0;
    try {
      for (;;) {
        attempts++;
        const sentAt = Store.editCounter;
        const dataJson = JSON.stringify(Store.data);
        const checksum = sha256Hex(dataJson);
        if (checksum !== this.pendingChecksum) { this.pendingChecksum = checksum; this.pendingSaveId = uid('save'); }
        const res = await gas('api_save', {
          baseSeq: this.baseSeq, saveId: this.pendingSaveId, checksum, dataJson, deviceId: this.deviceId,
          timeZone: userTimeZone(), counts: dataCounts(Store.data), appVersion: APP_VERSION, dataVersion: DATA_VERSION,
          restoredFrom: this.restoreFrom || null
        });
        if (res && res.ok) {
          this.baseSeq = res.state.seq;
          this.head = res.state;
          this.lastSyncedAt = res.state.created_at || nowIso();
          this.statesCount = res.statesCount;
          this.failures = 0;
          this.lastError = null;
          this.pendingSaveId = null;
          this.pendingChecksum = null;
          this.restoreFrom = null;
          this.dirty = Store.editCounter !== sentAt;
          if (this.dirty) this.firstDirtyAt = nowMs();
          if (UI.view === 'settings') this.refreshStates();
          break;
        }
        if (res && res.code === 'CONFLICT' && attempts < 4) {
          if (this.restoreFrom || !res.latest) {
            this.baseSeq = res.head ? res.head.seq : 0;   // restoring overwrites; an unreadable head is replaced
            continue;
          }
          if (res.latest.meta.checksum && sha256Hex(res.latest.dataJson) !== res.latest.meta.checksum) {
            throw { message: 'The newer version on Drive failed its integrity check.', retryable: true };
          }
          Store.replace(mergeData(Store.data, JSON.parse(res.latest.dataJson)));
          Store.editCounter++;
          this.baseSeq = res.latest.meta.seq;
          this.persistLocal();
          UI.render();
          UI.toast('Merged changes made in another tab or device.');
          continue;
        }
        if (isLockedRes(res)) throw { lockedRes: res };
        throw res || { message: 'No response from Google Drive.' };
      }
    } catch (e) {
      if (e && e.lockedRes) {
        this.inFlight = false;
        this.enterLocked(e.lockedRes);
      } else {
        this.failures++;
        this.status = 'failed';
        this.lastError = friendlyError(e);
        if (!(e && e.retryable === false)) this.armRetry(() => this.syncNow({ force: true }));
        if (opts.manual) UI.toast('Sync failed: ' + this.lastError, 'error');
      }
    } finally {
      this.inFlight = false;
      if (!this.failures && !this.locked) this.status = this.dirty ? 'pending' : 'synced';
      this.persistLocal();
      UI.renderSync();
      if (!this.failures && !this.locked && (this.queued || this.dirty)) { this.queued = false; this.schedule(1500); }
      this.queued = false;
    }
  },

  /** When the tab comes back into view, pick up saves made elsewhere. */
  async checkRemote() {
    if (this.mode !== 'drive' || !this.connected || this.inFlight) return;
    if (this.dirty) { if (!this.failures) this.syncNow(); return; }
    try {
      const h = await gas('api_head', null, 30000);
      if (isLockedRes(h)) { this.enterLocked(h); return; }
      if (!h || !h.ok || !h.head || h.head.seq <= this.baseSeq || this.dirty || this.inFlight) return;
      const b = await gas('api_bootstrap', { timeZone: userTimeZone() });
      if (!b || !b.ok || !b.latest || this.dirty || this.inFlight) return;
      if (b.latest.meta.checksum && sha256Hex(b.latest.dataJson) !== b.latest.meta.checksum) return;
      Store.replace(JSON.parse(b.latest.dataJson));
      this.baseSeq = b.latest.meta.seq;
      this.head = b.latest.meta;
      this.states = b.states || this.states;
      this.statesCount = this.states.length;
      this.lastSyncedAt = b.serverTime || nowIso();
      this.persistLocal();
      UI.render();
      UI.toast('Loaded newer changes saved from another tab or device.');
    } catch (e) { /* quiet: the next save will surface problems */ }
  },

  async refreshStates() {
    if (this.mode !== 'drive' || !this.connected) return;
    this.statesLoading = true;
    try {
      const r = await gas('api_listStates', null, 45000);
      if (isLockedRes(r)) { this.statesLoading = false; this.enterLocked(r); return; }
      if (r && r.ok) { this.states = r.states; this.statesCount = r.states.length; this.statesError = null; }
      else this.statesError = friendlyError(r);
    } catch (e) { this.statesError = friendlyError(e); }
    this.statesLoading = false;
    if (UI.view === 'settings') UI.render();
  },

  /** Restore an older state: it becomes the newest state; nothing in history is deleted. */
  async restoreState(meta) {
    if (this.inFlight) throw { message: 'A save is in progress. Try again in a moment.' };
    const r = await gas('api_getState', { fileId: meta.file_id });
    if (isLockedRes(r)) { this.enterLocked(r); throw { message: 'Enter your passcode, then try the restore again.' }; }
    if (!r || !r.ok) throw r || { message: 'No response' };
    if (r.meta.checksum && sha256Hex(r.dataJson) !== r.meta.checksum) throw { message: 'That state failed its integrity check, so it was not restored.' };
    Store.replace(JSON.parse(r.dataJson));
    Store.editCounter++;
    this.baseSeq = r.head ? r.head.seq : this.baseSeq;
    this.restoreFrom = meta.seq;
    this.dirty = true;
    this.persistLocal();
    UI.closeDrawer(true);
    UI.render();
    await this.syncNow({ force: true });
    if (this.failures) throw { message: this.lastError };
  },

  /** Server refused the request: show the lock screen, keep unsynced changes in the local buffer. */
  enterLocked(res) {
    clearTimeout(this.timer);
    clearTimeout(this.retryTimer);
    this.connected = false;
    this.status = 'locked';
    const passcodeSet = !!res.passcodeSet || res.code === 'SETUP';
    this.locked = { passcodeSet, mode: passcodeSet ? 'unlock' : 'setup', message: res.message || '' };
    if (res.code === 'LOCKED' && Auth.token) Auth.save(null);   // token expired or was signed out
    this.persistLocal();
    UI.render();
  },

  async unlock(passcode, remember) {
    const r = await gas('api_unlock', { passcode, remember: !!remember, label: Auth.label() }, 30000);
    if (!r || !r.ok) return r || { message: 'No response' };
    Auth.save(r.token, r.remember);
    this.locked = null;
    await this.connect();
    return { ok: true };
  },

  /** Lock screen: switch between unlocking and setting a passcode with a setup code. */
  lockMode(mode) {
    if (!this.locked) return;
    this.locked = { passcodeSet: this.locked.passcodeSet, mode, message: '' };
    UI.render();
  },

  /** Asks the server to save a one-time setup code in the Drive folder (the code itself never comes back here). */
  async requestSetupCode() {
    if (!this.locked) return null;
    this.locked = Object.assign({}, this.locked, { mode: 'setup', busy: true, error: '' });
    UI.render();
    let r;
    try { r = await gas('api_requestSetupCode', null, 30000); } catch (e) { r = { ok: false, message: friendlyError(e) }; }
    if (!this.locked) return r;
    if (r && r.ok) this.locked = Object.assign({}, this.locked, { busy: false, codeSent: true, folderName: r.folderName, minutes: r.minutes, sentAt: Date.now() });
    else this.locked = Object.assign({}, this.locked, { busy: false, error: (r && r.message) || 'Couldn’t save a setup code. Try again.' });
    UI.render();
    return r;
  },

  /** First passcode (owner signed in, or with a setup code), a reset (setup code), or a change (needs current passcode). */
  async setPasscode(newPasscode, currentPasscode, setupCode, remember) {
    const keep = remember === undefined ? Auth.remembered : !!remember;
    const r = await gas('api_setPasscode', { newPasscode, currentPasscode: currentPasscode || '', setupCode: setupCode || '', remember: keep, label: Auth.label() }, 30000);
    if (!r || !r.ok) return r || { message: 'No response' };
    Auth.save(r.token, r.remember);
    if (this.locked) { this.locked = null; await this.connect(); }
    else await this.refreshAuth();
    return { ok: true };
  },

  async refreshAuth() {
    try { const a = await gas('api_authStatus', null, 30000); if (a && a.ok) Auth.status = a; } catch (e) { /* keep last known */ }
    UI.render();
  },

  async signOutOthers() {
    const r = await gas('api_signOutOthers', null, 30000);
    if (isLockedRes(r)) { this.enterLocked(r); return r; }
    if (r && r.ok) await this.refreshAuth();
    return r;
  },

  lockThisDevice() {
    this.persistLocal();
    Auth.save(null);
    this.enterLocked({ code: 'LOCKED', passcodeSet: true, message: 'Locked on this device.' });
  },

  label() {
    switch (this.status) {
      case 'locked': return { tone: 'muted', title: 'Locked', sub: 'Enter your passcode to continue' };
      case 'local': return { tone: 'muted', title: 'Google Drive: Not connected', sub: this.localOk ? 'Saved in this browser only' : 'This browser is not keeping a copy' };
      case 'connecting': return { tone: 'muted', title: 'Connecting to Google Drive…', sub: this.dirty ? 'Unsynced changes are kept on this device' : '' };
      case 'syncing': return { tone: 'muted', title: 'Google Drive: Connected ✓', sub: 'Saving changes…' };
      case 'pending': return { tone: 'muted', title: 'Google Drive: Connected ✓', sub: 'Unsaved changes · saving shortly' };
      case 'synced': return { tone: 'ok', title: 'Google Drive: Connected ✓', sub: 'Last synced: ' + (this.lastSyncedAt ? fmtStamp(this.lastSyncedAt) : '—') };
      case 'failed': return { tone: 'bad', title: 'Google Drive: Sync Failed ⚠', sub: this.lastError || 'Not saved to Drive yet' };
      default: return { tone: 'muted', title: 'Google Drive', sub: '' };
    }
  }
};

/* ------------------------------------------------------------ automation clock */
const Engine = {
  started: false,
  start() {
    if (this.started) { this.tick(); return; }
    this.started = true;
    this.tick();
    setInterval(() => this.tick(), 60000);
  },
  tick() {
    if (!Store.data) return;
    const now = nowMs();
    const due = Object.values(Store.data.jobs).some(j => new Date(j.runAt).getTime() <= now);
    if (due) Store.mutate('automation', d => processDueJobs(d));
  }
};
