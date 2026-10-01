---
title: "AssemblyAI transcription pilot pre-enable runbook"
domain: transcription
kind: operations-runbook
status: source-built-not-deployed
summary: "Pre-apply and pre-enable checks for the source-built AssemblyAI pilot; no shared database, deployment, account, or provider state is asserted."
owner: product-engineering
related:
  - docs/plans/ASSEMBLYAI_TRANSCRIPTION_PILOT_PLAN_2026-09-30.md
  - docs/atlas/postgres-transcription-pilot.md
  - docs/CREDENTIALS_RUNBOOK.md
  - docs/API_ROUTE_SECURITY_MATRIX.md
---

# AssemblyAI transcription pilot pre-enable runbook

## Release status

**[SOURCE-BUILT IN THE IMPLEMENTATION BRANCH; NOT DEPLOYED OR ENABLED]** The
Admin page, API routes, callback, worker, provider/media/runtime services,
model/store, migration 060, fresh-install registration, and tests are present
in source. Migration 060 is provisional and unapplied to shared databases.
The implementation branch is not evidence that feature flags, credentials,
cron, callback reachability, account privacy settings, or shared schema are
configured. This runbook documents the gate; it does not authorize a database
apply, deployment, paid provider call, or pilot use.

**Disabled-by-default source behavior:** `TRANSCRIPTION_PILOT_ENABLED` and
`TRANSCRIPTION_SUBMISSIONS_ENABLED` each require the literal string `true`.
Unset, empty, or any other value is disabled. No Production/Preview environment
was inspected. Before a separately authorized pilot, leave both flags unset or
non-`true`; verify the actual target environment through its approved
configuration surface before asserting that it is off.

## Before migration or deployment

1. Obtain explicit owner authorization for the target environment, migration,
   deployment, and any use that may consume AssemblyAI credits. Confirm only
   explicitly approved non-sensitive recordings are in scope. Confidential
   recordings remain excluded.
2. Reconcile the provisional migration number. This branch selects 060;
   migrations 058 and 059 remain reserved for other work. Before applying,
   perform an owner-approved, read-only check of `schema_migrations` and the
   physical target schema. Confirm whether 060 is absent from the tracker and
   whether `transcription_jobs`, its indexes, and constraints are absent. A
   tracker/object mismatch, existing partial object, or number collision is a
   stop condition: do not blindly apply, drop, or manually stamp anything.
3. If the target is a populated database, the only supported apply path is
   `node scripts/apply-migrations.js` after approval. Confirm migration order
   and the script's target before running it. `scripts/setup-database.js` is
   fresh-install-only and must not be run against an existing database. After
   apply, perform a separate read-only physical schema readback; tracker state
   alone is insufficient. **No shared tracker/schema read or migration apply
   has been performed for this branch implementation.**
4. Confirm the full API route-security matrix and checker registration, secret
   tracking, credential runbook, service catalog, and Atlas entries are
   complete and their gates pass. Route inventory in this branch includes
   owner-scoped job create/list/read/start/download/evaluation/delete/reconcile/
   abandon/export, authenticated AssemblyAI callback, and cron drain. Use the
   canonical matrix for final per-route security facts.
5. Confirm the target deployment can execute the scheduled drain and receive
   the AssemblyAI callback over HTTPS without weakening deployment protection.
   Source registers a one-minute cron, a 300-second route maximum, a
   240-second internal budget, and seven-minute leases. **No deployed
   scheduler/callback reachability check has been run.**

## Environment and secret checklist

Configure only through the approved secret-management workflow; never put
values in chat, source, test fixtures, or this document. The code consumes:

- `TRANSCRIPTION_PILOT_ENABLED` — user-facing pilot gate; literal `true` only.
- `TRANSCRIPTION_SUBMISSIONS_ENABLED` — new upload/submit gate; literal
  `true` only. Recovery, callbacks, and cleanup are intended to continue when
  this is disabled.
- `ASSEMBLYAI_API_KEY` — server-only AssemblyAI credential for the selected
  US or EU endpoint.
- `ASSEMBLYAI_WEBHOOK_SECRET` — server-only HMAC key; source requires at least
  32 UTF-8 bytes. Rotation invalidates callback authentication for in-flight
  attempts; known provider IDs remain pollable, while unknown IDs may require
  operator reconciliation or abandonment.
- `TRANSCRIPTION_REFERENCE_ENCRYPTION_KEY` — server-only key material; source
  requires at least 32 UTF-8 bytes and derives an AES-256-GCM key with the
  dedicated context `assemblyai-transcription-upload-reference-v1`. This is
  purpose-separated from other encrypted references. Preserve key availability
  for as long as encrypted upload references may need reconciliation.
- `UPLOADS_BLOB_RW_TOKEN` — private upload/output store credential; do not
  substitute the intake or public Blob token. Confirm its store policy and
  permissions before use.
- `CRON_SECRET` — strict cron authentication; no development bypass.
- `TRANSCRIPTION_CALLBACK_URL` — optional explicit public HTTPS base; otherwise
  source derives a base from the application URL/deployment host. Verify the
  resolved callback URL in the approved environment without exposing secrets.

Required key names and code-side length/guard behavior above were verified in
source. No remote secret presence, value, scope, or rotation state was
inspected. Refer to `docs/CREDENTIALS_RUNBOOK.md` for the authoritative
secret-entry process; this runbook does not replace its registry.

## Privacy, vendor, and runtime gates

- **Account privacy:** model-training opt-out, zero-data-retention, project/key
  scope, subprocessors, asynchronous retention, upload-only cleanup, and
  deletion semantics are not verified for the account. Owner reports in the
  plan are not account evidence. Confirm the exact project/key configuration
  and applicable contractual coverage before enabling. A non-sensitive
  acknowledgement is a user attestation, not content classification.
