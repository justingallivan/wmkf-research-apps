# Session 385 Prompt: Continue the Workbench product sequence

## Session 384 Summary

Session 384 completed the owner-approved review-synthesis lifecycle rollout.
The lifecycle implementation merged through PR #96, signed-in Workbench
verification passed, migration 028 is live, the production automation flag is
enabled, and a controlled automatic smoke completed end to end. Two defects
found by the smoke were fixed through PRs #98 and #99. Final production
deployment `dpl_FdUJSjNwhbNWKWVzpyymiB2mpJo1` is Ready and aliased to
`applications.wmkeck.org`.

### What Was Completed

1. **Auth-status policy and routine dependency releases**
   - `/api/auth/status` now delegates to the same fail-closed auth policy used
     by the proxy and server guards. PR #95 merged to `main` as `12981732`.
   - Routine Dependabot PR #94 passed review/checks and merged to `main` as
     `e9e20db2`.
   - The retired-table annotation was corrected in `39dc08d7`.

2. **Review-synthesis lifecycle implementation**
   - Added one fail-closed readiness state machine for selected,
     invited/accepted, non-applicant-excluded participants. Receipts resolve
     with content; explicit terminal outcomes and current revoked/expired
     tokens resolve without content; live invitations and unknown/malformed
     state block.
   - Added an exact input fingerprint over the shared answer digest plus every
     participant's lifecycle classification. Token expiry crossing changes the
     classification/hash even though Dataverse fields do not change.
   - Added explicit early-run confirmation for manual staff generation.
     Manual invocations create leased ledger rows before the Executor call.
   - Added migration `028_review_synthesis_jobs.sql`: queue/currentness,
     deduplication, lease, retry, error, timing, and AI-run metadata only. It
     stores no reviewer text; the Dataverse request memo remains the content
     source of truth.
   - Added `/api/cron/drain-review-syntheses`, scheduled every five minutes but
     inert unless `REVIEW_SYNTHESIS_AUTOMATION_ENABLED` is exactly `true`.
     Claims are small and leased, capped scans fail closed, readiness/hash are
     revalidated before generation, retryable failures stop after three
     attempts, and terminal fingerprints are not silently reopened.
   - `ReviewsTab` now keeps stored output visible at zero accepted/submitted
     rows, shows Current/Stale plus queued/running/failed/readiness state, and
     refreshes the stored memo after an explicit partial tracking failure.
   - `GET /api/review-manager/reviewers` preserves the proposal at zero accepted
     rows and projects `reviewSynthesisState`. Job-state lookup is fail-soft
     without hiding stored synthesis or submitted reviews.
   - Contract reconciliation closed per-request pagination/truncation,
     automatic job-to-fresh-fingerprint binding, stale accepted flags on
     receipt-bearing rows, partial Dataverse-write/ledger-finalization behavior,
     and caller → persistence → consumer currentness.

3. **Durable truth and verification**
   - Reconciled the Atlas, route security matrix, credentials runbook, work
     queue, build plans, reviewer lifecycle wiki, canonical counts, and docs
     catalog.
   - Added
     `docs/audits/AUDIT_REVIEW_SYNTHESIS_LIFECYCLE_2026-07-28.md`.
   - The release preflight proved the local connection string exactly matched
     Vercel Production, then `node scripts/apply-migrations.js` applied
     `028_review_synthesis_jobs.sql` at `2026-07-28T19:25:49.479Z`.
     Post-apply verification found the empty table with the expected 18
     columns, eight constraints, and seven indexes.
   - PR #96 merged as `70956477` and Vercel production deployment
     `dpl_2tgAYjUXFFx4nQo7FgE2Z3TBMqP9` reached READY. The exact merge commit was
     independently associated with the successful production deployment.
     `/api/auth/status` returned 200, the authenticated
     `/api/cron/drain-review-syntheses` probe returned
     `{ok:true,enabled:false,reason:"automation_disabled"}`, the production
     automation flag remained absent, and `review_synthesis_jobs` remained at
     zero rows.
   - Full Jest: 532 suites / 6,317 tests passed. TypeScript and the Next.js
     production build passed. ESLint passed with zero errors and 51 existing
     warnings.
   - Migration manifest, API-route matrix, Atlas, route-lifecycle auth, docs
     catalog, canonical facts, doc-symbol references, doc currency, and all
     required self-tests passed.

