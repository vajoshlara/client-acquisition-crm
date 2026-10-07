/* ============================================================ actions & events */
const ACTIONS = {};
const CHANGES = {};
const INPUTS = {};

function P(id) { return Store.data.prospects[id]; }
function pname(id) { return prospectName(P(id)); }

/* ------------------------------------------------------------ navigation */
ACTIONS.go = el => {
  if (el.dataset.view === 'tasks' && el.dataset.tab) UI.filters.tasks.tab = el.dataset.tab;
  UI.drawer = null;
  UI.go(el.dataset.view);
};
ACTIONS['go-settings'] = el => { UI.settingsTab = el.dataset.tab || 'drive'; UI.go('settings'); };
ACTIONS['nav-toggle'] = () => { UI.navOpen = !UI.navOpen; UI.render(); };
ACTIONS['nav-close'] = () => { UI.navOpen = false; UI.render(); };
ACTIONS['set-tab'] = el => { UI.settingsTab = el.dataset.tab; UI.render(); if (el.dataset.tab === 'drive') Sync.refreshStates(); };
ACTIONS.ext = () => {};
ACTIONS['search-all'] = () => {
  UI.filters.prospects.q = UI.globalQ;
  UI.filters.prospects.seg = 'all';
  UI.globalOpen = false;
  UI.go('prospects');
};

/* ------------------------------------------------------------ drawer & prospect form */
ACTIONS['new-prospect'] = el => {
  UI.form = null;
  UI.drawer = { mode: 'create', stageId: el.dataset.stage || '' };
  UI.navOpen = false;
  UI.render();
};
ACTIONS['open-prospect'] = el => UI.openProspect(el.dataset.id);
ACTIONS['new-client'] = () => {
  UI.form = null;
  UI.drawer = { mode: 'create', kind: 'client' };
  UI.navOpen = false;
  UI.render();
};
ACTIONS['client-end'] = async el => {
  const p = P(el.dataset.id);
  const date = await pickDate('Mark engagement ended', 'When did your work with <strong>' + esc(prospectName(p)) + '</strong> end? They move to your past clients, with all history kept.', todayStr());
  if (!date) return;
  Store.mutate('client-end', d => setEngagement(d, p.id, 'past', date));
  UI.toast(prospectName(p) + ' is now a past client.');
};
ACTIONS['client-resume'] = el => {
  const p = P(el.dataset.id);
  Store.mutate('client-resume', d => setEngagement(d, p.id, 'current'));
  UI.toast(prospectName(p) + ' is a current client again.');
};
ACTIONS['grid-toggle'] = el => {
  UI.gridCollapsed = UI.gridCollapsed || {};
  UI.gridCollapsed[el.dataset.stage] = !UI.gridCollapsed[el.dataset.stage];
  UI.render();
};
ACTIONS['drawer-close'] = () => UI.closeDrawer();
ACTIONS['drawer-tab'] = el => { UI.drawer.tab = el.dataset.tab; UI.render(); };
ACTIONS['edit-prospect'] = el => { UI.form = null; UI.drawer = { mode: 'edit', id: el.dataset.id, tab: UI.drawer && UI.drawer.tab }; UI.render(); };
ACTIONS['form-cancel'] = () => {
  const dr = UI.drawer;
  UI.form = null;
  if (dr && dr.mode === 'edit') UI.drawer = { mode: 'view', id: dr.id, tab: dr.tab || 'overview' };
  else UI.drawer = null;
  UI.render();
};
ACTIONS['form-tag-add'] = () => {
  const inp = document.getElementById('form-new-tag');
  const name = (inp && inp.value || '').trim();
  if (!name) return;
  const form = document.getElementById('pform');
  const vals = formValues(form);
  let tag = Store.data.settings.tags.find(t => t.name.toLowerCase() === name.toLowerCase());
  if (!tag) {
    tag = { id: uid('tag'), name, tone: TAG_TONES[Store.data.settings.tags.length % TAG_TONES.length] };
    UI.form = Object.assign({}, UI.form, { values: Object.assign(vals, { tagIds: (vals.tagIds || []).concat(tag.id) }) });
    Store.mutate('tag-add', d => { d.settings.tags.push(tag); touch(d.settings); });
  } else {
    UI.form = Object.assign({}, UI.form, { values: Object.assign(vals, { tagIds: Array.from(new Set((vals.tagIds || []).concat(tag.id))) }) });
    UI.render();
  }
};

