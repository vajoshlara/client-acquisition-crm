/* ============================================================ data model
 * One CRM "document" holds every entity. Records are keyed by id inside
 * collections so they can be merged record-by-record across devices.
 *
 *   prospects   contact + opportunity (GoHighLevel: Contact with one Opportunity)
 *   tasks       to-dos linked to a prospect (follow-ups are tasks of type follow_up)
 *   notes       free-text notes on a prospect
 *   activities  the timeline (append-only)
 *   workflows   automations: trigger -> steps (action / wait)
 *   jobs        a workflow run that is waiting (the "wait" step)
 *   settings    stages, sources, services, tags, custom fields, reasons, prefs
 *   tombstones  ids that were permanently deleted (so merges never resurrect them)
 */

const COLLECTIONS = ['prospects', 'tasks', 'notes', 'activities', 'jobs', 'workflows'];
const LEVEL = { applied: 1, replied: 2, interview: 3, proposal: 4, won: 5 };
const FUNNEL = [
  { key: 'applied', label: 'Applied' },
  { key: 'replied', label: 'Replied' },
  { key: 'interview', label: 'Interview' },
  { key: 'proposal', label: 'Proposal' },
  { key: 'won', label: 'Won' }
];
const PRIORITIES = [{ id: 'high', label: 'High' }, { id: 'medium', label: 'Medium' }, { id: 'low', label: 'Low' }];
const TEMPS = [{ id: 'hot', label: 'Hot', icon: 'flame' }, { id: 'warm', label: 'Warm', icon: 'sun' }, { id: 'cold', label: 'Cold', icon: 'snow' }];
const TASK_STATUS = [{ id: 'todo', label: 'To Do' }, { id: 'in_progress', label: 'In Progress' }, { id: 'done', label: 'Completed' }];
const TASK_TYPES = { general: 'Task', follow_up: 'Follow-up', interview_prep: 'Interview prep', onboarding: 'Onboarding', application: 'Application', research: 'Research' };
const ACTIVITY_LABELS = {
  created: 'Created', edited: 'Edited', stage_changed: 'Stage changed', note_added: 'Note added', note_edited: 'Note edited',
  note_deleted: 'Note deleted', task_created: 'Task created', task_completed: 'Task completed', task_updated: 'Task updated',
  application_submitted: 'Application submitted', email_logged: 'Email logged', message_logged: 'Message logged',
  call_logged: 'Call logged', interview_scheduled: 'Interview scheduled', interview_completed: 'Interview completed',
  proposal_sent: 'Proposal sent', follow_up_scheduled: 'Follow-up scheduled', follow_up_completed: 'Follow-up completed',
  won: 'Won', lost: 'Lost', reopened: 'Reopened', client_added: 'Client added', client_ended: 'Engagement ended', client_resumed: 'Engagement resumed', client_updated: 'Client details updated', archived: 'Archived', restored: 'Restored', deleted: 'Deleted', automation: 'Automation'
};
const LOGGABLE = ['email_logged', 'message_logged', 'call_logged', 'application_submitted', 'interview_completed', 'proposal_sent'];
const TAG_TONES = ['slate', 'blue', 'teal', 'green', 'amber', 'orange', 'rose', 'violet'];
const CUSTOM_FIELD_TYPES = { text: 'Text', number: 'Number', date: 'Date', url: 'Link', select: 'Dropdown' };

function slugId(prefix, name) {
  return prefix + '_' + String(name).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30);
}

const EPOCH = '1970-01-01T00:00:00.000Z'; // defaults never outrank real edits in a merge

function defaultSettings() {
  const tags = ['Executive Assistant', 'Social Media', 'High Potential', 'Remote', 'International', 'Urgent',
    'Follow-Up', 'Interview', 'Agency', 'Coach', 'E-commerce', 'Local Business'];
  const tones = ['teal', 'violet', 'green', 'slate', 'blue', 'rose', 'amber', 'violet', 'slate', 'orange', 'blue', 'green'];
  return {
    updatedAt: EPOCH,
    profile: { name: 'Joshua Lara' },
    stages: [
      { id: 'st_new', key: 'new', name: 'New Prospect' },
      { id: 'st_research', key: 'research', name: 'Researching' },
      { id: 'st_applied', key: 'applied', name: 'Applied / Contacted' },
      { id: 'st_replied', key: 'replied', name: 'Replied' },
      { id: 'st_follow_up', key: 'follow_up', name: 'Follow-Up' },
      { id: 'st_interview', key: 'interview', name: 'Discovery Call / Interview' },
      { id: 'st_proposal', key: 'proposal', name: 'Proposal / Offer' },
      { id: 'st_won', key: 'won', name: 'Won' },
      { id: 'st_lost', key: 'lost', name: 'Lost' }
    ],
    sources: ['Upwork', 'LinkedIn', 'Job Board', 'Direct Outreach', 'Referral', 'Facebook', 'Instagram', 'Other']
      .map(n => ({ id: slugId('src', n), name: n })),
    services: ['Executive Assistance', 'Social Media Management', 'Executive Assistance + Social Media', 'Other']
      .map(n => ({ id: slugId('svc', n), name: n })),
    tags: tags.map((n, i) => ({ id: slugId('tag', n), name: n, tone: tones[i] })),
    customFields: [],
    archiveReasons: ['Dropped', 'On Hold', 'Not currently hiring', 'Position paused', 'Application inactive', 'Other'],
    lostReasons: ['No response', 'Hired someone else', 'Budget too low', 'Rate mismatch', 'Not a good fit', 'Role cancelled or filled', 'Time zone mismatch', 'Other'],
    prefs: { defaultFollowUpDays: 3, upcomingDays: 7 }
  };
}

