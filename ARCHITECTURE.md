# Architecture

## 1. Requirements in one paragraph

This is a single-user CRM for freelance client acquisition. It follows the pipeline **Prospect → Research → Apply/Contact → Follow-Up → Interview → Proposal → Won/Lost**, with tasks, follow-ups, a calendar, analytics, an activity history, and an Archive and Trash lifecycle. Its persistent storage is the user's own Google Drive folder, which keeps 10 rolling, recoverable versions. Data integrity matters more than storage cleanup. The design also has to leave room for AI features later.

## 2. Why this architecture

| Option | Verdict |
|---|---|
| Remote database + Drive backup | Adds a second service, another account and real hosting costs. It also isn't what was asked for: Drive should be the store, not a backup. |
| Browser-only app + Google OAuth client | Needs a Google Cloud project, a consent screen and a client ID. An existing folder can only be reached with broad scopes, and tokens have to be handled in the browser. |
| **Apps Script web app + Drive file store + local buffer** ✅ | Google handles sign-in, and the code contains no secrets. It runs as the owner with only the owner allowed in. `LockService` provides real locking, and the whole thing deploys from two files. |

**Google Drive is treated as what it is: a file store, not a database.** The design adds the database guarantees on top:

- **Immutable versions.** Every save writes a complete snapshot and never edits an old one.
- **Atomic commit.** The new file is written as `pending_…`, read back, compared byte for byte, and only then renamed to `crm_state_…`. Readers ignore pending files, so a crash halfway through leaves no half-written state.
- **Locking.** `LockService.getScriptLock()` makes saves strictly one at a time, even across tabs and devices.
- **Integrity.** A SHA-256 checksum of the data is computed in the browser, checked by the server, stored in the file and re-verified on every read. If the newest file is damaged, the app opens the newest healthy one.
- **Concurrency.** Each save carries the version it was based on (`baseSeq`). If someone else saved in between, the server answers `CONFLICT` and returns the newer data. The client merges record by record and saves again.
- **Idempotency.** Each save has a `saveId`. If the response is lost and the client retries, the server recognises the save and doesn't write a duplicate.

```
Browser (Index.html)                         Apps Script (Code.gs)                  Drive folder
───────────────────                          ─────────────────────                  ────────────
change ─► Store.mutate ─► localStorage buffer
                      └─► debounce 2.5 s ─► api_save ─► lock
                                                       ─► checksum + baseSeq check
                                                       ─► write pending_crm_state_N.json ─► read back, compare
                                                       ─► rename → crm_state_N.json  (commit)
                                                       ─► list; if > 10: trash oldest
                    ◄─ ok {seq N, created_at} ◄────────┘
"Synced" shown only now
```

## 3. Entities and relationships

| Entity | Key fields | Relationships | CRM equivalent |
|---|---|---|---|
| **Prospect** | company, contact, email, phone, website, title, description, url, sourceId, serviceId, industry, location, timeZone, dates, rate/budget, stageId, priority, temperature, interviewAt, proposalDate, outcome, lost reason, tagIds, custom{}, milestones{}, lifecycle, archive{}, trash{} | belongs to one Stage, Source and Service; has many Tasks, Notes, Activities and Jobs; many-to-many with Tags | GoHighLevel Contact + Opportunity; HubSpot Contact + Deal |
| **Task** | title, dueDate, priority, status (todo, in_progress, done, cancelled), type, prospectId, notes, createdAt, completedAt, source | optionally belongs to a Prospect | Tasks |
| **Follow-up** | a Task with `type: follow_up` | the prospect's "next follow-up" is its earliest open follow-up task | Follow-up tasks / sequences |
| **Note** | body, author, createdAt, editedAt | belongs to a Prospect | Notes |
| **Activity** | type, summary, note, detail, at, by, via | belongs to a Prospect (append-only timeline) | Activity / timeline |
| **Workflow** | trigger, steps[], enabled, exitOnStageChange | triggered by stage changes | Workflows / Sequences |
| **Job** | workflowId, prospectId, stepIndex, runAt | a workflow run that is paused at a Wait step | Workflow wait step |
| **Settings** | stages, sources, services, tags, customFields, archiveReasons, lostReasons, prefs | referenced by id from Prospects | Pipeline config, custom fields, tags |
| **Tombstones** | id → deletedAt | stops merges from bringing permanently deleted records back | — |