function submitProspectForm(form) {
  const d = Store.data;
  const f = readProspectForm(form, d);
  const pid = form.dataset.pid;
  const errors = validateProspect(f);
  if (Object.keys(errors).length) {
    UI.form = { values: formValues(form), errors };
    UI.render();
    const first = document.querySelector('#pform .field-error');
    if (first) first.scrollIntoView({ block: 'center' });
    return;
  }
  const dupes = findDuplicates(d, f, pid || null);
  const ackDupes = UI.form && UI.form.dupesAck;
  if (dupes.length && !ackDupes) {
    UI.form = { values: formValues(form), errors: {}, dupes, dupesAck: true };
    UI.render();
    document.querySelector('#pform .dr-body').scrollTop = 0;
    return;
  }
  if (!pid) {
    let created;
    const asClient = UI.drawer && UI.drawer.kind === 'client';
    if (asClient && f.clientStatus === 'past' && f.clientUntil && f.clientSince && f.clientUntil < f.clientSince) {
      UI.form = { values: formValues(form), errors: { clientUntil: 'The end date is before the start date.' } };
      UI.render();
      return;
    }
    Store.mutate('create', dd => {
      created = asClient ? createClient(dd, f) : createProspect(dd, f);
      if (f.firstNote && f.firstNote.trim()) addNote(dd, created.id, f.firstNote);
    });
    UI.form = null;
    UI.drawer = { mode: 'view', id: created.id, tab: 'overview' };
    UI.render();
    UI.toast(asClient ? 'Added ' + prospectName(created) + ' as ' + (f.clientStatus === 'past' ? 'a past' : 'a current') + ' client.' : 'Added ' + prospectName(created) + '.');
  } else {
    const p = d.prospects[pid];
    const target = stageById(d, f.stageId);
    const moving = f.stageId && f.stageId !== p.stageId;
    const finish = ctx => {
      Store.mutate('edit', dd => {
        updateProspect(dd, pid, f, ctx);
        if (dd.prospects[pid].outcome === 'won' && f.clientStatus && !moving) {
          updateClientDetails(dd, pid, { status: f.clientStatus, since: f.clientSince, until: f.clientUntil });
        }
      });
      UI.form = null;
      UI.drawer = { mode: 'view', id: pid, tab: 'overview' };
      UI.render();
      UI.toast('Saved changes.');
    };
    if (moving && target.key === 'lost' && !f.lostReason) {
      askLostReason(p).then(r => { if (r) { f.lostReason = r.reason; f.lostNote = r.note; finish({ lostReason: r.reason, lostNote: r.note }); } });
    } else finish({ lostReason: f.lostReason, lostNote: f.lostNote, interviewAt: f.interviewAt, followUpDate: f.followUpDate });
  }
}

/* ------------------------------------------------------------ stage moves (drag & drop, drawer, form) */
async function requestMove(pid, stageId) {
  const d = Store.data;
  const p = d.prospects[pid];
  const st = stageById(d, stageId);
  if (!p || !st || p.stageId === stageId) return;
  const ctx = {};
  if (st.key === 'follow_up') {
    const nf = nextFollowUp(pid);
    const def = nf ? nf.dueDate : addDays(todayStr(), d.settings.prefs.defaultFollowUpDays);
    const r = await Modal.open({
      title: 'Move to ' + st.name, size: 'sm',
      body: `<p>When will you follow up with <strong>${esc(prospectName(p))}</strong>? A follow-up task is created for that day.</p>
        <label class="fld"><span>Follow-up date</span><input class="inp" type="date" name="date" value="${def}"></label>${dateChips('date')}`,
      footer: `<button type="button" class="btn" data-modal-close>Cancel</button><button type="submit" class="btn btn-primary">Move and schedule</button>`
    });
    if (!r) return;
    ctx.followUpDate = r.date || def;
  } else if (st.key === 'interview') {
    const r = await Modal.open({
      title: 'Move to ' + st.name, size: 'sm',
      body: `<p>When is the call with <strong>${esc(prospectName(p))}</strong>? It goes on your calendar with a prep task the day before.</p>
        <label class="fld"><span>Interview date & time</span><input class="inp" type="datetime-local" name="when" value="${attr(p.interviewAt || '')}"></label>`,
      footer: `<button type="button" class="btn" data-modal-close>Cancel</button><button type="button" class="btn" data-modal-value="skip">Not scheduled yet</button><button type="submit" class="btn btn-primary">Move</button>`
    });
    if (!r) return;
    if (r.__value !== 'skip' && r.when) ctx.interviewAt = r.when;
  } else if (st.key === 'lost') {
    const r = await askLostReason(p);
    if (!r) return;
    ctx.lostReason = r.reason; ctx.lostNote = r.note;
  }
  const before = Object.values(d.tasks).filter(taskOpen).length;
  Store.mutate('move', dd => moveStage(dd, pid, stageId, ctx));
  const after = Object.values(Store.data.tasks).filter(taskOpen).length;
  const auto = after - before;
  let msg = 'Moved ' + prospectName(p) + ' to ' + st.name + '.';
  if (st.key === 'won') msg = prospectName(p) + ' marked as won. Onboarding task created.';
  else if (auto > 0) msg += ' ' + plural(auto, 'task') + ' created automatically.';
  UI.toast(msg);
}

function askLostReason(p) {
  const d = Store.data;
  return Modal.open({
    title: 'Mark as lost', size: 'sm',
    body: `<p>Why did <strong>${esc(prospectName(p))}</strong> not work out? This is optional, and it builds your “lost by reason” report.</p>
      <label class="fld"><span>Reason</span><select class="inp" name="reason">${selectOpts(d.settings.lostReasons.map(r => ({ id: r, label: r })), '', 'Prefer not to say')}</select></label>
      <label class="fld"><span>Note</span><input class="inp" name="note" placeholder="Optional detail"></label>`,
    footer: `<button type="button" class="btn" data-modal-close>Cancel</button><button type="submit" class="btn btn-primary">Mark as lost</button>`
  });
}

