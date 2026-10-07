# Session 580 Prompt: put "Start group review" back on the Staff Deliberations writeup step; watch the first scheduled preparation

## Session 579 Summary — 2026-10-06 PT (Claude)

Staff Deliberations automatic preparation went from "built but off" to **live in
Production, every 15 minutes**, and D26 was caught up. Three PRs, each through a
Codex adversarial review, merged and deployed. Planning work started on cycle
rollover with minimal per-cycle configuration.

### What Was Completed

1. **Activation review (read-only).** `scripts/review-staff-deliberations-preparation-cohort.mjs`
   (owner-run) showed J26 has nothing due and D26's oldest due presentation was 8 days old —
   no reach into earlier cycles. The worker itself has no age bound; only the cycle allowlist
   bounds it.
2. **PR #449** (merge `1d64af529`): `STAFF_DELIBERATIONS_AUTO_PREPARE_EXCLUDED_REQUEST_NUMBERS`
   (hand-made test copies 1003220–1003222 lack the Factory TEST marker; owner chose exclusion over
   marking them, which would classify them `anomaly` and refuse all their email). One shared
   predicate `requestMatchesPreparationAllowlists` at scan, claim, promotion fence, retry and
   list/detail status. Status no longer strands requests: `due` only when the worker will scan
   it; uncovered `pending`/`blocked` receipts read `disabled` (manual button). Blank/malformed
   exclusion values block automation. Attribution (owner decision: staff page, not Dataverse):
   "Prepared automatically after the presentation · <when>"; reused promotions recorded as
   `reconciled-complete-handoff`.
3. **Production configuration** (Config, readable via `vercel env ls`): program
   `["c247b11a-a7cb-ee11-9078-000d3a341e8f"]` (Research), cycle `["D26"]`, status
   `["Phase II Pending"]`, exclusions, `_PRODUCTION=on`, `_ATOMIC_FENCE_CONFIRMED=on`, and the
   switch `STAFF_DELIBERATIONS_AUTO_PREPARE=on`.
4. **First runs found two real blockers → PR #450** (merge `8268a13d4`):
   - Staff-edited files store pasted images at `/media/image*.png`; the governed DOCX hash rejected
     any reachable part outside `word/`. Now those parts and their rels are appended to the digest
     only when present (all previously hashable packages keep identical `gdc1:` hashes;
     `/contract-reconcile` over 17 consumers). Supersedes Pre-RP Brief Codex round 1's rule.
   - `site_visit_sharepoint_version_changed` is now transient (backoff, 5 attempts) with the moved
     fields recorded in the receipt. Cause established: SharePoint's one-time property-promotion
     rewrite on a file's first read (eTag +1, +2,537 bytes, version and lastModified unchanged).
5. **D26 caught up:** 12 prepared (11 by the worker, 1002912 staff-made). 7 blocked receipts were
   requeued through the authenticated retry route under the owner's signed-in session. No AI,
   email or review transitions. 11 real D26 requests remain, presentations Oct 7–16; all have
   drafts, so no AI cost expected.
6. **PR #451** (merge `60b079c3c`): `vercel.json` cron `*/15 * * * *`; scheduled-job census
   updated; route matrix, Atlas and service catalog corrected (they still said "not deployed").
   Cost estimate well under $1/month (Vercel Fluid compute Pro rates, `iad1`, 2 GB assumed).
7. **Planning:** `docs/plans/CYCLE_ROLLOVER_MINIMAL_CONFIGURATION_PLAN_2026-10-06.md` (owner
   principle: almost no per-cycle "care and feeding"; daylight-saving analogy), linked to the J27
   single-phase register; register row **J27-084** (add `J27` to the preparation cycle setting).
   Memory `feedback-minimize-per-cycle-configuration`.
8. **Corrections flag mismatch (S578 item): not a bug.** Production list and detail agree on all
   29 D26 requests (only 1002852 flagged, both sides). Localhost lacked
   `GUARDED_REOPEN_SCHEMA_READY`, so the detail reader never selected the field.

