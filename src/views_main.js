/* ============================================================ views: dashboard, prospects, pipeline, follow-ups */
const VIEWS = {};

function pageHead(title, sub, actions) {
  return `<div class="page-head"><div><h1>${esc(title)}</h1>${sub ? `<p class="page-sub">${sub}</p>` : ''}</div>${actions ? `<div class="page-actions">${actions}</div>` : ''}</div>`;
}

/* ------------------------------------------------------------ dashboard */
VIEWS.dashboard = function () {
  const d = Store.data;
  const m = computeMetrics(d);
  const tb = taskBuckets(d);
  const fu = followUpBuckets(d);
  const ivs = upcomingInterviews(d);
  const now = new Date(nowMs());

  // the headline reads like a person telling you what needs you today
  const fuDue = m.followUpsToday + m.followUpsOverdue;
  const otherDue = tb.today.concat(tb.overdue).filter(t => t.type !== 'follow_up').length;
  const otherOver = tb.overdue.filter(t => t.type !== 'follow_up').length;
  const ivToday = ivs.filter(p => dateOnly(p.interviewAt) === todayStr());
  const parts = [];
  if (fuDue) parts.push(plural(fuDue, 'follow-up') + ' to send' + (m.followUpsOverdue ? ' (' + m.followUpsOverdue + ' overdue)' : ''));
  if (otherDue) parts.push(plural(otherDue, 'task') + ' due' + (otherOver ? ' (' + otherOver + ' overdue)' : ''));
  if (ivToday.length) parts.push(plural(ivToday.length, 'interview') + ' today');
  let headline;
  if (!m.total) headline = 'Start by adding the first opportunity you’re chasing.';
  else if (!parts.length) headline = 'Nothing is due today. A good day to find new prospects.';
  else headline = 'You have ' + (parts.length > 1 ? parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1] : parts[0]) + '.';

  const actionCell = (n, label, view, tone, ic, extra) => `
    <button class="act-cell${n ? ' tone-' + tone : ''}" data-act="go" data-view="${view}"${extra || ''}>
      <span class="act-n">${n}</span><span class="act-l">${n && tone === 'over' ? icon('alert') : ''}${esc(label)}</span></button>`;

  const fuList = fu.overdue.concat(fu.today).slice(0, 6);
  const noFu = prospectsWithoutFollowUp(d);

  return `
  <section class="today">
    <div class="today-date">${DAYS[now.getDay()]}, ${MONTHS_LONG[now.getMonth()]} ${now.getDate()}</div>
    <h1 class="today-line">${esc(headline)}</h1>
    ${!m.total ? `<div class="today-cta"><button class="btn btn-primary" data-act="new-prospect">${icon('plus')}Add your first prospect</button>
      <button class="btn" data-act="go-settings" data-tab="data">Load sample data to explore</button></div>` : ''}
  </section>

  <section class="act-band" aria-label="Needs your attention">
    ${actionCell(m.followUpsToday, 'Follow-ups due today', 'followups', 'today')}
    ${actionCell(m.followUpsOverdue, 'Overdue follow-ups', 'followups', 'over')}
    ${actionCell(m.overdueTasks, 'Overdue tasks', 'tasks', 'over', '', ' data-tab="overdue"')}
    ${actionCell(m.upcomingInterviews, 'Upcoming interviews', 'calendar', 'info')}
  </section>

  <div class="dash-grid">
    <section class="panel">
      <div class="panel-head"><h2>Today’s tasks</h2><button class="btn btn-sm btn-ghost" data-act="new-task">${icon('plus')}New task</button></div>
      ${tb.today.length ? taskList(tb.today) : `<p class="muted pad">No tasks due today.${tb.upcomingSoon.length ? ' Next up is below.' : ''}</p>`}
      ${tb.overdue.length ? `<h3 class="sub-h tone-over">${icon('alert')}Overdue</h3>${taskList(tb.overdue.slice(0, 6))}${tb.overdue.length > 6 ? `<button class="link-btn" data-act="go" data-view="tasks" data-tab="overdue">See all ${tb.overdue.length} overdue tasks</button>` : ''}` : ''}
      <h3 class="sub-h">Coming up · next ${d.settings.prefs.upcomingDays} days</h3>
      ${tb.upcomingSoon.length ? taskList(tb.upcomingSoon.slice(0, 6)) : '<p class="muted pad">Nothing scheduled.</p>'}
      ${tb.completed.length ? `<details class="done-list"><summary>Recently completed (${Math.min(tb.completed.length, 5)})</summary>${taskList(tb.completed.slice(0, 5))}</details>` : ''}
    </section>

    <div class="stack">
      <section class="panel">
        <div class="panel-head"><h2>Follow-ups</h2><button class="btn btn-sm btn-ghost" data-act="go" data-view="followups">Open follow-ups</button></div>
        ${fuList.length ? `<ul class="rows">${fuList.map(t => followUpRow(d, t, true)).join('')}</ul>` : `<p class="muted pad">No follow-ups due today. ${fu.upcoming.length ? 'Next one: ' + esc(fmtDate(fu.upcoming[0].dueDate)) + '.' : ''}</p>`}
        ${noFu.length ? `<button class="hint-row" data-act="go" data-view="followups">${icon('alert')}${plural(noFu.length, 'active prospect')} ${noFu.length === 1 ? 'has' : 'have'} no follow-up scheduled</button>` : ''}
      </section>
      <section class="panel">
        <div class="panel-head"><h2>Upcoming interviews</h2></div>
        ${ivs.length ? `<ul class="rows">${ivs.slice(0, 5).map(p => `
          <li class="row" data-act="open-prospect" data-id="${p.id}">
            <div class="row-date"><strong>${esc(fmtDate(p.interviewAt))}</strong><span>${esc(fmtTime(parseLocalDateTime(p.interviewAt)))}</span></div>
            <div class="row-main"><strong>${esc(prospectName(p))}</strong><span>${esc(prospectSubtitle(p))}</span></div>
            ${relDay(p.interviewAt) === 'Today' ? '<span class="due due-today">Today</span>' : ''}
          </li>`).join('')}</ul>` : '<p class="muted pad">No interviews scheduled. They appear here when a prospect reaches Discovery Call / Interview with a date.</p>'}
      </section>
    </div>
  </div>

  <div class="dash-grid dash-grid-even">
    <section class="panel">
      <div class="panel-head"><h2>Conversion</h2><span class="muted small">Counts every prospect that reached each step</span></div>
      ${funnelChart(d, m)}
    </section>
    <section class="panel">
      <div class="panel-head"><h2>Pipeline right now</h2><button class="btn btn-sm btn-ghost" data-act="go" data-view="pipeline">Open pipeline</button></div>
      ${pipelineSnapshot(d)}
    </section>
  </div>

  <div class="dash-grid dash-grid-even">
    <section class="panel">
      <div class="panel-head"><h2>All numbers</h2></div>
      <dl class="kpis">
        ${kpi('Total prospects', m.total, 'Every opportunity you tracked, except Trash and clients you added manually')}
        ${kpi('Active opportunities', m.active, 'Not archived, not won or lost')}
        ${kpi('Applications sent', m.applications)}
        ${kpi('Replies', m.replies)}
        ${kpi('Interviews', m.interviews)}
        ${kpi('Proposals', m.proposals)}
        ${kpi('Clients won', m.won)}
        ${kpi('Clients lost', m.lost)}
        ${kpi('Follow-ups due today', m.followUpsToday)}
        ${kpi('Overdue follow-ups', m.followUpsOverdue)}
        ${kpi('Upcoming interviews', m.upcomingInterviews)}
        ${kpi('Overdue tasks', m.overdueTasks)}
        ${kpi('Current clients', m.clientsCurrent, 'Won through the pipeline or added with Add client')}
        ${kpi('Past clients', m.clientsPast)}
        ${kpi('Archived leads', m.archived)}
        ${kpi('In Trash', m.trashed)}
      </dl>
    </section>
    <section class="panel">
      <div class="panel-head"><h2>What the data says</h2><button class="btn btn-sm btn-ghost" data-act="go" data-view="analytics">Analytics</button></div>
      ${insightList(d)}
    </section>
  </div>`;
};

