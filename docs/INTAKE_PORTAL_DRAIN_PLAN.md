# Intake Portal — Postgres → Dataverse Drain Plan (v7)

**Status:** S179 v7 (2026-05-22). Codex round-7 findings folded in (5 findings: 0 BLOCKER / 5 MOD/GAPS / 0 LOW — narrow delta sanity check). Rounds 8 + 9 reviewed the P0 build commit + the round-8 fold; round-9 caught 2 small doc-drift items (P0 SQL snippet had stale non-idempotent forms; no migration-apply runbook). Both folded into this v7. Build-ready.

**Changes from v6 (round-7-driven, sanity-check pass):**
- **GAPS fix:** Duplicate-PK recovery's 0-rows-affected re-read only accepted `request_created` as a safe convergence state. Another worker could have advanced further (`files_moved` → `completed`) before this stale worker got there, which would have thrown spuriously. v7 accepts any state at-or-after `request_created` with `akoya_requestnum` populated.
- **NEEDS-FIX:** "New draft = new idempotency_key" was hand-waved in v6; the current `intake-draft-service.js:68` upsert is keyed by (contact_oid, account_id, form_key) and doesn't auto-rotate keys. v7 specifies the actual rotation mechanism: (a) /apply landing filters out drafts tied to terminal jobs via an EXISTS sub-query, (b) /api/intake/submit populates `intake_drafts.request_id` in the same txn as the job INSERT so the terminal-tied draft moves outside the partial-unique index, (c) /apply/new then creates a fresh draft with a freshly-minted idempotency_key, (d) cleanup cron purges terminal-tied drafts after N days (out of v1 scope).
- **GAPS fix:** Audit consistency model named pg failures generically as "feeding the taxonomy"; v7 adds an explicit pg-SQLSTATE table (`40P01` deadlock + `40001` serialization → `pg_transient` retryable; `08000`/`08006` → `network_no_response`; `23505` → `duplicate_pk`; other `23xxx` → `validation_400`). Also clarifies the transactional boundary: drain-side audits are transactional with the state UPDATE; endpoint-side audits (`'submit'`, `'bridge.conflict'`, `'draft.upsert'`, `'draft.attach'`) are best-effort with `system_alerts` fallback.
- **GAPS fix:** Drain-entry attachment-shape validation_400 was indistinguishable from ordinary user-validation errors, but at that point the submit-entry validator has already passed so any failure is corruption / hand-editing / code regression. v7 says: terminal-fail AND write a `system_alerts` row of severity `error` so the operator sees the event.
- **GAPS fix:** Cron registration timing was ambiguous (register before route → scheduled 404; route before registration → never fires); v7 says "same commit." Lease renewal trigger was hand-waved as "before slow calls"; v7 specifies (a) before each external HTTP call, (b) inside long loops every N iterations or `TTL/3` wall-clock, with a concrete `withLeaseRenewal` helper.

**Changes from v5 (round-6-driven):**
- **BLOCKER fix:** `/api/cron/drain-submissions` was not registered in `vercel.json` — production latency would have been unbounded because the drain never fires. Added explicit cron-registration spec at `*/2 * * * *` (below the 10-min lease TTL) with cadence rationale, worst-case latency analysis, and a verification-checklist item.
- **NEEDS-SPEC fix:** Idempotency-key collision against a terminal-state row (`failed` / `cancelled`) would have returned the dead row's GUIDs to a re-submitting applicant and stranded them. Added explicit terminal-collision behavior: 409 + `previous_submission_terminal` response; new draft generates a new `idempotency_key` and breaks the collision naturally. Audit on the blocked path.
- **MOD fix:** Audit consistency model was unspecified — could state advance without an audit row, or vice versa? Locked the contract: state UPDATE + audit INSERT in one Postgres transaction; rollback on either failure; pg-write failures classify into the same retry taxonomy as Dataverse/Graph.
- **NEEDS-VALIDATOR fix:** `scanning` trusted `scan_result: 'clean'` but didn't validate the rest of each attachment object's shape. A malformed attachment (missing `blob_url`/`sha256`/`size`) could pass and fail later in `files_moved`. Added a runtime `validateAttachmentShape` that runs at BOTH submit-entry (fail-fast 422) and drain-entry (terminal `validation_400`).

Two round-6 questions returned CLEAN: child-ordering within `dynamics_patched` (Q2 — child creates before parent aggregate PATCH is the natural retryable order), and membership role enum values matching the deployed schema (Q6 — `wmkf_portalmembership.wmkf_role` at `lib/dataverse/schema/wave4/wmkf_portalmembership.json:24` maps Submitter=100000000 / Contributor=100000001 as the submit guard expects).

**Changes from v4 (round-5-driven):**
- **BLOCKER fix:** v4's lease-aware UPDATE in duplicate-PK recovery guarded on `locked_until`, but the plan explicitly allows in-flight lease renewal. A worker that renewed its own lease mid-recovery would see a stale `job.locked_until` snapshot and the UPDATE would silently affect 0 rows — combined with v4's "0 rows = another worker advanced" semantics, this could skip advancement without persisting `akoya_requestnum`. v5 adds a stable `lease_token UUID` column (generated fresh at claim, untouched by renewal, cleared on completion); the recovery UPDATE guards on `lease_token` instead. 0-rows now requires a re-read disambiguation between "advanced by other worker" (safe) and "still queued" (fatal — surface for diagnosis).
- **MOD fix:** P1 list expanded to include `getSiteId` and `getDriveId` in graph-service.js — both transitively upstream of `uploadFile`, both with throw sites that would have leaked unstructured errors (allowlist violations, URL parsing, drive resolution).

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

Migration `011_submission_jobs_states.sql` (and **matching `setup-database.js` inline-block update at line 609**):

The migration file is the source of truth — this block summarizes its shape so the plan reads coherently, but the actual SQL lives in `lib/db/migrations/011_submission_jobs_states.sql` (idempotent: `DROP CONSTRAINT IF EXISTS`, `ADD COLUMN IF NOT EXISTS`, `DROP INDEX IF EXISTS`, `CREATE [UNIQUE] INDEX IF NOT EXISTS`):

