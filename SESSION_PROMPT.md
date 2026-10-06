# Session 578 Prompt: review the overnight Workbench / Meeting Tracker UX branch on localhost

## Session 577 Claude overnight close — 2026-10-06 PT

**Owner ask (2026-10-05, deadline):** build the next UX-audit fixes in chunks
overnight; review together on localhost in the morning. Nothing below is merged
or deployed. Codex's Session 577 close (next section) handed the Staff
Deliberations list design to this audit.

### Already released this session

- App-wide staff UX audit: `.impeccable/critique/2026-10-06T01-35-10Z__pages.md`
  (19/40). DESIGN.md gained a **Page Structure** section (four page types,
  17 named rules) and a **Desktop first** rule (owner: in-office desktop app;
  phones only "in a pinch").
- PR #446 merged `51ca71798`, Production `dpl_GZAhQuv7zL6WPXF69XbPCaDosWRP`
  Ready: one-row nav (Home · Workbench · Meeting Tracker · Tools · Guide ·
  Admin, Admin/Cycle Dossier superuser-only), literal width map (fixes the
  Tailwind-dropped `max-w-${maxWidth}`), registry name Reviewers → Workbench
  (key `reviewers` unchanged), Home inside the shell, attribution footer
  removed. Codex adversarial review: two findings fixed, round 2 approve.

### Overnight branch `feature/workbench-ux` (pushed, NOT merged; no PR yet)

One commit per chunk; each chunk Codex-reviewed (chunks 1-3 round 1 found a
narrow-window grid collapse → fixed → round 2 approve; chunk 4 approve). Full
Jest 20927 passed; `check:types` clean. All presentation-only: no API,
payload, persistence, or automation change.

1. **Workbench header** — left H1 "Workbench" with program, cycle and
   "Find and open a request" on the title row; underline view tabs; the H2
   that repeated the tab label removed.
2. **Request list** — one bordered list of compact rows; the request number
   is a real link stretched over the row (opens in a new tab); triage select
   above it; "going-forward" chip reads "Advancing"; per-row cycle/program
   labels (always equal to the header filters) dropped.
3. **Staff deliberations list** — compact three-column rows (request ·
   task chip + next-step sentence at body weight · one outline button + one
   link); task filter, search and scope on one toolbar; generic intro
   sentence removed. Same order and copy; **no task grouping** (still the
   owner's call). Lists stack below 1024px.
4. **Visit and session pages open read-only** — saved visit → "Visit details"
   summary (when in the visit's zone, format, "Open meeting link (host)"
   instead of the full URL, organizer, attendee names, notes) with "Edit visit
   details"; saved session → "Session details" + status chip beside the title.
   Cancel discards; save returns to the summary; new visits/sessions unchanged.

Fixture-backed screenshots (local only, not in the repo) were checked at 1440,
1024 and 800px.

### Morning review on localhost

1. `git checkout feature/workbench-ux && git pull`
2. `MEETING_TRACKER_SCHEMA_READY=on SITE_VISIT_MATERIALS_SCHEMA_READY=on npm run dev`
   (without the two flags the Meeting Tracker shows "not yet enabled" locally),
   then sign in at `http://localhost:3000`.
3. Look at: Workbench Request list, Staff deliberations, Final writeups,
   Awardees (shared header); a visit page and a session page (read-only
   summary → Edit → Cancel).
4. **Caution:** localhost reads Production data. Dataverse writes from local
   are blocked by the interlock (`lib/dataverse/core/interlock.js:354-374`;
   `.env.local` has no `DATAVERSE_PROD_WRITE_ACK`) [VERIFIED], but Postgres
   and email paths are not covered by it — do not press save/send/generate
   buttons during the review.
5. Revert paths if a chunk is unwanted: drop its commit on the branch; after
   merge, Vercel Instant Rollback or revert the merge commit (UI-only, no data
   to repair).

### Open decisions for the owner

- Merge as one PR or per chunk; Staff deliberations task grouping (yes/no).
- Next audit items: Recording & Transcript card (collapse finished steps),
  attendee typeahead (~48 chips), Awardee tab buttons/cards, request-page tab
  stage cues, remaining centered `PageHeader` heroes on tool pages.

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