CHANGES['drawer-stage'] = el => {
  const pid = el.dataset.id, to = el.value;
  el.value = P(pid).stageId; // revert until confirmed
  requestMove(pid, to);
};
CHANGES['drawer-field'] = el => {
  const f = {}; f[el.dataset.field] = el.value;
  Store.mutate('edit', d => updateProspect(d, el.dataset.id, f));
};

/* drag & drop on the pipeline */
let dragId = null;
document.addEventListener('dragstart', e => {
  const c = e.target.closest && e.target.closest('[data-drag]');
  if (!c) return;
  dragId = c.dataset.drag;
  e.dataTransfer.effectAllowed = 'move';
  try { e.dataTransfer.setData('text/plain', dragId); } catch (x) { /* ignore */ }
  setTimeout(() => c.classList.add('dragging'), 0);
});
document.addEventListener('dragend', () => {
  dragId = null;
  document.querySelectorAll('.dragging,.drop-over').forEach(x => x.classList.remove('dragging', 'drop-over'));
});
document.addEventListener('dragover', e => {
  const col = e.target.closest && e.target.closest('[data-stage].kcol');
  if (!col || !dragId) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  document.querySelectorAll('.drop-over').forEach(x => { if (x !== col) x.classList.remove('drop-over'); });
  col.classList.add('drop-over');
});
document.addEventListener('drop', e => {
  const col = e.target.closest && e.target.closest('[data-stage].kcol');
  if (!col || !dragId) return;
  e.preventDefault();
  const id = dragId;
  dragId = null;
  col.classList.remove('drop-over');
  requestMove(id, col.dataset.stage);
});

/* ------------------------------------------------------------ lifecycle */
ACTIONS.archive = async el => {
  const p = P(el.dataset.id);
  const d = Store.data;
  const r = await Modal.open({
    title: 'Archive ' + prospectName(p), size: 'sm',
    body: `<p>Archiving takes it out of your pipeline and active lists. Notes, tasks and history are kept, and you can restore it to <strong>${esc(stageName(d, p.stageId))}</strong> any time.</p>
      <label class="fld"><span>Reason</span><select class="inp" name="reason">${selectOpts(d.settings.archiveReasons.map(x => ({ id: x, label: x })), d.settings.archiveReasons[0])}</select></label>
      <label class="fld"><span>Note</span><input class="inp" name="note" placeholder="Optional, e.g. revisit in January"></label>`,
    footer: `<button type="button" class="btn" data-modal-close>Cancel</button><button type="submit" class="btn btn-primary">${icon('archive')}Archive</button>`
  });
  if (!r) return;
  Store.mutate('archive', dd => archiveProspect(dd, p.id, r.reason, r.note));
  UI.toast('Archived ' + prospectName(p) + '.', null, { label: 'Undo', fn: () => Store.mutate('restore', dd => restoreFromArchive(dd, p.id)) });
};
ACTIONS['restore-archive'] = el => {
  const p = P(el.dataset.id);
  Store.mutate('restore', d => restoreFromArchive(d, p.id));
  UI.toast('Restored ' + prospectName(p) + ' to ' + stageName(Store.data, p.stageId) + '.');
};
ACTIONS.trash = el => {
  const p = P(el.dataset.id);
  Store.mutate('trash', d => trashProspect(d, p.id));
  if (UI.drawer && UI.drawer.id === p.id) UI.closeDrawer();
  UI.toast('Moved ' + prospectName(p) + ' to Trash.', null, { label: 'Undo', fn: () => Store.mutate('restore', d => restoreFromTrash(d, p.id)) });
};
ACTIONS['restore-trash'] = el => {
  const p = P(el.dataset.id);
  let where;
  Store.mutate('restore', d => { where = restoreFromTrash(d, p.id); });
  UI.toast('Restored ' + prospectName(p) + (where === 'archived' ? ' to the Archive.' : ' to ' + stageName(Store.data, p.stageId) + '.'));
};
ACTIONS.purge = async el => {
  const p = P(el.dataset.id);
  const ok = await confirmDialog({
    title: 'Delete permanently?', danger: true, confirmLabel: 'Delete permanently',
    message: 'This will permanently delete this lead and its associated data. This action cannot be undone.'
  });
  if (!ok) return;
  if (UI.drawer && UI.drawer.id === p.id) UI.closeDrawer(true);
  Store.mutate('purge', d => purgeProspect(d, p.id));
  UI.toast('Permanently deleted ' + prospectName(p) + '.');
};
ACTIONS['empty-trash'] = async () => {
  const n = Object.values(Store.data.prospects).filter(p => p.lifecycle === 'trashed').length;
  const ok = await confirmDialog({
    title: 'Empty Trash?', danger: true, confirmLabel: 'Empty Trash (' + n + ')',
    message: 'This will permanently delete all leads currently in Trash. This action cannot be undone.'
  });
  if (!ok) return;
  let count = 0;
  Store.mutate('empty-trash', d => { count = emptyTrash(d); });
  UI.toast('Permanently deleted ' + plural(count, 'lead') + '.');
};