### Commits (main)
`8a6d33afa`…`b41099a29` (PR #449), `2097b56dc`, `a6b280d0f`, `e89e68880` (PR #450), `ffc302f79`,
`a81cd019e`, `bb2077a9a` (PR #451), `71b84304b`, `7bc981b50`, `4a1911655`, `5ce5f98a7`,
`5d78a1416`; handoff commit follows.

## Next Items

### Verified Open

1. **No visible way to start group review from the writeup step — owner priority.**
   Evidence: live page for 1002963 and the detail API for all 12 prepared requests (2026-10-06);
   `docs/CURRENT_WORK_QUEUE.md` entry. Step 4 shows only "Open writeup in Word" under the stale
   summary "Locked for review" (`StaffDeliberationsTab.js:1215`); step 5 (greyed) has "Open
   group-review details", which only switches tabs. Real action: `FinalWriteupTab.js:651` "Start
   group review". PR #448 moved the navigation button from step 4 to step 5. Proposed: step 4 reads
   "Post-visit editing" with "Edit writeup in Word" + "Start group review". **Ask the owner first**
   (see Owner Decision 1). Workaround today: Final writeup tab → Start group review.
2. **Watch the first scheduled preparation:** 1003010, presentation ends Wed 2026-10-07 15:30 PDT;
   expect prepared by ~15:45 (one extra 15-min run if SharePoint's first-read rewrite hits).
   Owner-run check:
   `DATAVERSE_ALLOW_PROD_READS=yes node --import ./scripts/lib/use-extensionless.mjs scripts/report-staff-deliberations-preparation-receipts.mjs --cycle=D26`
3. **Deferred small items** (queue entry): (a) list next step for a ready briefing names the
   deliberation session date — UI only, session already in the list payload
   (`cycle-list-service.js:618`); (b) reword the two "generated before the Dataverse fill"
   warnings (`artifact-model.js:290-291`; a test at
   `tests/unit/pre-site-visit-artifact-service.test.js:837` pins old wording).
4. **Meeting Tracker follow-ups** (carried from S578, not re-verified this session; owner said more
   to come): a session that fails to load shows an empty, saveable form (`SessionEditor.js`,
   reproduced with an invalid `cycleCode` — data-loss shape, highest priority); a slot's "Briefing
   not yet shared" can disagree with the Workbench sharing history (TEST 1003222).
5. **Before J27 research presentations:** add `J27` to `STAFF_DELIBERATIONS_AUTO_PREPARE_CYCLE_CODES`
   (register J27-084), unless the cycle-rollover work replaces it. The status filter stays valid:
   in J27 `Phase II Pending` is the internal advancing marker (C-5; owner 2026-10-06).

### Owner Decision Needed

1. **Start group review placement:** confirm inline on Staff Deliberations (same route, records the
   Word version, no email) vs. opening Final writeup with the confirmation already open.
2. **Cycle rollover** (plan §9): who gets the twice-yearly confirmation and when; roll a forgotten
   choice forward or hold; is portal opening the right "new cycle" anchor. Waiting on the owner's
   colleagues' briefing on future cycle dates.
3. **Deliberations vocabulary** — after D26, suite-wide (`docs/NOMENCLATURE_GLOSSARY.md`).

### Parked

1. The orange "Automatic preparation is off" copy: accurate wherever it shows (excluded/TEST
   requests, uncovered cycles/programs, paused automation). Re-open with the cycle-rollover work.
2. Merged branches `feature/deliberations-prep-exclusions`, `-handoff-robustness`,
   `-prep-schedule` still exist locally and on GitHub; delete when convenient.

### Verify Before Acting

1. Older S577 items (presentation-summary Stage 3/4, memory hygiene, Sonnet 5.5 inventory,
   PR #431 remainder, pre-site distribution email rows) were not touched this session:
   `git show e6666ae68:SESSION_PROMPT.md` for their last recorded state.
2. Production reads/writes/env changes are owner-run (`!`). The auto-mode classifier blocks agent
   writes of production feature flags; staging non-switch Config values via the CLI was allowed.
3. To pause automation: `vercel env rm STAFF_DELIBERATIONS_AUTO_PREPARE production --yes` then
   redeploy the current Production deployment; the cron keeps running as a no-op.

### Do Not Reopen Without New Decision

1. Exclusion list over Dataverse TEST-marking for 1003220–1003222 (owner 2026-10-06).
2. Attribution of automatic promotion is on the staff page, not Dataverse (owner 2026-10-06).
3. 15-minute schedule (owner 2026-10-06, conditional on no AI cost for empty runs — verified).
4. Deliberation sessions dated before the site visit are normal; no Word shortcut on the list (S578).

## Local dev

`GUARDED_REOPEN_SCHEMA_READY=on MEETING_TRACKER_SCHEMA_READY=on SITE_VISIT_MATERIALS_SCHEMA_READY=on npm run dev`
(the first flag is new: without it the request page never reads correction state). Localhost reads
Production; Dataverse writes are interlock-blocked, Postgres and email are not.

## Key Files Reference

| File | Purpose |
|------|---------|
| `shared/components/workbench/StaffDeliberationsTab.js` | Request-page stepper; step 4/5 actions (next item 1) |
| `shared/components/workbench/FinalWriteupTab.js` | "Start group review" confirmation (line ~651) |
| `lib/services/pre-site-visit/preparation-config.js` | Settings, exclusions, `requestMatchesPreparationAllowlists` |
| `lib/services/pre-site-visit/preparation-worker.js` | Scan/claim/promote, retry, detail status |
| `lib/services/documents/governed-docx-hash.js` | Governed hash; reachable outside-`word/` parts |
| `scripts/review-staff-deliberations-preparation-cohort.mjs` | Read-only activation preview |
| `scripts/report-staff-deliberations-preparation-receipts.mjs` | Read-only run-record report |
| `scripts/probe-staff-deliberations-handoff-file.mjs` | Read-only SharePoint/hash probe |
| `docs/plans/CYCLE_ROLLOVER_MINIMAL_CONFIGURATION_PLAN_2026-10-06.md` | Rollover investigation |

## Testing

```bash
npx jest tests/unit/staff-deliberations tests/unit/site-visit-transition tests/unit/pre-site-visit tests/unit/initial-assessment-artifact-service.test.js tests/unit/test-request-scheduled-job-census.test.js
npm run check:types && npm run build
```

(Session 578 and earlier handoffs: `git show e6666ae68:SESSION_PROMPT.md`.)
