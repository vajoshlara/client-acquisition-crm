# One-time setup: automatic deploys from GitHub to Apps Script

When this is done, every change pushed to `main` is tested and then goes live in your CRM about 5 minutes later. You never copy and paste code again, and the CRM's link never changes.

```
push to main ─► GitHub Actions ─► build ─► 170 automated checks ─► clasp push ─► update the same web app deployment
```

You do the four steps below once. They take about 10 minutes. Use the Google account that owns your CRM folder (`vajoshlara@gmail.com`) throughout.

---

## Step 1 — Create the Apps Script project and copy its Script ID

1. Open **https://script.google.com** and click **New project**.
   - If you already created a project by hand earlier, use that one instead. The workflow will take over its existing deployment, so your bookmark keeps working.
2. Click **Untitled project** and rename it to **Client Acquisition CRM**. Leave the code as it is; the first deploy replaces it.
3. Click the **gear icon (Project Settings)**. Under **IDs**, copy the **Script ID**. It's a long string that starts with `1`.
4. Save it in GitHub:
   1. Open your repository → **Settings** → **Secrets and variables** → **Actions**.
   2. Open the **Variables** tab and click **New repository variable**.
   3. Set **Name** to `SCRIPT_ID` and **Value** to the Script ID.
   4. Click **Add variable**.
   - You can also just send the Script ID to Claude, who can add it for you. It isn't a password.

## Step 2 — Turn on the Apps Script API

Open **https://script.google.com/home/usersettings** and switch **Google Apps Script API** to **On**.

The deploy tool needs this. It can take a minute or two to take effect.

## Step 3 — Create the deploy key and store it as a GitHub secret

The deploy key lets GitHub update your Apps Script project. You'll create it in **Google Cloud Shell**, a free terminal in your browser, so nothing needs installing.

1. Open **https://shell.cloud.google.com**. If asked, accept the terms. You don't need to pick a Google Cloud project.
2. Paste this command and press Enter:
   ```
   npx --yes @google/clasp@3.4.1 login --no-localhost
   ```
3. It prints a link. Open it and choose **vajoshlara@gmail.com**.
4. Review what **clasp** (Google's official Apps Script tool) asks for, then click **Allow**.
5. Your browser lands on a page that **fails to load**, with an address starting `http://localhost:8888/?state=…&code=…`. **That's expected.**
6. Copy the **whole address** from the address bar. Paste it into Cloud Shell and press Enter. You should see that you're logged in.
7. Show the key:
   ```
   cat ~/.clasprc.json
   ```
   Copy **all** of the output, from the first `{` to the last `}`.
8. Save it in GitHub:
   1. Go to your repository → **Settings** → **Secrets and variables** → **Actions**.
   2. Open the **Secrets** tab and click **New repository secret**.
   3. Set **Name** to `CLASPRC_JSON`, paste the key as the **Secret**, and click **Add secret**.
9. Remove the copy from Cloud Shell:
   ```
   rm ~/.clasprc.json
   ```
   GitHub keeps its encrypted copy, and that copy keeps working.

**About this key**
- **It's powerful.** It can manage your Apps Script projects and parts of your Google Cloud account.
- **Where it lives.** Only in GitHub's encrypted secrets. Workflows can use it, but nobody can read it back, including you.
- **Keep it safe.** Keep the repository private, and don't give anyone else write access to it.
- **Revoking it.** At any time, go to **https://myaccount.google.com/permissions**, find **clasp – The Apps Script CLI**, and remove access. Deploys then stop until you create a new key.

> Have Node.js 20+ on your own computer? You can run the same command there instead of Cloud Shell. The file is in your home folder: `~/.clasprc.json` on Mac/Linux, `%USERPROFILE%\.clasprc.json` on Windows.

## Step 4 — Run the first deploy

1. In your repository, open the **Actions** tab.
2. Choose **Test and deploy to Apps Script** → **Run workflow** → **Run workflow**.
3. Wait about 5 minutes. Most of that is the tests.
4. Open the finished run. The summary shows:
   > **Your CRM:** https://script.google.com/macros/s/…/exec
5. Open that link once and allow access:
   - **Review permissions** → your account → **Advanced** → **Go to Client Acquisition CRM (unsafe)** → **Allow**.
   - "Unsafe" only means Google hasn't reviewed an app you wrote for yourself.
6. **Bookmark the link.** Every future deploy updates this same address.

After step 4, the sidebar should show **Google Drive: Connected ✓**, and the first stored state appears in **06_ChatGPT CRM Project**.

---

## What happens on each push

| You push… | The workflow… |
|---|---|
| App changes (`src/`, `server/`, `build.py`) | runs all tests, then deploys if they pass |
| Docs only (`*.md`) | runs tests, skips the deploy (saves Apps Script versions) |
| Anything, while tests fail | **does not deploy**, so your live CRM keeps running the last good version |
| Anything, before setup is finished | runs tests and shows "Deploy waiting for setup" |

**Run workflow** on the Actions tab always deploys.

## Troubleshooting

Every failed run's summary starts with **What to do**. Common causes:

| Message | Fix |
|---|---|
| Turn on the Google Apps Script API | Do step 2, wait a minute, then click **Re-run jobs** |
| CLASPRC_JSON is missing, expired or revoked | Redo step 3 and update the secret. Keys stop working if revoked, or if unused for about 6 months. |
| SCRIPT_ID does not match | Copy the Script ID again (step 1) |
| 200-version limit | Apps Script keeps at most 200 versions. In the Apps Script editor, open **Project history** and bulk-delete old versions. The summary warns you once you pass 180. |
| Tests failed | Nothing was deployed. Download the **e2e-screenshots** artifact from the run to see what broke. |

To point the workflow at a specific existing deployment, add a repository variable `DEPLOYMENT_ID`. You can find the ID in the editor under **Deploy → Manage deployments**. Normally you don't need this.