/* ------------------------------------------------------------ follow-ups */
ACTIONS['fu-done'] = async el => {
  const d = Store.data;
  const t = d.tasks[el.dataset.id];
  if (!t) return;
  const p = t.prospectId ? d.prospects[t.prospectId] : null;
  const def = addDays(todayStr(), d.settings.prefs.defaultFollowUpDays);
  const r = await Modal.open({
    title: 'Follow-up done', size: 'sm',
    body: `<p><strong>${esc(p ? prospectName(p) : t.title)}</strong></p>
      <label class="fld"><span>What happened? <small>(saved to the timeline)</small></span><textarea class="inp" name="note" rows="2" placeholder="e.g. Sent a short check-in with my portfolio link"></textarea></label>
      ${p ? `<label class="fld"><span>Next follow-up</span><input class="inp" type="date" name="next" value="${def}"></label>${dateChips('next')}
      <label class="check-inline"><input type="checkbox" name="noNext"> No further follow-up needed</label>` : ''}`,
    footer: `<button type="button" class="btn" data-modal-close>Cancel</button><button type="submit" class="btn btn-primary">${icon('check')}Mark done</button>`
  });
  if (!r) return;
  const next = p && !r.noNext ? r.next : '';
  Store.mutate('fu-done', dd => completeFollowUp(dd, t.id, r.note, next));
  UI.toast('Follow-up done.' + (next ? ' Next one: ' + fmtDate(next, true) + '.' : ''));
};
async function pickDate(title, intro, value) {
  const r = await Modal.open({
    title, size: 'sm',
    body: `${intro ? `<p>${intro}</p>` : ''}<label class="fld"><span>Date</span><input class="inp" type="date" name="date" value="${attr(value || '')}"></label>${dateChips('date')}`,
    footer: `<button type="button" class="btn" data-modal-close>Cancel</button><button type="submit" class="btn btn-primary">Save</button>`,
    validate: v => v.date ? null : { date: 'Pick a date.' }
  });
  return r && r.date;
}
ACTIONS['fu-reschedule'] = async el => {
  const t = Store.data.tasks[el.dataset.id];
  const date = await pickDate('Reschedule follow-up', esc(t.title), t.dueDate);
  if (!date) return;
  Store.mutate('fu-move', d => { if (t.prospectId) setFollowUp(d, t.prospectId, date); else updateTask(d, t.id, { dueDate: date }); });
  UI.toast('Follow-up moved to ' + fmtDate(date, true) + '.');
};
ACTIONS['schedule-fu'] = async el => {
  const pid = el.dataset.id;
  const date = await pickDate('Schedule a follow-up', 'With <strong>' + esc(pname(pid)) + '</strong>', addDays(todayStr(), Store.data.settings.prefs.defaultFollowUpDays));
  if (!date) return;
  Store.mutate('fu-set', d => setFollowUp(d, pid, date));
  UI.toast('Follow-up scheduled for ' + fmtDate(date, true) + '.');
};

/* ------------------------------------------------------------ tasks */
async function taskModal(task, defaults) {
  const d = Store.data;
  const t = task || Object.assign({ title: '', dueDate: todayStr(), priority: 'medium', status: 'todo', type: 'general', prospectId: '', notes: '' }, defaults || {});
  const ps = Object.values(d.prospects).filter(p => p.lifecycle === 'active' || p.id === t.prospectId)
    .sort((a, b) => prospectName(a).localeCompare(prospectName(b))).map(p => ({ id: p.id, label: prospectName(p) + (p.title ? ' — ' + p.title : '') }));
  const r = await Modal.open({
    title: task ? 'Edit task' : 'New task',
    body: `<div class="form-grid">
      <label class="fld wide"><span>Task <em>*</em></span><input class="inp" name="title" value="${attr(t.title)}" placeholder="e.g. Send portfolio to Brightside" autofocus></label>
      <label class="fld"><span>Due date</span><input class="inp" type="date" name="dueDate" value="${attr(t.dueDate || '')}">${dateChips('dueDate')}</label>
      <label class="fld"><span>Related prospect</span><select class="inp" name="prospectId">${selectOpts(ps, t.prospectId, 'None')}</select></label>
      <label class="fld"><span>Priority</span><select class="inp" name="priority">${selectOpts(PRIORITIES, t.priority)}</select></label>
      <label class="fld"><span>Status</span><select class="inp" name="status">${selectOpts(TASK_STATUS.concat(t.status === 'cancelled' ? [{ id: 'cancelled', label: 'Closed' }] : []), t.status)}</select></label>
      <label class="fld"><span>Type</span><select class="inp" name="type">${selectOpts(Object.keys(TASK_TYPES).map(k => ({ id: k, label: TASK_TYPES[k] })), t.type)}</select></label>
      <label class="fld wide"><span>Notes</span><textarea class="inp" name="notes" rows="3">${esc(t.notes || '')}</textarea></label>
      ${task ? `<p class="muted small wide">Created ${esc(fmtStamp(task.createdAt))}${task.completedAt ? ' · completed ' + esc(fmtStamp(task.completedAt)) : ''}${task.source && task.source.indexOf('wf:') === 0 ? ' · created by an automation' : ''}</p>` : ''}
    </div>`,
    footer: `${task ? `<button type="button" class="btn btn-ghost-danger" data-modal-value="delete">${icon('trash')}Delete</button><span class="spacer"></span>` : ''}
      <button type="button" class="btn" data-modal-close>Cancel</button><button type="submit" class="btn btn-primary">${task ? 'Save task' : 'Create task'}</button>`,
    validate: v => v.title.trim() ? null : { title: 'Give the task a name.' }
  });
  return r;
}
ACTIONS['new-task'] = async el => {
  const r = await taskModal(null, { prospectId: el.dataset.pid || '', dueDate: el.dataset.date || todayStr() });
  if (!r) return;
  Store.mutate('task-new', d => createTask(d, r));
  UI.toast('Task created.');
};
ACTIONS['edit-task'] = async el => {
  const t = Store.data.tasks[el.dataset.id];
  if (!t) return;
  const r = await taskModal(t);
  if (!r) return;
  if (r.__value === 'delete') return deleteTaskFlow(t.id);
  Store.mutate('task-edit', d => updateTask(d, t.id, r));
};
async function deleteTaskFlow(id) {
  const t = Store.data.tasks[id];
  const ok = await confirmDialog({ title: 'Delete task?', danger: true, confirmLabel: 'Delete task', message: '“' + t.title + '” will be removed. Completed tasks are usually worth keeping for your history.' });
  if (!ok) return;
  Store.mutate('task-del', d => deleteTask(d, id));
  UI.toast('Task deleted.');
}
ACTIONS['delete-task'] = el => deleteTaskFlow(el.dataset.id);
CHANGES['task-done'] = el => {
  const id = el.dataset.id;
  const t = Store.data.tasks[id];
  if (el.checked && t.type === 'follow_up' && t.prospectId) {
    el.checked = false;
    ACTIONS['fu-done']({ dataset: { id } });
    return;
  }
  Store.mutate('task-status', d => setTaskStatus(d, id, el.checked ? 'done' : 'todo'));
};
CHANGES['task-status'] = el => Store.mutate('task-status', d => setTaskStatus(d, el.dataset.id, el.value));

