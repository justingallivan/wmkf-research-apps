---
title: Meeting Tracker transcription integration
domain: transcription
kind: plan
status: source-reviewed-disabled
summary: "Shared staff drafts, retained TXT/VTT/source, and explicit publication are source-reviewed and disabled. Local PostgreSQL migrations pass integration proof; sandbox readback finds the Wave 31 memo absent and the Wave 16 generation key active. Hosted provisioning and release proof remain pending."
owner: product-engineering
related:
  - docs/plans/ASSEMBLYAI_TRANSCRIPTION_PILOT_PLAN_2026-09-30.md
  - docs/plans/POST_RESEARCH_PRESENTATION_MATERIALS_PLAN_2026-09-21.md
  - docs/atlas/postgres-transcription-pilot.md
---

# Meeting Tracker transcription integration

## Owner decisions

**[VERIFIED via owner instructions, 2026-10-01]** Include Meeting Tracker in
this round, not only the isolated pilot. Provide one selector per detected
speaker, using request PI/co-PIs and saved meeting invitation attendees where
available, plus manual name entry. Preserve one-minute readable/TXT headings
and precise VTT timing. Meeting Tracker owns the final materials; a future
Workbench Staff Deliberations display reflects those records rather than
maintaining an independently editable copy. New Workbench UI is deferred;
existing consumers still require regression and exposure checks.

**[VERIFIED via owner confirmation, 2026-10-01]** Generated transcripts stay
staff-only until explicit Publish; publishing can expose them through existing
recipient links. First-slice inputs are M4A/MP3, not automatic MP4 extraction or
Zoom-link retrieval. The owner approved Fable OAuth reviews after disclosure
of subscription usage/credits and relevant repository-source sharing; secrets,
audio and transcript content are excluded from review inputs.

**[VERIFIED via owner confirmation, 2026-10-01]** Any authorized Meeting
Tracker staff member may review, name speakers and publish the request's
draft. Retain both TXT and VTT final products for now. This is not an
indefinite retention-policy decision: use the existing governed-material
retention posture, preserve superseded revisions, and do not apply the pilot
seven-day purge to final products. The confirmed option included later
speaker-name corrections; revisions must remain possible without another
AssemblyAI call after temporary-job expiry.

**[VERIFIED via owner instructions, 2026-10-01]** One-day AssemblyAI provider
retention is acceptable, with model-training opt-out maintained. This replaces
an immediate-zero-retention requirement; it does not assert actual deletion
within exactly 24 hours, verify account/key coverage, change local retention,
or authorize arbitrary sensitive-recording tests. Provider deletion attempts
and truthful cleanup receipts remain in scope.

Root owns the plan and orchestration. Luna performs reconnaissance and builds;
Sol reviews implementation; root reviews and fixes the integrated result.
Claude Fable reviews the plan iteratively and performs the final adversarial
review through subscription OAuth only. Never substitute API-key sessions or
Ultrareview. Time-box each review to substantive correctness, privacy, access,
data-loss and usability findings; after two rounds root resolves remaining
tradeoffs rather than allowing optional polish to grow the scope. Unresolved
material risks cannot be relabeled as polish to obtain completion.

## Source reconnaissance (not a live deployment audit)

**[VERIFIED via read-only source inspection, 2026-10-01]**

