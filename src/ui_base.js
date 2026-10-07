/* ============================================================ UI shell, components, modals */
const NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
  { id: 'prospects', label: 'Prospects', icon: 'prospects' },
  { id: 'pipeline', label: 'Pipeline', icon: 'pipeline' },
  { id: 'followups', label: 'Follow-ups', icon: 'followups' },
  { id: 'tasks', label: 'Tasks', icon: 'tasks' },
  { id: 'calendar', label: 'Calendar', icon: 'calendar' },
  { id: 'analytics', label: 'Analytics', icon: 'analytics' },
  { id: 'archive', label: 'Archive', icon: 'archive', group: 'records' },
  { id: 'trash', label: 'Trash', icon: 'trash', group: 'records' },
  { id: 'settings', label: 'Settings', icon: 'settings', group: 'records' }
];

const UI = {
  view: 'dashboard',
  drawer: null,          // { mode: 'view'|'edit'|'create', id, tab }
  navOpen: false,
  globalQ: '',
  globalOpen: false,
  settingsTab: 'drive',
  calendar: { month: '', selected: '' },
  filters: {
    prospects: { seg: 'open', clientStatus: '', q: '', stage: '', source: '', service: '', priority: '', temp: '', tag: '', dateField: 'discoveredDate', from: '', to: '', sort: 'updatedAt', dir: 'desc' },
    pipeline: { layout: 'board', q: '', source: '', service: '', priority: '', temp: '', tag: '' },
    tasks: { tab: 'today', q: '', priority: '', type: '' },
    archive: { q: '', reason: '' },
    trash: { q: '' },
    analytics: { months: 6 }
  },
  form: null,            // in-progress prospect form values + errors
  showTables: {},

  init() {
    try {
      const saved = JSON.parse(localStorage.getItem('crm_acq_ui_v1') || '{}');
      if (saved.view && NAV.some(n => n.id === saved.view)) this.view = saved.view;
      if (saved.filters) Object.keys(saved.filters).forEach(k => { if (this.filters[k]) Object.assign(this.filters[k], saved.filters[k]); });
    } catch (e) { /* ignore */ }
    const t = todayStr();
    this.calendar.month = t.slice(0, 7);
    this.calendar.selected = t;
  },
  saveUiPrefs() {
    try { localStorage.setItem('crm_acq_ui_v1', JSON.stringify({ view: this.view, filters: this.filters })); } catch (e) { /* ignore */ }
  },

  go(view) {
    this.view = view;
    this.navOpen = false;
    this.saveUiPrefs();
    this.render();
    const main = document.getElementById('main-scroll');
    if (main) main.scrollTop = 0;
    if (view === 'settings' && this.settingsTab === 'drive') Sync.refreshStates();
  },

  render() {
    const root = document.getElementById('app');
    if (!root) return;
    if (!Store.data) { root.innerHTML = bootScreen(); return; }
    buildIndex(Store.data, Store.version);
    // keep focus, caret and scroll positions across re-renders
    const ae = document.activeElement;
    const focusId = ae && ae.id;
    const sel = ae && typeof ae.selectionStart === 'number' ? [ae.selectionStart, ae.selectionEnd] : null;
    const pf = document.getElementById('pform');
    if (pf && this.drawer && this.drawer.mode !== 'view') this.form = Object.assign({}, this.form, { values: formValues(pf) });
    const scrolls = {};
    document.querySelectorAll('[data-keep-scroll]').forEach(el => { scrolls[el.dataset.keepScroll] = [el.scrollLeft, el.scrollTop]; });

    if (!root.querySelector('.shell')) root.innerHTML = shellHtml();
    root.querySelector('.shell').classList.toggle('nav-open', this.navOpen);
    document.getElementById('nav').innerHTML = navHtml();
    this.renderSync();
    document.getElementById('banner').innerHTML = bannerHtml();
    const viewEl = document.getElementById('view');
    viewEl.className = 'view' + (this.view === 'pipeline' ? ' view-wide' : '');
    viewEl.innerHTML = (VIEWS[this.view] || VIEWS.dashboard)();
    document.getElementById('drawer-root').innerHTML = this.drawer ? drawerHtml() : '';
    document.body.classList.toggle('drawer-open', !!this.drawer);
    this.renderGlobalResults();

    document.querySelectorAll('[data-keep-scroll]').forEach(el => {
      const s = scrolls[el.dataset.keepScroll];
      if (s) { el.scrollLeft = s[0]; el.scrollTop = s[1]; }
    });
    if (focusId) {
      const el = document.getElementById(focusId);
      if (el && el !== document.activeElement) {
        el.focus({ preventScroll: true });
        if (sel && typeof el.setSelectionRange === 'function') { try { el.setSelectionRange(sel[0], sel[1]); } catch (e) { /* ignore */ } }
      }
    }
  },

  renderSync() {
    const el = document.getElementById('sync');
    if (el) el.innerHTML = syncHtml();
    const banner = document.getElementById('banner');
    if (banner && Store.data) banner.innerHTML = bannerHtml();
    const mini = document.getElementById('sync-mini');
    if (mini) mini.innerHTML = syncMiniHtml();
  },

  renderGlobalResults() {
    const box = document.getElementById('global-results');
    if (!box) return;
    const q = this.globalQ.trim();
    if (!this.globalOpen || !q) { box.hidden = true; box.innerHTML = ''; return; }
    const d = Store.data;
    const hits = Object.values(d.prospects).filter(p => p.lifecycle !== 'trashed' && matchesQuery(d, p, q))
      .sort((a, b) => (a.lifecycle === 'active' ? 0 : 1) - (b.lifecycle === 'active' ? 0 : 1) || b.updatedAt.localeCompare(a.updatedAt));
    box.hidden = false;
    box.innerHTML = hits.length ? hits.slice(0, 8).map(p => `
      <button class="gr-item" data-act="open-prospect" data-id="${p.id}">
        ${monogram(p)}
        <span class="gr-main"><strong>${esc(prospectName(p))}</strong><span>${esc([p.title, stageName(d, p.stageId)].filter(Boolean).join(' · '))}</span></span>
        ${p.lifecycle === 'archived' ? '<span class="badge badge-muted">Archived</span>' : ''}
      </button>`).join('') + (hits.length > 8 ? `<button class="gr-more" data-act="search-all">See all ${hits.length} matches</button>` : '')
      : `<div class="gr-empty">No prospects match “${esc(q)}”.</div>`;
  },

  openProspect(id, tab) {
    this.drawer = { mode: 'view', id, tab: tab || 'overview' };
    this.globalOpen = false;
    this.render();
  },
  closeDrawer(silent) {
    this.drawer = null;
    this.form = null;
    if (!silent) this.render();
  },

  toast(msg, kind, action) {
    const root = document.getElementById('toasts');
    if (!root) return;
    const el = document.createElement('div');
    el.className = 'toast' + (kind ? ' toast-' + kind : '');
    el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    el.innerHTML = (kind === 'error' ? icon('alert') : icon('check')) + '<span>' + esc(msg) + '</span>' +
      (action ? '<button type="button" class="toast-act">' + esc(action.label) + '</button>' : '');
    const remove = () => { el.classList.add('out'); setTimeout(() => el.remove(), 300); };
    if (action) el.querySelector('.toast-act').addEventListener('click', () => { remove(); action.fn(); });
    root.appendChild(el);
    while (root.children.length > 4) root.firstChild.remove();
    setTimeout(remove, kind === 'error' ? 7000 : action ? 6500 : 3800);
  }
};

