# Session 579 Prompt: merge the Workbench / Staff Deliberations UX branch, then Meeting Tracker follow-ups

## Session 578 Summary — 2026-10-06 PT (Claude)

Owner-led review of the overnight `feature/workbench-ux` branch on localhost,
followed by a redesign of the Staff Deliberations list and request tab, plus
dependency security fixes released to Production. **The UX branch is pushed and
NOT merged** (`origin/feature/workbench-ux`, current `main` merged in at
`419392a0a`). No PR is open yet.

### What Was Completed

1. **Released to Production (main)**
   - `8d597ec94` J27 register: J27-083 rebound to a literal fragment (`check:j27-register` was red at start).
   - PR #447 (merge `90468b68e`, deployment succeeded): http-cache-semantics 4.3.0, sharp override 0.35.5, proxy-addr 2.0.8, source-map-js 1.2.2. Dependabot #115/#117/#118 dismissed by the owner as tolerable risk (build-time only or no upstream fix); #116 auto-fixed. 0 open alerts. Record: `docs/CURRENT_WORK_QUEUE.md` (merged with this branch).
2. **Staff deliberations list** (`StaffDeliberationsPanel.js`): Reviewer follow-up style cards — `#number` + full title; "Institution · PI · PD" (new `projectLeader`, read-only `_wmkf_projectleader_value` in `cycle-list-service.js`); stage chip (gray Before, blue After, violet review, amber issue/Not scheduled) + time; next step that names the request-page action, or the specific attention reason (`attentionReason()`, shared with the Needs-attention filter); one ink "Open request"/"Open review" button deep-linking to `#deliberations-status|briefing|writeup`. No Word shortcut (editing happens beside Share/Finish corrections on the request page). Corrections before the presentation keep the Before stage.
3. **Request page Staff Deliberations tab** (`StaffDeliberationsTab.js`): no status card; five-step stepper — Pre-site briefing → Deliberation session → Presentation → Working writeup → Group review (renamed "Group and leadership review" during leadership review). Current step dark, done green; non-current steps fold description/file details/warnings behind Details; every action keeps its exact condition and label. Problem notice above the steps only when something is wrong. Briefing summary "Shared <date> to N people" from the email panel's accepted send. Recording, transcripts and the presentation summary render inside the Presentation step (`ResearchPresentationFollowUp.js`, published items only, no file names; summary clamped only when Read more exists). One-time scroll to the linked card after the status read. One date format ("Oct 16, 11:00 AM PDT").
4. **Meeting Tracker session page** (`SessionEditor.js`): proposal order opens read-only with "Edit proposal order" / "Done" (changes still save immediately); briefing slot copy fixed.
5. **Reviews:** Codex adversarial review ×2 — four medium findings, all fixed with mutation-checked tests.
6. **Vocabulary held for a group decision:** `docs/NOMENCLATURE_GLOSSARY.md` → "Deliberations workflow vocabulary — OPEN, decide suite-wide after D26" (owner: no panel-by-panel renames). Memory `project-deliberation-session-precedes-site-visit`.

### Verification (branch head `37942a1d8` + docs commit)

Full Jest 20948 passed / 157 skipped / 0 failed; `npm run build` passes; every
`check:*` gate and self-test green; Impeccable detector clean on changed UI
(one pre-existing gray-on-color warning in `SessionEditor.js` status pill).
Real-data browser checks on localhost: #1002874, #1002852, TEST #1003222, the
Sep 11 Meeting Tracker session (read-only only; nothing saved).

### Local dev gotcha

Localhost needs these readiness settings or Staff Deliberations hides data.
On the command line (NOT in `.env.local`): `MEETING_TRACKER_SCHEMA_READY=on SITE_VISIT_MATERIALS_SCHEMA_READY=on npm run dev`;
already in the owner's `.env.local`: `SITE_VISIT_LOGISTICS_SCHEMA_READY=on`, `STAFF_DELIBERATIONS_SITE_VISIT_STATE_STATUS_PAIRS`
and `POST_PRESENTATION_MATERIALS_SCHEMA_READY`/`_ACCESS` (values copied from Vercel Production; the state/status map is
also recorded in `docs/plans/STAFF_DELIBERATIONS_STATUS_CLARITY_PLAN_2026-10-04.md:217`).
Localhost reads Production; Dataverse writes are interlock-blocked, Postgres and
email are not — never press Save/Send/Generate during reviews.

## Next Items

### Verified Open

