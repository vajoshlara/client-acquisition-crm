/* ============================================================ prospect drawer (view / edit / create) */

function drawerHtml() {
  const dr = UI.drawer;
  const d = Store.data;
  if (dr.mode === 'create') return drawerShell(prospectForm(d, null), 'New prospect');
  const p = d.prospects[dr.id];
  if (!p) { UI.drawer = null; return ''; }
  if (dr.mode === 'edit') return drawerShell(prospectForm(d, p), 'Edit ' + prospectName(p));
  return drawerShell(prospectView(d, p), prospectName(p));
}

function drawerShell(inner, label) {
  return `<div class="drawer-scrim" data-act="drawer-close"></div>
  <aside class="drawer" role="dialog" aria-modal="true" aria-label="${attr(label)}">${inner}</aside>`;
}

const ACT_ICON = {
  created: 'plus', edited: 'edit', stage_changed: 'arrow', note_added: 'note', note_edited: 'note', note_deleted: 'note',
  task_created: 'tasks', task_completed: 'check', task_updated: 'tasks', application_submitted: 'followups', email_logged: 'mail',
  message_logged: 'mail', call_logged: 'phone', interview_scheduled: 'calendar', interview_completed: 'check',
  proposal_sent: 'note', follow_up_scheduled: 'clock', follow_up_completed: 'check', won: 'trophy', lost: 'x',
  reopened: 'restore', archived: 'archive', restored: 'restore', deleted: 'trash', automation: 'zap'
};