4. **Automatic lifecycle production rollout**
   - Signed-in read-only verification on Request `1002788` proved the stored
     synthesis remains visible and correctly reports Stale with no submitted
     reviews.
   - `REVIEW_SYNTHESIS_AUTOMATION_ENABLED=true` was added to Production and the
     current production artifact was rebuilt before any review was staged.
   - The first controlled attempt exposed unsupported Executor run source
     `Vercel Cron` before any LLM call or synthesis write. Cleanup removed all
     11 staged answer rows and restored four parent fields. PR #98
     (`53266764`) changed automatic runs to the existing Dataverse
     `PowerAutomate Auto` option.
   - The rerun completed in one claim: job `2`, maintenance run `27723`, and AI
     run `1b882cf6-bf8a-f111-ab0f-7ced8d3d15a6` all completed; prompt v3 ended
     with `end_turn`; the synthesis memo was written.
   - Cleanup again removed exactly the 11 staged answers, restored Materials
     Sent / Stanford / no receipt / not staff-uploaded, left no draft, and
     returned the live census to 157 participant rows, 25 requests, zero
     eligible. The UI correctly returned to Stale while retaining the memo.
   - The sweep found that a claimed fingerprint whose review disappeared
     retried instead of cancelling. PR #99 (`a8f22d1a`) now revalidates
     lifecycle readiness before content loading. The final deployment is
     `dpl_FdUJSjNwhbNWKWVzpyymiB2mpJo1`; a post-deploy bounded drain returned
     zero eligible/enqueued/claimed/failed with automation still enabled.

### Commits