1. **Open the PR for `feature/workbench-ux`, final Codex review, merge on owner OK.**
   Evidence: `git log origin/main..origin/feature/workbench-ux` (29 non-merge commits). One PR (owner accepted the recommendation 2026-10-06). `main` auto-deploys; UI-only except the read-only PI select. Revert path: Vercel Instant Rollback or revert the merge.
2. **Meeting Tracker follow-ups (owner: "more stuff on the meeting planner", later session).** Owner has not listed them yet — ask first. Known starting points:
   - **A session that fails to load shows an empty, saveable form** (`SessionEditor.js`; reproduced with an invalid `cycleCode`). Saving could overwrite the session with blanks. Highest priority: data-loss shape.
   - **Slot "Briefing not yet shared" can be stale:** TEST #1003222's session slot says not shared while its Workbench briefing shows "Shared Sep 18". The slot's briefing source differs from the Workbench sharing history.
3. **Corrections flag mismatch (server contract).** Evidence: list uses document-row `wmkf_reopencycleid` (`lib/services/pre-site-visit/cycle-list-service.js:570`); request page uses `currentArtifact.correction.cycleId` (`pages/api/workbench/pre-site-visit.js:59`). #1002852 shows corrections on the list but not on the request page. Needs `/contract-reconcile`.
4. **List next step for a ready briefing** could say "share it before the deliberation session"; needs the session date in the list payload (server change, small).
5. **Server warning copy** "…generated before the Dataverse fill" (`lib/services/pre-site-visit/artifact-model.js:290-291`).

### Owner Decision Needed

1. **Deliberations vocabulary** — after D26, as a group; then rename suite-wide in one pass. Evidence: `docs/NOMENCLATURE_GLOSSARY.md` section above; `docs/CURRENT_WORK_QUEUE.md` item.
2. **Task grouping on the Staff deliberations list** — not raised again after the card redesign; treat as dropped unless the owner reopens it.

### Do Not Reopen Without New Decision

1. **Deliberation sessions dated before the site visit are normal** (owner 2026-10-06; memory `project-deliberation-session-precedes-site-visit`). TEST #1003222's history gaps are expected.
2. **No Word shortcut on the Staff deliberations list** (owner 2026-10-06: the next action after editing lives on the request page).

## Key Files Reference

| File | Purpose |
|------|---------|
| `shared/components/workbench/StaffDeliberationsPanel.js` | Staff deliberations list cards, stage, attention reasons, deep links |
| `shared/components/workbench/StaffDeliberationsTab.js` | Request-page stepper, notices, anchors, materials placement |
| `shared/components/workbench/ResearchPresentationFollowUp.js` | Recording / transcripts / summary inside the Presentation step |
| `lib/services/pre-site-visit/cycle-list-service.js` | List projection (now includes `projectLeader`) |
| `shared/components/meeting-tracker/SessionEditor.js` | Session page: read-only details + proposal order |
| `docs/NOMENCLATURE_GLOSSARY.md` | Open vocabulary register for the post-D26 decision |

## Testing

```bash
npx jest tests/unit/staff-deliberations tests/unit/research-presentation-follow-up tests/unit/meeting-tracker tests/unit/workbench-shell tests/unit/pre-site-visit-cycle-list-service
npm run check:types && npm run build
```

---

# Prior handoff: Staff Deliberations UI review in a separate session

## Session 577 Codex close — 2026-10-05 PT

**Owner decision:** close the infrastructure/workflow effort. Claude is undertaking a
comprehensive Impeccable review; remaining UI work belongs in its own session.
The prior Claude handoff is preserved verbatim below as historical context, not a
freshly verified worklist. Do not overwrite concurrent Claude work or resume its
carryovers without checking current source and release state.

### Completed and released

- **Workflow infrastructure:** PR #432 (`d8c658b2e112b2c81036df1ba0c48973b9c3cfce`)
  deployed the request-first projection, scheduled-end preparation, durable receipts,
  preserved Word document identity and explicit human review transitions. Migration
  067 and bounded production acceptance are recorded in
  `docs/plans/STAFF_DELIBERATIONS_STATUS_CLARITY_PLAN_2026-10-04.md`.
- **Eligibility:** PR #442 (`88fa8caf2eb5200189747ff1ca9683a700580277`) restored the
  ordinary Workbench cohort: Advancing OR Phase II Pending, including eligible
  requests without documents, with mine/all-PD scope.
