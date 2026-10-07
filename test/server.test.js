// Tests for Code.gs storage logic against the simulated Drive.
const fs = require('fs');
const vm = require('vm');
const crypto = require('crypto');
const path = require('path');
const { createEnv, sha256Bytes } = require('./mock_gas.js');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'server', 'Code.gs'), 'utf8');
let pass = 0, failN = 0;
function ok(cond, msg) { if (cond) { pass++; } else { failN++; console.log('FAIL:', msg); } }
function hex(s) { return crypto.createHash('sha256').update(s, 'utf8').digest('hex'); }

function boot() {
  const env = createEnv();
  const ctx = vm.createContext(Object.assign({ JSON, Date, Math, Number, String, Object, Array, isFinite, console }, env));
  vm.runInContext(SRC, ctx);
  return { env, ctx };
}
function makeData(n, tag) {
  const prospects = {};
  for (let i = 0; i < n; i++) prospects['p_' + i] = { id: 'p_' + i, company: 'Co ' + i + (tag || ''), lifecycle: 'active' };
  return { schema: 1, prospects, tasks: {}, notes: {}, activities: {}, jobs: {}, tombstones: {} };
}
let saveCounter = 0;
function save(ctx, baseSeq, data, extra) {
  const dataJson = JSON.stringify(data);
  return ctx.api_save(Object.assign({
    baseSeq, saveId: 'sv_' + (++saveCounter), checksum: hex(dataJson), dataJson,
    deviceId: 'dev1', timeZone: 'Asia/Manila', counts: { prospects: Object.keys(data.prospects).length }
  }, extra || {}));
}

// 0. sha256 implementation matches Node crypto (incl. unicode)
['', 'abc', 'héllo – 🌏 日本', 'x'.repeat(1000)].forEach(s => {
  const b = sha256Bytes(s).map(v => (v < 0 ? v + 256 : v).toString(16).padStart(2, '0')).join('');
  ok(b === hex(s), 'sha256 mismatch for ' + JSON.stringify(s.slice(0, 10)));
});

// 1. Empty folder bootstrap
{
  const { ctx } = boot();
  const r = ctx.api_bootstrap({ timeZone: 'Asia/Manila' });
  ok(r.ok && r.latest === null && r.states.length === 0, 'bootstrap empty');
  ok(r.folder.name === '08_Claude CRM Project', 'folder name');
}

// 2. Rolling 10: 12 saves of a 250-lead CRM keep states 3..12; current data intact
{
  const { env, ctx } = boot();
  let seq = 0, data;
  for (let i = 1; i <= 12; i++) {
    data = makeData(250, ' v' + i);
    const r = save(ctx, seq, data);
    ok(r.ok && r.state.seq === i, 'save ' + i + ' ok (' + JSON.stringify(r).slice(0, 120) + ')');
    seq = r.state.seq;
    if (i === 11) ok(JSON.stringify(r.pruned) === '[1]', 'save 11 prunes state 1, got ' + JSON.stringify(r.pruned));
    if (i === 12) ok(JSON.stringify(r.pruned) === '[2]', 'save 12 prunes state 2');
  }
  const committed = env._committed();
  ok(committed.length === 10, 'exactly 10 committed states, got ' + committed.length);
  ok(/crm_state_000003_/.test(committed[0].name) && /crm_state_000012_/.test(committed[9].name), 'states 3..12 kept');
  const b = ctx.api_bootstrap({ timeZone: 'Asia/Manila' });
  const latest = JSON.parse(b.latest.dataJson);
  ok(Object.keys(latest.prospects).length === 250, 'newest state still has all 250 leads');
  ok(latest.prospects.p_0.company === 'Co 0 v12', 'newest state is v12');
  ok(b.latest.meta.record_count === 250, 'record_count 250');
  ok(/\+08:00$/.test(b.latest.meta.created_at), 'created_at has Manila offset: ' + b.latest.meta.created_at);
  ok(b.states[0].seq === 12 && b.states.length === 10, 'list newest first');
  // file format matches requested envelope
  const raw = JSON.parse(committed[9].content);
  ['state_id', 'created_at', 'updated_at', 'application_version', 'data_version', 'record_count', 'storage_status', 'data'].forEach(k => ok(k in raw, 'envelope has ' + k));
  ok(Object.keys(raw).pop() === 'data', 'data is last key');
}