```sql
BEGIN;

-- 1) Status CHECK: add 'request_created' between 'scanning' and 'files_moved'
ALTER TABLE submission_jobs DROP CONSTRAINT IF EXISTS submission_jobs_status_check;
ALTER TABLE submission_jobs ADD CONSTRAINT submission_jobs_status_check CHECK (status IN (
  'queued', 'scanning', 'request_created', 'files_moved',
  'dynamics_patched', 'status_flipped', 'completed', 'failed', 'cancelled'
));

-- 2) Server-assigned request number captured during Create (for SharePoint folder name)
ALTER TABLE submission_jobs ADD COLUMN IF NOT EXISTS akoya_requestnum TEXT;

-- 3) Two-phase claim: locked_until is the lease deadline; lease_token is a stable
--    per-claim identifier (NOT changed by lease renewal, only by a fresh claim).
ALTER TABLE submission_jobs ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;
ALTER TABLE submission_jobs ADD COLUMN IF NOT EXISTS lease_token  UUID;

-- 4) Drain claim index. Predicate is status-only (PG rejects volatile fns like now()
--    in index predicates); locked_until is in the indexed columns so the claim query's
--    "locked_until IS NULL OR locked_until < now()" filter is still index-eligible.
DROP INDEX IF EXISTS idx_submission_jobs_active_ready;
CREATE INDEX IF NOT EXISTS idx_submission_jobs_unlocked
  ON submission_jobs (next_attempt_at, locked_until, created_at)
  WHERE status NOT IN ('completed', 'failed', 'cancelled');

-- 5) Partial-unique rekey. Old (account_id, request_id, form_key) never collided
--    in single-phase; new (contact_oid, account_id, form_key) is belt-and-suspenders
--    against fresh-UUID duplicate-submit-from-different-tab. idempotency_key UNIQUE
--    remains the primary collision guard.
DROP INDEX IF EXISTS idx_submission_jobs_one_active_per_request;
CREATE UNIQUE INDEX IF NOT EXISTS idx_submission_jobs_one_active_per_contact_form
  ON submission_jobs (contact_oid, account_id, form_key)
  WHERE status NOT IN ('completed', 'failed', 'cancelled');

COMMIT;
```

Mirror the same shape in `scripts/setup-database.js` v30 inline block (status CHECK + new columns inline; old indexes replaced with new ones). The inline-block contract is "fresh install only" — existing pre-011 PG environments MUST apply the migration file separately (see "Apply mechanism" below).

**Apply mechanism (Codex round-9 §4):** This project has NO automated Postgres migration runner — migration files in `lib/db/migrations/*.sql` are reference-and-manual-apply documents. Fresh installs land directly in the post-011 shape via `node scripts/setup-database.js`. **Existing environments (dev Neon, prod Neon) must apply 011 manually:**

```bash
# Verify the migration is safe (dry-run inside BEGIN/ROLLBACK, no schema change persists):
DATABASE_URL='<unpooled-url>' node -e '
  const fs=require("fs"); const {Client}=require("pg");
  (async()=>{
    const c=new Client({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
    await c.connect();
    const sql=fs.readFileSync("lib/db/migrations/011_submission_jobs_states.sql","utf8")
      .replace(/^\s*BEGIN\s*;/im,"").replace(/\s*COMMIT\s*;\s*$/im,"");
    try { await c.query("BEGIN"); await c.query(sql); console.log("OK"); }
    finally { await c.query("ROLLBACK"); await c.end(); }
  })();
'

# Apply for real (Neon: paste the file contents into the Neon SQL editor, OR pipe via psql):
psql "$DATABASE_URL" -f lib/db/migrations/011_submission_jobs_states.sql

# Verify post-apply:
psql "$DATABASE_URL" -c "\d submission_jobs" | grep -E 'akoya_requestnum|locked_until|lease_token'
psql "$DATABASE_URL" -c "SELECT indexname FROM pg_indexes WHERE tablename='submission_jobs';"
```

Apply order for dev → prod: dev Neon first; smoke-test drain code (when it lands) against dev; only then prod Neon. Migration is idempotent and safe to re-run.

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
  - **`getSiteId` (throw sites at 150, 153, 168) — transitively upstream of every Graph op (called inside `getDriveId`); without this, allowlist-violation, URL-parse, and Graph-site-resolve failures all leak unstructured.**
  - **`getDriveId` (throw sites at 192, 215) — transitively upstream of `uploadFile`; allowlist-violation and drive-list failures leak unstructured.**
  - `uploadFile` (~line 613)
  - any other throw the drain touches (search, list, download)

Test coverage: a small `tests/lib/services/error-shape.test.js` that pokes each helper with a 404/429/500 mock and asserts `.status` / `.dataverseCode` / `.isTransient` attached; plus a no-response case (mocked `AbortError` + `ETIMEDOUT`) asserting `.noResponse === true`, `.causeKind` set, `.isTransient === true`.

This is a small but cross-cutting patch — roughly half-day. Necessary for the drain's `request_created` duplicate-PK detection AND for the `files_moved` / `dynamics_patched` retry classification.

### P2 — `contact.wmkf_portaloid` + alternate key (Codex round-1 §1.3)

**Status (S179, 2026-05-22): DEPLOYED to prod ✓**

Mini-deploy via `apply-dataverse-schema.js`:
- `contact.wmkf_portaloid` — String (max 50, schema name `wmkf_PortalOid`), nullable; logical name has no internal underscore per the S178 `wmkf_portal_membership` → `wmkf_portalmembership` convention rename.
- **Alternate key** `wmkf_portaloid` on `(wmkf_portaloid)` — Dataverse-side defense-in-depth for one-OID-per-contact. Naming matches the wave-2 alt-key precedent (alt-key schema name = single-column name), not the v6-draft `wmkf_PortalOid_AlternateKey` which didn't match the existing pattern.
- Catalog entry added to `docs/INTAKE_PORTAL_SCHEMA_CHANGES.md`.

Wave directory: `lib/dataverse/schema/wave4-followup/contact-portal-oid.json`. Run with `--wave=4-followup`. The apply script's `parseArgs` was extended to accept string-suffixed wave names (previously `parseInt`-only) so followup waves can live in their own directory without re-running parent-wave specs.