| Contract | Source evidence | Implication |
|---|---|---|
| Existing transcript uploads are request-bound Meeting Tracker operations with app-grant checks and trusted DAL context | `pages/api/meeting-tracker/visits/[requestId]/presentation-materials.js`; `lib/services/post-presentation-materials/material-service.js` | Use the existing Site Visit entry point; do not ask the user to select the request again. |
| Existing finalization validates bytes, stores a SharePoint artifact, and registers/supersedes a governed transcript | `material-service.js::finalizeTranscriptUpload` | Reuse the governed publication contract; do not make expiring pilot Blob the final system of record. Its staging lease/candidate contract must be preserved, not bypassed. |
| Presentation recipient pages select current eligible transcript artifacts | `lib/services/post-presentation-materials/presentation-page-service.js::eligiblePresentationRows`, `buildPresentationContext` | A Dataverse lifecycle label of Draft alone is not a privacy boundary. Keep generated drafts out of the current-material registry until explicit publication, if that product choice is accepted. |
| Pilot routes require superuser and job ownership | `pages/api/admin/transcription-pilot/jobs/[id].js` | A Meeting Tracker wrapper needs its own request-bound authorization, not a silent weakening of pilot routes. |
| Site Visit attendee maps resolve organizer/required/optional invitees; PI/co-PI data has separate readers | `lib/services/site-visit/logistics-service.js`; `lib/services/proposal-pi-identity.js`; `lib/services/proposal-participants.js` | Use saved invitation context, not mailbox scraping. Co-PI name readers are not sufficient identity references by themselves. |
| Current formatting is a validated label overlay, not a rewrite of provider content | `lib/services/transcription-pilot/transcript-format.js`; migration 062 | Reuse the formatter and bounds. Never infer speaker identities automatically. |

**[UNKNOWN live state]** Existing post-presentation documentation records
bounded Preview proof and separate Production rollout gates. Do not infer
Production schema readiness or permission from source presence. The isolated
pilot deployment intentionally excludes Meeting Tracker and Dataverse access;
do not weaken that boundary or repurpose its database for shared records.

## Accepted bounded workflow

1. Open the existing Meeting Tracker Site Visit for a request. Upload approved
   M4A/MP3 audio (up to 50 MiB) and explicitly start paid transcription.
   Existing MP4, Zoom-link, and manually uploaded transcript controls remain.
   Automatic MP4 extraction/Zoom retrieval is excluded by owner choice.
2. Bind the job to the server-verified request, exact Site Visit and initiating
   actor. Reuse the proven processing, uncertainty, cleanup and formatting
   contracts. Reauthorize every detail/download/edit/publish operation; never
   trust a browser-supplied owner or unrelated job identifier.
3. Review the draft in Meeting Tracker. Show detected speaker count, original
   speaker label, a short transcript excerpt, candidate selector, and manual
   name entry. Missing attendee data is shown as unavailable, not an empty
   successful lookup; manual naming remains possible after request access is
   established. Do not require an email address for a manual display name.
4. Group candidates by source and disambiguate equal names. Deduplicate only
   grounded identities; never silently merge people solely by display name.
   Saved names remain stable if a roster later changes. Preserve speaker IDs
   and permit multiple IDs to share a name when diarization split one person.
5. Save names with version-conflict handling. Editing names does not call
   AssemblyAI again. Preserve job/request navigation guards for every awaited
   success and failure response.
6. Explicit Publish creates a stable final material through the
   existing governed SharePoint/Dataverse path. Freeze the selected job version
   and labels; retries reuse one publication identity. Do not overwrite an
   intervening newer transcript silently. Partial SharePoint/Dataverse success
   must be recoverable without a second paid transcription or duplicate final.
   The implementation-level contract is specified below.
7. Published output survives temporary-job cleanup. Temporary audio/results
   keep their existing bounded retention unless separately approved. Cleanup
   must never delete finalized SharePoint materials. Existing recipient and
   Workbench readers see only governed final materials, not pilot drafts.

## Accepted implementation contract

The following is the acceptance contract, not proof of live behavior. The
initial implementation is committed as `46ac68a62`, with the panel in
`0f7639b5a` and bounded downloads in `abca28759`. The current review status and
remaining release proof are recorded below; no physical schema or deployment
claim follows from these source commits.

### Identity and access

Add nullable `request_id` and `site_visit_activity_id` UUIDs to the operational
job ledger with a both-or-neither CHECK; both null means private pilot job.
The initiating `owner_profile_id` remains attribution, not the authorization
boundary for request-bound jobs. Every Tracker operation independently requires
active authenticated profile, Meeting Tracker grant, valid request GUID,
feature request eligibility and matching persisted job/request/visit binding.
Reject auth-bypass/null profiles. Pilot queries explicitly exclude bound jobs;
Tracker queries explicitly exclude unbound jobs. There is no new per-user
request ACL: authorized Tracker staff share the same request-bound drafts.
Authoritative request/visit lookup failures fail closed, unlike optional
candidate-directory failures. Start and Publish additionally require a mapped
Dataverse staff actor. Missing/duplicate/replaced active visits block new work
and mutation; cleanup remains independent. Never silently rebind old work to a
new visit. Record each saving/publishing actor separately from the initiator.

