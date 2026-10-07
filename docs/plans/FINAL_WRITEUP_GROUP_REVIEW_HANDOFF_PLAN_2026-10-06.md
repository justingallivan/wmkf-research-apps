---
title: Final Writeup group-review handoff — PD drafting, PD sign-off, leadership digest
status: approved 2026-10-06 — Stages 1–2 live; Stages 3–5 not built
created: 2026-10-06
owner: Justin Gallivan
related:
  - docs/FINAL_WRITEUP_REVIEW_IMPLEMENTATION_PLAN.md
  - docs/plans/STAFF_DELIBERATIONS_STATUS_CLARITY_PLAN_2026-10-04.md
  - docs/plans/CYCLE_ROLLOVER_MINIMAL_CONFIGURATION_PLAN_2026-10-06.md
---

# Final Writeup group-review handoff

## 1. Owner intent (2026-10-06, Session 580)

1. **Step 4 is the lead PD drafting alone.** Other staff do not see the writeup in the apps
   until the lead PD hands it off. This is app-level hiding only; SharePoint permissions are
   not changed ("hidden in the apps, not protected").
2. **The lead PD presses "Ready for group review"** on Staff Deliberations step 4 when the draft
   is ready. The Research program's PDs are told by email, and the writeup appears in their
   Final writeups view.
3. **Group review is mainly the other PDs commenting and editing** in the same Word file, then
   signing off.
4. **The lead PD must be able to see who has signed off** before sending to leadership. Sign-off
   is not required: not every PD or support-staff member will sign off, so the lead PD can send
   to leadership at any time.
5. **Leadership (President, CSO) learns of new writeups through a daily digest email**, sent by a
   cron at midnight.
6. **Releasing too early is not a problem**, because everyone can still edit. No pull-back is
   needed.
7. **Wording:** "Ready for group review", "Sign off" (replaces "Mark reviewed"), "Send to
   leadership".
8. **Scope:** Research program only for now; SoCal can be added later.

## 2. Built state this plan changes

Checked in source on 2026-10-06:

- **Step 4 heading and actions.** Step 4 summary reads "Locked for review" during post-visit
  editing (`shared/components/workbench/StaffDeliberationsTab.js:1215`), but nothing is locked.
  The only action is "Open writeup in Word" (`:1464`). Step 5's "Open group-review details" only
  switches tabs (`:1544`).
- **Start action.** "Start group review" is only on the Final writeup tab
  (`shared/components/workbench/FinalWriteupTab.js:~640`).
  - Route: `POST /api/workbench/final-writeup` → `startFinalWriteup`
    (`lib/services/final-writeup/transition-service.js:33`).
  - Lead PD or superuser only (`transition-model.js:136-140`).
  - Records the Word version only; it sends no email.
- **Word link before handoff.** Any `reviewers` user who opens the request page gets the Word
  link before handoff. The Pre-Site projection always returns `webUrl`
  (`lib/services/pre-site-visit/artifact-model.js:411`).
- **Sign-off.** "Mark reviewed" acknowledgements exist (`acknowledgement-service.js`). Each one is
  keyed to the SharePoint publication version, and any later file change shows it as "Updated
  since your review" (`:311`).
- **Who can see sign-off status.** The full expected-reviewer matrix is visible only to
  superusers and PCs (`dashboard-service.js:676-678`). The lead PD sees only "Reviewed by"
  (people who acknowledged).
- **PD roster.** The published staffing setting `final_writeup.matrix_audiences` v2 holds:
  - per-person persona assignments (PD / PC / leadership);
  - per-Grant-Program `reviewerIds` lists (`matrix-audience-service.js`).
- **Leadership review and email.** "Start leadership review" is lead PD or superuser only and
  notifies nobody (`transition-service.js:190-345`). No final-writeup code sends email.