- **UI revisions shipped, not accepted as finished:** PR #444
  (`4d7b30b1a73336607cac521fbc8d51ab8a7f5e38`) and PR #445
  (`ebbe9b031a360053d55297b70440a3bebbd1708d`; source `d204ed801`).
  [VERIFIED via release checks and signed-in production browser, 2026-10-05]
  latest deployment `dpl_6zTF4WVaFVXJtqC5XHF75roZAAno` was Ready; request 1002872
  retained its original Word destination. All-program view showed 26 ordinary and
  three marked TEST requests. All PR checks passed; 48 focused tests passed. Sol
  approved and Claude Opus 5.5 subscription-OAuth review confirmed the fixes.

### Boundaries and next items

- **Parked pending separate activation decision:** broad automatic preparation is
  OFF and unscheduled. The authorized one-shot TEST request 1003313 demonstrated
  missing-only generation, preparation and idempotent rerun; it did not demonstrate
  scheduled delivery/latency or broad-cohort operation. Do not enable a schedule or
  catch-up run as part of UI work. Manual TEST request 1003312 demonstrated review
  progression with the original Word item. See the status-clarity plan for receipts.
- **Verified open by owner screenshot/feedback:** the full list remains hard to scan:
  oversized cards, competing bold lines, excess whitespace and repeated instructions.
  A successful single-card browser check did not establish usability of the list.
  Claude's comprehensive Impeccable review owns the next design direction.
- **Proposal only:** compact grouping by task was suggested, not approved or built.
  Preview multiple requests together before another production UI revision.
- **Audience invariant:** everyone is new to both the app and workflow. PD experience
  does not imply knowledge of this application.
- **No new runtime work in this closeout.** The feature branch is pushed and merged;
  local preview server is stopped. No automation activation or email sending occurred
  in the UI revisions. Claim-evidence pilot report was unavailable locally; no
  observation row was invented.

### Key files

- `shared/components/workbench/StaffDeliberationsPanel.js`
- `shared/components/workbench/StaffDeliberationsTab.js`
- `shared/components/workbench/FinalWriteupTab.js`
- `.impeccable/surfaces/ents-workbench-staffdeliberationspanel-js-1912c47b.md`
- `docs/plans/STAFF_DELIBERATIONS_STATUS_CLARITY_PLAN_2026-10-04.md`

Milestone determination: the infrastructure production cutover warrants a
`DEVELOPMENT_LOG.md` entry; the later UI refinements are not separate milestones.

---

## Historical prior Claude handoff (preserved; verify before acting)

# Session 577 Prompt: merge the presentation summary (PR #440), then accept it on 1003222

## Session 576 Summary — 2026-10-05 PT (Stage 2 built and reviewed; memory router diet)

Opus 5.5 ran `/contract-reconcile` on Stages 2–3 of the summaries plan, built Stage 2 on
`feature/presentation-summary`, took it through three Codex adversarial rounds, and opened
PR #440. The owner ran both Production prerequisites. The merge is waiting on CI, which a
GitHub Actions runner incident blocked. While waiting, the memory router diet ran on `main`.

### What Was Completed

1. **Recording links on Staff Deliberations: no code gap.** On 1003222 no video had been
   uploaded; the owner uploaded one and saw it on Staff Deliberations (owner, 2026-10-05).
2. **Stages 2–3 contract-reconcile** (plan §16, commit `d7d2bb5b4` on `main`). Findings: the
   Executor takes the model from the prompt row and has no fallback; a names-edit republish
   mints a new `revisionId`; summary drafts need a new text-holding table; the acknowledgment
   had no store; the 068/069 constraints already admit 100000010. Owner decisions A–D: hide
   the summary outside after any republish until re-summarized; `sonnet` only; synchronous
   300 s generation; Staff Deliberations reads the bound file inline.
3. **Stage 2 presentation summary built** (PR #440, branch `feature/presentation-summary`,
   7 commits, not merged; plan §17). The pieces:
   - **Outside binding** (`bindTranscriptSummary`, `wmkf_inputfingerprint`): both outside
     pages serve only a summary bound to the current revision and boundary.
   - **Prompt and seed:** `meeting-transcript.presentation-summary` (`sonnet`, untrusted
     transcript and slide text), its seed script, a standing Executor budget, and A7 registry
     entry `inv: 33`.
   - **Drafts:** migration 070 `meeting_transcript_summary_drafts`; the acknowledgment is
     recorded before the provider call, and text is held only while a draft is ready or
     publishing.
   - **Service and routes:** `transcript-summary-service.js`, plus
     `.../transcriptions/summary-draft` and `.../summary-draft/publish`.
   - **Card:** the `SummaryBlock`.
   - **Staff Deliberations:** inline text, read only when the file matches its pinned hash.