/* ------------------------------------------------------------ notes & activity */
async function noteModal(title, body) {
  return Modal.open({
    title,
    body: `<label class="fld"><span class="sr">Note</span><textarea class="inp" name="body" rows="6" autofocus placeholder="What you learned, what they said, what to remember…">${esc(body || '')}</textarea></label>`,
    footer: `<button type="button" class="btn" data-modal-close>Cancel</button><button type="submit" class="btn btn-primary">Save note</button>`,
    validate: v => v.body.trim() ? null : { body: 'Write something first.' }
  });
}
ACTIONS['add-note'] = async el => {
  const r = await noteModal('Add note — ' + pname(el.dataset.id));
  if (!r) return;
  Store.mutate('note', d => addNote(d, el.dataset.id, r.body));
  UI.drawer.tab = 'notes';
  UI.render();
};
ACTIONS['save-note-inline'] = el => {
  const ta = document.getElementById('note-new-' + el.dataset.id);
  const body = ta && ta.value.trim();
  if (!body) { if (ta) ta.focus(); return; }
  ta.value = '';
  Store.mutate('note', d => addNote(d, el.dataset.id, body));
};
ACTIONS['edit-note'] = async el => {
  const n = Store.data.notes[el.dataset.id];
  const r = await noteModal('Edit note', n.body);
  if (!r) return;
  Store.mutate('note-edit', d => editNote(d, n.id, r.body));
};
ACTIONS['delete-note'] = async el => {
  const ok = await confirmDialog({ title: 'Delete note?', danger: true, confirmLabel: 'Delete note', message: 'The note will be removed. The timeline keeps a record that a note was deleted.' });
  if (!ok) return;
  Store.mutate('note-del', d => deleteNote(d, el.dataset.id));
};
CHANGES['log-activity'] = async el => {
  const type = el.value;
  const pid = el.dataset.id;
  el.value = '';
  if (!type) return;
  const r = await Modal.open({
    title: 'Log: ' + ACTIVITY_LABELS[type], size: 'sm',
    body: `<p>${esc(pname(pid))}</p><label class="fld"><span>Details <small>(optional)</small></span><textarea class="inp" name="note" rows="3" autofocus></textarea></label>`,
    footer: `<button type="button" class="btn" data-modal-close>Cancel</button><button type="submit" class="btn btn-primary">Log it</button>`
  });
  if (!r) return;
  Store.mutate('log', d => {
    const p = d.prospects[pid];
    const t = nowIso();
    if (type === 'application_submitted' && !p.appliedDate) { p.appliedDate = todayStr(); p.milestones.applied = p.milestones.applied || t; }
    if (type === 'proposal_sent') { p.proposalDate = p.proposalDate || todayStr(); p.milestones.proposal = p.milestones.proposal || t; }
    if (type === 'interview_completed') { p.milestones.interview = p.milestones.interview || t; }
    touch(p);
    logAct(d, pid, type, ACTIVITY_LABELS[type], r.note ? { note: r.note } : null);
  });
  UI.toast(ACTIVITY_LABELS[type] + ' logged.');
};