- **Reuse candidates:**
  - The per-PD daily digest in `scheduled-email-service.js:754`: per-(recipient, UTC day) run-row
    lease, frozen membership receipts, system sender `NOTIFICATION_EMAIL_FROM`.
  - The staff-send recovery pattern in `lib/services/meeting-tracker/agenda-service.js`.

## 3. Owner decisions (resolved 2026-10-06: A yes, B as recommended, C defaults accepted)

**A. Edits made after a sign-off.** In group editing, almost every sign-off will be followed by
someone's edit. Recommendation (simplest): keep the stored model unchanged, and change only how
it is displayed and counted. A sign-off on an earlier version still counts, with an "edited
since" note. **Decided: yes.**

**B. How "Research only for now" is realized.** **Decided as recommended:** no new allowlist (per the
minimal per-cycle configuration rule).
- Handoff email recipients = the request's Grant Program entry in the staffing setting ∩ PD
  persona, minus the lead PD.
- "Research only" then holds because only Research has a program entry, and adding SoCal later
  means publishing one more program entry.
- Not yet checked: whether the live setting already has a SoCal entry. If it does, SoCal
  requests would email too. Pre-build probe (owner-run, since it reads Production): read
  `final_writeup.matrix_audiences`.

**C. Smaller choices (defaults accepted):**
- **Handoff email sender:** the system mailbox (`NOTIFICATION_EMAIL_FROM`), naming the lead PD in
  the body. The alternative is sending as the lead PD, which requires their Dynamics sender
  identity.
- **"Midnight":** Pacific time. Vercel cron is UTC, so this is `0 7 * * *` (midnight PDT; 11pm
  PST). The digest day is computed in Pacific time.
- **Final writeup tab:** the "Start group review" button becomes a secondary entry with the same
  wording.
- **"Prepare for post-visit editing":** today any `reviewers` user can press it. Make it lead PD
  or superuser, consistent with hiding.

## 4. Stages

Each stage ships separately, on a branch, with a Codex adversarial review; this is Tier 1–3
runtime work. Stage 1 is the original ask and ships first.

### Stage 1 — Step 4 handoff action (UI only, no new route) — live 2026-10-06 (PR #452, merge `40b70a145`)
- Step 4 title: "Post-presentation writeup" (owner 2026-10-06). During
  post-visit drafting the summary reads "Post-visit drafting" instead of "Locked for review".
- Step 4 actions: **Edit writeup in Word** and **Ready for group review**.
  - The button reuses `POST /api/workbench/final-writeup`.
  - The pre-site-visit status's `finalReview` fact now carries `canStart`,
    `startBlockedReason` and `sourceArtifactId` from `getFinalWriteupStatus`
    (`lib/services/pre-site-visit/status-facts.js`), so there are no duplicated preconditions.
  - It is shown only when `canStart`.
- Other viewers see one of:
  - "The lead Program Director marks this ready for group review when the draft is done.";
  - the schedule-block reason.
- An in-progress (202) start shows "Starting group review…".
- Step 5 summary: "Starts when the writeup is marked ready for group review"; the tab-switch-only
  "Open group-review details" button is removed.
- Final writeup tab: "Start group review" → "Ready for group review"; "Start leadership review"
  → "Send to leadership".
- Stage 1 hides nothing; Stage 2 does.

### Stage 2 — Hide the draft before handoff (server-side) — live 2026-10-06 (PR #453, merge `b47a70eae`)

**Owner decisions (2026-10-06):**
- Program Coordinators can see the draft.
- The optional draft made before the presentation is private too.

**Defaults, stated to the owner:**
- **PCs** = anyone holding the Program Coordinator persona in the published Final Writeup staffing
  setting. This is the same rule the Final writeups dashboard already uses, with no per-program list
  that could leave a PC out. Built 2026-10-06.
- **Read vs. change.** PCs can read the draft. Changes stay with the lead PD and superusers:
  - generate and regenerate (AI cost; replaces the file);
  - "Prepare for post-visit editing";
  - linking the draft into a distribution email.
