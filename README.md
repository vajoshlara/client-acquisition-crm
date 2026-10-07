# Client Acquisition CRM

A personal CRM for running a freelance VA business's client acquisition (Executive Assistance and Social Media Management), from first prospect to won client.

- **Pipeline and follow-ups:** a drag-and-drop pipeline, a follow-up system and tasks
- **Automations:** trigger → action → wait → action
- **Calendar and reporting:** a calendar, a dashboard and analytics
- **History and lifecycle:** activity timelines, and Archive and Trash with full restore
- **Storage:** data lives in the Google Drive folder **08_Claude CRM Project**, which keeps the 10 most recent versions for recovery

It runs as a private Google Apps Script web app. Every push to `main` is tested and deployed automatically by GitHub Actions.

| Doc | What's in it |
|---|---|
| **[DEPLOY.md](DEPLOY.md)** | One-time setup for automatic deploys (start here) |
| **[ARCHITECTURE.md](ARCHITECTURE.md)** | How storage, sync, versioning, automations and the data model work |

## Project layout

```
src/                 the app (HTML shell, CSS, JS modules), built into one Index.html
server/Code.gs       storage server: versioned, verified saves to Google Drive
server/appsscript.json  Apps Script manifest (web app runs as you, only you can open it)
build.py             builds dist/apps-script/ (exactly what gets pushed to Apps Script)
scripts/             deploy script (clasp) and the end-to-end test runner
test/                server tests, browser end-to-end tests, deploy-script tests
.github/workflows/   test + deploy pipeline
```

## Working on it

```bash
python3 build.py                 # -> dist/apps-script/{Index.html, Code.gs, appsscript.json}
node test/server.test.js         # 64 checks: Code.gs against a simulated Drive
bash scripts/run-e2e.sh          # 85 checks: the real app in Chromium (needs: pip install playwright && playwright install chromium)
bash test/deploy.test.sh         # 21 checks: deploy script against a fake clasp
```

`dist/apps-script/Index.html` also opens directly in a browser. In that case it runs in local-only mode, which is useful for trying changes.

### Deploying by hand (fallback)

If you ever need to deploy without GitHub:
1. Run `python3 build.py`.
2. Paste `dist/apps-script/Code.gs` and `Index.html` into the Apps Script editor.
3. Go to **Deploy → Manage deployments**, click the pencil icon, choose **New version**, then **Deploy**.

## Using it day to day

- **Add prospect** (top right): only one of company, contact or title is required. You can paste a job description into the form.
- **Pipeline:** drag cards between stages. Some stages ask a quick question first:
  - **Follow-Up** asks for the follow-up date.
  - **Interview** asks for the date and time.
  - **Lost** asks for an optional reason.

  Every move is written to the prospect's timeline.
- **Board or Grid:** the switch at the top right of the Pipeline page. Grid is a table grouped by stage; change a stage from the row's dropdown.
- **No company named?** For confidential or general applications, a job title is enough. The CRM shows "Company not disclosed".
- **Clients:** Prospects → **Clients** lists current and past clients.
  - **Add client** records one you already work with or worked with before, with start and end dates. It doesn't trigger automations and isn't counted in acquisition stats.
  - Deals you win in the pipeline become current clients automatically.
  - **Mark engagement ended** moves a client to past.
- **Follow-ups:** shows what's overdue, due today, not scheduled, upcoming and done.
  - **Done** marks a follow-up complete and schedules the next one in one step.
  - Hot leads are listed first within each day.
- **Dashboard:** starts with a sentence telling you what needs you today, then today's tasks, follow-ups, interviews, conversion and all the numbers.
- **Archive vs Trash:**
  - **Archive** parks a lead. You can restore it to the same stage.
  - **Delete** sends a lead to Trash. You can restore it from there.
  - Only **Delete permanently** and **Empty Trash** actually remove data, and both ask you to confirm.
- **Settings → Google Drive & recovery:** shows your stored versions. **Restore** brings an older one back as the newest version.
- **Settings → Backup & sample data:**
  - **Load sample prospects** adds fictional prospects, tagged *Sample*, so you can explore every screen. Remove them in one click.
  - **Download backup** saves the current CRM as a JSON file.

Keyboard: `/` jumps to search, and `Esc` closes panels and dialogs.

## Passcode

The CRM link can be opened on any device, with no Google sign-in. A passcode keeps your data private.

- **It asks every time** the CRM is opened, refreshed or reopened. On a device you trust you can tick **Keep this device unlocked for 90 days** on the passcode screen; undo it in **Settings → Passcode & devices**.
- **Settings → Passcode & devices** lets you change the passcode, sign out other devices, or lock the current device.
- **The server checks it.** Without the passcode, the server refuses to send or change any data, even to someone who has the link. After 8 wrong tries it pauses for 15 minutes.
- **First time, or forgot it?** On the lock screen tap **Forgot passcode?** (or **Get a setup code** the first time).
  1. The CRM saves a one-time code as **CRM passcode setup code** in your Drive folder **08_Claude CRM Project**.
  2. Open that file in the Google Drive app (or drive.google.com) and type the code on the CRM screen within 30 minutes.
  3. Choose your new passcode. The code works once, and the file moves to the trash by itself.

  Only someone who can open your Google Drive can read the code, so the link alone is never enough.

## Things to know

- **Use one tab at a time when you can.**
  - Two tabs or devices are handled: saves are version-checked and merged record by record.
  - If the same prospect is edited in two places at nearly the same moment, the later edit wins for that prospect.
- **Saves happen a few seconds after you stop typing**, and never more than 20 seconds after a change.
  - The sidebar shows "Unsaved changes" or "Saving…" until Drive confirms the save.
  - If you close the tab during that window, the change is kept in this browser and syncs the next time you open the CRM here.
- **Automations with a wait step** (for example, a second follow-up 5 days later) run the next time the CRM is open after the wait ends. Apps Script web apps don't run in the background on their own.
- **Pruned versions go to Drive's trash, not straight to deletion**, so Google keeps them for 30 days as an extra safety net.
- **Opened as a plain file** (double-clicking `Index.html`), the app runs in *local-only* mode.
  - Data stays in that browser, and it clearly says *Not connected*.
  - This is handy for a portfolio demo with sample data. It is not where your real data should live.

## For a portfolio

Describe it honestly: *"A client-acquisition CRM I designed and built for my own freelance VA business, and as a hands-on way to learn how CRMs like GoHighLevel and HubSpot work. It covers pipelines, follow-up workflows, automation, reporting and Google Drive data persistence."*

For a live demo, host the built `dist/apps-script/Index.html` on its own (for example on Netlify) and load the sample data. It will show *Not connected*, which is accurate for a demo.