/* ------------------------------------------------------------ filters, sorting */
ACTIONS['filter-set'] = el => { UI.filters[el.dataset.scope][el.dataset.key] = el.dataset.value; UI.saveUiPrefs(); UI.render(); };
CHANGES.filter = el => {
  const v = el.dataset.key === 'months' ? Number(el.value) : el.value;
  UI.filters[el.dataset.scope][el.dataset.key] = v;
  UI.saveUiPrefs();
  UI.render();
};
const renderSoon = debounce(() => { UI.saveUiPrefs(); UI.render(); }, 160);
INPUTS.filter = el => { UI.filters[el.dataset.scope][el.dataset.key] = el.value; renderSoon(); };
ACTIONS['clear-filters'] = el => {
  const f = UI.filters[el.dataset.scope];
  ['q', 'stage', 'source', 'service', 'priority', 'temp', 'tag', 'from', 'to'].forEach(k => { if (k in f) f[k] = ''; });
  UI.saveUiPrefs();
  UI.render();
};
ACTIONS.sort = el => {
  const f = UI.filters.prospects;
  if (f.sort === el.dataset.key) f.dir = f.dir === 'asc' ? 'desc' : 'asc';
  else { f.sort = el.dataset.key; f.dir = el.dataset.key === 'updatedAt' ? 'desc' : 'asc'; }
  UI.saveUiPrefs();
  UI.render();
};
ACTIONS['toggle-table'] = el => { UI.showTables[el.dataset.key] = !UI.showTables[el.dataset.key]; UI.render(); };
INPUTS['global-q'] = el => {
  UI.globalQ = el.value;
  UI.globalOpen = true;
  UI.renderGlobalResults();
};

/* ------------------------------------------------------------ calendar */
ACTIONS['cal-move'] = el => {
  const [y, m] = UI.calendar.month.split('-').map(Number);
  const x = new Date(y, m - 1 + Number(el.dataset.n), 1);
  UI.calendar.month = x.getFullYear() + '-' + pad2(x.getMonth() + 1);
  UI.calendar.selected = UI.calendar.month + '-01';
  UI.render();
};
ACTIONS['cal-today'] = () => { UI.calendar.month = todayStr().slice(0, 7); UI.calendar.selected = todayStr(); UI.render(); };
ACTIONS['cal-select'] = el => { UI.calendar.selected = el.dataset.date; UI.render(); };
ACTIONS['open-event'] = el => {
  if (el.dataset.pid) UI.openProspect(el.dataset.pid, el.dataset.task ? 'tasks' : 'overview');
  else if (el.dataset.task) ACTIONS['edit-task']({ dataset: { id: el.dataset.task } });
};

/* ------------------------------------------------------------ sync & recovery */
ACTIONS['sync-retry'] = () => Sync.retry();
ACTIONS['sync-now'] = () => { if (Sync.dirty) Sync.syncNow({ manual: true }); else { Sync.checkRemote(); Sync.refreshStates(); UI.toast('Everything on this device is already saved to Drive.'); } };
ACTIONS['refresh-states'] = () => { Sync.refreshStates(); UI.render(); };
ACTIONS['work-offline'] = () => {
  Store.replace(newData());
  Sync.dirty = false;
  Sync.persistLocal();
  UI.render();
  UI.toast('Working offline. Changes merge into Drive when the connection is back.');
};
ACTIONS['restore-state'] = async el => {
  const meta = (Sync.states || []).find(s => s.seq === Number(el.dataset.seq));
  if (!meta) return;
  const when = meta.created_at ? fmtLongStamp(meta.created_at) : 'state #' + meta.seq;
  const ok = await confirmDialog({
    title: 'Restore this version?', confirmLabel: 'Restore state #' + meta.seq,
    html: `You are about to restore CRM data from <strong>${esc(when)}</strong> (state #${meta.seq}, ${meta.record_count == null ? '?' : meta.record_count} prospects). Current unsaved/current data may be replaced. Continue?
      <br><br><span class="muted">The restored copy is saved as a new version, so your current version stays in the list and can be restored back.</span>`
  });
  if (!ok) return;
  UI.toast('Restoring state #' + meta.seq + '…');
  try {
    await Sync.restoreState(meta);
    UI.toast('Restored the version from ' + when + '.');
    Sync.refreshStates();
  } catch (e) {
    UI.toast('Restore failed: ' + friendlyError(e), 'error');
    UI.render();
  }
};