Pilot exclusion must work both before the new columns exist and after Tracker
flags are turned off. Use a schema-compatible row JSON projection (missing
`request_id` means unbound), or an equivalently verified capability strategy;
never fall back to unrestricted owner queries when a rollout flag is disabled.
Test old schema, new schema with flags off, and populated bound-job fixtures.

Keep the existing pilot routes, superuser requirement and dedicated project
allowlist unchanged. Add independent literal-on schema readiness and
`off` / `test:<requestId>` / `on` access controls for Meeting Tracker
transcription, with invalid/unset values disabled. Worker/provider processing
must distinguish authorized scopes without needing the Admin pilot UI enabled.
Keep start/submission gating independent of recovery and cleanup. Reuse
existing provider/runtime modules only through explicit scope-aware contracts,
never by passing the initiator's identity as a substitute for caller auth.

### One governed revision, three bounded files

Publish exactly ONE Request Document of existing artifact type TRANSCRIPT.
Its primary SharePoint identity is the minute-grouped TXT, so existing final
material readers remain compatible. Add one optional, separately readiness-
gated Dataverse Memo field `wmkf_transcriptbundlejson` (schema-as-code name
`wmkf_TranscriptBundleJson`, maximum 32,000 characters). Do not repurpose
Pre-Site snapshot fields or create a second competing TRANSCRIPT row.
Manifest selection is additionally opt-in per caller: only bundle read,
replay and reconciliation request it, not the default adapter projection.
Use the existing post-presentation producer constant; manifest presence
distinguishes generated bundles from manual transcripts.

The version-1 manifest contains only typed metadata: schema version, request
and exact Site Visit identity, immutable revision/operation ID, source revision
ID when correcting, formatter version, and three file descriptors (`txt`,
`vtt`, `source`). Each descriptor binds stable site/drive/item/version IDs,
ETag, exact SHA-256, bounded byte size, filename and content type. Primary TXT
descriptor must equal the normal registry primary fields. Reject unknown
schema versions, missing/extra file roles, mismatched request/visit/revision,
unsafe sizes/types, and incomplete identities. No URLs from request input.

The companion VTT preserves exact cues with saved names. The internal source
JSON stores only schema version, request/visit/revision identity, normalized
utterance speaker IDs/start/end/text and saved name mapping needed for later
correction. No raw provider response, audio URL, callback data, credentials,
email directory, or provider upload reference. Source is a retained final
artifact, not an extension of temporary-job retention. Reuse the existing
normalized transcript cap (4,000,000 bytes); generated TXT/VTT also have exact
code-owned byte bounds and validation before upload. All three files use the
request's governed SharePoint location/access, immutable operation-specific
paths, create-only uploads, read-back hash/metadata checks and one revision.
Source downloads enforce the byte cap while reading, not only against claimed
metadata, and validate the resulting hash before parsing.

Only TXT is projected to existing recipient/Workbench consumers in this slice.
Meeting Tracker staff can download both final TXT and VTT and edit names from
verified source. The manifest and source file are never serialized to external
recipient DTOs, accepted as arbitrary media selectors, or linked in recipient
pages. Future Workbench dual-format display remains deferred. Missing/malformed
bundle metadata leaves legacy single-file transcript reads intact; new bundle
editing/download actions fail closed with a repair message. No implicit
conversion of previously manually uploaded transcripts into editable bundles.

Name corrections load verified source through the current registry row, not
the expired pilot job. They create a staff-only correction draft, preserve the
previous published revision until explicit Publish, and create a new immutable
bundle. Require the expected current artifact ID and version/hash to match at
activation. No in-place overwrite of finalized TXT/VTT/source. Existing manual
transcript replacement remains supported and can make an older generated bundle
non-current; a stale correction must not silently replace it.
Shared correction drafts live in the publication table's `draft` state with
source artifact identity, bounded labels, optimistic version and seven-day
expiry; do not copy transcript text into Postgres. Publishing freezes that row.
Expiry clears draft labels but leaves final source intact, allowing a fresh
correction draft later. Candidate IDs are suggestions, not authority; saved
labels are validated strings, never client-supplied identity credentials.

