# Manual external-service checks — production release

[VERIFIED 2026-11-21] [PR #669](https://github.com/justingallivan/wmkf-research-apps/pull/669) merged as `7a8ee00bcbe1df8e27e0ab9cdd0211fe0f4a616e` after all PR checks passed. Production deployment `dpl_7KzStgPn1BCDE9fGmrgFooUKkuEA` reached Ready. Admin → Operations → External services now offers manual checks for AssemblyAI, Anthropic, and SerpAPI.

## Release evidence

- Migration `108_external_service_checks.sql` applied at `2026-11-21T22:25:28.303Z`, before the branch push and either deployment. The canonical runner applied exactly one migration and skipped 104. Existing local credentials were used without downloading or displaying secrets. The known pre-existing tracker entry `097_shared_prompt_jobs.sql` was preserved.
- Readback verified all six check-table columns, 26 services, one review, zero check snapshots, and no pending migrations. No provider requests, recordings, reviews, or service settings were changed by the release process.
- The final local build passed 120 scoped tests, production build, types, and relevant gates. [Claude Opus approved via OAuth](SERVICE_UPDATE_CHECKS_OPUS_2026-11-21.md). GitHub CI passed 28,441 tests (356 skipped), plus 210 PostgreSQL integration tests across 16 suites. Security scans, CodeQL, the Claude review workflow, and Vercel preview checks all passed before merge.
- Anonymous production API access redirects to sign-in with no-store headers. Authenticated hosted UI/check/save/reload and private provider responses remain unverified. Public AssemblyAI endpoint shape probes are recorded in the [build receipt](SERVICE_UPDATE_CHECKS_BUILD_2026-11-21.md).
- A bounded deployment-specific error scan for `/api/admin/external-services` returned zero records through 22:38:56 UTC. This short observation does not prove authenticated route execution or sustained health.
- Rollback: restore prior Ready deployment `dpl_5yjAja3mAfVeVef5huuRZGovsTSf` using `vercel rollback dpl_5yjAja3mAfVeVef5huuRZGovsTSf`. Retain the additive table and any later operator snapshots; code rollback is not data rollback.

## Changed-fact reconciliation

Sweep Mode A: manual-check deployment and schema state. The Atlas page/index, route-security matrix, and service catalog now record production state. The build and Opus receipts are explicitly historical review evidence. No active in-scope manual-check-not-deployed claim remains. The checks remain manual; no schedule, inference, automatic completed review, provider-setting change, or recording reprocessing was introduced.
