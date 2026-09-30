# DOCX transcript finalization — 2026-09-30

Status: source-built on `codex/transcript-docx-integrity`; no production promotion
or repair performed. This receipt covers the DOCX upload defect, not the whole
post-presentation feature's release state.

## Incident evidence

[VERIFIED via bounded read-only Production probes on 2026-09-30] The staging row
for `USC_MR_Transcript_Cleaned.docx` is
`a7238bd5-94fb-415b-9953-91ffe5b987d5`, bound to request GUID
`e9fc9101-0944-f111-88b5-000d3a3065b8` (request **1002860**). The user initially
reported **1002903** and was checking whether the screenshot came from 1002860;
that attribution remains unconfirmed.

The staging row recorded 24,959 original bytes, creation
`2026-09-30T20:56:20.971Z`, rejection with
`post_presentation_candidate_mismatch` at `20:57:03.368Z`, and expiry
`21:56:20.936Z`. This was a short retry, not expiry. The exact server-owned
SharePoint name was
`1002860-Transcript-a7238bd5-94fb-415b-9953-91ffe5b987d5.docx`.
Graph readback found 33,934 stored bytes, a different raw hash, one version
(`1.0`), and no matching transcript registry row. Exact staging-correlated
Vercel logs showed initial finalize returning 502 after successful Graph PUT
and metadata read; the subsequent finalize returned 409 after PUT conflict
and successful path read.

Probe provenance: Postgres queries ran inside `BEGIN READ ONLY`, a 15-second
statement timeout and `ROLLBACK`, restricted to those request GUIDs and the
exact filename/staging identity; selected only staging lifecycle, size/hash,
receipt and timing fields. Dataverse reads resolved the request numbers and
transcript registry membership. Graph read only the exact server-derived path,
its metadata/version list and bytes. No application state was changed.

[VERIFIED via pre-fix regression tests] The previous service required source
size equality after upload and source size/hash equality on conflict recovery.
A DOCX repack or characterized property promotion reproduced the 502 then 409
sequence. [ASSUMED for the exact USC source] SharePoint property promotion
explains the observed raw-byte difference. The original rejected staging Blob
was no longer available for full source comparison; the real specimen has not
been attested. No claim is made that arbitrary package differences are safe.

## Contract and implementation

[VERIFIED via source and regression tests] The staff card stages the source
privately and retains its staging ID for Finish transcript. The authenticated
finalize route reauthorizes actor/request scope, claims the staging lease and
loads the original bytes. The service validates extension/MIME, source cap and
signature, checks any persisted staged hash, performs the configured malware
scan and revalidates active request/Site Visit context before Graph work.

Only the server-validated DOCX MIME selects package attestation. Fresh upload,
409 exact-path recovery and recorded-candidate retry download the exact item;
metadata before and after download must agree on drive/item/name/size/ETag and
version. Missing visibility, missing stable receipt, network failure, metadata
drift, unconfirmed/non-positive size metadata and download-length drift return
retryable 503 without rejecting the staged source. Stable identity or
package-content mismatch remains permanent
409. `attestDocxPackageAgainstSource` preserves source parts and permits only
its characterized, shape- and size-bounded metadata changes; the broader
render-only customXml rewrite option is not enabled.

The same source SHA remains the generation input, registry input fingerprint
and content hash. DOCX candidate `sourceSha256`/`sourceSize` preserve that
original identity; candidate `sha256`/`size` describe the stable stored ZIP.
Legacy candidate retries upgrade for publication only after source attestation.
A fresh/conflict upload whose stable package fails attestation is also recorded
under the staging lease before permanent rejection, solely to retain an exact
orphan-cleanup receipt. A recorded retry keeps its prior receipt on rejection;
edited bytes do not replace that earlier deletion receipt.
The existing expiry cleanup still checks zero-row registry binding plus exact
stored bytes/ETag; publication remains prohibited without successful attestation.
If receipt persistence or lease renewal fails, that error propagates and the
route retains staging rather than permanently rejecting it. Files without a
stable exact identity/byte receipt remain outside automatic deletion authority.
Rejection warnings contain request/staging IDs and at most eight fixed failure
kinds with known package-part names or categories. Raw attestor messages,
relationship targets, arbitrary ZIP filenames and document text are excluded.
Candidate persistence remains lease-fenced and precedes Dataverse creation. `registrySize`
is persisted to the actual size immediately before a new create; retries keep
that value when replaying the exact request/generation/producer/drive/item row.
This supports repeated SharePoint repacks even when an earlier create failed
or completion delivery was lost. Stale slot fencing still protects newer
materials from supersession.

