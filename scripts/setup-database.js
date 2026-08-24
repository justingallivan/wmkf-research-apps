/**
 * Fresh-install database bootstrap.
 *
 * Run this script after setting up Vercel Postgres:
 *   node scripts/setup-database.js
 *
 * Prerequisites:
 * 1. Create Vercel Postgres database in Vercel Dashboard
 * 2. Pull environment variables: vercel env pull .env.local
 * 3. Run this script
 *
 * FRESH DATABASES ONLY. Existing environments must use:
 *   node scripts/apply-migrations.js
 *
 * The script refuses to run when the public schema already contains tables.
 * A deliberate bootstrap recovery may set ALLOW_POPULATED_DATABASE_SETUP=true,
 * but routine schema changes must never use that override.
 */

const fs = require('fs');
const path = require('path');
const { assertFreshDatabase } = require('./lib/database-bootstrap-guard');

// Load environment variables from .env.local
const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const [key, ...valueParts] = trimmed.split('=');
      if (key && valueParts.length > 0) {
        let value = valueParts.join('=');
        // Remove surrounding quotes if present
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        process.env[key] = value;
      }
    }
  });
  console.log('Loaded environment variables from .env.local');
} else {
  console.error('No .env.local file found. Run: vercel env pull .env.local');
  process.exit(1);
}

const { sql } = require('@vercel/postgres');

// Define SQL statements explicitly for reliable execution
const statements = [
  // Table: search_cache
  `CREATE TABLE IF NOT EXISTS search_cache (
    id SERIAL PRIMARY KEY,
    source VARCHAR(50) NOT NULL,
    query_hash VARCHAR(64) NOT NULL,
    query_text TEXT NOT NULL,
    results JSONB,
    result_count INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP,
    UNIQUE(source, query_hash)
  )`,

  // Indexes
  `CREATE INDEX IF NOT EXISTS idx_search_cache_lookup ON search_cache(source, query_hash)`,
  `CREATE INDEX IF NOT EXISTS idx_search_cache_expires ON search_cache(expires_at)`,
];