function defaultWorkflows() {
  const t = EPOCH;
  const wf = (id, name, stageKey, description, steps, exitOnStageChange) =>
    ({ id, name, system: true, enabled: true, updatedAt: t, description, trigger: { type: 'stage_entered', stageKey }, exitOnStageChange: !!exitOnStageChange, steps });
  return {
    wf_follow_up: wf('wf_follow_up', 'Follow-up sequence', 'follow_up',
      'Schedules a follow-up when a prospect enters Follow-Up. If they are still there after the wait and you have cleared the first follow-up, a second one is created.',
      [
        { type: 'create_task', title: 'Follow up with {name}', taskType: 'follow_up', due: { base: 'followUpDate', offset: 0 }, priority: 'inherit', ifOpen: 'reschedule', match: 'type' },
        { type: 'wait', days: 5 },
        { type: 'create_task', title: 'Second follow-up with {name}', taskType: 'follow_up', due: { base: 'today', offset: 0 }, priority: 'inherit', ifOpen: 'skip', match: 'type' }
      ], true),
    wf_interview: wf('wf_interview', 'Interview prep', 'interview',
      'Creates a high-priority prep task the day before the interview and puts the interview on your calendar.',
      [{ type: 'create_task', title: 'Prepare for interview with {name}', taskType: 'interview_prep', due: { base: 'interviewDate', offset: -1 }, priority: 'high', ifOpen: 'skip', match: 'type' }]),
    wf_proposal: wf('wf_proposal', 'Proposal follow-up', 'proposal',
      'Creates a follow-up task a few days after the proposal goes out.',
      [{ type: 'create_task', title: 'Follow up on proposal — {name}', taskType: 'follow_up', due: { base: 'today', offset: 3 }, priority: 'inherit', ifOpen: 'skip', match: 'workflow' }]),
    wf_won: wf('wf_won', 'Client won', 'won',
      'Records the win, closes open follow-ups and creates a client onboarding task.',
      [
        { type: 'close_tasks', taskTypes: ['follow_up', 'interview_prep'] },
        { type: 'create_task', title: 'Prepare client onboarding — {name}', taskType: 'onboarding', due: { base: 'today', offset: 1 }, priority: 'high', ifOpen: 'skip', match: 'type' }
      ]),
    wf_lost: wf('wf_lost', 'Opportunity lost', 'lost',
      'Records the loss and closes open follow-ups so they leave your lists.',
      [{ type: 'close_tasks', taskTypes: ['follow_up', 'interview_prep'] }])
  };
}

function newData() {
  const t = nowIso();
  return {
    schema: SCHEMA,
    meta: { createdAt: t, updatedAt: t },
    settings: defaultSettings(),
    prospects: {}, tasks: {}, notes: {}, activities: {}, jobs: {},
    workflows: defaultWorkflows(),
    tombstones: {}
  };
}

/** Fill gaps from older/partial data so the app never crashes on missing keys. */
function normalizeData(d) {
  if (!d || typeof d !== 'object') return newData();
  const def = defaultSettings();
  d.schema = d.schema || SCHEMA;
  d.meta = d.meta || { createdAt: nowIso(), updatedAt: nowIso() };
  COLLECTIONS.forEach(c => { if (!d[c] || typeof d[c] !== 'object') d[c] = {}; });
  d.tombstones = d.tombstones || {};
  d.settings = Object.assign({}, def, d.settings || {});
  d.settings.prefs = Object.assign({}, def.prefs, d.settings.prefs || {});
  d.settings.profile = Object.assign({}, def.profile, d.settings.profile || {});
  ['stages', 'sources', 'services', 'tags', 'customFields', 'archiveReasons', 'lostReasons'].forEach(k => {
    if (!Array.isArray(d.settings[k])) d.settings[k] = def[k];
  });
  // core stages must exist (they carry automation meaning)
  def.stages.forEach(s => { if (!d.settings.stages.some(x => x.key === s.key)) d.settings.stages.push(s); });
  const wfs = defaultWorkflows();
  Object.keys(wfs).forEach(id => { if (!d.workflows[id] && !d.tombstones[id]) d.workflows[id] = wfs[id]; });
  Object.values(d.prospects).forEach(p => {
    p.tagIds = Array.isArray(p.tagIds) ? p.tagIds : [];
    p.custom = p.custom || {};
    p.milestones = p.milestones || {};
    p.lifecycle = p.lifecycle || 'active';
    p.outcome = p.outcome || 'open';
    if (p.outcome === 'won' && !p.client) p.client = { status: 'current', since: p.wonDate || dateOnly(p.updatedAt), until: '' };
    if (p.outcome !== 'won' && p.client) p.client = null;
  });
  return d;
}

function touch(rec) { rec.updatedAt = nowIso(); return rec; }
function tombstone(d, id) { d.tombstones[id] = nowIso(); }
function actor(d) { return (d.settings.profile && d.settings.profile.name) || 'You'; }

/* ------------------------------------------------------------ lookups */
function stageById(d, id) { return d.settings.stages.find(s => s.id === id) || null; }
function stageByKey(d, key) { return d.settings.stages.find(s => s.key === key) || null; }
function stageKeyOf(d, p) { const s = stageById(d, p.stageId); return s ? s.key : null; }
function stageName(d, id) { const s = stageById(d, id); return s ? s.name : 'Unknown stage'; }
function sourceName(d, id) { const s = d.settings.sources.find(x => x.id === id); return s ? s.name : ''; }
function serviceName(d, id) { const s = d.settings.services.find(x => x.id === id); return s ? s.name : ''; }
function tagById(d, id) { return d.settings.tags.find(t => t.id === id) || null; }
function prospectName(p) { return (p && (p.company || p.contactName || p.title)) || 'Untitled prospect'; }
/** Second line under a prospect's name. A job post with no company named still reads clearly. */
function prospectSubtitle(p) {
  if (!p) return '';
  if (p.company) return p.title || p.contactName || '';
  if (p.contactName) return p.title || 'Company not disclosed';
  return 'Company not disclosed';
}
function isOpen(p) { return p.outcome !== 'won' && p.outcome !== 'lost'; }
function taskOpen(t) { return t.status === 'todo' || t.status === 'in_progress'; }

/** Indexes rebuilt once per data version. */
const Idx = { version: -1, tasksBy: {}, notesBy: {}, actsBy: {}, jobsBy: {} };
function buildIndex(d, version) {
  if (Idx.version === version) return Idx;
  const tasksBy = {}, notesBy = {}, actsBy = {}, jobsBy = {};
  const push = (m, k, v) => { if (!k) return; (m[k] || (m[k] = [])).push(v); };
  Object.values(d.tasks).forEach(t => push(tasksBy, t.prospectId, t));
  Object.values(d.notes).forEach(n => push(notesBy, n.prospectId, n));
  Object.values(d.activities).forEach(a => push(actsBy, a.prospectId, a));
  Object.values(d.jobs).forEach(j => push(jobsBy, j.prospectId, j));
  Object.values(notesBy).forEach(l => l.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  Object.values(actsBy).forEach(l => l.sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id)));
  Object.assign(Idx, { version, tasksBy, notesBy, actsBy, jobsBy });
  return Idx;
}
function tasksOf(pid) { return Idx.tasksBy[pid] || []; }
function notesOf(pid) { return Idx.notesBy[pid] || []; }
function activitiesOf(pid) { return Idx.actsBy[pid] || []; }
function nextFollowUp(pid) {
  const open = tasksOf(pid).filter(t => t.type === 'follow_up' && taskOpen(t)).sort((a, b) => (a.dueDate || '9').localeCompare(b.dueDate || '9'));
  return open[0] || null;
}
function lastActivity(pid) { const a = activitiesOf(pid); return a.length ? a[0] : null; }

