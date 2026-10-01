---
title: "AssemblyAI transcription pilot pre-enable runbook"
domain: transcription
kind: operations-runbook
status: isolated-061-verified-source-ahead-disabled-preview
summary: "Migration 061 and its outbox schema are verified only in isolated Neon; newer Workflow source remains undeployed and Preview switches remain false. Hosted workflow/recovery, schedule, staff sign-in and provider validation remain release gates."
owner: product-engineering
related:
  - docs/plans/ASSEMBLYAI_TRANSCRIPTION_PILOT_PLAN_2026-09-30.md
  - docs/atlas/postgres-transcription-pilot.md
  - docs/CREDENTIALS_RUNBOOK.md
  - docs/API_ROUTE_SECURITY_MATRIX.md
---

# AssemblyAI transcription pilot pre-enable runbook

## Release status

**[SOURCE-BUILT; DISABLED PREVIEW PREFLIGHT PASSED; PILOT NOT ENABLED]** The
Admin page, API routes, callback, worker, provider/media/runtime services,
model/store, migration 060, fresh-install registration, and tests are present
in source. Migration 061 has also been applied once and physically verified
only in isolated `neondb`; the newer Workflow source remains undeployed.
Thirteen environment records are scoped to Preview branch
`codex/transcription-pilot`; both transcription switches are false. The latest
disabled Preview deployment passed read-only runtime preflight and an empty
drain, but this does not verify real job processing or media runtime. An
earlier deployment returned `503 cron_secret_missing` before worker execution;
its Git metadata was not sufficient evidence that branch-scoped values were
applied, so runtime binding remained inconclusive. Migration 060 is
applied only to the isolated Neon database. Refreshed staff sign-in, AssemblyAI
callback delivery, ongoing schedule, real-job processing, deployed media
runtime, and account privacy settings remain unverified. This
runbook documents release gates; the owner has explicitly authorized one
provider-free synthetic Workflow test and isolated migration 061 with the
Preview pilot disabled. This does not authorize AssemblyAI calls/uploads,
pilot enablement, or other metered work. The current Workflow source revision
has not been deployed, and the earlier runtime receipt does not verify its
execution.

### Isolated database checkpoint — 2026-10-01

**[VERIFIED via Vercel resource metadata; root readback and Sol review]** Owner
authorized an isolated Preview and new Neon/private Blob resources after possible
charges were disclosed. Created in team `justin-gallivans-projects`:

- Neon `wmkf-transcription-pilot`, `store_TSn9yHJW1xL0p4h0`: available,
  no connected projects. Launch plan verified; actual pricing remains
  unverified. The owner-supplied local endpoint was confirmed against the
  user-confirmed Neon hostname and distinguished from local Production hosts.