- **Lifecycles.** Hidden in DRAFT (including a correction DRAFT) and REVIEW. Unchanged from FINAL
  (group review) onward.
- **No lead PD on the request:** only superusers and PCs see the draft.
- **Distribution snapshots** of the Pre-Site row stay visible. They are frozen copies that were
  already sent.

**Viewer and predicate.** One shared module resolves the viewer once per request:
`{ isSuperuser, actingUserSystemId, coordinatorProgramIds }`.
- PC persona resolution fails closed: an error or a disabled setting means "not a coordinator".
  The lead PD and superuser paths are unaffected.
- `canSeeDraftWriteup(viewer, { leadPdId, grantProgramId })` is true for a superuser, for the
  lead PD by `sameId`, or for a PC of that program.
- `redactDraftWriteup(artifact, …)` returns the artifact with `file: null` and `fileHidden: true`
  when the viewer can't see it and the lifecycle is DRAFT or REVIEW (not a distribution snapshot).

**Producers to route through the redactor.** From the 2026-10-06 exposure survey:
1. `GET /api/workbench/pre-site-visit`:
   - `currentArtifact`;
   - `pendingArtifact`;
   - `writeup.file` (from `getPreparationForRequest`).
2. `GET /api/workbench/final-writeup` in phase ready or starting: `sourceFile` and `pendingArtifact`.
3. `GET /api/workbench/staff-deliberations`: per-row `writeup.file`, plus the legacy top-level
   `file` when the row is the Pre-Site writeup. The list already selects
   `_wmkf_programdirector_value` and `_wmkf_grantprogram_value`.
4. `GET /api/workbench/site-visit/logistics`: drop non-snapshot DRAFT and REVIEW Pre-Site rows from
   `materials`.
5. Distribution `prepare` / `send`: no change needed. Email material links were retired on
   2026-09-10, and the server refuses any selection (`distribution/composition.js:188-196`).

**Changes gated to the lead PD or a superuser (403 with a code):**
- `POST /api/workbench/pre-site-visit` (generate/regenerate);
- `POST /api/workbench/pre-site-visit/start-site-visit`.

The automatic preparation worker is a system actor and is unaffected.

**UI.**
- When `fileHidden` is set, Staff Deliberations step 4 shows:
  - status from `lifecycleState`, not from whether a file is present;
  - "The lead Program Director is drafting this writeup.";
  - no Word, download or regenerate actions.
- The existing "No current Word link was returned" read-only notice must not fire for
  hidden-by-design.
- A lead PD whose account has no linked Dynamics user gets an explicit message, not silent hiding.

**Tests.**
- For each producer, a discriminating case for each of:
  - a non-lead viewer (no `webUrl`, `fileHidden`);
  - the lead PD;
  - a PC;
  - a superuser.
- The change routes return 403 for others.
- The predicate is mutation-checked.
- A test enumerates the producers, so a new surface must be added deliberately.

**Gates.** `docs/API_ROUTE_SECURITY_MATRIX.md`, `check:api-routes`, `check:route-lifecycle-auth`,
`check:trust-boundary-guid`.

**Before merge (owner-run probe):** read the Production `final_writeup.matrix_audiences` setting.
The PCs must hold the Program Coordinator persona, or they lose sight of drafts when this deploys.
**Done 2026-10-06:** the owner published Program Coordinator for Connor, Sarah and Duncan.

**Accepted gap (owner 2026-10-06):** Dynamics Explorer still lists and downloads files in the
request's `Artifacts/Pre-Site Visit` folder (`lib/services/dynamics-explorer/tools/documents.js`,
`pages/api/dynamics-explorer/download-document.js`). The owner treats it like browsing SharePoint
directly, so it is not guarded (Codex re-review finding, 2026-10-06).

### Stage 3 — Sign-off view for the lead PD