```bash
node scripts/apply-dataverse-schema.js --target=prod --wave=4-followup           # dry-run
node scripts/apply-dataverse-schema.js --target=prod --wave=4-followup --execute # apply
```

**Post-deploy verified live state:**
- Column: `contact.wmkf_portaloid` (schema=`wmkf_PortalOid`), AttributeType=String, MaxLength=50, RequiredLevel=None.
- Alternate key: `wmkf_portaloid` on `[wmkf_portaloid]`, `EntityKeyIndexStatus=Pending` immediately post-create — Dataverse builds the unique index asynchronously; transitions to `Active` in minutes. Uniqueness is only enforced once `Active`, so do NOT depend on the alt-key for the auth-bridge create-path race-protection guarantee until you re-probe and confirm `Active`.

### P3 — `intake_drafts` uniqueness redesign (schema + service patch) (Codex round-1 §2.3; round-2 §1.1, §3.1)

**Verified prerequisite knowledge:**
- Current `idx_intake_drafts_unique_no_request` is `UNIQUE (account_id, form_key) WHERE request_id IS NULL` — allows only one requestless draft per institution-form across ALL contacts.
- `lib/services/intake-draft-service.js:68` uses `ON CONFLICT (account_id, form_key) WHERE request_id IS NULL`. Migration alone breaks autosave.

**P3 has two parts, deployed together:**

**P3a — Migration `012_intake_drafts_uniqueness.sql` (plus matching `setup-database.js:687` inline update):**

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
# Pre-flight live-data probe: confirm no orphaned rows in 100000002-4 slots.
node scripts/probe-apprequestperson-role-data.js   # exits 0=CLEAR, 3=BLOCK

