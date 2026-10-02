---
title: Meeting Tracker transcription readiness check
domain: transcription
kind: evidence
status: isolated-preview-schema-ready-source-disabled-runtime-unverified
summary: "Local PostgreSQL integration and isolated Preview test schema are verified. The sign-in-only Preview deployment is READY, but the OAuth browser session was not verified. Transcription remains off; provider, audio, end-to-end, and release readiness are unverified."
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
  interlock on, Production reads off, DAL enforcement on. The sign-in-only
  profile change is committed as `f58238774`; Sol approved it, and root reports
  96 tests plus scoped lint, API/context/lifecycle, and old-pilot isolation
  gates passing. Fable's first-party OAuth review session
  `018a58ac-8e44-42e5-b0c1-d2cb79f21637` found no blockers (zero subagents,
  web calls, or permission denials).
- **Preview deployment and bounded auth checks:** the first explicit Preview
  attempt (`dpl_BAxHcsS83tgmVL79vEcST5pLz9Bi`) unexpectedly targeted Production;
  root canceled it, Vercel confirmed `CANCELED` and `aliasAssigned=false`, and
  the Production app was not changed. The staging-target retry produced READY
  Preview deployment `dpl_5xaG9LpWycuHgUGm3RG25AzMy3Ay` (Node 24 / Next.js,
  approximately one-minute build) at
  [`https://wmkf-meeting-transcription-test-rblr9xc6d.vercel.app`](https://wmkf-meeting-transcription-test-rblr9xc6d.vercel.app);
  the alias [`https://wmkf-meeting-transcription-test.vercel.app`](https://wmkf-meeting-transcription-test.vercel.app)
  is assigned and verified. The existing Azure app registration retained its
  nine old redirect URIs and gained only this Preview callback URI; delegated
  `User.Read` was verified. Preview auth settings had a unique
  `NEXTAUTH_SECRET`, exact `NEXTAUTH_URL`, `AUTH_REQUIRED=true`, emergency
  bypass false, and the test-project marker configured. Sign-in status returned
  enabled; an unrelated cron path returned bare 404; anonymous session
  returned `{}`. Chrome's sign-in flow reached a request to
  `/api/auth/session`, where the browser displayed `ERR_BLOCKED_BY_CLIENT`.
  Read-only database verification found the sole seeded profile active,
  `needs_linking=false`, and `last_login_at` populated, showing OAuth callback
  acceptance but not proving the browser established or displayed a session.
  The block's cause is unknown.
- **Preview route probe:** `scripts/probe-meeting-transcription-test.js`
  returned HTTP 200 for auth status, sign-in page, and anonymous session; it
  returned 404 for cron, `meeting-tracker/visits`, the AssemblyAI webhook GET,
  and `.well-known/workflow/v1/flow` GET. The anonymous 200 does not verify an
  authenticated session. Root removed the exact protected temporary
  `preview.env` and its empty parent directory; no source recording was touched.

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

Migrations were applied only to isolated test Neon, and Wave 31 only to
sandbox. All transcription flags remain off. No audio/provider call,
transcription feature activation, authenticated browser session, or end-to-end
Meeting Tracker test is proven. The next bounded check is to resolve the
browser's `ERR_BLOCKED_BY_CLIENT` result without assuming a cause, then verify
the authenticated browser session and scoped Preview behavior. These checks
do not establish Meeting Tracker release readiness.
