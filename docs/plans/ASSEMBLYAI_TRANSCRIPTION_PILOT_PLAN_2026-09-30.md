---
title: AssemblyAI transcription pilot
domain: transcription
kind: plan
status: dedicated-project-local-preparation-not-deployed
summary: "Disabled Preview at d8bb73326 passed bounded synthetic checks. Dedicated-project configuration and isolation are being prepared locally; no new project, deployment, schedule activation, alias move or provider use is authorized by the local-build approval."
owner: product-engineering
---

# AssemblyAI transcription pilot

Revision 3 with isolated initialization and disabled Preview checkpoints, 2026-10-01. **Current status: source is ahead of the deployed Preview; dedicated-project preparation is local only.** The deployed baseline remains `dpl_3pBYPpEuVS9pjJCKRPt2cNuyZyx6`, commit `d8bb7332654569343e5e1e8985f51a45aae6b25c`, with both switches false. Its protected 13-check preflight, empty recovery, and one provider-free synthetic Workflow retry/sleep/media canary passed; the pilot alias was verified to target that deployment. Those receipts do not verify the newer local isolation code. Migrations 060–061 were applied/read back only in isolated Neon, with 58 tracker records and zero jobs/outbox rows at the recorded checkpoint. No recurring Preview schedule, AssemblyAI call, real recording, current-alias staff sign-in, or 50 MiB Function test is established. The [pre-enable runbook](ASSEMBLYAI_TRANSCRIPTION_PILOT_RUNBOOK_2026-09-30.md) retains exact hosted receipts and governs the remaining gates.

**Dedicated-project direction [LOCAL BUILD AUTHORIZED; HOSTED WORK NOT AUTHORIZED]:** use a separate pilot-only project with its own Vercel Production environment, exact hourly recovery/daily cleanup schedules, dedicated Neon/private Blob, no unrelated credentials, and both transcription switches false. The separate manifest and offline configuration checker do not create or activate anything. The source-pinned project registry remains empty until separately approved creation and identity review. Verify pilot-only server access, protected native scheduling/Workflow delivery, sign-in, failure/incomplete/missed-run monitoring, and zero jobs/outbox/active runs before any separately approved alias cutover. Keep the current alias target meanwhile. Shared WMKF Production is not this target.

Claude Fable reviewed revisions 1 and 2 through subscription OAuth. Revision 3 incorporates the second review's findings and qualifications recorded below. Luna built the implementation, Sol independently reviewed it, and root performed the integrated correction/verification pass. Sol's safety acceptance is for the disabled implementation branch, not pilot enablement. Account-specific feasibility checks remain prerequisites to enabling the pilot. Confidential-use approval remains separate.

## Objective and scope

Evaluate whether AssemblyAI improves Zoom transcription accuracy and speaker separation using three to five explicitly non-sensitive recordings. Deliver a small internal Admin page with upload, durable progress, timestamped speaker transcript, TXT/VTT download, and evaluation notes. No summaries, speaker-name inference, Zoom account integration, grant-record publication, or generic multi-provider framework in this slice.

The owner's Data Controls screenshot shows model-improvement opt-out enabled and asynchronous TTL set to one day, not zero retention. Subprocessor review is owner-reported acceptable. Project/key coverage, deletion lag and upload-only cleanup remain unverified. The owner accepts these uncertainties for explicitly non-sensitive testing without vendor support emails; this does not authorize confidential recordings or paid test calls. Confidential recordings remain excluded until async retention terms are resolved separately.

Pilot defaults in source: US endpoint, M4A/MP3 only, 50 MiB (52,428,800 bytes; UI says 50 MiB), maximum four hours, one active provider job globally. A partial unique index on a constant for submitting/processing/saving/submission_uncertain enforces that slot across overlapping workers; queued jobs do not consume it. An uncertain job holds the slot until reconciled or explicitly abandoned by the operator. User and submission switches require literal `true`; source defaults to disabled. An explicit Start transcription action discloses that AssemblyAI usage may consume paid credits; no background quality benchmarks or automatic retranscription.

## Evidence and boundaries

The original design review inspected source at `a7c68df0162b9461420604fac0e29eb1c608be0b` on `codex/presentation-session-handoff`; that checkout is historical evidence, not this implementation branch. Current source inventory and deployment boundaries are:

| Claim | Evidence | Status |
|---|---|---|
| Pilot Admin page, API routes, callback, worker, media/provider/runtime services and job store exist in source | `pages/admin/transcription-pilot.js`, `pages/api/admin/transcription-pilot/`, `pages/api/webhooks/assemblyai.js`, `pages/api/cron/drain-transcriptions.js`, `lib/services/transcription-pilot/` | SOURCE-BUILT in branch |
| Job schema and workflow-dispatch outbox are registered as migrations 060–061 and fresh-install source | `lib/db/migrations/060_transcription_jobs.sql`, `lib/db/migrations/061_transcription_workflow_dispatches.sql`, manifest, `scripts/setup-database.js` | SOURCE-BUILT; 060–061 applied/read back only in isolated Neon; deployed baseline is d8bb73326, newer isolation work remains local |
| Store lease/owner/unique-slot behavior and database constraints | focused Jest unit tests plus `tests/integration/transcription-pilot.pg.test.js` in an isolated local scratch schema | Locally tested; no shared schema proof |
| Parser, provider, worker, route and safe-fetch branch behavior | 13 focused suites / 126 tests, type check, ESLint and default Turbopack production build passed; compiled Turbopack worker and one hosted synthetic canary accepted the 3.065-second AAC after two packaging/handoff fixes | Local branch and one bounded hosted synthetic-canary evidence; no real audio/provider proof |
| AssemblyAI privacy controls | Owner screenshot: opt-out on, one-day async TTL; no API/provider probe | Screenshot evidence only; key scope and deletion guarantees UNKNOWN |
| Isolated test resources | Neon initialized in isolation; the branch environment refers to the dedicated Neon and private Blob resources. The resources remain unconnected through Marketplace integration. | Isolated resource use is branch-scoped; project-wide environment records remain unchanged |
| Existing Preview database binding | Thirteen variables were explicitly supplied as runtime and build overrides for the disabled Preview deployment; latest protected read-only preflight verified expected dedicated Neon identity, read-only DB connection, and zero jobs. | VERIFIED for `dpl_3pBYPpEuVS9pjJCKRPt2cNuyZyx6`; secret values are not readable; earlier deployment binding was inconclusive |
| Fresh-install bootstrap and isolated readback | Local rollback/refusal tests; isolated operator ran once; bootstrap `--verify-only` checked 57 tracker entries/provenance (53 SQL plus four retired), key physical schema and exact active admin role; subsequent migration-061 readback verified 58 tracker entries | VERIFIED isolated initialization and 061; Sol reviewed and root verified; no shared migration/apply was performed; earlier sign-in target unknown, no shared mutation confirmed |
| Pre-initialization Neon catalog | `scripts/probe-transcription-preview.js` found only nine provider-owned `neon_auth` tables, one visible configuration row and zero visible rows in the other eight; RLS not bypassed and no values read | Historical preflight; reviewed public-only bootstrap preserved provider schema |
| Test administrator | One active linked profile and one superuser role for `jgallivan@wmkeck.org`; zero transcription jobs; nine provider-owned Auth tables remain | VERIFIED via independent read-only operator check |
| Disabled Preview runtime check | Latest disabled deployment `dpl_3pBYPpEuVS9pjJCKRPt2cNuyZyx6`, commit `d8bb7332654569343e5e1e8985f51a45aae6b25c`, returned all 13 readiness checks true, zero jobs/dispatches, and completed the provider-free synthetic retry/sleep/parser canary. Previous deployment `dpl_E2P1r1aLBD32z5fsxim2Jsh4rVss` had the documented canary failure before fixes. | DISABLED; readiness, empty recovery, and one synthetic hosted canary verified; no provider or real-audio work |
| Authentication and callback | Alias `wmkf-transcription-pilot.vercel.app` was verified to target the same project/deployment as `dpl_3pBYPpEuVS9pjJCKRPt2cNuyZyx6`; alias preflight passed all 13 checks with zero jobs/outbox rows. | Alias target and disabled readiness verified; refreshed staff sign-in and callback delivery pending |
| Provider-free storage/media check | `node scripts/check-transcription-preview-storage.js --confirm-private-blob-roundtrip` passed: dedicated DB had zero jobs; synthetic AAC (16,863 bytes, 3.065034 seconds) completed private Blob put/read/hash/media checks and exact-path deletion verification. | Local parser/Blob SDK proof only; hosted Blob roundtrip unverified; separate synthetic parser canary passed |

Postgres is intended to own temporary job metadata; private Blob owns audio and result bytes; AssemblyAI owns remote asynchronous processing. No Dataverse or SharePoint writes are in scope. Production publication requires a later request-bound contract and reauthorization. Existing grant transcription-provider workflow decisions remain pending outside this pilot.

## User workflow