/** A task shows in task lists only if it has no prospect or its prospect is active (not archived/trashed). */
function taskVisible(d, t) {
  if (!t.prospectId) return true;
  const p = d.prospects[t.prospectId];
  return !!p && p.lifecycle === 'active';
}

/* ------------------------------------------------------------ activity */
function logAct(d, pid, type, summary, extra) {
  const id = uid('ac');
  d.activities[id] = Object.assign({ id, prospectId: pid, type, summary, at: nowIso(), by: actor(d), updatedAt: nowIso() }, extra || {});
  return d.activities[id];
}

/* ------------------------------------------------------------ prospects */
const PROSPECT_FIELDS = ['company', 'contactName', 'email', 'phone', 'website', 'title', 'description', 'url', 'sourceId',
  'serviceId', 'industry', 'location', 'timeZone', 'discoveredDate', 'appliedDate', 'expectedRate', 'expectedBudget',
  'priority', 'temperature', 'interviewAt', 'proposalDate', 'lostReason', 'lostNote', 'tagIds', 'custom'];
const FIELD_LABELS = {
  company: 'Company / client', contactName: 'Contact person', email: 'Email', phone: 'Phone', website: 'Website',
  title: 'Opportunity title', description: 'Job description', url: 'Opportunity link', sourceId: 'Lead source',
  serviceId: 'Service', industry: 'Industry', location: 'Location', timeZone: 'Time zone', discoveredDate: 'Date discovered',
  appliedDate: 'Date applied', expectedRate: 'Expected rate', expectedBudget: 'Expected budget', priority: 'Priority',
  temperature: 'Temperature', interviewAt: 'Interview date', proposalDate: 'Proposal date', lostReason: 'Lost reason',
  lostNote: 'Lost note', tagIds: 'Tags', custom: 'Custom fields', followUpDate: 'Follow-up date', stageId: 'Stage'
};

function normalizeUrl(u) {
  u = String(u || '').trim();
  if (!u) return '';
  return /^https?:\/\//i.test(u) ? u : 'https://' + u;
}
function cleanFields(f) {
  const o = {};
  PROSPECT_FIELDS.forEach(k => { if (k in f) o[k] = f[k]; });
  ['company', 'contactName', 'email', 'phone', 'title', 'industry', 'location', 'timeZone', 'expectedRate', 'expectedBudget', 'lostNote']
    .forEach(k => { if (k in o) o[k] = String(o[k] || '').trim(); });
  if ('website' in o) o.website = normalizeUrl(o.website);
  if ('url' in o) o.url = normalizeUrl(o.url);
  if ('tagIds' in o) o.tagIds = Array.from(new Set(o.tagIds || []));
  return o;
}

function validateProspect(f) {
  const errors = {};
  if (!String(f.company || '').trim() && !String(f.title || '').trim() && !String(f.contactName || '').trim()) {
    errors.company = 'Add at least a job title (or a company or contact name) so you can find this later.';
  }
  if (f.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(f.email).trim())) errors.email = 'This email address looks incomplete.';
  return errors;
}

function findDuplicates(d, f, exceptId) {
  const url = normalizeUrl(f.url).toLowerCase();
  const comp = String(f.company || '').trim().toLowerCase();
  const title = String(f.title || '').trim().toLowerCase();
  return Object.values(d.prospects).filter(p => p.id !== exceptId && p.lifecycle !== 'trashed' && (
    (url && (p.url || '').toLowerCase() === url) ||
    (comp && title && (p.company || '').toLowerCase() === comp && (p.title || '').toLowerCase() === title)));
}

function createProspect(d, fields, ctx) {
  ctx = Object.assign({ followUpDate: fields.followUpDate || '', interviewAt: fields.interviewAt || '' }, ctx || {});
  const id = uid('p');
  const t = nowIso();
  const stage = stageById(d, fields.stageId) || d.settings.stages[0];
  const p = Object.assign({
    id, createdAt: t, updatedAt: t,
    company: '', contactName: '', email: '', phone: '', website: '', title: '', description: '', url: '',
    sourceId: d.settings.sources[0] && d.settings.sources[0].id, serviceId: d.settings.services[0] && d.settings.services[0].id,
    industry: '', location: '', timeZone: '', discoveredDate: todayStr(), appliedDate: '', expectedRate: '', expectedBudget: '',
    priority: 'medium', temperature: 'warm', interviewAt: '', proposalDate: '',
    outcome: 'open', wonDate: '', lostDate: '', lostReason: '', lostNote: '',
    tagIds: [], custom: {}, milestones: {}, stageId: stage.id, stageEnteredAt: t,
    lifecycle: 'active', archive: null, trash: null
  }, cleanFields(fields));
  d.prospects[id] = p;
  logAct(d, id, 'created', 'Prospect added' + (sourceName(d, p.sourceId) ? ' from ' + sourceName(d, p.sourceId) : ''));
  if (p.appliedDate) { p.milestones.applied = p.milestones.applied || t; }
  enterStage(d, p, stage, Object.assign({}, ctx, { initial: true }));
  if (fields.followUpDate && !nextFollowUpIn(d, id)) setFollowUp(d, id, fields.followUpDate);
  if (p.interviewAt && stage.key !== 'interview') logAct(d, id, 'interview_scheduled', 'Interview scheduled for ' + fmtDateTime(p.interviewAt));
  return p;
}

function nextFollowUpIn(d, pid) {
  return Object.values(d.tasks).filter(t => t.prospectId === pid && t.type === 'follow_up' && taskOpen(t))
    .sort((a, b) => (a.dueDate || '9').localeCompare(b.dueDate || '9'))[0] || null;
}

function describeValue(d, k, v) {
  if (v === '' || v == null || (Array.isArray(v) && !v.length)) return 'empty';
  if (k === 'sourceId') return sourceName(d, v);
  if (k === 'serviceId') return serviceName(d, v);
  if (k === 'stageId') return stageName(d, v);
  if (k === 'tagIds') return v.map(id => (tagById(d, id) || {}).name).filter(Boolean).join(', ');
  if (k === 'priority' || k === 'temperature') return cap(v);
  if (k === 'interviewAt') return fmtDateTime(v);
  if (/Date$/.test(k)) return fmtDate(v, true);
  if (k === 'description') return '(updated)';
  const s = String(v);
  return s.length > 40 ? s.slice(0, 40) + '…' : s;
}

