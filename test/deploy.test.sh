#!/usr/bin/env bash
# Tests scripts/deploy-webapp.mjs against a fake clasp.
set -u
cd "$(dirname "$0")/.."
T=$(mktemp -d); pass=0; fail=0
ok() { if eval "$1"; then pass=$((pass+1)); else fail=$((fail+1)); echo "FAIL: $2"; fi; }
export CLASP_BIN="$PWD/test/fake/clasp.mjs" CLASP_AUTH="$T/auth.json" FAKE_STATE="$T/state.json" GITHUB_STEP_SUMMARY="$T/summary.md" GITHUB_OUTPUT="$T/out" GITHUB_SHA=abcdef1234
echo '{"tokens":{}}' > "$CLASP_AUTH"
run() { : > "$GITHUB_STEP_SUMMARY"; node scripts/deploy-webapp.mjs > "$T/log" 2>&1; echo $? > "$T/rc"; }

run
ok '[ "$(cat $T/rc)" = 0 ]' 'first deploy succeeds'
ok 'grep -q "Created the CRM web app" $GITHUB_STEP_SUMMARY' 'first deploy creates a deployment'
ok '! grep -q "macros/s/" $GITHUB_STEP_SUMMARY $T/log' 'web app link is never printed (public repo)'
ok 'grep -q "Manage deployments" $GITHUB_STEP_SUMMARY' 'first deploy explains where to find the link'
ok 'grep -q -- "--auth $CLASP_AUTH" <(node -e "console.log(JSON.parse(require(\"fs\").readFileSync(process.env.FAKE_STATE)).calls.join(\"\n\"))")' 'credentials path passed to clasp'

run
ok '[ "$(cat $T/rc)" = 0 ]' 'second deploy succeeds'
ok 'grep -q "Updated your existing CRM web app" $GITHUB_STEP_SUMMARY' 'second deploy updates, not creates'
ok '[ "$(node -e "const s=JSON.parse(require(\"fs\").readFileSync(process.env.FAKE_STATE));console.log(s.deployments.length)")" = 2 ]' 'still exactly one web app deployment (+HEAD)'
ok '[ "$(node -e "const s=JSON.parse(require(\"fs\").readFileSync(process.env.FAKE_STATE));console.log(s.deployments[1].deploymentId)")" = AKfyNEW1 ]' 'same deployment updated (link unchanged)'
ok '! grep -q "macros/s/" $GITHUB_STEP_SUMMARY $T/log' 'link not printed on redeploy'
ok 'grep -q "version 2" $GITHUB_STEP_SUMMARY' 'points at the new version'

# existing manual deployment (made in the editor) is reused
rm -f "$FAKE_STATE"; echo '{"versions":3,"deployments":[{"deploymentId":"HEADID"},{"deploymentId":"AKfyMANUAL","versionNumber":3,"description":"v1.0.0"}],"pushes":0,"calls":[]}' > "$FAKE_STATE"
run
ok 'grep -q -- "--deploymentId AKfyMANUAL" <(node -e "console.log(JSON.parse(require(\"fs\").readFileSync(process.env.FAKE_STATE)).calls.join(\"\n\"))")' 'reuses a deployment created by hand'

# version limit warning
echo '{"versions":185,"deployments":[{"deploymentId":"HEADID"},{"deploymentId":"AKfyX","versionNumber":185,"description":"CRM web app · old"}],"pushes":0,"calls":[]}' > "$FAKE_STATE"
run
ok 'grep -q "186 of 200" $GITHUB_STEP_SUMMARY' 'warns near the 200-version limit'

# failures with helpful hints
for case in "push|User has not enabled the Apps Script API.|script.google.com/home/usersettings" \
            "push|invalid_grant: Token has been expired or revoked.|CLASPRC_JSON secret is missing, expired or revoked" \
            "push|Requested entity was not found.|SCRIPT_ID does not match" \
            "create-deployment|Script has reached the maximum number of versions.|200-version limit"; do
  IFS='|' read -r cmdname msg hint <<< "$case"
  rm -f "$FAKE_STATE"
  FAKE_FAIL_CMD="$cmdname" FAKE_FAIL="$msg" run
  ok '[ "$(cat $T/rc)" = 1 ]' "failure exits non-zero: $msg"
  ok 'grep -qF "$hint" $GITHUB_STEP_SUMMARY' "hint shown for: $msg"
done

# missing credentials file
rm -f "$CLASP_AUTH"; run
ok '[ "$(cat $T/rc)" = 1 ] && grep -q "CLASPRC_JSON" $GITHUB_STEP_SUMMARY' 'missing credentials reported'

echo "deploy script tests: $pass passed, $fail failed"
rm -rf "$T"
[ $fail = 0 ]