function kpi(label, n, tip) {
  return `<div class="kpi"${tip ? ` data-tip="${attr(tip)}"` : ''}><dt>${esc(label)}</dt><dd>${n}</dd></div>`;
}

function insightList(d) {
  const ins = insights(d);
  return `<ul class="insights">${ins.map(i => `<li class="ins ins-${i.tone}">${i.tone === 'warn' ? icon('alert') : icon('activity')}<span>${esc(i.text)}</span>
    ${i.action ? `<button class="link-btn" data-act="go" data-view="${i.action}">Review</button>` : ''}</li>`).join('')}</ul>`;
}

function funnelChart(d, m) {
  const steps = [
    ['Applied', m.applications], ['Replied', m.replies], ['Interview', m.interviews], ['Proposal', m.proposals], ['Won', m.won]
  ];
  const max = Math.max(1, steps[0][1], ...steps.map(s => s[1]));
  const shades = ['f1', 'f2', 'f3', 'f4', 'f5'];
  return `<div class="funnel">${steps.map((s, i) => {
    const conv = i > 0 ? m.conv[i - 1] : null;
    return `${conv ? `<div class="funnel-step" data-tip="${attr(conv.hint)}">${icon('down')}<span>${esc(conv.label)}</span><strong>${fmtPct(conv.n, conv.d)}</strong></div>` : ''}
      <div class="funnel-row" data-tip="${attr(s[0] + ': ' + s[1])}"><span class="funnel-l">${s[0]}</span>
      <span class="funnel-track"><span class="funnel-bar ${shades[i]}" style="width:${Math.max(s[1] ? 2 : 0, (s[1] / max) * 100)}%"></span></span>
      <span class="funnel-v">${s[1]}</span></div>`;
  }).join('')}
  <div class="funnel-overall"><span>Overall conversion (won ÷ applications)</span><strong>${fmtPct(m.won, m.applications)}</strong></div></div>`;
}

