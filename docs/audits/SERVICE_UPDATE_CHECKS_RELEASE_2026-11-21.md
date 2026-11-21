# Manual external-service checks — production release

[VERIFIED 2026-11-21] [PR #669](https://github.com/justingallivan/wmkf-research-apps/pull/669) merged as `7a8ee00bcbe1df8e27e0ab9cdd0211fe0f4a616e` after all PR checks passed. Production deployment `dpl_7KzStgPn1BCDE9fGmrgFooUKkuEA` reached Ready. Admin → Operations → External services now offers manual checks for AssemblyAI, Anthropic, and SerpAPI.

## Release evidence

- Migration `108_external_service_checks.sql` applied at `2026-11-21T22:25:28.303Z`, before the branch push and either deployment. The canonical runner applied exactly one migration and skipped 104. Existing local credentials were used without downloading or displaying secrets. The known pre-existing tracker entry `097_shared_prompt_jobs.sql` was preserved.
- Readback verified all six check-table columns, 26 services, one review, zero check snapshots, and no pending migrations. No provider requests, recordings, reviews, or service settings were changed by the release process.
- The final local build passed 120 scoped tests, production build, types, and relevant gates. [Claude Opus approved via OAuth](SERVICE_UPDATE_CHECKS_OPUS_2026-11-21.md). GitHub CI passed 28,441 tests (356 skipped), plus 210 PostgreSQL integration tests across 16 suites. Security scans, CodeQL, the Claude review workflow, and Vercel preview checks all passed before merge.
- Anonymous production API access redirects to sign-in with no-store headers. The later signed-in AssemblyAI UI/check/reload smoke passed, as recorded below. Human-review save and private Anthropic/SerpAPI responses remain unverified. Public AssemblyAI endpoint shape probes are recorded in the [build receipt](SERVICE_UPDATE_CHECKS_BUILD_2026-11-21.md).
- A bounded deployment-specific error scan for `/api/admin/external-services` returned zero records through 22:38:56 UTC. This short observation does not prove authenticated route execution or sustained health.
- Rollback: restore prior Ready deployment `dpl_5yjAja3mAfVeVef5huuRZGovsTSf` using `vercel rollback dpl_5yjAja3mAfVeVef5huuRZGovsTSf`. Retain the additive table and any later operator snapshots; code rollback is not data rollback.

## Changed-fact reconciliation

Sweep Mode A: manual-check deployment and schema state. The Atlas page/index, route-security matrix, and service catalog now record production state. The build and Opus receipts are explicitly historical review evidence. No active in-scope manual-check-not-deployed claim remains. The checks remain manual; no schedule, inference, automatic completed review, provider-setting change, or recording reprocessing was introduced.

## Signed-in AssemblyAI smoke — 14:42 Pacific

[VERIFIED via production Chrome UI] Opened Admin → Operations → External services as the signed-in superuser. The older tab initially used cached pre-release navigation; a normal browser reload loaded the deployed navigation.

- Ran Check for updates once for AssemblyAI. Both Public pricing and Models and retirement guidance returned “First check — baseline saved” at `2026-11-21T22:42:43.635Z`.
- Reload check results returned the same saved timestamp and both baselines.
- Start review from findings opened an unsaved Proposed / Investigate draft, populated evidence and both source links, and left rationale blank. Canceled without saving.
- Existing STT-3.7 configuration, last-reviewed date `2026-11-20`, next-review date `2026-12-20`, and the single Implemented review remained unchanged in the UI. No recordings were reprocessed.
- Presentation observation: excerpts are verbose plain text and display raw Markdown syntax. This is functional evidence output, but its readability could be improved separately.

This verifies authenticated application access and the AssemblyAI public-source check/persistence path. It does not verify a human-review PUT, Anthropic/SerpAPI credentials, unavailable-source behavior against live providers, or transcription quality. The zero-check snapshot count above is the historical release readback before this authorized check.