Collections are stored as maps keyed by id (`prospects: {id: {...}}`). That keeps lookups fast and makes record-level merging straightforward. Every record has `updatedAt`.

**Milestones.** The first time a prospect reaches Applied, Replied, Interview, Proposal or Won, the timestamp is recorded. Conversion metrics count prospects that *reached* each step, so moving a prospect backwards never undercounts. If a stage was skipped (Applied → Interview), it counts as passed.

## 4. Stored state format

```json
{
  "state_id": "crm_state_000012_2026_10_07_014200",
  "state_number": 12,
  "parent_state_number": 11,
  "created_at": "2026-10-07T01:42:00+08:00",
  "updated_at": "2026-10-07T01:42:00+08:00",
  "application_version": "1.0.0",
  "data_version": "1.0",
  "record_count": 37,
  "counts": { "prospects": 37, "active": 30, "archived": 5, "trashed": 2, "tasks": 64, "notes": 21, "activities": 410 },
  "checksum_sha256": "…",
  "save_id": "…",
  "device_id": "…",
  "restored_from": null,
  "storage_status": "committed",
  "data": { "schema": 1, "settings": {}, "prospects": {}, "tasks": {}, "notes": {}, "activities": {}, "workflows": {}, "jobs": {}, "tombstones": {} }
}
```

- The file name is `crm_state_000012_20261007T014200.json`.
- The file's Drive description holds the same metadata, so the recovery list loads without downloading every version.
- `data` is written last, so its exact bytes can be sliced out and re-hashed when the file is read.

## 5. The 10-state rolling storage

- **What the limit applies to.** A *state* is one complete copy of the whole CRM. The limit is on copies, not on leads: each copy holds every lead, whether there are 10 or 1,000.
- **When the oldest is removed.** Only after the newest state is committed and confirmed as the top of the list does the server move any states beyond the newest 10 to Drive's trash.
- **If the prune fails.** The save still counts as successful, and the next save catches up on pruning.
- **If anything fails before the commit.** Nothing is removed.
- **Restoring an old state** writes it as a *new* newest state, with `restored_from` set. Nothing in the history is deleted, so a restore can itself be undone.
- **No state for tiny changes.**
  - The UI only saves real data changes; view switches and filters are never saved.
  - Saves are debounced: 2.5 s after the last change, and at most 20 s after the first unsaved change.
  - If nothing changed (same checksum), no new state is written.

## 6. Archive vs Trash (record lifecycle)

```
ACTIVE ──archive──► ARCHIVED ──delete──► TRASH ──delete permanently / empty trash──► gone (+ tombstone)
  ▲                    │  ▲                │
  └──── restore ───────┘  └── restore ─────┤   (returns to ARCHIVED if it was archived when deleted)
  ▲                                        │
  └──────────────── restore ───────────────┘   (returns to ACTIVE in its previous stage)
```

**Archive**
- The lead leaves the pipeline, the default lists, task lists, follow-ups and the calendar.
- It stays searchable and still counts in analytics, because it is real history.
- The stage is never changed, so restoring returns it to the same stage. Archive shows the date and reason.

**Trash**
- The lead is hidden everywhere except Trash, and is excluded from analytics.
- Trash shows the previous stage, the date deleted, the source and who deleted it.
- `trash.from` remembers whether the lead was archived, so restoring puts it back in the right place.
- Nothing expires on its own.