function updateProspect(d, id, fields, ctx) {
  const p = d.prospects[id];
  if (!p) return null;
  const f = cleanFields(fields);
  const changes = [];
  Object.keys(f).forEach(k => {
    const before = p[k], after = f[k];
    if (JSON.stringify(before == null ? '' : before) === JSON.stringify(after == null ? '' : after)) return;
    if (k === 'custom') {
      changes.push('Custom fields updated');
    } else if (k !== 'lostNote') {
      changes.push(FIELD_LABELS[k] + ': ' + describeValue(d, k, before) + ' → ' + describeValue(d, k, after));
    }
    p[k] = after;
    if (k === 'appliedDate' && after) {
      p.milestones.applied = p.milestones.applied || nowIso();
      if (!before) logAct(d, id, 'application_submitted', 'Application submitted (' + fmtDate(after, true) + ')');
    }
    if (k === 'interviewAt' && after) logAct(d, id, 'interview_scheduled', 'Interview scheduled for ' + fmtDateTime(after));
  });
  if (changes.length) { touch(p); logAct(d, id, 'edited', 'Edited ' + plural(changes.length, 'field'), { detail: changes.join('\n') }); }
  if ('followUpDate' in fields) {
    const cur = nextFollowUpIn(d, id);
    const want = fields.followUpDate || '';
    if ((cur ? cur.dueDate : '') !== want) setFollowUp(d, id, want);
  }
  if (fields.stageId && fields.stageId !== p.stageId) moveStage(d, id, fields.stageId, ctx || {});
  return p;
}

/** Stage change: records the move, sets milestones/dates, then runs automations. */
function moveStage(d, id, stageId, ctx) {
  const p = d.prospects[id];
  const to = stageById(d, stageId);
  if (!p || !to || p.stageId === stageId) return p;
  const from = stageById(d, p.stageId);
  logAct(d, id, 'stage_changed', (from ? from.name : 'No stage') + ' → ' + to.name, { fromStage: p.stageId, toStage: stageId });
  // leaving an outcome stage reopens the opportunity
  if (from && (from.key === 'won' || from.key === 'lost') && to.key !== from.key) {
    if (from.key === 'won') { delete p.milestones.won; p.wonDate = ''; p.client = null; }
    if (from.key === 'lost') { delete p.milestones.lost; p.lostDate = ''; p.lostReason = ''; p.lostNote = ''; }
    p.outcome = 'open';
    logAct(d, id, 'reopened', 'Opportunity reopened');
  }
  enterStage(d, p, to, ctx || {});
  return p;
}

function enterStage(d, p, stage, ctx) {
  const t = nowIso(), today = todayStr();
  p.stageId = stage.id;
  p.stageEnteredAt = t;
  const key = stage.key;
  if (key && LEVEL[key] && !p.milestones[key]) p.milestones[key] = t;
  if (key === 'lost' && !p.milestones.lost) p.milestones.lost = t;
  switch (key) {
    case 'applied':
      if (!p.appliedDate) {
        p.appliedDate = ctx.appliedDate || today;
        logAct(d, p.id, 'application_submitted', 'Application submitted');
      }
      break;
    case 'interview':
      if (ctx.interviewAt) {
        p.interviewAt = ctx.interviewAt;
        logAct(d, p.id, 'interview_scheduled', 'Interview scheduled for ' + fmtDateTime(ctx.interviewAt));
      }
      break;
    case 'proposal':
      if (ctx.proposalDate || !p.proposalDate) {
        p.proposalDate = ctx.proposalDate || p.proposalDate || today;
        logAct(d, p.id, 'proposal_sent', 'Proposal sent');
      }
      break;
    case 'won':
      p.outcome = 'won';
      p.wonDate = ctx.wonDate || today;
      p.client = { status: ctx.clientStatus === 'past' ? 'past' : 'current', since: p.wonDate, until: ctx.clientStatus === 'past' ? (ctx.clientUntil || '') : '' };
      if (ctx.existingClient) logAct(d, p.id, 'client_added', 'Added as ' + (p.client.status === 'past' ? 'a past' : 'a current') + ' client (since ' + fmtDate(p.wonDate, true) + (p.client.until ? ', ended ' + fmtDate(p.client.until, true) : '') + ')');
      else logAct(d, p.id, 'won', 'Client won');
      break;
    case 'lost':
      p.outcome = 'lost';
      p.lostDate = today;
      p.lostReason = ctx.lostReason || '';
      p.lostNote = ctx.lostNote || '';
      logAct(d, p.id, 'lost', 'Opportunity lost' + (p.lostReason ? ' (' + p.lostReason + ')' : ''), p.lostNote ? { note: p.lostNote } : null);
      break;
  }
  touch(p);
  if (!ctx.skipAutomations) runTrigger(d, { type: 'stage_entered', stageKey: key, stageId: stage.id }, p, ctx);
}

/* ------------------------------------------------------------ clients (won opportunities, current or past) */
function isClient(p) { return p && p.outcome === 'won' && p.lifecycle !== 'trashed'; }
function isPastClient(p) { return isClient(p) && p.client && p.client.status === 'past'; }

/** Record a client you already have (or had) without running new-client automations.
 *  Marked "historical": it didn't come through the pipeline, so acquisition analytics leave it out. */
function createClient(d, fields) {
  const since = fields.clientSince || todayStr();
  const past = fields.clientStatus === 'past';
  const f = Object.assign({}, fields, { stageId: stageByKey(d, 'won').id, followUpDate: '' });
  if (!f.discoveredDate) f.discoveredDate = since;
  const p = createProspect(d, f, { skipAutomations: true, existingClient: true, wonDate: since, clientStatus: past ? 'past' : 'current', clientUntil: past ? (fields.clientUntil || '') : '' });
  p.historical = true;
  p.temperature = fields.temperature || 'warm';
  touch(p);
  return p;
}

function updateClientDetails(d, id, c) {
  const p = d.prospects[id];
  if (!p || p.outcome !== 'won') return;
  const before = JSON.stringify(p.client || {});
  const next = Object.assign({ status: 'current', since: p.wonDate || todayStr(), until: '' }, p.client || {});
  if (c.status) next.status = c.status === 'past' ? 'past' : 'current';
  if (c.since) next.since = c.since;
  if ('until' in c) next.until = next.status === 'past' ? (c.until || '') : '';
  if (next.status === 'current') next.until = '';
  if (JSON.stringify(next) === before) return;
  p.client = next;
  p.wonDate = next.since;
  touch(p);
  logAct(d, id, 'client_updated', 'Client details: ' + (next.status === 'past' ? 'past client' : 'current client') + ', since ' + fmtDate(next.since, true) + (next.until ? ', ended ' + fmtDate(next.until, true) : ''));
}

