---
title: Meeting Tracker transcription readiness check
domain: transcription
kind: evidence
status: isolated-preview-schema-ready-source-disabled-runtime-unverified
summary: "Local PostgreSQL integration passed; isolated Preview test Neon schema and sandbox Wave 31 field are verified. Runtime, deployment, provider, audio, and release readiness remain unverified."
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
- **Dataverse sandbox:** the Wave 31 preflight initially found
  `wmkf_transcriptbundlejson` absent; following the approved sandbox-only
  apply, exact readback confirmed the memo and Wave 16 key
  `wmkf_requestdocument_generation_key` over `wmkf_generationkey` Active.
  Wave 30's two exact fields were reported by the separate
  `scripts/preflight-post-presentation-materials-schema.mjs`. Production was
  not probed or changed.
- **Target configuration:** inspection showed the shared Preview branch's
  `DYNAMICS_URL` resolving to the Production host. The CLI pulled the
  environment into a temporary file containing secret placeholders; only the
  target host and flags were parsed, then the file was removed. No shared
  Preview environment was changed during that inspection, and no secret values
  were retained.
- **Isolated hosted test resources:** dedicated Neon and private Blob are
  connected only to Preview in Vercel project
  `wmkf-meeting-transcription-test` (`prj_v9lOh6NdInOGxIPSmcX8IYiBPVQB`),
  separate from the shared app and old pilot. Neon store
  `store_ZucEm8gLqL6U8kOx` belongs to Neon project `dawn-paper-09421078`;
  private Blob store is `store_G5ZrBn1kcxzaBkyI`. The
  `scripts/bootstrap-meeting-transcription-test.js` execute initialized the
  fresh Neon schema; independent verify-only confirmed 61 tracked
  migrations and 9 required tables. All nine Preview environment keys read
  back as expected: sandbox/disabled flags, sandbox Dataverse target,
  interlock on, Production reads off, DAL enforcement on. This verifies
  resources/schema configuration only, not deployment or application runtime.

## Review and remaining limits

Sol reviewed the bootstrap; root's independent verify-only passed. Sol also
reviewed this delta, requested exact constraint-name and file-descriptor
assertions, and confirmed the amended tests and the older pilot test correction
resolved its findings. Root reran the strengthened Tracker tests and reviewed
the combined 23-test passing result. Scoped lint, migration-manifest, Atlas,
document-currency, document-catalog, document-symbol, and Request Document
writer checks passed, including available paired self-tests.

First-party OAuth Max Fable session `f287cfdf-40ea-4f27-840c-4defee098bbf`
(`claude-fable-5-1`) returned **Commit OK** for the isolated test bootstrap,
with no blockers. This was source-only: no execution or environment reads,
subagents, web calls, or permission denials. Residual limits: host/project
binding relies on external metadata; verify-only confirms presence/provenance,
not exhaustive schema drift; after a post-commit failure, use verify-only and
never rerun fresh execute. This is not hosted/runtime/release proof. Sol's
[implementation review](MEETING_TRANSCRIPTION_SOL_REVIEW_2026-10-01.md) records
the earlier source review. The earlier bounded review records that the opt-in
PostgreSQL suite skips without its test
URL, the local schema/PG injection proof does not exercise hosted
`@vercel/postgres`, and real PostgreSQL post-quarantine closure, slot/job lease
renewal and close, correction CRUD, and successful cleanup remain unproved.
The live Wave 31 memo is exact on sandbox only; the bundle field's live
application behavior remains unproved.

Migrations were applied only to the isolated test Neon, and Wave 31 only to
sandbox. No deployment, feature enablement, provider call, or audio test
occurred. These checks establish resource/schema readiness, not runtime or
Meeting Tracker release readiness.
