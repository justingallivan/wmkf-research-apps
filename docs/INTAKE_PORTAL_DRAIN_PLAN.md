# Intake Portal — Postgres → Dataverse Drain Plan (v4)

**Status:** S179 v4 (2026-05-22). Codex round-3 findings folded in (4 findings: 2 BLOCKER / 2 MOD / 0 LOW). Round-4 Codex review stalled at 14m with no findings produced; Codex's last self-narration flagged two open lines of inquiry (token-acquisition coverage + lease-expiry during duplicate-PK recovery), both hand-checked and folded into this v4. Build-ready.

**Changes from v3 (round-3-driven):**
- **BLOCKER fix:** P0 partial-index predicate no longer references `now()` (volatile functions are illegal in PG index predicates and would have failed migration). `locked_until` moved into the indexed columns; predicate is now status-only.
- **BLOCKER fix:** `request_created` state now has explicit duplicate-PK recovery: on collision, GET the parent row, persist `akoya_requestnum`, then advance. Closes the worker-crashes-between-Create-and-persist hole.
- **MOD fix:** P-list now includes an explicit prerequisite (P5) confirming `scripts/extend-apprequestperson-role-picklist.mjs` has run in prod and option-set values `100000002`–`100000004` exist on `wmkf_apprequestperson.wmkf_role` before drain code writes roster rows.
- **MOD fix:** P1 error-shape helper covers no-response throws (timeouts, aborts, DNS/socket resets, token-acquisition failures); error taxonomy adds `network_no_response` category and broadens `graph_timeout` semantics.
- **Hand-check addenda (round-4 self-narration):** P1 site list expanded to include `getAccessToken` in both `dynamics-service.js` and `graph-service.js` (upstream of every P1-listed op; the original v4 list missed these); duplicate-PK recovery UPDATE is now lease-aware (`WHERE id=$1 AND locked_until=$2`) to prevent stale-tick clobber on parallel-worker recovery, with explicit 0-rows-affected = "another worker advanced" semantics.