function pipelineSnapshot(d) {
  const active = Object.values(d.prospects).filter(p => p.lifecycle === 'active');
  const rows = d.settings.stages.map(s => ({ label: s.name, value: active.filter(p => p.stageId === s.id).length, key: s.key }));
  if (!active.length) return '<p class="muted pad">Your pipeline is empty.</p>';
  return hbars(rows, { cls: 'bars-compact' });
}

function taskList(list) {
  const d = Store.data;
  return `<ul class="tasklist">${list.map(t => {
    const p = t.prospectId ? d.prospects[t.prospectId] : null;
    const done = t.status === 'done';
    return `<li class="task-item${done ? ' is-done' : ''}">
      <label class="check"><input type="checkbox" ${done ? 'checked' : ''} data-change="task-done" data-id="${t.id}" aria-label="Mark “${attr(t.title)}” ${done ? 'not done' : 'done'}"><span></span></label>
      <div class="task-main" data-act="edit-task" data-id="${t.id}">
        <span class="task-title">${esc(t.title)}</span>
        <span class="task-meta">${t.type !== 'general' ? `<span class="ttype">${esc(TASK_TYPES[t.type] || t.type)}</span>` : ''}
          ${p ? `<button class="plink" data-act="open-prospect" data-id="${p.id}">${esc(prospectName(p))}</button>` : ''}
          ${t.status === 'in_progress' ? '<span class="badge badge-info">In progress</span>' : ''}</span>
      </div>
      ${done ? `<span class="due">${esc(timeAgo(t.completedAt))}</span>` : dueBadge(t.dueDate)}
      ${t.priority === 'high' && !done ? '<span class="prio-dot" title="High priority" aria-label="High priority"></span>' : ''}
    </li>`;
  }).join('')}</ul>`;
}

function followUpRow(d, t, compact) {
  const p = t.prospectId ? d.prospects[t.prospectId] : null;
  const la = p ? lastActivity(p.id) : null;
  const done = t.status === 'done';
  return `<li class="row fu-row">
    ${p ? monogram(p) : ''}
    <div class="row-main" data-act="${p ? 'open-prospect' : 'edit-task'}" data-id="${p ? p.id : t.id}">
      <strong>${esc(p ? prospectName(p) : t.title)}</strong>
      <span>${esc(p ? [stageName(d, p.stageId), p.title].filter(Boolean).join(' · ') : '')}</span>
      ${!compact && la ? `<span class="row-sub">Last activity: ${esc(la.summary)} · ${esc(timeAgo(la.at))}</span>` : ''}
      ${!compact && done && t.completedAt ? `<span class="row-sub">Done ${esc(fmtStamp(t.completedAt))}</span>` : ''}
    </div>
    ${p ? tempBadge(p.temperature) : ''}
    ${done ? '<span class="badge badge-good">Done</span>' : dueBadge(t.dueDate)}
    ${done ? '' : `<div class="row-actions">
      <button class="btn btn-sm btn-primary" data-act="fu-done" data-id="${t.id}">${icon('check')}Done</button>
      ${compact ? '' : `<button class="btn btn-sm" data-act="fu-reschedule" data-id="${t.id}">Reschedule</button>`}</div>`}
  </li>`;
}

