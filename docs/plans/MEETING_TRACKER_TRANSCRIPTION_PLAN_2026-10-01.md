---
title: Meeting Tracker transcription integration
domain: transcription
kind: plan
status: draft-fable-r1-reviewed-owner-decisions-pending
summary: "Meeting Tracker transcription and contextual speaker selection: owner approved explicit publication, audio-only inputs, and OAuth Fable reviews. Collaboration and permanent-format choices remain open; implementation has not started."
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

## Proposed bounded workflow [PLANNED]

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
6. Proposed explicit Publish creates a stable final material through the
   existing governed SharePoint/Dataverse path. Freeze the selected job version
   and labels; retries reuse one publication identity. Do not overwrite an
   intervening newer transcript silently. Partial SharePoint/Dataverse success
   must be recoverable without a second paid transcription or duplicate final.
   This boundary needs an implementation-level contract before builds start.
7. Published output survives temporary-job cleanup. Temporary audio/results
   keep their existing bounded retention unless separately approved. Cleanup
   must never delete finalized SharePoint materials. Existing recipient and
   Workbench readers see only governed final materials, not pilot drafts.

## Decisions required before final plan

- Resolve staff collaboration scope explicitly: initiator-only drafts versus
  authorized Meeting Tracker staff, with request access checked independently.
- Specify final durable formats and post-publication name corrections; do not
  promise permanent TXT/VTT regeneration from a seven-day temporary Blob.
- Verify actual release target, Dataverse/Postgres schema prerequisites and
  rollout authorization. No live writes, new provider tests, deployments,
  alias moves, or pilot enablement are authorized by this draft.

## Build and acceptance sequence [PLANNED]

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
Verdict: implementable as a bounded slice after blocking choices/contracts are
recorded; not deployment approval. The requested final adversarial review has
not occurred because implementation has not begun.

Root dispositions:

- Accept the source findings on app-grant access, dedicated-project isolation,
  one transcript slot, immediate reader exposure, and required publication
  recovery. Do not claim per-user request ACLs: current access is app grant,
  rollout request eligibility, and verified request/visit/job binding.
- Accept shared request-bound drafts as the recommendation, subject to the
  pending owner choice. Keep initiating actor attribution, mapped staff
  identity for publication, and existing private pilot jobs isolated. A new
  Meeting Tracker gate must not require enabling the Admin pilot surface.
- Fable recommends permanent TXT only and VTT/corrections within the temporary
  seven-day window. Do not silently adopt that reduction: the owner has been
  asked whether permanent dual-format output and later corrections are needed.
  If required, amend the final-artifact contract rather than publishing two
  competing transcript winners or prolonging temporary storage implicitly.
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

Verdict: **DRAFT — NOT IMPLEMENTATION-READY.**