function setEngagement(d, id, status, date) {
  const p = d.prospects[id];
  if (!p || p.outcome !== 'won') return;
  p.client = Object.assign({ since: p.wonDate || todayStr() }, p.client || {});
  if (status === 'past') {
    p.client.status = 'past';
    p.client.until = date || todayStr();
    logAct(d, id, 'client_ended', 'Engagement ended ' + fmtDate(p.client.until, true));
    Object.values(d.tasks).filter(t => t.prospectId === id && taskOpen(t) && t.type === 'onboarding').forEach(t => setTaskStatus(d, t.id, 'cancelled'));
  } else {
    p.client.status = 'current';
    p.client.until = '';
    logAct(d, id, 'client_resumed', 'Working together again');
  }
  touch(p);
}

/* ------------------------------------------------------------ lifecycle: active -> archived -> trash */
function archiveProspect(d, id, reason, note) {
  const p = d.prospects[id];
  if (!p || p.lifecycle !== 'active') return;
  p.lifecycle = 'archived';
  p.archive = { at: nowIso(), reason: reason || 'Other', note: note || '' };
  touch(p);
  logAct(d, id, 'archived', 'Archived: ' + p.archive.reason, note ? { note } : null);
}
function restoreFromArchive(d, id) {
  const p = d.prospects[id];
  if (!p || p.lifecycle !== 'archived') return;
  p.lifecycle = 'active';
  p.archive = null;
  touch(p);
  logAct(d, id, 'restored', 'Restored from Archive to ' + stageName(d, p.stageId));
}
function trashProspect(d, id) {
  const p = d.prospects[id];
  if (!p || p.lifecycle === 'trashed') return;
  p.trash = { at: nowIso(), by: actor(d), from: p.lifecycle };
  p.lifecycle = 'trashed';
  touch(p);
  logAct(d, id, 'deleted', 'Moved to Trash');
}
function restoreFromTrash(d, id) {
  const p = d.prospects[id];
  if (!p || p.lifecycle !== 'trashed') return;
  const back = p.trash && p.trash.from === 'archived' ? 'archived' : 'active';
  p.lifecycle = back;
  p.trash = null;
  touch(p);
  logAct(d, id, 'restored', back === 'archived' ? 'Restored from Trash to Archive' : 'Restored from Trash to ' + stageName(d, p.stageId));
  return back;
}
/** Permanent: removes the prospect and everything linked to it. */
function purgeProspect(d, id) {
  if (!d.prospects[id]) return;
  ['tasks', 'notes', 'activities', 'jobs'].forEach(c => {
    Object.keys(d[c]).forEach(k => { if (d[c][k].prospectId === id) { delete d[c][k]; tombstone(d, k); } });
  });
  delete d.prospects[id];
  tombstone(d, id);
}
function emptyTrash(d) {
  const ids = Object.values(d.prospects).filter(p => p.lifecycle === 'trashed').map(p => p.id);
  ids.forEach(id => purgeProspect(d, id));
  return ids.length;
}

/* ------------------------------------------------------------ notes */
function addNote(d, pid, body) {
  const id = uid('n'), t = nowIso();
  d.notes[id] = { id, prospectId: pid, body: String(body).trim(), author: actor(d), createdAt: t, updatedAt: t };
  logAct(d, pid, 'note_added', 'Note added', { note: d.notes[id].body.slice(0, 280) });
  if (d.prospects[pid]) touch(d.prospects[pid]);
  return d.notes[id];
}
function editNote(d, id, body) {
  const n = d.notes[id];
  if (!n) return;
  n.body = String(body).trim();
  n.editedAt = nowIso();
  touch(n);
  logAct(d, n.prospectId, 'note_edited', 'Note edited');
}
function deleteNote(d, id) {
  const n = d.notes[id];
  if (!n) return;
  delete d.notes[id];
  tombstone(d, id);
  logAct(d, n.prospectId, 'note_deleted', 'Note deleted');
}

/* ------------------------------------------------------------ tasks & follow-ups */
function createTask(d, f, opts) {
  opts = opts || {};
  const id = opts.id || uid('tk'), t = nowIso();
  const task = {
    id, title: String(f.title || 'Untitled task').trim(), dueDate: f.dueDate || '', priority: f.priority || 'medium',
    prospectId: f.prospectId || null, status: f.status || 'todo', notes: f.notes || '', type: f.type || 'general',
    source: opts.source || 'manual', createdAt: t, completedAt: f.status === 'done' ? t : null, updatedAt: t
  };
  d.tasks[id] = task;
  if (task.prospectId && !opts.silent) {
    logAct(d, task.prospectId, task.type === 'follow_up' ? 'follow_up_scheduled' : 'task_created',
      (task.type === 'follow_up' ? 'Follow-up scheduled' : 'Task created') + ': ' + task.title + (task.dueDate ? ' (due ' + fmtDate(task.dueDate, true) + ')' : ''),
      opts.via ? { via: opts.via } : null);
  }
  return task;
}
function updateTask(d, id, f) {
  const t = d.tasks[id];
  if (!t) return;
  const wasOpen = taskOpen(t);
  ['title', 'dueDate', 'priority', 'prospectId', 'notes', 'type'].forEach(k => { if (k in f) t[k] = f[k]; });
  if ('status' in f && f.status !== t.status) setTaskStatus(d, id, f.status);
  else if (t.prospectId && wasOpen) logAct(d, t.prospectId, 'task_updated', 'Task updated: ' + t.title);
  touch(t);
}
function setTaskStatus(d, id, status, note) {
  const t = d.tasks[id];
  if (!t || t.status === status) return;
  t.status = status;
  t.completedAt = status === 'done' ? nowIso() : null;
  if (status === 'cancelled') t.cancelledAt = nowIso();
  touch(t);
  if (t.prospectId && status === 'done') {
    logAct(d, t.prospectId, t.type === 'follow_up' ? 'follow_up_completed' : 'task_completed',
      (t.type === 'follow_up' ? 'Follow-up done: ' : 'Task completed: ') + t.title, note ? { note } : null);
  }
}
function deleteTask(d, id) {
  const t = d.tasks[id];
  if (!t) return;
  delete d.tasks[id];
  tombstone(d, id);
}
/** Set (or clear) the prospect's next follow-up date. One open follow-up task carries the date. */
function setFollowUp(d, pid, date) {
  const p = d.prospects[pid];
  if (!p) return;
  const cur = nextFollowUpIn(d, pid);
  if (!date) {
    if (cur) { setTaskStatus(d, cur.id, 'cancelled'); logAct(d, pid, 'follow_up_scheduled', 'Follow-up cleared'); }
    return;
  }
  if (cur) {
    const was = cur.dueDate;
    cur.dueDate = date;
    touch(cur);
    logAct(d, pid, 'follow_up_scheduled', 'Follow-up moved from ' + fmtDate(was, true) + ' to ' + fmtDate(date, true));
  } else {
    createTask(d, { title: 'Follow up with ' + prospectName(p), dueDate: date, type: 'follow_up', priority: p.priority, prospectId: pid });
  }
  touch(p);
}
/** Mark a follow-up done and optionally schedule the next one in one step. */
function completeFollowUp(d, taskId, note, nextDate) {
  const t = d.tasks[taskId];
  if (!t) return;
  setTaskStatus(d, taskId, 'done', note);
  if (nextDate && t.prospectId && d.prospects[t.prospectId]) {
    const p = d.prospects[t.prospectId];
    createTask(d, { title: 'Follow up with ' + prospectName(p), dueDate: nextDate, type: 'follow_up', priority: p.priority, prospectId: p.id });
  }
}

