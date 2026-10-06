#!/usr/bin/env node
// Fake clasp for testing scripts/deploy-webapp.mjs. State lives in $FAKE_STATE.
import fs from 'node:fs';
const st = JSON.parse(fs.existsSync(process.env.FAKE_STATE) ? fs.readFileSync(process.env.FAKE_STATE, 'utf8') : '{"versions":0,"deployments":[{"deploymentId":"HEADID"}],"pushes":0,"calls":[]}');
const args = process.argv.slice(2);
const cmd = args.find(a => ['push', 'list-deployments', 'create-deployment', 'list-versions'].includes(a));
st.calls.push(args.join(' '));
const save = () => fs.writeFileSync(process.env.FAKE_STATE, JSON.stringify(st));
const fail = process.env.FAKE_FAIL;
if (fail && cmd === process.env.FAKE_FAIL_CMD) { save(); process.stderr.write(fail + '\n'); process.exit(1); }
const opt = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
if (cmd === 'push') { st.pushes++; console.log(JSON.stringify(['dist/apps-script/appsscript.json', 'dist/apps-script/Code.gs', 'dist/apps-script/Index.html'])); }
if (cmd === 'list-deployments') console.log(JSON.stringify(st.deployments.map(d => ({ deploymentId: d.deploymentId, versionNumber: d.versionNumber, description: d.description }))));
if (cmd === 'list-versions') console.log(JSON.stringify(Array.from({ length: st.versions }, (_, i) => ({ versionNumber: i + 1 }))));
if (cmd === 'create-deployment') {
  st.versions++;
  const id = opt('--deploymentId');
  let d = id && st.deployments.find(x => x.deploymentId === id);
  if (!d) { d = { deploymentId: id || 'AKfyNEW' + st.deployments.length }; st.deployments.push(d); }
  d.versionNumber = st.versions; d.description = opt('--description');
  console.log(JSON.stringify(d));
}
save();