// 3. Upload failure: nothing deleted, no new state, error is retryable
{
  const { env, ctx } = boot();
  let seq = 0;
  for (let i = 1; i <= 10; i++) seq = save(ctx, seq, makeData(5, i)).state.seq;
  env._faults.create = 1;
  const r = save(ctx, seq, makeData(5, 'fail'));
  ok(!r.ok && r.retryable, 'create failure reported retryable: ' + JSON.stringify(r));
  ok(env._committed().length === 10, 'still 10 states after failure');
  ok(/crm_state_000001_/.test(env._committed()[0].name), 'oldest state NOT deleted on failure');
  const r2 = save(ctx, seq, makeData(5, 'retry'));
  ok(r2.ok && r2.state.seq === 11, 'retry succeeds as state 11');
  ok(env._committed().length === 10 && /crm_state_000002_/.test(env._committed()[0].name), 'prune only after success');
}

// 4. Corrupted write (readback mismatch) -> VERIFY_FAILED, pending discarded, nothing pruned
{
  const { env, ctx } = boot();
  let seq = 0;
  for (let i = 1; i <= 10; i++) seq = save(ctx, seq, makeData(3, i)).state.seq;
  env._faults.corruptWrite = 1;
  const r = save(ctx, seq, makeData(3, 'x'));
  ok(!r.ok && r.code === 'VERIFY_FAILED', 'verify failure detected: ' + r.code);
  ok(env._committed().length === 10 && /crm_state_000001_/.test(env._committed()[0].name), 'no prune after verify failure');
  const pendingLeft = Object.values(env._files).filter(f => !f.trashed && /^pending_/.test(f.name));
  ok(pendingLeft.length === 0, 'pending file discarded');
}

// 5. Rename (commit) failure -> no new state, nothing pruned
{
  const { env, ctx } = boot();
  let seq = 0;
  for (let i = 1; i <= 10; i++) seq = save(ctx, seq, makeData(3, i)).state.seq;
  env._faults.rename = 1;
  const r = save(ctx, seq, makeData(3, 'y'));
  ok(!r.ok, 'rename failure reported');
  ok(env._committed().length === 10 && /crm_state_000001_/.test(env._committed()[0].name), 'no prune after rename failure');
  env._faults.renameSilent = 1;
  const r2 = save(ctx, seq, makeData(3, 'z'));
  ok(!r2.ok && r2.code === 'COMMIT_FAILED', 'silent rename failure caught: ' + r2.code);
}

// 6. Conflict: stale baseSeq returns latest data, nothing written
{
  const { env, ctx } = boot();
  const a = save(ctx, 0, makeData(2, 'A'));
  const b = save(ctx, a.state.seq, makeData(3, 'B'));
  const c = save(ctx, a.state.seq, makeData(4, 'C')); // stale
  ok(!c.ok && c.code === 'CONFLICT' && c.head.seq === b.state.seq, 'conflict detected');
  ok(c.latest && JSON.parse(c.latest.dataJson).prospects.p_2, 'conflict returns latest data');
  ok(env._committed().length === 2, 'no state written on conflict');
}

// 7. Idempotent retry: same saveId after success returns duplicate, no new state
{
  const { env, ctx } = boot();
  const data = makeData(2);
  const dataJson = JSON.stringify(data);
  const req = { baseSeq: 0, saveId: 'same-id', checksum: hex(dataJson), dataJson, timeZone: 'Asia/Manila', counts: { prospects: 2 } };
  const r1 = ctx.api_save(req);
  const r2 = ctx.api_save(req); // response lost, client retries with old baseSeq
  ok(r1.ok && r2.ok && r2.duplicate && r2.state.seq === 1, 'duplicate save recognized');
  ok(env._committed().length === 1, 'only one state');
}

// 8. Unchanged data does not create a new state
{
  const { env, ctx } = boot();
  const d = makeData(2);
  const r1 = save(ctx, 0, d);
  const r2 = save(ctx, 1, d);
  ok(r2.ok && r2.unchanged && env._committed().length === 1, 'unchanged skipped');
}

// 9. Checksum mismatch in transport
{
  const { env, ctx } = boot();
  const r = ctx.api_save({ baseSeq: 0, saveId: 'x', checksum: 'a'.repeat(64), dataJson: '{"prospects":{}}', counts: {} });
  ok(!r.ok && r.code === 'CHECKSUM_MISMATCH' && env._committed().length === 0, 'checksum mismatch rejected');
}

// 10. Lock busy
{
  const { env, ctx } = boot();
  env._faults.lockBusy = 1;
  const r = save(ctx, 0, makeData(1));
  ok(!r.ok && r.code === 'BUSY' && r.retryable, 'busy lock reported');
}