function prospectView(d, p) {
  const tab = UI.drawer.tab || 'overview';
  const tasks = tasksOf(p.id).slice().sort((a, b) => (taskOpen(b) - taskOpen(a)) || (a.dueDate || '9').localeCompare(b.dueDate || '9'));
  const openTasks = tasks.filter(taskOpen);
  const notes = notesOf(p.id);
  const acts = activitiesOf(p.id);
  const nf = nextFollowUp(p.id);
  const active = p.lifecycle === 'active';
  const tabs = [['overview', 'Overview'], ['tasks', 'Tasks', openTasks.length], ['notes', 'Notes', notes.length], ['activity', 'Activity', acts.length]];

  let lifecycleBar = '';
  if (p.lifecycle === 'archived') {
    lifecycleBar = `<div class="dr-life life-archived">${icon('archive')}<div><strong>Archived ${esc(fmtDate(p.archive && p.archive.at, true))}</strong><span>${esc(p.archive ? p.archive.reason : '')}${p.archive && p.archive.note ? ' — ' + esc(p.archive.note) : ''}</span></div>
      <button class="btn btn-sm" data-act="restore-archive" data-id="${p.id}">${icon('restore')}Restore</button>
      <button class="btn btn-sm btn-ghost-danger" data-act="trash" data-id="${p.id}">Delete</button></div>`;
  } else if (p.lifecycle === 'trashed') {
    lifecycleBar = `<div class="dr-life life-trashed">${icon('trash')}<div><strong>In Trash since ${esc(fmtDate(p.trash && p.trash.at, true))}</strong><span>Restoring returns it to ${p.trash && p.trash.from === 'archived' ? 'the Archive' : esc(stageName(d, p.stageId))}.</span></div>
      <button class="btn btn-sm" data-act="restore-trash" data-id="${p.id}">${icon('restore')}Restore</button>
      <button class="btn btn-sm btn-ghost-danger" data-act="purge" data-id="${p.id}">Delete permanently</button></div>`;
  }

  return `
  <header class="dr-head">
    <div class="dr-title">${monogram(p)}<div><h2>${esc(prospectName(p))}</h2><p>${esc([p.title, p.contactName && p.contactName !== prospectName(p) ? p.contactName : ''].filter(Boolean).join(' · ') || 'No title yet')}</p></div>
      <button class="icon-btn" data-act="drawer-close" aria-label="Close">${icon('x')}</button></div>
    ${lifecycleBar}
    <div class="dr-controls">
      <label class="dr-stage"><span class="sr">Stage</span><select class="fsel" data-change="drawer-stage" data-id="${p.id}" ${active ? '' : 'disabled'} aria-label="Stage">${selectOpts(stageOptions(d), p.stageId)}</select></label>
      <select class="fsel sm" data-change="drawer-field" data-field="priority" data-id="${p.id}" ${active ? '' : 'disabled'} aria-label="Priority">${selectOpts(PRIORITIES.map(x => ({ id: x.id, label: x.label + ' priority' })), p.priority)}</select>
      <select class="fsel sm" data-change="drawer-field" data-field="temperature" data-id="${p.id}" ${active ? '' : 'disabled'} aria-label="Temperature">${selectOpts(TEMPS, p.temperature)}</select>
      ${lifecycleBadge(p)}
      <span class="spacer"></span>
      <button class="btn btn-sm" data-act="edit-prospect" data-id="${p.id}">${icon('edit')}Edit</button>
      ${active ? `<button class="icon-btn" data-act="archive" data-id="${p.id}" aria-label="Archive" title="Archive">${icon('archive')}</button>
      <button class="icon-btn" data-act="trash" data-id="${p.id}" aria-label="Delete" title="Move to Trash">${icon('trash')}</button>` : ''}
    </div>
    ${active ? `<div class="dr-next">
      <div class="dn">${icon('followups')}<div><span>Next follow-up</span>${nf ? `<strong>${esc(fmtDate(nf.dueDate, true))}</strong> ${dueBadge(nf.dueDate)}` : '<strong class="muted">None scheduled</strong>'}</div>
        ${nf ? `<button class="btn btn-sm btn-primary" data-act="fu-done" data-id="${nf.id}">${icon('check')}Done</button><button class="btn btn-sm" data-act="fu-reschedule" data-id="${nf.id}">Change</button>` : isOpen(p) ? `<button class="btn btn-sm" data-act="schedule-fu" data-id="${p.id}">Schedule</button>` : ''}</div>
      ${p.interviewAt ? `<div class="dn">${icon('calendar')}<div><span>Interview</span><strong>${esc(fmtDateTime(p.interviewAt))}</strong></div></div>` : ''}
    </div>
    <div class="dr-quick">
      <button class="btn btn-sm" data-act="add-note" data-id="${p.id}">${icon('note')}Add note</button>
      <button class="btn btn-sm" data-act="new-task" data-pid="${p.id}">${icon('tasks')}Add task</button>
      <select class="fsel sm" data-change="log-activity" data-id="${p.id}" aria-label="Log an activity">
        <option value="">Log activity…</option>${LOGGABLE.map(k => `<option value="${k}">${ACTIVITY_LABELS[k]}</option>`).join('')}</select>
    </div>` : ''}
    <nav class="dr-tabs" role="tablist">${tabs.map(([k, l, n]) => `<button role="tab" aria-selected="${tab === k}" class="dr-tab${tab === k ? ' on' : ''}" data-act="drawer-tab" data-tab="${k}">${l}${n ? `<span>${n}</span>` : ''}</button>`).join('')}</nav>
  </header>
  <div class="dr-body" data-keep-scroll="drawer-${p.id}-${tab}">
    ${tab === 'overview' ? prospectOverview(d, p) : tab === 'tasks' ? prospectTasks(d, p, tasks) : tab === 'notes' ? prospectNotes(d, p, notes) : prospectActivity(d, acts)}
  </div>`;
}

function dlRow(label, value, raw) {
  const empty = value == null || value === '' || value === '—';
  return `<div class="dl-row"><dt>${esc(label)}</dt><dd${empty ? ' class="muted"' : ''}>${empty ? '—' : raw ? value : esc(value)}</dd></div>`;
}