/* ------------------------------------------------------------ prospects list */
function filteredProspects(scope) {
  const d = Store.data;
  const f = UI.filters[scope];
  return Object.values(d.prospects).filter(p => {
    if (scope === 'prospects') {
      if (f.seg === 'open' && !(p.lifecycle === 'active' && isOpen(p))) return false;
      if (f.seg === 'won' && !(p.lifecycle !== 'trashed' && p.outcome === 'won')) return false;
      if (f.seg === 'won' && f.clientStatus && ((p.client && p.client.status) || 'current') !== f.clientStatus) return false;
      if (f.seg === 'lost' && !(p.lifecycle !== 'trashed' && p.outcome === 'lost')) return false;
      if (f.seg === 'archived' && p.lifecycle !== 'archived') return false;
      if (f.seg === 'all' && p.lifecycle === 'trashed') return false;
      if (f.seg === 'active' && p.lifecycle !== 'active') return false;
    } else if (scope === 'pipeline') {
      if (p.lifecycle !== 'active') return false;
      if (isPastClient(p)) return false;
    }
    if (f.stage && p.stageId !== f.stage) return false;
    if (f.source && p.sourceId !== f.source) return false;
    if (f.service && p.serviceId !== f.service) return false;
    if (f.priority && p.priority !== f.priority) return false;
    if (f.temp && p.temperature !== f.temp) return false;
    if (f.tag && (p.tagIds || []).indexOf(f.tag) < 0) return false;
    if (f.from || f.to) {
      const v = f.dateField === 'followUp' ? (nextFollowUp(p.id) || {}).dueDate : dateOnly(p[f.dateField]);
      if (!v) return false;
      if (f.from && v < f.from) return false;
      if (f.to && v > f.to) return false;
    }
    return matchesQuery(d, p, f.q);
  });
}

function filtersActive(scope, keys) { return keys.some(k => UI.filters[scope][k]); }

