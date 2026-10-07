// Pushes dist/apps-script/ to Google Apps Script and points the CRM web app at the new version.
//
// The web app keeps the same /exec URL forever: the first run creates one deployment
// (described "CRM web app …"), every later run updates that same deployment.
//
// Environment:
//   CLASP_AUTH      path to the clasp credentials file (written from the CLASPRC_JSON secret)
//   CLASP_PROJECT   path to .clasp.json (default: .clasp.json)
//   DEPLOYMENT_ID   optional: force a specific deployment to update
//   CLASP_BIN       optional: path to a clasp executable (tests use a fake one)
//   GITHUB_STEP_SUMMARY, GITHUB_SHA  provided by GitHub Actions

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const CLASP = process.env.CLASP_BIN ? [process.env.CLASP_BIN] : ['npx', '--yes', '@google/clasp@3.4.1'];
const AUTH = process.env.CLASP_AUTH;
const PROJECT = process.env.CLASP_PROJECT || '.clasp.json';
const SUMMARY = process.env.GITHUB_STEP_SUMMARY;
const SHA = (process.env.GITHUB_SHA || 'local').slice(0, 7);
const TAG = 'CRM web app';
const VERSION_LIMIT = 200;

function summary(md) {
  if (SUMMARY) fs.appendFileSync(SUMMARY, md + '\n');
  console.log(md.replace(/^#+ /gm, ''));
}

const HINTS = [
  [/Apps Script API|has not enabled|User has not enabled/i,
    'Turn on the Google Apps Script API at https://script.google.com/home/usersettings, wait a minute, then re-run this workflow.'],
  [/invalid_grant|invalid_client|unauthorized_client|Login Required|No credentials|not logged in|authorization/i,
    'The CLASPRC_JSON secret is missing, expired or revoked. Create a new one (DEPLOY.md, step 3) and update the secret.'],
  [/Requested entity was not found|not found|404/i,
    'The SCRIPT_ID does not match an Apps Script project you own. Copy it again from Project Settings in the Apps Script editor.'],
  [/maximum number of versions|version limit|200 versions/i,
    'The Apps Script project has reached Google\'s 200-version limit. In the Apps Script editor open Project history and bulk-delete old versions, then re-run.'],
  [/permission|forbidden|403/i,
    'Google refused the request. Check that the CLASPRC_JSON secret was created with the same Google account that owns the Apps Script project.']
];

function clasp(args) {
  const argv = [...CLASP.slice(1), '--auth', AUTH, '--project', PROJECT, '--json', ...args];
  try {
    const out = execFileSync(CLASP[0], argv, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 20 * 1024 * 1024 });
    const start = out.search(/[\[{]/);
    return start < 0 ? null : JSON.parse(out.slice(start));
  } catch (e) {
    const detail = [e.stderr, e.stdout, e.message].filter(Boolean).join('\n').trim();
    const hint = (HINTS.find(([re]) => re.test(detail)) || [null, ''])[1];
    const err = new Error(`clasp ${args[0]} failed.\n${detail}`);
    err.hint = hint;
    throw err;
  }
}

function main() {
  if (!AUTH || !fs.existsSync(AUTH)) throw Object.assign(new Error('No clasp credentials file.'), { hint: HINTS[1][1] });

  const pushed = clasp(['push', '--force']) || [];
  console.log('Pushed files:', pushed.join(', '));

  const deployments = (clasp(['list-deployments']) || []).filter(d => d.versionNumber != null);
  let target = null;
  if (process.env.DEPLOYMENT_ID) target = deployments.find(d => d.deploymentId === process.env.DEPLOYMENT_ID) || { deploymentId: process.env.DEPLOYMENT_ID };
  if (!target) target = deployments.find(d => (d.description || '').startsWith(TAG));
  if (!target && deployments.length) target = deployments.slice().sort((a, b) => b.versionNumber - a.versionNumber)[0];

  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  const description = `${TAG} · ${stamp} · ${SHA}`;
  const args = ['create-deployment', '--description', description];
  if (target) args.push('--deploymentId', target.deploymentId);
  const result = clasp(args);

  let versionNote = '';
  try {
    const versions = clasp(['list-versions']) || [];
    const n = versions.length;
    if (n >= VERSION_LIMIT - 20) {
      versionNote = `\n> ⚠️ This project has **${n} of ${VERSION_LIMIT}** Apps Script versions. Delete old ones soon: Apps Script editor → Project history → bulk delete.`;
    } else {
      versionNote = `\nApps Script versions used: ${n} of ${VERSION_LIMIT}.`;
    }
  } catch (e) { /* informational only */ }

  // The repository is public, so the web app link is never printed here (logs and summaries are visible to anyone).
  summary(`## ✅ Deployed to Apps Script
${target ? 'Updated your existing CRM web app' : '**Created the CRM web app** (first deploy)'} to **version ${result.versionNumber}** from commit \`${SHA}\`. Your CRM link is unchanged.
${target ? '' : '\nFind the link in the Apps Script editor: **Deploy → Manage deployments → Web app URL**. Open it once to allow access, then bookmark it.\n'}${versionNote}`);

}

try {
  main();
} catch (e) {
  summary(`## ❌ Deploy failed\n${e.hint ? '**What to do:** ' + e.hint + '\n\n' : ''}<details><summary>Details</summary>\n\n\`\`\`\n${String(e.message).slice(0, 4000)}\n\`\`\`\n</details>`);
  process.exit(1);
}