/* ------------------------------------------------------------ settings edits */
function setMutate(fn) { Store.mutate('settings', d => { fn(d.settings, d); touch(d.settings); }); }
CHANGES['stage-rename'] = el => { const v = el.value.trim(); if (v) setMutate(s => { s.stages.find(x => x.id === el.dataset.id).name = v; }); else UI.render(); };
ACTIONS['stage-move'] = el => setMutate(s => {
  const i = s.stages.findIndex(x => x.id === el.dataset.id), j = i + Number(el.dataset.n);
  if (j < 0 || j >= s.stages.length) return;
  const [x] = s.stages.splice(i, 1); s.stages.splice(j, 0, x);
});
ACTIONS['stage-add'] = () => {
  const inp = document.getElementById('new-stage'); const name = inp.value.trim();
  if (!name) return inp.focus();
  setMutate(s => { const at = s.stages.findIndex(x => x.key === 'won'); s.stages.splice(at < 0 ? s.stages.length : at, 0, { id: uid('st'), key: null, name }); });
};
ACTIONS['stage-del'] = async el => {
  const d = Store.data;
  const n = Object.values(d.prospects).filter(p => p.stageId === el.dataset.id).length;
  if (n) { UI.toast('Move the ' + plural(n, 'prospect') + ' in this stage (including archived or trashed ones) to another stage first.', 'error'); return; }
  if (!(await confirmDialog({ title: 'Delete stage?', confirmLabel: 'Delete stage', danger: true, message: 'The stage is empty and will be removed from your pipeline.' }))) return;
  setMutate(s => { s.stages = s.stages.filter(x => x.id !== el.dataset.id); });
};
CHANGES['wf-toggle'] = el => Store.mutate('wf', d => { const w = d.workflows[el.dataset.id]; w.enabled = el.checked; touch(w); });
CHANGES['wf-step'] = el => Store.mutate('wf', d => {
  const w = d.workflows[el.dataset.id]; const s = w.steps[Number(el.dataset.i)];
  const n = Math.max(0, Math.min(60, Math.round(Number(el.value) || 0)));
  if (el.dataset.field === 'days') s.days = n; else s.due.offset = n;
  touch(w);
});
CHANGES['tag-rename'] = el => { const v = el.value.trim(); if (v) setMutate(s => { s.tags.find(x => x.id === el.dataset.id).name = v; }); };
CHANGES['tag-tone'] = el => setMutate(s => { s.tags.find(x => x.id === el.dataset.id).tone = el.value; });
ACTIONS['tag-add'] = () => {
  const inp = document.getElementById('new-tag'); const name = inp.value.trim();
  if (!name) return inp.focus();
  if (Store.data.settings.tags.some(t => t.name.toLowerCase() === name.toLowerCase())) { UI.toast('That tag already exists.', 'error'); return; }
  setMutate(s => s.tags.push({ id: uid('tag'), name, tone: TAG_TONES[s.tags.length % TAG_TONES.length] }));
};
ACTIONS['tag-del'] = async el => {
  const d = Store.data;
  const t = tagById(d, el.dataset.id);
  const n = Object.values(d.prospects).filter(p => (p.tagIds || []).indexOf(t.id) >= 0).length;
  if (!(await confirmDialog({ title: 'Delete tag “' + t.name + '”?', danger: true, confirmLabel: 'Delete tag', message: n ? 'It will be removed from ' + plural(n, 'prospect') + '. The prospects themselves are not affected.' : 'No prospects use this tag.' }))) return;
  Store.mutate('tag-del', dd => {
    dd.settings.tags = dd.settings.tags.filter(x => x.id !== t.id); touch(dd.settings);
    Object.values(dd.prospects).forEach(p => { if ((p.tagIds || []).indexOf(t.id) >= 0) { p.tagIds = p.tagIds.filter(x => x !== t.id); touch(p); } });
  });
};
CHANGES['list-rename'] = el => { const v = el.value.trim(); if (v) setMutate(s => { s[el.dataset.list].find(x => x.id === el.dataset.id).name = v; }); };
ACTIONS['list-add'] = el => {
  const k = el.dataset.list; const inp = document.getElementById('new-' + k); const name = inp.value.trim();
  if (!name) return inp.focus();
  setMutate(s => s[k].push({ id: uid(k === 'sources' ? 'src' : 'svc'), name }));
};
ACTIONS['list-del'] = el => setMutate(s => { s[el.dataset.list] = s[el.dataset.list].filter(x => x.id !== el.dataset.id); });
CHANGES['cf-edit'] = el => setMutate(s => {
  const f = s.customFields.find(x => x.id === el.dataset.id);
  if (el.dataset.field === 'options') f.options = el.value.split(',').map(x => x.trim()).filter(Boolean);
  else if (el.value.trim()) f[el.dataset.field] = el.value.trim();
});
ACTIONS['cf-add'] = () => {
  const inp = document.getElementById('new-cf'); const label = inp.value.trim();
  if (!label) return inp.focus();
  const type = document.getElementById('new-cf-type').value;
  setMutate(s => s.customFields.push({ id: uid('cf'), label, type, options: [] }));
};
ACTIONS['cf-del'] = async el => {
  const f = Store.data.settings.customFields.find(x => x.id === el.dataset.id);
  if (!(await confirmDialog({ title: 'Delete field “' + f.label + '”?', danger: true, confirmLabel: 'Delete field', message: 'The field and the values stored in it will be removed from every prospect.' }))) return;
  Store.mutate('cf-del', d => {
    d.settings.customFields = d.settings.customFields.filter(x => x.id !== f.id); touch(d.settings);
    Object.values(d.prospects).forEach(p => { if (p.custom && f.id in p.custom) { delete p.custom[f.id]; touch(p); } });
  });
};
CHANGES['reason-edit'] = el => { const v = el.value.trim(); if (v) setMutate(s => { s[el.dataset.list][Number(el.dataset.i)] = v; }); };
ACTIONS['reason-del'] = el => setMutate(s => { s[el.dataset.list].splice(Number(el.dataset.i), 1); });
ACTIONS['reason-add'] = el => {
  const k = el.dataset.list; const inp = document.getElementById('new-' + k); const v = inp.value.trim();
  if (!v) return inp.focus();
  setMutate(s => s[k].push(v));
};
CHANGES.pref = el => setMutate(s => {
  const [a, b] = el.dataset.path.split('.');
  s[a][b] = el.type === 'number' ? Math.max(1, Math.min(60, Number(el.value) || 1)) : el.value.trim();
});