/* ------------------------------------------------------------ automation engine
 * TRIGGER -> ACTION -> WAIT -> ACTION. A wait step saves a "job" with a run time;
 * jobs are processed on open and every minute. Ids produced by a run are
 * deterministic, so two devices running the same job produce the same task. */
function fillTemplate(s, p) { return String(s).replace(/\{name\}/g, prospectName(p)); }

function runTrigger(d, trigger, p, ctx) {
  Object.values(d.workflows).forEach(wf => {
    if (!wf.enabled || !wf.trigger || wf.trigger.type !== trigger.type) return;
    if (wf.trigger.stageKey && wf.trigger.stageKey !== trigger.stageKey) return;
    if (wf.trigger.stageId && wf.trigger.stageId !== trigger.stageId) return;
    runSteps(d, wf, p, 0, uid('run'), ctx || {}, p.stageId);
  });
}

function computeDue(d, step, p, ctx) {
  const today = todayStr();
  let base = today;
  if (step.due && step.due.base === 'followUpDate') base = ctx.followUpDate || addDays(today, d.settings.prefs.defaultFollowUpDays);
  if (step.due && step.due.base === 'interviewDate') base = dateOnly(p.interviewAt) || today;
  let due = addDays(base, (step.due && step.due.offset) || 0);
  if (due < today) due = today;
  return due;
}

function runSteps(d, wf, p, start, runId, ctx, stageAtStart) {
  for (let i = start; i < wf.steps.length; i++) {
    const step = wf.steps[i];
    if (step.type === 'wait') {
      const id = 'jb_' + runId + '_' + i;
      d.jobs[id] = {
        id, workflowId: wf.id, prospectId: p.id, stepIndex: i + 1, runId, stageAtStart,
        runAt: new Date(nowMs() + Math.max(0, Number(step.days) || 0) * 86400000).toISOString(),
        createdAt: nowIso(), updatedAt: nowIso()
      };
      return;
    }
    if (step.type === 'create_task') {
      const due = computeDue(d, step, p, ctx);
      const open = Object.values(d.tasks).filter(t => t.prospectId === p.id && taskOpen(t) && t.type === step.taskType &&
        (step.match !== 'workflow' || t.source === 'wf:' + wf.id)).sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''));
      if (open.length && step.ifOpen === 'skip') continue;
      if (open.length && step.ifOpen === 'reschedule') {
        if (ctx.followUpDate && open[0].dueDate !== due) {
          const was = open[0].dueDate;
          open[0].dueDate = due; touch(open[0]);
          logAct(d, p.id, 'follow_up_scheduled', 'Follow-up moved from ' + fmtDate(was, true) + ' to ' + fmtDate(due, true), { via: wf.name });
        }
        continue;
      }
      const title = fillTemplate(step.title, p);
      createTask(d, { title, dueDate: due, type: step.taskType, prospectId: p.id, priority: step.priority === 'inherit' ? p.priority : step.priority },
        { id: 'tk_' + runId + '_' + i, source: 'wf:' + wf.id, via: wf.name });
    }
    if (step.type === 'close_tasks') {
      const closed = Object.values(d.tasks).filter(t => t.prospectId === p.id && taskOpen(t) && (step.taskTypes || []).indexOf(t.type) >= 0);
      closed.forEach(t => setTaskStatus(d, t.id, 'cancelled'));
      if (closed.length) logAct(d, p.id, 'automation', wf.name + ': closed ' + plural(closed.length, 'open task'), { via: wf.name });
    }
  }
}

function processDueJobs(d) {
  const now = nowMs();
  let ran = 0;
  Object.values(d.jobs).forEach(job => {
    if (new Date(job.runAt).getTime() > now) return;
    delete d.jobs[job.id];
    tombstone(d, job.id);
    ran++;
    const wf = d.workflows[job.workflowId];
    const p = d.prospects[job.prospectId];
    if (!wf || !wf.enabled || !p || p.lifecycle !== 'active') return;
    if (wf.exitOnStageChange && p.stageId !== job.stageAtStart) return;
    runSteps(d, wf, p, job.stepIndex, job.runId, {}, job.stageAtStart);
  });
  return ran;
}

function describeStep(d, s) {
  if (s.type === 'wait') return { kind: 'Wait', text: plural(Number(s.days) || 0, 'day') };
  if (s.type === 'close_tasks') return { kind: 'Action', text: 'Close open ' + (s.taskTypes || []).map(t => TASK_TYPES[t].toLowerCase()).join(' and ') + ' tasks' };
  if (s.type === 'create_task') {
    let when = '';
    const off = (s.due && s.due.offset) || 0;
    if (s.due && s.due.base === 'followUpDate') when = 'on the follow-up date you pick';
    else if (s.due && s.due.base === 'interviewDate') when = off === -1 ? 'the day before the interview' : 'on the interview date' + (off ? ' ' + (off > 0 ? '+' : '') + off + 'd' : '');
    else when = off === 0 ? 'due today' : 'due in ' + plural(off, 'day');
    const guard = s.ifOpen === 'skip' ? ' (skipped if one is already open)' : s.ifOpen === 'reschedule' ? ' (moves the open one instead of duplicating)' : '';
    return { kind: 'Action', text: 'Create task “' + s.title.replace('{name}', '[Prospect]') + '”, ' + when + guard };
  }
  return { kind: 'Step', text: s.type };
}