- **Provider behavior:** no live AssemblyAI request, callback fixture against
  the account, retrieval/deletion probe, TTL probe, or paid usage test has been
  run. Vendor documentation review in the plan is not proof of this account's
  behavior. Unknown submit acceptance becomes `submission_uncertain`; never
  automatically POST again.
- **Node/media runtime:** source uses `music-metadata` inside a disposable
  `worker_threads` parser with a default 10-second timeout and bounded worker
  resource limits. `next.config.js` explicitly includes the worker and parser
  dependency tree in route output tracing. The implementation checkpoint
  verifies `npm run build` passed and generated route NFT includes those
  dependencies. Root also executed the built worker asset successfully against
  synthetic M4A locally. This does not prove deployed Node compatibility, a 50 MiB
  parse/upload in the target Function, peak memory under maximum-size stress,
  or timeout runway. No separate maximum-size or deployment-runtime test has
  been run. No audio malware scan is claimed.
- **Build/test evidence:** root's integrated pass verified eleven suites and
  111 tests, including 13 isolated local Postgres regressions; all 67 repository
  `check:*` scripts passed sequentially. The API matrix covers 251 routes with
  three pre-existing external-materials token warnings. The final production
  build passed. Targeted ESLint has zero errors and four UI React hook warnings.
  These are branch checks, not live integration evidence. Re-run relevant
  checks before release; gate/self-test pairs must run sequentially.
- **Unused capability:** transcript data is not trusted HTML or executable
  instructions; no summarization, name inference, request publication, or
  general-purpose provider layer is in scope.

## Retention and cleanup operations

The local source policy is distinct from provider retention:

| Data/state | Source retention behavior |
|---|---|
| Upload not started | Input expires after 24 hours; upload token is shorter lived (at most 15 minutes). |
| Queued / failed / unresolved input | Content expiry is seven days; access is denied as soon as the expiry timestamp passes, regardless of cleanup cron delay. |
| Ready result | Normalized result is persisted and hash-verified before provider deletion; transcript content, diagnostics, and notes expire seven days after ready. Input cleanup begins after result publication. |
| Receipt | 30 days after ready; for a never-ready job, 30 days after creation. The implementation was corrected to match this deadline. |
| Provider-side audio/job | Account-specific TTL and physical deletion behavior remain unverified; local deletion receipts do not establish backup erasure. |

The cron drain is the physical cleanup/retry mechanism in source, not a proven
live schedule. Deletion targets only exact persisted paths and known exact
provider transcript IDs. A requested DELETE immediately blocks further content
access but does not cancel remote work, claim successful erasure, or release an
unknown active slot. Transient cleanup failures retain exact tombstones for
retry. Keep `TRANSCRIPTION_PILOT_ENABLED` and
`TRANSCRIPTION_SUBMISSIONS_ENABLED` disabled when pausing user work; do not
disable the cleanup/recovery drain if deployed jobs still require cleanup.

**Unclosed direct-upload capability:** source reserves `upload_valid_until`
before minting a token. Expiry is not evidence that an already-started remote
upload cannot commit later. Input cleanup targets for issued capabilities are
therefore retained and repeatedly reaped after observed deletion;
`local_cleanup_completed_at` remains unset. This is minimal cleanup tracking,
not a promise of final erasure. Evaluation metadata expires independently.
Before enabling, establish and verify a completion/revocation protocol or an
enforced vendor completion bound, then review the tombstone-closing change.
Do not manually remove targets or substitute an assumed grace period.

Conflicting provider IDs retain the uncertain slot after DELETE. Automatic
cleanup cannot erase conflict evidence or declare remote resolution; the owner
must reconcile the verified ID or acknowledge abandonment. Normalized output
is capped at 4,000,000 bytes for Function response headroom, written without
overwrite, and read back/hash-verified before ready.

## Recovery and abandonment

- Before durable provider submission intent, an expired lease can safely
  return to queued, unless deletion was requested; that job transitions to
  expired and is claimed for cleanup. No provider POST has yet been authorized
  by the durable state.
- After intent, a lost/ambiguous POST response or expired lease becomes
  `submission_uncertain`. The global local active slot remains held; automated
  submission never retries it. An authenticated callback is only a candidate
  provider ID, not proof of the matching audio.
- Reconciliation accepts an exact provider transcript ID, retrieves it with
  the configured API key, compares the provider audio reference with the
  decrypted persisted upload reference, and binds only under the current
  owner/lease/version fence. A cleanup-requested row may be bound solely for
  exact cleanup, never transcript publication. If the reference is already
  purged, verification is unavailable.
- Explicit abandonment requires the owner's acknowledgement that provider
  work could continue and a later attempt could incur another charge. It
  records a minimized receipt, requests cleanup, and releases the local slot;
  it does not contact or stop the provider and cannot guarantee that remote
  work has ceased. Do not present it as cancellation or retry.
- Once local content/receipt retention expires, scheduled cleanup clears the
  exact local paths and eventually purges the minimized receipt. Keep unresolved
  remote identifiers only as long as exact cleanup/reconciliation requires;
  do not extend content retention to make recovery convenient.

## Stop conditions

Do not enable the pilot if the migration tracker/physical schema is ambiguous,
either flag is literal `true` before approval, any required secret is missing
or mis-scoped, the account privacy/retention terms are unresolved for the
selected recordings, route/security gates are incomplete, the deployed Node
runtime cannot safely process the bounded upload, the direct-upload completion
protocol is unverified, or callback/cron reachability
would require weakening a security control. Stop on any uncertain provider
acceptance; use reconcile or explicitly acknowledged abandon, never a blind
resubmission.