VIEWS.prospects = function () {
  const d = Store.data;
  const f = UI.filters.prospects;
  const list = filteredProspects('prospects');
  const sortKey = f.sort, dir = f.dir === 'asc' ? 1 : -1;
  const val = p => {
    switch (sortKey) {
      case 'name': return prospectName(p).toLowerCase();
      case 'stage': return d.settings.stages.findIndex(s => s.id === p.stageId);
      case 'priority': return { high: 0, medium: 1, low: 2 }[p.priority];
      case 'temperature': return { hot: 0, warm: 1, cold: 2 }[p.temperature];
      case 'followUp': return (nextFollowUp(p.id) || {}).dueDate || '9999';
      case 'appliedDate': return p.appliedDate || '';
      case 'source': return sourceName(d, p.sourceId);
      case 'clientSince': return (p.client && p.client.since) || '';
      default: return p.updatedAt;
    }
  };
  list.sort((a, b) => { const x = val(a), y = val(b); return (x < y ? -1 : x > y ? 1 : 0) * dir; });
  const segs = [['open', 'Open'], ['won', 'Clients'], ['lost', 'Lost'], ['archived', 'Archived'], ['all', 'All']];
  const clientsView = f.seg === 'won';
  const segCount = s => { const save = [f.seg, f.clientStatus]; f.seg = s; f.clientStatus = ''; const n = filteredProspects('prospects').length; f.seg = save[0]; f.clientStatus = save[1]; return n; };
  const th = (key, label) => `<th><button class="th-sort${sortKey === key ? ' on' : ''}" data-act="sort" data-key="${key}">${label}${sortKey === key ? icon(f.dir === 'asc' ? 'up' : 'down') : ''}</button></th>`;
  const anyFilter = filtersActive('prospects', ['q', 'stage', 'source', 'service', 'priority', 'temp', 'tag', 'from', 'to']);

  return `${pageHead(clientsView ? 'Clients' : 'Prospects', clientsView ? 'Everyone you work with now or have worked with: clients won through your pipeline and clients you added yourself.' : 'Every opportunity you’re tracking, in one place.',
    clientsView ? `<button class="btn" data-act="new-prospect">${icon('plus')}Add prospect</button><button class="btn btn-primary" data-act="new-client">${icon('plus')}Add client</button>`
      : `<button class="btn" data-act="new-client">${icon('plus')}Add client</button><button class="btn btn-primary" data-act="new-prospect">${icon('plus')}Add prospect</button>`)}
  <div class="segs" role="tablist">${segs.map(([k, l]) => `<button role="tab" class="seg${f.seg === k ? ' on' : ''}" aria-selected="${f.seg === k}" data-act="filter-set" data-scope="prospects" data-key="seg" data-value="${k}">${l}<span>${segCount(k)}</span></button>`).join('')}</div>
  ${clientsView ? `<div class="chips-row" role="group" aria-label="Client status">${[['', 'All clients'], ['current', 'Current'], ['past', 'Past']].map(([k, l]) => `<button class="chip-btn${(f.clientStatus || '') === k ? ' on' : ''}" data-act="filter-set" data-scope="prospects" data-key="clientStatus" data-value="${k}">${l}</button>`).join('')}</div>` : ''}
  <div class="filters">
    <div class="finput">${icon('search')}<input id="f-prospects-q" type="search" placeholder="Filter by name, email, tag, date…" value="${attr(f.q)}" data-input="filter" data-scope="prospects" data-key="q" aria-label="Filter prospects"></div>
    ${clientsView ? '' : filterSelect('prospects', 'stage', stageOptions(d), 'Any stage')}
    ${filterSelect('prospects', 'source', d.settings.sources, 'Any source')}
    ${filterSelect('prospects', 'service', d.settings.services, 'Any service')}
    ${clientsView ? '' : filterSelect('prospects', 'priority', PRIORITIES, 'Any priority')}
    ${clientsView ? '' : filterSelect('prospects', 'temp', TEMPS, 'Any temperature')}
    ${filterSelect('prospects', 'tag', tagOptions(d), 'Any tag')}
    ${clientsView ? '' : `<div class="fdate">
      <select class="fsel" data-change="filter" data-scope="prospects" data-key="dateField" aria-label="Date to filter by">
        ${selectOpts([{ id: 'discoveredDate', label: 'Discovered' }, { id: 'appliedDate', label: 'Applied' }, { id: 'followUp', label: 'Follow-up' }, { id: 'proposalDate', label: 'Proposal' }], f.dateField)}
      </select>
      <input type="date" value="${attr(f.from)}" data-change="filter" data-scope="prospects" data-key="from" aria-label="From date">
      <span class="muted">to</span>
      <input type="date" value="${attr(f.to)}" data-change="filter" data-scope="prospects" data-key="to" aria-label="To date">
    </div>`}
    ${anyFilter ? `<button class="btn btn-sm btn-ghost" data-act="clear-filters" data-scope="prospects">${icon('x')}Clear filters</button>` : ''}
  </div>
  ${list.length ? `<div class="table-wrap"><table class="table ptable">
    <thead><tr>${clientsView ? `${th('name', 'Client')}<th>Status</th><th>Service</th>${th('source', 'Source')}${th('clientSince', 'Client since')}<th>Ended</th>${th('updatedAt', 'Updated')}`
      : `${th('name', 'Prospect')}${th('stage', 'Stage')}<th>Service</th>${th('source', 'Source')}${th('priority', 'Priority')}${th('temperature', 'Temp')}${th('followUp', 'Next follow-up')}${th('appliedDate', 'Applied')}${th('updatedAt', 'Updated')}`}</tr></thead>
    <tbody>${list.map(p => {
      const nf = nextFollowUp(p.id);
      if (clientsView) {
        const c = p.client || {};
        return `<tr data-act="open-prospect" data-id="${p.id}" tabindex="0">
        <td class="td-name">${monogram(p)}<div><strong>${esc(prospectName(p))}</strong><span>${esc(prospectSubtitle(p))}</span></div>${p.lifecycle === 'archived' ? lifecycleBadge(p) : ''}</td>
        <td data-label="Status">${clientBadge(p)}</td>
        <td data-label="Service">${esc(serviceName(d, p.serviceId))}</td>
        <td data-label="Source">${esc(sourceName(d, p.sourceId))}</td>
        <td data-label="Client since">${c.since ? esc(fmtDate(c.since, true)) : '<span class="muted">—</span>'}</td>
        <td data-label="Ended">${c.until ? esc(fmtDate(c.until, true)) : '<span class="muted">—</span>'}</td>
        <td data-label="Updated" class="muted">${esc(timeAgo(p.updatedAt))}</td>
      </tr>`;
      }
      return `<tr data-act="open-prospect" data-id="${p.id}" tabindex="0">
        <td class="td-name">${monogram(p)}<div><strong>${esc(prospectName(p))}</strong><span>${esc(prospectSubtitle(p))}</span>${(p.tagIds || []).length ? `<div class="tagrow">${tagChips(d, p.tagIds, 3)}</div>` : ''}</div>${lifecycleBadge(p)}</td>
        <td data-label="Stage">${stagePill(d, p)}</td>
        <td data-label="Service">${esc(serviceName(d, p.serviceId))}</td>
        <td data-label="Source">${esc(sourceName(d, p.sourceId))}</td>
        <td data-label="Priority">${prioBadge(p.priority)}</td>
        <td data-label="Temp">${tempBadge(p.temperature)}</td>
        <td data-label="Follow-up">${nf ? dueBadge(nf.dueDate) : '<span class="muted">—</span>'}</td>
        <td data-label="Applied">${p.appliedDate ? esc(fmtDate(p.appliedDate)) : '<span class="muted">—</span>'}</td>
        <td data-label="Updated" class="muted">${esc(timeAgo(p.updatedAt))}</td>
      </tr>`;
    }).join('')}</tbody></table></div>
    <p class="muted small table-foot">${plural(list.length, clientsView ? 'client' : 'prospect')}${anyFilter ? ' match your filters' : ''}.</p>`
    : (anyFilter ? emptyState('search', 'No prospects match these filters', 'Try removing a filter or searching for something shorter.', `<button class="btn" data-act="clear-filters" data-scope="prospects">Clear filters</button>`)
      : clientsView ? emptyState('trophy', 'No clients here yet', 'Clients you win through the pipeline appear here automatically. To record a client you already work with, or worked with before, use Add client.', `<button class="btn btn-primary" data-act="new-client">${icon('plus')}Add client</button>`)
      : emptyState('prospects', f.seg === 'won' ? 'No won clients yet' : f.seg === 'lost' ? 'Nothing lost yet' : f.seg === 'archived' ? 'Nothing archived' : 'No prospects yet',
        f.seg === 'open' || f.seg === 'all' ? 'Paste in the next job post or person you want to reach out to. Everything else — follow-ups, tasks, analytics — builds from here.' : '',
        f.seg === 'open' || f.seg === 'all' ? `<button class="btn btn-primary" data-act="new-prospect">${icon('plus')}Add prospect</button>` : ''))}`;
};