**Permanent delete**
- Removes the prospect and its tasks, notes, activities and jobs, and records tombstones.
- It requires a confirmation that uses the exact warning text.

**Lifecycle vs storage versions.** The record lifecycle and the storage versions are independent. Pruning an old version never touches a lead in the current data.

## 7. Sync failure handling

| Situation | Behaviour |
|---|---|
| Offline / network drop | Status shows **Sync Failed ⚠** with the reason. Changes stay in the localStorage buffer. Automatic retries back off (5 s, 15 s, 30 s, 60 s, 2 min, 5 min), the app also retries when the browser reports it's back online, and there is a manual Retry button. |
| Drive API error / upload failure / verify mismatch | Same as above. The server has already discarded the pending file, and nothing was pruned. |
| Expired Google session | The message says to reload and sign in. The buffer keeps the changes. |
| Duplicate sync attempts | Only one sync runs at a time per tab (later changes are queued), the server lock serialises saves, and `saveId` makes retries idempotent. |
| Refresh / browser restart / crash | On open, the buffer is compared with Drive. If it's clean, the Drive version is used. If it has unsynced changes based on the newest version, they are pushed. If it's based on an older version, the two are merged and then pushed. |
| Conflicting updates (two tabs or devices) | `CONFLICT` → record-level merge (the newer `updatedAt` wins per record, and tombstones always win) → save again. When a tab comes back into view, it pulls the newer version if it has no local changes. |
| Damaged newest state | The checksum check fails, so the app opens the newest healthy state and reports which state it skipped. |
| Drive unreachable on first open, no buffer | A clear screen offers **Try again** or **Work offline**. Offline work is merged into Drive later. |

**Honesty rule:** "Synced" and the "Last synced" time come only from a server response confirming a commit, or a successful read from Drive. While there are unsaved changes, the status says so.

## 8. Automations

The model is **Trigger → steps**, where each step is either an **Action** or a **Wait**.

- A Wait step stores a **Job** with a `runAt` time.
- Jobs are processed when the app opens and every minute while it's open.
- Task ids produced by a run are deterministic (`tk_<runId>_<step>`), so a job processed on two devices produces the same task, and the merge de-duplicates it.
- A workflow set to `exitOnStageChange` stops if the prospect has left the stage by the time the wait ends, which is how GoHighLevel workflow goals behave.

Default workflows:
- **Follow-up sequence:** a follow-up task on the chosen date → wait 5 days → a second follow-up, but only if none is open.
- **Interview prep:** a high-priority prep task the day before the interview.
- **Proposal follow-up:** a follow-up task 3 days after the proposal.
- **Client won:** records the win date, closes open follow-ups and creates an onboarding task.
- **Opportunity lost:** records the date and optional reason, and closes open follow-ups.

Built-in stage side effects:
- Entering Applied sets the date applied.
- Entering Proposal sets the proposal date.
- Every stage move goes into the timeline.

**Extending it.** New trigger types (tag added, task overdue, form submitted) and new step types (send email draft, change field, AI step) plug into `runTrigger` / `runSteps` in `model.js`.

## 9. Security

**Passcode lock** (`server/Code.gs` → passcode section). It lets the web app be opened without a Google sign-in, for example on a phone, while the data stays private.

- **Storage.** Only a salted, iterated SHA-256 hash of the passcode is kept in Script Properties.
- **Device tokens.** A correct passcode gets a random device token, valid for 90 days. Only the token's hash is stored, and at most 12 devices are kept.
- **Checks.** Every data call (bootstrap, head, list, get, save) checks the token on the server.
- **First passcode.** Before a passcode exists, only the signed-in owner gets in, and only the owner can set the first passcode. That's why the first passcode is set while the deployment is still private.
- **Wrong guesses.** They're counted in CacheService. After 8, unlocking pauses for 15 minutes.
- **Changing it** requires a valid token and the current passcode, and signs out every other device.
- **Reset.** Running `allowPasscodeReset()` from the editor opens a 15-minute window to choose a new passcode.
- **The link is never printed** in deploy logs or summaries, because the repository is public.