/* ------------------------------------------------------------ backup & sample data */
ACTIONS.export = () => {
  const json = JSON.stringify({
    exported_at: nowIso(), application_version: APP_VERSION, data_version: DATA_VERSION,
    record_count: Object.keys(Store.data.prospects).length, data: Store.data
  }, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'crm_backup_' + todayStr() + '.json';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  UI.toast('Backup downloaded.');
};
ACTIONS['load-sample'] = async () => {
  const ok = await confirmDialog({ title: 'Load sample prospects?', confirmLabel: 'Load samples', message: 'Adds 14 fictional prospects tagged “Sample”, spread across every stage, with notes, tasks and history. Your own prospects are not touched.' });
  if (!ok) return;
  Store.mutate('sample', d => loadSampleData(d));
  UI.toast('Sample prospects added.');
  UI.go('dashboard');
};
ACTIONS['remove-sample'] = async () => {
  const n = Object.values(Store.data.prospects).filter(p => p.sample).length;
  const ok = await confirmDialog({ title: 'Remove sample prospects?', danger: true, confirmLabel: 'Remove ' + n, message: 'Permanently removes the ' + n + ' fictional sample prospects and their tasks, notes and history. Your own prospects are not touched.' });
  if (!ok) return;
  Store.mutate('sample-remove', d => {
    Object.values(d.prospects).filter(p => p.sample).forEach(p => purgeProspect(d, p.id));
    d.settings.tags = d.settings.tags.filter(t => t.id !== 'tag_sample'); touch(d.settings);
  });
  UI.toast('Sample prospects removed.');
};

/* ------------------------------------------------------------ global wiring */
function wireEvents() {
  document.addEventListener('click', e => {
    const fill = e.target.closest('#pform [data-fill]');
    if (fill) {
      const t = document.querySelector('#pform [name="' + fill.dataset.fill + '"]');
      if (t) t.value = fill.dataset.value;
      return;
    }
    const el = e.target.closest('[data-act]');
    if (!e.target.closest('.gsearch') && UI.globalOpen) { UI.globalOpen = false; UI.renderGlobalResults(); }
    if (!el || el.disabled) return;
    const act = el.dataset.act;
    if (act === 'ext') return;
    const fn = ACTIONS[act];
    if (!fn) return;
    // form controls inside a clickable row keep their normal behaviour
    const ctl = e.target.closest('input,select,textarea,label');
    if (ctl && ctl !== el && el.contains(ctl)) return;
    e.preventDefault();
    fn(el, e);
  });
  document.addEventListener('change', e => {
    const el = e.target.closest('[data-change]');
    if (el && CHANGES[el.dataset.change]) CHANGES[el.dataset.change](el, e);
  });
  document.addEventListener('input', e => {
    const el = e.target.closest('[data-input]');
    if (el && INPUTS[el.dataset.input]) INPUTS[el.dataset.input](el, e);
  });
  document.addEventListener('submit', e => {
    if (e.target.id === 'pform') { e.preventDefault(); submitProspectForm(e.target); }
  });
  document.addEventListener('focusin', e => {
    if (e.target.id === 'global-q' && UI.globalQ) { UI.globalOpen = true; UI.renderGlobalResults(); }
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (Modal.closeTop()) return;
      if (UI.globalOpen) { UI.globalOpen = false; UI.renderGlobalResults(); return; }
      if (UI.drawer) { if (UI.drawer.mode === 'view') UI.closeDrawer(); return; }
      if (UI.navOpen) { UI.navOpen = false; UI.render(); }
    }
    if (e.key === 'Enter' && e.target.id === 'global-q') { e.preventDefault(); ACTIONS['search-all'](); }
    if (e.key === 'Enter' && e.target.matches && e.target.matches('tr[data-act], .kcard[data-act]')) { e.preventDefault(); e.target.click(); }
    if (e.key === '/' && !e.target.closest('input,textarea,select,[contenteditable]') && !Modal.stack.length) {
      e.preventDefault();
      const g = document.getElementById('global-q');
      if (g) g.focus();
    }
  });
  // hover tooltips for charts and numbers
  const tip = document.createElement('div');
  tip.className = 'tip';
  tip.setAttribute('role', 'tooltip');
  document.body.appendChild(tip);
  document.addEventListener('mouseover', e => {
    const t = e.target.closest && e.target.closest('[data-tip]');
    if (!t) { tip.classList.remove('on'); return; }
    tip.textContent = t.dataset.tip;
    tip.classList.add('on');
  });
  document.addEventListener('mousemove', e => {
    if (!tip.classList.contains('on')) return;
    const x = Math.min(e.clientX + 14, window.innerWidth - tip.offsetWidth - 8);
    tip.style.transform = `translate(${x}px, ${e.clientY + 16}px)`;
  });
}