/* ------------------------------------------------------------ metrics & analytics */
function funnelLevel(p) {
  let lvl = 0;
  const m = p.milestones || {};
  Object.keys(LEVEL).forEach(k => { if (m[k]) lvl = Math.max(lvl, LEVEL[k]); });
  if (p.appliedDate) lvl = Math.max(lvl, 1);
  if (p.outcome === 'won') lvl = 5;
  return lvl;
}
function milestoneDate(p, key) {
  const m = p.milestones || {};
  if (key === 'applied' && p.appliedDate) return p.appliedDate;
  if (key === 'won' && p.wonDate) return p.wonDate;
  if (m[key]) return dateOnly(m[key]);
  if (funnelLevel(p) < LEVEL[key]) return null;
  const later = FUNNEL.filter(f => LEVEL[f.key] > LEVEL[key])
    .map(f => (f.key === 'won' && p.wonDate) ? p.wonDate : (m[f.key] ? dateOnly(m[f.key]) : null))
    .filter(Boolean).sort();
  return later[0] || (p.appliedDate || null);
}

function liveProspects(d) { return Object.values(d.prospects).filter(p => p.lifecycle !== 'trashed'); }
/** Prospects that went through your acquisition process (excludes clients you added after the fact). */
function acqProspects(d) { return liveProspects(d).filter(p => !p.historical); }

function followUpBuckets(d) {
  const today = todayStr();
  const items = Object.values(d.tasks).filter(t => t.type === 'follow_up' && taskVisible(d, t)).filter(t => {
    if (!t.prospectId) return true;
    return isOpen(d.prospects[t.prospectId]);
  });
  const open = items.filter(taskOpen);
  const tRank = t => { const p = t.prospectId && d.prospects[t.prospectId]; return p ? ({ hot: 0, warm: 1, cold: 2 })[p.temperature] : 3; };
  const sorter = (a, b) => (a.dueDate || '9').localeCompare(b.dueDate || '9') || tRank(a) - tRank(b);
  const cutoff = addDays(today, -30);
  return {
    overdue: open.filter(t => t.dueDate && t.dueDate < today).sort(sorter),
    today: open.filter(t => t.dueDate === today).sort(sorter),
    upcoming: open.filter(t => !t.dueDate || t.dueDate > today).sort(sorter),
    completed: items.filter(t => t.status === 'done' && dateOnly(t.completedAt) >= cutoff).sort((a, b) => b.completedAt.localeCompare(a.completedAt))
  };
}

/** Active, open prospects past the research stage that have no follow-up scheduled. */
function prospectsWithoutFollowUp(d) {
  return Object.values(d.prospects).filter(p => p.lifecycle === 'active' && isOpen(p) &&
    ['applied', 'replied', 'follow_up', 'proposal'].indexOf(stageKeyOf(d, p)) >= 0 && !nextFollowUp(p.id));
}

function taskBuckets(d) {
  const today = todayStr();
  const upTo = addDays(today, d.settings.prefs.upcomingDays || 7);
  const vis = Object.values(d.tasks).filter(t => taskVisible(d, t));
  const open = vis.filter(taskOpen);
  const pr = { high: 0, medium: 1, low: 2 };
  const s = (a, b) => (a.dueDate || '9').localeCompare(b.dueDate || '9') || (pr[a.priority] - pr[b.priority]);
  return {
    today: open.filter(t => t.dueDate === today).sort(s),
    overdue: open.filter(t => t.dueDate && t.dueDate < today).sort(s),
    upcoming: open.filter(t => !t.dueDate || t.dueDate > today).sort(s),
    upcomingSoon: open.filter(t => t.dueDate > today && t.dueDate <= upTo).sort(s),
    completed: vis.filter(t => t.status === 'done').sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || '')),
    open: open.sort(s)
  };
}

function upcomingInterviews(d) {
  const now = new Date(nowMs());
  return Object.values(d.prospects).filter(p => p.lifecycle === 'active' && isOpen(p) && p.interviewAt)
    .filter(p => { const dt = parseLocalDateTime(p.interviewAt); return dt && dt.getTime() >= now.getTime() - 3600000; })
    .sort((a, b) => a.interviewAt.localeCompare(b.interviewAt));
}

function computeMetrics(d) {
  const live = acqProspects(d);
  const reached = lvl => live.filter(p => funnelLevel(p) >= lvl).length;
  const fu = followUpBuckets(d);
  const tb = taskBuckets(d);
  const m = {
    total: live.length,
    active: live.filter(p => p.lifecycle === 'active' && isOpen(p)).length,
    applications: reached(1), replies: reached(2), interviews: reached(3), proposals: reached(4),
    won: live.filter(p => p.outcome === 'won').length,
    lost: live.filter(p => p.outcome === 'lost').length,
    followUpsToday: fu.today.length, followUpsOverdue: fu.overdue.length,
    upcomingInterviews: upcomingInterviews(d).length,
    overdueTasks: tb.overdue.length, tasksToday: tb.today.length,
    archived: Object.values(d.prospects).filter(p => p.lifecycle === 'archived').length,
    trashed: Object.values(d.prospects).filter(p => p.lifecycle === 'trashed').length,
    clientsCurrent: liveProspects(d).filter(p => isClient(p) && !isPastClient(p)).length,
    clientsPast: liveProspects(d).filter(isPastClient).length,
    historical: liveProspects(d).filter(p => p.historical).length
  };
  m.conv = [
    { label: 'Application → Reply', n: m.replies, d: m.applications, hint: 'Replies ÷ applications' },
    { label: 'Reply → Interview', n: m.interviews, d: m.replies, hint: 'Interviews ÷ replies' },
    { label: 'Interview → Proposal', n: m.proposals, d: m.interviews, hint: 'Proposals ÷ interviews' },
    { label: 'Proposal → Won', n: m.won, d: m.proposals, hint: 'Won ÷ proposals' },
    { label: 'Overall', n: m.won, d: m.applications, hint: 'Won ÷ applications' }
  ];
  return m;
}

function groupCount(list, keyFn, names) {
  const map = {};
  list.forEach(p => { const k = keyFn(p) || '—'; map[k] = (map[k] || 0) + 1; });
  return Object.keys(map).map(k => ({ key: k, label: names ? names(k) : k, value: map[k] })).sort((a, b) => b.value - a.value);
}

function conversionBy(d, field) {
  const live = acqProspects(d);
  const list = field === 'sourceId' ? d.settings.sources : d.settings.services;
  const rows = list.map(item => {
    const ps = live.filter(p => p[field] === item.id);
    const r = lvl => ps.filter(p => funnelLevel(p) >= lvl).length;
    return {
      key: item.id, label: item.name, total: ps.length, applications: r(1), replies: r(2), interviews: r(3), proposals: r(4),
      won: ps.filter(p => p.outcome === 'won').length
    };
  }).filter(r => r.total > 0);
  return rows.sort((a, b) => b.total - a.total);
}