- **[VERIFIED 2026-10-01 before initialization via bounded TLS/read-only SQL catalog probe]** The
  endpoint connects to database `neondb`, current schema `public`. Nine
  non-system tables were found, all in Neon Auth's `neon_auth` schema and owned
  by `neon_auth`: `project_config` reports one visible row; `account`,
  `invitation`, `jwks`, `member`, `organization`, `session`, `user`, and
  `verification` each report zero visible rows. The counts reflect the
  connected role; row-level security was not disabled or bypassed. No
  public/application tables were observed. The probe read catalog metadata
  and exact visible-row counts only; no table values were read. The reproducible
  sanitized probe is `node scripts/probe-transcription-preview.js`. Neon
  documents `neon_auth.*` as its Auth data schema and says enabling Auth
  initializes schema/configuration ([Neon Auth overview](https://neon.com/blog/neon-auth-branchable-identity-in-your-database)).
  The database was not literally empty. The reviewed operator preserved this
  provider-owned schema while initializing only the empty application schema.
- Blob `wmkf-transcription-pilot`, `store_Qri02A1kj96tQYR9`: private,
  `iad1`, zero objects/bytes, no connected projects.

At resource creation, no app environment binding or deployment was made. The
existing project-wide database records still target Production, Preview and
Development together and remain unchanged; the later branch-only override is
recorded below. Resource creation did not connect either resource through the
Marketplace.

**Local fresh-bootstrap repair — Sol reviewed and root verified:** the
repaired setup path uses its public transaction base, real SQL migrations,
narrow retired-migration handling, and four supplemental schema entries; it
does not stamp a blanket manifest baseline. In a disposable local database,
57 tracker entries were recorded (53 actual SQL migrations plus four retired,
absent migrations), canonical rerun skipped all 57, and atomic rollback and
populated-database refusal were checked. An injected retired table was refused
and rolled back; the actual setup CLI also passed on a fresh local database.
This proves the local bootstrap path, not the Neon database's migration tracker
or application schema. The separate read-only Neon catalog probe found only
the provider-owned Auth tables described above, but did not inspect row values
or apply any migration. Do not run the existing-database runner blindly after
setup or treat this database as literally empty.

Repair verification: root ran 15 focused suites / 132 tests, including
`tests/integration/database-bootstrap.pg.test.js` against disposable local
databases and the affected schema-parity tests. Manifest, instruction safety,
Atlas, document currency, fact consistency, document references and catalog
checks passed; gate/self-test pairs ran sequentially. Sol accepted the bounded
repair after the retired-target negative test passed. No deployed-runtime proof
is implied.

**[VERIFIED 2026-10-01]** The owner-authorized isolated initialization ran once
with `node scripts/bootstrap-transcription-preview.js --confirm-empty-preview-bootstrap`.
Luna executed after Sol and root review; both schema and admin transactions
were acknowledged committed. Root independently ran the same script with
`--verify-only`: 57 migration records (53 executed SQL plus four retired/absent),
one active linked profile for `jgallivan@wmkeck.org`, one superuser role, zero
transcription jobs, and nine provider-owned Auth tables still present. Readback
checks manifest provenance, key migration-060 columns, named constraints and
indexes, and the exact authorized directory identity/role. No Production user
data was copied; no auth bypass, email or Dynamics provisioning path was used.
The source writes only the public application schema, not `neon_auth`.

Root's final targeted run passed 14 tests across three suites, including real
local Postgres proof of provider-schema preservation, hostile search-path
isolation, seed rollback after a role-insert failure, and repeat-seed refusal.
Targeted ESLint passed. Sol also approved the read-only verification mode.
An uncertain commit must be reconciled read-only, never automatically retried.
This target is now populated: do not rerun fresh initialization.

### Isolated workflow-dispatch migration checkpoint — 2026-10-01

**[VERIFIED via root's independent read-only `--verify-only` receipt]** After
Sol approval, root applied migration 061 exactly once through the canonical
`node scripts/apply-migrations.js` path. The separate read-only verifier then
confirmed target database `neondb`, a read-only transaction, zero transcription
jobs, 58 migration records matching all on-disk migration files, no pending
files, migration 061 recorded, `transcription_workflow_dispatches` present, and
its physical schema matching the migration. No shared Preview or Production
database was read or changed.

The first readback attempt was rejected because Neon exposed PostgreSQL
`pg_constraint` NOT NULL catalog entries (`contype='n'`) to the checker. Root
updated the verifier to exclude those entries (`contype<>'n'`) and reran only
`--verify-only`; migration 061 was not reapplied.
The successful receipt, not the initial failed check, is the current readback
evidence. This proves isolated schema state only, not deployed Workflow
execution or Preview scheduling.

The operator copy remains in git-ignored `.env.transcription-preview.local`;
`.env.local` and shared settings were not overwritten. The saved endpoint
matched the user-confirmed isolated Neon host and differed from local
Production hosts. The Launch plan is known but actual pricing remains
unverified. Branch-only Vercel configuration and deployment are now recorded
in the checkpoint below.

### Disabled Preview environment and deployment checkpoint — 2026-10-01

**[VERIFIED via Vercel environment metadata]** Thirteen
records are scoped only to Preview branch `codex/transcription-pilot`:
`POSTGRES_URL`, `DATABASE_URL`, `UPLOADS_BLOB_RW_TOKEN`,
`TRANSCRIPTION_PILOT_ENABLED`, `TRANSCRIPTION_SUBMISSIONS_ENABLED`,
`DATAVERSE_TARGET_INTERLOCK`, `DATAVERSE_ALLOW_PROD_READS`, and
`DATAVERSE_DAL_ENFORCEMENT`, `NEXTAUTH_URL`, `ASSEMBLYAI_API_KEY`,
`ASSEMBLYAI_WEBHOOK_SECRET`, `TRANSCRIPTION_REFERENCE_ENCRYPTION_KEY`, and
`CRON_SECRET`. Project-wide and other branch records were not updated. Both
transcription switches are false; the Dataverse controls and auth origin were
checked from an empty temporary directory. The four provider/worker secrets
are confirmed by name only; secret values are not readable or reproduced.
No equality claim is made between remote secret values and local operator
credentials. The separate local storage check below confirmed the dedicated
Blob resource; these resources remain unconnected through Marketplace.

**[VERIFIED READY; disabled runtime preflight and empty drain passed]**
Deployment `dpl_DHaVt8QHTzLWo7gr7M6FhVJR344S` targets Preview at
`https://wmkfresearchapps-62z9wnj9y-justin-gallivans-projects.vercel.app`,
source commit `78a3d5595e7045680f28eaf00bd0b462c53c73df`, branch
`codex/transcription-pilot`, Node 22.x. All 13 variables were explicitly
supplied as runtime and build overrides; the dry package excluded `.env.local`
and `.env.transcription-preview.local`. The protected `?preflight=1` request
returned HTTP 200 and all ten checks passed, including Preview target, both
disabled flags, dedicated database and Blob store, safe Dataverse controls,
auth origin, required application-secret presence, read-only database access,
expected database, and zero jobs. A normal protected drain then returned
HTTP 200 with all result counts zero. No AssemblyAI call/upload occurred.
The dedicated alias now points to this deployment; an authenticated preflight
through the alias also returned HTTP 200 with all ten checks passing. Its
`/api/auth/providers` response returns HTTP 200 and the exact registered
Microsoft callback. Refreshed staff sign-in remains untested.

An earlier deployment returned `503 cron_secret_missing` before worker
execution. Vercel CLI Git metadata was not sufficient evidence that
branch-scoped records were applied; the precise cause of the missing runtime
secret was not independently established. Its behavior is inconclusive about isolated database
binding. An earlier sign-in screenshot likewise cannot prove which database
that deployment used; no shared-database mutation has been established. The
dedicated Microsoft callback is registered with prior redirect URIs preserved.
Environment/deployment operations made no shared database setting/schema
changes; the earlier sign-in screenshot's database target is unknown, and no
shared-database mutation was established.

**[VERIFIED 2026-10-01; provider-free isolated storage check]**
`node scripts/check-transcription-preview-storage.js
--confirm-private-blob-roundtrip` exited 0 against the dedicated operator
credentials. The isolated database had zero transcription jobs; a synthetic
AAC fixture (16,863 bytes, 3.065034 seconds) completed private Blob put/read,
hash/media checks, and exact-path deletion verification. No provider was
called. This proves the local parser and Blob SDK path, not deployed media
runtime behavior or remote secret-value equality.

Automatic Git deployment is disabled only for `codex/transcription-pilot`
in `vercel.json`. The first branch push was checked for no automatic deployment
before adding isolated overrides. Future deployments are deliberate Preview
CLI deployments; repoint only the dedicated pilot alias after READY and
branch/commit verification. This is isolation for the scoped pilot/sign-in
test, not certification that unrelated suite applications are isolated.

**Disabled-by-default behavior:** `TRANSCRIPTION_PILOT_ENABLED` and
`TRANSCRIPTION_SUBMISSIONS_ENABLED` each require the literal string `true`.
Unset, empty, or any other value is disabled. For this Preview branch both
records are explicitly `false`, independently verified as described above.
Keep them false until the owner separately authorizes enabling and all gates
are cleared; the READY deployment is not pilot-use approval.

## Before migration or deployment

1. Owner authorization covers isolated Neon initialization, branch-only
   Preview environment configuration, migration 061 applied once in isolated
   Neon, a disabled Preview deployment, and one provider-free synthetic
   Workflow test. It does not authorize enabling the pilot, AssemblyAI calls or
   uploads, staff sign-in until the fresh deployment and alias are verified, or
   other metered work. Confirm only
   explicitly approved non-sensitive recordings are in scope. Confidential
   recordings remain excluded.
2. Reconcile the provisional migration numbers. This branch selects 060–061;
   migrations 058 and 059 remain reserved for other work. The bounded catalog
   probe found no `schema_migrations` or application tables among visible
   non-system relations, but did find the pre-existing Neon Auth schema and
   configuration described above. The reviewed isolated initialization has now
   applied 060 and 061 and read back their schemas only in isolated Neon. The
   independent 061 receipt confirms the outbox constraints and indexes there;
   the earlier ten-check Preview preflight does not establish their presence.
   No shared database has been read or migrated under this authorization.
   Never repeat fresh setup. For any
   other target, do not assume it is empty or run fresh setup blindly.
   Confirm the target migration tracker and physical schema state in the
   approved procedure. A tracker/object mismatch, existing partial object, or
   number collision is a stop condition: do not blindly apply, drop, or
   manually stamp anything.
3. For an ordinary populated application database, the only supported apply
   path is `node scripts/apply-migrations.js` after approval. Confirm migration
   order and the script's target before running it. `scripts/setup-database.js`
   is fresh-install-only and must not be run against an existing database.
   This isolated Neon resource is now initialized; its existing provider-owned
   Neon Auth schema was preserved by the reviewed public-only bootstrap.
   After any approved apply, perform a separate
   read-only physical schema readback; tracker state alone is insufficient.
   **No shared tracker/schema read or migration apply has been performed for
   this branch implementation.** Migrations 060–061 were applied only to the
   isolated test resource, not the shared Preview/Production database.
4. Confirm the full API route-security matrix and checker registration, secret
   tracking, credential runbook, service catalog, and Atlas entries are
   complete and their gates pass. Route inventory in this branch includes
   owner-scoped job create/list/read/start/download/evaluation/delete/reconcile/
   abandon/export, authenticated AssemblyAI callback, and cron drain. Use the
   canonical matrix for final per-route security facts.
5. Confirm the target deployment can start and run the durable job workflow,
   perform daily physical cleanup, and receive the AssemblyAI callback over
   HTTPS without weakening deployment protection. Active jobs use bounded
   workflow due checks rather than minute-by-minute idle polling. Physical
   cleanup is daily; logical expiry blocks reads immediately, while a healthy
   cleanup schedule may leave expired bytes for up to 24 hours. Vercel
   scheduled Cron runs only in Production, not Preview, so Preview has no
   automatic daily-cleanup guarantee; use only an explicitly authorized
   operator invocation or another reviewed scheduler until one is established
   ([Vercel Cron troubleshooting](https://vercel.com/kb/guide/troubleshooting-vercel-cron-jobs)). The earlier disabled Preview preflight and empty drain
   predate the workflow source change and do not prove workflow execution,
   ongoing cleanup, callback delivery, or real-media runtime.

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
source. Selected Vercel environment-name/target metadata was inspected, not
secret values, effective resource access or rotation state. Refer to `docs/CREDENTIALS_RUNBOOK.md` for the authoritative
secret-entry process; this runbook does not replace its registry.

## Privacy, vendor, and runtime gates

- **Workflow deployment and recovery:** source uses Workflow 5.0.0; the owner
  has explicitly authorized one provider-free synthetic Workflow test. This
  does not authorize AssemblyAI use or enabling the pilot. Before deployment,
  confirm applicable charges and authorization, generated
  queue-only trigger authentication, function duration of at least 240 seconds,
  parser asset tracing, and protected Preview delivery. Workflow arguments and
  results contain opaque job IDs, attempts and bounded state/timing only; step
  failures use fixed codes without raw provider/database error causes.
  **Current branch recovery design [SOURCE-BUILT, HOSTED EXECUTION UNVERIFIED]:**
  active Workflow steps retry after 60 seconds (up to 1,440 retries) and hand
  off after 200 bounded processing cycles. The hourly recovery mode queries
  Workflow SDK run status and uses exact compare-and-set recovery only for
  terminal `completed`, `failed`, or `cancelled` runs; live/unknown runs are
  touched without being reclaimed. This replaces the earlier one-day plus
  daily-run recovery design in branch source, but does not prove hosted SDK
  status semantics or that an hourly Preview invocation exists. The new source
  is not deployed; Vercel Cron normally runs only in Production, and Preview
  hourly scheduling has not been established. Daily cleanup remains unchanged.
  Prove deployed retry/recovery, queue-only trigger security, execution duration
  and Preview delivery before enabling real transcription.
- **Account privacy:** the owner's 2026-09-30 Data Controls screenshot shows
  model-improvement opt-out on and asynchronous TTL set to **one day**, not
  zero retention. Project/key coverage, deletion lag, upload-only cleanup and
  contractual guarantees remain unverified. The owner accepts these uncertainties
  for explicitly non-sensitive testing without sending vendor support emails;
  that decision does not approve confidential recordings or paid test calls.
  Subprocessor acceptance is owner-reported. A non-sensitive acknowledgement
  is a user attestation, not content classification.
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
  synthetic M4A locally. Local worker tests also cover near-cap memory
  regression behavior; this does not prove a 50 MiB parse/upload in the target
  Function, deployed peak memory, or maximum-size timeout runway. The deployed
  media runtime has not been exercised. No audio malware scan is claimed.
- **Earlier build/test evidence (before Workflow integration):** root's integrated pass verified eleven suites and
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

### Local Workflow integration checkpoint — 2026-10-01

**[VERIFIED via local tests and build artifacts; not deployed]** Root's focused
run passed 12 suites / 119 tests, including the new dispatch, fixed-error,
acknowledgement-wait, worker and UI regressions. Luna's credential-scrubbed
Node 22 Webpack build passed; root independently inspected the generated flow
route trace and confirmed the parser worker and `music-metadata` are included.
This was a fallback build: the normal Turbopack attempt rejected the temporary
copy's external `node_modules` symlink. It is not a canonical Turbopack pass or
hosted Workflow proof. Sol accepted the bounded local worker/Workflow slice;
the recovery and generated-handler deployment gates above remain open.

**[VERIFIED via disposable local PGlite execution]** Migrations 060–061 and the
actual store queries passed nine SQL scenarios, including atomic reconciliation
and callback re-arming, old-run fencing, dispatch acknowledgement, scoped lease
recovery, due work, expiry and cleanup claims. Root independently repeated the
probe. PGlite runs PostgreSQL locally in WebAssembly; this is not a native
multi-connection Postgres concurrency proof. The updated native integration
suite remains to be rerun against an approved disposable local Postgres server;
no remote schema or data was touched. The 26 relevant repository gates/self-tests
and the type check passed; targeted lint has no errors and four existing UI
hook warnings.

The local source policy is distinct from provider retention:

| Data/state | Source retention behavior |
|---|---|
| Upload not started | Input expires after 24 hours; upload token is shorter lived (at most 15 minutes). |
| Queued / failed / unresolved input | Content expiry is seven days; access is denied as soon as the expiry timestamp passes, regardless of cleanup cron delay. |
| Ready result | Normalized result is persisted and hash-verified before provider deletion; transcript content, diagnostics, and notes expire seven days after ready. Input cleanup begins after result publication. |
| Receipt | 30 days after ready; for a never-ready job, 30 days after creation. The implementation was corrected to match this deadline. |
| Provider-side audio/job | Account-specific TTL and physical deletion behavior remain unverified; local deletion receipts do not establish backup erasure. |

The daily cleanup invocation is the physical cleanup/retry mechanism in
source, not a proven live schedule. Deletion targets only exact persisted paths and known exact
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
The owner accepts this unresolved risk for the non-sensitive pilot. Establish
and verify a completion/revocation protocol or an enforced vendor completion
bound before any tombstone-closing change or confidential-use approval.
Do not manually remove targets or substitute an assumed grace period.

Conflicting provider IDs retain the uncertain slot after DELETE. Automatic
cleanup cannot erase conflict evidence or declare remote resolution; the owner
must reconcile the verified ID or acknowledge abandonment. Normalized output
is capped at 4,000,000 bytes for Function response headroom, written without
overwrite, and read back/hash-verified before ready.

## Recovery and abandonment

- If upload/start returns retryable `503 transcription_dispatch_pending`, the
  recording is already saved as a queued job. Keep that job selected and use
  Retry start, which repeats durable-workflow delivery for the same job; do
  not upload again or create another job/provider submission.
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
  exact cleanup, never transcript publication. Publish reconciliation also
  atomically re-arms workflow delivery and attempts to resume the same verified
  job. A delivery failure returns a safe partial-success response; verification
  is not undone and the durable pending dispatch remains recoverable. If the
  reference is already purged, verification is unavailable.
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
selected recordings beyond the owner's explicit non-sensitive risk acceptance,
route/security gates are incomplete, the deployed Node runtime cannot safely
process the bounded upload, or callback/cron reachability
would require weakening a security control. Stop on any uncertain provider
acceptance; use reconcile or explicitly acknowledged abandon, never a blind
resubmission.