/* ------------------------------------------------------------ shell */
function shellHtml() {
  return `
  <div class="shell">
    <aside class="sidebar" aria-label="Main navigation">
      <div class="brand">
        <div class="brand-mark" aria-hidden="true"><span></span><span></span><span></span></div>
        <div><div class="brand-name">Client Acquisition</div><div class="brand-sub">Command Center</div></div>
      </div>
      <nav id="nav"></nav>
      <div id="sync" class="sync" aria-live="polite"></div>
    </aside>
    <div class="scrim" data-act="nav-close"></div>
    <div class="main">
      <header class="topbar">
        <button class="icon-btn nav-toggle" data-act="nav-toggle" aria-label="Open menu">${icon('menu')}</button>
        <div class="gsearch">
          ${icon('search')}
          <input id="global-q" type="search" placeholder="Search prospects, companies, tags…" autocomplete="off" aria-label="Search prospects" data-input="global-q">
          <kbd>/</kbd>
          <div id="global-results" class="global-results" hidden></div>
        </div>
        <div id="sync-mini" class="sync-mini"></div>
        <button class="btn btn-primary" data-act="new-prospect">${icon('plus')}<span>Add prospect</span></button>
      </header>
      <div id="banner"></div>
      <div class="main-scroll" id="main-scroll"><main id="view" class="view"></main></div>
    </div>
  </div>`;
}