function prospectOverview(d, p) {
  const link = (u, text) => u ? `<a href="${attr(u)}" target="_blank" rel="noopener" data-act="ext">${esc(text || u.replace(/^https?:\/\//, '').replace(/\/$/, ''))} ${icon('external')}</a>` : '';
  const cfs = d.settings.customFields;
  return `
  <section class="dr-sec"><h3>Opportunity</h3><dl>
    ${dlRow('Title', p.title)}
    ${dlRow('Service', serviceName(d, p.serviceId))}
    ${dlRow('Lead source', sourceName(d, p.sourceId))}
    ${dlRow('Opportunity link', link(p.url, 'Open posting'), true)}
    ${dlRow('Expected rate', p.expectedRate)}
    ${dlRow('Expected budget', p.expectedBudget)}
    ${p.outcome === 'lost' ? dlRow('Lost reason', (p.lostReason || 'Not recorded') + (p.lostNote ? ' — ' + p.lostNote : '')) : ''}
  </dl>
  ${p.description ? `<details class="jd"${p.description.length < 400 ? ' open' : ''}><summary>Job description</summary><div class="jd-text">${esc(p.description)}</div></details>` : ''}
  </section>
  <section class="dr-sec"><h3>Contact</h3><dl>
    ${dlRow('Contact person', p.contactName)}
    ${dlRow('Email', p.email ? `<a href="mailto:${attr(p.email)}" data-act="ext">${esc(p.email)}</a>` : '', true)}
    ${dlRow('Phone', p.phone)}
    ${dlRow('Website', link(p.website), true)}
    ${dlRow('Industry', p.industry)}
    ${dlRow('Location', p.location)}
    ${dlRow('Time zone', p.timeZone)}
  </dl></section>
  <section class="dr-sec"><h3>Key dates</h3><dl>
    ${dlRow('Discovered', p.discoveredDate ? fmtDate(p.discoveredDate, true) : '')}
    ${dlRow('Applied', p.appliedDate ? fmtDate(p.appliedDate, true) : '')}
    ${dlRow('Interview', p.interviewAt ? fmtDateTime(p.interviewAt) : '')}
    ${dlRow('Proposal', p.proposalDate ? fmtDate(p.proposalDate, true) : '')}
    ${p.wonDate ? dlRow('Won', fmtDate(p.wonDate, true)) : ''}
    ${p.lostDate ? dlRow('Lost', fmtDate(p.lostDate, true)) : ''}
    ${dlRow('In current stage since', p.stageEnteredAt ? fmtStamp(p.stageEnteredAt) : '')}
    ${dlRow('Added', fmtStamp(p.createdAt))}
  </dl></section>
  <section class="dr-sec"><h3>Tags</h3>${(p.tagIds || []).length ? `<div class="tagrow">${tagChips(d, p.tagIds)}</div>` : '<p class="muted">No tags.</p>'}</section>
  ${cfs.length ? `<section class="dr-sec"><h3>Custom fields</h3><dl>${cfs.map(f => {
    const v = (p.custom || {})[f.id];
    return dlRow(f.label, f.type === 'url' && v ? link(v) : f.type === 'date' && v ? fmtDate(v, true) : v, f.type === 'url');
  }).join('')}</dl></section>` : ''}`;
}

function prospectTasks(d, p, tasks) {
  const open = tasks.filter(taskOpen), rest = tasks.filter(t => !taskOpen(t));
  return `<div class="dr-sec"><div class="sec-head"><h3>Open tasks</h3>${p.lifecycle === 'active' ? `<button class="btn btn-sm" data-act="new-task" data-pid="${p.id}">${icon('plus')}Add task</button>` : ''}</div>
    ${open.length ? taskList(open) : '<p class="muted">No open tasks.</p>'}</div>
    ${rest.length ? `<div class="dr-sec"><h3>Completed and closed</h3><ul class="tasklist">${rest.map(t => `<li class="task-item is-done">
      <span class="task-main" data-act="edit-task" data-id="${t.id}"><span class="task-title">${esc(t.title)}</span>
      <span class="task-meta">${t.status === 'cancelled' ? '<span class="badge badge-muted">Closed automatically</span>' : `Done ${esc(timeAgo(t.completedAt))}`}</span></span></li>`).join('')}</ul></div>` : ''}`;
}