### Publication receipt and commit boundary

Use an operational `meeting_transcript_publications` table for durable,
versioned publication intent/recovery; do not overload a one-hour upload-staging
row or retain transcript text in Postgres. The receipt binds operation UUID,
request/visit, initiator and publishing actor, input job or source artifact,
expected current artifact (including explicit no-current), frozen input hash,
formatter version, state/version, lease token/expiry, exact candidate paths and
verified file descriptors, resulting document ID and fixed error code. It may
retain a bounded frozen name mapping only while an operation is unresolved;
clear it after the verified source artifact is durably bound or cleanup is
closed. Failed/retryable operations remain visible in Tracker to authorized
staff; operational events carry IDs/codes only, not transcript/name contents.

Freeze source and names under job/source version CAS and a publication lease.
Before any SharePoint write persist deterministic candidate identities/paths.
Upload/verify all three files before registry activation. Renew/check leases
before and after I/O. A known candidate is reconciled by exact ID/hash; an
ambiguous timeout never triggers overwrite or a new paid transcription.

Generalize only the narrow transcript publication seam in material-service:
the existing manual-upload caller keeps its current validation, scan, staging,
actor, recovery and replacement behavior. The generated-bundle caller supplies
the explicit receipt-backed candidate/lease contract and complete verified
manifest, not invented staging state. Both acquire the SAME request/type slot
lease; generated publication checks expected-current identity under that lease
before registry activation. Allocate a deterministic generation key and one
document identity per immutable publication operation. Replays use that exact
identity; a newer winner remains current and is reported as such, not success
for replacing it. Do not allocate a fresh fence that lets a stale retry win.
Generation key is the digest of producer/request/TRANSCRIPT/operation ID/frozen
input hash; `wmkf_inputfingerprint` is that frozen input hash and
`wmkf_contenthash` is the TXT hash. Replay compares all three manifest file
descriptors with the receipt in addition to existing registry checks. Freeze
formatter version and bytes so a code upgrade cannot create a second identity.

The atomic visibility boundary is creation/activation of one complete READY
registry row containing the primary TXT and complete manifest. Earlier files
are not visible through material readers. Superseding older rows and recording
the Postgres receipt may fail afterward: recover by deterministic generation
identity and return explicit committed/reconciliation status, never retry as a
new publication or erase the usable winner. Slot-fence ordering continues to
choose one winner. Truthful UI distinguishes publishing, published,
published-with-reconciliation-needed, retryable failure and outcome unknown.

### Cleanup and retention boundaries

Temporary jobs retain the existing seven-day content and thirty-day receipt
policy. Freeze is a single version-checked transaction using the ready,
unexpired, output-present, not-cleaning/not-purged predicates of speaker save:
copy labels, job version and content hash into the publication receipt and take
the job row's own lease token before any SharePoint I/O. The publisher renews
that job lease until source JSON is uploaded and read-back verified; retries
thereafter use only frozen files. Tracker delete-draft returns 409 while that
job has an unresolved publication receipt. A separate receipt lease alone is
insufficient: existing cleanup checks the job lease. A valid job lease blocks
deletion of bytes publication is reading;
expiry blocks new publication immediately. Publication recovery first reconciles
the exact registry generation key and all file identities: a committed row,
including Superseded, protects ALL bundle files regardless of receipt state.
No-candidate expiry cannot publish. An unresolved operation can finish only
from already verified frozen files, not newer job labels; otherwise retain
exact minimal recovery identifiers and surface attention. Do not extend a
readable temporary draft's expiry to make recovery convenient.

Before permitting orphan deletion, account for any in-flight upload that might
commit later and any ambiguous registry write. Unknown, mismatched, unavailable
or multiple binding results retain candidates and report attention. Only
positively unbound exact owned candidates can be removed; no prefix deletion.
Require version-checked receipt closure and a quarantine longer than the
maximum request duration after its last lease expiry before orphan deletion.
Lease expiry plus a zero-row lookup alone is not permission to delete.
Existing staging cleanup must remain unable to claim generated bundle files.
Add a bounded publication cleanup/reconciliation pass to existing maintenance
cadence, not a new frequent scheduler. Do not clear exact candidate references
until safe closure is established. No automatic final-product expiration or
deletion is added in this slice; existing records policy remains authoritative.