function navHtml() {
  const d = Store.data;
  const m = computeMetrics(d);
  const counts = {
    followups: m.followUpsToday + m.followUpsOverdue,
    tasks: m.overdueTasks + m.tasksToday,
    archive: m.archived, trash: m.trashed
  };
  let html = '';
  let lastGroup = null;
  NAV.forEach(n => {
    if (n.group !== lastGroup) { if (n.group) html += '<div class="nav-sep"></div>'; lastGroup = n.group; }
    const c = counts[n.id];
    const urgent = (n.id === 'followups' && m.followUpsOverdue) || (n.id === 'tasks' && m.overdueTasks);
    html += `<button class="nav-item${UI.view === n.id ? ' active' : ''}" data-act="go" data-view="${n.id}" ${UI.view === n.id ? 'aria-current="page"' : ''}>
      ${icon(n.icon)}<span>${n.label}</span>${c ? `<span class="nav-count${urgent ? ' urgent' : ''}">${c}</span>` : ''}</button>`;
  });
  return html;
}

function syncHtml() {
  const l = Sync.label();
  const canRetry = Sync.status === 'failed';
  return `<div class="sync-card tone-${l.tone}">
    <div class="sync-title">${l.tone === 'bad' ? icon('alert') : icon('cloud')}<span>${esc(l.title)}</span></div>
    ${l.sub ? `<div class="sync-sub">${esc(l.sub)}</div>` : ''}
    ${Sync.mode === 'drive' && Sync.status !== 'synced' && Sync.lastSyncedAt && Sync.status !== 'local' ? `<div class="sync-sub">Last synced: ${esc(fmtStamp(Sync.lastSyncedAt))}</div>` : ''}
    ${canRetry ? `<button class="btn btn-sm btn-light" data-act="sync-retry">${icon('refresh')}Retry now</button>` : ''}
    ${Sync.mode === 'drive' && Sync.statesCount != null && Sync.status !== 'failed' ? `<div class="sync-meta">${Sync.statesCount} of ${Sync.maxStates} stored states</div>` : ''}
  </div>`;
}
function syncMiniHtml() {
  const l = Sync.label();
  const short = { ok: 'Synced', bad: 'Sync failed', muted: Sync.status === 'syncing' ? 'Saving…' : Sync.status === 'pending' ? 'Unsaved' : Sync.status === 'local' ? 'Local only' : 'Connecting…' }[l.tone];
  return `<button class="sync-pill tone-${l.tone}" data-act="go" data-view="settings" title="${attr(l.title + ' — ' + l.sub)}">${l.tone === 'bad' ? icon('alert') : icon('cloud')}<span>${short}</span></button>`;
}

function bannerHtml() {
  if (Sync.status === 'failed' && Sync.mode === 'drive') {
    return `<div class="banner banner-bad" role="alert">${icon('alert')}<div><strong>Google Drive: Sync Failed ⚠</strong> ${esc(Sync.lastError || '')} ${Sync.dirty ? 'Your latest changes are kept on this device until the save succeeds.' : ''}</div>
      <button class="btn btn-sm" data-act="sync-retry">${icon('refresh')}Retry</button></div>`;
  }
  if (Sync.mode === 'local') {
    return `<div class="banner banner-info">${icon('cloud')}<div><strong>Not connected to Google Drive.</strong> This copy is running outside Google Apps Script, so changes are saved in this browser only. Deploy it as described in the setup guide to sync with your Drive folder.</div></div>`;
  }
  if (!Sync.localOk) {
    return `<div class="banner banner-warn">${icon('alert')}<div>This browser is not allowing a local safety copy. Changes still sync to Drive, but avoid closing the tab while “Saving…” shows.</div></div>`;
  }
  return '';
}

function bootScreen() {
  const failed = Sync.status === 'failed';
  return `<div class="boot">
    <div class="brand-mark big" aria-hidden="true"><span></span><span></span><span></span></div>
    <h1>${failed ? 'Can’t reach Google Drive' : 'Opening your CRM…'}</h1>
    <p>${failed ? esc(Sync.lastError || '') : 'Loading the newest saved version from your Drive folder.'}</p>
    ${failed ? `<div class="boot-actions"><button class="btn btn-primary" data-act="sync-retry">${icon('refresh')}Try again</button>
      <button class="btn" data-act="work-offline">Work offline for now</button></div>
      <p class="hint">Working offline keeps changes on this device and merges them into Drive once the connection is back.</p>` : '<div class="spinner" aria-hidden="true"></div>'}
  </div>`;
}

