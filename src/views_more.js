/* ============================================================ views: tasks, calendar, analytics, archive, trash */

VIEWS.tasks = function () {
  const d = Store.data;
  const f = UI.filters.tasks;
  const tb = taskBuckets(d);
  const tabs = [['today', 'Today', tb.today], ['overdue', 'Overdue', tb.overdue], ['upcoming', 'Upcoming', tb.upcoming], ['completed', 'Completed', tb.completed], ['all', 'All open', tb.open]];
  const cur = tabs.find(t => t[0] === f.tab) || tabs[0];
  let list = cur[2].filter(t => {
    if (f.priority && t.priority !== f.priority) return false;
    if (f.type && t.type !== f.type) return false;
    if (f.q) {
      const p = t.prospectId ? d.prospects[t.prospectId] : null;
      const hay = (t.title + ' ' + (t.notes || '') + ' ' + (p ? prospectName(p) : '')).toLowerCase();
      if (hay.indexOf(f.q.toLowerCase()) < 0) return false;
    }
    return true;
  });
  return `${pageHead('Tasks', 'Everything you’ve committed to, linked to the prospect it’s for.', `<button class="btn btn-primary" data-act="new-task">${icon('plus')}New task</button>`)}
  <div class="segs" role="tablist">${tabs.map(([k, l, arr]) => `<button role="tab" class="seg${f.tab === k ? ' on' : ''}${k === 'overdue' && arr.length ? ' urgent' : ''}" aria-selected="${f.tab === k}" data-act="filter-set" data-scope="tasks" data-key="tab" data-value="${k}">${l}<span>${arr.length}</span></button>`).join('')}</div>
  <div class="filters">
    <div class="finput">${icon('search')}<input id="f-tasks-q" type="search" placeholder="Filter tasks…" value="${attr(f.q)}" data-input="filter" data-scope="tasks" data-key="q" aria-label="Filter tasks"></div>
    ${filterSelect('tasks', 'priority', PRIORITIES, 'Any priority')}
    ${filterSelect('tasks', 'type', Object.keys(TASK_TYPES).map(k => ({ id: k, label: TASK_TYPES[k] })), 'Any type')}
  </div>
  <section class="panel">
    ${list.length ? taskTable(list, f.tab === 'completed') : emptyState('tasks', f.tab === 'overdue' ? 'Nothing overdue' : f.tab === 'today' ? 'Nothing due today' : 'No tasks here', f.tab === 'today' ? 'Tasks you or your automations create will show here on their due date.' : '', `<button class="btn" data-act="new-task">${icon('plus')}New task</button>`)}
  </section>`;
};

function taskTable(list, completed) {
  const d = Store.data;
  return `<div class="table-wrap"><table class="table ttable"><thead><tr><th class="th-check"><span class="sr">Done</span></th><th>Task</th><th>Prospect</th><th>${completed ? 'Completed' : 'Due'}</th><th>Priority</th><th>Status</th><th><span class="sr">Actions</span></th></tr></thead>
  <tbody>${list.map(t => {
    const p = t.prospectId ? d.prospects[t.prospectId] : null;
    const done = t.status === 'done';
    return `<tr class="${done ? 'is-done' : ''}">
      <td class="td-check"><label class="check"><input type="checkbox" ${done ? 'checked' : ''} data-change="task-done" data-id="${t.id}" aria-label="Mark done"><span></span></label></td>
      <td class="td-task" data-act="edit-task" data-id="${t.id}"><strong>${esc(t.title)}</strong>${t.type !== 'general' ? `<span class="ttype">${esc(TASK_TYPES[t.type] || t.type)}</span>` : ''}${t.source && t.source.indexOf('wf:') === 0 ? `<span class="ttype auto" title="Created by an automation">${icon('zap')}Auto</span>` : ''}${t.notes ? `<span class="tnote">${esc(t.notes.slice(0, 90))}</span>` : ''}</td>
      <td data-label="Prospect">${p ? `<button class="plink" data-act="open-prospect" data-id="${p.id}">${esc(prospectName(p))}</button>` : '<span class="muted">—</span>'}</td>
      <td data-label="${completed ? 'Completed' : 'Due'}">${completed ? esc(fmtStamp(t.completedAt)) : dueBadge(t.dueDate)}</td>
      <td data-label="Priority">${prioBadge(t.priority)}</td>
      <td data-label="Status"><select class="fsel sm" data-change="task-status" data-id="${t.id}" aria-label="Status">${selectOpts(TASK_STATUS, t.status)}</select></td>
      <td class="td-actions"><button class="icon-btn sm" data-act="edit-task" data-id="${t.id}" aria-label="Edit task">${icon('edit')}</button>
        <button class="icon-btn sm" data-act="delete-task" data-id="${t.id}" aria-label="Delete task">${icon('trash')}</button></td>
    </tr>`;
  }).join('')}</tbody></table></div>`;
}