function monthKeysBack(n) {
  const out = [];
  const d = new Date(nowMs());
  d.setDate(1);
  for (let i = n - 1; i >= 0; i--) {
    const x = new Date(d.getFullYear(), d.getMonth() - i, 1);
    out.push(x.getFullYear() + '-' + pad2(x.getMonth() + 1));
  }
  return out;
}
function monthlySeries(d, months) {
  const keys = monthKeysBack(months);
  const live = acqProspects(d);
  const series = {};
  FUNNEL.forEach(f => {
    const counts = {};
    keys.forEach(k => { counts[k] = 0; });
    live.forEach(p => { const md = milestoneDate(p, f.key); const k = monthKey(md); if (k in counts && (f.key !== 'won' || p.outcome === 'won')) counts[k]++; });
    series[f.key] = keys.map(k => ({ key: k, label: monthLabel(k), value: counts[k] }));
  });
  return series;
}

function insights(d) {
  const live = acqProspects(d);
  const out = [];
  if (live.length < 3) {
    return [{ tone: 'neutral', text: 'Add a few more prospects and this space will tell you which sources and services are working for you.' }];
  }
  const src = groupCount(live, p => p.sourceId, k => sourceName(d, k) || 'No source');
  if (src.length) {
    const top = src[0];
    let text = top.label + ' brought in ' + pct(top.value, live.length) + '% of your opportunities (' + top.value + ' of ' + live.length + ').';
    const conv = conversionBy(d, 'sourceId').filter(r => r.applications >= 2);
    if (conv.length >= 2) {
      const best = conv.slice().sort((a, b) => (b.interviews / b.applications) - (a.interviews / a.applications))[0];
      if (best.interviews > 0) {
        text += best.key === top.key
          ? ' It also has your best interview rate (' + fmtPct(best.interviews, best.applications) + ').'
          : ' But ' + best.label + ' has the highest interview rate: ' + best.interviews + ' of ' + best.applications + ' applications (' + fmtPct(best.interviews, best.applications) + ').';
      }
    }
    out.push({ tone: 'info', text });
  }
  const svc = groupCount(live, p => p.serviceId, k => serviceName(d, k) || 'No service');
  if (svc.length) out.push({ tone: 'info', text: svc[0].label + ' accounts for ' + svc[0].value + ' of ' + live.length + ' opportunities.' });
  const m = computeMetrics(d);
  const weak = m.conv.slice(0, 4).filter(c => c.d >= 3).map(c => Object.assign({ rate: c.n / c.d }, c)).sort((a, b) => a.rate - b.rate)[0];
  if (weak) {
    const tips = {
      'Application → Reply': 'Tailoring the first two lines and following up after 3–5 days usually moves this most.',
      'Reply → Interview': 'Suggesting two specific call times in your reply often helps.',
      'Interview → Proposal': 'Ending each call with an agreed next step usually helps.',
      'Proposal → Won': 'A follow-up 2–3 days after the proposal is often what closes it.'
    };
    out.push({ tone: 'warn', text: 'Your biggest drop-off is ' + weak.label + ' (' + fmtPct(weak.n, weak.d) + '). ' + (tips[weak.label] || '') });
  }
  const lost = live.filter(p => p.outcome === 'lost');
  const lr = groupCount(lost, p => p.lostReason || 'No reason given');
  if (lost.length >= 2 && lr.length) out.push({ tone: 'neutral', text: 'Most lost opportunities ended with “' + lr[0].label + '” (' + lr[0].value + ' of ' + lost.length + ').' });
  const hotNoFu = prospectsWithoutFollowUp(d).filter(p => p.temperature === 'hot');
  if (hotNoFu.length) out.push({ tone: 'warn', text: plural(hotNoFu.length, 'hot lead') + ' ' + (hotNoFu.length === 1 ? 'has' : 'have') + ' no follow-up scheduled.', action: 'followups' });
  return out;
}

/* ------------------------------------------------------------ search */
function prospectHaystack(d, p) {
  return [p.company, p.contactName, p.title, p.email, p.website, p.url, p.industry, p.location, sourceName(d, p.sourceId),
    serviceName(d, p.serviceId), stageName(d, p.stageId), p.priority, p.temperature, p.discoveredDate, p.appliedDate,
    fmtDate(p.appliedDate, true), fmtDate(p.discoveredDate, true),
    (p.tagIds || []).map(id => (tagById(d, id) || {}).name).join(' ')].join(' \u0001 ').toLowerCase();
}
function matchesQuery(d, p, q) {
  q = String(q || '').trim().toLowerCase();
  if (!q) return true;
  const hay = prospectHaystack(d, p);
  return q.split(/\s+/).every(term => hay.indexOf(term) >= 0);
}

/* ------------------------------------------------------------ merge (conflicts between tabs/devices)
 * Per record, the newer updatedAt wins. Tombstones (permanent deletes) always win. */
function mergeData(local, remote) {
  local = normalizeData(clone(local));
  remote = normalizeData(clone(remote));
  const out = { schema: SCHEMA, meta: {}, tombstones: {} };
  [local.tombstones, remote.tombstones].forEach(t => Object.keys(t).forEach(k => {
    if (!out.tombstones[k] || t[k] > out.tombstones[k]) out.tombstones[k] = t[k];
  }));
  COLLECTIONS.forEach(c => {
    out[c] = {};
    const ids = new Set(Object.keys(local[c]).concat(Object.keys(remote[c])));
    ids.forEach(id => {
      if (out.tombstones[id]) return;
      const a = local[c][id], b = remote[c][id];
      out[c][id] = !a ? b : !b ? a : ((a.updatedAt || '') > (b.updatedAt || '') ? a : b);
    });
  });
  out.settings = (local.settings.updatedAt || '') > (remote.settings.updatedAt || '') ? local.settings : remote.settings;
  out.meta = { createdAt: [local.meta.createdAt, remote.meta.createdAt].filter(Boolean).sort()[0] || nowIso(), updatedAt: nowIso() };
  return out;
}

function dataCounts(d) {
  const ps = Object.values(d.prospects);
  return {
    prospects: ps.length,
    active: ps.filter(p => p.lifecycle === 'active').length,
    archived: ps.filter(p => p.lifecycle === 'archived').length,
    trashed: ps.filter(p => p.lifecycle === 'trashed').length,
    tasks: Object.keys(d.tasks).length,
    notes: Object.keys(d.notes).length,
    activities: Object.keys(d.activities).length
  };
}