**Changes from v2 (round-2-driven):**
- `scan_status` → `scan_result` (matches the deployed strict validator at `validate.js:153`)
- `event_type` → `action` everywhere in audit examples (matches deployed `intake_audit.action` column)
- P1 broadened from `createRecord()` only to a structured-error shape across all drain-dependency throw sites: `dynamics-service.{create,update,get,queryRecords}` + `graph-service.{upload,search}`
- P3 is now schema + service patch (the existing `intake-draft-service.js:68` upsert is coupled to the old conflict target — would break on migration alone)
- **New P4: dedicated private Blob store** for applicant draft attachments (`INTAKE_BLOB_RW_TOKEN`, store `intake-applicant-private`); mirrors the Dataverse Export pattern. Resolves the v2 self-contradiction.
- Two-phase job claim with new `submission_jobs.locked_until` column (short claim txn → release lock → external I/O per row, not all-rows-in-one-txn)
- Idempotency-key wiring made explicit: `intake_drafts.draft_json.idempotency_key` generated at draft-create → flows verbatim into `submission_jobs.idempotency_key`. The deployed partial index `(account_id, request_id, form_key)` is now useless (each submit has a fresh request_id); dropped and replaced with `(contact_oid, account_id, form_key)`.
- `ON CONFLICT … DO UPDATE … RETURNING *` (no-op update) instead of `DO NOTHING`, so the endpoint can return the existing job's GUIDs on collision
- Synchronous Cloudmersive scan at attach time (replaces v2's invented async callback model; matches `DESIGN.md:527`)
- `setup-database.js` inline-block updates explicitly listed in each schema-touching prereq (the existing inline CHECK + index blocks at lines 609 and 687 would otherwise re-create stale shape on fresh installs)
- Q4 example expression neutralized: `<Q1 field>` / `<Q1 value>` placeholders, no Phase I bias
- New "Child Create payload shape" subsection with primary-name synthesis (`wmkf_proposalbudgetline.wmkf_Name`, `wmkf_apprequestperson.wmkf_AssignmentKey`) and required `@odata.bind` keys

---

## Context

The intake-portal pilot pivoted from "Phase II attaches to an existing `akoya_request`" to **single-phase submission** (next-cycle change). The drain **creates** a new `akoya_request` in Dataverse from the frozen Postgres payload.

The slice-0 Dataverse schema was deployed to prod S178 (2026-05-22; commits `279d556` + `7cec6da`).

## Architecture decision — Option (ii)-refined

Pre-Dataverse compliance loop, no Dataverse pollution from abandoned applications, throttle-able drain cadence. `/api/intake/submit` generates UUIDv4 GUIDs (parent + every child row), INSERTs `submission_jobs` with `request_id` populated, returns 200. `/api/cron/drain-submissions` advances the job; the Create step uses our pre-supplied GUIDs and is naturally idempotent.

### Probe evidence (S178, live)

| Check | Result |
|---|---|
| `akoya_request.akoya_requestid.IsValidForCreate` | `true` |
| Live POST with client-supplied GUID against dummy account "New Cranberry Sauce" | HTTP 201, server returned identical GUID, DELETE 204 |
| Required-on-create fields | 2 ApplicationRequired: `akoya_applicantid` (lookup→`account`), `akoya_fiscalyear` (String) |

### Fallback contingency

If a future plugin overrides client-supplied GUIDs at Create, fall back to plain (ii) with `wmkf_submissionidempotencykey` sentinel field. ~half-day rework.

---

## Prerequisites (must land before drain code)

### P0 — `submission_jobs` schema migration (Codex round-1 §1.1; round-2 §1.1, §2.3, §6.1)

Migration `010_submission_jobs_states.sql` (and **matching `setup-database.js` inline-block update at line 609**):

```sql
-- Add new states for create-in-drain + scanning
ALTER TABLE submission_jobs DROP CONSTRAINT submission_jobs_status_check;
ALTER TABLE submission_jobs ADD CONSTRAINT submission_jobs_status_check CHECK (status IN (
  'queued',
  'scanning',
  'request_created',
  'files_moved',
  'dynamics_patched',
  'status_flipped',
  'completed',
  'failed',
  'cancelled'
));

-- Server-assigned request number captured during Create (for SharePoint folder name)
ALTER TABLE submission_jobs ADD COLUMN akoya_requestnum TEXT;

-- Two-phase claim: claim sets locked_until, releases after each step
ALTER TABLE submission_jobs ADD COLUMN locked_until TIMESTAMPTZ;
-- Partial-index predicate is status-only (PG rejects volatile fns like now() in predicates).
-- locked_until is in the indexed columns so the drain claim query's
-- "locked_until IS NULL OR locked_until < now()" filter is still index-eligible.
CREATE INDEX idx_submission_jobs_unlocked
  ON submission_jobs (next_attempt_at, locked_until, created_at)
  WHERE status NOT IN ('completed', 'failed', 'cancelled');

-- The old partial unique on (account_id, request_id, form_key) is useless after the
-- pivot — every submit has a fresh request_id, so it never collides. Replace with
-- contact-scoped active-job uniqueness as belt-and-suspenders against fresh-UUID
-- duplicate-submit-from-different-tab. idempotency_key UNIQUE is still the primary guard.
DROP INDEX idx_submission_jobs_one_active_per_request;
CREATE UNIQUE INDEX idx_submission_jobs_one_active_per_contact_form
  ON submission_jobs (contact_oid, account_id, form_key)
  WHERE status NOT IN ('completed', 'failed', 'cancelled');
```

Mirror the same changes in `scripts/setup-database.js` inline block at line 609 (status CHECK) and immediately around it (add `akoya_requestnum`, `locked_until`, the new partial index, drop the old one).

### P1 — Structured-error shape across drain dependencies (Codex round-1 §3.1; round-2 §2.2)

The drain's error-taxonomy classification (`duplicate_pk` / `validation_400` / `throttle_429` / `transient_5xx` / `not_found_404` / etc.) needs structured error info from every external-service throw site it touches. Today most throw plain `Error(...)` with status embedded only in the message string — brittle to parse.

**Patch shape (mirror `updateRecord`'s 412 pattern across all sites):**

```js
// Common helper for responses (Dataverse/Graph returned an HTTP status):
function buildServiceError(serviceName, resp, body) {
  const e = new Error(`${serviceName} failed (${resp.status}): ${body}`);
  e.status = resp.status;
  e.serviceName = serviceName;
  e.isTransient = resp.status === 429 || (resp.status >= 500 && resp.status < 600);
  try {
    const parsed = JSON.parse(body);
    e.dataverseCode = parsed?.error?.code;
    e.dataverseMessage = parsed?.error?.message;
  } catch { /* non-JSON body */ }
  return e;
}

// Sibling helper for no-response throws (timeout, DNS/socket reset, AbortError,
// token-acquisition failure — anything that throws BEFORE an HTTP response exists).
// Every fetch site must wrap its catch so the taxonomy classifier sees a structured
// error, not a bare Error. Without this, network failures bypass retry classification.
function buildNoResponseError(serviceName, cause) {
  const e = new Error(`${serviceName} no-response: ${cause?.message || cause}`);
  e.serviceName = serviceName;
  e.status = null;
  e.cause = cause;
  e.isTransient = true;   // network/timeouts are retryable by default
  e.noResponse = true;
  // Best-effort cause tagging for diagnostics:
  if (cause?.name === 'AbortError') e.causeKind = 'abort';
  else if (cause?.code === 'ETIMEDOUT' || cause?.code === 'UND_ERR_HEADERS_TIMEOUT') e.causeKind = 'timeout';
  else if (cause?.code === 'ECONNRESET' || cause?.code === 'ECONNREFUSED') e.causeKind = 'socket';
  else if (cause?.code === 'ENOTFOUND' || cause?.code === 'EAI_AGAIN') e.causeKind = 'dns';
  else e.causeKind = 'unknown';
  return e;
}

// Usage at each fetch site:
//   try { const resp = await fetch(...); if (!resp.ok) throw buildServiceError(...); }
//   catch (err) { if (err.serviceName) throw err; throw buildNoResponseError('dataverse', err); }
```

Apply to all of:
- `lib/services/dynamics-service.js`:
  - **`getAccessToken` (lines 93-136) — UPSTREAM of every op below; without this the entire P1 chain leaks unstructured errors.** Wrap the `fetchWithTimeout` token call and the response-status throw on line 127; the missing-env throw on line 107 should also adopt `buildServiceError('dataverse', { status: 500 }, 'Missing env: …')` so callers see a consistent shape.
  - `createRecord` (line ~785)
  - `updateRecord` (already does 412 specifically — broaden to all non-2xx)
  - `getRecord` (~line 473)
  - `queryRecords` (~line 511)
- `lib/services/graph-service.js`:
  - **`getAccessToken` (lines 88-123) — same upstream treatment as Dynamics.**
  - `uploadFile` (~line 613)
  - any other throw the drain touches (search, list, download)

Test coverage: a small `tests/lib/services/error-shape.test.js` that pokes each helper with a 404/429/500 mock and asserts `.status` / `.dataverseCode` / `.isTransient` attached; plus a no-response case (mocked `AbortError` + `ETIMEDOUT`) asserting `.noResponse === true`, `.causeKind` set, `.isTransient === true`.

This is a small but cross-cutting patch — roughly half-day. Necessary for the drain's `request_created` duplicate-PK detection AND for the `files_moved` / `dynamics_patched` retry classification.

### P2 — `contact.wmkf_portal_oid` + alternate key (Codex round-1 §1.3)

Mini-deploy via `apply-dataverse-schema.js`:
- `contact.wmkf_portal_oid` — String (max 50), nullable, indexed
- **Alternate key** `wmkf_PortalOid_AlternateKey` on `(wmkf_portal_oid)` — Dataverse-side defense-in-depth for one-OID-per-contact
- Atlas + catalog entries (`docs/atlas/dataverse-contact.md` if exists, else `INTAKE_PORTAL_SCHEMA_CHANGES.md` log)

Wave directory: `wave4-followup/contact-portal-oid.json`. Run with `--wave=4-followup` (existing apply script reads `wave{N}-existing/` and `wave{N}/`, so we use `wave4-followup` as a fresh wave).

### P3 — `intake_drafts` uniqueness redesign (schema + service patch) (Codex round-1 §2.3; round-2 §1.1, §3.1)

**Verified prerequisite knowledge:**
- Current `idx_intake_drafts_unique_no_request` is `UNIQUE (account_id, form_key) WHERE request_id IS NULL` — allows only one requestless draft per institution-form across ALL contacts.
- `lib/services/intake-draft-service.js:68` uses `ON CONFLICT (account_id, form_key) WHERE request_id IS NULL`. Migration alone breaks autosave.

**P3 has two parts, deployed together:**

**P3a — Migration `011_intake_drafts_uniqueness.sql` (plus matching `setup-database.js:687` inline update):**

```sql
DROP INDEX idx_intake_drafts_unique_no_request;
CREATE UNIQUE INDEX idx_intake_drafts_unique_no_request
  ON intake_drafts (contact_oid, account_id, form_key)
  WHERE request_id IS NULL;
```

**P3b — Patch `intake-draft-service.js`:**

```js
// In upsert():
ON CONFLICT (contact_oid, account_id, form_key)  // was: (account_id, form_key)
WHERE request_id IS NULL
DO UPDATE SET ...
```

Plus `getByKey()`: change signature to take `(contactOid, accountId, formKey)` if any caller relies on contact-scoped lookup (verify before patch). Update `scripts/smoke-intake-draft.js` to use the new key and verify it passes.

### P5 — `wmkf_apprequestperson.wmkf_role` option-set expansion verified in prod (Codex round-3 §3)

**Background:** The plan writes 5 role values to `wmkf_apprequestperson` rows (`100000000`–`100000004` = PI / Co-PI / Senior / Key / Other). The deployed slice-0 schema only added the *fields*; the *option-set expansion* from the as-shipped 2-value enum to 5 values ships as a standalone idempotent script (`scripts/extend-apprequestperson-role-picklist.mjs`). If that script hasn't run in prod, drain writes of Senior/Key/Other roster rows fail as `validation_400`.

**Verification (run before drain code goes live):**

```bash
# Read the live option set; expect entries for 100000000..100000004 inclusive.
node scripts/extend-apprequestperson-role-picklist.mjs --check
# If any missing:
node scripts/extend-apprequestperson-role-picklist.mjs
```

The script is idempotent (`InsertOptionValue` is a no-op for existing values), so re-running on an already-expanded picklist is safe.

**Acceptance:** GET on `wmkf_apprequestperson` EntityDefinitions returns OptionSet members with values `100000002`, `100000003`, `100000004` and matching display labels (`Senior`, `Key`, `Other`).

### P4 — Dedicated private Blob store for applicant attachments (Codex round-2 §4.1)

The existing shared `BLOB_READ_WRITE_TOKEN` points at the public `phase-ii-summaries-blob` store (per CLAUDE.md). Applicant draft attachments contain budget detail, biosketches, personal info — they belong in a **private** store. Mirror the Dataverse Export pattern (`DVX_BLOB_RW_TOKEN` for `dvx-export-private`).

Per the Vercel CLI gotcha documented in CLAUDE.md for DVX: connecting a 2nd Blob store under a custom env-var name requires manual provisioning (create store via CLI, then read its token from the Vercel dashboard and `vercel env add INTAKE_BLOB_RW_TOKEN` per environment).

Provisioning steps:
1. `vercel blob store add intake-applicant-private --access private`
2. Read the token from the Vercel dashboard
3. `vercel env add INTAKE_BLOB_RW_TOKEN <token> production preview development`
4. Add to `docs/CREDENTIALS_RUNBOOK.md`
5. Add a fail-loud check at intake-attach-endpoint startup: if `INTAKE_BLOB_RW_TOKEN` is unset and intake is enabled, refuse to start.

---

## Build pieces (revised sequencing)

After P0–P4, build sequence is:

### 1. Auth → contact bridge (`lib/services/contact-bridge-service.js`)

Phrasing per Codex round-1 §2.4 + round-2 §6.2 (confirmed clean):

- Read `session.user.contactOid` and `session.user.contactEmail` (set by the `entra-external` provider in `pages/api/auth/[...nextauth].js`)
- Query Dataverse: `contact?$filter=wmkf_portal_oid eq '{contactOid}'` first
- If no match: fall back to `contact?$filter=emailaddress1 eq '{contactEmail}' and wmkf_portal_oid eq null`
- If still no match: create a new contact with `wmkf_portal_oid` set
- **Conflict route to staff** (`DESIGN.md:175`): if email lookup hits a contact with a different OID set, do NOT auto-link — surface via `intake_audit` with `action: 'bridge.conflict'` and a "needs staff resolution" error to the applicant.

### 2. Membership query (`lib/services/membership-service.js`)

```js
async function getMembershipsForContact(contactId) {
  return query(
    `wmkf_portalmemberships?$filter=
       _wmkf_contact_value eq ${contactId}
       and wmkf_approvalstatus eq 100000002  // Approved
       and statecode eq 0                     // Active
     &$select=_wmkf_account_value,wmkf_role,wmkf_isprimary`
  );
}
```

Two consumers:
- `/apply` landing: returns approved memberships for institution-select
- Server-side ownership guard on `/api/intake/submit`: `account_id` ∈ approved set AND `wmkf_role = 100000000` (Submitter) (Codex round-1 §1.2). Contributors (`100000001`) can edit drafts but cannot submit.

### 3. `/apply` simplified landing (`pages/apply/index.js` + `pages/apply/new.js`)

- "Your in-progress drafts" — Postgres query on `intake_drafts` by `contact_oid`
- "Start a new submission" — opens `/apply/new` → pick institution → pick `form_key` → create draft (generates UUIDv4 idempotency_key, persists in `draft_json`), navigate to form
- No request-picker (single-phase)

### 4. `/api/intake/draft` — autosave + attachment

**`POST /api/intake/draft`** — upsert draft. Either role can write.
- Ownership guard: `account_id` ∈ contact's approved memberships
- `idempotency_key` generated at draft creation, persisted in `draft_json.idempotency_key`, reused on all autosaves
- Audit write: `action: 'draft.upsert'`, payload = `{draftId, changedFieldKeys}`

**`POST /api/intake/draft/attach`** — file upload (synchronous scan).
- Auth: same as draft (any role)
- Stream upload to **private Blob store** (`INTAKE_BLOB_RW_TOKEN`)
- Compute sha256 + size
- **Synchronous** Cloudmersive virus scan (blocking the upload response). For pilot file sizes (typical biosketch/PDF: <10MB), this fits comfortably in a Vercel function timeout. Stream-scan-then-store if needed for larger files.
- Append `attachments` JSONB entry: `{filename, blob_url, sha256, size, scanned_at, scan_result: 'clean' | 'infected' | 'error'}`
- If `scan_result = 'infected'`: store the entry with the infected marker; return 422 to applicant; do NOT delete from Blob immediately (keep for audit until the draft expires)
- If `scan_result = 'error'` (Cloudmersive 5xx, etc.): retry up to 3 times inline; if still failing, return 503 to applicant; do NOT persist a "clean" record
- Audit write either way: `action: 'draft.attach'` or `action: 'draft.attach_scan_failed'`

This matches the v1/`DESIGN.md:527` synchronous model and the form validator's `scan_result === 'clean'` check at `validate.js:153`.

### 5. `/api/intake/submit`

- **Auth guard:** authenticated contact + `wmkf_role = 100000000 (Submitter)` for the target `account_id`
- **Payload validation:** form schema + budget math (the `$100K` multiple invariant per `BUDGET_FORM_SPEC.md:221,395`) + all attachments must be `scan_result: 'clean'`
- **GUID generation** (all UUIDv4):
  - 1 for `akoya_requestid`
  - 1 per `wmkf_proposalbudgetline` row
  - 1 per `wmkf_apprequestperson` row added/changed
  - All stored in the frozen `payload` JSONB before queue
- INSERT with collision-returning pattern:
  ```sql
  INSERT INTO submission_jobs (...) VALUES (...)
  ON CONFLICT (idempotency_key)
  DO UPDATE SET attempts = submission_jobs.attempts  -- no-op, lets RETURNING fire
  RETURNING id, request_id, status;
  ```
- Audit write: `action: 'submit'`, payload = `{jobId, requestId, accountId}`
- Return 200 with `{ jobId, requestId, status }`

### 6. `/api/cron/drain-submissions`

**State machine:**

```
queued
  → scanning              (all attachments must be scan_result='clean'; else retry / fail per taxonomy)
  → request_created       (POST akoya_request with our GUID + required fields + Prefer: return=representation;
                           capture server-assigned akoya_requestnum into submission_jobs.akoya_requestnum.
                           On duplicate_pk: see "Duplicate-PK recovery in request_created" below.)
  → files_moved           (Blob → SharePoint; folder name = `{akoya_requestnum}_{requestGuid-no-hyphens-upper}`
                           per existing convention `review-upload.js:128`; record paths in sharepoint_paths JSONB)
  → dynamics_patched      (POST wmkf_proposalbudgetline children with pre-generated GUIDs;
                           POST wmkf_apprequestperson roster rows; PATCH parent aggregates)
  → status_flipped        (PATCH the source picklist — Connor Q1 — NOT akoya_requeststatus directly)
  → completed             (set completed_at; clear intake_draft; audit write)
```

Terminal: `failed`, `cancelled`.

**Two-phase job claiming (Codex round-2 §2.3):**

Phase 1 — short claim transaction (milliseconds):

```sql
BEGIN;
WITH claimable AS (
  SELECT id
  FROM submission_jobs
  WHERE status NOT IN ('completed', 'failed', 'cancelled')
    AND next_attempt_at <= now()
    AND (locked_until IS NULL OR locked_until < now())
  ORDER BY next_attempt_at, created_at
  LIMIT 5  -- DRAIN_BATCH_SIZE
  FOR UPDATE SKIP LOCKED
)
UPDATE submission_jobs sj
  SET locked_until = now() + INTERVAL '10 minutes'
  FROM claimable
  WHERE sj.id = claimable.id
  RETURNING sj.*;
COMMIT;
```

Phase 2 — process each claimed row independently. Each row's status transition is its own short transaction. Lock renewal: if a step is slow, drain bumps `locked_until` before doing the slow call. Lock release on completion: clear `locked_until`. Crash recovery: another worker picks the row up after the lease expires.

**Error taxonomy (depends on P1 broadening):**

| Category | Behavior | Examples |
|---|---|---|
| `duplicate_pk` | State-specific recovery (see below for `request_created`); else treat as success and advance | Dataverse returns 412/409 on Create with our GUID (already created by prior tick) |
| `validation_400` | Terminal `failed` immediately | Required-field missing; type mismatch; option-set value not in enum |
| `auth_4xx` (401/403) | Terminal `failed`; alert via `system_alerts` | Token expired beyond refresh; user lost permission mid-flow |
| `not_found_404` | Terminal `failed` | Lookup target deleted (e.g. account removed between submit and drain) |
| `throttle_429` | Retry with exponential backoff; max_attempts=10 | Dataverse / Graph rate limit |
| `transient_5xx` | Retry with exponential backoff; max_attempts=10 | Dataverse 502/503/504; Graph transient |
| `network_no_response` | Retry with exponential backoff; max_attempts=10; on `files_moved` step also consult `sharepoint_paths` JSONB to skip already-written | `err.noResponse=true` — fetch timeout, DNS, socket reset, abort, token-acquisition failure (any service) |
| `scan_infected` | Terminal `failed` (rare — caught at upload time) | Cloudmersive returns infected post-queue |
| `scan_error` | Retry up to max_attempts=3, then terminal `failed` | Cloudmersive 5xx |

Each failure writes audit: `action: 'drain.error'`, payload = `{state, category, message, attempt}`.

Classification uses `err.status` / `err.dataverseCode` / `err.noResponse` attached by the P1 patch — not string-parsing. `err.noResponse === true` ⇒ `network_no_response` category (the `graph_timeout` row from v3 collapses into this — timeouts against either Graph or Dataverse take the same path).

**Per-state idempotency:**
- `scanning`: read-only checks; safe to repeat
- `request_created`: pre-generated GUID + duplicate-PK detection with explicit recovery (below)
- `files_moved`: track written paths in `sharepoint_paths`; skip already-written
- `dynamics_patched`: pre-generated child GUIDs + duplicate-PK detection per child; aggregates re-summed (deterministic on same payload)
- `status_flipped`: PATCH is naturally idempotent

**Duplicate-PK recovery in `request_created` (Codex round-3 §2):**

The transition is *two* persistence steps: Dataverse Create, then Postgres write of
`status='request_created'` + `akoya_requestnum`. A worker crash between them leaves the row
created in Dataverse but the job still `queued` (with no `akoya_requestnum` captured). The retry's
Create fails with `duplicate_pk` and has no representation to read `akoya_requestnum` from — which
the next state (`files_moved`) needs to name the SharePoint folder.

Recovery flow (drain code, on `duplicate_pk` during `request_created`):

```js
if (err.category === 'duplicate_pk' && state === 'request_created') {
  // The row exists from a prior tick. Read back what the server assigned.
  const existing = await dynamics.getRecord(
    'akoya_requests',
    job.request_id,
    { $select: 'akoya_requestnum' }
  );
  if (!existing?.akoya_requestnum) {
    // Shouldn't happen — akoya_requestnum is server-autonumber. Treat as fatal.
    throw buildServiceError('dataverse', { status: 500 },
      `request_created recovery: row exists but akoya_requestnum missing for ${job.request_id}`);
  }
  // Lease-aware update: only the worker still holding the lease should advance the row.
  // Two workers running this recovery in parallel both compute the same akoya_requestnum
  // and both UPDATEs would be content-identical (idempotent), but guarding on locked_until
  // prevents a stale tick from clobbering newer state.
  await pg.query(
    `UPDATE submission_jobs
        SET status='request_created', akoya_requestnum=$1, locked_until=NULL
        WHERE id=$2 AND locked_until=$3`,
    [existing.akoya_requestnum, job.id, job.locked_until]
  );
  return; // advance
}
```

This makes the boundary between Dataverse-side state and Postgres-side state explicit and
recoverable on either side of the crash, without any new schema or sentinel field. If the
lease-guarded UPDATE affects 0 rows (another worker already advanced), the caller treats
that as success and moves on — both outcomes converge.

**Cron protection:** `CRON_SECRET`.

**Throttling:** `DRAIN_BATCH_SIZE` (default 5).

### Child Create payload shape (Codex round-2 §7.1)

Both child entities have ApplicationRequired primary-name attributes; a missing primary name turns a retry into a terminal `validation_400`. Spell out the shape:

**`wmkf_proposalbudgetline`** — POST body per row:
```json
{
  "wmkf_proposalbudgetlineid": "<pre-generated UUID>",
  "wmkf_Name": "Y{year} — {category-label}: {description}",   // synthesized; <=160 chars; truncate with ellipsis
  "wmkf_year": <int 1-10>,
  "wmkf_category": <int 100000000-100000009>,
  "wmkf_description": "<string, <=500>",
  "wmkf_amount": <decimal>,
  "wmkf_lineorder": <int>,
  "wmkf_rolecode": <string|null>,                              // null for dynamic rows
  "wmkf_headcount": <int|null>,                                // Personnel rows only
  "wmkf_effortpct": <int|null>,                                // Personnel rows only
  "wmkf_Request@odata.bind": "/akoya_requests(<parent-GUID>)"
}
```

**`wmkf_apprequestperson`** — POST body per row:
```json
{
  "wmkf_apprequestpersonid": "<pre-generated UUID>",
  "wmkf_AssignmentKey": "{request-num} — {role-label} — {position-index}",  // synthesized; <=200
  "wmkf_role": <int>,                                          // 100000000=PI, 100000001=Co-PI, 100000002=Senior, 100000003=Key, 100000004=Other — requires P5 picklist expansion
  "wmkf_effortpct": <int|null>,
  "wmkf_biosketchurl": <string|null>,
  "wmkf_lineorder": <int>,
  "wmkf_Request@odata.bind": "/akoya_requests(<parent-GUID>)",
  "wmkf_Contact@odata.bind": "/contacts(<contact-GUID>)"
}
```

`{request-num}` for `wmkf_AssignmentKey` is the server-assigned `akoya_requestnum` captured during `request_created`. This means `wmkf_apprequestperson` children cannot be POSTed until `request_created` completes — natural sequencing handled by the state machine.

### 7. `/api/intake/jobs/[id]` (read-only, applicant-facing)

Status, `attempts`, user-actionable `last_error`, `completed_at`. Auth: contact must own the job (`contact_oid` match).

---

## Connor questions (sharpened)

Sent as one batched ask; doesn't block scaffolding through `dynamics_patched`.

### Q1 — Source picklist field for portal-submitted single-phase requests

**Background:** `akoya_request.akoya_requeststatus` is a **derived** string rollup per `INTAKE_PORTAL_ITEM_6_STATUS.md:103-119`. Source-of-truth picklists are `wmkf_phaseistatus` (S/T: `wmkf_PhaseIStatus`) and `wmkf_phaseiistatus` (S/T: `wmkf_PhaseIIStatus`). Single-phase has no Phase I/II distinction.

**We need from you, all four:**
1. **Field logical name** the drain should PATCH
2. **Option integer value** for the post-portal-submit pre-committee-review state
3. **Display label**
4. **Existing-vs-new:** does this value exist on the chosen picklist today, or do you need to add it?

### Q2 — PI / contact attribution at Create

**Background:** Three contact-role lookups, semantically load-bearing per memory `project-institution-foundation-liaison`:
- `wmkf_projectleader` — PI / scientific lead
- `akoya_primarycontactid` — foundation liaison/steward (NOT the PI)
- `wmkf_researchleader` — institutional research officer

**Per each of the three:**
1. **Exact lookup field name** and the entity each points to (`contact`? `systemuser`?)
2. **Required at Create vs. optional** for portal-originated requests
3. **Source of value:** from the authenticated portal applicant? from `account` defaults? form-captured? null-at-Create-fill-later?
4. **Fallback** when source doesn't yield a value

**Specific use case:** "Applicant authenticates as Jane Doe at Stanford; Jane is not the PI but is submitting on behalf of PI John Smith." How does each of the three fields get populated?

### Q3 — AkoyaGO staff working-view filters

1. **View names** (system view vs. personal view, with owners) that read from `akoya_request` and might surface portal-submitted-but-not-staff-reviewed rows
2. **Exact filter clause** to add before pilot opens
3. **Who applies the filter** — you or the AkoyaGO admin?

### Q4 — Option A′ recompute-flow gate value

**Background:** A′ gates inside the flow body after `Get a row by ID` of the parent.

1. **Exact condition expression**: `equals(body('Get_parent')?[<Q1 field>], <Q1 value>)`
2. **Source field fetched** (matches Q1)
3. **Integer value compared against** (matches Q1)
4. **P4 evidence artifacts** on the real-schema re-run: run IDs, `SdkMessage` literals observed, parent-lookup GUIDs, active-subset list. Same rubric as the original core-gate test.

---

## Doc reconciliation (Phase II → single-phase + deploy-state)

| Doc | What needs updating |
|---|---|
| `docs/INTAKE_PORTAL_DESIGN.md` | "Phase II only" framing; request-picker flow at 189–211; lifecycle/aggregate sections at 432–434; planned `wmkf_phaseiisubmittedat`/`by` fields at 627 |
| `docs/INTAKE_PORTAL_ITEM_6_STATUS.md` | (a) The recompute lifecycle-gate value (depends on Q1); P4 narrative; (b) §1 deploy banner — currently says "pending Justin's explicit go-ahead"; reflect that deploy happened S178; §5 deploy-sequence is now retrospective |
| `docs/INTAKE_PORTAL_ITEM_6_DISCUSSION.md` | §0 gate value; trigger-filter expression literal |
| `docs/atlas/dataverse-wmkf-proposalbudgetline.md` | Recompute description still mentions Phase II; update to Q1-answer value |
| `docs/atlas/dataverse-wmkf-apprequestperson.md` | Still says "NOT yet deployed"; update to deployed-S178 |
| `docs/BUDGET_FORM_SPEC.md` | "Phase II" mentions; `form_key` likely becomes `research-2026-XX` |
| `docs/INTAKE_PORTAL_SCHEMA_CHANGES.md` | The planned-but-deferred `phaseiisubmittedat`/`by` entries are obsolete; add the `contact.wmkf_portal_oid` follow-up entry |
| `.claude-memory/slice0-deactivate-not-delete-recalc.md` | Reference Phase II status string in the lifecycle gate |
| `.claude-memory/project-intake-portal-skinny-scope.md` | Still frames pilot as Phase II Research; uses old `wmkf_portal_membership` name |
| `.claude-memory/project-slice0-scope.md` | 9-value enum (now 10) + old `wmkf_portal_membership` name + pre-deploy "doc-vs-catalog gap" framing for `contact.wmkf_portal_oid` |

---

## Risk register

| ID | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | AkoyaGO required-field set grows under real submissions | LOW | Probe revealed 2 required; accept incremental discovery via dummy-org test submissions |
| R2 | OnCreate plugin shift breaks GUID idempotency | LOW | Probe clean; fallback to sentinel field documented; ~half-day rework |
| R3 | Tuition cap rule TBD | LOW (non-blocking) | Parked in `BUDGET_FORM_SPEC.md`; validation rule only |
| R4 | Drain stalls on transient errors | **handled** | Error taxonomy + exponential backoff + max_attempts per category |
| R5 | Abandoned drafts in Postgres | LOW | Cleanup cron later (drafts > N days) |
| R6 | `intake_drafts` uniqueness collision | **handled by P3** | Migration + service patch bundled |
| R7 | Status flip target depends on Connor (Q1) | MOD | Build through `dynamics_patched` is Q1-independent; only `status_flipped` waits |
| R8 | Contributor role accidentally submits | **handled** | Submitter-only guard at `/api/intake/submit` |
| R9 | Concurrent cron invocations race | **handled** | Two-phase claim with `locked_until` lease |
| R10 | Cloudmersive scanner unconfigured | MOD | `CLOUDMERSIVE_API_KEY` added to env-vars; fail-loud at startup |
| R11 | Duplicate child-row writes on partial retry | **handled** | Pre-generated child GUIDs + duplicate-PK detection per child |
| R12 | Two contacts collide on same OID | **handled by P2** | Dataverse alternate key on `wmkf_portal_oid` |
| R13 | Applicant attachments leak via public Blob | **handled by P4** | Dedicated private store + `INTAKE_BLOB_RW_TOKEN` |
| R14 | Long-running drain step + lock expiry | MOD | Lease renewal in drain code; other workers honor `locked_until` |
| R15 | Cloudmersive sync scan exceeds Vercel timeout for very large files | LOW | Pilot file sizes are small; stream-scan if needed for future larger uploads |

---

## Configuration / env-vars

| Variable | Purpose | Scope |
|---|---|---|
| `CLOUDMERSIVE_API_KEY` | Virus scanner | Required for `/api/intake/draft/attach` and `scanning` drain state. Fail-loud at startup if unset and `INTAKE_ENABLED=true`. |
| `INTAKE_BLOB_RW_TOKEN` | **NEW** — dedicated private Blob store (`intake-applicant-private`) for applicant attachments. Provisioned per CLAUDE.md DVX-style manual flow. Fail-loud at attach endpoint startup if unset. | Required |
| `CRON_SECRET` | Drain cron auth | Required (existing) |
| `DRAIN_BATCH_SIZE` | Drain throughput tuning | Optional; default `5` |
| `DRAIN_LOCK_TTL_SECONDS` | Two-phase claim lease length | Optional; default `600` (10 min) |
| `DRAIN_MAX_ATTEMPTS` | Per-state retry cap | Optional; default `10` (transient categories); per-category overrides in code |
| `INTAKE_ENABLED` | Master kill switch | Optional; defaults `false` until pilot opens |

The shared `BLOB_READ_WRITE_TOKEN` (public store `phase-ii-summaries-blob`) is **not** used by intake. Reviewer-finder / uploads / maintenance continue to use it; intake gets its own private store.

---

## Compliance-loop direction (out of v1 scope)

Future v1.x: add `'awaiting_correction'` to the submission_jobs status CHECK; drain pauses; applicant edits via `/apply/submissions/[id]`; re-submits.

---

## Out of scope (explicit)

- Multi-phase / Phase I / Concept-stage portal submissions
- Phase II attach-to-existing (the original pilot pattern)
- Request-picker dashboard
- Connor's PA flows (Option A′ build + P4) — Connor-owned
- Tuition cap rule
- Reviewer-flow / external-reviewer side
- The compliance-loop workflow (architectural future, not v1)

---

## Verification checklist

- [ ] **P0** applied: status CHECK includes `request_created`; `akoya_requestnum` + `locked_until` columns present; partial unique index rekeyed; `setup-database.js:609` inline block updated
- [ ] **P1** applied: `createRecord` / `updateRecord` / `getRecord` / `queryRecords` (Dataverse) + `uploadFile` / etc. (Graph) all throw errors with `.status`, `.serviceName`, optional `.dataverseCode`; error-shape test passes
- [ ] **P2** deployed: `contact.wmkf_portal_oid` + alternate key on prod
- [ ] **P3** applied: index rekeyed to `(contact_oid, account_id, form_key)`; `intake-draft-service.js` upsert uses matching conflict target; `setup-database.js:687` inline block updated; `smoke-intake-draft.js` passes
- [ ] **P4** provisioned: `intake-applicant-private` Blob store created; `INTAKE_BLOB_RW_TOKEN` set in production/preview/development; CREDENTIALS_RUNBOOK updated
- [ ] **P5** verified: `wmkf_apprequestperson.wmkf_role` option set includes `100000002`/`100000003`/`100000004` in prod; `extend-apprequestperson-role-picklist.mjs --check` is clean
- [ ] Auth bridge: OID-first / email-fallback / conflict-routing behaves per spec; `intake_audit` action='bridge.conflict' on the conflict path
- [ ] Membership query returns approved+active+role; Submitter-only guard enforced at `/api/intake/submit`
- [ ] `/apply` skeleton: drafts list + new-submission flow click-through
- [ ] `/api/intake/draft` autosave + attach (synchronous Cloudmersive scan) round-trip; attachments record `scan_result: 'clean' | 'infected' | 'error'`
- [ ] `/api/intake/submit` returns `{jobId, requestId}` in <500ms with no Dataverse write; collision returns existing job's GUIDs via `DO UPDATE … RETURNING`
- [ ] Drain advances a real test submission against "New Cranberry Sauce" through all states to `completed`, including SharePoint folder with correct `{akoya_requestnum}_{requestGuid}` name
- [ ] Retry test: kill drain mid-`request_created`, restart → no duplicate request (verify Dataverse query)
- [ ] Retry test: kill drain mid-`dynamics_patched`, restart → no duplicate child rows
- [ ] Idempotency test: double-submit with same idempotency_key → ONE `submission_jobs` row, ONE akoya_request; second submit returns first row's GUIDs
- [ ] Concurrency test: two cron invocations in parallel → no row processed twice; `locked_until` lease honored
- [ ] All four post-deploy CI gates green
- [ ] `intake_audit` rows present (`action` column) for every endpoint and drain transition under test
- [ ] Doc reconciliation complete
- [ ] Connor Q1–Q4 answered; `status_flipped` lands the agreed value

---

## What we're asking Codex (round 4) to look at

This is v4 after three review rounds (36 findings folded across rounds 1+2+3). Specifically:

1. **Did the v4 fixes introduce new gaps?** — Especially the duplicate-PK recovery code block (drain code now reads back `akoya_requestnum` via a fresh GET inside the `request_created` retry path), the new `buildNoResponseError` helper, the new P5 verification step.
2. **Is the `network_no_response` category complete?** — Does collapsing `graph_timeout` into it lose any state-specific behavior (`files_moved` still needs the "consult `sharepoint_paths`" skip — keep that explicit)?
3. **P5 sequencing** — Is the role-picklist verification at the right place in the prereq list, or does it actually need to land alongside P0 (since drain code is the first writer that depends on it)?
4. **Index shape after the v4 fix** — `(next_attempt_at, locked_until, created_at)` with status-only predicate: is the claim query at `:282-291` still index-eligible? Row-count behavior with `FOR UPDATE SKIP LOCKED`?
5. **Anything else genuinely concerning** that rounds 1–3 didn't surface.

Convergence trend: 21 → 11 → 4. If the plan is now clean enough for build, say so explicitly.