/* ------------------------------------------------------------ calendar */
function calendarEvents(d, from, to) {
  const ev = [];
  const add = (date, type, label, pid, taskId, time, done) => { if (date && date >= from && date <= to) ev.push({ date, type, label, pid, taskId, time, done }); };
  Object.values(d.tasks).forEach(t => {
    if (!taskOpen(t) && t.status !== 'done') return;
    if (!taskVisible(d, t)) return;
    const p = t.prospectId ? d.prospects[t.prospectId] : null;
    if (t.type === 'follow_up' && p && !isOpen(p) && t.status !== 'done') return;
    add(t.dueDate, t.type === 'follow_up' ? 'followup' : 'task', (t.type === 'follow_up' && p ? 'Follow up: ' + prospectName(p) : t.title), t.prospectId, t.id, '', t.status === 'done');
  });
  Object.values(d.prospects).forEach(p => {
    if (p.lifecycle !== 'active') return;
    if (p.interviewAt) { const dt = parseLocalDateTime(p.interviewAt); add(dateOnly(p.interviewAt), 'interview', 'Interview: ' + prospectName(p), p.id, null, dt ? fmtTime(dt) : ''); }
    if (p.proposalDate) add(p.proposalDate, 'proposal', 'Proposal sent: ' + prospectName(p), p.id);
    if (p.appliedDate) add(p.appliedDate, 'applied', 'Applied: ' + prospectName(p), p.id);
  });
  const order = { interview: 0, followup: 1, task: 2, proposal: 3, applied: 4 };
  return ev.sort((a, b) => a.date.localeCompare(b.date) || order[a.type] - order[b.type]);
}
const EV_ICON = { interview: 'calendar', followup: 'followups', task: 'tasks', proposal: 'note', applied: 'arrow' };
const EV_LABEL = { interview: 'Interview', followup: 'Follow-up', task: 'Task', proposal: 'Proposal', applied: 'Applied' };