function prospectNotes(d, p, notes) {
  return `<div class="dr-sec">
    ${p.lifecycle !== 'trashed' ? `<div class="note-new"><textarea id="note-new-${p.id}" class="inp" rows="3" placeholder="Write a note — what you learned, what they said, what to remember…"></textarea>
      <button class="btn btn-primary btn-sm" data-act="save-note-inline" data-id="${p.id}">Add note</button></div>` : ''}
    ${notes.length ? `<ul class="notes">${notes.map(n => `<li class="note">
      <div class="note-meta"><strong>${esc(n.author)}</strong><span>${esc(fmtStamp(n.createdAt))}${n.editedAt ? ' · edited' : ''}</span>
        <span class="spacer"></span><button class="icon-btn sm" data-act="edit-note" data-id="${n.id}" aria-label="Edit note">${icon('edit')}</button>
        <button class="icon-btn sm" data-act="delete-note" data-id="${n.id}" aria-label="Delete note">${icon('trash')}</button></div>
      <div class="note-body">${esc(n.body)}</div></li>`).join('')}</ul>` : '<p class="muted">No notes yet.</p>'}
  </div>`;
}

function prospectActivity(d, acts) {
  if (!acts.length) return '<p class="muted pad">No activity yet.</p>';
  const groups = {};
  acts.forEach(a => { const k = dateOnly(a.at); (groups[k] || (groups[k] = [])).push(a); });
  return `<ol class="timeline">${Object.keys(groups).sort().reverse().map(k => `
    <li class="tl-day"><h4>${esc(fmtDate(k, true))}</h4><ol>${groups[k].map(a => `
      <li class="tl-item tl-${a.type}"><span class="tl-ic">${icon(ACT_ICON[a.type] || 'activity')}</span>
        <div><div class="tl-sum">${activitySummary(a)}</div>
        ${a.note ? `<div class="tl-note">${esc(a.note)}</div>` : ''}
        ${a.detail ? `<details class="tl-detail"><summary>What changed</summary><pre>${esc(a.detail)}</pre></details>` : ''}
        <div class="tl-meta">${esc(fmtTime(new Date(a.at)))} · ${esc(a.by || '')}${a.via ? ' · via ' + esc(a.via) : ''}</div></div></li>`).join('')}</ol></li>`).join('')}</ol>`;
}

function activitySummary(a) {
  const label = ACTIVITY_LABELS[a.type] || a.type;
  const s = a.summary || '';
  if (!s || s === label) return `<strong>${esc(label)}</strong>`;
  if (s.toLowerCase().indexOf(label.toLowerCase()) === 0) return `<strong>${esc(s.slice(0, label.length))}</strong>${esc(s.slice(label.length))}`;
  return `<strong>${esc(label)}</strong> · ${esc(s)}`;
}

