---
title: AssemblyAI transcription pilot
domain: transcription
kind: plan
status: draft
summary: "Admin-only, non-sensitive Zoom transcription pilot; implementation and account retention verification pending."
owner: product-engineering
---

# AssemblyAI transcription pilot

Revision 3, 2026-09-30. **PLANNED: no runtime, schema, deployment, or provider test is authorized by this planning document.** Claude Fable reviewed revisions 1 and 2 through subscription OAuth. This revision addresses the second review's eight findings with author qualifications recorded below; it has not received a further independent review. Account-specific feasibility checks remain prerequisites to enabling the pilot. Confidential-use approval remains separate.

## Objective and scope

Evaluate whether AssemblyAI improves Zoom transcription accuracy and speaker separation using three to five explicitly non-sensitive recordings. Deliver a small internal Admin page with upload, durable progress, timestamped speaker transcript, TXT/VTT download, and evaluation notes. No summaries, speaker-name inference, Zoom account integration, grant-record publication, or generic multi-provider framework in this slice.

Owner reports model-training opt-out and zero-data-retention enabled and subprocessor review acceptable. These are owner-reported facts, not independently verified account guarantees. Confidential recordings remain excluded until async retention terms are resolved separately.

Proposed pilot defaults: US endpoint, M4A/MP3 only, 50 MiB (52,428,800 bytes; UI says 50 MiB), maximum four hours, one active provider job globally. A partial unique index on a constant for submitting/processing/saving/submission_uncertain enforces that slot across overlapping workers; queued jobs do not consume it. An uncertain job holds the slot until reconciled or explicitly closed by the operator. A server-side pilot flag defaults off. An explicit Start transcription action discloses that AssemblyAI usage may consume paid credits; no background quality benchmarks or automatic retranscription.

## Evidence and boundaries

Source checkout inspected at a7c68df0162b9461420604fac0e29eb1c608be0b on codex/presentation-session-handoff. Working tree was clean. Read-only source checks do not prove Production configuration.

| Claim | Evidence | Status |
|---|---|---|
| Private upload staging records actor/resource ownership and leases | lib/services/portal-upload-staging.js | VERIFIED in source |
| Existing staging has a one-hour row TTL and fixed scope allowlist | same file, ROW_TTL_MS and PORTAL_UPLOAD_SCOPES | VERIFIED in source; unsuitable for direct unmodified reuse |
| Existing post-presentation transcript validation accepts VTT/TXT/PDF/DOCX up to 25 MiB | lib/utils/post-presentation-transcript-file.js | VERIFIED in source; audio is a separate input contract |
| Admin routes use requireSuperuser | pages/api/admin/stats.js and other Admin routes | Source pattern; implementation must trace auth semantics before reuse |
| AssemblyAI supports authenticated async callbacks and transcript retrieval/deletion | vendor references below | Documented; NOT tested on this account |
| Account privacy settings apply to every proposed project/key | owner report only | UNKNOWN scope; verify before first test |

This pilot's artifacts are temporary operational test data. Postgres owns job metadata; private Blob owns bytes. No Dataverse/SharePoint writes in the pilot. Production publication requires a later request-bound contract and reauthorization. Existing grant transcription-provider workflow decisions remain pending outside this pilot.

## User workflow

Admin opens Transcription Pilot, chooses a file, acknowledges that it is non-sensitive and approved for third-party processing, and starts transcription. The server derives identity from the session and records the acknowledgement. The UI shows upload progress and then queued/transcribing/saving/ready, with explicit failed or needs-attention states. Refreshing or closing the page does not interrupt the job.

Ready shows speaker-labelled utterances and timestamps, processing duration and model identity, downloadable TXT/VTT, and expiry date. The owner can score word accuracy and speaker accuracy from 1–5 and enter correction examples. Speaker labels remain provider labels; no inferred names. Transcript text is rendered as text, never executable HTML. No model executes instructions contained in a transcript.

## Proposed API and service surface

Names below are proposed, not claims that files/routes exist:

- Admin page: /admin/transcription-pilot.
- POST /api/admin/transcription-pilot/jobs: authenticated prepare; creates job and returns a short-lived token for an exact server-chosen private pathname.
- POST /api/admin/transcription-pilot/jobs/:id/start: verifies ownership, upload metadata, actual bytes/container/duration and non-sensitive acknowledgement; atomically queues validated input.
- GET list/detail and authenticated download routes: owner-only, including for other superusers during this pilot; recheck current superuser permission and pilot flag on every access.
- PATCH evaluation route: bounded scores/notes, owner-only, optimistic row version.
- POST /api/admin/transcription-pilot/jobs/:id/reconcile: owner-only current superuser with non-null profile; accepts an exact provider ID and expected row version for an uncertain attempt. After obtaining a lease, verify the provider object with our API key, matching decrypted upload reference and unique provider-ID binding; commit only with the same lease/version. No arbitrary URLs. Fail closed if the reference has already been purged. A cleanup-requested job proceeds only to cleanup, never publication.
- POST /api/admin/transcription-pilot/jobs/:id/abandon: same owner/auth and expected-version checks; available only for submission_uncertain with no valid processing lease. Require explicit acknowledgement that provider work may remain active and a later submission may incur another charge. Atomically record a content-free abandonment receipt, mark failed, request cleanup and release the local slot. No resubmit occurs in this action. The Admin Needs attention view exposes both recovery actions and their outcomes; invalid or stale actions make no change. Both recovery routes remain available when submission is disabled; the pilot flag still gates user access. Include both in the security matrix and audit tests.
- DELETE job route: requests cleanup, blocks new processing and further content access; does not falsely claim remote cancellation or immediate erasure.
- POST /api/webhooks/assemblyai: HTTPS shared-secret authentication, bounded JSON body and durable per-attempt correlation as specified below. Only records a candidate ID/marks a job due for retrieval; no trust in callback content or status.
- Scheduled worker endpoint: cron authentication, processes bounded batches with leases; handles submission, status reconciliation, retrieval and cleanup. Worker must continue recovery/cleanup when the UI pilot flag is off; separate submission switch controls new provider work.

Use a small AssemblyAI-specific audio service (upload, submit, status, result, delete), outside the text-generation Executor. Fable's source review found the existing clients are text-oriented. Route provider HTTP through safeFetch with exact AssemblyAI host allowlisting and fail-on-redirect support; do not use the text model usage log. Track spend in the AssemblyAI dashboard and content-free duration/job receipts during the pilot.

## Durable model and transitions

New operational table, proposed name transcription_jobs; reserve the migration number at implementation time, since other workstreams have reservations. Update migration manifest and fresh-install shape together.

Fields: UUID; owner profile; creation/update/version; acknowledgement timestamp; original filename; declared and verified MIME/size; audio duration/hash/etag; exact input pathname; provider region/model/options snapshot; encrypted provider upload reference (sensitive, server-only); provider transcript ID; immutable attempt correlation ID; candidate/conflicting provider IDs and conflict marker; submission intent; request idempotency key; state; lease token/expiry; attempt count/next-attempt; sanitized error code; output/allowlisted-diagnostic pathnames and hashes; ready/content-expiry/receipt-expiry times; evaluation scores/notes; content_purged_at/reference_purged_at; abandonment acknowledgement/time; cleanup request/provider/local completion times. API responses never expose credentials, provider upload URLs, or storage tokens.

Processing states: uploading → queued → submitting → processing → saving → ready. Alternatives: failed (known terminal failure), submission_uncertain (acceptance unknown), expired (content access ended). Cleanup is tracked independently, so a cleanup failure never erases a usable saved result or labels deletion successful.

Unique (owner, client idempotency key) prevents double-click jobs. Unique non-null provider transcript ID prevents cross-job attachment. Atomic conditional transitions and expiring leases serialize workers; every post-I/O persistence write must require the current lease token. Recheck state/version after every external call. Output object paths are deterministic per job/result version so recovery can verify existing hashes.

Worker uploads verified private audio to AssemblyAI's authenticated upload endpoint, persists its encrypted reference, records submission intent, then submits. No public Blob URL or arbitrary user URL is accepted. Before POST, persist one immutable, cryptographically random per-attempt correlation ID (at least 128 bits). There is no separate nonce or stored authentication digest. Send the ID in the webhook URL query; set the custom authentication header to hex HMAC-SHA256 keyed by ASSEMBLYAI_WEBHOOK_SECRET over the UTF-8 string `transcription-callback:v1:` followed by the canonical correlation ID. The callback validates canonical ID/header format, recomputes the HMAC and constant-time compares before database lookup. Never log the header. Secret rotation invalidates callbacks for in-flight attempts: known provider IDs remain pollable, unknown IDs require operator reconciliation or explicit abandonment. Query parameters and custom headers are documented; live delivery remains a fixture test.