# Idempotent extender — skip-if-present logic at extend-apprequestperson-role-picklist.mjs:68.
# No --check flag; the script's "0 inserted this run" output IS the check.
node scripts/extend-apprequestperson-role-picklist.mjs
```

The extender is idempotent (`InsertOptionValue` skip-if-already-present), so re-running on an already-expanded picklist is safe.

**Acceptance:** GET on `wmkf_apprequestperson` EntityDefinitions returns OptionSet members with values `100000002`, `100000003`, `100000004` and matching display labels (`Senior Personnel`, `Key Personnel`, `Other`).

**Status (S179, 2026-05-22): VERIFIED ✓.** Picklist is fully expanded in prod (all 5 values present with correct labels). Live data probe re-run post-S178 deploy: 5,561 rows total, all in 100000000/100000001, none in 100000002-4 (CLEAR). P5 was completed as part of the S178 schema deploy (0 inserted on the S179 re-run).

### P4 — Dedicated private Blob store for applicant attachments (Codex round-2 §4.1)

The existing shared `BLOB_READ_WRITE_TOKEN` points at the public `phase-ii-summaries-blob` store (per CLAUDE.md). Applicant draft attachments contain budget detail, biosketches, personal info — they belong in a **private** store. Mirror the Dataverse Export pattern (`DVX_BLOB_RW_TOKEN` for `dvx-export-private`).

Per the Vercel CLI gotcha documented in CLAUDE.md for DVX: connecting a 2nd Blob store under a custom env-var name requires manual provisioning (create store via CLI, then read its token from the Vercel dashboard and `vercel env add INTAKE_BLOB_RW_TOKEN` per environment).

Provisioning steps:
1. `vercel blob create-store intake-applicant-private --access private` (CLI 54.x; the old `blob store add` subcommand was renamed)
2. **Decline** the "Would you like to link this blob store to <project>?" prompt — auto-link tries to set `BLOB_READ_WRITE_TOKEN`, which collides with the shared public store's token. (Same gotcha as DVX in CLAUDE.md.)
3. Read the token from the Vercel dashboard (Storage → store → `.env.local` tab → `BLOB_READ_WRITE_TOKEN` value)
4. `vercel env add INTAKE_BLOB_RW_TOKEN production` / `preview` / `development` — prompts for the value; paste the dashboard token each time
5. Add to `docs/CREDENTIALS_RUNBOOK.md` and CLAUDE.md (parallel to `DVX_BLOB_RW_TOKEN`)
6. Add a fail-loud check at intake-attach-endpoint startup: if `INTAKE_BLOB_RW_TOKEN` is unset and intake is enabled, refuse to start.

**Status (S180, 2026-05-23): DEPLOYED ✓.** Store `intake-applicant-private` created (id `store_Eaui32n6i2wYMS6E`, region `iad1`, access `private`). `INTAKE_BLOB_RW_TOKEN` set in production, preview, and development. Shared `BLOB_READ_WRITE_TOKEN` confirmed unchanged (100d-ago timestamp post-provisioning). Fail-loud startup check is build-time work, lands with `/api/intake/draft/attach`.

---

## Build pieces (revised sequencing)

After P0–P4, build sequence is:

### 1. Auth → contact bridge (`lib/services/contact-bridge-service.js`)

Phrasing per Codex round-1 §2.4 + round-2 §6.2 (confirmed clean):

- Read `session.user.contactOid` and `session.user.contactEmail` (set by the `entra-external` provider in `pages/api/auth/[...nextauth].js`)
- Query Dataverse: `contact?$filter=wmkf_portaloid eq '{contactOid}'` first
- If no match: fall back to `contact?$filter=emailaddress1 eq '{contactEmail}' and wmkf_portaloid eq null`
- If still no match: create a new contact with `wmkf_portaloid` set
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

#### Attachment upload — three-call dance

> **S184 contract amendments (authoritative — see `docs/INTAKE_ATTACH_BUILD_SCOPING.md` § Locked decisions + § Contract amendments A1–A7).** The S183 spec below is preserved for context; the amendments below supersede the conflicting bits. Implementation work in S184 follows the amended contract.
>
> - **Q1.** `pendingAttachments` lives in a **new top-level `pending_attachments JSONB` column** on `intake_drafts` (migration 013), **not** inside `draft_json`. Reason: `upsertDraftJson` (S183) overwrites `draft_json` wholesale, preserving only `idempotency_key`; an autosave between `/upload-token` and `/attach` would clobber the pending entry. The pre-issued Blob client-upload token uses `@vercel/blob` v2.3's `generateClientTokenFromReadWriteToken` (`pathname`, `maximumSizeInBytes`, `allowedContentTypes`, `validUntil`); the browser uses `put()` from `@vercel/blob/client`.
> - **A1.** `/api/intake/submit` MUST reject 409 (`pending_attachments_present`) if `intake_drafts.pending_attachments` is non-empty. Submit was originally said to be "unchanged" — the column was new at the time. Without this guard, submit can succeed mid-upload and orphan the pending Blob.
> - **A2.** `/attach` retry-after-success returns **`{status: 'already_attached', attachmentId}`** (HTTP 200), not a bare 404. The endpoint looks up `attachmentId` in BOTH `attachments[]` (already-promoted → short-circuit) and `pending_attachments[]` (still pending → run the normal scan flow). Genuinely-not-found returns 404 `pending_not_found`. Idempotency is server-side, not client-disambiguated.
> - **A3.** Audit row field split: `intake_audit.metadata` is queryable JSONB; `payload_digest` is the sha256 of a payload that is NEVER stored. Forensics-relevant fields (`attachmentId`, `draftId`, `fieldKey`, `pathname`, `sha256`, `size`, `scanner`, `scan_result`, `virusName`, `scannedAt`, `contentType`, `validUntil`) live in `metadata`. Only `filename` (potentially PII-bearing) is digested. The audit table at migration 005 has both slots; we use them for what they were designed for.
> - **A4.** All Blob calls in the new endpoints + sweep route through `lib/utils/intake-blob.js` `getIntakeBlobToken()` (reads `INTAKE_BLOB_RW_TOKEN`, fail-louds on missing). The SDK defaults to `BLOB_READ_WRITE_TOKEN` — silently hitting the wrong store is the failure mode this helper prevents.
> - **A5.** Blob pathname is **opaque**: `drafts/{draftId}/{attachmentId}` — no filename component. The original sanitized filename is returned to the browser in the `/upload-token` response, stored in `pending_attachments[].filename` / `attachments[].filename`, and digested under `payload` in audit rows. Decouples Blob storage from filename PII; lets `pathname` live safely in queryable `metadata`.
> - **A6.** Orphan sweep cutoff is **2h**, not 1h. The Blob token expires at 1h (prevents new PUTs), but the pending entry survives an additional hour so a slow `/attach` can still complete. After 2h the entry is genuinely abandoned; the Blob bytes are deleted.
> - **A7.** Scanner flag/key posture is a 2×2 table. `VIRUS_SCAN_ENABLED=false` → skip scan (`scanner:'skipped'`), happy path. `VIRUS_SCAN_ENABLED=true` + key present → run scan, map result. `VIRUS_SCAN_ENABLED=true` + key missing → fail-loud at endpoint startup; `/attach` returns 500 `scan_misconfigured`; pending entry intact. These are independent envvars and must be reasoned about as two distinct branches.
>
> The diagram + endpoint paragraphs below pre-date these amendments; treat the scoping doc as authoritative where they disagree.

The "Bytes never traverse the function on the upload path" constraint (`DESIGN.md` § File handling) means a single attach endpoint can't do the whole job. The flow is split into three calls so the browser does the bulk upload directly to Blob and the function only handles authorization, scanning, and metadata.

```
Browser                         Function                      Blob (private store)
   │                                │                                │
   │ 1. POST /upload-token          │                                │
   │    {draftId, filename,         │                                │
   │     contentType, fieldKey}     │                                │
   ├───────────────────────────────►│                                │
   │                                │  auth + membership + draft     │
   │                                │  ownership; mint               │
   │                                │  attachmentId = uuid();        │
   │                                │  derive pathname server-side;  │
   │                                │  append pendingAttachments[]   │
   │                                │  to draft.draft_json (atomic   │
   │                                │  via jsonb ||); mint Blob      │
   │                                │  client-upload token scoped    │
   │                                │  to exact pathname + maxBytes  │
   │ ◄──────────────────────────────┤                                │
   │  {attachmentId, token,         │                                │
   │   pathname}                    │                                │
   │                                │                                │
   │ 2. PUT bytes using token       │                                │
   ├───────────────────────────────────────────────────────────────►│
   │ ◄───────────────────────────────────────────────────────────────┤
   │                                │                                │
   │ 3. POST /attach                │                                │
   │    {draftId, attachmentId}     │                                │
   ├───────────────────────────────►│                                │
   │                                │  auth + membership + draft;    │
   │                                │  look up pending by            │
   │                                │  attachmentId; download bytes  │
   │                                │  from server-known pathname    │
   │                                ├───────────────────────────────►│
   │                                │ ◄──────────────────────────────┤
   │                                │  recompute sha256 + size;      │
   │                                │  magic-byte validate; check    │
   │                                │  size ≤ field max; scanBytes() │
   │                                │  branch:                       │
   │                                │   clean → remove pending,      │
   │                                │     append to attachments[];   │
   │                                │   infected → delete Blob,      │
   │                                │     audit, remove pending,422; │
   │                                │   misconfig → leave pending,500│
   │                                │   unavailable → leave pending, │
   │                                │     503 (retryable);           │
   │ ◄──────────────────────────────┤                                │