Admin opens Transcription Pilot, chooses a file, acknowledges that it is non-sensitive and approved for third-party processing, and starts transcription. The server derives identity from the session and records the acknowledgement. The UI shows upload progress and then queued/transcribing/saving/ready, with explicit failed or needs-attention states. If the job is saved but durable-workflow start delivery is pending, the API returns the queued job with a retryable 503; the UI retains/selects that job and offers Retry start. This retries delivery for the existing job and does not upload audio again or create another provider submission. Refreshing or closing the page does not interrupt active work.

Ready shows speaker-labelled utterances and timestamps, processing duration and model identity, downloadable TXT/VTT, and expiry date. The owner can score word accuracy and speaker accuracy from 1–5 and enter correction examples. Speaker labels remain provider labels; no inferred names. Transcript text is rendered as text, never executable HTML. No model executes instructions contained in a transcript.

## Implemented API and service surface (branch source only)

- Admin page: `/admin/transcription-pilot`.
- Admin API source: `/api/admin/transcription-pilot/jobs` (list/create), `/jobs/[id]` (read/delete), `/jobs/[id]/start`, `/jobs/[id]/download`, `/jobs/[id]/evaluation`, `/jobs/[id]/reconcile`, `/jobs/[id]/abandon`, and `/evaluation-export`.
- Callback and worker source: `/api/webhooks/assemblyai` and `/api/cron/drain-transcriptions`.
- Source modules: `media-inspector.js`, `audio-inspector-worker.js`, `crypto.js`, `provider.js`, `runtime.js`, `worker.js`, `model.js`, and `store.js` under `lib/services/transcription-pilot/`.

These paths are source inventory; the disabled candidate deployment has not exercised each route. The bounded runtime preflight and empty drain exercised no job lifecycle or provider operation. User routes require a fresh superuser check and a non-null authenticated profile; job reads and mutations are owner-scoped. Reconcile verifies an exact provider ID against the decrypted upload reference under a lease; abandon requires explicit acknowledgement, records that remote work may remain active, requests cleanup, and does not resubmit. DELETE blocks further content access but does not claim remote cancellation or immediate erasure. Route-security matrix registration and release gates remain tracked separately.

Use a small AssemblyAI-specific audio service (upload, submit, status, result, delete), outside the text-generation Executor. Fable's source review found the existing clients are text-oriented. Route provider HTTP through safeFetch with exact AssemblyAI host allowlisting and fail-on-redirect support; do not use the text model usage log. Track spend in the AssemblyAI dashboard and content-free duration/job receipts during the pilot.

## Durable model and transitions

New operational table `transcription_jobs` is source-built in `lib/db/migrations/060_transcription_jobs.sql`, registered in the manifest and fresh-install shape. Migration 060 remains provisional, applied only to the isolated Neon database; migrations 058 and 059 remain reserved for other work. Migration 061 adds the durable-workflow dispatch outbox `transcription_workflow_dispatches`; it has been applied once and read back only in isolated `neondb`, with zero jobs and no pending migration files. No shared database was read or changed, and 061 is not in the earlier disabled deployment. Reconcile the target migration tracker and physical schema before any future authorized apply; see the pre-enable runbook.

Fields: UUID; owner profile; creation/update/version; acknowledgement timestamp; original filename; declared and verified MIME/size; audio duration/hash/etag; exact input pathname; provider region/model/options snapshot; encrypted provider upload reference (sensitive, server-only); provider transcript ID; immutable attempt correlation ID; candidate/conflicting provider IDs and conflict marker; submission intent; request idempotency key; state; lease token/expiry; attempt count/next-attempt; sanitized error code; output/allowlisted-diagnostic pathnames and hashes; ready/content-expiry/receipt-expiry times; evaluation scores/notes; content_purged_at/reference_purged_at; abandonment acknowledgement/time; cleanup request/provider/local completion times. API responses never expose credentials, provider upload URLs, or storage tokens.

Processing states: uploading → queued → submitting → processing → saving → ready. Alternatives: failed (known terminal failure), submission_uncertain (acceptance unknown), expired (content access ended). Workflow dispatch state is kept separately in the 061 outbox so a delivery retry reuses the existing queued job without another browser upload. Existing job leases and persisted submission-intent fences prevent blind provider resubmission; the outbox alone is not that guarantee. Cleanup is tracked independently, so a cleanup failure never erases a usable saved result or labels deletion successful.

Unique (owner, client idempotency key) prevents double-click jobs. Unique non-null provider transcript ID prevents cross-job attachment. Atomic conditional transitions and expiring leases serialize workers; every post-I/O persistence write must require the current lease token. Recheck state/version after every external call. Output object paths are deterministic per job/result version so recovery can verify existing hashes.