**Built on branch `feature/writeup-signoff-view` (Session 581, 2026-10-07); not merged or live.**
- The acknowledgement GET and POST return `signOffRoster` for the lead PD and superusers only.
- Roster statuses separate "no list for this program" and "staffing not published" from an
  empty list, so a request outside a configured program never reads as fully signed off.
- "Mark reviewed" became "Sign off" on the Workbench tab and on the Final writeups action
  button. The Final writeups view names ("Needs my review", "Reviewed by me") and matrix labels
  are unchanged and remain an open wording question.
- Rename "Mark reviewed" → "Sign off".
- Per-request projection visible to the lead PD and superusers:
  - expected PDs = program audience ∩ PD persona, minus the lead;
  - each person: signed off / signed off (edited since) / not yet;
  - names only, no internal IDs.
- PC and other staff sign-offs stay allowed and are listed, but are not counted against the PD
  total.
- **Send to leadership** stays available at any time. If some PDs have not signed off, the
  confirmation names them ("2 PDs haven't signed off — send anyway?").

### Stage 4 — Handoff email to Research PDs

**Decision B probe, partly answered:** `docs/SERVICE_AND_UTILITY_CATALOG.md` records the v2 setting
published 2026-09-01 with a nine-person Research audience and a six-person Southern California
audience [VERIFIED via catalog entry, not a live read]. If that SoCal entry is still published,
SoCal requests would also get the handoff email under decision B.

**SoCal is parked (owner, 2026-10-07):** "I don't know the Southern California program workflow
well enough to design this now." Do not design SoCal behavior until the owner raises it. Before
Stage 4 ships, show the owner what the live setting would send for SoCal requests; do not
silently include or exclude them.
- Sent after the transition is recorded, never inside the transition changeset. It has its own
  claim/receipt row with recovery, so a failed send never undoes or blocks the handoff, and a
  retry never sends twice.
- Subject and body come from settings keys (pattern `email.deliberation_agenda.*`), not code.
- Check `email-automation-preferences.js` for an applicable opt-out.
- TEST requests follow the existing test-isolation email policy.
- New table → migration, Atlas, and service catalog. Run `/contract-reconcile` before building
  (partial success, background send).

### Stage 5 — Leadership daily digest
- Daily cron at 00:00 Pacific. Each leadership-persona recipient gets one email listing writeups
  that entered leadership review since their last digest.
- No email when the list is empty.
- Modelled on the scheduled-email digest:
  - per-(recipient, Pacific day) run row with a lease;
  - receipts stamped only from the run's frozen membership;
  - Dynamics correlation key as backstop.
- New cron → `vercel.json`, scheduled-job census test, API route security matrix, cron auth
  pattern, Atlas.

## 5. Durable statements to reconcile when stages land

- `FinalWriteupTab.js:484,626,673-674`: "does not send email" / "Nobody is notified" (Stages 4–5).
- `docs/FINAL_WRITEUP_REVIEW_IMPLEMENTATION_PLAN.md`:
  - deferred list (edit notifications, required reviewer counts);
  - invariant row at ~:261 (Staff Deliberations Word link removed after transition; the code
    still shows it);
  - status contradiction (header :37 "awaiting Production promotion" vs body :627 "live
    2026-09-07").
- `docs/CURRENT_WORK_QUEUE.md` entry for the group-review handoff: update it at each promotion.
- Button wording now diverges from `FINAL_WRITEUP_REVIEW_IMPLEMENTATION_PLAN.md`
  ("Ready for leadership review"); owner chose "Send to leadership" (2026-10-06).
- Agent wiki topic covering Final Writeup / Staff Deliberations.

## 6. Out of scope

- SharePoint permission changes.
- Pulling a writeup back from group review.
- Required sign-off counts.
- An email to the lead PD when the last PD signs off. This was not requested; revisit if wanted.
- Anything after leadership review: final/complete state, board package.
- SoCal workflow and configuration. Parked by the owner on 2026-10-07 until they raise it again.
