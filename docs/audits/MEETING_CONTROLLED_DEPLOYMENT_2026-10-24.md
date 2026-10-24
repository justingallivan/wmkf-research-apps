# Meeting Tracker controlled production deployment — 2026-10-24

[VERIFIED via owner instruction, Git push, canonical migration runner, schema readback, Vercel Ready status and authenticated production browser] The owner authorized this controlled release and required migrations while retaining exact-request admission. Runtime change `d54b8b008` integrated current main `85e106bb5`; test-only follow-up `6f418b54e` names a stateful mock to satisfy the full CI lint gate. No other agent's working checkout was switched or reset.

## Deployment and cohort

- Production: [applications.wmkeck.org](https://applications.wmkeck.org).
- Initial test-mock correction deployment: `dpl_HEMqCQUMDTBaHkaui8QkWxsscqcq`, Ready/promoted, [immutable deployment](https://wmkfresearchapps-38md2x7dy-justin-gallivans-projects.vercel.app), commit `6f418b54e67215a2148ecb1512c5d2d22e7ead59`.
- Final test-contract follow-up: `1c30f9b2af006a655e3cc943b667d67ee6a2fc74`, deployment `dpl_21TWsMEkVDeBSNhHQ8HLzNvG1vZc`, Ready/promoted, [immutable deployment](https://wmkfresearchapps-59k8goanp-justin-gallivans-projects.vercel.app). Follow-ups after `d54b8b008` change tests, operator probes and documentation only.
- Initial identical-runtime deployment: `dpl_8aJeL3RS5KwsNi6r3jSehviGqwco`, Ready; runtime `d54b8b0086a12c0436ef59a9d665370288f435ea`.
- Dedicated test request **1003371**, `185415ef-3750-4806-84c7-fb6dd032af31`.
- `MEETING_MATERIAL_PREPARATION_ACCESS`, `MEETING_MANUAL_VIDEO_PAIRING_ACCESS`, `MEETING_PRESENTATION_INVITATION_ACCESS` are each exactly `test:185415ef-3750-4806-84c7-fb6dd032af31`, verified by production readback. Broader activation remains held.
- First enrollment into retained approval also checks the preparation cohort before writing. Existing enrolled reader/withdrawal behavior remains independent of new enrollment admission. Existing transcription, split and materials-reader access settings were preserved; no existing request was enrolled by this release.
- The configured Coordinator resolves to one active mapped Production profile (read-only identity check); no role or profile reassignment was needed.
- `DYNAMICS_IMPERSONATION_ENABLED=true`, `TEST_REQUEST_ISOLATION=on` and `DATAVERSE_TARGET_INTERLOCK=on` were read back, not weakened. No rehearsal signing secret or operator fetch fence was deployed.

## Production migration evidence

[VERIFIED via `scripts/deploy-meeting-controlled.cjs` invoking `scripts/apply-migrations.js`] Production tracker had 84 files with exactly four pending and no unknown filenames. Canonical runner applied 086–089: **4 applied, 84 skipped, 88 total**. No fresh-install setup was used on this populated database.

Physical readback verified all six new tables, summary ownership/acknowledgement columns, nullable `source_copy_id`, `manual_pairing_id`, and validated constraints `presentation_visibility_request_edition`, `presentation_video_source_kind`, `summary_acknowledgment_truthful_shape`. Database identity was checked against the configured Production Neon host and `/neondb` before apply. Credential values were kept out of logs/Git; only the required production database credential and specific rollout controls were retrieved.

## Production checks

[VERIFIED via real Chrome Microsoft sign-in and deployed endpoints] Actual Microsoft authentication completed and the dedicated request loaded the new task workspace. Preparation GET returned `{"preparation":null,"canRecoverUnknown":false}` from Production. The negative control request `e43ae6ea-698f-f111-8076-6045bd018a07` was denied with `preparation_not_available` before work. Approval GET returned a valid non-enrolled state, `canApprove:false` for the helper account and a not-ready candidate; the UI withheld Coordinator approval controls. No test session was fabricated for these production browser checks.

[VERIFIED via Vercel request logs] The new every-minute preparation cron was actually invoked by `vercel-cron/1.0` and returned HTTP 200 on the production deployment. This proves scheduled route execution, not a new nonempty processing run. The prior [bounded workflow rehearsal](MEETING_HOSTED_REHEARSAL_2026-10-23.md) owns actual synthetic preparation, media, approval, replacement and withdrawal evidence. Its isolated Postgres jobs, cut proof and approval editions were deliberately not transplanted into Production. The dedicated Production request remains unenrolled; Coordinator action and valid Production preparation receipts remain required.

[VERIFIED via final exact-fixture probe] The request is still test-marked, has no applicant/payee/primary-contact/recommender/payment-contact bindings, both reminder flags remain false, and regarding-email query returned zero rows. This deployment ran no send action or new media/provider job and edited no existing business record. Existing authentication bookkeeping is normal application behavior, not fixture business data.

Validation: integrated focused unit tests **12 suites / 126 tests passed**; the corrected visit-editor suite **18 tests passed**; full local lint **zero errors**; types, migration manifest, agent invariants, DAL gate/self-test and secret-scan gate/self-test passed. Initial CI stopped at the test mock's hook naming error; the corrected follow-up addresses only that error. The full hosted run initially exposed eleven stale suites (Coordinator fixtures, deliberately removed acknowledgement, sender/cron censuses and newly reachable SDK seams); their expectations/mocks were reconciled without changing runtime contracts. All eleven repaired suites passed locally (229 tests). Final hosted Tests run `40109453185` passed: **1,455 suites / 25,059 tests**, five snapshots; 22 suites / 276 tests skipped under the existing CI configuration. Separate PostgreSQL job passed 10 suites / 130 tests. Playwright, Semgrep, Trivy, Gitleaks and Python/Actions CodeQL checks passed. JavaScript CodeQL remains pending at this checkpoint.

## Rollback and next boundary

Pre-release known-good deployment: `dpl_6YiRQ5YR8p57au1HLEvQixfUrrdr` (main `85e106bb5`). It predates retained editions and is **not a safe rollback floor after any Production enrollment/approval/withdrawal**. Current `dpl_HEMqCQUMDTBaHkaui8QkWxsscqcq` is the compatible edition-aware floor for subsequent changes. Stop new work by setting the three admission controls off; retain sticky readers, receipts and withdrawal tombstones. Do not drop additive schema, clear uncertainty in SQL, or roll enrolled requests back to a pre-edition reader. Code rollback does not undo stored files, provider calls or email.

No ordinary-traffic activation is performed. Real mail and a fresh genuine Zoom/ASR run were not part of these production smoke checks. Keep the cohort limited while observing the dedicated request; a successful smoke check is not evidence of a new end-to-end Coordinator production run.

Contract-reconcile Mode B: release entry → canonical migrations → physical constraints → request-scoped admission → authenticated routes → existing artifact readers → scheduled worker checked; partial processing and retained-edition semantics rely on the separately recorded bounded rehearsal. Sweep scope: current Atlas pages, release checklist, implementation checkpoint, handoff and this receipt. Dated planning/review receipts remain historical.

Current verdict: **controlled deployment and production functional checks passed; access remains limited to the dedicated request**. Full hosted tests are green. The outstanding JavaScript CodeQL run is not represented as a pass; no broader activation follows from this receipt.