/* ------------------------------------------------------------ small components */
function monogram(p) {
  const n = prospectName(p).replace(/[^A-Za-z0-9 ]/g, '').trim();
  const parts = n.split(/\s+/).filter(Boolean);
  const init = ((parts[0] || '?')[0] + (parts[1] ? parts[1][0] : (parts[0] || '').slice(1, 2))).toUpperCase();
  const tone = TAG_TONES[Math.abs(hashStr(p.id)) % TAG_TONES.length];
  return `<span class="mono tone-${tone}" aria-hidden="true">${esc(init)}</span>`;
}
function hashStr(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }

function prioBadge(pr) {
  const n = { high: 3, medium: 2, low: 1 }[pr] || 0;
  return `<span class="prio prio-${pr}" title="${cap(pr)} priority"><span class="bars" aria-hidden="true"><i class="${n >= 1 ? 'on' : ''}"></i><i class="${n >= 2 ? 'on' : ''}"></i><i class="${n >= 3 ? 'on' : ''}"></i></span>${cap(pr)}</span>`;
}
function tempBadge(t) {
  const x = TEMPS.find(v => v.id === t);
  if (!x) return '';
  return `<span class="temp temp-${t}">${icon(x.icon)}${x.label}</span>`;
}
function stagePill(d, p) {
  const s = stageById(d, p.stageId);
  return `<span class="stage-pill stage-${s ? (s.key || 'custom') : 'custom'}">${esc(s ? s.name : 'Unknown')}</span>`;
}
function tagChips(d, ids, max) {
  ids = ids || [];
  const shown = max ? ids.slice(0, max) : ids;
  const html = shown.map(id => { const t = tagById(d, id); return t ? `<span class="tag tone-${t.tone || 'slate'}">${esc(t.name)}</span>` : ''; }).join('');
  return html + (max && ids.length > max ? `<span class="tag tone-slate">+${ids.length - max}</span>` : '');
}
function dueBadge(date, done) {
  if (!date) return '<span class="due due-none">No date</span>';
  if (done) return `<span class="due">${esc(fmtDate(date))}</span>`;
  const today = todayStr();
  if (date < today) return `<span class="due due-over">${icon('alert')}${esc(overdueLabel(date))}</span>`;
  if (date === today) return `<span class="due due-today">${icon('clock')}Today</span>`;
  return `<span class="due">${esc(relDay(date))}</span>`;
}
function lifecycleBadge(p) {
  if (p.lifecycle === 'archived') return '<span class="badge badge-muted">Archived</span>';
  if (p.lifecycle === 'trashed') return '<span class="badge badge-bad">In Trash</span>';
  if (p.outcome === 'won') return clientBadge(p);
  if (p.outcome === 'lost') return '<span class="badge badge-lost">Lost</span>';
  return '';
}
function clientBadge(p) {
  if (isPastClient(p)) return '<span class="badge badge-muted">Past client</span>';
  return `<span class="badge badge-good">${icon('trophy')}Current client</span>`;
}
function emptyState(ic, title, text, actions) {
  return `<div class="empty">${icon(ic)}<h3>${esc(title)}</h3>${text ? `<p>${text}</p>` : ''}${actions ? `<div class="empty-actions">${actions}</div>` : ''}</div>`;
}
function selectOpts(list, value, placeholder) {
  return (placeholder !== undefined ? `<option value="">${esc(placeholder)}</option>` : '') +
    list.map(o => `<option value="${attr(o.id)}"${String(o.id) === String(value) ? ' selected' : ''}>${esc(o.label || o.name)}</option>`).join('');
}
function filterSelect(scope, key, list, placeholder) {
  const v = UI.filters[scope][key];
  return `<select class="fsel${v ? ' is-set' : ''}" data-change="filter" data-scope="${scope}" data-key="${key}" aria-label="${attr(placeholder)}">${selectOpts(list, v, placeholder)}</select>`;
}
function stageOptions(d) { return d.settings.stages.map(s => ({ id: s.id, label: s.name })); }
function tagOptions(d) { return d.settings.tags.map(t => ({ id: t.id, label: t.name })); }