/* ------------------------------------------------------------ prospect form */
function prospectForm(d, p) {
  const isNew = !p;
  const saved = UI.form && UI.form.values;
  const errs = (UI.form && UI.form.errors) || {};
  const nf = p ? nextFollowUp(p.id) : null;
  const base = p ? Object.assign({}, p, { followUpDate: nf ? nf.dueDate : '' }) : {
    company: '', contactName: '', email: '', phone: '', website: '', title: '', description: '', url: '',
    sourceId: d.settings.sources[0].id, serviceId: d.settings.services[0].id, industry: '', location: '', timeZone: '',
    discoveredDate: todayStr(), appliedDate: '', expectedRate: '', expectedBudget: '', priority: 'medium', temperature: 'warm',
    interviewAt: '', proposalDate: '', followUpDate: '', stageId: (UI.drawer && UI.drawer.stageId) || d.settings.stages[0].id,
    tagIds: [], custom: {}, lostReason: '', lostNote: ''
  };
  const v = k => (saved && k in saved) ? saved[k] : base[k];
  const tagsSel = saved && saved.tagIds ? saved.tagIds : (base.tagIds || []);
  const err = k => errs[k] ? `<div class="field-error">${esc(errs[k])}</div>` : '';
  const txt = (k, label, opts) => {
    opts = opts || {};
    return `<label class="fld${opts.wide ? ' wide' : ''}"><span>${esc(label)}${opts.req ? ' <em>*</em>' : ''}</span>
      <input class="inp" name="${k}" type="${opts.type || 'text'}" value="${attr(v(k) || '')}" ${opts.ph ? `placeholder="${attr(opts.ph)}"` : ''} ${opts.auto ? 'autofocus' : ''} ${opts.mode ? `inputmode="${opts.mode}"` : ''}>${err(k)}</label>`;
  };
  const sel = (k, label, list) => `<label class="fld"><span>${esc(label)}</span><select class="inp" name="${k}">${selectOpts(list, v(k))}</select></label>`;
  const radios = (k, label, list) => `<fieldset class="fld"><legend>${esc(label)}</legend><div class="radios">${list.map(o => `<label class="radio r-${k}-${o.id}"><input type="radio" name="${k}" value="${o.id}" ${v(k) === o.id ? 'checked' : ''}><span>${o.icon ? icon(o.icon) : ''}${o.label}</span></label>`).join('')}</div></fieldset>`;
  const stageKeyNow = (stageById(d, v('stageId')) || {}).key;
  const cf = d.settings.customFields;
  const cfVal = id => saved && ('cf__' + id) in saved ? saved['cf__' + id] : ((base.custom || {})[id] || '');

  return `<form id="pform" class="pform" data-pid="${p ? p.id : ''}" novalidate>
    <header class="dr-head form-head"><div class="dr-title"><div><h2>${isNew ? 'New prospect' : 'Edit prospect'}</h2>${isNew ? '<p>Only one of company, contact or title is required. Fill in the rest as you learn more.</p>' : ''}</div>
      <button type="button" class="icon-btn" data-act="form-cancel" aria-label="Close">${icon('x')}</button></div></header>
    <div class="dr-body form-body" data-keep-scroll="pform">
      ${UI.form && UI.form.dupes && UI.form.dupes.length ? `<div class="banner banner-warn inline">${icon('alert')}<div>This looks like ${UI.form.dupes.map(x => `<button type="button" class="link-btn" data-act="open-prospect" data-id="${x.id}">${esc(prospectName(x))}${x.title ? ' — ' + esc(x.title) : ''}</button>`).join(', ')}, which you already have. Save again to add it anyway.</div></div>` : ''}
      <section class="form-sec"><h3>Opportunity</h3><div class="form-grid">
        ${txt('company', 'Company / client name', { auto: isNew, ph: 'e.g. Brightside Coaching' })}
        ${txt('title', 'Job / opportunity title', { ph: 'e.g. Executive Assistant (part-time)' })}
        ${sel('serviceId', 'Service type', d.settings.services)}
        ${sel('sourceId', 'Lead source', d.settings.sources)}
        ${txt('url', 'Opportunity link', { wide: true, type: 'url', ph: 'Paste the job post or profile URL' })}
        <label class="fld wide"><span>Job description</span><textarea class="inp" name="description" rows="5" placeholder="Paste the job description or your research notes">${esc(v('description') || '')}</textarea></label>
        ${txt('expectedRate', 'Expected rate', { ph: 'e.g. $8/hr' })}
        ${txt('expectedBudget', 'Expected budget', { ph: 'e.g. $600/month' })}
      </div></section>
      <section class="form-sec"><h3>Contact</h3><div class="form-grid">
        ${txt('contactName', 'Contact person')}
        ${txt('email', 'Email', { type: 'email', mode: 'email' })}
        ${txt('phone', 'Phone', { type: 'tel', mode: 'tel' })}
        ${txt('website', 'Website', { ph: 'example.com' })}
        ${txt('industry', 'Industry', { ph: 'e.g. Coaching, E-commerce' })}
        ${txt('location', 'Location', { ph: 'e.g. Austin, US' })}
        ${txt('timeZone', 'Time zone', { ph: 'e.g. US Central (UTC−6)' })}
      </div></section>
      <section class="form-sec"><h3>Pipeline</h3><div class="form-grid">
        ${sel('stageId', 'Pipeline stage', stageOptions(d))}
        ${txt('discoveredDate', 'Date discovered', { type: 'date' })}
        ${radios('priority', 'Priority', PRIORITIES)}
        ${radios('temperature', 'Lead temperature', TEMPS)}
        <label class="fld"><span>Follow-up date</span><input class="inp" type="date" name="followUpDate" value="${attr(v('followUpDate') || '')}">${dateChips('followUpDate')}</label>
        ${txt('appliedDate', 'Date applied', { type: 'date' })}
        <label class="fld"><span>Interview date & time</span><input class="inp" type="datetime-local" name="interviewAt" value="${attr(v('interviewAt') || '')}"></label>
        ${txt('proposalDate', 'Proposal date', { type: 'date' })}
        ${stageKeyNow === 'lost' || v('lostReason') ? `<label class="fld"><span>Lost reason</span><select class="inp" name="lostReason">${selectOpts(d.settings.lostReasons.map(r => ({ id: r, label: r })), v('lostReason'), 'No reason recorded')}</select></label>
          ${txt('lostNote', 'Lost note')}` : ''}
      </div></section>
      <section class="form-sec"><h3>Tags</h3>
        <div class="tag-picker">${d.settings.tags.map(t => `<label class="tag-pick tone-${t.tone}"><input type="checkbox" name="tagIds" value="${t.id}" data-multi="1" ${tagsSel.indexOf(t.id) >= 0 ? 'checked' : ''}><span>${esc(t.name)}</span></label>`).join('')}</div>
        <div class="add-row compact"><input class="inp" id="form-new-tag" placeholder="Create a new tag"><button type="button" class="btn btn-sm" data-act="form-tag-add">${icon('plus')}Add</button></div>
      </section>
      ${cf.length ? `<section class="form-sec"><h3>Custom fields</h3><div class="form-grid">${cf.map(f => {
        const val = cfVal(f.id);
        if (f.type === 'select') return `<label class="fld"><span>${esc(f.label)}</span><select class="inp" name="cf__${f.id}">${selectOpts((f.options || []).map(o => ({ id: o, label: o })), val, '—')}</select></label>`;
        const type = { number: 'number', date: 'date', url: 'url' }[f.type] || 'text';
        return `<label class="fld"><span>${esc(f.label)}</span><input class="inp" type="${type}" name="cf__${f.id}" value="${attr(val)}"></label>`;
      }).join('')}</div></section>` : ''}
      ${isNew ? `<section class="form-sec"><h3>First note</h3><textarea class="inp" name="firstNote" rows="3" placeholder="Optional: why this one looks promising, who referred you, what to mention…">${esc((saved && saved.firstNote) || '')}</textarea></section>` : ''}
    </div>
    <footer class="dr-foot"><button type="button" class="btn" data-act="form-cancel">Cancel</button>
      <button type="submit" class="btn btn-primary">${isNew ? 'Add prospect' : 'Save changes'}</button></footer>
  </form>`;
}

function readProspectForm(form, d) {
  const v = formValues(form);
  const custom = {};
  d.settings.customFields.forEach(f => { const x = v['cf__' + f.id]; if (x !== undefined && x !== '') custom[f.id] = x; });
  const out = {};
  PROSPECT_FIELDS.forEach(k => { if (k in v) out[k] = v[k]; });
  out.tagIds = v.tagIds || [];
  out.custom = custom;
  out.stageId = v.stageId;
  out.followUpDate = v.followUpDate || '';
  out.firstNote = v.firstNote || '';
  return out;
}