The callback validates the attempt ID/header and compares any already-bound provider ID. If the POST response has not committed its ID, record a candidate provider ID under the immutable attempt (a narrow conditional update independent of the worker's processing lease). A worker retrieves it with our API key and verifies the returned audio_url against the encrypted upload reference before binding. Differing callback/POST IDs set a durable conflict marker with both IDs recorded as restricted operational metadata. A lease-fenced worker must transition the job to submission_uncertain, retaining the slot and requiring operator reconciliation; binding/publication checks reject any outstanding conflict. Callback cannot publish or resurrect content. Unknown/expired authenticated correlators return 200 with a content-free counter; invalid authentication returns 401; a transient database failure returns 503 rather than acknowledging an unrecorded known callback. This deliberately requests vendor retry, but 5xx retry benefit is unverified until fixture testing. Polling is authoritative only when a provider ID is known; a lost callback with an unknown ID requires the operator path.

Timeouts between remote acceptance and receipt persistence produce submission_uncertain; do not automatically submit again. Expired submitting leases also enter this state, never queued. Callback correlation can recover it; without callback delivery, an operator may supply a provider ID, which must pass the same API-key, audio-reference and uniqueness checks. No match means no automatic Retry button; explicitly abandoning the attempt records potential duplicate-cost/cleanup exposure before a new attempt. Documentation exposes no creation idempotency parameter; this is not proof that no such vendor capability exists.

Provider processing failures preserve the original error code. Retryable GET/download/save errors use bounded backoff and reuse the same provider ID. Callback is an optimization for known-ID jobs and a recovery aid for uncertain submissions: polling must retrieve promptly enough to beat account TTL. Final completion requires durable normalized JSON plus TXT/VTT derivable from that JSON; save and hash-check before requesting provider deletion. Store only allowlisted provider diagnostics privately for the diagnostic retention period, never the unfiltered raw response. Empty/no-speech results are explicit outcomes, not fabricated transcripts.

## Upload and runtime feasibility

Reuse the private browser-direct upload pattern, but give transcription_jobs ownership of its paths and expiration; do not add a scope to the existing portal helper unless a full cleanup-consumer audit justifies it. UPLOADS_BLOB_RW_TOKEN is a candidate store credential, subject to its store policy; never use the intake or public token. Token mint and finalization independently enforce identity, byte cap and exact job pathname.

M4A/MP3 filename/MIME are not sufficient validation. Probe actual container, codec and duration with a supported bounded media inspector. Before full implementation, prove runtime/library compatibility, maximum-size upload/transfer, bounded memory, malformed-file behavior, and Function timeout runway. Malware scan support for audio must be established; document unsupported formats rather than claim scanning. If required validation/transfer cannot run safely within the existing runtime, return for a concrete hosting decision instead of adding infrastructure implicitly.

No request or response carries the 50 MiB file through the browser-facing Function. Worker reads with an enforced byte counter into a buffer capped at 50 MiB; measure peak memory including inspection/upload copies. Provider calls reject redirects to prevent credential forwarding and body replay. Implement safeFetch's explicit no-redirect option with unchanged defaults for other callers and regression tests. Jobs continue outside browser lifetime through the scheduled worker; no unawaited fire-and-forget work. Worker deployment must have a verified schedule and callback reachability; authenticated polling supports a protected Preview where callbacks cannot enter, with operator reconciliation for lost-submit responses. Do not disable deployment protection to obtain webhook delivery.

Proposed worker: /api/cron/drain-transcriptions, every minute, explicit maxDuration 300 seconds in route and vercel.json, 240-second internal budget, individual network calls aborted before budget exhaustion, seven-minute lease. No lease renewal extends work beyond invocation budget. Overlapping invocations skip leased work. Media validation in start also needs an explicit bounded duration; if unsafe there, persist a validating state and move it to the worker before queue admission. Verify runtime feasibility before choosing that variant.

TRANSCRIPTION_PILOT_ENABLED controls UI/user operations; TRANSCRIPTION_SUBMISSIONS_ENABLED controls only provider upload/create calls. Both require literal true; missing or any other value means disabled. This is a naming/convention choice, not an additional safety mechanism. Automated recovery, callbacks and cleanup continue when either is off; reads and manual recovery may be disabled but cleanup is not. Implement verifyTranscriptionCronSecret with constant-time CRON_SECRET checking and no development bypass, following the strict dossier/review-panel guards. Every user operation requires a non-null authenticated profile in addition to requireSuperuser; local pilot testing requires real authentication, since dev auth bypass cannot create an owner.

## Privacy, retention and deletion

Provider no-training settings are account/project configuration, not an invented request parameter. Record their operator confirmation date and scope; local flags cannot certify external configuration. Non-sensitive acknowledgement limits use but does not automatically detect sensitive speech.

Proposed local policies: uploaded-but-never-started audio expires after 24 hours; successful audio deleted after the result is committed; failed/unresolved audio expires at seven days; results/allowlisted diagnostics/evaluation notes expire seven days after ready (or creation for never-ready jobs). Each read enforces expires_at immediately, independent of cron. The minute worker begins physical cleanup on its next successful tick after expiry; delays/failures are visible. Restricted operational/evaluation receipts expire 30 days after ready, or creation for never-ready jobs. Their allowlist is opaque job ID, owner binding for access control, numeric word/speaker scores, audio and processing duration, requested/returned model identity, lifecycle timestamps, sanitized outcome and cleanup/abandonment status. These fields are minimized, not presumed non-sensitive; they remain owner-only and unavailable for broad analytics. Filename, transcript, correction examples, free-text notes and encrypted upload references are excluded and purged with content. Unresolved cleanup retains only the identifiers and status necessary for exact cleanup until resolution; it does not extend score/content retention. After reference purge, automatic or manual audio-reference reconciliation is unavailable; show that limitation and require explicit abandonment to release an uncertain slot.

The pilot owner who starts and scores the recordings owns the evaluation export. Trigger it immediately after scoring the third recording, update after any fourth/fifth recording, and complete it before the earliest 30-day receipt expiry. The evaluation view displays that deadline. Export only approved non-sensitive aggregate scores and findings to a dated evaluation record; do not copy filenames, transcripts, notes, owner IDs or per-job provider identifiers. If the pilot ends before three recordings, export at closeout. Receipt retention provides a comparison window, not a promise of automatic archival.

Encrypt provider upload references using the existing AES-GCM/HKDF pattern with a distinct transcription purpose context, never the presentation context. Strip audio_url, webhook URL/auth fields, and other credential-bearing fields from diagnostic JSON; use an allowlisted diagnostic shape. Never log audio, transcript, filenames, evaluation notes, callback headers, provider references or full provider errors. Completion must carry output pathname/hash/ready_at; ready CHECKs require these fields. Expiry clears content pointers and changes ready to expired atomically. submission_uncertain requires submit intent and either an encrypted upload reference or an explicit reference_purged_at marker, so purging content never releases its slot. Failed/expired rows permit null content fields; failed with content_purged_at displays "Failed — content deleted," while uncertain with purged reference displays "Needs attention — verification reference expired." Keep minimal exact-path cleanup identifiers until physical deletion is confirmed, separately from readable content pointers. UI uses one total mapping: processing → Transcribing, submission_uncertain → Needs attention, all other persisted states explicitly mapped.

Cleanup claims exact persisted paths under a lease, blocks competing processing, retries independently, and keeps tombstones until cleanup is confirmed. DELETE atomically sets cleanup_requested_at and blocks all further content access; it does not change a leased processing state or release the slot. Every claim and post-I/O write checks this marker. A queued/uploading job without a lease can transition directly to expired for cleanup. An active worker records the outcome/ID of its in-flight call, then performs lease-fenced cleanup transitions without publishing content. Unknown submission acceptance becomes submission_uncertain and continues holding the slot; DELETE is never implicit abandonment. For a known active provider job, retain the slot until terminal status or verified provider deletion, not merely a queued deletion request. On lease expiry, recovery must reconcile external work before release. Never delete an input while a valid transfer lease is using it. No blind prefix deletion. Missing objects count as absent; transient errors do not. Late webhooks for deleted/expired/abandoned jobs cannot recreate content or occupy a new slot; a verified late provider ID may update the cleanup receipt for exact deletion only. Explicit abandonment is the acknowledged exception to the one-active-provider-job intent: local concurrency is bounded, but unknown remote work may still be running.

Provider deletion: request by exact known transcript ID only after local save or explicit user deletion/expiry. Verify documented API deletion behavior; a successful API receipt proves only API-level deletion, not backup erasure. Uploaded-but-unsubmitted provider audio may require TTL/support cleanup: confirm vendor semantics and retain a content-free unresolved-cleanup receipt if deletion cannot be verified. Local expiry is independent of provider retention.

Keep region explicit and API key/webhook secret server-side. No gateway, summarization, model fallback, or second provider in this pilot. Unknown account retention behavior does not block approved non-sensitive testing, but remains a confidential-use release gate.

## Implementation sequence and acceptance

1. Read-only source/contract check and non-sensitive fixture preparation. Confirm project/key privacy scope and model availability without transmitting recordings.
2. Implement job migration, private upload/validation, AssemblyAI service and worker. Unit tests plus real scratch-Postgres lease/uniqueness/crash tests.
3. Implement webhook, polling recovery, deletion lifecycle, and Admin UI. Test owner isolation, revoked access, refresh, stale UI responses, and output escaping.
4. Deploy a deliberately enabled test environment after review. User supplies API key via approved secret entry, never chat, and authorizes AssemblyAI test usage that may consume credits. No live account writes or metered tests are part of the current plan task.
5. Run three recordings, then up to five if the initial evidence is useful. Compare the same manually checked passages with Zoom; capture correction time, proper names/technical terms, speaker errors, timestamps, total processing time, duration and billed cost where available. Estimate cost only from a dated verified price; label it estimated.

Discriminating tests: exact cap and cap+1; malformed M4A/MP3; oversized actual bytes despite declared size; cross-owner job/download/reconcile/abandon; invalid callback secret and unknown ID; duplicate/out-of-order callbacks; callback before provider-ID commit; callback/POST ID conflict; secret rotation mid-attempt; database failure/503 with missing redelivery; lost submit response (no automatic second charge); crash after output write before ready; expired lease after external success; missing webhook with known versus unknown provider ID; provider result expires before retrieval; local storage failure; provider deletion failure; DELETE during upload and on uncertain jobs; cleanup racing submission/retrieval; stale reconcile/abandon requests and provider-ID uniqueness conflicts; uncertain-reference purge preserving the slot; late callback after purge/abandonment; score receipt expiry and export deadline; UI navigation during an awaited result.

Relevant build gates: migration manifest, Atlas, route-security matrix, secret tracking/runbook, service catalogue, status/consumer parity, instruction invariants, and applicable security/lifecycle gates with their self-tests sequentially. Explicit integration changes: exact api.assemblyai.com/api.eu.assemblyai.com safeFetch hosts; exact anchored api/webhooks/assemblyai proxy exemption; verifyAssemblyAIWebhook and verifyTranscriptionCronSecret recognition in the route checker; webhook matrix wording "shared secret" (not a claim of provider-signed HMAC); ASSEMBLYAI_API_KEY and ASSEMBLYAI_WEBHOOK_SECRET tracking/runbook entries plus reconcile the missing UPLOADS_BLOB_RW_TOKEN entry if reusing that token. Verify purpose-separated encryption key availability. Gate tests must reject sibling webhook paths, missing secrets, null profiles and redirected credential-bearing requests. Document new table and routes only when implemented; do not publish planned schema as live.

Quality acceptance: owner determines whether reduced correction effort and usable speaker attribution justify adoption; no invented accuracy threshold. Engineering acceptance: each job recovers without silent duplication, each result is owner-protected, cleanup status is truthful, and maximum-size non-sensitive audio completes. Confidential-use acceptance separately requires confirmed async retention and contractual coverage of audio, transcript, derived/de-identified content and subprocessors.

## Contract review scope

Change: isolated Admin transcription pilot. Entry points: upload/start/list/detail/download/evaluation/delete, callback and worker. Persistence: new Postgres operational jobs and private Blob; external AssemblyAI jobs. Consumers: Admin UI, exports, worker and cleanup. Prior issues: one-hour staging mismatch; account ZDR ambiguity; remote-submit acceptance gap.

Seven audits: whole flow, partial success, async/stale ownership, durable surfaces and status consumers are specified above and require implementation tests. Helper extraction: no generic framework proposed. Durable-doc reconciliation: this is a new proposed capability, not a change to production facts; search AssemblyAI/transcription-pilot restatements before finalizing review. No production probe, migration or runtime test has been performed for this document.

## Vendor references

- https://www.assemblyai.com/docs/data-retention-and-model-training — async TTL/deletion is not an immediate physical-erasure promise; current documentation supersedes older support snippets.
- https://www.assemblyai.com/docs/pre-recorded-audio/webhooks — authenticated notification followed by result retrieval.
- https://www.assemblyai.com/docs/pre-recorded-audio/select-the-region — US/EU endpoint selection.
- https://www.assemblyai.com/legal/data-processing-addendum — contractual review source, not evidence of account configuration.

## Review record

Claude Code host authentication returned claude.ai/firstParty/Team. After explicit user authorization of source sharing, Fable completed both read-only reviews as claude-fable-5-1. Full unfiltered historical reviews and fingerprints: [revision 1 review](evidence/ASSEMBLYAI_PILOT_FABLE_REVIEW_2026-09-30.md), [revision 2 review](evidence/ASSEMBLYAI_PILOT_FABLE_REVIEW_R2_2026-09-30.md). Revision 1 verdict: **Not implementation-ready. Direction sound.** Revision 2 verdict: **Design-ready for a bounded non-sensitive implementation slice after four must-fix text corrections.** Neither review authorizes confidential recordings. No model API key, Ultrareview, runtime mutation or deployment was used.

### Revision 3 dispositions of revision 2 findings

| Finding | Author disposition |
|---|---|
| N1 HIGH — ambiguous callback authentication | Accepted: one correlation ID and fully specified purpose-bound HMAC, no separate nonce/digest, verification before lookup, explicit rotation consequences. Severity describes a design ambiguity, not a demonstrated vulnerability. |
| N2 LOW — 503 retry assumption | Accepted: 5xx retries remain a fixture check; document loss handling separately for known and unknown provider IDs. |
| N3 MEDIUM — missing operator surface | Accepted: owner-only reconcile/abandon routes and Admin actions, lease/version checks, audit receipts and security-matrix coverage; no hand-edited database recovery. |
| N4 MEDIUM — evaluation retention | Accepted with qualification: explicit minimized 30-day receipt fields, owner and export trigger; metadata is restricted, not assumed non-sensitive. Free text remains on the content schedule. |
| N5 MEDIUM — DELETE versus leases/slot | Accepted: cleanup marker immediately denies access but preserves leased state and uncertain slot. Only reconciliation or acknowledged abandonment resolves unknown work. |
| N6 LOW — provider-ID conflict state | Accepted: durable conflict marker blocks binding/publication; lease-fenced transition to submission_uncertain with both IDs and operator recovery. |
| N7 LOW — flag value convention | Adopt literal true with disabled default. Convention choice, not a safety finding. |
| N8 LOW — post-purge failed shape | Accepted: explicit null-content shape and UI labels. Also reconcile uncertain-reference purge with its CHECK and continued slot ownership. |

Author also corrected "raw response" wording to allowlisted diagnostics throughout current guidance. Additional design qualification: explicit abandonment can release the local slot but cannot promise cessation of unknown remote work. No provider behavior was newly verified for this amendment.

Bounded durable-document sweep (changed-fact mode): current authority is the owner's amendment request plus the two fingerprinted review records. Search of docs, memory, session/instructions and application directories for the plan name, transcription_jobs and TRANSCRIPTION_PILOT_ENABLED found this live plan and the two historical review records only. This plan is updated structurally; review evidence remains verbatim historical. All new behavior remains PLANNED; account configuration, runtime viability and operational tests remain UNKNOWN/unperformed. No current runtime/Atlas/schema claims are changed.

### Historical revision 1 findings and revision 2 author dispositions

| # | Fable severity / finding | Revision 2 disposition |
|---|---|---|
| 1 | HIGH — SSRF allowlist/redirect replay | Accepted: exact hosts and no-redirect safeFetch option with regression tests. |
| 2 | HIGH — proxy blocks new webhook | Accepted: exact anchored exemption specified. |
| 3 | MEDIUM — checker guard registration | Accepted: named verifiers and shared-secret matrix wording. |
| 4 | MEDIUM — uploads token untracked | Accepted: reconcile reused token plus two provider secrets. |
| 5 | MEDIUM — worker duration/leases | Accepted: 300-second wall, 240-second budget, seven-minute lease, overlap guard. |
| 6 | MEDIUM — two switches unspecified | Accepted: names and independent recovery semantics specified. |
| 7 | MEDIUM — null development owner | Accepted: all user operations require real profile. |
| 8 | LOW — development cron bypass | Accepted: strict verifier, no dev bypass. |
| 9 | LOW — expiry cadence | Accepted with modification: immediate logical expiry; minute cleanup and truthful lag, not "no earlier than" user access. |
| 10 | LOW — buffering versus streaming | Accepted: 50 MiB bounded buffer with measured peak memory. |
| 11 | LOW — plaintext provider reference | Accepted: purpose-separated encryption pattern. |
| 12 | LOW — terminal constraints | Accepted: ready and uncertain CHECK requirements. |
| 13 | HIGH — unknown-ID callback/race | Accepted with correction: per-attempt authenticated correlation; unknown correlators acknowledged; known DB errors retry. Vendor 4xx does NOT retry. |
| 14 | HIGH — uncertain submission recovery | Accepted: documented query correlation + custom auth header; verify returned audio reference; operator-only fallback. |
| 15 | MEDIUM — global concurrency race | Accepted: one global active slot enforced by partial unique index. |
| 16 | MEDIUM — evaluation evidence expires | Concern accepted; route-removal suggestion declined to preserve agreed UI. Export aggregate evaluation evidence before expiry. |
| 17 | MEDIUM — raw JSON contains audio URL | Accepted: allowlisted diagnostics without bearer references. |
| 18 | MEDIUM — content in logs | Accepted: explicit prohibition. |
| 19 | LOW — spend visibility | Accepted: vendor dashboard plus content-free duration receipts; no unsupported internal spend integration claim. |
| 20 | LOW — state vocabulary | Accepted: total persisted-state/display-label mapping. |
| 21 | LOW — audio service boundary | Accepted: dedicated audio service through safeFetch. |
| 22 | MEDIUM — optional webhook scope | Retain webhook as requested and for uncertain-submission recovery; polling remains fallback. |
| 23 | HIGH — ZDR at delivery time | Current docs distinguish async TTL (minimum one hour plus deletion lag) from streaming ZDR. Webhook carries only ID/status, so immediate deletion would break webhook retrieval too. Account-specific behavior still requires non-sensitive probe/support confirmation; do not assume webhook cures it. |
| 24 | HIGH — creation idempotency | Current submit reference searched for idempotency: no documented parameter found. Conservative no-resubmit policy remains; vendor capability absence NOT proved. |
| 25 | MEDIUM — orphan upload lifetime | Documented TTL/deletion table reviewed; exact account/upload-only lifecycle still a fixture/support check. |
| 26 | MEDIUM — webhook retry behavior | Docs: 2xx within 10 seconds, up to 10 attempts; 4xx stops retries. Callback contract corrected. |
| 27 | LOW — returned model/deletion metadata | Submit reference documents speech_model_used and is_deleted. Display requested model plus actual when returned; otherwise "not reported." DELETE metadata semantics remain a fixture check. |

Vendor checks performed 2026-09-30 against references above and https://www.assemblyai.com/docs/pre-recorded-audio/api-reference/transcripts/submit. These are documentation checks, not account probes. Remaining prerequisites: actual TTL/retrieval window; upload-only cleanup; response-loss/correlation and 5xx-retry fixtures; runtime media validation and byte-transfer budget; deployment scheduler availability. Revision 3 incorporates the author's response to the second review and is ready as a plan for a bounded implementation feasibility slice, not certified for enabled or confidential use. Revision 3 has not been independently re-reviewed. Implementation still requires its own authorization, source/Atlas checks, tests and deployment review.