/* ------------------------------------------------------------ pipeline (kanban) */
VIEWS.pipeline = function () {
  const d = Store.data;
  const list = filteredProspects('pipeline');
  const anyFilter = filtersActive('pipeline', ['q', 'source', 'service', 'priority', 'temp', 'tag']);
  const layout = UI.filters.pipeline.layout === 'grid' ? 'grid' : 'board';
  const pr = { high: 0, medium: 1, low: 2 };
  const sorted = s => list.filter(p => p.stageId === s.id).sort((a, b) => pr[a.priority] - pr[b.priority] || b.updatedAt.localeCompare(a.updatedAt));
  const toggle = `<div class="seg-toggle" role="group" aria-label="Pipeline layout">
    <button class="${layout === 'board' ? 'on' : ''}" aria-pressed="${layout === 'board'}" data-act="filter-set" data-scope="pipeline" data-key="layout" data-value="board">${icon('pipeline')}Board</button>
    <button class="${layout === 'grid' ? 'on' : ''}" aria-pressed="${layout === 'grid'}" data-act="filter-set" data-scope="pipeline" data-key="layout" data-value="grid">${icon('tasks')}Grid</button></div>`;
  const filters = `<div class="filters">
    <div class="finput">${icon('search')}<input id="f-pipeline-q" type="search" placeholder="Filter…" value="${attr(UI.filters.pipeline.q)}" data-input="filter" data-scope="pipeline" data-key="q" aria-label="Filter pipeline"></div>
    ${filterSelect('pipeline', 'service', d.settings.services, 'Any service')}
    ${filterSelect('pipeline', 'source', d.settings.sources, 'Any source')}
    ${filterSelect('pipeline', 'priority', PRIORITIES, 'Any priority')}
    ${filterSelect('pipeline', 'temp', TEMPS, 'Any temperature')}
    ${filterSelect('pipeline', 'tag', tagOptions(d), 'Any tag')}
    ${anyFilter ? `<button class="btn btn-sm btn-ghost" data-act="clear-filters" data-scope="pipeline">${icon('x')}Clear</button>` : ''}
  </div>`;
  const head = pageHead('Pipeline', layout === 'board'
    ? 'Drag a card to move it through your process. Each move is recorded and can trigger automations.'
    : 'Every active opportunity in one table, grouped by stage. Change a stage right from the row.', toggle);
  if (layout === 'grid') return head + filters + pipelineGrid(d, sorted);
  const cols = d.settings.stages.map(s => {
    const cards = sorted(s);
    return `<section class="kcol stage-${s.key || 'custom'}" data-stage="${s.id}" aria-label="${attr(s.name)}">
      <header class="kcol-head"><span class="kcol-dot"></span><h2>${esc(s.name)}</h2><span class="kcol-n">${cards.length}</span>
        <button class="icon-btn sm" data-act="new-prospect" data-stage="${s.id}" aria-label="Add prospect to ${attr(s.name)}">${icon('plus')}</button></header>
      <div class="kcol-body" data-drop="${s.id}">
        ${cards.map(p => kcard(d, p)).join('') || `<div class="kcol-empty">${s.key === 'new' ? 'New opportunities land here.' : 'Drag a card here'}</div>`}
      </div></section>`;
  }).join('');
  return head + filters + `<div class="kanban" data-keep-scroll="kanban">${cols}</div>`;
};

