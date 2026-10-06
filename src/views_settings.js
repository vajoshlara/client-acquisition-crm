/* ============================================================ settings */
const SETTINGS_TABS = [
  ['drive', 'Google Drive & recovery'], ['pipeline', 'Pipeline stages'], ['automations', 'Automations'],
  ['tags', 'Tags'], ['lists', 'Sources & services'], ['fields', 'Custom fields'], ['reasons', 'Reasons'],
  ['general', 'General'], ['data', 'Backup & sample data']
];

VIEWS.settings = function () {
  const tab = UI.settingsTab;
  const body = (SETTINGS[tab] || SETTINGS.drive)();
  return `${pageHead('Settings')}
  <div class="settings">
    <nav class="set-nav" aria-label="Settings sections">${SETTINGS_TABS.map(([k, l]) => `<button class="set-tab${tab === k ? ' on' : ''}" data-act="set-tab" data-tab="${k}">${l}</button>`).join('')}</nav>
    <div class="set-body">${body}</div>
  </div>`;
};

const SETTINGS = {};

SETTINGS.drive = function () {
  const l = Sync.label();
  if (Sync.mode === 'local') {
    return `<section class="panel"><div class="panel-head"><h2>Google Drive</h2></div>
      <div class="drive-status tone-muted">${icon('cloud')}<div><strong>${esc(l.title)}</strong><p>${esc(l.sub)}</p></div></div>
      <p class="pad">This copy is open as a plain file, so it can’t reach Google Drive. Deploy <code>Code.gs</code> and <code>Index.html</code> as a Google Apps Script web app (see the setup guide). Once deployed, your data is saved to <strong>06_ChatGPT CRM Project</strong> with 10 recoverable versions.</p></section>
      ${storageExplainer()}`;
  }
  const states = Sync.states || [];
  const newest = states.length ? states[0].seq : null;
  return `<section class="panel">
    <div class="panel-head"><h2>Google Drive</h2></div>
    <div class="drive-status tone-${l.tone}">${l.tone === 'bad' ? icon('alert') : icon('cloud')}<div><strong>${esc(l.title)}</strong>
      <p>${esc(l.sub)}</p></div>
      <div class="drive-actions">${Sync.status === 'failed' ? `<button class="btn btn-primary" data-act="sync-retry">${icon('refresh')}Retry</button>` : `<button class="btn" data-act="sync-now" ${Sync.inFlight ? 'disabled' : ''}>${icon('refresh')}Sync now</button>`}</div></div>
    <dl class="facts">
      <div><dt>Folder</dt><dd>${Sync.folder ? `<a href="${attr(Sync.folder.url)}" target="_blank" rel="noopener">${esc(Sync.folder.name)} ${icon('external')}</a>` : '06_ChatGPT CRM Project'}</dd></div>
      <div><dt>Account</dt><dd>${esc(Sync.user || '—')}</dd></div>
      <div><dt>Last synced</dt><dd>${Sync.lastSyncedAt ? esc(fmtLongStamp(Sync.lastSyncedAt)) : '—'}</dd></div>
      <div><dt>Stored states</dt><dd>${Sync.statesCount == null ? '—' : Sync.statesCount + ' of ' + Sync.maxStates}</dd></div>
      <div><dt>Current version</dt><dd>${Sync.baseSeq ? 'State #' + Sync.baseSeq : 'Not saved yet'}${Sync.dirty ? ' · unsaved changes on this device' : ''}</dd></div>
    </dl>
    ${Sync.skippedCorrupt && Sync.skippedCorrupt.length ? `<div class="banner banner-warn inline">${icon('alert')}<div>The newest stored state${Sync.skippedCorrupt.length > 1 ? 's' : ''} (#${Sync.skippedCorrupt.map(s => s.seq).join(', #')}) failed the integrity check, so the app opened the newest healthy one instead.</div></div>` : ''}
  </section>

  <section class="panel">
    <div class="panel-head"><h2>Recovery</h2><button class="btn btn-sm btn-ghost" data-act="refresh-states">${icon('refresh')}Refresh</button></div>
    <p class="pad muted">Each row is a complete copy of your CRM as it was at that moment. Restoring one makes it the newest version; the versions after it stay in the list until they roll off.</p>
    ${Sync.statesError ? `<div class="banner banner-bad inline">${icon('alert')}<div>${esc(Sync.statesError)}</div></div>` : ''}
    ${Sync.statesLoading && !states.length ? '<p class="pad muted">Loading stored states…</p>' : states.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>State</th><th>Saved</th><th class="num">Prospects</th><th class="num">Tasks</th><th class="num">Notes</th><th>Details</th><th><span class="sr">Actions</span></th></tr></thead>
      <tbody>${states.map(s => `<tr${s.seq === newest ? ' class="row-newest"' : ''}>
        <td><strong>#${s.seq}</strong>${s.seq === newest ? ' <span class="badge badge-good">Newest</span>' : ''}</td>
        <td>${esc(s.created_at ? fmtLongStamp(s.created_at) : '—')}</td>
        <td class="num">${s.record_count == null ? '—' : s.record_count}</td>
        <td class="num">${s.counts ? s.counts.tasks : '—'}</td>
        <td class="num">${s.counts ? s.counts.notes : '—'}</td>
        <td class="muted small">${s.restored_from ? 'Restored from #' + s.restored_from : ''}${s.device_id === Sync.deviceId ? (s.restored_from ? ' · ' : '') + 'this device' : ''}</td>
        <td class="td-actions">${s.seq === newest ? '<span class="muted small">Current</span>' : `<button class="btn btn-sm" data-act="restore-state" data-seq="${s.seq}">${icon('restore')}Restore</button>`}</td>
      </tr>`).join('')}</tbody></table></div>` : '<p class="pad muted">No stored states yet. The first one is created with your first change.</p>'}
  </section>
  ${storageExplainer()}`;
};

function storageExplainer() {
  return `<section class="panel explainer">
    <div class="panel-head"><h2>How your data is stored</h2></div>
    <ol class="steps">
      <li><strong>Every change is saved on this device first</strong>, so a refresh or crash can’t lose it.</li>
      <li><strong>After a few quiet seconds, the whole CRM is written to Drive</strong> as one new file, read back and checked byte for byte.</li>
      <li><strong>Only after that check passes</strong> does the oldest version move to Drive’s trash, keeping the newest ${MAX_STATES}.</li>
      <li><strong>The ${MAX_STATES}-version limit applies to copies of the database, not to leads.</strong> Each version contains every lead you have, whether that’s 10 or 1,000.</li>
    </ol></section>`;
}

SETTINGS.pipeline = function () {
  const d = Store.data;
  const usage = id => Object.values(d.prospects).filter(p => p.stageId === id).length;
  return `<section class="panel">
    <div class="panel-head"><h2>Pipeline stages</h2></div>
    <p class="pad muted">Core stages power automations and conversion metrics, so they can be renamed and reordered but not removed. Add your own stages for anything extra (for example “Trial task”).</p>
    <ul class="edit-list">${d.settings.stages.map((s, i) => `<li>
      <span class="stage-pill stage-${s.key || 'custom'}">&nbsp;</span>
      <input class="inp" value="${attr(s.name)}" data-change="stage-rename" data-id="${s.id}" aria-label="Stage name">
      <span class="muted small el-meta">${s.key ? 'Core' : 'Custom'} · ${plural(usage(s.id), 'prospect')}</span>
      <button class="icon-btn sm" data-act="stage-move" data-id="${s.id}" data-n="-1" ${i === 0 ? 'disabled' : ''} aria-label="Move up">${icon('up')}</button>
      <button class="icon-btn sm" data-act="stage-move" data-id="${s.id}" data-n="1" ${i === d.settings.stages.length - 1 ? 'disabled' : ''} aria-label="Move down">${icon('down')}</button>
      ${s.key ? '<span class="icon-btn sm ghost"></span>' : `<button class="icon-btn sm" data-act="stage-del" data-id="${s.id}" aria-label="Delete stage">${icon('trash')}</button>`}
    </li>`).join('')}</ul>
    <div class="add-row"><input class="inp" id="new-stage" placeholder="New stage name"><button class="btn" data-act="stage-add">${icon('plus')}Add stage</button></div>
  </section>`;
};

SETTINGS.automations = function () {
  const d = Store.data;
  return `<section class="panel explainer"><div class="panel-head"><h2>How automations work</h2></div>
    <p class="pad">Each automation is a <strong>trigger</strong> followed by <strong>steps</strong>. A step is either an <strong>action</strong> (create a task, close tasks) or a <strong>wait</strong>. This is the same model GoHighLevel workflows and HubSpot sequences use: <em>Trigger → Action → Wait → Action</em>. Waiting steps are stored with your data and run the next time the CRM is open after the wait ends.</p></section>
  ${Object.values(d.workflows).sort((a, b) => {
    const i = w => d.settings.stages.findIndex(s => s.key === w.trigger.stageKey || s.id === w.trigger.stageId);
    return i(a) - i(b);
  }).map(wf => {
    const st = stageByKey(d, wf.trigger.stageKey) || stageById(d, wf.trigger.stageId);
    const pendingJobs = Object.values(d.jobs).filter(j => j.workflowId === wf.id).length;
    return `<section class="panel wf${wf.enabled ? '' : ' wf-off'}">
      <div class="panel-head"><h2>${icon('zap')}${esc(wf.name)}</h2>
        <label class="switch"><input type="checkbox" ${wf.enabled ? 'checked' : ''} data-change="wf-toggle" data-id="${wf.id}"><span></span>${wf.enabled ? 'On' : 'Off'}</label></div>
      <p class="pad muted">${esc(wf.description || '')}</p>
      <ol class="wf-chain">
        <li class="wf-step wf-trigger"><span class="wf-kind">Trigger</span><span>Prospect enters <strong>${esc(st ? st.name : wf.trigger.stageKey)}</strong></span></li>
        ${wf.steps.map((s, i) => {
          const x = describeStep(d, s);
          const editor = s.type === 'wait'
            ? `<label class="mini-edit">Days <input type="number" min="0" max="60" value="${attr(s.days)}" data-change="wf-step" data-id="${wf.id}" data-i="${i}" data-field="days"></label>`
            : s.type === 'create_task' && s.due && s.due.base === 'today'
              ? `<label class="mini-edit">Due in <input type="number" min="0" max="60" value="${attr(s.due.offset)}" data-change="wf-step" data-id="${wf.id}" data-i="${i}" data-field="offset"> days</label>` : '';
          return `<li class="wf-step wf-${s.type === 'wait' ? 'wait' : 'action'}"><span class="wf-kind">${x.kind}</span><span>${esc(x.text)}</span>${editor}</li>`;
        }).join('')}
      </ol>
      ${pendingJobs ? `<p class="pad muted small">${plural(pendingJobs, 'prospect')} currently waiting in this automation.</p>` : ''}
    </section>`;
  }).join('')}
  <section class="panel"><div class="panel-head"><h2>Also automatic</h2></div>
    <ul class="plain pad">
      <li>Every stage change is written to the prospect’s activity timeline with the date and time.</li>
      <li>Entering <strong>Applied / Contacted</strong> sets the date applied (if empty) and logs “Application submitted”.</li>
      <li>Entering <strong>Proposal / Offer</strong> sets the proposal date and logs “Proposal sent”.</li>
      <li>Entering <strong>Won</strong> or <strong>Lost</strong> records the date; Lost asks for an optional reason.</li>
    </ul></section>`;
};

SETTINGS.tags = function () {
  const d = Store.data;
  const usage = id => Object.values(d.prospects).filter(p => (p.tagIds || []).indexOf(id) >= 0).length;
  return `<section class="panel"><div class="panel-head"><h2>Tags</h2></div>
    <p class="pad muted">Tags are labels for segmenting prospects, like GoHighLevel and HubSpot tags. Filter by them anywhere.</p>
    <ul class="edit-list">${d.settings.tags.map(t => `<li>
      <span class="tag tone-${t.tone}">${esc(t.name)}</span>
      <input class="inp" value="${attr(t.name)}" data-change="tag-rename" data-id="${t.id}" aria-label="Tag name">
      <select class="fsel sm" data-change="tag-tone" data-id="${t.id}" aria-label="Tag color">${selectOpts(TAG_TONES.map(x => ({ id: x, label: cap(x) })), t.tone)}</select>
      <span class="muted small el-meta">${plural(usage(t.id), 'prospect')}</span>
      <button class="icon-btn sm" data-act="tag-del" data-id="${t.id}" aria-label="Delete tag">${icon('trash')}</button></li>`).join('')}</ul>
    <div class="add-row"><input class="inp" id="new-tag" placeholder="New tag"><button class="btn" data-act="tag-add">${icon('plus')}Add tag</button></div></section>`;
};

function simpleList(kind, title, help) {
  const d = Store.data;
  const field = kind === 'sources' ? 'sourceId' : 'serviceId';
  const usage = id => Object.values(d.prospects).filter(p => p[field] === id).length;
  return `<section class="panel"><div class="panel-head"><h2>${title}</h2></div><p class="pad muted">${help}</p>
    <ul class="edit-list">${d.settings[kind].map(s => {
      const n = usage(s.id);
      return `<li><input class="inp" value="${attr(s.name)}" data-change="list-rename" data-list="${kind}" data-id="${s.id}" aria-label="Name">
      <span class="muted small el-meta">${plural(n, 'prospect')}</span>
      <button class="icon-btn sm" data-act="list-del" data-list="${kind}" data-id="${s.id}" ${n ? `disabled title="In use by ${plural(n, 'prospect')}"` : ''} aria-label="Delete">${icon('trash')}</button></li>`;
    }).join('')}</ul>
    <div class="add-row"><input class="inp" id="new-${kind}" placeholder="Add ${kind === 'sources' ? 'a lead source' : 'a service'}"><button class="btn" data-act="list-add" data-list="${kind}">${icon('plus')}Add</button></div></section>`;
}
SETTINGS.lists = function () {
  return simpleList('sources', 'Lead sources', 'Where opportunities come from. Renaming updates every prospect; sources in use can’t be deleted.') +
    simpleList('services', 'Services', 'What you offer. Used for filtering and for conversion by service.');
};

SETTINGS.fields = function () {
  const d = Store.data;
  return `<section class="panel"><div class="panel-head"><h2>Custom fields</h2></div>
    <p class="pad muted">Extra fields on every prospect, like custom fields in GoHighLevel or HubSpot properties. Examples: “Hours per week”, “Tools required”, “Interview round”.</p>
    ${d.settings.customFields.length ? `<ul class="edit-list">${d.settings.customFields.map(f => `<li class="cf-row">
      <input class="inp" value="${attr(f.label)}" data-change="cf-edit" data-id="${f.id}" data-field="label" aria-label="Field label">
      <select class="fsel sm" data-change="cf-edit" data-id="${f.id}" data-field="type" aria-label="Field type">${selectOpts(Object.keys(CUSTOM_FIELD_TYPES).map(k => ({ id: k, label: CUSTOM_FIELD_TYPES[k] })), f.type)}</select>
      ${f.type === 'select' ? `<input class="inp" value="${attr((f.options || []).join(', '))}" placeholder="Options, separated by commas" data-change="cf-edit" data-id="${f.id}" data-field="options" aria-label="Options">` : ''}
      <button class="icon-btn sm" data-act="cf-del" data-id="${f.id}" aria-label="Delete field">${icon('trash')}</button></li>`).join('')}</ul>` : '<p class="pad muted">No custom fields yet.</p>'}
    <div class="add-row"><input class="inp" id="new-cf" placeholder="Field label"><select class="fsel" id="new-cf-type">${selectOpts(Object.keys(CUSTOM_FIELD_TYPES).map(k => ({ id: k, label: CUSTOM_FIELD_TYPES[k] })), 'text')}</select><button class="btn" data-act="cf-add">${icon('plus')}Add field</button></div></section>`;
};

SETTINGS.reasons = function () {
  const d = Store.data;
  const block = (key, title, help) => `<section class="panel"><div class="panel-head"><h2>${title}</h2></div><p class="pad muted">${help}</p>
    <ul class="edit-list">${d.settings[key].map((r, i) => `<li><input class="inp" value="${attr(r)}" data-change="reason-edit" data-list="${key}" data-i="${i}" aria-label="Reason">
      <button class="icon-btn sm" data-act="reason-del" data-list="${key}" data-i="${i}" aria-label="Delete">${icon('trash')}</button></li>`).join('')}</ul>
    <div class="add-row"><input class="inp" id="new-${key}" placeholder="Add a reason"><button class="btn" data-act="reason-add" data-list="${key}">${icon('plus')}Add</button></div></section>`;
  return block('lostReasons', 'Lost reasons', 'Offered when an opportunity moves to Lost. They feed “Lost opportunities by reason”.') +
    block('archiveReasons', 'Archive reasons', 'Offered when you archive a prospect.');
};

SETTINGS.general = function () {
  const s = Store.data.settings;
  return `<section class="panel"><div class="panel-head"><h2>General</h2></div>
    <div class="form-grid pad">
      <label class="fld"><span>Your name</span><input class="inp" value="${attr(s.profile.name)}" data-change="pref" data-path="profile.name"><small>Shown as the author of notes and in “Deleted by”.</small></label>
      <label class="fld"><span>Default follow-up (days after today)</span><input class="inp" type="number" min="1" max="60" value="${attr(s.prefs.defaultFollowUpDays)}" data-change="pref" data-path="prefs.defaultFollowUpDays"></label>
      <label class="fld"><span>“Coming up” window on the dashboard (days)</span><input class="inp" type="number" min="1" max="60" value="${attr(s.prefs.upcomingDays)}" data-change="pref" data-path="prefs.upcomingDays"></label>
    </div></section>`;
};

SETTINGS.data = function () {
  const d = Store.data;
  const samples = Object.values(d.prospects).filter(p => p.sample).length;
  return `<section class="panel"><div class="panel-head"><h2>Download a backup</h2></div>
    <p class="pad">Your 10 most recent versions are already kept in Drive. This downloads the current CRM as a single JSON file for your own records.</p>
    <div class="pad"><button class="btn" data-act="export">${icon('download')}Download backup (.json)</button></div></section>
  <section class="panel"><div class="panel-head"><h2>Sample data</h2></div>
    <p class="pad">Loads a set of clearly fictional prospects (tagged <span class="tag tone-slate">Sample</span>) so you can see every screen working. Remove them in one click when you’re ready to use the CRM for real.</p>
    <div class="pad btn-row"><button class="btn" data-act="load-sample">Load sample prospects</button>
      ${samples ? `<button class="btn btn-ghost-danger" data-act="remove-sample">Remove ${plural(samples, 'sample prospect')}</button>` : ''}</div></section>`;
};