// 11. Corrupt newest state: bootstrap falls back to previous valid state
{
  const { env, ctx } = boot();
  save(ctx, 0, makeData(1, 'one'));
  save(ctx, 1, makeData(2, 'two'));
  const newest = env._committed().pop();
  newest.corruptOnRead = true;
  const b = ctx.api_bootstrap({ timeZone: 'Asia/Manila' });
  ok(b.ok && b.latest.meta.seq === 1 && b.skippedCorrupt.length === 1, 'falls back to state 1 when state 2 is damaged');
}

// 12. getState + restore flow (restore saves as a NEW state)
{
  const { env, ctx } = boot();
  save(ctx, 0, makeData(1, 'old'));
  save(ctx, 1, makeData(5, 'new'));
  const list = ctx.api_listStates().states;
  const old = list.find(s => s.seq === 1);
  const g = ctx.api_getState({ fileId: old.file_id });
  ok(g.ok && JSON.parse(g.dataJson).prospects.p_0.company === 'Co 0old' && g.head.seq === 2, 'getState returns verified old state');
  const restored = JSON.parse(g.dataJson);
  const r = save(ctx, g.head.seq, restored, { restoredFrom: 1 });
  ok(r.ok && r.state.seq === 3 && r.state.restored_from === 1, 'restore creates state 3');
  ok(env._committed().length === 3, 'history preserved after restore');
  const bad = ctx.api_getState({ fileId: 'nope' });
  ok(!bad.ok && bad.code === 'NOT_FOUND', 'unknown file id rejected');
}

// 13. Trash failure during prune: save still OK, warning returned, data safe
{
  const { env, ctx } = boot();
  let seq = 0;
  for (let i = 1; i <= 10; i++) seq = save(ctx, seq, makeData(1, i)).state.seq;
  env._faults.trash = 1;
  const r = save(ctx, seq, makeData(1, 'k'));
  ok(r.ok && r.pruneWarning && r.state.seq === 11, 'prune failure is non-fatal');
  const r2 = save(ctx, 11, makeData(1, 'l'));
  ok(r2.ok && env._committed().length === 10, 'next save catches up pruning, got ' + env._committed().length);
}

// 14. Folder fallback by name and missing folder
{
  const env = createEnv({ folderId: 'other-id' });
  const ctx = vm.createContext(Object.assign({ JSON, Date, Math, Number, String, Object, Array, isFinite }, env));
  vm.runInContext(SRC, ctx);
  const r = ctx.api_bootstrap({ timeZone: 'Asia/Manila' });
  ok(r.ok && r.folder.id === 'other-id', 'found folder by name when ID differs');
}

// 15. Drive list error surfaces as retryable failure
{
  const { env, ctx } = boot();
  env._faults.list = 1;
  const r = ctx.api_bootstrap({ timeZone: 'Asia/Manila' });
  ok(!r.ok && r.retryable, 'list error reported');
}