/** Grid layout: one table, rows grouped by stage, stage editable inline. */
function pipelineGrid(d, sorted) {
  const collapsed = UI.gridCollapsed || (UI.gridCollapsed = {});
  const nextStep = p => {
    if (stageKeyOf(d, p) === 'interview' && p.interviewAt) return `<span class="due due-info">${icon('calendar')}Interview ${esc(fmtDateTime(p.interviewAt))}</span>`;
    const nf = nextFollowUp(p.id);
    if (nf) return dueBadge(nf.dueDate) + `<span class="g-sub">Follow-up</span>`;
    const t = tasksOf(p.id).filter(taskOpen).sort((a, b) => (a.dueDate || '9').localeCompare(b.dueDate || '9'))[0];
    if (t) return dueBadge(t.dueDate) + `<span class="g-sub">${esc(t.title)}</span>`;
    if (isClient(p)) return `<span class="muted">Client since ${esc(fmtDate((p.client || {}).since || p.wonDate))}</span>`;
    return '<span class="muted">—</span>';
  };
  const inStage = p => {
    const n = daysBetween(dateOnly(p.stageEnteredAt || p.createdAt), todayStr());
    return n === null ? '—' : n === 0 ? 'Today' : plural(n, 'day');
  };
  const groups = d.settings.stages.map(s => {
    const rows = sorted(s);
    const open = !collapsed[s.id];
    return `<tbody class="g-group stage-${s.key || 'custom'}">
      <tr class="g-head"><th colspan="8">
        <button class="g-toggle" data-act="grid-toggle" data-stage="${s.id}" aria-expanded="${open}">${icon(open ? 'down' : 'right')}<span class="kcol-dot"></span>${esc(s.name)}<span class="kcol-n">${rows.length}</span></button>
        <button class="icon-btn sm" data-act="new-prospect" data-stage="${s.id}" aria-label="Add prospect to ${attr(s.name)}">${icon('plus')}</button>
      </th></tr>
      ${open ? rows.map(p => {
        const la = lastActivity(p.id);
        return `<tr data-act="open-prospect" data-id="${p.id}" tabindex="0" class="prio-row-${p.priority}">
          <td class="g-name"><div class="g-name-in">${monogram(p)}<div><strong>${esc(prospectName(p))}</strong><span>${esc(prospectSubtitle(p))}</span></div></div></td>
          <td data-label="Stage"><select class="fsel sm" data-change="drawer-stage" data-id="${p.id}" aria-label="Stage for ${attr(prospectName(p))}">${selectOpts(stageOptions(d), p.stageId)}</select></td>
          <td data-label="Service">${esc(shortService(d, p.serviceId))}<span class="g-sub">${esc(sourceName(d, p.sourceId))}</span></td>
          <td data-label="Priority">${prioBadge(p.priority)}</td>
          <td data-label="Temp">${tempBadge(p.temperature)}</td>
          <td data-label="Next step" class="g-next">${nextStep(p)}</td>
          <td data-label="In stage" class="muted">${inStage(p)}</td>
          <td data-label="Last activity" class="muted">${la ? esc(timeAgo(la.at)) : '—'}</td>
        </tr>`;
      }).join('') : ''}
    </tbody>`;
  }).join('');
  if (!Object.keys(d.prospects).length) return emptyState('pipeline', 'Your pipeline is empty', 'Add the first opportunity you’re chasing and it will appear here.', `<button class="btn btn-primary" data-act="new-prospect">${icon('plus')}Add prospect</button>`);
  return `<div class="table-wrap"><table class="table gtable">
    <thead><tr><th>Prospect</th><th>Stage</th><th>Service · Source</th><th>Priority</th><th>Temp</th><th>Next step</th><th>In stage</th><th>Last activity</th></tr></thead>
    ${groups}</table></div>`;
}