VIEWS.calendar = function () {
  const d = Store.data;
  const [y, mo] = UI.calendar.month.split('-').map(Number);
  const first = new Date(y, mo - 1, 1);
  const start = new Date(first); start.setDate(1 - first.getDay());
  const days = [];
  for (let i = 0; i < 42; i++) { const x = new Date(start); x.setDate(start.getDate() + i); days.push(toDateStr(x)); }
  if (days.slice(35).every(s => +s.slice(5, 7) !== mo)) days.length = 35;
  const ev = calendarEvents(d, days[0], days[days.length - 1]);
  const byDay = {};
  ev.forEach(e => { (byDay[e.date] || (byDay[e.date] = [])).push(e); });
  const today = todayStr();
  const sel = UI.calendar.selected;
  const chip = e => `<button class="ev ev-${e.type}${e.done ? ' ev-done' : ''}" data-act="open-event" data-pid="${e.pid || ''}" data-task="${e.taskId || ''}" title="${attr(EV_LABEL[e.type] + (e.done ? ' (done)' : '') + ' — ' + e.label)}">${icon(EV_ICON[e.type])}<span>${e.time ? esc(e.time) + ' ' : ''}${esc(e.label)}</span></button>`;
  const selEvents = byDay[sel] || [];
  const monthEvents = ev.filter(e => e.date.slice(0, 7) === UI.calendar.month);
  return `${pageHead('Calendar', 'Interviews, follow-ups, tasks and key prospect dates. Select an item to open it.')}
  <div class="cal-bar">
    <div class="cal-nav"><button class="icon-btn" data-act="cal-move" data-n="-1" aria-label="Previous month">${icon('left')}</button>
      <h2>${MONTHS_LONG[mo - 1]} ${y}</h2>
      <button class="icon-btn" data-act="cal-move" data-n="1" aria-label="Next month">${icon('right')}</button>
      <button class="btn btn-sm" data-act="cal-today">Today</button></div>
    <div class="cal-legend">${Object.keys(EV_LABEL).map(k => `<span class="ev-key ev-${k}">${icon(EV_ICON[k])}${EV_LABEL[k]}</span>`).join('')}</div>
  </div>
  <div class="cal-grid" role="grid" aria-label="${MONTHS_LONG[mo - 1]} ${y}">
    ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(w => `<div class="cal-wd" role="columnheader">${w}</div>`).join('')}
    ${days.map(s => {
      const list = byDay[s] || [];
      const out = +s.slice(5, 7) !== mo;
      return `<div class="cal-day${out ? ' out' : ''}${s === today ? ' today' : ''}${s === sel ? ' sel' : ''}" role="gridcell" data-act="cal-select" data-date="${s}">
        <span class="cal-num">${+s.slice(8)}</span>
        <div class="cal-evs">${list.slice(0, 3).map(chip).join('')}${list.length > 3 ? `<span class="ev-more">+${list.length - 3} more</span>` : ''}</div>
        ${list.length ? `<span class="cal-dots" aria-hidden="true">${list.slice(0, 4).map(e => `<i class="dot-${e.type}"></i>`).join('')}</span>` : ''}
      </div>`;
    }).join('')}
  </div>
  <section class="panel cal-agenda">
    <div class="panel-head"><h2>${sel === today ? 'Today' : esc(DAYS[parseDateStr(sel).getDay()] + ', ' + fmtDate(sel, true))}</h2>
      <button class="btn btn-sm btn-ghost" data-act="new-task" data-date="${sel}">${icon('plus')}Task on this day</button></div>
    ${selEvents.length ? `<div class="agenda">${selEvents.map(chip).join('')}</div>` : '<p class="muted pad">Nothing on this day.</p>'}
  </section>
  <section class="panel cal-month-list">
    <div class="panel-head"><h2>This month</h2></div>
    ${monthEvents.length ? Object.keys(byDay).filter(k => k.slice(0, 7) === UI.calendar.month).sort().map(k => `<div class="agenda-day"><h3>${esc(fmtDate(k))}</h3><div class="agenda">${byDay[k].map(chip).join('')}</div></div>`).join('') : '<p class="muted pad">Nothing scheduled this month.</p>'}
  </section>`;
};

/* ------------------------------------------------------------ analytics */
function hbars(rows, opts) {
  opts = opts || {};
  const max = Math.max(1, ...rows.map(r => r.value));
  const total = rows.reduce((s, r) => s + r.value, 0);
  if (!rows.length || !total) return `<p class="muted pad">${opts.empty || 'No data yet.'}</p>`;
  return `<div class="hbars ${opts.cls || ''}">${rows.map(r => `
    <div class="hbar" data-tip="${attr(r.label + ': ' + r.value + (opts.share ? ' (' + fmtPct(r.value, total) + ')' : ''))}">
      <span class="hbar-l">${esc(r.label)}</span>
      <span class="hbar-track"><span class="hbar-fill" style="width:${(r.value / max) * 100}%"></span></span>
      <span class="hbar-v">${r.value}${opts.share ? `<small>${fmtPct(r.value, total)}</small>` : ''}</span>
    </div>`).join('')}</div>`;
}

function columns(series, label) {
  const max = Math.max(1, ...series.map(s => s.value));
  const sum = series.reduce((a, s) => a + s.value, 0);
  return `<figure class="cols-fig"><figcaption><span>${esc(label)}</span><strong>${sum}</strong></figcaption>
    <div class="cols">${series.map(s => `<div class="col" data-tip="${attr(s.label + ': ' + s.value)}">
      <span class="col-v">${s.value || ''}</span><span class="col-bar" style="height:${(s.value / max) * 100}%"></span><span class="col-l">${esc(s.label.split(' ')[0])}</span></div>`).join('')}</div></figure>`;
}

function rateCell(n, dd) {
  const p = pct(n, dd);
  return `<td class="rate"><span class="rate-bar"><span style="width:${p || 0}%"></span></span><span>${p === null ? '—' : p + '%'}</span><small>${n}/${dd}</small></td>`;
}

function convTable(rows, label) {
  if (!rows.length) return '<p class="muted pad">No data yet.</p>';
  return `<div class="table-wrap"><table class="table ctable"><thead><tr><th>${label}</th><th class="num">Opps</th><th class="num">Applied</th><th>Reply rate</th><th>Interview rate</th><th>Win rate</th></tr></thead>
  <tbody>${rows.map(r => `<tr><td><strong>${esc(r.label)}</strong></td><td class="num">${r.total}</td><td class="num">${r.applications}</td>
    ${rateCell(r.replies, r.applications)}${rateCell(r.interviews, r.applications)}${rateCell(r.won, r.applications)}</tr>`).join('')}</tbody></table></div>
  <p class="muted small">Rates are measured against applications sent from each ${label.toLowerCase()}. Small numbers swing a lot; treat them as directional.</p>`;
}