/* ------------------------------------------------------------ modals */
const Modal = {
  stack: [],
  open(opts) {
    return new Promise(resolve => {
      const root = document.getElementById('modal-root');
      const wrap = document.createElement('div');
      wrap.className = 'modal-wrap';
      wrap.innerHTML = `<div class="modal ${opts.size ? 'modal-' + opts.size : ''}" role="dialog" aria-modal="true" aria-labelledby="mt-${this.stack.length}">
        <form class="modal-form" novalidate>
          <div class="modal-head"><h2 id="mt-${this.stack.length}">${esc(opts.title)}</h2>
            <button type="button" class="icon-btn" data-modal-close aria-label="Close">${icon('x')}</button></div>
          <div class="modal-body">${opts.body || ''}</div>
          <div class="modal-foot">${opts.footer || ''}</div>
        </form></div>`;
      root.appendChild(wrap);
      const entry = { wrap, resolve, opts, prevFocus: document.activeElement };
      this.stack.push(entry);
      const form = wrap.querySelector('form');
      const finish = val => {
        this.stack = this.stack.filter(x => x !== entry);
        wrap.remove();
        if (entry.prevFocus && document.body.contains(entry.prevFocus)) entry.prevFocus.focus({ preventScroll: true });
        resolve(val);
      };
      entry.finish = finish;
      wrap.addEventListener('mousedown', e => { if (e.target === wrap) finish(null); });
      wrap.querySelectorAll('[data-modal-close]').forEach(b => b.addEventListener('click', () => finish(null)));
      wrap.querySelectorAll('[data-modal-value]').forEach(b => b.addEventListener('click', () => {
        if (b.type === 'submit') return;
        finish({ __value: b.dataset.modalValue, ...formValues(form) });
      }));
      wrap.querySelectorAll('[data-fill]').forEach(b => b.addEventListener('click', () => {
        const target = form.querySelector('[name="' + b.dataset.fill + '"]');
        if (target) { target.value = b.dataset.value; target.dispatchEvent(new Event('input')); }
      }));
      form.addEventListener('submit', e => {
        e.preventDefault();
        const vals = formValues(form);
        const sub = e.submitter && e.submitter.dataset.modalValue;
        if (sub) vals.__value = sub;
        if (opts.validate) {
          const errs = opts.validate(vals);
          form.querySelectorAll('.field-error').forEach(x => x.remove());
          if (errs && Object.keys(errs).length) {
            Object.keys(errs).forEach(k => {
              const f = form.querySelector('[name="' + k + '"]');
              if (f) f.insertAdjacentHTML('afterend', '<div class="field-error">' + esc(errs[k]) + '</div>');
            });
            return;
          }
        }
        finish(vals);
      });
      if (opts.onOpen) opts.onOpen(wrap);
      setTimeout(() => {
        const f = wrap.querySelector('[autofocus]') || wrap.querySelector('input:not([type=hidden]),select,textarea') || wrap.querySelector('.btn-primary, .btn-danger');
        if (f) f.focus();
      }, 20);
    });
  },
  closeTop() { const t = this.stack[this.stack.length - 1]; if (t) { t.finish(null); return true; } return false; }
};

function formValues(form) {
  const o = {};
  form.querySelectorAll('[name]').forEach(el => {
    if (el.type === 'checkbox') {
      if (el.dataset.multi) { o[el.name] = o[el.name] || []; if (el.checked) o[el.name].push(el.value); }
      else o[el.name] = el.checked;
    } else if (el.type === 'radio') { if (el.checked) o[el.name] = el.value; }
    else o[el.name] = el.value;
  });
  return o;
}

function confirmDialog(o) {
  return Modal.open({
    title: o.title,
    size: 'sm',
    body: `<p class="confirm-msg">${o.html || esc(o.message)}</p>`,
    footer: `<button type="button" class="btn" data-modal-close>${esc(o.cancelLabel || 'Cancel')}</button>
      <button type="submit" class="btn ${o.danger ? 'btn-danger' : 'btn-primary'}" data-modal-value="yes">${esc(o.confirmLabel || 'Confirm')}</button>`
  }).then(v => !!(v && v.__value === 'yes'));
}

function dateChips(name, base) {
  const t = base || todayStr();
  const opts = [['Today', 0], ['Tomorrow', 1], ['In 3 days', 3], ['In 1 week', 7], ['In 2 weeks', 14]];
  return `<div class="chips">${opts.map(([l, n]) => `<button type="button" class="chip-btn" data-fill="${name}" data-value="${addDays(t, n)}">${l}</button>`).join('')}</div>`;
}
