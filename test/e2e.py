"""End-to-end tests: the real app + real Code.gs against a simulated Google Drive."""
import json, sys, time
from playwright.sync_api import sync_playwright

BASE = 'http://localhost:8765/'
import os
SHOTS = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'shots') + os.sep
os.makedirs(SHOTS, exist_ok=True)
passed, failed = 0, []

def check(cond, msg):
    global passed
    if cond: passed += 1
    else: failed.append(msg); print('FAIL:', msg)

def new_page(ctx, url='index.html', width=1440, height=900):
    pg = ctx.new_page()
    pg.set_viewport_size({'width': width, 'height': height})
    pg.route('**/fonts.googleapis.com/**', lambda r: r.abort())
    pg.route('**/fonts.gstatic.com/**', lambda r: r.abort())
    pg.errors = []
    pg.on('pageerror', lambda e: pg.errors.append(str(e)))
    pg.on('console', lambda m: pg.errors.append(m.text) if m.type == 'error' and 'ERR_FAILED' not in m.text else None)
    pg.goto(url if url.startswith('http') else BASE + url)
    return pg

def js(pg, code, arg=None):
    return pg.evaluate(code, arg)

def wait_synced(pg, timeout=15):
    end = time.time() + timeout
    while time.time() < end:
        st = js(pg, '({s: CRM.Sync.status, d: CRM.Sync.dirty, f: CRM.Sync.inFlight})')
        if st['s'] == 'synced' and not st['d'] and not st['f']: return True
        pg.wait_for_timeout(200)
    return False

def states_on_drive(pg):
    return js(pg, "Object.values(__env._files).filter(f => !f.trashed && /^crm_state_/.test(f.name)).length")

def prospect_by_company(pg, name):
    return js(pg, "n => Object.values(CRM.Store.data.prospects).find(p => p.company === n) || null", name)

def tasks_for(pg, pid):
    return js(pg, "id => Object.values(CRM.Store.data.tasks).filter(t => t.prospectId === id)", pid)