4. **Codex adversarial review, three rounds**:
   - **Round 1:** discarded text could still publish, and a republish could overwrite a
     published file.
   - **Round 2:** the claim was not exclusive, the registration flag was not durable, and a
     stuck draft had no recovery.
   - **Fix:** an exclusive per-request claim token; a durable `publish_registration_attempted`
     flag; a versioned filename; recovery by a new Summarize.
   - **Round 3:** approve, no material findings.
   - **Verification:** each guard was mutation-checked, and the store SQL was exercised
     against a throwaway Postgres 16.
5. **Production prerequisites, owner-run 2026-10-05:** migration 070 applied (1 applied, 68
   skipped); prompt seeded (`✓ create → v1`, current row `348ded13-f4c0-f111-aaad-6045bd04539e`,
   exactly one current row verified). Neither is used until #440 merges.
6. **Memory router diet** (`2fb1128f9`, `1363edb32`, audit note
   `docs/audits/memory-routine-audit-2026-10-05.md`):
   - **Router:** 8,325 → 6,863 B and 69 → 47 leaf refs; 22 leaves moved to wiki Durable
     Memory sections or the archive.
   - **Archive:** Virtual Review Panel added.
   - **Recall rules:** added to seven leaves; two stale "branch-only" notes corrected.
   - **Health flags:** 25 → 15.