### Release boundary

Build disabled on `codex/transcription-pilot`; no shared deployment merely to
test the UI. Proposed runtime home is the shared application, not the isolated
pilot. New Postgres migration(s) and an additive Dataverse wave are source-only
until numbering, physical schema, target configuration and owner-approved apply
are verified. Scope checks include existing 060–062, post-presentation schema,
private storage, provider controls and actual scheduler delivery. Schema
readiness must gate select lists as well as routes so older environments still
read legacy documents. Never enable the Admin pilot to activate Tracker.
Production deployment, schema applies, feature enablement, real-recording tests
and any newly metered service calls remain separately authorized operations.

## Build and acceptance sequence

### Contract guardrails

Change surface: request/Site-Visit-bound transcription in Meeting Tracker.
Entry points: existing visit detail, new scoped job/candidate/publication
operations, existing provider worker and cleanup. Persistence: temporary
Postgres/Blob jobs, durable governed SharePoint/Dataverse final materials.
Consumers: Meeting Tracker editor/downloads, existing recipient and Workbench
material readers, worker/cleanup, operational receipts. Prior finding: Draft
lifecycle is not a visibility boundary.

| Invariant | Relevant surface | Required proof |
|---|---|---|
| No ownerless/dev-bypass job | Tracker route guard and job service | `requireAppAccess` can return null profile in auth-bypass mode (`lib/utils/auth.js:311`); reject it explicitly. |
| Trusted DAL context is not row authorization | Tracker binding service | `withDalContext` establishes full trusted access, not request restrictions (`lib/dataverse/core/context.js`); verify the permitted request and exact visit binding before operating. Do not claim per-request ACLs the suite does not implement. |
| Existing pilot remains owner-only | Pilot routes/store and deployment policy | Tracker grants cannot read unbound pilot jobs; dedicated project still denies Tracker routes. |
| Unpublished means not registered as a current material | Publication service and every final reader | `material-model.js::isEligiblePostPresentationRow` accepts READY/non-SUPERSEDED, including Draft. A populated draft fixture must remain absent from recipient/Workbench output. |
| Governed publication is recoverable, not magically atomic across stores | Publication receipt, staging and material finalizer | Inject failure after each SharePoint/Dataverse/receipt write; retry recovers the same frozen version without duplicate publication. |
| Final artifacts are not temporary-job content | Cleanup selectors and final material pointers | Expire/purge the processing job and prove published artifacts remain readable under final-material authorization. |

The selected Site Visit detail is per request, unlike deliberation sessions
that contain several request slots. This slice must not combine speakers or
recordings from all slots into one request's transcript. It does not add
session-wide diarization or split a multi-request recording automatically.

Root settles the decisions and source-to-consumer contract, then Fable reviews.
Luna builds bounded backend and UI slices with one owner per file surface.
Sol reviews each integrated slice, root verifies, and Fable performs a final
adversarial pass. Material findings return through Luna/Sol/root; optional
polish is explicitly deferred rather than spawning endless review cycles.

Required discriminating coverage: cross-request/job/user denial; revoked
access; missing/ambiguous Site Visit; unavailable or changed candidate sources;
duplicate names; manual label validation; unsaved/stale version conflicts;
navigation during async success/error; provider submission uncertainty;
publication racing label save, cleanup, another publication or manual upload;
retry after each external-write boundary; draft exclusion with a real draft
present in fixtures; final-output survival after temporary cleanup; existing
recipient/Workbench behavior; minute TXT and exact VTT regression; maximum
upload bounds. Run relevant migrations/Atlas/API/security/docs gates and their
self-tests sequentially, focused tests and build. Hosted tests require a
separately confirmed safe target and authority.

## Fable round 1 and root dispositions