```

**`POST /api/intake/draft/upload-token`** — mint a scoped Blob client-upload token.
- Auth: applicant session; membership check (`account_id ∈` contact's approved memberships, any role — Contributor can upload to drafts).
- Draft ownership check: draft exists and `contact_oid` matches OR contact has membership for `account_id`.
- Mint `attachmentId = crypto.randomUUID()`.
- Derive **server-controlled** pathname: `drafts/{draftId}/{attachmentId}/{sanitizedFilename}`. Browser never picks the path.
- Look up `fieldKey` in `shared/forms/<cycle>/schema.js`; reject 400 if unknown. Use the field's `maxBytes` for the token's `maximumSizeInBytes`.
- Append to `draft_json.pendingAttachments[]` (atomic via `attachments = attachments || ...::jsonb` pattern in `IntakeDraftService`):
  ```json
  { "attachmentId": "<uuid>", "fieldKey": "<key>", "filename": "<sanitized>",
    "pathname": "drafts/<draftId>/<attachmentId>/<filename>",
    "createdAt": "<iso>" }
  ```
- Mint Vercel Blob client-upload token via `@vercel/blob/client` server SDK, scoped to that exact pathname + the field's maxBytes + 1h `validUntil`.
- Audit: `action: 'draft.upload_token.mint'`, payload `{draftId, attachmentId, fieldKey}`.
- Response: `{attachmentId, token, pathname}`.

**`POST /api/intake/draft/attach`** — finalize the upload after the browser's direct PUT completes.
- Auth: same shape as `upload-token`.
- Payload: **only** `{draftId, attachmentId}` — every other piece of metadata is server-derived. Per Codex round-7 finding MOD-5, the server treats no client metadata as trusted.
- Look up the pending entry in `draft_json.pendingAttachments[]` by `attachmentId`. If not found → 404 (`pending_not_found`). Possible causes: never minted, already attached (idempotent retry hit), expired and cleaned, or different draft.
- Download bytes from the server-known pathname using `INTAKE_BLOB_RW_TOKEN`. If the Blob doesn't exist → 409 (`bytes_not_uploaded`).
- Recompute `sha256` + `size` from the actual bytes (do not trust the client). Magic-byte validate via `lib/utils/file-magic.js` (extend extension allowlist beyond the current PDF/DOCX as needed for intake-portal field types — DOCX, XLSX, PDF for pilot).
- Cross-check `size ≤ field's maxBytes`. If exceeded → 413 (`size_exceeds_field_max`) + delete the Blob (sanity backstop; the token's `maximumSizeInBytes` should prevent this from happening).
- Gate on `isVirusScanEnabled()`. When off, skip scan; when on:
  - `scanBytes(bytes, filename)` from `lib/services/cloudmersive-scan.js`.
  - **clean** → atomic JSONB update: remove the pending entry, append to `attachments[]` with `{attachmentId, fieldKey, filename, pathname, blob_url, sha256, size, scan_result: 'clean', scanned_at, scanner}`. Audit `action: 'draft.attach'`. 200.
  - **infected** → delete the Blob (`del()` with `INTAKE_BLOB_RW_TOKEN`); write audit row with full metadata (`action: 'draft.attach_infected'`, payload `{attachmentId, filename, sha256, size, scanner, virusName, scannedAt}`); remove the pending entry; 422.
  - **scan_misconfigured** (cloudmersive 4xx, missing key) → leave pending entry intact; audit `action: 'draft.attach_scan_misconfigured'`; 500 with generic "scanner misconfigured, contact administrator" message. Operator fix unblocks retry.
  - **scan_unavailable** (cloudmersive 5xx/network exhaust) → leave pending entry intact; audit `action: 'draft.attach_scan_unavailable'`; 503 with retry-friendly message. Once Cloudmersive recovers, browser can re-POST `/attach` with the same `attachmentId`.
- When `VIRUS_SCAN_ENABLED` is off, the `'clean'` branch fires without the scan call; `scanner` field is set to `'skipped'` so the audit trail makes it explicit which uploads were unscanned.

**Why the pending entry stays on scan errors** — letting the applicant retry the attach call once the scanner recovers is preferable to making them re-upload (which would orphan the original Blob and burn their bandwidth). The bytes are already in Blob; only the metadata/scan step failed.

**Idempotency** — attach is idempotent on `attachmentId`, server-side. **(S184 A2)** A retry after a successful clean response finds the entry already in `attachments[]` and returns 200 `{status: 'already_attached', attachmentId}` — the client doesn't need to disambiguate. A retry during a scan error finds the entry still in `pending_attachments[]` and re-runs the download+scan; the Blob bytes haven't changed (the token only allows the original PUT), so the scan result is deterministic. Only a genuinely-unknown `attachmentId` returns 404 `pending_not_found`.

#### Orphan cleanup cron

The step-2-success / step-3-failure case happens (network drop, browser close, function timeout). Without sweeping, pending entries and their Blobs accumulate.

Add a daily handler in the existing maintenance cron:
- For each draft, walk the **`pending_attachments` column** (S184 Q1) for entries with `createdAt < now - 2h` (S184 A6 — 1h Blob token expiry + 1h safety margin so slow `/attach` calls don't get falsely 404'd by a sweep that races a legitimate-but-delayed retry).
- For each stale pending: attempt `del(pathname)` against the private Blob via `getIntakeBlobToken()` (S184 A4); ignore 404 (Blob may not exist if step 2 never completed). Remove from `pending_attachments[]`.
- Audit `action: 'draft.attach_orphan_swept'` per removed entry (S184 Q5 + A3 field split — `attachmentId`/`draftId`/`pathname` in `metadata`).

#### Doc cross-references

This three-call pattern reconciles two prior docs that read differently:
- `DESIGN.md` § "File handling" said "Bytes never traverse a Vercel Function" — true on the **upload** path (step 2), but the scan path (step 3) does download bytes into the function. DESIGN.md updated in S183 to acknowledge both.
- Earlier drafts of this drain plan described `/attach` as a single endpoint that streamed bytes — superseded by the three-call dance above.

The submit-strict validator at `validate.js:153` (`scan_result === 'clean'` check on every attachment in `attachments[]`) is unchanged. **(S184 A1)** `/api/intake/submit` ADDITIONALLY rejects with 409 `pending_attachments_present` if `intake_drafts.pending_attachments` is non-empty — otherwise submit can succeed mid-upload and orphan the in-flight Blob. The `scanning` state in the submission state machine remains a defense-in-depth re-verify — primary scan happens here, at attach time.

### 5. `/api/intake/submit`