- `12981732` — Align auth status with enforcement policy (#95)
- `e9e20db2` — build(deps): bump the minor-and-patch group with 11 updates (#94)
- `39dc08d7` — Annotate retired reviewer table reference
- `77028ff2` — Record successful review synthesis smoke
- `f3037cc5` — Verify alert mailbox server-side sync
- `e33374cf` — Implement review synthesis lifecycle
- `70956477` — Implement review synthesis lifecycle (#96)
- `53266764` — Fix automatic synthesis run source (#98)
- `a8f22d1a` — Cancel synthesis jobs when readiness disappears (#99)

## Next Items

### Verified Open

1. **Review-synthesis lifecycle rollout — completed 2026-07-28.**
   Evidence: `70956477`;
   `docs/audits/AUDIT_REVIEW_SYNTHESIS_LIFECYCLE_2026-07-28.md`;
   `docs/CURRENT_WORK_QUEUE.md`.
   The ordered migration, disabled deployment, signed-in verification, flag
   enablement, bounded automatic smoke, cleanup, defect fixes, and post-deploy
   zero-eligible probe are complete. Production automation remains enabled.

2. **Continue the Workbench product sequence after synthesis release.**
   Evidence: `docs/CURRENT_WORK_QUEUE.md`;
   `docs/REQUEST_WORKBENCH_NEAR_TERM_EXECUTION_PLAN.md`;
   `docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md`.
   Calendar and freeze the full contract for Pre Site Visit Writeup, Site
   Visit, Final Writeup, and J27 Initial Assessment before implementing another
   tab. Owner-decided foundations: SharePoint Word is the canonical editable
   narrative; Dataverse is the typed registry/workflow authority; Microsoft
   Search supplies file-body search; version recovery, retention,
   least-privilege editing, and immutable Board milestones are required.
   Initial Assessment, Pre-Site, and Final are three separate documents; Final
   is copied from a deliberately selected Pre-Site version. Site Visit is a
   dossier rather than a fourth writeup. Its logistics are date, time/time
   zone, format, location/link, lead PD, WMKF staff, applicant participants,
   and Board/consultant participants; no separate visit-status field is
   needed. Its categories are applicant slides, other applicant materials,
   recording, transcript, transcript summary, and one paste-friendly staff-
   observations area without per-entry timestamps. No general material-
   revision workflow is planned absent observed need, but the applicant upload
   surface explicitly supports recoverable delete/replace. It accepts PDF/PPTX,
   permits additional uploads while access remains active, and notifies the
   lead PD plus other designated staff after successful changes. An authorized
   staff user manually triggers the request; entering or changing the Site
   Visit date never sends it automatically. Recipient choices are the
   Dataverse-linked liaison and PI—normally liaison in To, or PI in To with
   liaison optionally copied. To and CC share one request-scoped link and may
   manage the same file list; without sign-in or personalized links, the audit
   does not promise PI-versus-liaison attribution. Visits are scheduled
   promptly after advancement around reviewer invitations; once the date is
   recorded, staff may send without waiting for reviews, synthesis, or a
   Pre-Site Writeup. Exact requester roles, visible sender/reply-to, expiry,
   shared-link audit disclosure, size/count limits, and notification audience
   remain open. Pre-Site distributions and Final remain linked writeups rather
   than Site Visit material categories. This narrow request-scoped
   applicant-material link does not reopen the parked general intake product.
   Prefer an acceptable transcription-platform summary before a deliberate
   suite LLM fallback.
   Pre-Site inputs are also owner-decided: use the full proposal through an
   iterated governed `phase-ii.summarize`, authoritative request metadata from
   Dataverse, and `review-synthesis.generate` over all currently submitted
   reviews. The Site Visit date—not review count—governs distribution, so a
   zero-review document is valid. A late review regenerates only the synthesis
   and marks the review-derived section stale; it must not silently overwrite
   staff-edited Word prose or regenerate the proposal core. The Word layout is
   a versioned replaceable template initially based on the supplied examples.
   Source verification found that `review-synthesis.generate` is a live
   Executor path, while the existing `phase-ii.summarize` row drives nothing
   and the retained PDF route still uses `createSummarizationPrompt()`; the new
   Dataverse-native pipeline must adopt and iterate the governed prompt rather
   than extend the sunset route.
   Allison is the confirmed primary user for a planned cycle-wide Editor
   Dashboard that replaces designated-folder browsing with one governed
   writeup list, direct Open in Word, and personal Reviewed tracking. Exact
   collaborator audience, marker granularity, coordinator view, access key,
   and delivery date remain open.
   Exact schema/read model, first Pre-Site prompt/template pair, library
   configuration, later-stage inputs, upload requester permissions,
   sender/expiry and token/validation/recovery behavior, shared-link audit
   disclosure, and transcript-summary quality contract are still open.

### Owner Decision Needed

1. **Public Git current-tree and history disposition.**
   Evidence: `docs/PUBLIC_GIT_HISTORY_REMEDIATION_PLAN.md`;
   `docs/audits/public-repository-pii-history-audit-2026-07-27.md`.
   Decide the retired duplicate's current-tree disposition separately from any
   authorized history rewrite/GitHub cleanup.

2. **Retired-table operational scripts.**
   Evidence: `docs/CURRENT_WORK_QUEUE.md`; `scripts/README.md`.
   Twenty-five non-archive scripts still mention the historical
   `reviewer_suggestions` table. They are blocked from casual use; removal or
   quarantine remains owner-scoped.

### Parked

1. **Q9 app-access Stage 4 ordinary-user smoke until the owner is in the
   office with another person's account.**
   Evidence: `docs/Q9_PREFS_APPACCESS_DAL_MIGRATION_PLAN.md`;
   `.claude-memory/project-app-access-control.md`; owner decision in Session
   383. The other person only needs to sign into Preview and exercise the
   bounded ordinary-user checks while the owner performs/reverses the
   grant/revoke steps. Do not substitute the owner's superuser account.
2. The four placeholder Workbench tabs until calendar and complete workflow
   contracts are approved.
3. General applicant intake while WMKF evaluates the GOApply re-engineering.
   This does not park the narrower Site Visit Materials Upload planning note.
4. Automated BILL onboarding; honorarium payment remains offline.
5. Brace-expansion vendor adapter removal until every installed parent accepts
   the official patched API.

### Verify Before Acting

1. **Production review-synthesis automation is enabled and proved.** The
   controlled smoke completed job `2` in one claim; cleanup returned zero
   eligible requests; the final bounded probe was clean.
2. **Preserve the exact rollout gate.** Any value other than exact `true`
   remains intentionally inert; Production is deliberately set to `true`.
3. Re-read the live governed `review-synthesis.generate` row before any prompt
   publication. Governed v3 was the verified sole-current production baseline
   on 2026-07-28.
4. Re-freeze refs/artifacts before any public-history operation; the prior
   topology is a dated baseline.
5. Do not replace the brace-expansion adapter from a scanner version alone;
   exercise both legacy callable and modern named consumers under Node 20/npm
   10.

### Do Not Reopen Without New Decision

1. The auth-status divergence fixed in PR #95.
2. Routine dependency PR #94 and the completed 49-alert security rollup.
3. The production-proven synthesis terminal-response/native-schema reliability
   fix, governed-v3 smoke, and automatic lifecycle rollout.
4. A drafts-folder reviewer-email workflow; edit-before-send remains the
   accepted behavior.

## Key Files Reference

| File | Purpose |
| --- | --- |
| `lib/services/review-synthesis-readiness.js` | Pure participant readiness and exact lifecycle fingerprint |
| `lib/services/review-synthesis-content.js` | Shared digest/hash used by producer and read model |
| `lib/services/review-synthesis-job-service.js` | Postgres enqueue/claim/complete/fail/currentness ledger |
| `lib/services/review-synthesis-drain.js` | Automatic scan, enqueue, revalidation, and drain |
| `pages/api/cron/drain-review-syntheses.js` | Authenticated, feature-gated five-minute cron |
| `lib/db/migrations/028_review_synthesis_jobs.sql` | Existing-database ledger migration |
| `lib/services/review-manager/synthesize-reviews-service.js` | Shared manual/automatic producer |
| `lib/services/review-manager/reviewers-service.js` | Readiness/currentness DTO projection |
| `shared/components/workbench/ReviewsTab.js` | Visibility, early confirmation, and observability UI |
| `docs/audits/AUDIT_REVIEW_SYNTHESIS_LIFECYCLE_2026-07-28.md` | Contract and live-boundary audit |
| `docs/CURRENT_WORK_QUEUE.md` | Canonical product/release sequence |

## Testing

```bash
rtk npm test -- --runInBand
rtk npm run lint
rtk npm run check:types
rtk npm run build
rtk npm run check:migrations-manifest
rtk npm run check:api-routes
rtk npm run check:api-routes:self-test
rtk npm run check:atlas
rtk npm run check:atlas:self-test
rtk npm run check:route-lifecycle-auth
rtk npm run check:route-lifecycle-auth:self-test
rtk npm run check:docs-catalog
rtk npm run check:fact-consistency
rtk npm run check:fact-consistency:self-test
rtk npm run check:doc-symbol-refs
rtk npm run check:doc-symbol-refs:self-test
rtk npm run check:doc-currency
rtk npm run check:doc-currency:self-test
```