Luna completed read-only reconnaissance; no files or external state were
changed by that agent. Root verified Claude host authentication as subscription
OAuth. An initial review attempt was blocked before execution; after explicit
disclosure and owner approval, the OAuth-only Fable review was launched with
read-only source tools and provider API-key variables removed. Fable completed
as `claude-fable-5-1` with no permission denials. Its full findings are retained
in [round 1 evidence](evidence/MEETING_TRANSCRIPTION_FABLE_R1_2026-10-01.md).
Historical planning verdict: implementable as a bounded slice after blocking
choices/contracts are recorded; not deployment approval. Implementation and
its separate adversarial review subsequently began, as recorded below.

Root dispositions:

- Accept the source findings on app-grant access, dedicated-project isolation,
  one transcript slot, immediate reader exposure, and required publication
  recovery. Do not claim per-user request ACLs: current access is app grant,
  rollout request eligibility, and verified request/visit/job binding.
- Accept shared request-bound drafts, now confirmed by the owner. Keep initiating actor attribution, mapped staff
  identity for publication, and existing private pilot jobs isolated. A new
  Meeting Tracker gate must not require enabling the Admin pilot surface.
- Fable recommended permanent TXT only and VTT/corrections within the temporary
  seven-day window. Owner confirmed retaining both formats; revision 2 replaces
  that recommendation with one governed bundle and retained normalized source,
  not two competing winners or indefinite temporary-job retention.
- Accept a durable publication-operation/candidate receipt, frozen job version
  and labels, and expected-current-artifact comparison under the existing slot
  lease. The precise ledger design must handle expiry/delete racing publication
  and unresolved remote success; a dependency override alone is not proof.
  Temporary cleanup must not erase recovery evidence or finalize unknown writes.
- Accept local Dataverse-only PI reads; do not call the enrichment-oriented
  `resolveProposalPI` path, which may contact ORCID/OpenAlex. Read Co-PI contact
  identifiers from the junction. Exclude email-only fallback strings from
  speaker-name suggestions; manual display-name entry needs no email.
- Reject the blanket assertion that all Site Visit recordings are sensitive;
  classification is not derivable from the feature name. Preserve the current
  non-sensitive testing boundary until an explicit broader processing decision.
  Do not mislabel sensitive recordings with the pilot acknowledgement.
- Require separately approved shared-runtime/schema release operations after
  confirming target state and migration numbering. Do not broaden the isolated
  pilot allowlist or treat a source build as operational enablement.

## Fable round 2 and settled plan

[VERIFIED via OAuth review result] Fable returned one named blocking change,
then READY TO IMPLEMENT as disabled source. Full output is retained in
[round 2 evidence](evidence/MEETING_TRANSCRIPTION_FABLE_R2_2026-10-01.md).
Root verified the cleanup predicates in `store.js::claimCleanup`,
`claimNextCleanupJob` and `requestCleanup` and incorporated the required
transactional job lease, renewals and unresolved-publication delete guard.
The small producer, hash mapping, opt-in manifest projection, correction-draft
home and orphan-quarantine contracts are also incorporated above. Root added
old-schema pilot isolation and bounded source reads to the build invariants.
That planning review did not itself test the implementation.

Historical verdict: **READY FOR DISABLED IMPLEMENTATION.** Fable's named plan
condition was incorporated. No schema apply, deployment, enablement or provider
test was authorized by that verdict.

## Implementation and source-review result

**[VERIFIED via source commits and focused tests; NOT LIVE]** Luna built the
request-bound flow and root completed the integrated review. Sol's capped
passes found publication-race, dispatch, candidate-directory and recovery
defects, which were fixed before the initial source commit. Root's integrated
run passed twenty suites / 222 tests. Full evidence and the mock/database
boundary are recorded in
[Sol implementation review](evidence/MEETING_TRANSCRIPTION_SOL_REVIEW_2026-10-01.md).