// 16. Passcode lock
{
  const { env, ctx } = boot();
  // before a passcode: owner gets in, anyone else is locked out and cannot set the first passcode
  ok(ctx.api_bootstrap({ timeZone: 'Asia/Manila' }).ok, 'owner opens before a passcode exists');
  ok(ctx.api_bootstrap({ timeZone: 'Asia/Manila' }).auth.canSetPasscode === true, 'owner is offered to set a passcode');
  env._setActiveUser('');
  const anon = ctx.api_bootstrap({ timeZone: 'Asia/Manila' });
  ok(!anon.ok && anon.code === 'LOCKED' && anon.passcodeSet === false, 'anonymous visitor locked out before passcode');
  ok(ctx.api_setPasscode({ newPasscode: 'attacker1' }).code === 'OWNER_ONLY', 'anonymous visitor cannot set the first passcode');
  ok(!save(ctx, 0, makeData(1)).ok, 'anonymous visitor cannot save');
  env._setActiveUser('vajoshlara@gmail.com');

  ok(ctx.api_setPasscode({ newPasscode: '123' }).code === 'WEAK_PASSCODE', 'short passcode rejected');
  const set = ctx.api_setPasscode({ newPasscode: 'Reading-Room-42', label: 'laptop' });
  ok(set.ok && set.token && set.token.length >= 32, 'owner sets passcode and gets a device token');
  ok(!JSON.stringify(env._props).includes('Reading-Room-42'), 'passcode itself is never stored');
  ok(!JSON.stringify(env._props).includes(set.token), 'raw token is never stored');

  // now everyone, even the owner, needs a token
  ok(ctx.api_bootstrap({ timeZone: 'Asia/Manila' }).code === 'LOCKED', 'no token -> locked');
  ok(ctx.api_bootstrap({ timeZone: 'Asia/Manila', token: 'x'.repeat(40) }).code === 'LOCKED', 'bad token -> locked');
  ok(ctx.api_bootstrap({ timeZone: 'Asia/Manila', token: set.token }).ok, 'valid token -> opens');
  ok(ctx.api_head({ token: set.token }).ok && ctx.api_head({}).code === 'LOCKED', 'head checks token');
  ok(ctx.api_listStates({ token: set.token }).ok && ctx.api_listStates().code === 'LOCKED', 'listStates checks token');
  ok(ctx.api_getState({ fileId: 'f1' }).code === 'LOCKED', 'getState checks token');
  ok(save(ctx, 0, makeData(1)).code === 'LOCKED', 'save without token refused');
  ok(save(ctx, 0, makeData(1), { token: set.token }).ok, 'save with token works');

  // unlock from a phone, anonymously
  env._setActiveUser('');
  const wrong = ctx.api_unlock({ passcode: 'nope-nope' });
  ok(!wrong.ok && wrong.code === 'WRONG_PASSCODE' && /7 attempts left/.test(wrong.message), 'wrong passcode counted');
  const phone = ctx.api_unlock({ passcode: 'Reading-Room-42', label: 'phone' });
  ok(phone.ok && phone.token !== set.token, 'correct passcode unlocks a second device');
  ok(ctx.api_bootstrap({ timeZone: 'Asia/Manila', token: phone.token }).ok, 'phone token opens the CRM');

  // brute force is throttled
  let last;
  for (let i = 0; i < 8; i++) last = ctx.api_unlock({ passcode: 'guess' + i });
  ok(last.code === 'RATE_LIMITED', '8 wrong guesses trigger a pause');
  ok(ctx.api_unlock({ passcode: 'Reading-Room-42' }).code === 'RATE_LIMITED', 'even the right passcode waits during the pause');
  env._cache.crm_lock_until.exp = 0;
  ok(ctx.api_unlock({ passcode: 'Reading-Room-42' }).ok, 'after the pause the right passcode works');

  // change passcode: needs a token and the current passcode; signs other devices out
  ok(ctx.api_setPasscode({ newPasscode: 'NewPass-77', currentPasscode: 'Reading-Room-42' }).code === 'LOCKED', 'change needs a token');
  ok(ctx.api_setPasscode({ newPasscode: 'NewPass-77', currentPasscode: 'wrong', token: phone.token }).code === 'WRONG_PASSCODE', 'change needs the current passcode');
  const changed = ctx.api_setPasscode({ newPasscode: 'NewPass-77', currentPasscode: 'Reading-Room-42', token: phone.token });
  ok(changed.ok && ctx.api_head({ token: changed.token }).ok, 'passcode changed, this device stays in');
  ok(ctx.api_head({ token: set.token }).code === 'LOCKED', 'other devices signed out after a change');

  // sign out other devices
  const lap = ctx.api_unlock({ passcode: 'NewPass-77' });
  ok(ctx.api_signOutOthers({ token: changed.token }).ok, 'sign out others');
  ok(ctx.api_head({ token: lap.token }).code === 'LOCKED' && ctx.api_head({ token: changed.token }).ok, 'only the current device remains');

  // token expiry
  const rec = JSON.parse(env._props.CRM_DEVICE_TOKENS);
  Object.keys(rec).forEach(k => { rec[k].exp = Date.now() - 1; });
  env._props.CRM_DEVICE_TOKENS = JSON.stringify(rec);
  ok(ctx.api_head({ token: changed.token }).code === 'LOCKED', 'expired token refused');

  // forgot passcode: editor opens a 15-minute reset window
  ok(/15 minutes/.test(ctx.allowPasscodeReset()), 'reset helper runs');
  ok(ctx.api_bootstrap({ timeZone: 'Asia/Manila' }).code === 'SETUP', 'during reset the app asks for a new passcode');
  const reset = ctx.api_setPasscode({ newPasscode: 'Fresh-Start-1' });
  ok(reset.ok && ctx.api_head({ token: reset.token }).ok, 'new passcode set during reset window (no sign-in needed)');
  ok(ctx.api_setPasscode({ newPasscode: 'Another-1' }).code === 'LOCKED', 'reset window closes after use');
}

console.log(`server tests: ${pass} passed, ${failN} failed`);
process.exit(failN ? 1 : 0);