function kcard(d, p) {
  const nf = nextFollowUp(p.id);
  const iv = p.interviewAt && stageKeyOf(d, p) === 'interview' ? p.interviewAt : null;
  return `<article class="kcard prio-edge-${p.priority}" draggable="true" data-drag="${p.id}" data-act="open-prospect" data-id="${p.id}" tabindex="0" aria-label="${attr(prospectName(p))}">
    <div class="kcard-top"><strong>${esc(prospectName(p))}</strong>${tempBadge(p.temperature)}</div>
    ${prospectSubtitle(p) ? `<div class="kcard-title${p.company ? '' : ' muted'}">${esc(prospectSubtitle(p))}</div>` : ''}
    <div class="kcard-meta"><span>${esc(shortService(d, p.serviceId))}</span>${sourceName(d, p.sourceId) ? `<span>${esc(sourceName(d, p.sourceId))}</span>` : ''}</div>
    ${(p.tagIds || []).length ? `<div class="tagrow">${tagChips(d, p.tagIds, 2)}</div>` : ''}
    <div class="kcard-foot">${prioBadge(p.priority)}
      ${iv ? `<span class="due due-info">${icon('calendar')}${esc(fmtDate(iv))}</span>` : nf ? dueBadge(nf.dueDate) : ''}</div>
  </article>`;
}
function shortService(d, id) {
  const n = serviceName(d, id);
  return n === 'Executive Assistance + Social Media' ? 'EA + Social' : n === 'Social Media Management' ? 'Social Media' : n;
}

/* ------------------------------------------------------------ follow-ups */
VIEWS.followups = function () {
  const d = Store.data;
  const fu = followUpBuckets(d);
  const noFu = prospectsWithoutFollowUp(d).sort((a, b) => ({ hot: 0, warm: 1, cold: 2 })[a.temperature] - ({ hot: 0, warm: 1, cold: 2 })[b.temperature]);
  const section = (title, list, tone, emptyText) => `
    <section class="panel fu-section">
      <div class="panel-head"><h2 class="${tone ? 'tone-' + tone : ''}">${tone === 'over' ? icon('alert') : ''}${esc(title)} <span class="count">${list.length}</span></h2></div>
      ${list.length ? `<ul class="rows">${list.map(t => followUpRow(d, t, false)).join('')}</ul>` : `<p class="muted pad">${emptyText}</p>`}
    </section>`;
  return `${pageHead('Follow-ups', 'Hot leads first within each day. Mark one done and schedule the next in a single step.')}
  ${section('Overdue', fu.overdue, 'over', 'You’re all caught up.')}
  ${section('Due today', fu.today, 'today', 'Nothing due today.')}
  ${noFu.length ? `<section class="panel fu-section">
    <div class="panel-head"><h2>No follow-up scheduled <span class="count">${noFu.length}</span></h2><span class="muted small">Active prospects you’ve contacted with nothing on the calendar</span></div>
    <ul class="rows">${noFu.map(p => `<li class="row">${monogram(p)}
      <div class="row-main" data-act="open-prospect" data-id="${p.id}"><strong>${esc(prospectName(p))}</strong><span>${esc([stageName(d, p.stageId), p.title].filter(Boolean).join(' · '))}</span></div>
      ${tempBadge(p.temperature)}
      <div class="row-actions"><button class="btn btn-sm" data-act="schedule-fu" data-id="${p.id}">${icon('calendar')}Schedule</button></div></li>`).join('')}</ul>
  </section>` : ''}
  ${section('Upcoming', fu.upcoming, '', 'No upcoming follow-ups.')}
  ${section('Completed · last 30 days', fu.completed, '', 'Completed follow-ups will show here.')}`;
};
