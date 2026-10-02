---
title: Meeting Tracker transcription readiness check
domain: transcription
kind: evidence
status: disabled-source-local-integration-passed-sandbox-schema-blocked
summary: "The disposable PostgreSQL 16 integration suite passed; the sandbox metadata probe found the Wave 31 memo absent. No persistent apply or release is claimed."
owner: product-engineering
---

# Meeting Tracker transcription readiness check — 2026-10-02

## Evidence

- **Local PostgreSQL 16:** a disposable schema applied migrations 060–064.
  Four Meeting Tracker publication tests and 19 existing pilot integration
  tests passed, 23/23. The four new tests cover binding/source constraints,
  competing publication and cleanup fencing, recovery lease fencing, and
  close attribution. They do not cover every migration behavior or prove the
  hosted `@vercel/postgres` adapter. The disposable container and volume were
  removed after the passing run.
- **Real candidate writer:** execution exposed an unknown `$3` parameter. The
  only production-code correction required by this database check was an
  explicit `$3::text` cast. Assertions were strengthened for the exact
  constraints and persisted descriptor shape. An existing pilot assertion was
  updated after confirming `getWorkflowDispatch` intentionally omits the run
  ID; the recovery consumer check verifies the durable ID and attempt through
  `listRunningWorkflowDispatches`.
- **Focused source checks:** 58 unit tests passed and scoped lint was clean.
- **Dataverse sandbox:** the read-only
  `scripts/preflight-meeting-transcript-bundle-schema.mjs --target=sandbox`
  probe found `wmkf_transcriptbundlejson` absent; Wave 16 key
  `wmkf_requestdocument_generation_key` over `wmkf_generationkey` exact and
  Active. The separate `scripts/preflight-post-presentation-materials-schema.mjs`
  probe reported both Wave 30 fields exact. The Wave 31 field is absent, so
  readiness remains blocked. No Production probe or schema apply occurred.
- **Target configuration:** inspection showed the shared Preview branch's
  `DYNAMICS_URL` resolving to the Production host. The CLI pulled the
  environment into a temporary file containing secret placeholders; only the
  target host and flags were parsed, then the file was removed. No environment
  was changed and no secret values were retained.

## Review and remaining limits

Sol reviewed this delta, requested exact constraint-name and file-descriptor
assertions, and confirmed the amended tests and the older pilot test correction
resolved its findings. Root reran the strengthened Tracker tests and reviewed
the combined 23-test passing result. Scoped lint, migration-manifest, Atlas,
document-currency, document-catalog, document-symbol, and Request Document
writer checks passed, including available paired self-tests.

Fable's first-party Max `claude-fable-5-1` session
`9726c14e-3f5f-40d7-a382-d9d80a544eec`, using OAuth, returned **Commit OK**
with no substantive defect, permission denials, subagents, or web calls. Sol's
[implementation review](MEETING_TRANSCRIPTION_SOL_REVIEW_2026-10-01.md) records
the earlier source review. Fable's bounded review records that the opt-in
PostgreSQL suite skips without its test
URL, the local schema/PG injection proof does not exercise hosted
`@vercel/postgres`, and real PostgreSQL post-quarantine closure, slot/job lease
renewal and close, correction CRUD, and successful cleanup remain unproved.
The live Wave 31 field is unproved because sandbox metadata reports it absent.

No persistent database migration, Dataverse apply, deployment, feature
enablement, provider call, or audio test occurred. A separate approval for
sandbox hosted infrastructure testing remains pending. These checks do not
authorize or establish Meeting Tracker release readiness.