- **Auth guard:** authenticated contact + `wmkf_role = 100000000 (Submitter)` for the target `account_id`
- **Payload validation:** form schema + budget math (the `$100K` multiple invariant per `BUDGET_FORM_SPEC.md:221,395`) + per-attachment **shape validator** (see below) + all attachments must be `scan_result: 'clean'`

  **Attachment-shape validator (Codex round-6 §5):** A malformed attachment object that happens to carry `scan_result: 'clean'` but is missing other fields can pass the clean check and fail later in `files_moved` (where the drain reads `blob_url`/`sha256`/`size`). Run a runtime shape check at BOTH submit-entry and drain-entry over each item in `draft_json.attachments`:

  ```js
  function validateAttachmentShape(att) {
    const required = ['filename', 'blob_url', 'sha256', 'size', 'scan_result'];
    for (const k of required) {
      if (att[k] === undefined || att[k] === null) {
        throw new Error(`attachment shape: missing ${k}`);
      }
    }
    if (!/^[a-f0-9]{64}$/i.test(att.sha256)) throw new Error('attachment shape: sha256 not 64-hex');
    if (typeof att.size !== 'number' || att.size <= 0) throw new Error('attachment shape: size not positive number');
    if (!['clean', 'infected', 'error'].includes(att.scan_result)) throw new Error('attachment shape: invalid scan_result');
    // blob_url is asserted non-empty above; we don't constrain its host here because the
    // Blob store URL format is provider-controlled and may change.
  }
  ```

  At submit-entry: fail-fast with 422 before INSERT (this is a normal user-facing validation error — applicant re-uploads).

  At drain-entry (start of `scanning` state): fail to `validation_400` terminal **AND write a `system_alerts` row of severity `error`** (Codex round-7 §4). Rationale: by the time the drain sees a malformed attachment, the submit-entry validator already passed — so this is corruption, hand-editing, or a code regression, not normal user error. The terminal-failed job and the alert together let an operator triage without surprise: applicant sees "submission failed, contact support"; operator sees the alert and can inspect the JSONB.

  Belt-and-suspenders: the validator at submit catches malformed drafts before they're frozen; the validator at drain catches anything that slipped past (corrupted JSONB, hand-edited test rows, schema changes mid-flight) and surfaces it as an operations-visible event rather than a silent user-facing terminal.
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
- **Terminal-collision handling** (Codex round-6 §1): the collision-returning pattern is correct for in-flight collisions (duplicate-submit-from-different-tab), but a collision against a row in terminal `failed` or `cancelled` state must NOT silently strand the applicant on the dead key. After the INSERT, inspect the returned `status`:
  - `status IN ('queued', 'scanning', 'request_created', 'files_moved', 'dynamics_patched', 'status_flipped', 'completed')` → return 200 with `{jobId, requestId, status}` as today.
  - `status IN ('failed', 'cancelled')` → return **409 Conflict** with `{error: 'previous_submission_terminal', priorStatus, priorJobId, lastError}`.

  **Draft rotation on 409 (Codex round-7 §2):** "new draft = new idempotency_key" is NOT automatic — the current `intake-draft-service.js:68` upsert is keyed by `(contact_oid, account_id, form_key)` (after P3) WHERE `request_id IS NULL`, so a user can only hold ONE active draft per institution-form combo at a time. The mechanism that breaks the collision is:

  1. **Draft list filtering:** `/apply` landing's "your in-progress drafts" query filters OUT drafts whose `draft_json.idempotency_key` matches a `submission_jobs` row with `status IN ('failed', 'cancelled')`. The terminal-tied draft is hidden from the user's normal entry path.
     ```sql
     SELECT d.* FROM intake_drafts d
     WHERE d.contact_oid = $1
       AND NOT EXISTS (
         SELECT 1 FROM submission_jobs j
         WHERE j.idempotency_key = (d.draft_json->>'idempotency_key')
           AND j.status IN ('failed', 'cancelled')
       )
     ORDER BY d.updated_at DESC;
     ```
  2. **Frontend on 409:** the 409 response triggers a one-shot UI that says "your last submission ended in <reason>" and offers a "Start a new submission" CTA → routes to `/apply/new` → creates a fresh `intake_drafts` row with a freshly-minted `idempotency_key` (the unique index on `(contact_oid, account_id, form_key) WHERE request_id IS NULL` permits this because the terminal-tied draft has `request_id` populated by then; see P3 + the request_id-on-submit step below).
  3. **request_id-on-submit:** `/api/intake/submit` populates `intake_drafts.request_id` with the generated request GUID **in the same transaction as the `submission_jobs` INSERT**. This moves the terminal-tied draft outside the partial-unique index, so step 2's fresh draft creation succeeds.
  4. **Cleanup (later):** an eventual cron purges drafts whose tied job is terminal AND older than N days; out of v1 scope, tracked in the risk register.

  The applicant's old failed draft is therefore *visible-on-purpose* only via a direct URL (audit/forensics path) and is *invisible* to the standard /apply flow. No auto-deletion; no destructive server-side action on 409.
  - Audit the 409 path with `action: 'submit.blocked_terminal'`, payload = `{priorJobId, priorStatus}`.
- Audit write (happy path): `action: 'submit'`, payload = `{jobId, requestId, accountId}`
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
  SET locked_until = now() + INTERVAL '10 minutes',
      lease_token = gen_random_uuid()         -- stable token for this claim's lifetime
  FROM claimable
  WHERE sj.id = claimable.id
  RETURNING sj.*;