The existing cleanup consumer continues to require the candidate's exact
stored size/hash (or unchanged stored ETag/version), zero-row registry proof
and conditional exact-item deletion. It does not apply DOCX source-attestation
tolerance to destructive cleanup. Bound or ambiguous candidates remain retained.
No UI, route, schema, feature flag, cleanup implementation or MP4 flow changed.
The source cap remains 25 MiB; downloaded DOCX metadata is bounded to the
existing attestor's 200 MiB aggregate package budget before download, and the
attestor bounds ZIP entries, individual inflated parts and aggregate inflation.

## Verification and release boundary

Regression coverage includes first upload, conflict recovery, legacy receipt
upgrade, changed word content, an unexpected non-word payload, stable-receipt
reverification, metadata races, network failures, source-receipt mismatch,
registry replay after repeated repacks and failed creates, and cleanup using
the stored digest rather than the source digest. The pre-fix characterization
failed on the reported upload/retry paths; the fixed characterization passes.

[VERIFIED via final follow-up local commands] 394 tests passed across 11 suites: material
service, routes, staff upload card, material model, strict DOCX attestation,
portal staging cleanup, presentation-page reader, transcript formats, MP4
recovery/cleanup and schema parity. Targeted ESLint and `git diff --check`
passed. The canonical `npm run build` (Next.js 16.3.5 / Turbopack) passed after
replacing the worktree's unsupported cross-root node_modules symlink with a
local APFS dependency clone; no dependency or configuration change is tracked.

Twenty scoped gate invocations passed: agent invariants; Request Document
writers, trust-boundary GUID, route-service boundary, Atlas, doc currency,
document symbol references, secret scan, scaffolding tokens and fact
consistency (each applicable gate then self-test, sequentially); and docs
catalog. These checks cover the changed service/durable receipt surfaces.

Fresh read-only adversarial review found two retry defects in the initial fix:
metadata races were classified permanently, and the registry size receipt
could lag a later successful create. Both were corrected and exercised by
new regressions. The reviewer reread the updated paths and returned READY
with no remaining code findings. No paid review product was invoked.

A separate user-requested Claude Opus review of commit `d4a83fee1` returned
APPROVE with no blocking defects. Authentication was verified as `claude.ai`
Max subscription OAuth outside the Codex sandbox; API/provider overrides were
removed, and the observed `claude-opus-5-5` CLI session reported API-key source
`none`. Read/Grep/Glob were its only tools, so this review did not independently
execute tests. Its small recommendations are implemented in the follow-up:
redacted rejection diagnostics, retained stable rejected-upload receipts,
legacy-registry replay and retry-write ordering assertions, and retryable
unconfirmed size metadata. The strict source comparator is unchanged.
The focused follow-up review also returned APPROVE. Its cleanup residual was
closed by retaining the prior receipt on rejected recorded retries; a final
Opus closure check approved that safeguard with no blocking defects. All review
sessions used the same verified subscription OAuth method and API-key source
`none`. The orchestrator verified the final review's supplied input fingerprint
against the unchanged worktree diff before recording this result:
`eabd04f42e1d916248a31d57b0eac57261e0d62f22ff2dbbf83339f109dcc427`.
Full closure receipt:
`docs/plans/evidence/post-presentation/opus-docx-followup-2026-09-30.md`.
Production DOCX upload/download acceptance and owner-approved promotion remain
outstanding. Once deployed, the user must reselect and upload the rejected
file as a new staging operation; the old rejected receipt is not reopened.

## Bounded reconciliation

Mode A scope: DOCX transcript source/stored identities and their finalize,
registry replay and cleanup consumers. The Atlas coordination entry omitted
these receipt semantics and has been updated. The existing service catalog's
bounded transcript producer entry and existing source comparator remain
compatible; dated VTT/MP4 production acceptance receipts are historical tests,
not DOCX acceptance. Broader post-presentation roadmap/deployment reconciliation
is outside this fix. Relevant symbol searches cover candidate receipts,
`wmkf_filesize`, `wmkf_contenthash`, generation recovery and cleanup; UI/download
consumers use registry identity without comparing the stored ZIP to the source
raw hash. Remaining uncertainty: the exact user's original DOCX and production
acceptance of this branch.
