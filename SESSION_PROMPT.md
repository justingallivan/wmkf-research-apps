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