### Commits
- `main`: `d7d2bb5b4` plan §16; `2fb1128f9` router diet; `1363edb32` recall rules; handoff commit follows.
- `feature/presentation-summary` (PR #440): `1d5ea38f2`, `3ee03f50f`, `37924c9b6`, `d2be57f03`, `48d02c30c`, `5958f3066`.

## Next Items

### Owner-Stated Next Focus

1. **Merge PR #440 once CI is green.** On 2026-10-05 20:30 UTC every check had passed except
   **Postgres integration**. It was cancelled three times after waiting 15 minutes for a
   runner and ran no steps (GitHub "Incident with Actions": runner-assignment delays).
   Gitleaks passed on its re-run.
   - First, check githubstatus.com shows Actions operational.
   - Then run `gh run rerun 37364291939 --failed` and wait for it to pass.
   - Then the owner merges.
   - The migration and the seed are already done, so nothing owner-run remains before the merge.
2. **Acceptance on 1003222** (plan §17 open items):
   - Summarize with and without a slide PDF; edit, publish, and see it on the Board link.
   - Edit speaker names and republish: the Board link hides the summary, and Staff
     Deliberations shows it as stale.
   - Check the Staff Deliberations inline text.
   - After acceptance, mark the docs Production-live: plan §17 status line, Atlas
     `postgres-meeting-transcript-summary-drafts.md` and `dataverse-wmkf-requestdocument.md`,
     and the API matrix rows. All three currently say "source-built, not deployed".

### Verified Open

1. **Stage 3 (staff discussion summary)** and **Stage 4 (Board recording)**. Plan §5 and §16
   cover Stage 3:
   - Picklist 100000010, owner-run (the Postgres constraints already admit it).
   - A second prompt and seed.
   - Its input reads the bound Staff Discussion Transcript row.
   - A staff-only projection.
   - Extend the 070 `artifact_type` CHECK.
2. **Memory hygiene (queued in the 2026-10-05 audit):**
   - 7 weak-basis leaves need dated verification.
   - `project-site-visit-materials-planning-handoff` (9.2 KB, routed) needs a split.
   - Recommended next routine audit: about 2 weeks out, or at the 8 KiB trigger.
3. **Sonnet 5.5 inventory amendment** (`origin/audit/sonnet-55-consumer-inventory`, last
   commit 2026-10-04): still lists two closed blockers. Add
   `meeting-transcript.presentation-summary` as a `sonnet` consumer.
4. **Sweep item:** `docs/PC_MEETING_TRACKER_PLAN.md:105` still says "PRODUCTION NOT
   DEPLOYED" for presentation materials [VERIFIED 2026-10-05]; the materials plan says enabled.
5. **Roster-as-foundation rule unconfirmed** (plan §14); **PR #431 checklist remainder**
   (plain VTT upload, Zoom chat.txt refusal); **leadership dashboard readiness** (worktree
   `../WMKF_Apps-codex-dashboards`, `origin/codex/leadership-dashboard-testing`, unread since S572).
6. **Small follow-ups (plan §11–§13):**
   - The external briefing page's empty-state copy still mentions recordings.
   - A derivative whose SharePoint file was replaced needs a manual regenerate path.
   - Applicant-uploaded rows are not eTag-pinned.

### Owner Decision Needed

1. **Pre-Site distribution email** (`lib/services/pre-site-visit/distribution/model.js`
   `MATERIAL_TYPES`): it still offers full RECORDING, TRANSCRIPT, and now Transcript
   Summary rows (bound or stale) as SharePoint links.
2. **Memory-health checker narrowing** (audit note, Unknowns): make `wmkf_` case-sensitive and
   drop the bare `rows` and `table` words. Every shadow-atlas flag in two audits was one of these.
3. **Pinned save bar** in the speaker editor (offered S575); **Sonnet 5.5 pre-flip replay**
   (spends provider credits); **Dependabot #115/#116** (upstream-blocked as of 2026-10-04).

### Parked

1. `feature/unsupported-stretch-split`, `feature/reassign-direct-overlap` (Zoom plan "Deliberately NOT merged").
2. Old `PostPresentationMaterialsCard.js` / `MeetingTranscriptionPanel.js`: retire with the
   rehearsal page later, not before.
3. `multi-llm-service.js` `DEFAULT_MODELS.claude` dead config; items parked in S571 (#428, #328, #390, reminder cron).

### Verify Before Acting

1. **Roll forward, not back:** once v4/v5 bundles or summary drafts exist, older code
   rejects them or has no reader.
2. **Admin budget publishing** reads every standing prompt's row. The summary prompt is
   seeded, so this is satisfied; a future standing-budget prompt must be seeded before its
   code merges.
3. Production reads, writes, migrations, and seeds are owner-run via `!`. Dataverse writes
   need `DATAVERSE_PROD_WRITE_ACK="<purpose> <YYYY-MM-DD UTC>"`.
4. **Agent worktrees branch from `main`** (`project-agent-worktree-base-is-main`).
5. **Codex reviews:** `codex:review` rejects focus text; use `codex:adversarial-review --wait`.
   Codex cannot run Jest in its read-only sandbox, so its verdicts are source-review only.
6. **Load-dependent unit flakes:** `reviewer-manage-proposal-attachment`,
   `workbench-proposal-tab-t5-matrix`, and `workbench-integrity-service` failed only in
   full-suite runs, and pass alone.

### Do Not Reopen Without New Decision

1. Summaries plan decisions 1–7 (§7) and §16 decisions A–D; card redesign decisions 1–5;
   time-split speaker editor declined; model-as-veto, dominance 0.2, legacy VRP retirement,
   Integrity Screener haiku pin.

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/plans/SITE_VISIT_SUMMARIES_AND_BOARD_SHARING_PLAN_2026-10-04.md` | §16 review and decisions A–D; §17 Stage 2 build record and Codex rounds |
| `lib/services/post-presentation-materials/transcript-summary-service.js` | summarize, edit, discard, publish (claim → registry phase → mark) |
| `lib/services/post-presentation-materials/summary-draft-store.js` | migration 070 store: claim token, registration flag, release/yield |
| `lib/services/post-presentation-materials/presentation-transcript-binding.js` | `bindTranscriptSummary`, `transcriptSummaryBindingFingerprint` |
| `shared/config/prompts/meeting-presentation-summary.js`, `scripts/seed-meeting-presentation-summary-prompt.js` | prompt source and seed |
| `shared/components/meeting-tracker/RecordingAndTranscriptCard.js` | `SummaryBlock` |
| `shared/components/workbench/ResearchPresentationFollowUp.js`, `lib/services/site-visit/logistics-service.js` | Staff Deliberations inline summary |
| `docs/atlas/postgres-meeting-transcript-summary-drafts.md` | draft table state machine and retention |
| `docs/audits/memory-routine-audit-2026-10-05.md` | router diet record and queued memory items |

## Testing

```bash
npx jest tests/unit/transcript-summary-service.test.js tests/unit/presentation-transcript-binding.test.js tests/unit/meeting-presentation-summary-prompt-config.test.js
npx jest tests/unit/presentation-page-service.test.js tests/unit/deliberation-briefing-page-service.test.js tests/unit/site-visit-logistics-service.test.js
npx jest tests/unit/recording-and-transcript-card.test.js tests/unit/research-presentation-follow-up.test.js tests/unit/meeting-tracker-transcription-routes.test.js
```

(Session 575 and earlier handoffs: `git show 684a649ab:SESSION_PROMPT.md`.)