def modal_submit(pg):
    pg.locator('.modal-wrap .modal-foot button[type=submit]').last.click()

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context()
    pg = new_page(ctx)
    pg.wait_for_selector('.today-line')
    check(wait_synced(pg), 'initial bootstrap creates and confirms state #1')
    check(states_on_drive(pg) == 1, 'one state on Drive after first open')
    check('Connected ✓' in pg.inner_text('#sync'), 'sidebar shows Google Drive: Connected ✓')
    check('Last synced' in pg.inner_text('#sync'), 'sidebar shows Last synced')

    # ---------- add a prospect through the form
    pg.click('.topbar [data-act=new-prospect]')
    pg.wait_for_selector('#pform')
    pg.click('#pform button[type=submit]')
    check(pg.locator('#pform .field-error').count() >= 1, 'empty form shows a validation message')
    pg.fill('#pform [name=company]', 'Acme Coaching')
    pg.fill('#pform [name=title]', 'Executive Assistant')
    pg.fill('#pform [name=contactName]', 'Jamie Cruz')
    pg.fill('#pform [name=email]', 'jamie@acme.example')
    pg.select_option('#pform [name=sourceId]', 'src_linkedin')
    pg.select_option('#pform [name=serviceId]', 'svc_executive_assistance')
    pg.click('#pform .r-priority-high input')
    pg.click('#pform .r-temperature-hot input')
    pg.locator('#pform .tag-pick', has_text='Remote').locator('span').click()
    pg.fill('#pform [name=firstNote]', 'Found via LinkedIn post; mentions ClickUp.')
    pg.click('#pform button[type=submit]')
    pg.wait_for_selector('.drawer .dr-tabs')
    acme = prospect_by_company(pg, 'Acme Coaching')
    check(acme is not None and acme['priority'] == 'high' and acme['temperature'] == 'hot', 'prospect saved with priority & temperature')
    check(acme and 'tag_remote' in acme['tagIds'], 'tag saved')
    check(js(pg, "id => Object.values(CRM.Store.data.notes).filter(n => n.prospectId === id).length", acme['id']) == 1, 'first note saved')
    pg.screenshot(path=SHOTS + '02_drawer.png')
    pg.click('.drawer [data-act=drawer-close]')

    # ---------- pipeline drag & drop through every stage
    pg.click('[data-act=go][data-view=pipeline]')
    pg.wait_for_selector('.kanban')
    card = f'[data-drag="{acme["id"]}"]'
    def drag_to(stage_id, pid=None):
        # synthetic HTML5 drag events: same handlers as a mouse drag, immune to auto-scroll
        pg.evaluate('''([id, st]) => {
          const src = document.querySelector(`[data-drag="${id}"]`);
          const dst = document.querySelector(`.kcol[data-stage="${st}"] .kcol-body`);
          const dt = new DataTransfer();
          src.dispatchEvent(new DragEvent('dragstart', {bubbles: true, dataTransfer: dt}));
          dst.dispatchEvent(new DragEvent('dragover', {bubbles: true, cancelable: true, dataTransfer: dt}));
          dst.dispatchEvent(new DragEvent('drop', {bubbles: true, cancelable: true, dataTransfer: dt}));
          src.dispatchEvent(new DragEvent('dragend', {bubbles: true, dataTransfer: dt}));
        }''', [pid or acme['id'], stage_id])
    # first move with a real mouse drag
    pg.drag_and_drop(card, '.kcol[data-stage="st_research"] .kcol-body'); pg.wait_for_timeout(150)
    check(prospect_by_company(pg, 'Acme Coaching')['stageId'] == 'st_research', 'real mouse drag moves the card')
    drag_to('st_applied'); pg.wait_for_timeout(150)
    acme = prospect_by_company(pg, 'Acme Coaching')
    check(acme['stageId'] == 'st_applied' and acme['appliedDate'], 'drag to Applied sets stage and date applied')
    drag_to('st_replied'); pg.wait_for_timeout(150)
    drag_to('st_follow_up')
    pg.wait_for_selector('.modal-wrap [name=date]')
    pg.fill('.modal-wrap [name=date]', js(pg, "addDays(todayStr(), 2)"))
    modal_submit(pg); pg.wait_for_timeout(200)
    fu = [t for t in tasks_for(pg, acme['id']) if t['type'] == 'follow_up' and t['status'] == 'todo']
    check(len(fu) == 1 and fu[0]['dueDate'] == js(pg, "addDays(todayStr(), 2)"), 'Follow-Up automation creates task on chosen date')
    check(fu and fu[0]['title'] == 'Follow up with Acme Coaching', 'follow-up task title uses prospect name')
    check(js(pg, "Object.values(CRM.Store.data.jobs).length") == 1, 'wait step stored as a scheduled job')
    acts = js(pg, "id => Object.values(CRM.Store.data.activities).filter(a => a.prospectId === id).map(a => a.type)", acme['id'])
    check(acts.count('stage_changed') == 4, 'each stage move is in the timeline (got %d)' % acts.count('stage_changed'))

    # moving to Follow-Up again (via Replied) must not duplicate the open follow-up
    drag_to('st_replied'); pg.wait_for_timeout(100)
    drag_to('st_follow_up'); pg.wait_for_selector('.modal-wrap [name=date]'); modal_submit(pg); pg.wait_for_timeout(200)
    fu = [t for t in tasks_for(pg, acme['id']) if t['type'] == 'follow_up' and t['status'] == 'todo']
    check(len(fu) == 1, 'no duplicate follow-up when re-entering Follow-Up (got %d)' % len(fu))

    # interview with date -> prep task the day before
    drag_to('st_interview')
    pg.wait_for_selector('.modal-wrap [name=when]')
    iv_date = js(pg, "addDays(todayStr(), 4)")
    pg.fill('.modal-wrap [name=when]', iv_date + 'T14:30')
    modal_submit(pg); pg.wait_for_timeout(200)
    prep = [t for t in tasks_for(pg, acme['id']) if t['type'] == 'interview_prep']
    check(len(prep) == 1 and prep[0]['dueDate'] == js(pg, "addDays(todayStr(), 3)") and prep[0]['priority'] == 'high', 'Interview automation creates prep task the day before')
    check(prospect_by_company(pg, 'Acme Coaching')['interviewAt'] == iv_date + 'T14:30', 'interview date saved')

    drag_to('st_proposal'); pg.wait_for_timeout(200)
    acme = prospect_by_company(pg, 'Acme Coaching')
    check(acme['proposalDate'] == js(pg, 'todayStr()'), 'Proposal stage sets proposal date')
    prop = [t for t in tasks_for(pg, acme['id']) if t['title'].startswith('Follow up on proposal')]
    check(len(prop) == 1 and prop[0]['dueDate'] == js(pg, "addDays(todayStr(), 3)"), 'Proposal automation creates follow-up in 3 days')
    pg.screenshot(path=SHOTS + '03_pipeline_after_moves.png')

    drag_to('st_won'); pg.wait_for_timeout(250)
    acme = prospect_by_company(pg, 'Acme Coaching')
    ts = tasks_for(pg, acme['id'])
    check(acme['outcome'] == 'won' and acme['wonDate'] == js(pg, 'todayStr()'), 'Won records conversion date')
    check(not [t for t in ts if t['type'] in ('follow_up', 'interview_prep') and t['status'] in ('todo', 'in_progress')], 'Won closes open follow-ups and prep tasks')
    check(len([t for t in ts if t['type'] == 'onboarding' and t['status'] == 'todo']) == 1, 'Won creates onboarding task')
    check(js(pg, "computeMetrics(CRM.Store.data).won") == 1, 'metrics count the win')
    m = js(pg, "computeMetrics(CRM.Store.data)")
    check(m['applications'] == 1 and m['replies'] == 1 and m['interviews'] == 1 and m['proposals'] == 1, 'funnel counts reached stages')

    # second prospect: lost with reason
    js(pg, "CRM.Store.mutate('t', d => createProspect(d, {company: 'Beta Logistics', sourceId: 'src_upwork', stageId: 'st_applied'}))")
    beta = prospect_by_company(pg, 'Beta Logistics')
    pg.wait_for_timeout(100)
    drag_to('st_lost', beta['id'])
    pg.wait_for_selector('.modal-wrap [name=reason]')
    pg.select_option('.modal-wrap [name=reason]', 'Budget too low')
    modal_submit(pg); pg.wait_for_timeout(200)
    beta = prospect_by_company(pg, 'Beta Logistics')
    check(beta['outcome'] == 'lost' and beta['lostReason'] == 'Budget too low' and beta['lostDate'], 'Lost records date and reason')

    # cancel a move: stage unchanged
    js(pg, "CRM.Store.mutate('t', d => createProspect(d, {company: 'Gamma Studio', stageId: 'st_replied'}))")
    gamma = prospect_by_company(pg, 'Gamma Studio')
    pg.wait_for_timeout(100)
    drag_to('st_follow_up', gamma['id'])
    pg.wait_for_selector('.modal-wrap')
    pg.keyboard.press('Escape'); pg.wait_for_timeout(100)
    check(prospect_by_company(pg, 'Gamma Studio')['stageId'] == 'st_replied', 'cancelling the follow-up prompt cancels the move')

    # ---------- wait step: job runs after the wait, respects "skip if open" and exit on stage change
    drag_to('st_follow_up', gamma['id'])
    pg.wait_for_selector('.modal-wrap [name=date]'); modal_submit(pg); pg.wait_for_timeout(150)
    first = [t for t in tasks_for(pg, gamma['id']) if t['type'] == 'follow_up'][0]
    js(pg, "id => CRM.Store.mutate('t', d => setTaskStatus(d, id, 'done'))", first['id'])
    js(pg, "CRM.Clock.offsetMs = 6 * 86400000; CRM.Engine.tick();")
    second = [t for t in tasks_for(pg, gamma['id']) if t['title'].startswith('Second follow-up')]
    check(len(second) == 1, 'after the 5-day wait a second follow-up is created when the first was done')
    js(pg, "CRM.Engine.tick()")
    check(len([t for t in tasks_for(pg, gamma['id']) if t['title'].startswith('Second follow-up')]) == 1, 'job runs once only')
    js(pg, "CRM.Clock.offsetMs = 0")

    # ---------- follow-up view: done + next in one step
    js(pg, "CRM.Store.mutate('t', d => { const p = createProspect(d, {company: 'Delta Retail', stageId: 'st_applied', temperature: 'hot'}); setFollowUp(d, p.id, todayStr()); })")
    pg.click('[data-act=go][data-view=followups]')
    pg.wait_for_selector('.fu-row')
    row = pg.locator('.fu-section', has_text='Due today').locator('.fu-row', has_text='Delta Retail')
    check(row.count() == 1, 'follow-up due today listed under Due today')
    row.locator('[data-act=fu-done]').click()
    pg.wait_for_selector('.modal-wrap [name=note]')
    pg.fill('.modal-wrap [name=note]', 'Sent a short check-in')
    pg.click('.modal-wrap .chip-btn:has-text("In 1 week")')
    modal_submit(pg); pg.wait_for_timeout(200)
    delta = prospect_by_company(pg, 'Delta Retail')
    dts = tasks_for(pg, delta['id'])
    check(len([t for t in dts if t['status'] == 'done']) == 1 and len([t for t in dts if t['status'] == 'todo' and t['dueDate'] == js(pg, "addDays(todayStr(), 7)")]) == 1, 'Done + next creates the next follow-up')
    check(js(pg, "id => Object.values(CRM.Store.data.activities).some(a => a.prospectId === id && a.type === 'follow_up_completed' && a.note === 'Sent a short check-in')", delta['id']), 'follow-up note in timeline')
    pg.screenshot(path=SHOTS + '04_followups.png')

    # ---------- tasks: create from Tasks view, complete via checkbox
    pg.click('[data-act=go][data-view=tasks]')
    pg.click('.page-actions [data-act=new-task]')
    pg.wait_for_selector('.modal-wrap [name=title]')
    pg.fill('.modal-wrap [name=title]', 'Update portfolio site')
    modal_submit(pg); pg.wait_for_timeout(150)
    t = js(pg, "Object.values(CRM.Store.data.tasks).find(t => t.title === 'Update portfolio site')")
    check(t and t['status'] == 'todo' and t['dueDate'] == js(pg, 'todayStr()'), 'task created for today')
    pg.click('[data-act=filter-set][data-value=today]')
    pg.locator('tr', has_text='Update portfolio site').locator('.check input').click()
    pg.wait_for_timeout(150)
    t = js(pg, "Object.values(CRM.Store.data.tasks).find(t => t.title === 'Update portfolio site')")
    check(t['status'] == 'done' and t['completedAt'], 'task completed with completed date')

    # ---------- debounce: five quick edits -> one new state
    check(wait_synced(pg), 'synced after the burst of work')
    before = states_on_drive(pg)
    before_seq = js(pg, 'CRM.Sync.baseSeq')
    for i in range(5):
        js(pg, "n => CRM.Store.mutate('e', d => updateProspect(d, Object.values(d.prospects).find(p => p.company === 'Delta Retail').id, {expectedRate: '$' + n + '/hr'}))", i + 5)
        pg.wait_for_timeout(120)
    sub = pg.inner_text('#sync')
    check('Unsaved changes' in sub or 'Saving' in sub, 'while dirty the status does not claim Synced')
    check(wait_synced(pg), 'debounced save completes')
    check(js(pg, 'CRM.Sync.baseSeq') == before_seq + 1, 'five rapid edits produced exactly one new state (seq %s -> %s)' % (before_seq, js(pg, 'CRM.Sync.baseSeq')))

    # ---------- archive / restore
    pg.click('[data-act=go][data-view=prospects]')
    pg.click('[data-act=filter-set][data-value=open]')
    pg.locator('tr', has_text='Delta Retail').click()
    pg.wait_for_selector('.drawer [data-act=archive]')
    pg.click('.drawer [data-act=archive]')
    pg.wait_for_selector('.modal-wrap [name=reason]')
    pg.select_option('.modal-wrap [name=reason]', 'On Hold')
    pg.fill('.modal-wrap [name=note]', 'Revisit in January')
    modal_submit(pg); pg.wait_for_timeout(150)
    delta = prospect_by_company(pg, 'Delta Retail')
    check(delta['lifecycle'] == 'archived' and delta['archive']['reason'] == 'On Hold', 'archived with reason')
    check(delta['stageId'] == 'st_applied', 'archiving keeps the stage')
    check(js(pg, "computeMetrics(CRM.Store.data).followUpsToday") == 0 and not any(t['id'] for t in js(pg, "taskBuckets(CRM.Store.data).open") if t['prospectId'] == delta['id']), 'archived lead leaves active task/follow-up lists')
    pg.click('.drawer [data-act=drawer-close]')
    pg.fill('#global-q', 'Delta')
    pg.wait_for_selector('.gr-item')
    check('Archived' in pg.inner_text('#global-results'), 'archived lead is still searchable (with badge)')
    pg.keyboard.press('Escape')
    pg.click('[data-act=go][data-view=archive]')
    pg.screenshot(path=SHOTS + '05_archive.png')
    pg.locator('tr', has_text='Delta Retail').locator('[data-act=trash]').click()
    pg.wait_for_timeout(150)
    delta = prospect_by_company(pg, 'Delta Retail')
    check(delta['lifecycle'] == 'trashed' and delta['trash']['from'] == 'archived', 'deleting from Archive moves to Trash and remembers it was archived')
    pg.click('[data-act=go][data-view=trash]')
    pg.screenshot(path=SHOTS + '06_trash.png')
    trash_text = pg.inner_text('.view')
    check('Was archived' in trash_text and 'Applied / Contacted' in trash_text and 'Joshua Lara' in trash_text, 'Trash shows previous stage, archived flag and deleted by')
    pg.locator('tr', has_text='Delta Retail').locator('[data-act=restore-trash]').click()
    pg.wait_for_timeout(150)
    delta = prospect_by_company(pg, 'Delta Retail')
    check(delta['lifecycle'] == 'archived' and delta['archive']['reason'] == 'On Hold', 'restore from Trash returns it to Archive with its reason')
    n_notes_before = js(pg, "Object.keys(CRM.Store.data.activities).length")
    pg.click('[data-act=go][data-view=archive]')
    pg.locator('tr', has_text='Delta Retail').locator('[data-act=restore-archive]').click()
    pg.wait_for_timeout(150)
    delta = prospect_by_company(pg, 'Delta Retail')
    check(delta['lifecycle'] == 'active' and delta['stageId'] == 'st_applied', 'restore from Archive returns to previous stage')
    check(len(tasks_for(pg, delta['id'])) >= 2, 'tasks preserved through archive/trash/restore')

    # ---------- trash -> permanent delete with confirmation, empty trash
    js(pg, "id => CRM.Store.mutate('t', d => trashProspect(d, id))", gamma['id'])
    js(pg, "id => CRM.Store.mutate('t', d => trashProspect(d, id))", beta['id'])
    pg.click('[data-act=go][data-view=dashboard]'); pg.click('[data-act=go][data-view=trash]')
    pg.locator('tr', has_text='Gamma Studio').locator('[data-act=purge]').click()
    pg.wait_for_selector('.modal-wrap')
    check('This will permanently delete this lead and its associated data. This action cannot be undone.' in pg.inner_text('.modal-wrap'), 'permanent delete shows the exact warning')
    pg.click('.modal-wrap [data-modal-close]')
    check(prospect_by_company(pg, 'Gamma Studio') is not None, 'cancel keeps the lead')
    pg.locator('tr', has_text='Gamma Studio').locator('[data-act=purge]').click()
    pg.wait_for_selector('.modal-wrap'); modal_submit(pg); pg.wait_for_timeout(150)
    check(prospect_by_company(pg, 'Gamma Studio') is None and not tasks_for(pg, gamma['id']), 'permanent delete removes lead and its tasks')
    check(js(pg, "id => !!CRM.Store.data.tombstones[id]", gamma['id']), 'tombstone recorded so merges cannot resurrect it')
    pg.click('[data-act=empty-trash]')
    pg.wait_for_selector('.modal-wrap')
    check('This will permanently delete all leads currently in Trash. This action cannot be undone.' in pg.inner_text('.modal-wrap'), 'Empty Trash shows the exact warning')
    modal_submit(pg); pg.wait_for_timeout(150)
    check(js(pg, "computeMetrics(CRM.Store.data).trashed") == 0 and prospect_by_company(pg, 'Beta Logistics') is None, 'Empty Trash removes everything in Trash')
    check(prospect_by_company(pg, 'Acme Coaching') is not None, 'Empty Trash leaves active leads alone')

    # ---------- reload: everything persists
    check(wait_synced(pg), 'synced before reload')
    count = js(pg, "Object.keys(CRM.Store.data.prospects).length")
    pg.reload(); pg.wait_for_selector('#view h1')
    check(wait_synced(pg), 'synced after reload')
    check(js(pg, "Object.keys(CRM.Store.data.prospects).length") == count, 'data survives reload')

    # ---------- offline: failure shown honestly, changes kept locally, survive reload, sync on reconnect
    js(pg, "__net.offline = true")
    js(pg, "CRM.Store.mutate('t', d => createProspect(d, {company: 'Offline Co'}))")
    pg.wait_for_timeout(3500)
    check(js(pg, 'CRM.Sync.status') == 'failed', 'offline save marks Sync Failed')
    check('Sync Failed ⚠' in pg.inner_text('#sync') and 'Sync Failed' in pg.inner_text('#banner'), 'Sync Failed ⚠ shown in sidebar and banner: ' + repr(pg.inner_text('#sync')) + ' / ' + repr(pg.inner_text('#banner')))
    check('Connected ✓' not in pg.inner_text('#sync'), 'does not claim Connected/Synced while failing')
    buf = js(pg, "JSON.parse(localStorage.getItem('crm_acq_buffer_v1'))")
    check(buf['dirty'] and any(p['company'] == 'Offline Co' for p in buf['data']['prospects'].values()), 'unsynced change kept in local buffer')
    pg.screenshot(path=SHOTS + '07_sync_failed.png')
    # reload while still offline -> boots from buffer
    js(pg, "localStorage.setItem('__offline', '1')")
    pg.reload()
    pg.wait_for_timeout(1500)
    check(prospect_by_company(pg, 'Offline Co') is not None, 'after reload while offline the unsynced change is still there')
    # the reload re-created the harness env; go online and retry
    js(pg, "__net.offline = false; localStorage.removeItem('__offline')")
    pg.click('#sync [data-act=sync-retry]') if pg.locator('#sync [data-act=sync-retry]').count() else None
    check(wait_synced(pg, 25), 'after reconnecting, retry syncs')
    latest = js(pg, "JSON.parse(__api.api_bootstrap({timeZone:'Asia/Manila'}).latest.dataJson)")
    check(any(p['company'] == 'Offline Co' for p in latest['prospects'].values()), 'offline change reached Drive')

    # ---------- corrupted upload is detected and retried automatically
    js(pg, "__env._faults.corruptWrite = 1")
    js(pg, "CRM.Store.mutate('t', d => createProspect(d, {company: 'Verify Co'}))")
    pg.wait_for_timeout(3500)
    check(js(pg, 'CRM.Sync.status') == 'failed', 'readback mismatch reported as failure')
    check(wait_synced(pg, 15), 'automatic retry succeeds after a failed verify')

    # ---------- conflict: another device saved in between -> record-level merge
    seq = js(pg, 'CRM.Sync.baseSeq')
    js(pg, """seq => {
      const remote = JSON.parse(JSON.stringify(CRM.Store.data));
      const id = 'p_remote_device';
      remote.prospects[id] = Object.assign({}, Object.values(remote.prospects)[0], {id, company: 'Remote Device Co', updatedAt: new Date().toISOString()});
      const dataJson = JSON.stringify(remote);
      const r = __api.api_save({baseSeq: seq, saveId: 'other-device', checksum: sha256Hex(dataJson), dataJson, timeZone: 'Asia/Manila', counts: {prospects: 1}, token: localStorage.getItem('crm_acq_token_v1') || ''});
      localStorage.setItem('__mockdrive', JSON.stringify(__env._files));
      return r.ok;
    }""", seq)
    js(pg, "CRM.Store.mutate('t', d => createProspect(d, {company: 'Local Device Co'}))")
    check(wait_synced(pg, 15), 'conflicting save resolves')
    check(prospect_by_company(pg, 'Remote Device Co') and prospect_by_company(pg, 'Local Device Co'), 'merge keeps both devices\' new prospects')
    check(js(pg, 'CRM.Sync.baseSeq') == seq + 2, 'merged result saved on top of the other device\'s state')

    # ---------- rolling 10 with many leads
    js(pg, "CRM.Store.mutate('t', d => { for (let i = 0; i < 300; i++) createProspect(d, {company: 'Bulk ' + i}); })")
    for i in range(12):
        check(wait_synced(pg, 20), 'bulk sync %d' % i) if i == 0 else wait_synced(pg, 20)
        js(pg, "n => CRM.Store.mutate('t', d => updateProspect(d, Object.values(d.prospects).find(p => p.company === 'Bulk 0').id, {industry: 'Round ' + n}))", i)
        pg.wait_for_timeout(50)
        js(pg, "CRM.Sync.syncNow()")
    check(wait_synced(pg, 20), 'synced after 12 rounds: ' + json.dumps(js(pg, '({s: CRM.Sync.status, d: CRM.Sync.dirty, f: CRM.Sync.inFlight, e: CRM.Sync.lastError, n: CRM.Sync.failures})')))
    check(states_on_drive(pg) == 10, 'exactly 10 states kept on Drive (got %d)' % states_on_drive(pg))
    total = js(pg, "Object.keys(CRM.Store.data.prospects).length")
    check(total >= 304, 'all leads still present (%d)' % total)
    latest = js(pg, "JSON.parse(__api.api_bootstrap({timeZone:'Asia/Manila'}).latest.dataJson)")
    check(len(latest['prospects']) == total, 'newest Drive state holds every lead')

    # ---------- recovery: restore an older state
    pg.click('[data-act=go][data-view=settings]')
    pg.wait_for_selector('.set-body table')
    pg.wait_for_timeout(500)
    pg.screenshot(path=SHOTS + '08_settings_drive.png', full_page=True)
    rows = pg.locator('.set-body tbody tr')
    check(rows.count() == 10, 'recovery list shows 10 states')
    check('Newest' in rows.first.inner_text(), 'newest state is labeled')
    oldest = rows.last
    oldest_seq = int(oldest.locator('td').first.inner_text().split('#')[1].split()[0])
    restored_count = js(pg, "s => CRM.Sync.states.find(x => x.seq === s).record_count", oldest_seq)
    oldest.locator('[data-act=restore-state]').click()
    pg.wait_for_selector('.modal-wrap')
    txt = pg.inner_text('.modal-wrap')
    check('You are about to restore CRM data from' in txt and 'Current unsaved/current data may be replaced. Continue?' in txt, 'restore asks for confirmation with timestamp')
    head_before = js(pg, 'CRM.Sync.baseSeq')
    modal_submit(pg)
    for _ in range(100):
        if js(pg, 'CRM.Sync.baseSeq') > head_before: break
        pg.wait_for_timeout(150)
    check(wait_synced(pg, 20), 'restore saved')
    check(js(pg, 'CRM.Sync.baseSeq') == head_before + 1, 'restore creates a new newest state: ' + json.dumps(js(pg, '({b: CRM.Sync.baseSeq, h: CRM.Sync.head, hb: %d, o: %d})' % (head_before, oldest_seq))))
    check(js(pg, 'CRM.Sync.head.restored_from') == oldest_seq, 'new state records which state it was restored from')
    check(js(pg, "Object.keys(CRM.Store.data.prospects).length") == restored_count, 'restored data matches the chosen state')
    check(states_on_drive(pg) == 10, 'still 10 states after restore (oldest rolled off)')


    # ---------- general application without company info
    pg.click('[data-act=go][data-view=dashboard]')
    pg.click('.topbar [data-act=new-prospect]'); pg.wait_for_selector('#pform')
    pg.fill('#pform [name=title]', 'Virtual Assistant (confidential client)')
    pg.click('#pform button[type=submit]'); pg.wait_for_selector('.drawer .dr-tabs')
    gp = js(pg, "Object.values(CRM.Store.data.prospects).find(p => p.title === 'Virtual Assistant (confidential client)')")
    check(gp is not None and gp['company'] == '', 'title-only general application saves')
    check('Company not disclosed' in pg.inner_text('.drawer .dr-title'), 'no-company prospect shows "Company not disclosed"')
    pg.click('.drawer [data-act=drawer-close]')

    # ---------- pipeline grid view
    pg.click('[data-act=go][data-view=pipeline]')
    pg.click('.seg-toggle [data-value=grid]')
    pg.wait_for_selector('table.gtable')
    check(pg.locator('table.gtable tr[data-id="%s"]' % gp['id']).count() == 1, 'grid view lists the prospect')
    check(pg.locator('table.gtable tr.g-head').count() == js(pg, 'CRM.Store.data.settings.stages.length'), 'grid has one group per stage')
    pg.select_option('table.gtable select[data-id="%s"]' % gp['id'], 'st_applied'); pg.wait_for_timeout(200)
    check(prospect_by_company(pg, '') is None or js(pg, "id => CRM.Store.data.prospects[id].stageId", gp['id']) == 'st_applied', 'inline stage change in grid moves the prospect')
    pg.select_option('table.gtable select[data-id="%s"]' % gp['id'], 'st_follow_up')
    pg.wait_for_selector('.modal-wrap [name=date]'); modal_submit(pg); pg.wait_for_timeout(200)
    check(js(pg, "id => CRM.Store.data.prospects[id].stageId", gp['id']) == 'st_follow_up', 'grid stage change runs the Follow-Up prompt and automation')
    check(len([t for t in tasks_for(pg, gp['id']) if t['type'] == 'follow_up' and t['status'] == 'todo']) == 1, 'follow-up task created from grid move')
    pg.click('.g-toggle[data-stage="st_follow_up"]'); pg.wait_for_timeout(100)
    check(pg.locator('table.gtable tr[data-id="%s"]' % gp['id']).count() == 0, 'collapsing a stage group hides its rows')
    pg.click('.g-toggle[data-stage="st_follow_up"]')
    pg.screenshot(path=SHOTS + '09_pipeline_grid.png')
    pg.reload(); pg.wait_for_selector('#view h1')
    check(pg.locator('table.gtable').count() == 1, 'grid layout is remembered after reload')
    pg.click('.seg-toggle [data-value=board]'); pg.wait_for_selector('.kanban')

    # ---------- clients: past and current, added manually
    m0 = js(pg, 'computeMetrics(CRM.Store.data)')
    tasks0 = js(pg, 'Object.keys(CRM.Store.data.tasks).length')
    pg.click('[data-act=go][data-view=prospects]')
    pg.click('[data-act=filter-set][data-key=seg][data-value=won]')
    pg.click('.page-actions [data-act=new-client]'); pg.wait_for_selector('#pform')
    check('Add a client' in pg.inner_text('#pform'), 'Add client form opens')
    check(pg.locator('#pform [name=stageId]').count() == 0, 'client form skips the pipeline section')
    pg.fill('#pform [name=company]', 'Former Client Co')
    pg.fill('#pform [name=title]', 'Executive Assistant')
    pg.click('#pform .r-clientStatus-past input')
    pg.fill('#pform [name=clientSince]', '2025-01-15')
    pg.fill('#pform [name=clientUntil]', '2025-04-30')
    pg.click('#pform button[type=submit]'); pg.wait_for_selector('.drawer .dr-tabs')
    fc = prospect_by_company(pg, 'Former Client Co')
    check(fc and fc['outcome'] == 'won' and fc['historical'] and fc['client']['status'] == 'past' and fc['client']['since'] == '2025-01-15' and fc['client']['until'] == '2025-04-30', 'past client saved with dates')
    check(js(pg, 'Object.keys(CRM.Store.data.tasks).length') == tasks0, 'adding a client runs no onboarding automation')
    m1 = js(pg, 'computeMetrics(CRM.Store.data)')
    check(m1['won'] == m0['won'] and m1['applications'] == m0['applications'], 'manually added client is not counted in acquisition metrics')
    check(m1['clientsPast'] == m0['clientsPast'] + 1, 'past clients count goes up')
    check('Past client' in pg.inner_text('.drawer'), 'panel shows Past client')
    pg.click('.drawer [data-act=drawer-close]')
    check(js(pg, "id => filteredProspects('pipeline').some(p => p.id === id)", fc['id']) is False, 'past client stays out of the pipeline')
    check(pg.locator('tr', has_text='Former Client Co').count() == 1, 'past client listed under Clients')

    pg.click('.page-actions [data-act=new-client]'); pg.wait_for_selector('#pform')
    pg.fill('#pform [name=company]', 'Current Client Co')
    pg.fill('#pform [name=clientSince]', '2025-05-01')
    pg.click('#pform button[type=submit]'); pg.wait_for_selector('.drawer .dr-tabs')
    cc = prospect_by_company(pg, 'Current Client Co')
    check(cc and cc['client']['status'] == 'current' and cc['stageId'] == 'st_won', 'current client saved in Won')
    check(js(pg, "id => filteredProspects('pipeline').some(p => p.id === id)", cc['id']) is True, 'current client shows in the pipeline Won column')
    pg.click('.drawer [data-act=client-end]'); pg.wait_for_selector('.modal-wrap [name=date]')
    pg.fill('.modal-wrap [name=date]', '2026-09-30'); modal_submit(pg); pg.wait_for_timeout(150)
    cc = prospect_by_company(pg, 'Current Client Co')
    check(cc['client']['status'] == 'past' and cc['client']['until'] == '2026-09-30', 'Mark engagement ended moves client to past')
    pg.click('.drawer [data-act=client-resume]'); pg.wait_for_timeout(150)
    check(prospect_by_company(pg, 'Current Client Co')['client']['status'] == 'current', 'Working together again restores current')
    pg.click('.drawer [data-act=drawer-close]')
    pg.click('[data-act=filter-set][data-key=clientStatus][data-value=past]')
    check(pg.locator('tr', has_text='Former Client Co').count() == 1 and pg.locator('tr', has_text='Current Client Co').count() == 0, 'Clients filter: Past')
    pg.screenshot(path=SHOTS + '10_clients.png')
    pg.click('[data-act=filter-set][data-key=clientStatus][data-value=""]')

    # a deal won through the pipeline becomes a current client automatically
    js(pg, "CRM.Store.mutate('t', d => { const p = createProspect(d, {company: 'Pipeline Win Co', stageId: 'st_proposal'}); moveStage(d, p.id, 'st_won', {}); })")
    pw = prospect_by_company(pg, 'Pipeline Win Co')
    check(pw['client']['status'] == 'current' and pw['client']['since'] == js(pg, 'todayStr()') and not pw.get('historical'), 'pipeline win becomes a current client (counted in metrics)')
    check(wait_synced(pg, 20), 'client changes synced')


    # ---------- passcode lock (for opening the CRM on a phone without Google sign-in)
    js(pg, "CRM.UI.settingsTab = 'security'; CRM.UI.go('settings')")
    pg.wait_for_selector('#pc-new')
    check('Set a passcode' in pg.inner_text('#banner'), 'banner invites the owner to set a passcode')
    pg.fill('#pc-new', 'abc'); pg.fill('#pc-confirm', 'abc'); pg.click('[data-act=passcode-save]')
    check('at least 6' in pg.inner_text('#pc-msg'), 'short passcode rejected in the app')
    pg.fill('#pc-new', 'Reading-Room-42'); pg.fill('#pc-confirm', 'Reading-Room-43'); pg.click('[data-act=passcode-save]')
    check('match' in pg.inner_text('#pc-msg'), 'mismatched passcodes rejected')
    pg.fill('#pc-confirm', 'Reading-Room-42'); pg.click('[data-act=passcode-save]')
    pg.wait_for_selector('text=Passcode is on', timeout=10000)
    check(len(js(pg, "localStorage.getItem('crm_acq_token_v1') || ''")) >= 32, 'this device keeps a token after setting the passcode')
    check('Set a passcode' not in pg.inner_text('#banner'), 'banner gone once a passcode exists')
    pg.reload(); pg.wait_for_selector('#view h1')
    check(pg.locator('#lock-form').count() == 0 and wait_synced(pg), 'this device stays unlocked after reload')
    count_before = js(pg, "Object.keys(CRM.Store.data.prospects).length")

    # a new device (no token): lock screen, no data on screen
    js(pg, "localStorage.removeItem('crm_acq_token_v1')")
    pg.reload(); pg.wait_for_selector('#lock-form')
    check(pg.locator('.shell').count() == 0 and 'Former Client Co' not in pg.inner_text('body'), 'locked device shows no CRM data')
    pg.fill('#lock-pass', 'wrong-guess'); pg.click('#lock-form button[type=submit]')
    pg.wait_for_function("document.getElementById('lock-msg') && document.getElementById('lock-msg').textContent.length > 0")
    check('isn’t right' in pg.inner_text('#lock-msg'), 'wrong passcode explained')
    pg.screenshot(path=SHOTS + '11_lock_screen.png')
    # unlock as an anonymous visitor (the public link on a phone)
    js(pg, "__env._setActiveUser('')")
    pg.fill('#lock-pass', 'Reading-Room-42'); pg.click('#lock-form button[type=submit]')
    pg.wait_for_selector('.shell', timeout=15000)
    check(wait_synced(pg, 15), 'correct passcode unlocks and syncs')
    check(js(pg, "Object.keys(CRM.Store.data.prospects).length") == count_before, 'all data is there after unlocking')
    js(pg, "CRM.Store.mutate('t', d => createProspect(d, {company: 'Phone Added Co'}))")
    check(wait_synced(pg, 15), 'changes made from the unlocked phone sync to Drive')
    latest = js(pg, "JSON.parse(__api.api_bootstrap({timeZone:'Asia/Manila', token: localStorage.getItem('crm_acq_token_v1')}).latest.dataJson)")
    check(any(p['company'] == 'Phone Added Co' for p in latest['prospects'].values()), 'phone change reached Drive')
    check(js(pg, "__api.api_bootstrap({timeZone:'Asia/Manila'}).code") == 'LOCKED', 'without a token the server refuses data')

    # token revoked elsewhere: the next save shows the lock screen, change kept locally
    js(pg, "__env._props.CRM_DEVICE_TOKENS = '{}'")
    js(pg, "CRM.Store.mutate('t', d => createProspect(d, {company: 'After Revoke Co'}))")
    pg.wait_for_selector('#lock-form', timeout=15000)
    buf = js(pg, "JSON.parse(localStorage.getItem('crm_acq_buffer_v1'))")
    check(buf['dirty'] and any(p['company'] == 'After Revoke Co' for p in buf['data']['prospects'].values()), 'unsynced change kept while locked')
    pg.fill('#lock-pass', 'Reading-Room-42'); pg.click('#lock-form button[type=submit]')
    pg.wait_for_selector('.shell', timeout=15000)
    check(wait_synced(pg, 20) and prospect_by_company(pg, 'After Revoke Co') is not None, 'after unlocking, the held change syncs')
    latest = js(pg, "JSON.parse(__api.api_bootstrap({timeZone:'Asia/Manila', token: localStorage.getItem('crm_acq_token_v1')}).latest.dataJson)")
    check(any(p['company'] == 'After Revoke Co' for p in latest['prospects'].values()), 'held change reached Drive')

    # change passcode, then lock this device
    js(pg, "CRM.UI.settingsTab = 'security'; CRM.UI.go('settings')")
    pg.wait_for_selector('#pc-current')
    pg.fill('#pc-current', 'Reading-Room-42'); pg.fill('#pc-new', 'New-Pass-2026'); pg.fill('#pc-confirm', 'New-Pass-2026')
    pg.click('[data-act=passcode-save]'); pg.wait_for_timeout(800)
    check(js(pg, "__api.api_unlock({passcode: 'Reading-Room-42'}).code") == 'WRONG_PASSCODE', 'old passcode no longer works')
    pg.click('[data-act=passcode-lock]'); pg.wait_for_selector('#lock-form')
    pg.fill('#lock-pass', 'New-Pass-2026'); pg.click('#lock-form button[type=submit]')
    pg.wait_for_selector('.shell', timeout=15000)
    check(wait_synced(pg, 15), 'new passcode unlocks')
    js(pg, "__env._setActiveUser('vajoshlara@gmail.com')")

    # ---------- local-only mode (opened as a plain file)
    pl = new_page(ctx, 'http://127.0.0.1:8765/local.html')
    pl.wait_for_selector('.today-line')
    check('Not connected' in pl.inner_text('#sync'), 'plain-file mode says Not connected')
    check('Synced' not in pl.inner_text('.topbar'), 'plain-file mode never says Synced')
    js(pl, "CRM.Store.mutate('t', d => createProspect(d, {company: 'Local Only Co'}))")
    pl.reload(); pl.wait_for_selector('#view h1')
    check(prospect_by_company(pl, 'Local Only Co') is not None, 'local mode persists across reload')
    pl.close()

    errs = pg.errors
    check(not errs, 'no page errors: ' + '; '.join(errs[:3]))
    browser.close()

print(f'e2e: {passed} passed, {len(failed)} failed')
sys.exit(1 if failed else 0)