COMMIT;
```

Phase 2 — process each claimed row independently. Each row's status transition is its own short transaction. **Lock renewal:** if a step is slow, drain bumps `locked_until` before doing the slow call — `lease_token` is NOT changed by renewal, only by a fresh claim. **Lock release on completion:** clear `locked_until` AND `lease_token`. **Crash recovery:** another worker picks the row up after the lease expires; the new claim writes a new `lease_token`, so any straggler UPDATE from the dead worker (guarded by its old token) will affect 0 rows.

**Lease renewal trigger (Codex round-7 §5):** renewal is NOT continuous; it happens at two well-defined points:

1. **Before each external HTTP call** (Dataverse POST/GET/PATCH, Graph upload, Cloudmersive scan): bump `locked_until = now() + DRAIN_LOCK_TTL_SECONDS`. The UPDATE is guarded by `lease_token` so a worker that's lost the lease won't accidentally extend someone else's claim.
2. **Inside long-running internal loops** (e.g. iterating budget-line POSTs in `dynamics_patched` — there can be 10–30 per submission): every Nth iteration (N=5 default) or when wall-clock since last renewal exceeds `DRAIN_LOCK_TTL_SECONDS / 3`.

Wrapper helper:

```js
async function withLeaseRenewal(job, fn) {
  await pg.query(
    `UPDATE submission_jobs SET locked_until = now() + ($1 || ' seconds')::INTERVAL
       WHERE id=$2 AND lease_token=$3`,
    [DRAIN_LOCK_TTL_SECONDS, job.id, job.lease_token]
  );
  return fn();
}
```

This is concrete enough that drain code can implement it deterministically; the alternative — continuous background `setInterval` renewal — adds an out-of-band write path that complicates crash semantics and is unnecessary for the pilot's traffic profile.

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

**Audit consistency model (Codex round-6 §4):** Every state-transition UPDATE on `submission_jobs` AND its companion `intake_audit` INSERT happen in **one short Postgres transaction**. If either fails, the entire transition is rolled back — the row stays in its prior state and the next cron tick retries. This avoids two divergence modes: (a) state advances but no audit row (silent gap in the audit trail); (b) audit says "advanced" but state didn't (audit lies). Implementation:

```js
await pg.query('BEGIN');
try {
  await pg.query(`UPDATE submission_jobs SET status=$1, ... WHERE id=$2 AND lease_token=$3`, [...]);
  await pg.query(`INSERT INTO intake_audit (action, payload, ...) VALUES (...)`, [...]);
  await pg.query('COMMIT');
} catch (err) {
  await pg.query('ROLLBACK');
  throw err;  // taxonomy classifier sees a structured pg error
}
```

Pg-side write failures feed into the retry taxonomy. **Explicit pg SQLSTATE mapping (Codex round-7 §3):**

| Pg error | SQLSTATE | Taxonomy category | Behavior |
|---|---|---|---|
| Deadlock detected | `40P01` | `pg_transient` | Retry with exponential backoff; max_attempts=10 |
| Serialization failure | `40001` | `pg_transient` | Retry with exponential backoff; max_attempts=10 |
| Connection failure (no response, pool exhausted) | `08000`/`08006`/no SQLSTATE on `ETIMEDOUT`/etc. | `network_no_response` | Retry with backoff; same as Dataverse/Graph timeouts |
| Unique-constraint violation | `23505` | `duplicate_pk` | State-specific recovery (see request_created); else success-advance |
| Check-constraint / not-null / etc. | `23xxx` (other) | `validation_400` | Terminal `failed` |

Wrap the pg client in `buildServiceError` / `buildNoResponseError` analogues so SQLSTATE is attached as `err.sqlState` and `err.isTransient = ['40P01','40001'].includes(err.sqlState) || err.noResponse`. Classifier reads this branch first when `err.serviceName === 'postgres'`.

Audit writes are NOT best-effort; the contract is "the audit table is the source of truth for what happened, and the state column is the source of truth for what to do next." **Transactional scope is state-transition audits only** — endpoint-level audits (`'submit'` from `/api/intake/submit`, `'bridge.conflict'` from the contact bridge, `'draft.upsert'` / `'draft.attach'` from the draft endpoints) are written outside the drain's transactional boundary and follow ordinary best-effort semantics (failure logs to `system_alerts` but does not block the user response). The boundary is: **drain-side audits = same txn as state UPDATE; endpoint-side audits = best-effort.**

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
  // Lease-aware update guarded by the STABLE lease_token (not locked_until, which mutates
  // on lease renewal). Two workers running this recovery in parallel can only both succeed
  // if they hold the same lease_token, which is impossible — re-claim issues a fresh UUID.
  const res = await pg.query(
    `UPDATE submission_jobs
        SET status='request_created', akoya_requestnum=$1, locked_until=NULL, lease_token=NULL
        WHERE id=$2 AND lease_token=$3`,
    [existing.akoya_requestnum, job.id, job.lease_token]
  );
  if (res.rowCount === 0) {
    // We lost the lease (lease expired AND another worker re-claimed). Re-read to
    // distinguish "advanced by other worker" (safe — terminal for this tick) from
    // "still queued" (something is wrong; surface for diagnosis).
    //
    // CRITICAL (Codex round-7 §1): accept any state at-or-after request_created, not
    // just request_created itself. Another worker could have completed recovery AND
    // advanced further (files_moved, dynamics_patched, status_flipped, completed)
    // before we got here. As long as akoya_requestnum is populated and status is
    // beyond queued/scanning, convergence has succeeded.
    const ADVANCED_STATES = new Set([
      'request_created', 'files_moved', 'dynamics_patched',
      'status_flipped', 'completed'
    ]);
    const current = await pg.query(
      `SELECT status, akoya_requestnum FROM submission_jobs WHERE id=$1`,
      [job.id]
    );
    const row = current.rows[0];
    if (row && ADVANCED_STATES.has(row.status) && row.akoya_requestnum) {
      return; // another worker completed recovery and may have advanced further; safe
    }
    throw buildServiceError('drain', { status: 500 },
      `request_created recovery: lost lease but row not advanced for ${job.id} (status=${row?.status})`);
  }
  return; // advance
}
```

This makes the boundary between Dataverse-side state and Postgres-side state explicit and
recoverable on either side of the crash, without any new schema or sentinel field. The
`lease_token` guard is the key difference from v4's first-pass timestamp guard: lease
renewal mutates `locked_until` but NOT `lease_token`, so a worker that renews mid-recovery
still owns the row. 0-rows-affected is now an unambiguous "another worker re-claimed" signal,
not a "your own renewal made your snapshot stale" false-negative.

**Cron protection:** `CRON_SECRET`.

**Cron registration (Codex round-6 §3, round-7 §5):** `/api/cron/drain-submissions` MUST be registered in `vercel.json` `crons:` array. Register **in the same commit as the route file lands** — registering an unregistered path in vercel.json would schedule 404s; landing the route without registration would never fire. Recommended schedule:

```jsonc
{
  "path": "/api/cron/drain-submissions",
  "schedule": "*/2 * * * *"   // every 2 minutes — well below the 10-min lease TTL
}
```