**[VERIFIED via OAuth-only source review]** Fable's implementation round 1
found a substantive publication dead end: failures before any files were
written could leave a request permanently blocked. Root accepted the finding;
Luna built the bounded repair, Sol reviewed the closure contract and source,
and root fixed the remaining crash/quarantine and retry-path issues. See
[Fable implementation round 1](evidence/MEETING_TRANSCRIPTION_FABLE_IMPLEMENTATION_R1_2026-10-01.md).
The source now includes pre-freeze actor/schema checks, atomic closure of
provably zero-write failures, preserved lease/quarantine deadlines, explicit
authorized closure retaining candidate files, and terminal reconciliation of
verified superseded receipts. Quarantine is persisted when leases are created
and renewed, not only when an error is caught, and closure checks ten minutes
beyond matching job/slot lease expiry. A zero-write failed correction closes
that attempt; a fresh correction is needed and its unpublished name edits are
not promised retained. No candidate deletion is authorized or added.

**[VERIFIED via OAuth-only round 2 review]** Fable returned **READY FOR DISABLED
SOURCE**, with no remaining material finding in its bounded delta review.
[Full round 2 evidence](evidence/MEETING_TRANSCRIPTION_FABLE_IMPLEMENTATION_R2_2026-10-01.md)
records coverage and limitations. Root added Fable's requested job/correction
catch-path tests, moved slot release after proven zero-write closure, and made
failed Publish refresh the selected draft version without losing local edits
or the error message. Sol's final exact-fix verification passed; these recovery
changes are committed as `c8c90af9a`. The final focused run passes **20 suites / 251 tests**;
the disabled Next.js build and scoped lint/security/migration/documentation
gates pass. Build warnings remain in the unrelated pre-RP/pre-Site DOCX path
tracing and Node localStorage behavior. No new provider/audio call occurred.

The unrelated pre-existing changes in
`tests/unit/research-presentation-materials-card.test.js` were left untouched
and excluded from commits. Its added Workbench processing/attention cases
currently fail against unchanged UI; the original HEAD cases pass. That is
not a claim of a fully green whole-repository test run.

**Current verdict: SOURCE-REVIEWED, DISABLED; NOT RELEASE-READY.** On
2026-10-02, an isolated local PostgreSQL 16 schema applied migrations 060–064
and passed all 23 integration tests: 4 Meeting Tracker publication tests and
19 existing pilot tests. The four new tests cover migration constraints,
competing publication and cleanup fencing, recovery lease fencing, and close
attribution. A real candidate-writer run exposed an untyped `$3` parameter;
the correction was `$3::text`, with no other production-code fix required by
that database check. An old pilot assertion was also corrected after proving
that `getWorkflowDispatch` intentionally omits the run ID and the recovery
consumer reads the durable ID and attempt through
`listRunningWorkflowDispatches`. The 58 focused unit tests and scoped lint
passed. This bounded evidence does not establish broader migration coverage
or hosted behavior.

The read-only Dataverse preflight on sandbox found the Wave 31
`wmkf_transcriptbundlejson` memo absent, the Wave 16
`wmkf_requestdocument_generation_key` over `wmkf_generationkey` exact and
Active. The Wave 31 probe is
`scripts/preflight-meeting-transcript-bundle-schema.mjs`; Wave 30 exactness
was reported by `scripts/preflight-post-presentation-materials-schema.mjs`.
No schema was applied. The shared Preview branch's `DYNAMICS_URL` resolved to
the Production host during configuration inspection. The CLI pulled the
environment into a temporary file containing secret placeholders; only the
target host and flags were parsed, then the file was removed. No environment
was changed and no secret values were retained. A separate sandbox
infrastructure test approval remains pending.
Fable's final OAuth review returned **Commit OK**, with no substantive defect;
it explicitly retains the hosted-adapter, quarantine/lease, correction, and
cleanup gaps listed in its review evidence. No deployment, persistent database
migration, Dataverse apply, feature enablement, provider call, or audio test
occurred.

Detailed bounded results and review limits are recorded in
[the 2026-10-02 readiness check](evidence/MEETING_TRANSCRIPTION_READINESS_CHECK_2026-10-02.md).

Before release, migrations 063 and 064 still require application and exact
readback on an authorized persistent target. Wave 31 must be applied and read
back before schema readiness can be enabled. The sandbox generation key is
already exact/Active, but this does not authorize or prove an application
write. Hosted end-to-end proof remains pending. Candidate files retained by
closed attempts are not registered final products; committed but unverifiable
receipts remain attention-only.
