# Request 1002903 transcript follow-up — 2026-09-30

Status: DONE — PR #379 merged and deployed; the owner confirmed both DOCX and
VTT uploads worked in Production after the release. [VERIFIED via GitHub,
Vercel release checks and owner report on 2026-09-30] Source commit
`90ea3f0a5600ec8140edf124df0c57308f189d25` merged as
`ebbbc1307589021b1712afa650a2c070e115b5df` at 23:17:05 UTC.
The owner authorized bounded probes on request 1002903 after reporting renewed
DOCX and VTT failures following PR #375. The failure evidence below is historical
pre-PR #379 evidence; it does not describe the accepted post-release uploads.

## Historical pre-release Production evidence and limits

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
headers/bytes were not retained and the rejected Blob was deleted. Original
file paths were requested during diagnosis; source bytes and VTT
transport headers were not obtained. Subsequent owner acceptance closes the
upload issue without establishing a complete forensic comparison.

At the pre-release probe, the only transcript registry row for this request
was the successfully saved
386446-byte PDF (`d9dc7327-1bbd-f111-aaae-000d3a361c1f`, created 22:06:23 UTC).
The failed attempts did not replace it. Registry membership was not re-probed
after the owner’s successful DOCX/VTT uploads; this historical count is not a
claim about the post-acceptance registry. The shared UI maps these permanent
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
## Production release and owner acceptance

[VERIFIED via GitHub deployment status and Vercel inspect at release]
Production deployment `dpl_D9bz5jCdvAYuf2iPqmUxseT3mcTC` reached Ready and
served the applications/reviews/grantees/submissions domains. GitHub deployment
`6772260367` tied its success at 23:17:46 UTC (4:17 PM Pacific) to the exact
PR #379 merge SHA above. Canonical sign-in returned HTTP 200; unauthenticated
Meeting Tracker redirected to sign-in and returned 200. The bounded initial
error-log query returned zero records; it was not an upload test.

[VERIFIED via owner report on 2026-09-30] After being asked to reselect and
upload the original DOCX and VTT on request #1002903, the owner reported:
“They both worked.” Both formats passed the owner's Production acceptance test.
No agent-created upload, registry repair, migration or flag change ran. PDF
was also owner-confirmed working as a fallback. No remaining acceptance or
implementation item is open for this incident. Rejected old staging rows are
not reopened; future uploads use a newly selected source.

Historical release rollback baseline: commit `883aec528ac5e3d922947ef914afa227962108e5`,
Ready deployment `dpl_GHvx9V2LzTki92rL8npKR777uxfM`. The recorded rollback target
was `https://wmkfresearchapps-gtuqfqpx3-justin-gallivans-projects.vercel.app`.
Deployment rollback restores code, not durable upload/registry writes; recheck
current Production state before any future rollback.

## Bounded closeout reconciliation

Mode A: the changed fact is PR #379's completed Production promotion and
owner-confirmed DOCX/VTT acceptance. Authoritative evidence is the GitHub merge
and deployment status, the recorded Vercel release checks, and the owner's
human report. The caller/persistence/reader contract is traced above; no runtime
code changed during closeout. Exact source forensic attribution remains
ASSUMED as labeled in the historical incident evidence; acceptance is not
inferred from tests or the pre-release PDF registry row.

Restatement search covered docs, memory, session/root instructions, rules and
skills, source, scripts and tests. This receipt and the earlier DOCX incident
receipt had stale release/acceptance statements; both were structurally
corrected. The Atlas transcript subsection’s stale source-built marker was
replaced with the release and owner-acceptance evidence. The two Opus receipts are explicitly pre-release review snapshots
and retain their original verdicts/limitations. The Atlas transcript subsection describes
compatible source/stored receipt semantics and links the completed release.
SESSION_PROMPT.md and DEVELOPMENT_LOG.md now record the release and owner test.
Unrelated request-number matches, the broader post-presentation rollout
roadmap and route-status catalogue, and other workstream carryovers are excluded;
prior session instructions are retained in Git history rather than promoted
into a current worklist. PR #379's body also records owner acceptance.

Closeout checks passed sequentially: doc currency and self-test, document
symbol references and self-test, docs catalog, fact consistency and self-test,
Atlas and self-test, secrets and self-test, scaffolding and self-test, harness
framing and self-test, and instruction architecture. Tracked agent invariants
passed in the isolated checkout; all three local symlink invariants passed in
the original checkout. Diff check passed. The advisory claim-evidence report
was unavailable; no observation row was fabricated.

Scoped reconciliation verdict: RECONCILED — the three live stale incident
release/acceptance statements (two incident receipts and the Atlas transcript
marker) were corrected; repeated scoped searches found zero remaining stale
statements. The two Opus snapshots remain HISTORICAL, and the session handoff
and milestone now AGREE with release/owner evidence. To disconfirm completion,
GitHub merge records were re-read and the current receipts were searched for
“Not promoted”, “not production-accepted”, and outstanding/pending acceptance;
none remained in the scoped current statements. No claim is made that the
broader rollout roadmap or route catalogue was audited. Remaining uncertainty
is the deleted originals' forensic comparison, not an open release or
acceptance action.