// V7: Grant cycles table and foreign keys
const v7Statements = [
  // Table: grant_cycles
  `CREATE TABLE IF NOT EXISTS grant_cycles (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    short_code VARCHAR(10),
    program_name VARCHAR(255),
    review_deadline DATE,
    summary_pages VARCHAR(50) DEFAULT '2',
    review_template_blob_url VARCHAR(500),
    review_template_filename VARCHAR(255),
    additional_attachments JSONB,
    custom_fields JSONB,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  // Indexes for grant_cycles
  `CREATE INDEX IF NOT EXISTS idx_grant_cycles_active ON grant_cycles(is_active)`,
  `CREATE INDEX IF NOT EXISTS idx_grant_cycles_created ON grant_cycles(created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_grant_cycles_short_code ON grant_cycles(short_code)`,
];

// V10: User profiles
// (user_preferences originally lived here too — migrated to Dataverse
// wmkf_appuserpreference in Wave 1; Postgres table dropped 2026-05-12.)
const v10Statements = [
  // Table: user_profiles
  `CREATE TABLE IF NOT EXISTS user_profiles (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE,
    display_name VARCHAR(255),
    avatar_color VARCHAR(7) DEFAULT '#6366f1',
    is_default BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_used_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,

  // Indexes
  `CREATE INDEX IF NOT EXISTS idx_user_profiles_active ON user_profiles(is_active)`,
  `CREATE INDEX IF NOT EXISTS idx_user_profiles_default ON user_profiles(is_default)`,
];

// V11: Azure AD authentication integration
const v11Alterations = [
  // Add Azure AD fields to user_profiles
  `ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS azure_id VARCHAR(255) UNIQUE`,
  `ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS azure_email VARCHAR(255)`,
  `ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP`,
  `ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS needs_linking BOOLEAN DEFAULT false`,
  // Index for Azure ID lookups
  `CREATE INDEX IF NOT EXISTS idx_user_profiles_azure_id ON user_profiles(azure_id)`,
  `CREATE INDEX IF NOT EXISTS idx_user_profiles_azure_email ON user_profiles(azure_email)`,
];

// V13: Applicant Integrity Screener tables
const v13Statements = [
  // Table: retractions (Retraction Watch data storage)
  `CREATE TABLE IF NOT EXISTS retractions (
    id SERIAL PRIMARY KEY,
    record_id VARCHAR(50) UNIQUE,
    title TEXT NOT NULL,
    authors TEXT NOT NULL,
    authors_normalized TEXT[],
    journal VARCHAR(500),
    publisher VARCHAR(255),
    subject VARCHAR(255),
    institution TEXT,
    country TEXT,
    retraction_date DATE,
    original_paper_doi VARCHAR(100),
    retraction_nature VARCHAR(100),
    retraction_reasons TEXT[],
    urls TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,

  // Table: integrity_screenings (screening history)
  `CREATE TABLE IF NOT EXISTS integrity_screenings (
    id SERIAL PRIMARY KEY,
    user_profile_id INTEGER REFERENCES user_profiles(id),
    screening_type VARCHAR(50) NOT NULL,
    screened_names JSONB NOT NULL,
    results JSONB,
    match_count INTEGER DEFAULT 0,
    status VARCHAR(50) DEFAULT 'pending',
    reviewed_at TIMESTAMP,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,

  // Table: screening_dismissals (false positive tracking)
  `CREATE TABLE IF NOT EXISTS screening_dismissals (
    id SERIAL PRIMARY KEY,
    screening_id INTEGER REFERENCES integrity_screenings(id) ON DELETE CASCADE,
    source VARCHAR(50) NOT NULL,
    source_identifier TEXT,
    screened_name VARCHAR(255) NOT NULL,
    dismissal_reason VARCHAR(100) NOT NULL,
    notes TEXT,
    dismissed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,

  // Indexes for retractions table
  `CREATE INDEX IF NOT EXISTS idx_retractions_authors_gin ON retractions USING GIN(authors_normalized)`,
  `CREATE INDEX IF NOT EXISTS idx_retractions_date ON retractions(retraction_date DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_retractions_record_id ON retractions(record_id)`,

  // Indexes for integrity_screenings
  `CREATE INDEX IF NOT EXISTS idx_integrity_screenings_user ON integrity_screenings(user_profile_id)`,
  `CREATE INDEX IF NOT EXISTS idx_integrity_screenings_status ON integrity_screenings(status)`,
  `CREATE INDEX IF NOT EXISTS idx_integrity_screenings_created ON integrity_screenings(created_at DESC)`,

  // Indexes for screening_dismissals
  `CREATE INDEX IF NOT EXISTS idx_screening_dismissals_screening ON screening_dismissals(screening_id)`,
  `CREATE INDEX IF NOT EXISTS idx_screening_dismissals_source ON screening_dismissals(source)`,
];

// V14: Dynamics Explorer tables
const v14Statements = [
  // Table: dynamics_user_roles
  `CREATE TABLE IF NOT EXISTS dynamics_user_roles (
    id SERIAL PRIMARY KEY,
    user_profile_id INTEGER REFERENCES user_profiles(id) UNIQUE,
    role VARCHAR(20) NOT NULL DEFAULT 'read_only',
    granted_by INTEGER REFERENCES user_profiles(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,

  // Table: dynamics_restrictions
  `CREATE TABLE IF NOT EXISTS dynamics_restrictions (
    id SERIAL PRIMARY KEY,
    table_name VARCHAR(255) NOT NULL,
    field_name VARCHAR(255),
    restriction_type VARCHAR(20) NOT NULL DEFAULT 'block',
    reason TEXT,
    created_by INTEGER REFERENCES user_profiles(id)
  )`,

  // Table: dynamics_query_log
  `CREATE TABLE IF NOT EXISTS dynamics_query_log (
    id SERIAL PRIMARY KEY,
    user_profile_id INTEGER REFERENCES user_profiles(id),
    session_id VARCHAR(100),
    query_type VARCHAR(50),
    table_name VARCHAR(255),
    query_params JSONB,
    record_count INTEGER,
    execution_time_ms INTEGER,
    request_id UUID,
    request_round SMALLINT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,

  // One lifecycle row per authenticated, body-valid Explorer request.
  `CREATE TABLE IF NOT EXISTS dynamics_explorer_requests (
    request_id UUID PRIMARY KEY,
    user_profile_id INTEGER REFERENCES user_profiles(id) ON DELETE SET NULL,
    session_id VARCHAR(100),
    outcome VARCHAR(24) NOT NULL DEFAULT 'running'
      CONSTRAINT dynamics_explorer_requests_outcome_check
      CHECK (outcome IN ('running', 'completed', 'truncated', 'max_rounds', 'refused', 'error', 'client_disconnected')),
    rounds_used SMALLINT NOT NULL DEFAULT 0
      CONSTRAINT dynamics_explorer_requests_rounds_check CHECK (rounds_used >= 0),
    model VARCHAR(100),
    stop_reason VARCHAR(50),
    error_stage VARCHAR(50),
    started_at TIMESTAMP NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMP,
    CONSTRAINT dynamics_explorer_requests_terminal_shape CHECK (
      (outcome = 'running' AND completed_at IS NULL)
      OR (outcome <> 'running' AND completed_at IS NOT NULL)
    )
  )`,

  // Indexes
  `CREATE INDEX IF NOT EXISTS idx_dynamics_user_roles_user ON dynamics_user_roles(user_profile_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_dynamics_restrictions_unique ON dynamics_restrictions(table_name, COALESCE(field_name, ''))`,
  `CREATE INDEX IF NOT EXISTS idx_dynamics_restrictions_table ON dynamics_restrictions(table_name)`,
  `CREATE INDEX IF NOT EXISTS idx_dynamics_query_log_user ON dynamics_query_log(user_profile_id)`,
  `CREATE INDEX IF NOT EXISTS idx_dynamics_query_log_session ON dynamics_query_log(session_id)`,
  `CREATE INDEX IF NOT EXISTS idx_dynamics_query_log_created ON dynamics_query_log(created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_dynamics_query_log_request_round ON dynamics_query_log(request_id, request_round) WHERE request_id IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_dynamics_explorer_requests_started ON dynamics_explorer_requests(started_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_dynamics_explorer_requests_outcome_started ON dynamics_explorer_requests(outcome, started_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_dynamics_explorer_requests_user_started ON dynamics_explorer_requests(user_profile_id, started_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_dynamics_explorer_requests_session ON dynamics_explorer_requests(session_id)`,
];

// V15: API usage logging for centralized key management
const v15Statements = [
  `CREATE TABLE IF NOT EXISTS api_usage_log (
    id SERIAL PRIMARY KEY,
    user_profile_id INTEGER REFERENCES user_profiles(id),
    app_name VARCHAR(50) NOT NULL,
    model VARCHAR(100),
    input_tokens INTEGER,
    output_tokens INTEGER,
    estimated_cost_cents NUMERIC(10,4),
    latency_ms INTEGER,
    request_status VARCHAR(20) DEFAULT 'success',
    error_message TEXT,
    stop_reason VARCHAR(50),
    request_id UUID,
    request_round SMALLINT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS idx_api_usage_user ON api_usage_log(user_profile_id)`,
  `CREATE INDEX IF NOT EXISTS idx_api_usage_app ON api_usage_log(app_name)`,
  `CREATE INDEX IF NOT EXISTS idx_api_usage_created ON api_usage_log(created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_api_usage_request_round ON api_usage_log(request_id, request_round) WHERE request_id IS NOT NULL`,
];

// V16 (user_app_access) and V17 (system_settings) migrated to Dataverse
// in Wave 1; Postgres tables dropped 2026-05-12. See migration 007.

// V19: System alerts, health check history, and maintenance runs
const v19Statements = [
  // Table: system_alerts — central alert store for all automated notifications
  `CREATE TABLE IF NOT EXISTS system_alerts (
    id SERIAL PRIMARY KEY,
    alert_type VARCHAR(50) NOT NULL,
    severity VARCHAR(20) NOT NULL DEFAULT 'info',
    title VARCHAR(500) NOT NULL,
    message TEXT,
    metadata JSONB,
    source VARCHAR(100),
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    auto_resolve_key VARCHAR(255),
    acknowledged_by INTEGER REFERENCES user_profiles(id),
    acknowledged_at TIMESTAMP,
    resolved_by INTEGER REFERENCES user_profiles(id),
    resolved_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,

  // Table: health_check_history — trend data for health monitoring
  `CREATE TABLE IF NOT EXISTS health_check_history (
    id SERIAL PRIMARY KEY,
    overall_status VARCHAR(20) NOT NULL,
    services JSONB NOT NULL,
    response_time_ms INTEGER,
    triggered_by VARCHAR(50) DEFAULT 'cron',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,

  // Table: maintenance_runs — audit trail for cleanup jobs
  `CREATE TABLE IF NOT EXISTS maintenance_runs (
    id SERIAL PRIMARY KEY,
    job_name VARCHAR(100) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'running',
    records_processed INTEGER DEFAULT 0,
    records_deleted INTEGER DEFAULT 0,
    details JSONB,
    error_message TEXT,
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP,
    duration_ms INTEGER
  )`,

  // Indexes for system_alerts
  `CREATE INDEX IF NOT EXISTS idx_system_alerts_status ON system_alerts(status)`,
  `CREATE INDEX IF NOT EXISTS idx_system_alerts_type ON system_alerts(alert_type)`,
  `CREATE INDEX IF NOT EXISTS idx_system_alerts_severity_status ON system_alerts(severity, status)`,
  `CREATE INDEX IF NOT EXISTS idx_system_alerts_created ON system_alerts(created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_system_alerts_auto_resolve ON system_alerts(auto_resolve_key) WHERE status = 'active'`,

  // Indexes for health_check_history
  `CREATE INDEX IF NOT EXISTS idx_health_history_created ON health_check_history(created_at DESC)`,

  // Indexes for maintenance_runs
  `CREATE INDEX IF NOT EXISTS idx_maintenance_runs_job ON maintenance_runs(job_name)`,
  `CREATE INDEX IF NOT EXISTS idx_maintenance_runs_created ON maintenance_runs(started_at DESC)`,
];

// V20: Dynamics restriction violation logging
const v20Alterations = [
  `ALTER TABLE dynamics_query_log ADD COLUMN IF NOT EXISTS was_denied BOOLEAN DEFAULT false`,
  `ALTER TABLE dynamics_query_log ADD COLUMN IF NOT EXISTS denial_reason TEXT`,
  `CREATE INDEX IF NOT EXISTS idx_dynamics_query_log_denied ON dynamics_query_log(was_denied) WHERE was_denied = true`,
];

// V21: Prompt cache token tracking on api_usage_log
const v21Alterations = [
  `ALTER TABLE api_usage_log ADD COLUMN IF NOT EXISTS cache_creation_tokens INTEGER DEFAULT 0`,
  `ALTER TABLE api_usage_log ADD COLUMN IF NOT EXISTS cache_read_tokens INTEGER DEFAULT 0`,
];

// V22 (rename proposal-summarizer → phase-ii-writeup on user_app_access)
// no longer applies — user_app_access dropped from Postgres in Wave 1.
// Equivalent rename was performed in Dataverse wmkf_appuserappaccesses directly.

// V23b: Dynamics Explorer feedback logging
const v23bStatements = [
  `CREATE TABLE IF NOT EXISTS dynamics_feedback (
    id SERIAL PRIMARY KEY,
    user_profile_id INTEGER REFERENCES user_profiles(id),
    session_id VARCHAR(100),
    feedback_type VARCHAR(20) NOT NULL,
    category VARCHAR(50),
    user_note TEXT,
    query_text TEXT,
    conversation_context JSONB,
    auto_detected BOOLEAN DEFAULT false,
    status VARCHAR(20) DEFAULT 'new',
    reviewed_by INTEGER REFERENCES user_profiles(id),
    reviewed_at TIMESTAMP,
    admin_note TEXT,
    request_id UUID REFERENCES dynamics_explorer_requests(request_id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS idx_dynamics_feedback_user ON dynamics_feedback(user_profile_id)`,
  `CREATE INDEX IF NOT EXISTS idx_dynamics_feedback_created ON dynamics_feedback(created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_dynamics_feedback_status ON dynamics_feedback(status)`,
  `CREATE INDEX IF NOT EXISTS idx_dynamics_feedback_session ON dynamics_feedback(session_id)`,
  `CREATE INDEX IF NOT EXISTS idx_dynamics_feedback_request ON dynamics_feedback(request_id) WHERE request_id IS NOT NULL`,
];

// V29: IRS exempt-organizations reference data (BMF extract).
// See migration 008_irs_exempt_orgs.sql. Reference data only — NOT wave-2
// migrate-eligible. Atomic-swap refresh by /api/cron/refresh-irs-bmf.
const v29Statements = [
  `CREATE TABLE IF NOT EXISTS irs_exempt_orgs (
    ein              VARCHAR(9)  PRIMARY KEY,
    name             TEXT NOT NULL,
    ico              TEXT,
    street           TEXT,
    city             TEXT,
    state            VARCHAR(2),
    zip              VARCHAR(10),
    group_exemption  VARCHAR(4),
    subsection       VARCHAR(2) NOT NULL,
    affiliation      VARCHAR(1),
    classification   VARCHAR(4),
    ruling_date      VARCHAR(6),
    deductibility    VARCHAR(1),
    foundation       VARCHAR(2),
    organization     VARCHAR(1),
    status           VARCHAR(2) NOT NULL,
    ntee_cd          VARCHAR(4),
    sort_name        TEXT,
    region           VARCHAR(1) NOT NULL,
    refresh_date     DATE NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_irs_exempt_orgs_state
     ON irs_exempt_orgs(state) WHERE state IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_irs_exempt_orgs_subsection_status
     ON irs_exempt_orgs(subsection, status)`,
];

// V30: Intake Portal submission jobs queue. See migrations 009_submission_jobs.sql
// (initial) and 011_submission_jobs_states.sql (drain plan v7 state-machine + lease
// expansion), plus docs/INTAKE_PORTAL_DRAIN_PLAN.md § P0. One row per submit click
// (idempotency-keyed); drained by /api/cron/drain-submissions.
//
// IMPORTANT (Codex round-8 §4): This inline block uses CREATE TABLE IF NOT EXISTS.
// On a FRESH database it lands the post-011 (v7) shape directly — no separate
// migration run needed. On an EXISTING database with the pre-011 shape (older
// status CHECK, no akoya_requestnum/locked_until/lease_token columns), the
// CREATE TABLE is SKIPPED entirely, and the subsequent index creates would fail
// against missing columns. setup-database.js does NOT carry ALTER TABLE / drop-
// recreate logic for backward compat — that is intentional, the script's contract
// is "fresh install only." Existing environments MUST apply migrations sequentially
// (see lib/db/migrations/011_submission_jobs_states.sql). Running setup-database.js
// against a stale-schema PG will produce an error on the index-create step rather
// than silently diverging the schema — this is the loud-failure design choice.
const v30Statements = [
  `CREATE TABLE IF NOT EXISTS submission_jobs (
    id                SERIAL PRIMARY KEY,
    idempotency_key   TEXT NOT NULL UNIQUE,
    draft_id          INTEGER REFERENCES intake_drafts(id) ON DELETE SET NULL,
    contact_oid       TEXT NOT NULL,
    account_id        TEXT NOT NULL,
    request_id        TEXT NOT NULL,
    akoya_requestnum  TEXT,                     -- server-assigned at request_created; for SharePoint folder name
    form_key          TEXT NOT NULL,
    status            TEXT NOT NULL DEFAULT 'queued',
    payload           JSONB NOT NULL,
    sharepoint_paths  JSONB NOT NULL DEFAULT '[]'::jsonb,
    dynamics_patches  JSONB NOT NULL DEFAULT '{}'::jsonb,
    attempts          INTEGER NOT NULL DEFAULT 0,
    last_error        TEXT,
    next_attempt_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    locked_until      TIMESTAMPTZ,              -- two-phase claim lease deadline
    lease_token       UUID,                     -- stable per-claim ID; untouched by renewal
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at      TIMESTAMPTZ,
    CONSTRAINT submission_jobs_status_check CHECK (status IN (
      'queued', 'scanning', 'request_created', 'files_moved', 'dynamics_patched',
      'status_flipped', 'completed', 'failed', 'cancelled'
    )),
    CONSTRAINT submission_jobs_attempts_nonneg CHECK (attempts >= 0),
    CONSTRAINT submission_jobs_completed_when_terminal CHECK (
      (status IN ('completed', 'failed', 'cancelled')) = (completed_at IS NOT NULL)
    )
  )`,
  // Drain claim query: WHERE status NOT IN terminal AND next_attempt_at <= now()
  //   AND (locked_until IS NULL OR locked_until < now()) ORDER BY next_attempt_at.
  // Predicate is status-only (PG rejects volatile fns like now() in index predicates);
  // locked_until is in the indexed columns so the WHERE clause is still index-eligible.
  `CREATE INDEX IF NOT EXISTS idx_submission_jobs_unlocked
     ON submission_jobs (next_attempt_at, locked_until, created_at)
     WHERE status NOT IN ('completed', 'failed', 'cancelled')`,
  // Belt-and-suspenders against fresh-UUID duplicate-submit-from-different-tab;
  // idempotency_key UNIQUE is the primary guard.
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_submission_jobs_one_active_per_contact_form
     ON submission_jobs (contact_oid, account_id, form_key)
     WHERE status NOT IN ('completed', 'failed', 'cancelled')`,
  `CREATE INDEX IF NOT EXISTS idx_submission_jobs_draft ON submission_jobs(draft_id)`,
  `CREATE INDEX IF NOT EXISTS idx_submission_jobs_request ON submission_jobs(request_id)`,
  `CREATE INDEX IF NOT EXISTS idx_submission_jobs_account ON submission_jobs(account_id)`,
  `CREATE INDEX IF NOT EXISTS idx_submission_jobs_contact ON submission_jobs(contact_oid)`,
  `CREATE INDEX IF NOT EXISTS idx_submission_jobs_status ON submission_jobs(status)`,
  `CREATE INDEX IF NOT EXISTS idx_submission_jobs_created ON submission_jobs(created_at DESC)`,
];

// V31: external-reviewer rate limiting (security audit A6).
// Fixed-window counters for /api/external/review/[token]/* — per-token and
// per-IP buckets. See migration 010_external_rate_limit.sql.
const v31Statements = [
  `CREATE TABLE IF NOT EXISTS external_rate_limit (
    bucket_key    TEXT NOT NULL,
    window_start  TIMESTAMPTZ NOT NULL,
    hit_count     INTEGER NOT NULL DEFAULT 0,
    invalid_count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (bucket_key, window_start)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_external_rate_limit_window
     ON external_rate_limit(window_start)`,
];

// V35: Reviewer acceptance follow-up jobs. Existing databases use
// migration 024_reviewer_acceptance_jobs.sql; this fresh-install block creates
// the same table directly.
const v35Statements = [
  `CREATE TABLE IF NOT EXISTS reviewer_acceptance_jobs (
    id              BIGSERIAL PRIMARY KEY,
    acceptance_key  TEXT NOT NULL UNIQUE,
    suggestion_id   UUID NOT NULL,
    request_id      UUID,
    reviewer_id     UUID,
    accepted_at     TIMESTAMPTZ NOT NULL,
    status          TEXT NOT NULL DEFAULT 'accept_pending',
    payload         JSONB NOT NULL,
    steps           JSONB NOT NULL DEFAULT '{}'::jsonb,
    attempts        INTEGER NOT NULL DEFAULT 0,
    last_error      TEXT,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    locked_until    TIMESTAMPTZ,
    lease_token     UUID,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at    TIMESTAMPTZ,
    CONSTRAINT reviewer_acceptance_jobs_status_check CHECK (status IN (
      'accept_pending', 'queued', 'completed', 'failed', 'cancelled'
    )),
    CONSTRAINT reviewer_acceptance_jobs_attempts_nonneg CHECK (attempts >= 0),
    CONSTRAINT reviewer_acceptance_jobs_completed_when_terminal CHECK (
      (status IN ('completed', 'failed', 'cancelled')) = (completed_at IS NOT NULL)
    )
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_reviewer_acceptance_jobs_suggestion_accepted
     ON reviewer_acceptance_jobs (suggestion_id, accepted_at)`,
  `CREATE INDEX IF NOT EXISTS idx_reviewer_acceptance_jobs_ready
     ON reviewer_acceptance_jobs (next_attempt_at, locked_until, created_at)
     WHERE status IN ('accept_pending', 'queued')`,
  `CREATE INDEX IF NOT EXISTS idx_reviewer_acceptance_jobs_suggestion
     ON reviewer_acceptance_jobs (suggestion_id)`,
  `CREATE INDEX IF NOT EXISTS idx_reviewer_acceptance_jobs_request
     ON reviewer_acceptance_jobs (request_id)`,
  `CREATE INDEX IF NOT EXISTS idx_reviewer_acceptance_jobs_status
     ON reviewer_acceptance_jobs (status)`,
  `CREATE INDEX IF NOT EXISTS idx_reviewer_acceptance_jobs_created
     ON reviewer_acceptance_jobs (created_at DESC)`,
];

// V36: durable reviewer-identity shadow comparison log. Existing databases
// use migration 026_reviewer_identity_shadow_log.sql; this fresh-install
// block creates the same table directly. candidate_key is a pseudonymous
// truncated hash; raw names, anchors, emails, and proposal content are omitted.
const v36Statements = [
  `CREATE TABLE IF NOT EXISTS reviewer_identity_shadow_log (
    id BIGSERIAL PRIMARY KEY,
    run_id TEXT,
    resolver_mode TEXT NOT NULL DEFAULT 'shadow',
    event_type TEXT NOT NULL DEFAULT 'comparison'
      CHECK (event_type IN ('comparison', 'error')),
    candidate_key TEXT,
    legacy_decision TEXT,
    works_decision TEXT,
    combined_decision TEXT,
    combined_reason TEXT,
    anchors_agree BOOLEAN,
    error_code TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_reviewer_identity_shadow_log_created
     ON reviewer_identity_shadow_log (created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_reviewer_identity_shadow_log_run
     ON reviewer_identity_shadow_log (run_id)`,
  `CREATE INDEX IF NOT EXISTS idx_reviewer_identity_shadow_log_delta
     ON reviewer_identity_shadow_log (created_at)
     WHERE legacy_decision IS DISTINCT FROM works_decision`,
];

// V37: Review synthesis generation ledger and automatic queue. Existing
// databases use migration 028_review_synthesis_jobs.sql; this fresh-install
// block creates the same table directly. Review text remains in Dataverse and
// is never copied into this ledger.
const v37Statements = [
  `CREATE TABLE IF NOT EXISTS review_synthesis_jobs (
    id                    BIGSERIAL PRIMARY KEY,
    generation_key        UUID NOT NULL UNIQUE,
    dedupe_key             TEXT NOT NULL UNIQUE,
    request_id             UUID NOT NULL,
    input_hash             TEXT NOT NULL,
    mode                   TEXT NOT NULL,
    status                 TEXT NOT NULL DEFAULT 'queued',
    acting_user_system_id  UUID,
    run_id                 TEXT,
    attempts               INTEGER NOT NULL DEFAULT 0,
    last_error             TEXT,
    next_attempt_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    locked_until           TIMESTAMPTZ,
    lease_token            UUID,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at             TIMESTAMPTZ,
    completed_at           TIMESTAMPTZ,
    CONSTRAINT review_synthesis_jobs_mode_check
      CHECK (mode IN ('automatic', 'manual')),
    CONSTRAINT review_synthesis_jobs_status_check
      CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
    CONSTRAINT review_synthesis_jobs_hash_check
      CHECK (input_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT review_synthesis_jobs_attempts_nonneg
      CHECK (attempts >= 0),
    CONSTRAINT review_synthesis_jobs_completed_when_terminal CHECK (
      (status IN ('completed', 'failed', 'cancelled')) = (completed_at IS NOT NULL)
    )
  )`,
  `CREATE INDEX IF NOT EXISTS idx_review_synthesis_jobs_ready
     ON review_synthesis_jobs (next_attempt_at, locked_until, created_at)
     WHERE status = 'queued'`,
  `CREATE INDEX IF NOT EXISTS idx_review_synthesis_jobs_request_latest
     ON review_synthesis_jobs (request_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_review_synthesis_jobs_request_hash_completed
     ON review_synthesis_jobs (request_id, input_hash, completed_at DESC)
     WHERE status = 'completed'`,
  `CREATE INDEX IF NOT EXISTS idx_review_synthesis_jobs_status
     ON review_synthesis_jobs (status)`,
];

// V38: Durable operational events (app-recorded failures/recoveries +
// selected Vercel Log Drain entries). Existing databases use migration
// 030_operational_events.sql; this fresh-install block creates the same
// table directly. Summaries are redacted and metadata is allowlisted before
// insert — no secrets, tokens, bodies, raw emails, IPs, or user agents.
const v38Statements = [
  `CREATE TABLE IF NOT EXISTS operational_events (
    id BIGSERIAL PRIMARY KEY,
    source TEXT NOT NULL
      CONSTRAINT operational_events_source_check
      CHECK (source IN ('app', 'vercel-drain')),
    environment TEXT,
    event_type TEXT NOT NULL,
    subsystem TEXT,
    severity TEXT NOT NULL
      CONSTRAINT operational_events_severity_check
      CHECK (severity IN ('info', 'warning', 'error', 'critical')),
    status TEXT NOT NULL DEFAULT 'open'
      CONSTRAINT operational_events_status_check
      CHECK (status IN ('open', 'recovered', 'resolved', 'superseded', 'info')),
    summary TEXT NOT NULL,
    stage TEXT,
    transient BOOLEAN,
    request_number TEXT,
    entity_refs JSONB,
    correlation_id TEXT,
    recovery_key TEXT,
    dedupe_key TEXT,
    metadata JSONB,
    occurrence_count INTEGER NOT NULL DEFAULT 1,
    first_occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status_changed_at TIMESTAMPTZ,
    resolved_by INTEGER REFERENCES user_profiles(id),
    resolution_note TEXT
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_operational_events_dedupe
     ON operational_events (dedupe_key) WHERE dedupe_key IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_operational_events_last_occurred
     ON operational_events (last_occurred_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_operational_events_status_severity
     ON operational_events (status, severity)`,
  `CREATE INDEX IF NOT EXISTS idx_operational_events_event_type
     ON operational_events (event_type)`,
  `CREATE INDEX IF NOT EXISTS idx_operational_events_request_number
     ON operational_events (request_number) WHERE request_number IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_operational_events_recovery_open
     ON operational_events (recovery_key) WHERE recovery_key IS NOT NULL AND status = 'open'`,
  `CREATE INDEX IF NOT EXISTS idx_operational_events_correlation
     ON operational_events (correlation_id) WHERE correlation_id IS NOT NULL`,
];

// V39: Private Blob staging ledger for browser-direct portal image uploads.
// Existing databases use migration 031_portal_upload_staging.sql; this fresh-
// install block creates the same ownership, lease, and idempotency contract.
const v39Statements = [
  `CREATE TABLE IF NOT EXISTS portal_upload_staging (
    id UUID PRIMARY KEY,
    scope TEXT NOT NULL CHECK (scope IN ('grantee_image', 'staff_grantee_image')),
    resource_id UUID NOT NULL,
    actor_binding TEXT NOT NULL,
    pathname TEXT NOT NULL UNIQUE,
    filename TEXT NOT NULL,
    declared_content_type TEXT NOT NULL,
    max_bytes BIGINT NOT NULL CHECK (max_bytes > 0),
    original_etag TEXT,
    status TEXT NOT NULL DEFAULT 'pending'
      CHECK (status IN ('pending', 'finalizing', 'consumed', 'rejected', 'expired')),
    lease_token UUID,
    lease_expires_at TIMESTAMPTZ,
    candidate_result JSONB,
    result_code TEXT,
    result_payload JSONB,
    blob_etag TEXT,
    sha256 CHAR(64),
    actual_bytes BIGINT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    CONSTRAINT portal_upload_staging_lease_shape CHECK (
      (status = 'finalizing' AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
      OR (status <> 'finalizing' AND lease_token IS NULL AND lease_expires_at IS NULL)
    ),
    CONSTRAINT portal_upload_staging_terminal_shape CHECK (
      (status = 'consumed' AND consumed_at IS NOT NULL AND result_code IS NOT NULL)
      OR (status <> 'consumed' AND consumed_at IS NULL)
    ),
    CONSTRAINT portal_upload_staging_sha256_shape CHECK (
      sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$'
    )
  )`,
  `CREATE INDEX IF NOT EXISTS idx_portal_upload_staging_actor_resource
     ON portal_upload_staging (actor_binding, scope, resource_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_portal_upload_staging_claim
     ON portal_upload_staging (status, lease_expires_at, expires_at)`,
  `CREATE INDEX IF NOT EXISTS idx_portal_upload_staging_cleanup
     ON portal_upload_staging (expires_at, status)`,
];

// V40: Frozen Pre-Site distribution orchestration ledger. Existing databases
// use migration 034_pre_site_distribution_attempts.sql; attachment bytes stay
// in SharePoint and email activities stay in Dynamics.
const v40Statements = [
  `CREATE TABLE IF NOT EXISTS pre_site_distribution_attempts (
    operation_id UUID PRIMARY KEY,
    request_id UUID NOT NULL,
    source_document_id UUID NOT NULL,
    source_drive_id TEXT,
    source_item_id TEXT,
    source_version_id TEXT,
    source_content_hash TEXT,
    source_byte_hash CHAR(64),
    source_filename TEXT,
    attachment_mode TEXT NOT NULL
      CONSTRAINT pre_site_distribution_mode_check
      CHECK (attachment_mode IN ('docx', 'pdf', 'both')),
    to_recipients JSONB NOT NULL,
    cc_recipients JSONB NOT NULL DEFAULT '[]'::jsonb,
    subject TEXT NOT NULL,
    body_text TEXT NOT NULL,
    body_html TEXT NOT NULL,
    from_email TEXT NOT NULL,
    acting_user_system_id UUID NOT NULL,
    draft_hash CHAR(64) NOT NULL,
    preview_hash CHAR(64),
    template_version TEXT NOT NULL,
    docx_snapshot_document_id UUID,
    docx_drive_id TEXT,
    docx_item_id TEXT,
    docx_version_id TEXT,
    docx_web_url TEXT,
    docx_filename TEXT,
    docx_content_type TEXT,
    docx_byte_hash CHAR(64),
    docx_size BIGINT,
    pdf_snapshot_document_id UUID,
    pdf_drive_id TEXT,
    pdf_item_id TEXT,
    pdf_version_id TEXT,
    pdf_web_url TEXT,
    pdf_filename TEXT,
    pdf_content_type TEXT,
    pdf_byte_hash CHAR(64),
    pdf_size BIGINT,
    dynamics_email_id UUID,
    dynamics_statecode INTEGER,
    dynamics_statuscode INTEGER,
    dynamics_senton TIMESTAMPTZ,
    state TEXT NOT NULL DEFAULT 'preparing'
      CONSTRAINT pre_site_distribution_state_check
      CHECK (state IN ('preparing', 'prepared', 'activity_created', 'attachments_added', 'send_requested', 'sent')),
    docx_attached_at TIMESTAMPTZ,
    pdf_attached_at TIMESTAMPTZ,
    send_requested_at TIMESTAMPTZ,
    sent_at TIMESTAMPTZ,
    attempt_count INTEGER NOT NULL DEFAULT 0
      CONSTRAINT pre_site_distribution_attempt_count_nonnegative
      CHECK (attempt_count >= 0),
    lease_token UUID,
    locked_until TIMESTAMPTZ,
    last_error_code TEXT,
    last_error_message TEXT,
    last_failed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT pre_site_distribution_recipient_shape
      CHECK (jsonb_typeof(to_recipients) = 'array' AND jsonb_array_length(to_recipients) > 0
      AND jsonb_typeof(cc_recipients) = 'array'),
    CONSTRAINT pre_site_distribution_hash_shape
      CHECK (draft_hash ~ '^[0-9a-f]{64}$'
      AND (preview_hash IS NULL OR preview_hash ~ '^[0-9a-f]{64}$')
      AND (source_byte_hash IS NULL OR source_byte_hash ~ '^[0-9a-f]{64}$')
      AND (docx_byte_hash IS NULL OR docx_byte_hash ~ '^[0-9a-f]{64}$')
      AND (pdf_byte_hash IS NULL OR pdf_byte_hash ~ '^[0-9a-f]{64}$')),
    CONSTRAINT pre_site_distribution_prepared_shape
      CHECK (state = 'preparing' OR (
      source_drive_id IS NOT NULL
      AND source_item_id IS NOT NULL
      AND source_version_id IS NOT NULL
      AND source_content_hash IS NOT NULL
      AND source_byte_hash IS NOT NULL
      AND preview_hash IS NOT NULL
      AND docx_snapshot_document_id IS NOT NULL
      AND docx_drive_id IS NOT NULL
      AND docx_item_id IS NOT NULL
      AND docx_version_id IS NOT NULL
      AND docx_filename IS NOT NULL
      AND docx_content_type IS NOT NULL
      AND docx_byte_hash IS NOT NULL
      AND docx_size > 0
      AND (attachment_mode = 'docx' OR (
        pdf_snapshot_document_id IS NOT NULL
        AND pdf_drive_id IS NOT NULL
        AND pdf_item_id IS NOT NULL
        AND pdf_version_id IS NOT NULL
        AND pdf_filename IS NOT NULL
        AND pdf_content_type IS NOT NULL
        AND pdf_byte_hash IS NOT NULL
        AND pdf_size > 0
      ))
    )),
    CONSTRAINT pre_site_distribution_lease_shape
      CHECK ((lease_token IS NULL AND locked_until IS NULL)
      OR (lease_token IS NOT NULL AND locked_until IS NOT NULL)),
    CONSTRAINT pre_site_distribution_sent_shape
      CHECK ((state = 'sent' AND dynamics_email_id IS NOT NULL
      AND send_requested_at IS NOT NULL AND sent_at IS NOT NULL) OR state <> 'sent')
  )`,
  `CREATE INDEX IF NOT EXISTS idx_pre_site_distribution_request_history
     ON pre_site_distribution_attempts (request_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_pre_site_distribution_source
     ON pre_site_distribution_attempts (source_document_id, source_version_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_pre_site_distribution_recovery
     ON pre_site_distribution_attempts (state, locked_until, updated_at)
     WHERE state <> 'sent'`,
];

// V32: model pricing audit history (S181).
// Monthly drift cron (/api/cron/pricing-refresh) writes one row per
// (model, token_type) per run. Compared against lib/utils/model-pricing.js;
// alerts on >5% delta. Backstop for the manually-maintained pricing table.
const v32Statements = [
  `CREATE TABLE IF NOT EXISTS model_pricing_audit (
    id                  SERIAL PRIMARY KEY,
    run_date            DATE NOT NULL,
    model               TEXT NOT NULL,
    token_type          TEXT NOT NULL,  -- 'input' | 'output' | 'cache_read' | 'cache_write_5m' | 'cache_write_1h'
    period_start        TIMESTAMPTZ NOT NULL,
    period_end          TIMESTAMPTZ NOT NULL,
    anthropic_cost_cents NUMERIC(14,4) NOT NULL,
    token_count         BIGINT NOT NULL,
    derived_cents_per_mtok NUMERIC(14,4),
    local_cents_per_mtok   NUMERIC(14,4),
    delta_pct           NUMERIC(8,4),   -- (derived - local) / local
    flagged             BOOLEAN NOT NULL DEFAULT false,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_model_pricing_audit_run ON model_pricing_audit(run_date DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_model_pricing_audit_model ON model_pricing_audit(model, token_type, run_date DESC)`,
];

// V28: Policy publish audit (append-only). See migration 006_policy_publish_audit.sql
// for full rationale. Dedicated Postgres table rather than overloading wmkf_ai_run.
const v28Statements = [
  `CREATE TABLE IF NOT EXISTS policy_publish_audit (
    id                SERIAL PRIMARY KEY,
    request_id        TEXT NOT NULL,
    slot_code         TEXT NOT NULL,
    parent_id         TEXT,
    version_label     TEXT NOT NULL,
    version_id        TEXT,
    prior_version_id  TEXT,
    title             TEXT NOT NULL,
    profile_id        INTEGER REFERENCES user_profiles(id),
    phase             TEXT NOT NULL CHECK (phase IN ('pending', 'final')),
    status            TEXT NOT NULL CHECK (status IN ('pending', 'completed', 'partial', 'already_published', 'concurrency_conflict', 'label_conflict', 'invalid_body', 'slot_not_provisioned', 'duplicate_slot_rows', 'audit_unavailable', 'failed')),
    outcome_json      JSONB,
    warnings_json     JSONB,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_policy_publish_audit_slot ON policy_publish_audit (slot_code, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_policy_publish_audit_request ON policy_publish_audit (request_id)`,
  `CREATE INDEX IF NOT EXISTS idx_policy_publish_audit_created ON policy_publish_audit (created_at DESC)`,
];

// V34: Prompt publish audit (append-only). See migration 019_prompt_publish_audit.sql
// for full rationale. Mirrors policy_publish_audit for wmkf_ai_prompt versioned
// publishes from the /admin prompt editor (S222).
const v34Statements = [
  `CREATE TABLE IF NOT EXISTS prompt_publish_audit (
    id                SERIAL PRIMARY KEY,
    request_id        TEXT NOT NULL,
    prompt_name       TEXT NOT NULL,
    target_version    INTEGER NOT NULL,
    new_prompt_id     TEXT,
    prior_prompt_id   TEXT,
    body_hash         TEXT,
    profile_id        INTEGER REFERENCES user_profiles(id),
    phase             TEXT NOT NULL CHECK (phase IN ('pending', 'final')),
    status            TEXT NOT NULL CHECK (status IN ('pending', 'completed', 'partial', 'already_published', 'concurrency_conflict', 'invalid_body', 'no_current_row', 'duplicate_current_rows', 'audit_unavailable', 'failed')),
    outcome_json      JSONB,
    warnings_json     JSONB,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (request_id, phase)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_prompt_publish_audit_name ON prompt_publish_audit (prompt_name, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_prompt_publish_audit_request ON prompt_publish_audit (request_id)`,
  `CREATE INDEX IF NOT EXISTS idx_prompt_publish_audit_created ON prompt_publish_audit (created_at DESC)`,
];

// V26: Intake Portal — draft staging + audit
const v26Statements = [
  `CREATE TABLE IF NOT EXISTS intake_drafts (
    id                   SERIAL PRIMARY KEY,
    contact_oid          TEXT NOT NULL,
    account_id           TEXT NOT NULL,
    request_id           TEXT,
    form_key             TEXT NOT NULL,
    draft_json           JSONB NOT NULL DEFAULT '{}'::jsonb,
    attachments          JSONB NOT NULL DEFAULT '[]'::jsonb,
    pending_attachments  JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  // V33 / migration 013: pending_attachments column for the three-call attach dance.
  // Mirrors the V26 base table for fresh installs; existing environments apply migration 013.
  `ALTER TABLE intake_drafts ADD COLUMN IF NOT EXISTS pending_attachments JSONB NOT NULL DEFAULT '[]'::jsonb`,
  `COMMENT ON COLUMN intake_drafts.pending_attachments IS 'In-flight attachment uploads (three-call dance). Server-managed; never overwritten by autosave. See docs/INTAKE_ATTACH_BUILD_SCOPING.md § Q1 + A5 + A6.'`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_intake_drafts_unique_with_request
     ON intake_drafts (account_id, request_id, form_key)
     WHERE request_id IS NOT NULL`,
  // Migration 012 (P3, v7): requestless drafts are contact-scoped. The single-phase
  // pivot makes this branch dominant, so two applicants at the same institution must
  // be able to hold active drafts for the same form independently.
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_intake_drafts_unique_no_request
     ON intake_drafts (contact_oid, account_id, form_key)
     WHERE request_id IS NULL`,
  `CREATE INDEX IF NOT EXISTS idx_intake_drafts_contact_oid ON intake_drafts(contact_oid)`,
  `CREATE INDEX IF NOT EXISTS idx_intake_drafts_account ON intake_drafts(account_id)`,
  `CREATE INDEX IF NOT EXISTS idx_intake_drafts_request ON intake_drafts(request_id)`,
  `CREATE INDEX IF NOT EXISTS idx_intake_drafts_updated ON intake_drafts(updated_at DESC)`,
  `CREATE TABLE IF NOT EXISTS intake_audit (
    id              BIGSERIAL PRIMARY KEY,
    actor_oid       TEXT,
    actor_type      TEXT NOT NULL,
    action          TEXT NOT NULL,
    target_entity   TEXT,
    target_id       TEXT,
    payload_digest  TEXT,
    metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
    ip_address      INET,
    user_agent      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_intake_audit_actor ON intake_audit(actor_oid)`,
  `CREATE INDEX IF NOT EXISTS idx_intake_audit_target ON intake_audit(target_entity, target_id)`,
  `CREATE INDEX IF NOT EXISTS idx_intake_audit_action ON intake_audit(action)`,
  `CREATE INDEX IF NOT EXISTS idx_intake_audit_created ON intake_audit(created_at DESC)`,
];

// V27: Dynamics identity reconciliation — link user_profiles to Dynamics systemuser
const v27Alterations = [
  `ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS dynamics_systemuser_id UUID`,
  `ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS dynamics_reconciled_at TIMESTAMP`,
  `CREATE INDEX IF NOT EXISTS idx_user_profiles_dynamics_systemuser_id ON user_profiles(dynamics_systemuser_id)`,
];

// V25: Expertise Finder tables
const v25Statements = [
  `CREATE TABLE IF NOT EXISTS expertise_roster (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    role_type VARCHAR(50) NOT NULL,
    role VARCHAR(255),
    affiliation VARCHAR(500),
    orcid VARCHAR(255),
    primary_fields TEXT,
    keywords TEXT,
    subfields_specialties TEXT,
    methods_techniques TEXT,
    distinctions TEXT,
    expertise TEXT,
    keck_affiliation VARCHAR(255),
    keck_affiliation_details TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by INTEGER REFERENCES user_profiles(id),
    updated_by INTEGER REFERENCES user_profiles(id)
  )`,
  `CREATE TABLE IF NOT EXISTS expertise_matches (
    id SERIAL PRIMARY KEY,
    user_profile_id INTEGER REFERENCES user_profiles(id),
    proposal_title TEXT,
    proposal_filename VARCHAR(255),
    proposal_text_hash VARCHAR(64),
    match_results JSONB,
    model_used VARCHAR(100),
    input_tokens INTEGER,
    output_tokens INTEGER,
    estimated_cost_cents NUMERIC(10,4),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS idx_expertise_roster_role_type ON expertise_roster(role_type)`,
  `CREATE INDEX IF NOT EXISTS idx_expertise_roster_active ON expertise_roster(is_active)`,
  `CREATE INDEX IF NOT EXISTS idx_expertise_roster_name ON expertise_roster(name)`,
  `CREATE INDEX IF NOT EXISTS idx_expertise_matches_user ON expertise_matches(user_profile_id)`,
  `CREATE INDEX IF NOT EXISTS idx_expertise_matches_created ON expertise_matches(created_at DESC)`,
];

// V24: Virtual Review Panel tables
const v24Statements = [
  `CREATE TABLE IF NOT EXISTS panel_reviews (
    id SERIAL PRIMARY KEY,
    user_profile_id INTEGER REFERENCES user_profiles(id),
    proposal_title TEXT,
    proposal_filename VARCHAR(255),
    proposal_text_hash VARCHAR(64),
    status VARCHAR(50) DEFAULT 'pending',
    current_stage VARCHAR(50),
    config JSONB,
    panel_summary JSONB,
    total_cost_cents NUMERIC(10,4),
    cost_breakdown JSONB,
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS panel_review_items (
    id SERIAL PRIMARY KEY,
    panel_review_id INTEGER REFERENCES panel_reviews(id) ON DELETE CASCADE,
    llm_provider VARCHAR(50) NOT NULL,
    llm_model VARCHAR(100) NOT NULL,
    stage VARCHAR(50) NOT NULL,
    status VARCHAR(50) DEFAULT 'pending',
    raw_response TEXT,
    parsed_response JSONB,
    input_tokens INTEGER,
    output_tokens INTEGER,
    estimated_cost_cents NUMERIC(10,4),
    latency_ms INTEGER,
    error_message TEXT,
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS idx_panel_reviews_user ON panel_reviews(user_profile_id)`,
  `CREATE INDEX IF NOT EXISTS idx_panel_reviews_status ON panel_reviews(status)`,
  `CREATE INDEX IF NOT EXISTS idx_panel_review_items_panel ON panel_review_items(panel_review_id)`,
  `CREATE INDEX IF NOT EXISTS idx_panel_review_items_provider ON panel_review_items(llm_provider, stage)`,
];

async function runMigration() {
  try {
    const existingTables = await sql`
      SELECT tablename
      FROM pg_catalog.pg_tables
      WHERE schemaname = 'public'
      ORDER BY tablename
      LIMIT 10
    `;
    assertFreshDatabase(
      existingTables.rows.map((row) => row.tablename),
      process.env.ALLOW_POPULATED_DATABASE_SETUP === 'true'
    );

    console.log('Starting fresh-install database bootstrap...');
    console.log(`Executing ${statements.length} SQL statements...\n`);

    // Run main table/index creation
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      const preview = statement.substring(0, 60).replace(/\s+/g, ' ');

      try {
        await sql.query(statement);
        console.log(`[${i + 1}/${statements.length}] ✓ ${preview}...`);
      } catch (error) {
        if (error.message.includes('already exists')) {
          console.log(`[${i + 1}/${statements.length}] ○ Already exists: ${preview}...`);
        } else {
          console.error(`[${i + 1}/${statements.length}] ✗ Error: ${error.message}`);
          throw error;
        }
      }
    }

    // Run V7 table creation (grant_cycles)
    console.log(`\nApplying v7 schema updates - grant cycles table (${v7Statements.length} statements)...`);
    for (let i = 0; i < v7Statements.length; i++) {
      const statement = v7Statements[i];
      const preview = statement.substring(0, 60).replace(/\s+/g, ' ');

      try {
        await sql.query(statement);
        console.log(`[v7-${i + 1}/${v7Statements.length}] ✓ ${preview}...`);
      } catch (error) {
        if (error.message.includes('already exists')) {
          console.log(`[v7-${i + 1}/${v7Statements.length}] ○ Already exists: ${preview}...`);
        } else {
          console.error(`[v7-${i + 1}/${v7Statements.length}] ✗ Error: ${error.message}`);
          throw error;
        }
      }
    }

    // Run V10 table creation (user profiles and preferences)
    console.log(`\nApplying v10 schema updates - user profiles table (${v10Statements.length} statements)...`);
    for (let i = 0; i < v10Statements.length; i++) {
      const statement = v10Statements[i];
      const preview = statement.substring(0, 60).replace(/\s+/g, ' ');

      try {
        await sql.query(statement);
        console.log(`[v10-${i + 1}/${v10Statements.length}] ✓ ${preview}...`);
      } catch (error) {
        if (error.message.includes('already exists')) {
          console.log(`[v10-${i + 1}/${v10Statements.length}] ○ Already exists: ${preview}...`);
        } else {
          console.error(`[v10-${i + 1}/${v10Statements.length}] ✗ Error: ${error.message}`);
          throw error;
        }
      }
    }

    // Run V11 column additions (Azure AD authentication)
    console.log(`\nApplying v11 schema updates - Azure AD authentication (${v11Alterations.length} alterations)...`);
    for (let i = 0; i < v11Alterations.length; i++) {
      const statement = v11Alterations[i];
      const preview = statement.substring(0, 60).replace(/\s+/g, ' ');

      try {
        await sql.query(statement);
        console.log(`[v11-${i + 1}/${v11Alterations.length}] ✓ ${preview}...`);
      } catch (error) {
        if (error.message.includes('already exists') || error.message.includes('duplicate column')) {
          console.log(`[v11-${i + 1}/${v11Alterations.length}] ○ Already exists: ${preview}...`);
        } else {
          console.error(`[v11-${i + 1}/${v11Alterations.length}] ✗ Error: ${error.message}`);
        }
      }
    }

    // Run V13 table creation (Applicant Integrity Screener)
    console.log(`\nApplying v13 schema updates - Integrity Screener tables (${v13Statements.length} statements)...`);
    for (let i = 0; i < v13Statements.length; i++) {
      const statement = v13Statements[i];
      const preview = statement.substring(0, 60).replace(/\s+/g, ' ');

      try {
        await sql.query(statement);
        console.log(`[v13-${i + 1}/${v13Statements.length}] ✓ ${preview}...`);
      } catch (error) {
        if (error.message.includes('already exists')) {
          console.log(`[v13-${i + 1}/${v13Statements.length}] ○ Already exists: ${preview}...`);
        } else {
          console.error(`[v13-${i + 1}/${v13Statements.length}] ✗ Error: ${error.message}`);
          throw error;
        }
      }
    }

    // Run V14 table creation (Dynamics Explorer)
    console.log(`\nApplying v14 schema updates - Dynamics Explorer tables (${v14Statements.length} statements)...`);
    for (let i = 0; i < v14Statements.length; i++) {
      const statement = v14Statements[i];
      const preview = statement.substring(0, 60).replace(/\s+/g, ' ');

      try {
        await sql.query(statement);
        console.log(`[v14-${i + 1}/${v14Statements.length}] ✓ ${preview}...`);
      } catch (error) {
        if (error.message.includes('already exists')) {
          console.log(`[v14-${i + 1}/${v14Statements.length}] ○ Already exists: ${preview}...`);
        } else {
          console.error(`[v14-${i + 1}/${v14Statements.length}] ✗ Error: ${error.message}`);
          throw error;
        }
      }
    }

    // Run V15 table creation (API usage logging)
    console.log(`\nApplying v15 schema updates - API usage logging (${v15Statements.length} statements)...`);
    for (let i = 0; i < v15Statements.length; i++) {
      const statement = v15Statements[i];
      const preview = statement.substring(0, 60).replace(/\s+/g, ' ');

      try {
        await sql.query(statement);
        console.log(`[v15-${i + 1}/${v15Statements.length}] ✓ ${preview}...`);
      } catch (error) {
        if (error.message.includes('already exists')) {
          console.log(`[v15-${i + 1}/${v15Statements.length}] ○ Already exists: ${preview}...`);
        } else {
          console.error(`[v15-${i + 1}/${v15Statements.length}] ✗ Error: ${error.message}`);
          throw error;
        }
      }
    }

    // V16 (user_app_access) and V17 (system_settings) were migrated to
    // Dataverse in Wave 1; both Postgres tables dropped 2026-05-12.
    // See migration 007_drop_wave1_tables.sql.

    // Run V19 table creation (System alerts, health history, maintenance runs)
    console.log(`\nApplying v19 schema updates - Alerts & monitoring (${v19Statements.length} statements)...`);
    for (let i = 0; i < v19Statements.length; i++) {
      const statement = v19Statements[i];
      const preview = statement.substring(0, 60).replace(/\s+/g, ' ');

      try {
        await sql.query(statement);
        console.log(`[v19-${i + 1}/${v19Statements.length}] ✓ ${preview}...`);
      } catch (error) {
        if (error.message.includes('already exists')) {
          console.log(`[v19-${i + 1}/${v19Statements.length}] ○ Already exists: ${preview}...`);
        } else {
          console.error(`[v19-${i + 1}/${v19Statements.length}] ✗ Error: ${error.message}`);
          throw error;
        }
      }
    }

    // Run V20 alterations (Dynamics restriction violation logging)
    console.log(`\nApplying v20 schema updates - Dynamics denial logging (${v20Alterations.length} statements)...`);
    for (let i = 0; i < v20Alterations.length; i++) {
      const statement = v20Alterations[i];
      const preview = statement.substring(0, 60).replace(/\s+/g, ' ');

      try {
        await sql.query(statement);
        console.log(`[v20-${i + 1}/${v20Alterations.length}] ✓ ${preview}...`);
      } catch (error) {
        if (error.message.includes('already exists')) {
          console.log(`[v20-${i + 1}/${v20Alterations.length}] ○ Already exists: ${preview}...`);
        } else {
          console.error(`[v20-${i + 1}/${v20Alterations.length}] ✗ Error: ${error.message}`);
        }
      }
    }

    // Run V21 alterations (Prompt cache token tracking)
    console.log(`\nApplying v21 schema updates - Prompt cache tokens (${v21Alterations.length} statements)...`);
    for (let i = 0; i < v21Alterations.length; i++) {
      const statement = v21Alterations[i];
      const preview = statement.substring(0, 60).replace(/\s+/g, ' ');

      try {
        await sql.query(statement);
        console.log(`[v21-${i + 1}/${v21Alterations.length}] ✓ ${preview}...`);
      } catch (error) {
        if (error.message.includes('already exists') || error.message.includes('duplicate column')) {
          console.log(`[v21-${i + 1}/${v21Alterations.length}] ○ Already exists: ${preview}...`);
        } else {
          console.error(`[v21-${i + 1}/${v21Alterations.length}] ✗ Error: ${error.message}`);
        }
      }
    }

    // V22 (rename on user_app_access) no longer applies — table dropped from
    // Postgres in Wave 1. Equivalent rename was applied in Dataverse directly.

    // Run V23b table creation (Dynamics feedback)
    console.log(`\nApplying v23b schema updates - Dynamics feedback (${v23bStatements.length} statements)...`);
    for (let i = 0; i < v23bStatements.length; i++) {
      const statement = v23bStatements[i];
      const preview = statement.substring(0, 60).replace(/\s+/g, ' ');

      try {
        await sql.query(statement);
        console.log(`[v23b-${i + 1}/${v23bStatements.length}] ✓ ${preview}...`);
      } catch (error) {
        if (error.message.includes('already exists')) {
          console.log(`[v23b-${i + 1}/${v23bStatements.length}] ○ Already exists: ${preview}...`);
        } else {
          console.error(`[v23b-${i + 1}/${v23bStatements.length}] ✗ Error: ${error.message}`);
          throw error;
        }
      }
    }

    // Run V24 table creation (Virtual Review Panel)
    console.log(`\nApplying v24 schema updates - Virtual Review Panel (${v24Statements.length} statements)...`);
    for (let i = 0; i < v24Statements.length; i++) {
      const statement = v24Statements[i];
      const preview = statement.substring(0, 60).replace(/\s+/g, ' ');

      try {
        await sql.query(statement);
        console.log(`[v24-${i + 1}/${v24Statements.length}] ✓ ${preview}...`);
      } catch (error) {
        if (error.message.includes('already exists')) {
          console.log(`[v24-${i + 1}/${v24Statements.length}] ○ Already exists: ${preview}...`);
        } else {
          console.error(`[v24-${i + 1}/${v24Statements.length}] ✗ Error: ${error.message}`);
          throw error;
        }
      }
    }

    // Run V25 table creation (Expertise Finder)
    console.log(`\nApplying v25 schema updates - Expertise Finder (${v25Statements.length} statements)...`);
    for (let i = 0; i < v25Statements.length; i++) {
      const statement = v25Statements[i];
      const preview = statement.substring(0, 60).replace(/\s+/g, ' ');

      try {
        await sql.query(statement);
        console.log(`[v25-${i + 1}/${v25Statements.length}] ✓ ${preview}...`);
      } catch (error) {
        if (error.message.includes('already exists')) {
          console.log(`[v25-${i + 1}/${v25Statements.length}] ○ Already exists: ${preview}...`);
        } else {
          console.error(`[v25-${i + 1}/${v25Statements.length}] ✗ Error: ${error.message}`);
          throw error;
        }
      }
    }

    // Run V26 table creation (Intake Portal)
    console.log(`\nApplying v26 schema updates - Intake Portal (${v26Statements.length} statements)...`);
    for (let i = 0; i < v26Statements.length; i++) {
      const statement = v26Statements[i];
      const preview = statement.substring(0, 60).replace(/\s+/g, ' ');

      try {
        await sql.query(statement);
        console.log(`[v26-${i + 1}/${v26Statements.length}] ✓ ${preview}...`);
      } catch (error) {
        if (error.message.includes('already exists')) {
          console.log(`[v26-${i + 1}/${v26Statements.length}] ○ Already exists: ${preview}...`);
        } else {
          console.error(`[v26-${i + 1}/${v26Statements.length}] ✗ Error: ${error.message}`);
          throw error;
        }
      }
    }

    // Run V27 alterations (Dynamics identity reconciliation)
    console.log(`\nApplying v27 schema updates - Dynamics identity reconciliation (${v27Alterations.length} statements)...`);
    for (let i = 0; i < v27Alterations.length; i++) {
      const statement = v27Alterations[i];
      const preview = statement.substring(0, 60).replace(/\s+/g, ' ');

      try {
        await sql.query(statement);
        console.log(`[v27-${i + 1}/${v27Alterations.length}] ✓ ${preview}...`);
      } catch (error) {
        if (error.message.includes('already exists') || error.message.includes('duplicate column')) {
          console.log(`[v27-${i + 1}/${v27Alterations.length}] ○ Already exists: ${preview}...`);
        } else {
          console.error(`[v27-${i + 1}/${v27Alterations.length}] ✗ Error: ${error.message}`);
          throw error;
        }
      }
    }

    // Run V28 table creation (Policy publish audit)
    console.log(`\nApplying v28 schema updates - Policy publish audit (${v28Statements.length} statements)...`);
    for (let i = 0; i < v28Statements.length; i++) {
      const statement = v28Statements[i];
      const preview = statement.substring(0, 60).replace(/\s+/g, ' ');

      try {
        await sql.query(statement);
        console.log(`[v28-${i + 1}/${v28Statements.length}] ✓ ${preview}...`);
      } catch (error) {
        if (error.message.includes('already exists')) {
          console.log(`[v28-${i + 1}/${v28Statements.length}] ○ Already exists: ${preview}...`);
        } else {
          console.error(`[v28-${i + 1}/${v28Statements.length}] ✗ Error: ${error.message}`);
          throw error;
        }
      }
    }

    // Run V34 table creation (Prompt publish audit)
    console.log(`\nApplying v34 schema updates - Prompt publish audit (${v34Statements.length} statements)...`);
    for (let i = 0; i < v34Statements.length; i++) {
      const statement = v34Statements[i];
      const preview = statement.substring(0, 60).replace(/\s+/g, ' ');

      try {
        await sql.query(statement);
        console.log(`[v34-${i + 1}/${v34Statements.length}] ✓ ${preview}...`);
      } catch (error) {
        if (error.message.includes('already exists')) {
          console.log(`[v34-${i + 1}/${v34Statements.length}] ○ Already exists: ${preview}...`);
        } else {
          console.error(`[v34-${i + 1}/${v34Statements.length}] ✗ Error: ${error.message}`);
          throw error;
        }
      }
    }

    // Run V29 table creation (IRS BMF reference data)
    console.log(`\nApplying v29 schema updates - IRS BMF reference data (${v29Statements.length} statements)...`);
    for (let i = 0; i < v29Statements.length; i++) {
      const statement = v29Statements[i];
      const preview = statement.substring(0, 60).replace(/\s+/g, ' ');

      try {
        await sql.query(statement);
        console.log(`[v29-${i + 1}/${v29Statements.length}] ✓ ${preview}...`);
      } catch (error) {
        if (error.message.includes('already exists')) {
          console.log(`[v29-${i + 1}/${v29Statements.length}] ○ Already exists: ${preview}...`);
        } else {
          console.error(`[v29-${i + 1}/${v29Statements.length}] ✗ Error: ${error.message}`);
          throw error;
        }
      }
    }

    // Run V30 table creation (Intake Portal submission jobs queue)
    console.log(`\nApplying v30 schema updates - Intake submission jobs queue (${v30Statements.length} statements)...`);
    for (let i = 0; i < v30Statements.length; i++) {
      const statement = v30Statements[i];
      const preview = statement.substring(0, 60).replace(/\s+/g, ' ');

      try {
        await sql.query(statement);
        console.log(`[v30-${i + 1}/${v30Statements.length}] ✓ ${preview}...`);
      } catch (error) {
        if (error.message.includes('already exists')) {
          console.log(`[v30-${i + 1}/${v30Statements.length}] ○ Already exists: ${preview}...`);
        } else {
          console.error(`[v30-${i + 1}/${v30Statements.length}] ✗ Error: ${error.message}`);
          throw error;
        }
      }
    }

    // Run V31 table creation (external-reviewer rate limiting — security audit A6)
    console.log(`\nApplying v31 schema updates - External-reviewer rate limiting (${v31Statements.length} statements)...`);
    for (let i = 0; i < v31Statements.length; i++) {
      const statement = v31Statements[i];
      const preview = statement.substring(0, 60).replace(/\s+/g, ' ');

      try {
        await sql.query(statement);
        console.log(`[v31-${i + 1}/${v31Statements.length}] ✓ ${preview}...`);
      } catch (error) {
        if (error.message.includes('already exists')) {
          console.log(`[v31-${i + 1}/${v31Statements.length}] ○ Already exists: ${preview}...`);
        } else {
          console.error(`[v31-${i + 1}/${v31Statements.length}] ✗ Error: ${error.message}`);
          throw error;
        }
      }
    }

    // Run V35 table creation (Reviewer acceptance follow-up jobs)
    console.log(`\nApplying v35 schema updates - Reviewer acceptance follow-up jobs (${v35Statements.length} statements)...`);
    for (let i = 0; i < v35Statements.length; i++) {
      const statement = v35Statements[i];
      const preview = statement.substring(0, 60).replace(/\s+/g, ' ');

      try {
        await sql.query(statement);
        console.log(`[v35-${i + 1}/${v35Statements.length}] ✓ ${preview}...`);
      } catch (error) {
        if (error.message.includes('already exists')) {
          console.log(`[v35-${i + 1}/${v35Statements.length}] ○ Already exists: ${preview}...`);
        } else {
          console.error(`[v35-${i + 1}/${v35Statements.length}] ✗ Error: ${error.message}`);
          throw error;
        }
      }
    }

    // Run V32 table creation (S181: model pricing audit history)
    console.log(`\nApplying v32 schema updates - Model pricing audit (${v32Statements.length} statements)...`);
    for (let i = 0; i < v32Statements.length; i++) {
      const statement = v32Statements[i];
      const preview = statement.substring(0, 60).replace(/\s+/g, ' ');
      try {
        await sql.query(statement);
        console.log(`[v32-${i + 1}/${v32Statements.length}] ✓ ${preview}...`);
      } catch (error) {
        if (error.message.includes('already exists')) {
          console.log(`[v32-${i + 1}/${v32Statements.length}] ○ Already exists: ${preview}...`);
        } else {
          console.error(`[v32-${i + 1}/${v32Statements.length}] ✗ Error: ${error.message}`);
          throw error;
        }
      }
    }

    // Run V36 table creation (reviewer identity shadow comparison log)
    console.log(`\nApplying v36 schema updates - Reviewer identity shadow log (${v36Statements.length} statements)...`);
    for (let i = 0; i < v36Statements.length; i++) {
      const statement = v36Statements[i];
      const preview = statement.substring(0, 60).replace(/\s+/g, ' ');
      try {
        await sql.query(statement);
        console.log(`[v36-${i + 1}/${v36Statements.length}] ✓ ${preview}...`);
      } catch (error) {
        if (error.message.includes('already exists')) {
          console.log(`[v36-${i + 1}/${v36Statements.length}] ○ Already exists: ${preview}...`);
        } else {
          console.error(`[v36-${i + 1}/${v36Statements.length}] ✗ Error: ${error.message}`);
          throw error;
        }
      }
    }

    // Run V37 table creation (review synthesis generation ledger)
    console.log(`\nApplying v37 schema updates - Review synthesis jobs (${v37Statements.length} statements)...`);
    for (let i = 0; i < v37Statements.length; i++) {
      const statement = v37Statements[i];
      const preview = statement.substring(0, 60).replace(/\s+/g, ' ');
      try {
        await sql.query(statement);
        console.log(`[v37-${i + 1}/${v37Statements.length}] ✓ ${preview}...`);
      } catch (error) {
        if (error.message.includes('already exists')) {
          console.log(`[v37-${i + 1}/${v37Statements.length}] ○ Already exists: ${preview}...`);
        } else {
          console.error(`[v37-${i + 1}/${v37Statements.length}] ✗ Error: ${error.message}`);
          throw error;
        }
      }
    }

    // Run V38 table creation (durable operational events)
    console.log(`\nApplying v38 schema updates - Operational events (${v38Statements.length} statements)...`);
    for (let i = 0; i < v38Statements.length; i++) {
      const statement = v38Statements[i];
      const preview = statement.substring(0, 60).replace(/\s+/g, ' ');
      try {
        await sql.query(statement);
        console.log(`[v38-${i + 1}/${v38Statements.length}] ✓ ${preview}...`);
      } catch (error) {
        if (error.message.includes('already exists')) {
          console.log(`[v38-${i + 1}/${v38Statements.length}] ○ Already exists: ${preview}...`);
        } else {
          console.error(`[v38-${i + 1}/${v38Statements.length}] ✗ Error: ${error.message}`);
          throw error;
        }
      }
    }

    // Run V39 table creation (private portal upload staging ledger)
    console.log(`\nApplying v39 schema updates - Portal upload staging (${v39Statements.length} statements)...`);
    for (let i = 0; i < v39Statements.length; i++) {
      const statement = v39Statements[i];
      const preview = statement.substring(0, 60).replace(/\s+/g, ' ');
      try {
        await sql.query(statement);
        console.log(`[v39-${i + 1}/${v39Statements.length}] ✓ ${preview}...`);
      } catch (error) {
        if (error.message.includes('already exists')) {
          console.log(`[v39-${i + 1}/${v39Statements.length}] ○ Already exists: ${preview}...`);
        } else {
          console.error(`[v39-${i + 1}/${v39Statements.length}] ✗ Error: ${error.message}`);
          throw error;
        }
      }
    }

    // Run V40 table creation (frozen Pre-Site distribution ledger)
    console.log(`\nApplying v40 schema updates - Pre-Site distribution attempts (${v40Statements.length} statements)...`);
    for (let i = 0; i < v40Statements.length; i++) {
      const statement = v40Statements[i];
      const preview = statement.substring(0, 60).replace(/\s+/g, ' ');
      try {
        await sql.query(statement);
        console.log(`[v40-${i + 1}/${v40Statements.length}] ✓ ${preview}...`);
      } catch (error) {
        if (error.message.includes('already exists')) {
          console.log(`[v40-${i + 1}/${v40Statements.length}] ○ Already exists: ${preview}...`);
        } else {
          console.error(`[v40-${i + 1}/${v40Statements.length}] ✗ Error: ${error.message}`);
          throw error;
        }
      }
    }

    console.log('\n✓ Database migration completed successfully!');
    console.log('\nTables created/updated:');
    console.log('  • search_cache (API search result caching)');
    console.log('\nV7 new table: grant_cycles');
    console.log('  • grant_cycles (id, name, short_code, program_name, review_deadline,');
    console.log('    summary_pages, review_template_blob_url, additional_attachments,');
    console.log('    custom_fields, is_active, created_at, updated_at)');
    console.log('\nV10 new table: user_profiles');
    console.log('  • user_profiles (id, name, display_name, avatar_color, is_default,');
    console.log('    is_active, created_at, last_used_at)');
    console.log('\nV11 column additions (Azure AD authentication):');
    console.log('  • user_profiles.azure_id (unique)');
    console.log('  • user_profiles.azure_email');
    console.log('  • user_profiles.last_login_at');
    console.log('  • user_profiles.needs_linking');
    console.log('\nV13 new tables (Integrity Screener):');
    console.log('  • retractions (Retraction Watch data storage)');
    console.log('  • integrity_screenings (screening history)');
    console.log('  • screening_dismissals (false positive tracking)');
    console.log('\nV14 new tables (Dynamics Explorer):');
    console.log('  • dynamics_user_roles (user role assignments)');
    console.log('  • dynamics_restrictions (table/field access restrictions)');
    console.log('  • dynamics_query_log (audit trail)');
    console.log('\nV15 new table (API usage logging):');
    console.log('  • api_usage_log (user_profile_id, app_name, model, input_tokens,');
    console.log('    output_tokens, estimated_cost_cents, latency_ms, request_status)');
    console.log('\nV19 new tables (Alerts & monitoring):');
    console.log('  • system_alerts (alert_type, severity, title, message, metadata,');
    console.log('    source, status, auto_resolve_key, acknowledged_by/at, resolved_by/at)');
    console.log('  • health_check_history (overall_status, services, response_time_ms, triggered_by)');
    console.log('  • maintenance_runs (job_name, status, records_processed, records_deleted,');
    console.log('    details, error_message, started_at, completed_at, duration_ms)');
    console.log('\nV20 column additions (Dynamics denial logging):');
    console.log('  • dynamics_query_log.was_denied');
    console.log('  • dynamics_query_log.denial_reason');
    console.log('\nV21 column additions (Prompt cache tracking):');
    console.log('  • api_usage_log.cache_creation_tokens');
    console.log('  • api_usage_log.cache_read_tokens');
    console.log('\nV24 new tables (Virtual Review Panel):');
    console.log('  • panel_reviews (multi-LLM review sessions)');
    console.log('  • panel_review_items (individual LLM reviews per stage)');
    console.log('\nV25 new tables (Expertise Finder):');
    console.log('  • expertise_roster (internal reviewer/consultant/board roster)');
    console.log('  • expertise_matches (AI matching history)');
    console.log('\nV26 new tables (Intake Portal):');
    console.log('  • intake_drafts (applicant draft staging — Postgres only, cleared on submit)');
    console.log('  • intake_audit (state-changing portal action audit trail)');
    console.log('\nV27 column additions (Dynamics identity reconciliation):');
    console.log('  • user_profiles.dynamics_systemuser_id');
    console.log('  • user_profiles.dynamics_reconciled_at');
    console.log('\nV30 new tables (Intake Portal submission jobs queue):');
    console.log('  • submission_jobs (async submission queue — idempotency-keyed, drained by cron)');
    console.log('\nV35 new tables (Reviewer acceptance follow-up jobs):');
    console.log('  • reviewer_acceptance_jobs (post-accept side-effect queue — drained by cron)');
    console.log('\nV37 new tables (Review synthesis generation jobs):');
    console.log('  • review_synthesis_jobs (automatic/manual generation ledger — drained by cron)');
    console.log('\nV39 new table (Private portal upload staging):');
    console.log('  • portal_upload_staging (actor-bound private Blob staging + finalize idempotency)');
    console.log('\nV40 new table (Frozen Pre-Site distribution):');
    console.log('  • pre_site_distribution_attempts (exact preview + Dynamics send recovery ledger)');
    console.log('\nIndexes created: 64 (plus 7 added in V30, 6 added in V35, 4 added in V37, 3 added in V39, 3 added in V40)');

  } catch (error) {
    console.error('\n✗ Migration failed:', error.message);
    process.exit(1);
  }
}

// Run migration
runMigration();
