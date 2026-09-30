# Request 1002903 transcript follow-up — 2026-09-30

Status: follow-up source fix on `codex/transcript-package-and-blob-read`, based on
Production merge `2eaa0767078c8daf3030ea9ca9ed04cd05ec8d6c`. Not promoted.
The owner authorized bounded probes on request 1002903 after reporting renewed
DOCX and VTT failures. Earlier PR #375 receipts describe their historical scope;
its production deployment does not constitute acceptance of these two specimens.

## Production evidence and limits

[VERIFIED via bounded read-only Dataverse/Postgres/Graph and Vercel log probes]
Request 1002903 resolves to `17e1c7ae-c844-f111-88b5-000d3a3065b8`.
Postgres reads used `BEGIN READ ONLY`, a 15-second statement timeout and
`ROLLBACK`, limited to its transcript rows from the previous six hours (max 30).
No claim/finalize, upload, registry write, cleanup or production repair ran.
Graph downloaded only the latest exact candidate item already persisted in
that staging row; the document contents are not checked into the repository.

The post-deployment DOCX attempts were rejected with
`post_presentation_candidate_mismatch`:

| Staging ID | Created UTC | Source bytes | Stored bytes |
|---|---|---:|---:|
| d7b86e86-a555-4013-8d4e-9c0bb61ccce2 | 22:31:46 | 89436 | 96774 |
| 88d94499-e5c9-43b3-83f1-95f0ce07ac75 | 22:32:47 | 89436 | 96773 |
| 821bfd1f-5251-497c-975d-b3e68cb539b6 | 22:36:31 | 89436 | 96774 |

Every correlated finalize returned 409 from the new Production deployment
`dpl_7PkzVRSFxkAqNKZqH9Vw8XCH8WMz`, with exactly two redacted failures:
`[Content_Types].xml` structure mismatch and `_rels/.rels` content changed.
The latest stored ZIP contains `docProps/custom.xml`, one internal root
custom-properties relationship targeting that exact part, and its exact
custom-properties content-type override. The source comparator already permits
the added, shape-checked custom-properties file but previously refused the
corresponding two OPC links. [VERIFIED via source and synthetic regressions]
That omission rejects a valid source DOCX without custom properties after
SharePoint adds that metadata graph. [ASSUMED for this exact user's specimen]
Those are the only source-to-destination changes: the rejected source Blob was
deleted, so no complete original comparison was possible.

VTT staging `eb3404b2-7f08-46e7-a727-79ba855c1177` (22:29:54 UTC) and
`a7f771a2-7e7b-46d0-9fb5-9e98e57422b5` (22:34:42 UTC) were rejected as
`empty_file`, before any `actual_bytes`, source hash or SharePoint candidate
was recorded; correlated finalize returned 400. Older VTT attempts had the
same result. [VERIFIED via installed SDK source and regression] Blob `get()`
derives its size from `Content-Length`, using zero when the header is absent.
The old loader rejected that zero without consuming the stream. [ASSUMED for
the exact user's VTT] Its GET lacked that header: the original transport
headers/bytes were not retained and the rejected Blob was deleted. The owner
was asked for original file paths to confirm the specimens.

The only transcript registry row for this request is the successfully saved
386446-byte PDF (`d9dc7327-1bbd-f111-aaae-000d3a361c1f`, created 22:06:23 UTC).
The failed attempts did not replace it. The shared UI maps these permanent
rejection codes to “The staged transcript cannot be used. Reselect the file
and upload it again.”

## Contract and changes

| Invariant | Enforcement | Verification |
|---|---|---|
| Source package content and existing OPC links survive | strict source attestor | altered word, hidden payload and changed existing relationship reject |
| Only the exact newly added custom-properties graph is tolerated | source-only bounded root parser with no extra root attributes, one short-ID exact internal relation and exact override | valid addition passes; external/wrong/duplicate/missing links reject |
| Render root comparison retains existing behavior | root normalization selected only for source with a newly added part | existing render and source attestation suites |
| Headerless streams are not presumed empty | identity-encoding GET and bounded decoded-stream read; compressed wire length is not treated as decoded length | nonempty VTT with SDK size zero passes; actual empty stream rejects |
| Byte cap and positive reported length remain enforced | cap checked on each chunk; exact known-length comparison | oversize cancels; length mismatch rejects |
| Transport failure is retryable and partial bytes are never recorded | `staged_upload_unavailable` 503, lease-fenced write only after full read | stream error has no source receipt; callers release staging |
| Actor/path/MIME/privacy, cleanup and registry fences stay intact | existing mint/claim/loader and exact candidate cleanup | shared staging and route/cleanup regressions |

Caller flow: staff card → authenticated finalize route → exact actor-bound
staging claim → private document loader → format/malware validation → source
attestation → candidate receipt → slot-fenced Request Document create/replay →
completion → card/download reader. For the shared loader, image replacement,
external grantee submit, external site-visit materials and consultant feedback
callers also preserve permanent-code classification and release unknown
transient codes. No route, schema, migration, feature flag, cleanup code,
registry identity or UI contract changed. Source attestation's existing
customXml, relationship, content-type and ZIP bounds remain in force.

## Verification and release boundary

Final implementer validation: 589 tests passed across 19 suites, including shared image/document caller routes, strict attestation, transcript service/routes/card, recovery and cleanup, plus Factory source-copy and render-verification consumers. Canonical Next.js/Turbopack build passed. Targeted ESLint had zero errors and one pre-existing unused-disable warning; diff check passed. The unmodified Production helper was also run with synthetic inputs and reproduced both defects: a valid added custom-properties graph produced exactly the two DOCX failures seen in logs, and a 43-byte VTT stream without Content-Length was rejected as empty_file.

Opus first review, authenticated through Max subscription OAuth outside the sandbox with API-key source none, identified compressed-with-length responses as a blocker. The correction measures decoded bytes, ignores compressed wire length, and keeps the streaming cap. Regression tests cover that case, compressed over-cap bytes, and locked/read-failed streams. The newly added root normalization also rejects extra root attributes and oversized added relationship IDs. Independent closure verdict: APPROVE, no blockers, via the same verified OAuth session/API-key source none. The orchestrator confirmed its unchanged tracked diff SHA256 as `c0b23fd2694dba2ff2d8a22f188bffd6e86c8d41db75e42b88372df7d4b8dbee`; the read-only reviewer could not compute that hash or run tests. Closure conditions on the stored package are verified: added ID `rId4`, root only declares the package namespace, target exactly `docProps/custom.xml`. Preservation of original IDs remains unproven without the original source and continues to fail closed.

A separate local HTTP probe used the SDK's actual `undici.fetch`, with a server deliberately ignoring identity encoding: a 39-byte gzip response decoded to 1400 bytes while retaining both `content-encoding:gzip` and the wire Content-Length. This closes the reviewer's runtime-header assumption without production writes or credentials.

Twenty scoped gate/self-test invocations passed sequentially (agent invariants; Request Document writers, trust-boundary GUID, route-service boundary, Atlas, doc currency, symbol refs, secrets, scaffolding and fact consistency pairs; docs catalog). Document checks were rerun after these receipts. Closure review: `docs/plans/evidence/post-presentation/opus-transcript-package-and-blob-read-2026-09-30.md`.
No claim is made that these original files have passed production acceptance.
After deliberate promotion, reselect each original as a new staging operation;
rejected old rows cannot be reused. Preserve PDF as the current fallback.