**General**

- No credentials, API keys, OAuth secrets or tokens appear anywhere in the code. Apps Script runs as the owner, and Google handles authentication.
- The deployment is "Only myself", so no one else can open the URL.
- The folder ID is not a secret: it only works for accounts that already have access.
- The script uses the full Drive scope, because that is what Apps Script's `DriveApp` requires to find an existing folder. It only reads and writes files whose names match `crm_state_…` / `pending_crm_state_…` in that one folder.
- The local buffer lives in this browser's storage. On a shared computer, use a private profile.
- All user text is HTML-escaped before rendering, and external links open with `rel="noopener"`.

## 10. Technical limitations

- Each save writes the whole CRM: roughly 1–3 KB per prospect including its history. A few thousand prospects is fine; at tens of thousands, a real database would be the next step.
- Apps Script calls take about 0.5–3 s, and consumer accounts have daily quotas. Debouncing keeps typical use far below them.
- Wait-step automations only run while the app is open. A time-driven Apps Script trigger could run them in the background later.
- The merge works per record, not per field. Two simultaneous edits to the same prospect keep the later one.
- The local buffer belongs to one browser profile. Two tabs in the same browser share it; that works, but one tab is cleaner.
- On phones, drag-and-drop is replaced by the stage selector in the prospect panel.

## 11. Code layout (src/ → built into Index.html)

| File | Responsibility |
|---|---|
| `core.js` | dates, ids, escaping, SHA-256, icons |
| `model.js` | data model, defaults, lifecycle, tasks and follow-ups, automation engine, metrics, analytics, insights, search, merge |
| `sync.js` | Store, local buffer, Drive sync engine, recovery, automation clock |
| `ui_base.js` | shell, rendering, components, modals, toasts |
| `views_main.js`, `views_more.js`, `views_settings.js`, `drawer.js` | screens |
| `actions.js` | event handling, stage-move prompts, drag and drop |
| `sample.js` | fictional sample data, built by replaying real actions |

Tests (in `test/`):
- `server.test.js` runs `Code.gs` against a simulated Drive with fault injection: 64 checks, covering the rolling 10, failure safety, conflicts, idempotency, corruption fallback and restore.
- `e2e.py` drives the real app in Chromium against the real `Code.gs` and the simulated Drive: 85 checks, covering every success criterion, offline, reload, conflict, verify failure and recovery.

## 12. Delivery pipeline (GitHub → Apps Script)

`.github/workflows/deploy.yml` runs on every push to `main`:

1. **Build** `dist/apps-script/`.
2. **Test.** The server tests and the browser end-to-end tests must both pass.
3. **Deploy**, but only if app files changed:
   - `scripts/deploy-webapp.mjs` runs `clasp push --force`.
   - It then updates the **same** web app deployment, so the `/exec` URL never changes.
   - It writes the URL, version number and a warning about Apps Script's 200-version limit to the run summary.

Credentials:
- They come from the `CLASPRC_JSON` repository secret.
- They are written only to the runner's temp folder and deleted at the end of the job.
- They are never printed or committed. `.gitignore` blocks `.clasprc.json` and `.clasp.json`.

Concurrency is serialised, so two deploys never overlap. If a test fails, nothing is deployed and the live CRM keeps running the last good version.

## 13. Ready for AI later

Every AI feature on the roadmap maps onto an existing seam:

- **Job description analysis** fills the same `fields` object that `createProspect` accepts.
- **Lead qualification** writes `temperature`, `priority`, tags and a note.
- **Prospect summaries and follow-up suggestions** read `activitiesOf(id)` and `notesOf(id)`.
- **AI workflow steps** become a new step type in `runSteps`.

An Apps Script function (`api_ai…`) can call a model API with a key kept in Script Properties, so it never reaches the browser.