VIEWS.analytics = function () {
  const d = Store.data;
  const live = liveProspects(d);
  const months = UI.filters.analytics.months;
  const ms = monthlySeries(d, months);
  const bySource = groupCount(live, p => p.sourceId, k => sourceName(d, k) || 'No source');
  const byService = groupCount(live, p => p.serviceId, k => serviceName(d, k) || 'No service');
  const lost = live.filter(p => p.outcome === 'lost');
  const byLost = groupCount(lost, p => p.lostReason || 'No reason given');
  const showTable = UI.showTables.monthly;
  if (!live.length) {
    return `${pageHead('Analytics', 'How your client acquisition is actually performing.')}
      ${emptyState('analytics', 'No data to analyze yet', 'Analytics are calculated from your real prospects. Add a few, move them through the pipeline, and the patterns will show up here.', `<button class="btn btn-primary" data-act="new-prospect">${icon('plus')}Add prospect</button>`)}`;
  }
  return `${pageHead('Analytics', 'Calculated from your own CRM records, including archived ones. Trash is excluded.')}
  <section class="panel">
    <div class="panel-head"><h2>Insights</h2></div>
    ${insightList(d)}
  </section>
  <div class="dash-grid dash-grid-even">
    <section class="panel"><div class="panel-head"><h2>Opportunities by lead source</h2></div>${hbars(bySource, { share: true })}</section>
    <section class="panel"><div class="panel-head"><h2>Opportunities by service</h2></div>${hbars(byService, { share: true })}</section>
  </div>
  <section class="panel">
    <div class="panel-head"><h2>Month by month</h2>
      <div class="head-tools">
        <select class="fsel sm" data-change="filter" data-scope="analytics" data-key="months" aria-label="Period">${selectOpts([{ id: 6, label: 'Last 6 months' }, { id: 12, label: 'Last 12 months' }], months)}</select>
        <button class="btn btn-sm btn-ghost" data-act="toggle-table" data-key="monthly">${showTable ? 'Show charts' : 'Show as table'}</button>
      </div></div>
    ${showTable ? `<div class="table-wrap"><table class="table"><thead><tr><th>Month</th>${FUNNEL.map(f => `<th class="num">${f.key === 'applied' ? 'Applications' : f.key === 'replied' ? 'Replies' : f.key === 'interview' ? 'Interviews' : f.key === 'proposal' ? 'Proposals' : 'Clients won'}</th>`).join('')}</tr></thead>
      <tbody>${ms.applied.map((m, i) => `<tr><td>${esc(m.label)}</td>${FUNNEL.map(f => `<td class="num">${ms[f.key][i].value}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
      : `<div class="smalls">${columns(ms.applied, 'Applications')}${columns(ms.replied, 'Replies')}${columns(ms.interview, 'Interviews')}${columns(ms.proposal, 'Proposals')}${columns(ms.won, 'Clients won')}</div>`}
  </section>
  <section class="panel"><div class="panel-head"><h2>Conversion by lead source</h2></div>${convTable(conversionBy(d, 'sourceId'), 'Source')}</section>
  <section class="panel"><div class="panel-head"><h2>Conversion by service</h2></div>${convTable(conversionBy(d, 'serviceId'), 'Service')}</section>
  <section class="panel"><div class="panel-head"><h2>Lost opportunities by reason</h2></div>${hbars(byLost, { share: true, empty: 'Nothing lost yet. When you move a prospect to Lost you can record why, and the reasons collect here.' })}</section>`;
};

/* ------------------------------------------------------------ archive */
VIEWS.archive = function () {
  const d = Store.data;
  const f = UI.filters.archive;
  const list = Object.values(d.prospects).filter(p => p.lifecycle === 'archived' && matchesQuery(d, p, f.q) && (!f.reason || (p.archive && p.archive.reason === f.reason)))
    .sort((a, b) => (b.archive ? b.archive.at : '').localeCompare(a.archive ? a.archive.at : ''));
  const total = Object.values(d.prospects).filter(p => p.lifecycle === 'archived').length;
  return `${pageHead('Archive', 'Parked opportunities. They’re out of your pipeline and lists but keep every note, task and activity, and stay searchable. Restoring returns them to the same stage.')}
  ${total ? `<div class="filters"><div class="finput">${icon('search')}<input id="f-archive-q" type="search" placeholder="Search archive…" value="${attr(f.q)}" data-input="filter" data-scope="archive" data-key="q" aria-label="Search archive"></div>
    ${filterSelect('archive', 'reason', d.settings.archiveReasons.map(r => ({ id: r, label: r })), 'Any reason')}</div>` : ''}
  ${list.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Prospect</th><th>Stage when archived</th><th>Reason</th><th>Archived on</th><th>Source</th><th><span class="sr">Actions</span></th></tr></thead>
    <tbody>${list.map(p => `<tr>
      <td class="td-name" data-act="open-prospect" data-id="${p.id}">${monogram(p)}<div><strong>${esc(prospectName(p))}</strong><span>${esc(p.title || '')}</span></div></td>
      <td data-label="Stage">${stagePill(d, p)}</td>
      <td data-label="Reason">${esc(p.archive ? p.archive.reason : '')}${p.archive && p.archive.note ? `<span class="tnote">${esc(p.archive.note)}</span>` : ''}</td>
      <td data-label="Archived">${esc(p.archive ? fmtStamp(p.archive.at) : '')}</td>
      <td data-label="Source">${esc(sourceName(d, p.sourceId))}</td>
      <td class="td-actions"><button class="btn btn-sm" data-act="restore-archive" data-id="${p.id}">${icon('restore')}Restore</button>
        <button class="btn btn-sm btn-ghost-danger" data-act="trash" data-id="${p.id}">${icon('trash')}Delete</button></td></tr>`).join('')}</tbody></table></div>`
    : emptyState('archive', total ? 'No archived prospects match' : 'Archive is empty', total ? '' : 'Archive an opportunity when it’s paused, on hold or not worth chasing right now. It leaves your pipeline without losing anything.')}`;
};

/* ------------------------------------------------------------ trash */
VIEWS.trash = function () {
  const d = Store.data;
  const f = UI.filters.trash;
  const all = Object.values(d.prospects).filter(p => p.lifecycle === 'trashed');
  const list = all.filter(p => matchesQuery(d, p, f.q)).sort((a, b) => (b.trash ? b.trash.at : '').localeCompare(a.trash ? a.trash.at : ''));
  return `${pageHead('Trash', 'Deleted prospects stay here, fully recoverable, until you delete them permanently. Nothing is removed automatically.',
    all.length ? `<button class="btn btn-danger" data-act="empty-trash">${icon('trash')}Empty Trash</button>` : '')}
  ${all.length ? `<div class="filters"><div class="finput">${icon('search')}<input id="f-trash-q" type="search" placeholder="Search Trash…" value="${attr(f.q)}" data-input="filter" data-scope="trash" data-key="q" aria-label="Search Trash"></div></div>` : ''}
  ${list.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Lead name</th><th>Company</th><th>Previous stage</th><th>Date deleted</th><th>Lead source</th><th>Deleted by</th><th><span class="sr">Actions</span></th></tr></thead>
    <tbody>${list.map(p => `<tr>
      <td data-act="open-prospect" data-id="${p.id}" class="td-link"><strong>${esc(p.contactName || p.title || prospectName(p))}</strong>${p.trash && p.trash.from === 'archived' ? '<span class="badge badge-muted">Was archived</span>' : ''}</td>
      <td data-label="Company">${esc(p.company || '—')}</td>
      <td data-label="Previous stage">${stagePill(d, p)}</td>
      <td data-label="Deleted">${esc(p.trash ? fmtStamp(p.trash.at) : '')}</td>
      <td data-label="Source">${esc(sourceName(d, p.sourceId))}</td>
      <td data-label="Deleted by">${esc(p.trash ? p.trash.by : '')}</td>
      <td class="td-actions"><button class="btn btn-sm" data-act="restore-trash" data-id="${p.id}">${icon('restore')}Restore</button>
        <button class="btn btn-sm btn-ghost-danger" data-act="purge" data-id="${p.id}">Delete permanently</button></td></tr>`).join('')}</tbody></table></div>`
    : emptyState('trash', all.length ? 'Nothing in Trash matches' : 'Trash is empty', all.length ? '' : 'When you delete a prospect it comes here first, so a slip of the finger never costs you anything.')}`;
};