Cadence rationale:
- **Floor:** must be ≪ `DRAIN_LOCK_TTL_SECONDS` (600s) so an aborted worker's row is reclaimed promptly (≤2 cron firings after lease expiry).
- **Ceiling for happy-path UX:** applicant sees `queued` for up to one cron interval before drain pickup. 2 min is acceptable for the pilot (single-phase submissions are not real-time).
- **Vercel cron minimum on current plan:** 1 min. We use 2 min as a small buffer against thundering-herd if multiple cron firings overlap.

Worst-case happy-path latency for one submission: `cron interval (2 min) + 7 state transitions × (Dataverse/Graph round-trip ~1-3s)` ≈ **2-3 min**. With network retries, can extend to `2 min + DRAIN_MAX_ATTEMPTS × backoff`.

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
| `docs/INTAKE_PORTAL_SCHEMA_CHANGES.md` | The planned-but-deferred `phaseiisubmittedat`/`by` entries are obsolete; add the `contact.wmkf_portaloid` follow-up entry |
| `.claude-memory/slice0-deactivate-not-delete-recalc.md` | Reference Phase II status string in the lifecycle gate |
| `.claude-memory/project-intake-portal-skinny-scope.md` | Still frames pilot as Phase II Research; uses old `wmkf_portal_membership` name |
| `.claude-memory/project-slice0-scope.md` | 9-value enum (now 10) + old `wmkf_portal_membership` name + pre-deploy "doc-vs-catalog gap" framing for `contact.wmkf_portaloid` |

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
| R12 | Two contacts collide on same OID | **handled by P2** | Dataverse alternate key on `wmkf_portaloid` |
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

## Phase B deploy handoff — unpark BUILD-PENDING rows

The Phase A drain (shipped S180 commit `d09886f`) routes states without
handlers (`request_created`, `files_moved`, `dynamics_patched`,
`status_flipped`) to `parkBuildPending`, which pushes `next_attempt_at`
out by **1 hour** and clears the lease. Rationale: avoid burning cron
ticks while the next state's code is unimplemented; a deduped
`system_alerts` row keeps the parking visible to operators.

**The catch (Codex round-12 Q4):** when a Phase B state handler ships,
parked rows do not pick up on the next cron tick. They wait until their
1-hour `next_attempt_at` expires. They are not stuck (the row stays
non-terminal, the alert stays visible), but the deploy handoff needs an
explicit unpark step or a test submission will appear inert post-deploy.

**Unpark SQL — run right after each Phase B state handler deploys:**

```sql
-- Replace the target list with the state(s) the new handler now consumes.
-- The WHERE next_attempt_at > now() clause avoids touching rows that are
-- already ready; lease columns are belt-and-suspenders against an
-- in-flight worker (cleared by parkBuildPending but defensive anyway).
UPDATE submission_jobs
   SET next_attempt_at = now(),
       locked_until = NULL,
       lease_token = NULL
 WHERE status IN ('request_created')  -- or whatever ships
   AND next_attempt_at > now()
   AND status NOT IN ('completed', 'failed', 'cancelled');
```

**Verify after unpark:**

```sql
SELECT status, COUNT(*) FROM submission_jobs
 WHERE status NOT IN ('completed', 'failed', 'cancelled')
 GROUP BY status;
```

The deduped `intake_drain_build_pending` alert auto-resolves once no
rows hit the parking path on the next cron tick.

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

- [ ] **P0** applied to **dev Neon** (run `011_submission_jobs_states.sql` via `psql -f` or Neon SQL editor): status CHECK includes `request_created`; `akoya_requestnum` + `locked_until` + `lease_token` columns present; old indexes (`idx_submission_jobs_active_ready`, `idx_submission_jobs_one_active_per_request`) dropped; new indexes (`idx_submission_jobs_unlocked`, `idx_submission_jobs_one_active_per_contact_form`) present
- [ ] **P0** applied to **prod Neon** (post-dev-smoke-test): same verification queries; `setup-database.js:609` inline block already updated so fresh-install consumers are aligned
- [ ] **P1** applied: `createRecord` / `updateRecord` / `getRecord` / `queryRecords` (Dataverse) + `uploadFile` / etc. (Graph) all throw errors with `.status`, `.serviceName`, optional `.dataverseCode`; error-shape test passes
- [x] **P2** deployed (S179, 2026-05-22): `contact.wmkf_portaloid` column + alternate key `wmkf_portaloid` on prod; alt-key `EntityKeyIndexStatus` started `Pending` — re-probe and confirm `Active` before the auth-bridge build relies on Dataverse-side uniqueness enforcement
- [ ] **P3** applied: index rekeyed to `(contact_oid, account_id, form_key)`; `intake-draft-service.js` upsert uses matching conflict target; `setup-database.js:687` inline block updated; `smoke-intake-draft.js` passes
- [ ] **P4** provisioned: `intake-applicant-private` Blob store created; `INTAKE_BLOB_RW_TOKEN` set in production/preview/development; CREDENTIALS_RUNBOOK updated
- [x] **P5** verified (S179, 2026-05-22): `wmkf_apprequestperson.wmkf_role` option set includes `100000002` (Senior Personnel) / `100000003` (Key Personnel) / `100000004` (Other) in prod; `extend-apprequestperson-role-picklist.mjs` exits 0 with "0 inserted this run"; live-data probe CLEAR (5,561 rows, all in 100000000-1)
- [ ] Auth bridge: OID-first / email-fallback / conflict-routing behaves per spec; `intake_audit` action='bridge.conflict' on the conflict path
- [ ] Membership query returns approved+active+role; Submitter-only guard enforced at `/api/intake/submit`
- [ ] `/apply` skeleton: drafts list + new-submission flow click-through
- [ ] `/api/intake/draft` autosave + attach (synchronous Cloudmersive scan) round-trip; attachments record `scan_result: 'clean' | 'infected' | 'error'`
- [ ] `/api/intake/submit` returns `{jobId, requestId}` in <500ms with no Dataverse write; collision returns existing job's GUIDs via `DO UPDATE … RETURNING`
- [ ] `vercel.json` `crons:` array includes `/api/cron/drain-submissions` at `*/2 * * * *` (or chosen cadence, below lease TTL)
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