Worker uploads verified private audio to AssemblyAI's authenticated upload endpoint, persists its encrypted reference, records submission intent, then submits. No public Blob URL or arbitrary user URL is accepted. Before POST, persist one immutable, cryptographically random per-attempt correlation ID (at least 128 bits). There is no separate nonce or stored authentication digest. Send the ID in the webhook URL query; set the custom authentication header to hex HMAC-SHA256 keyed by ASSEMBLYAI_WEBHOOK_SECRET over the UTF-8 string `transcription-callback:v1:` followed by the canonical correlation ID. The callback validates canonical ID/header format, recomputes the HMAC and constant-time compares before database lookup. Never log the header. Secret rotation invalidates callbacks for in-flight attempts: known provider IDs remain pollable, unknown IDs require operator reconciliation or explicit abandonment. Query parameters and custom headers are documented; live delivery remains a fixture test.

The callback validates the attempt ID/header and compares any already-bound provider ID. If the POST response has not committed its ID, record a candidate provider ID under the immutable attempt (a narrow conditional update independent of the worker's processing lease). A worker retrieves it with our API key and verifies the returned audio_url against the encrypted upload reference before binding. Differing callback/POST IDs set a durable conflict marker with both IDs recorded as restricted operational metadata. A lease-fenced worker must transition the job to submission_uncertain, retaining the slot and requiring operator reconciliation; binding/publication checks reject any outstanding conflict. Callback cannot publish or resurrect content. Unknown/expired authenticated correlators return 200 with a content-free counter; invalid authentication returns 401; a transient database failure returns 503 rather than acknowledging an unrecorded known callback. This deliberately requests vendor retry, but 5xx retry benefit is unverified until fixture testing. Polling is authoritative only when a provider ID is known; a lost callback with an unknown ID requires the operator path.

Timeouts between remote acceptance and receipt persistence produce submission_uncertain; do not automatically submit again. Expired submitting leases also enter this state, never queued. Callback correlation can recover it; without callback delivery, an operator may supply a provider ID, which must pass the same API-key, audio-reference and uniqueness checks. No match means no automatic Retry button; explicitly abandoning the attempt records potential duplicate-cost/cleanup exposure before a new attempt. Documentation exposes no creation idempotency parameter; this is not proof that no such vendor capability exists.

Provider failures preserve only sanitized codes, never raw diagnostic bodies. Retryable GET/download/save errors use bounded backoff and reuse the same provider ID. Callback is an optimization for known-ID jobs and a recovery aid for uncertain submissions: polling must retrieve promptly enough to beat account TTL. Final completion requires durable normalized JSON plus TXT/VTT derivable from that JSON; save and hash-check before requesting provider deletion. The pilot does not persist raw provider diagnostics. Empty/no-speech results are explicit outcomes, not fabricated transcripts.

## Upload and runtime feasibility

The branch uses private browser-direct Blob upload with transcription-owned paths and expiry, not a new scope in the portal staging helper. Runtime code uses `UPLOADS_BLOB_RW_TOKEN`; verify its private-store policy and intended environment before enabling, and never substitute the intake or public token. Token mint and start validation independently enforce identity, byte cap, and the exact persisted job pathname.

M4A/MP3 filename/MIME are not sufficient validation. The branch now parses actual container, codec and duration with `music-metadata` in a disposable Node worker thread, using a ten-second default timeout and explicit V8 worker resource limits. The production build/file-trace includes the worker and parser dependency tree for the relevant routes. Focused synthetic parser tests, targeted lint and a production Next build passed per the implementation checkpoint. This does not prove maximum-size transfer/memory behavior, deployed Node compatibility, or execution within the deployed Function; those runtime proofs remain open. No malware scan is claimed for audio. Document unsupported formats rather than claim scanning.

No request or response carries the 50 MiB file through the browser-facing Function. Worker reads with an enforced byte counter into a buffer capped at 50 MiB; measure peak memory including inspection/upload copies. Provider calls reject redirects to prevent credential forwarding and body replay. Jobs continue outside browser lifetime through durable job-scoped workflows, not unawaited fire-and-forget work or an idle queue poll. The workflow performs bounded due checks only for an active job; a daily scheduled route handles physical expiry and cleanup retries. Verify workflow execution, daily cleanup and callback reachability for the target deployment; authenticated provider checks support recovery when callbacks cannot enter, with operator reconciliation for lost-submit responses. Do not disable deployment protection to obtain webhook delivery.

Active job processing is driven by durable job-scoped workflows; an active workflow performs only bounded due checks and provider interactions under leases. Idle jobs are not polled every minute. One synthetic provider-free Workflow canary passed in the current disabled Preview deployment, but this is not a real job lifecycle or AssemblyAI call. Physical expiry/retry cleanup source runs on a daily cadence and recovery source hourly; no recurring Preview schedule is established. A healthy scheduled cleanup may leave expired bytes in storage for up to 24 hours; logical expiry blocks reads immediately. Real audio, callback delivery, 50 MiB Function behavior, and provider behavior remain unverified. Media validation runs in the authenticated start path with a bounded worker-thread parser.

`TRANSCRIPTION_PILOT_ENABLED` controls user operations; `TRANSCRIPTION_SUBMISSIONS_ENABLED` controls provider upload/create calls. Runtime code requires each to equal the literal string `true`; unset or any other value is disabled. Queued jobs pause without new provider submission when either switch is disabled. Already-submitted known jobs can continue polling and cleanup, and the daily cleanup route remains available. Both Preview branch records are false and the latest protected runtime preflight confirmed both gates disabled in the new deployment. Keep them false until the runbook gates are explicitly cleared. The cleanup route uses a strict `CRON_SECRET` check without a development bypass. Every user operation also requires `requireSuperuser` and a non-null authenticated profile.

**Current branch recovery design [SOURCE-BUILT, HOSTED EXECUTION UNVERIFIED]:**
Workflow steps retry after 60 seconds (up to 1,440 retries) and hand off after
200 bounded processing cycles. The hourly recovery mode checks Workflow SDK run
status and uses exact compare-and-set recovery only for terminal
`completed`/`failed`/`cancelled` runs; live or unknown runs are touched, not
reclaimed. This replaces the earlier one-day-plus-daily recovery path in branch
source, but hosted SDK status behavior and an hourly Preview invocation remain
unverified. The source is deployed disabled with synthetic retry/sleep/parser proof; Vercel Cron runs only in
Production, and no Preview hourly schedule is established. Daily cleanup remains
unchanged. Prove deployed retry/recovery, queue-only trigger security, execution
duration, and Preview delivery before enabling real transcription.

## Privacy, retention and deletion

Provider no-training settings are account/project configuration, not an invented request parameter. Record their operator confirmation date and scope; local flags cannot certify external configuration. Non-sensitive acknowledgement limits use but does not automatically detect sensitive speech.

The source implements these local retention targets: unstarted upload rows expire after 24 hours; queued/failed/unresolved content expires seven days after admission/creation as applicable; a ready transcript's readable content and notes expire seven days after ready; successful input audio cleanup begins after durable result publication; receipts expire 30 days after ready or creation for a never-ready job. Reads enforce logical expiry immediately and independently of cleanup cadence; daily physical cleanup/retry may lag by up to 24 hours under a healthy schedule. Provider/account retention and deletion behavior are not verified. Receipts are owner-restricted operational metadata, not presumed non-sensitive. Filename, transcript, correction notes and encrypted upload references are not retained as receipt content; exact path tombstones remain only as needed for deletion recovery. Unresolved remote cleanup may retain exact identifiers until resolved; purging an upload reference prevents later audio-reference verification, and explicit abandonment is the acknowledged local-slot release path.

The pilot owner who starts and scores the recordings owns the evaluation export. Trigger it immediately after scoring the third recording, update after any fourth/fifth recording, and complete it before the earliest 30-day receipt expiry. The evaluation view displays that deadline. Export only approved non-sensitive aggregate scores and findings to a dated evaluation record; do not copy filenames, transcripts, notes, owner IDs or per-job provider identifiers. If the pilot ends before three recordings, export at closeout. Receipt retention provides a comparison window, not a promise of automatic archival.

Encrypt provider upload references using the existing AES-GCM/HKDF pattern with a distinct transcription purpose context, never the presentation context. Strip audio_url, webhook URL/auth fields, and other credential-bearing fields from diagnostic JSON; use an allowlisted diagnostic shape. Never log audio, transcript, filenames, evaluation notes, callback headers, provider references or full provider errors. Completion must carry output pathname/hash/ready_at; ready CHECKs require these fields. Expiry clears content pointers and changes ready to expired atomically. submission_uncertain requires submit intent and either an encrypted upload reference or an explicit reference_purged_at marker, so purging content never releases its slot. Failed/expired rows permit null content fields; failed with content_purged_at displays "Failed — content deleted," while uncertain with purged reference displays "Needs attention — verification reference expired." Keep minimal exact-path cleanup identifiers until physical deletion is confirmed, separately from readable content pointers. UI uses one total mapping: processing → Transcribing, submission_uncertain → Needs attention, all other persisted states explicitly mapped.

Cleanup claims exact persisted paths under a lease, blocks competing processing, retries independently, and keeps tombstones until cleanup is confirmed. DELETE atomically sets cleanup_requested_at and blocks all further content access; it does not change a leased processing state or release the slot. Every claim and post-I/O write checks this marker. A queued/uploading job without a lease can transition directly to expired for cleanup. An active worker records the outcome/ID of its in-flight call, then performs lease-fenced cleanup transitions without publishing content. Unknown submission acceptance becomes submission_uncertain and continues holding the slot; DELETE is never implicit abandonment. For a known active provider job, retain the slot until terminal status or verified provider deletion, not merely a queued deletion request. On lease expiry, recovery must reconcile external work before release. Never delete an input while a valid transfer lease is using it. No blind prefix deletion. Missing objects count as absent; transient errors do not. Late webhooks for deleted/expired/abandoned jobs cannot recreate content or occupy a new slot; a verified late provider ID may update the cleanup receipt for exact deletion only. Explicit abandonment is the acknowledged exception to the one-active-provider-job intent: local concurrency is bounded, but unknown remote work may still be running.

Provider deletion: request by exact known transcript ID only after local save or explicit user deletion/expiry. Verify documented API deletion behavior; a successful API receipt proves only API-level deletion, not backup erasure. Uploaded-but-unsubmitted provider audio may require TTL/support cleanup: confirm vendor semantics and retain a content-free unresolved-cleanup receipt if deletion cannot be verified. Local expiry is independent of provider retention.

Keep region explicit and API key/webhook secret server-side. No gateway, summarization, model fallback, or second provider in this pilot. Unknown account retention behavior does not block approved non-sensitive testing, but remains a confidential-use release gate.

## Implementation sequence and acceptance

### Invariant-to-test map

| Invariant | Enforced by | Discriminating proof |
|---|---|---|
| A job always has a real authenticated owner; caller input cannot supply it | Every user route rejects `profileId === null`; owner-scoped store queries | Anonymous/dev-null rejection, cross-owner list/detail/download/recovery denial; mutation check removes owner predicate and must fail |
| Browser upload is direct to one server-chosen private path, capped at 50 MiB | Prepare route and bounded client token; worker rechecks actual streamed bytes | Token size policy and actual cap/cap+1 stream tests |
| Provider credentials are never forwarded across redirects | `safeFetch` explicit fail-on-redirect mode on AssemblyAI calls | Redirect credential-forwarding regression test; existing default redirect behavior remains covered |
| At most one provider job is active globally | Partial unique slot index across submitting/processing/saving/submission_uncertain | Concurrent claims for distinct jobs: one wins; unique violation maps to slot-busy |
| No stale worker can commit after lease loss | Every post-I/O mutation predicates on lease token and expiry | Mutation check removes lease predicate and must fail; expire/reclaim lease before stale completion |
| Unknown submission acceptance never triggers an automatic second POST | Expired submit lease/response-loss becomes `submission_uncertain` | Mutation check removes uncertain-state guard and must fail; worker rerun proves submit count unchanged |
| Callback can only correlate to its immutable attempt | Per-attempt HMAC verified in constant time before DB lookup; candidate IDs verified against provider object | Invalid HMAC, unknown correlation, duplicate/out-of-order delivery, callback/POST mismatch tests |
| Delete blocks reads without releasing in-flight/uncertain work | `cleanup_requested_at` fences reads and workers; only explicit abandon releases unknown work | Delete during upload and on uncertain job retains slot until safe resolution |
| Expired content is unavailable immediately and pointers clear atomically | Read-time expiry plus lease-fenced cleanup transition satisfying terminal CHECKs | Expired-ready read denied; cleanup failure keeps truthful state; ready expiry preserves schema checks |

These tests remain the acceptance set before calling the pilot operationally complete. Store mutation checks have been run one at a time and restored after each red proof. Implementation status and the still-open scope are:

| Work | Current evidence | Status |
|---|---|---|
| Schema/store/model and owner UI/API/worker/provider/media implementation | Branch files and the focused tests | SOURCE-BUILT |
| Local Postgres constraints, owner fence, lease fence, global slot, and pre/post-intent recovery | PGlite passed 12 SQL scenarios including the actual preflight SQL; native-Postgres integration suite was added but not run; concurrency proof remains open | LOCAL SQL PROOF; no shared schema or native concurrency proof |
| Focused provider/worker/route/media/crypto/store/UI/safe-fetch test set | Root verified 13 suites / 126 tests; PGlite included 12 SQL scenarios | BRANCH TEST EVIDENCE |
| Targeted ESLint, `tsc`, default Turbopack build/route output trace | Build, typecheck and ESLint passed; trace includes `ms` and `ieee754`; compiled Turbopack worker accepted synthetic AAC | BRANCH + ONE SYNTHETIC HOSTED CANARY; no real-media or provider proof |
| API route security inventory/checker | Backend checkpoint reports checker pass with 251 routes and three pre-existing external-materials token warnings | SOURCE REGISTERED; warnings are not attributed to this feature |
| Maximum-size media/memory/Function runtime, real audio/provider fixtures, account guarantees, shared migration, recurring cron/webhook reachability | Local compiled worker verified only with synthetic 3.065-second AAC; no AssemblyAI call, real-audio test, 50 MiB Function upload, recurring Preview scheduler, or shared migration | NOT RUN / UNKNOWN beyond bounded preflight, recovery, synthetic local fixture and isolated migration proof |
| Three-to-five-recording quality evaluation and aggregate export | Requires enabled target, explicit AssemblyAI spend approval and all runbook gates; current authorization covers only the provider-free synthetic Workflow test | NOT STARTED |

Do not deploy or enable solely on branch tests/build. The owner has authorized one provider-free synthetic Workflow test and isolated migration 061 with Preview disabled, but not AssemblyAI calls/uploads, enabling the pilot, or other metered work. The remaining evaluation sequence is: first clear the pre-enable runbook and migration/security/configuration gates; then obtain separate explicit AssemblyAI spend approval. Run three explicitly non-sensitive recordings, extend to five only if initial evidence is useful, compare identical manually checked passages with Zoom, and capture correction time, terminology/speaker/timestamp errors, processing duration, and billed cost where available. Estimate cost only from a dated verified price and label it estimated.

Discriminating tests: exact cap and cap+1; malformed M4A/MP3; oversized actual bytes despite declared size; cross-owner job/download/reconcile/abandon; invalid callback secret and unknown ID; duplicate/out-of-order callbacks; callback before provider-ID commit; callback/POST ID conflict; secret rotation mid-attempt; database failure/503 with missing redelivery; lost submit response (no automatic second charge); crash after output write before ready; expired lease after external success; missing webhook with known versus unknown provider ID; provider result expires before retrieval; local storage failure; provider deletion failure; DELETE during upload and on uncertain jobs; cleanup racing submission/retrieval; stale reconcile/abandon requests and provider-ID uniqueness conflicts; uncertain-reference purge preserving the slot; late callback after purge/abandonment; score receipt expiry and export deadline; UI navigation during an awaited result.

Required durable-surface checks include migration manifest, Atlas, route-security matrix, secret tracking/credential runbook, service catalog, and applicable auth/security/lifecycle checks, each gate followed by its self-test sequentially. Source integration has registered exact AssemblyAI hosts in `safeFetch`, an anchored webhook proxy exemption, named callback/cron verifiers, and purpose-separated upload-reference encryption. The backend checkpoint reports the route matrix/checker and secret/credential entries registered; its API matrix check passed with 251 routes and three pre-existing external-materials token warnings. Root owns the integrated release gates. The current disabled Preview deployment passed 13-check preflight, empty recovery, and one provider-free synthetic Workflow canary; this does not prove application-job terminal recovery, real-job lifecycle, callback delivery, 50 MiB deployed media behavior, recurring scheduling, or provider behavior. Resource/configuration metadata and the owner's screenshot are bounded evidence, not account/API guarantees.

Quality acceptance: owner determines whether reduced correction effort and usable speaker attribution justify adoption; no invented accuracy threshold. Engineering acceptance: each job recovers without silent duplication, each result is owner-protected, cleanup status is truthful, and maximum-size non-sensitive audio completes. Confidential-use acceptance separately requires confirmed async retention and contractual coverage of audio, transcript, derived/de-identified content and subprocessors.

## Contract review scope

Change: isolated Admin transcription pilot. Entry points: upload/start/list/detail/download/evaluation/export/delete/reconcile/abandon, authenticated callback and scheduled worker. Persistence: source-built Postgres operational jobs and private Blob; external AssemblyAI jobs. Consumers: Admin UI, exports, worker and cleanup. Prior design concerns: one-hour staging mismatch; account retention uncertainty; remote-submit acceptance gap.

The whole-flow, partial-success, async/stale-state, helper-boundary, durable-surface, doc-reconcile, and status-consumer audits inform the contract above. The full release acceptance matrix is incomplete. Isolated schema/admin initialization and independent readback succeeded after local tests and Sol/root review. Migration 061 was applied once and independently verified only in isolated Neon; no shared migration or AssemblyAI call has been performed. The disabled Preview runtime preflight and zero-work drain passed on earlier source; the earlier sign-in screenshot may have used a shared database because that deployment's branch binding was not established, and no shared-database mutation was confirmed. Refreshed staff sign-in, callback delivery, deployed media runtime, hosted workflow recovery, and real job lifecycle remain untested. See the evidence table and runbook; the dated Fable reviews below remain historical evidence.

## Vendor references

- https://www.assemblyai.com/docs/data-retention-and-model-training — async TTL/deletion is not an immediate physical-erasure promise; current documentation supersedes older support snippets.
- https://www.assemblyai.com/docs/pre-recorded-audio/webhooks — authenticated notification followed by result retrieval.
- https://www.assemblyai.com/docs/pre-recorded-audio/select-the-region — US/EU endpoint selection.
- https://www.assemblyai.com/legal/data-processing-addendum — contractual review source, not evidence of account configuration.

## Review record

### Historical implementation review and root handoff (pre-deployment checkpoint)

Luna built/reconnoitred; Sol performed independent read-only reviews; root
corrected integrated lifecycle issues and ran final checks. All 67 repository
checks passed sequentially, as did the final eleven-suite / 111-test run and
production build. No push, deployment, shared migration, or paid provider test
was performed. The contract-reconciliation skill drove the lifecycle tests and
durable-surface updates, rather than treating a passing build as flow proof.

Sol's integrated findings and dispositions: active DELETE/expiry and independent
remote retries corrected; receipt expiry no longer destroys pending routing or
repeats purge writes; callback conflicts enter operator-recoverable uncertainty,
including after DELETE; Blob operations use abortable deadlines; receipt reads
redact immediately. A reported NOT NULL purge error was refuted against the
actual nullable schema. Root additionally required no-overwrite output and
read-back hash verification. The final conflict transition explicitly permits
the cleanup marker while retaining lease/version fences, proven against real
local Postgres. Sol accepted the disabled branch subject to these final gates.

The late-upload completion ceiling could not be established locally. No guessed
five-minute grace is used: issued-capability input targets remain tracked and
reaped, with cleanup visibly pending, while receipt metadata expires separately.
A verified completion/revocation protocol still gates tombstone closure and
confidential use; the owner accepts the unresolved risk for non-sensitive tests.
See the runbook; this conservative unresolved identifier is not retained audio
permission or proof of final physical erasure.

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

Changed-fact documentation update (2026-10-01): migration 060 and the authorized active admin profile/superuser role are initialized only in the isolated Neon database. Luna executed the reviewed operator once; at that bootstrap checkpoint root independently verified 57 migration records, one profile, one role, zero jobs and nine provider-owned Auth tables. The subsequent 061 readback independently verified the current 58 migration records. Fourteen targeted tests passed, including local provider-schema preservation and failed-seed rollback. Sol approved the operator and read-only verifier. Thirteen Preview-branch variables are configured, both feature switches are false, and the earlier READY deployment passed a protected ten-check preflight plus an explicitly invoked empty drain. The dedicated alias pointed to it at that checkpoint; `/api/auth/providers` returned the exact registered callback. Refreshed staff sign-in, callback delivery, ongoing Preview scheduling and media runtime remain unverified. An earlier `503 cron_secret_missing` occurred before worker execution; effective binding on that deployment was inconclusive, and the earlier sign-in screenshot cannot establish its database target. No shared-database mutation was confirmed. No AssemblyAI call/upload was made. Account privacy guarantees remain unverified. Historical Fable reviews remain unchanged. This is a bounded changed-fact reconciliation, not repo-wide or pilot-enable approval.

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

Vendor documentation checks listed here were performed 2026-09-30; they are not account probes. The runbook governs current prerequisites: safe schema/bootstrap tracking, test identity, environment/secret verification, runtime and scheduler/callback checks, and separate paid-test authorization. Account-specific retention/upload-only cleanup and direct-upload closure remain accepted uncertainties only for non-sensitive testing, not confidential use or removal of cleanup tombstones. Response-loss/correlation and 5xx-retry fixtures remain untested. Revision 3's design verdict was historical, not certification for enabled or confidential use. Sol's subsequent implementation review and root verification are recorded above and in the runbook.
