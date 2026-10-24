# Meeting Tracker ordinary-request activation — 2026-10-24

[VERIFIED via owner instruction, GitHub checks, Vercel production readback and authenticated production browser] The owner authorized ordinary-request access only after all release checks passed. The condition was satisfied before any control changed.

## Check and deployment evidence

- Runtime/test release `1c30f9b2af006a655e3cc943b667d67ee6a2fc74`: all ten checks completed successfully, including JavaScript, Python and Actions CodeQL, Jest, PostgreSQL integration, Playwright, Semgrep, Trivy and Gitleaks (plus change detection).
- Current production source before activation `d4f73e62ad68d0da9ba0b85c0e701f1b1f402d7f` differs only in the deployment record. Its JavaScript CodeQL also completed successfully; every applicable check was green (the existing documentation-only rule skipped PostgreSQL integration).
- Previously recorded full suite: 1,455 passing suites / 25,059 passing tests, plus 130 PostgreSQL integration tests. No source/runtime changes were needed for activation.
- Environment-only production redeploy: `dpl_GUwvA6JqfAKEZJa79q3MiY32WaW6`, Ready, production aliases assigned; [immutable deployment](https://wmkfresearchapps-i4k698gtw-justin-gallivans-projects.vercel.app), source `d4f73e62ad68d0da9ba0b85c0e701f1b1f402d7f`.

## Effective access and checks

[VERIFIED via exact production readback] These three controls changed from the dedicated test cohort to `on`:

- `MEETING_MATERIAL_PREPARATION_ACCESS`
- `MEETING_MANUAL_VIDEO_PAIRING_ACCESS`
- `MEETING_PRESENTATION_INVITATION_ACCESS`

The activation operator refused pending/red checks and unexpected prior values, checked each write and included rollback of partial configuration updates. It changed Production only. `scripts/activate-meeting-ordinary-requests.cjs` preserves the one-release procedure; it requires explicit `--execute` and is not a general-purpose rollout tool.

[VERIFIED via real authenticated production browser on an ordinary eligible scheduled request] Preparation GET returned a valid empty status rather than a cohort denial. Video-split GET returned `available:true`, `manualPairAvailable:true`, and retained the request's existing approved video with `boardReady:true`. Invitation GET returned success with no invitation or send receipt. These were read-only checks: no source upload, preparation enqueue, paid provider call, new cut, email preview/send, enrollment or approval was performed.

Existing authorization, request/visit eligibility, Coordinator-only enrollment/approval/withdrawal, explicit mail sending, sender impersonation and test-request email protections remain. Existing requests are not automatically enrolled into retained editions; the Program Coordinator deliberately sets up approval. No historical approval is manufactured. Automatic applicant reminders stay retired/unscheduled.

Migrations 086–089 and the edition-aware rollback floor remain as recorded in the [controlled deployment receipt](MEETING_CONTROLLED_DEPLOYMENT_2026-10-24.md). To stop new work, turn the three controls off; retain sticky edition readers, approval references and withdrawal tombstones. Do not roll enrolled requests back to pre-edition readers or drop schema.

**Verdict: ordinary eligible requests are enabled and production read-only checks passed.** No email was sent and no existing business record was edited during activation. Genuine new Zoom/ASR ingestion or live mailbox delivery is not claimed by these checks.
