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

  // Table: researchers
  `CREATE TABLE IF NOT EXISTS researchers (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    normalized_name VARCHAR(255),
    primary_affiliation VARCHAR(500),
    department VARCHAR(255),
    email VARCHAR(255),
    website VARCHAR(500),
    orcid VARCHAR(50),
    google_scholar_id VARCHAR(100),
    h_index INTEGER,
    i10_index INTEGER,
    total_citations INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_checked TIMESTAMP
  )`,

  // Table: publications
  `CREATE TABLE IF NOT EXISTS publications (
    id SERIAL PRIMARY KEY,
    researcher_id INTEGER REFERENCES researchers(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    authors TEXT[],
    author_position INTEGER,
    publication_date DATE,
    year INTEGER,
    journal VARCHAR(500),
    doi VARCHAR(100),
    pmid VARCHAR(50),
    pmcid VARCHAR(50),
    arxiv_id VARCHAR(50),
    citations INTEGER DEFAULT 0,
    abstract TEXT,
    source VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(doi)
  )`,

  // Table: researcher_keywords
  `CREATE TABLE IF NOT EXISTS researcher_keywords (
    id SERIAL PRIMARY KEY,
    researcher_id INTEGER REFERENCES researchers(id) ON DELETE CASCADE,
    keyword VARCHAR(255) NOT NULL,
    relevance_score FLOAT DEFAULT 1.0,
    source VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(researcher_id, keyword, source)
  )`,

  // Table: reviewer_suggestions
  `CREATE TABLE IF NOT EXISTS reviewer_suggestions (
    id SERIAL PRIMARY KEY,
    proposal_id VARCHAR(100) NOT NULL,
    proposal_title TEXT,
    researcher_id INTEGER REFERENCES researchers(id) ON DELETE CASCADE,
    relevance_score FLOAT,
    match_reason TEXT,
    sources TEXT[],
    suggested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    selected BOOLEAN DEFAULT FALSE,
    invited BOOLEAN DEFAULT FALSE,
    accepted BOOLEAN,
    notes TEXT,
    UNIQUE(proposal_id, researcher_id)
  )`,

  // ============================================
  // V2 NEW TABLE: proposal_searches
  // ============================================
  `CREATE TABLE IF NOT EXISTS proposal_searches (
    id SERIAL PRIMARY KEY,
    proposal_title TEXT,
    proposal_hash VARCHAR(64),
    author_institution VARCHAR(255),
    claude_suggestions JSONB,
    search_queries JSONB,
    verified_count INTEGER DEFAULT 0,
    discovered_count INTEGER DEFAULT 0,
    selected_candidates INTEGER[],
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,

  // Indexes
  `CREATE INDEX IF NOT EXISTS idx_search_cache_lookup ON search_cache(source, query_hash)`,
  `CREATE INDEX IF NOT EXISTS idx_search_cache_expires ON search_cache(expires_at)`,
  `CREATE INDEX IF NOT EXISTS idx_researchers_normalized ON researchers(normalized_name)`,
  `CREATE INDEX IF NOT EXISTS idx_researchers_email ON researchers(email)`,
  `CREATE INDEX IF NOT EXISTS idx_researchers_updated ON researchers(last_updated)`,
  `CREATE INDEX IF NOT EXISTS idx_researchers_orcid ON researchers(orcid)`,
  `CREATE INDEX IF NOT EXISTS idx_researchers_scholar_id ON researchers(google_scholar_id)`,
  `CREATE INDEX IF NOT EXISTS idx_publications_researcher ON publications(researcher_id)`,
  `CREATE INDEX IF NOT EXISTS idx_publications_date ON publications(publication_date DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_publications_doi ON publications(doi)`,
  `CREATE INDEX IF NOT EXISTS idx_keywords_researcher ON researcher_keywords(researcher_id)`,
  `CREATE INDEX IF NOT EXISTS idx_keywords_keyword ON researcher_keywords(keyword)`,
  `CREATE INDEX IF NOT EXISTS idx_suggestions_proposal ON reviewer_suggestions(proposal_id)`,
  `CREATE INDEX IF NOT EXISTS idx_suggestions_researcher ON reviewer_suggestions(researcher_id)`,
  `CREATE INDEX IF NOT EXISTS idx_proposal_searches_hash ON proposal_searches(proposal_hash)`,
  `CREATE INDEX IF NOT EXISTS idx_proposal_searches_created ON proposal_searches(created_at DESC)`,
];

// V2 column additions (run after tables exist)
const v2Alterations = [
  // Add google_scholar_url to researchers
  `ALTER TABLE researchers ADD COLUMN IF NOT EXISTS google_scholar_url VARCHAR(500)`,
  // Add orcid_url to researchers
  `ALTER TABLE researchers ADD COLUMN IF NOT EXISTS orcid_url VARCHAR(255)`,
  // Add metrics_updated_at to researchers
  `ALTER TABLE researchers ADD COLUMN IF NOT EXISTS metrics_updated_at TIMESTAMP`,
  // Add url to publications
  `ALTER TABLE publications ADD COLUMN IF NOT EXISTS url VARCHAR(500)`,
];

// V3 column additions for contact enrichment
const v3Alterations = [
  // Contact enrichment fields for researchers
  `ALTER TABLE researchers ADD COLUMN IF NOT EXISTS email_source VARCHAR(100)`,
  `ALTER TABLE researchers ADD COLUMN IF NOT EXISTS email_year INTEGER`,
  `ALTER TABLE researchers ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMP`,
  `ALTER TABLE researchers ADD COLUMN IF NOT EXISTS faculty_page_url VARCHAR(500)`,
  `ALTER TABLE researchers ADD COLUMN IF NOT EXISTS contact_enriched_at TIMESTAMP`,
  `ALTER TABLE researchers ADD COLUMN IF NOT EXISTS contact_enrichment_source VARCHAR(50)`,
  // Outreach tracking for reviewer_suggestions
  `ALTER TABLE reviewer_suggestions ADD COLUMN IF NOT EXISTS email_sent_at TIMESTAMP`,
  `ALTER TABLE reviewer_suggestions ADD COLUMN IF NOT EXISTS email_opened_at TIMESTAMP`,
  `ALTER TABLE reviewer_suggestions ADD COLUMN IF NOT EXISTS response_received_at TIMESTAMP`,
  `ALTER TABLE reviewer_suggestions ADD COLUMN IF NOT EXISTS response_type VARCHAR(50)`,
  // Additional indexes
  `CREATE INDEX IF NOT EXISTS idx_researchers_contact_enriched ON researchers(contact_enriched_at)`,
];

// V4 column additions for email generation feature
const v4Alterations = [
  // Add proposal_abstract to reviewer_suggestions for email generation
  `ALTER TABLE reviewer_suggestions ADD COLUMN IF NOT EXISTS proposal_abstract TEXT`,
  // Add PI information for email templates
  `ALTER TABLE reviewer_suggestions ADD COLUMN IF NOT EXISTS proposal_authors TEXT`,
  `ALTER TABLE reviewer_suggestions ADD COLUMN IF NOT EXISTS proposal_institution TEXT`,
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

const v7Alterations = [
  // Add grant_cycle_id FK to proposal_searches
  `ALTER TABLE proposal_searches ADD COLUMN IF NOT EXISTS grant_cycle_id INTEGER REFERENCES grant_cycles(id) ON DELETE SET NULL`,
  // Add grant_cycle_id FK to reviewer_suggestions
  `ALTER TABLE reviewer_suggestions ADD COLUMN IF NOT EXISTS grant_cycle_id INTEGER REFERENCES grant_cycles(id) ON DELETE SET NULL`,
  // Indexes for FK columns
  `CREATE INDEX IF NOT EXISTS idx_proposal_searches_cycle ON proposal_searches(grant_cycle_id)`,
  `CREATE INDEX IF NOT EXISTS idx_suggestions_cycle ON reviewer_suggestions(grant_cycle_id)`,
];

// V8: Add declined status for reviewer suggestions
const v8Alterations = [
  `ALTER TABLE reviewer_suggestions ADD COLUMN IF NOT EXISTS declined BOOLEAN DEFAULT FALSE`,
];

// V9: Add program_area for Keck Foundation programs
const v9Alterations = [
  `ALTER TABLE reviewer_suggestions ADD COLUMN IF NOT EXISTS program_area VARCHAR(100)`,
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

const v10Alterations = [
  // Add user_profile_id FK to proposal_searches
  `ALTER TABLE proposal_searches ADD COLUMN IF NOT EXISTS user_profile_id INTEGER REFERENCES user_profiles(id) ON DELETE SET NULL`,
  // Add user_profile_id FK to reviewer_suggestions
  `ALTER TABLE reviewer_suggestions ADD COLUMN IF NOT EXISTS user_profile_id INTEGER REFERENCES user_profiles(id) ON DELETE SET NULL`,
  // Indexes for FK columns
  `CREATE INDEX IF NOT EXISTS idx_proposal_searches_user ON proposal_searches(user_profile_id)`,
  `CREATE INDEX IF NOT EXISTS idx_reviewer_suggestions_user ON reviewer_suggestions(user_profile_id)`,
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

// V12: Researcher notes for tracking conflicts, preferences, etc.
const v12Alterations = [
  `ALTER TABLE researchers ADD COLUMN IF NOT EXISTS notes TEXT`,
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
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,

  // Indexes
  `CREATE INDEX IF NOT EXISTS idx_dynamics_user_roles_user ON dynamics_user_roles(user_profile_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_dynamics_restrictions_unique ON dynamics_restrictions(table_name, COALESCE(field_name, ''))`,
  `CREATE INDEX IF NOT EXISTS idx_dynamics_restrictions_table ON dynamics_restrictions(table_name)`,
  `CREATE INDEX IF NOT EXISTS idx_dynamics_query_log_user ON dynamics_query_log(user_profile_id)`,
  `CREATE INDEX IF NOT EXISTS idx_dynamics_query_log_session ON dynamics_query_log(session_id)`,
  `CREATE INDEX IF NOT EXISTS idx_dynamics_query_log_created ON dynamics_query_log(created_at DESC)`,
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
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS idx_api_usage_user ON api_usage_log(user_profile_id)`,
  `CREATE INDEX IF NOT EXISTS idx_api_usage_app ON api_usage_log(app_name)`,
  `CREATE INDEX IF NOT EXISTS idx_api_usage_created ON api_usage_log(created_at DESC)`,
];

// V16 (user_app_access) and V17 (system_settings) migrated to Dataverse
// in Wave 1; Postgres tables dropped 2026-05-12. See migration 007.

// V18: Review Manager columns on reviewer_suggestions
const v18Alterations = [
  // Proposal URL — shared link to full proposal, stored per-suggestion but updated in batch per proposal
  `ALTER TABLE reviewer_suggestions ADD COLUMN IF NOT EXISTS proposal_url VARCHAR(1000)`,
  // Materials email tracking
  `ALTER TABLE reviewer_suggestions ADD COLUMN IF NOT EXISTS materials_sent_at TIMESTAMP`,
  // Reminder tracking
  `ALTER TABLE reviewer_suggestions ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMP`,
  `ALTER TABLE reviewer_suggestions ADD COLUMN IF NOT EXISTS reminder_count INTEGER DEFAULT 0`,
  // Review receipt tracking
  `ALTER TABLE reviewer_suggestions ADD COLUMN IF NOT EXISTS review_received_at TIMESTAMP`,
  `ALTER TABLE reviewer_suggestions ADD COLUMN IF NOT EXISTS review_blob_url VARCHAR(500)`,
  `ALTER TABLE reviewer_suggestions ADD COLUMN IF NOT EXISTS review_filename VARCHAR(255)`,
  // Thank-you email tracking
  `ALTER TABLE reviewer_suggestions ADD COLUMN IF NOT EXISTS thankyou_sent_at TIMESTAMP`,
  // Review lifecycle status: accepted, materials_sent, under_review, review_received, complete
  `ALTER TABLE reviewer_suggestions ADD COLUMN IF NOT EXISTS review_status VARCHAR(50)`,
  // Password for accessing the proposal document (shared per proposal)
  `ALTER TABLE reviewer_suggestions ADD COLUMN IF NOT EXISTS proposal_password VARCHAR(255)`,
  // Index for review status filtering
  `CREATE INDEX IF NOT EXISTS idx_suggestions_review_status ON reviewer_suggestions(review_status)`,
];

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

// V23a: Add request_number to proposal_searches and reviewer_suggestions
const v23aAlterations = [
  `ALTER TABLE proposal_searches ADD COLUMN IF NOT EXISTS request_number VARCHAR(20)`,
  `ALTER TABLE reviewer_suggestions ADD COLUMN IF NOT EXISTS request_number VARCHAR(20)`,
  `CREATE INDEX IF NOT EXISTS idx_reviewer_suggestions_request ON reviewer_suggestions(request_number)`,
];

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
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS idx_dynamics_feedback_user ON dynamics_feedback(user_profile_id)`,
  `CREATE INDEX IF NOT EXISTS idx_dynamics_feedback_created ON dynamics_feedback(created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_dynamics_feedback_status ON dynamics_feedback(status)`,
  `CREATE INDEX IF NOT EXISTS idx_dynamics_feedback_session ON dynamics_feedback(session_id)`,
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

// V6 column additions for proposal summary attachments and Co-PI tracking
const v6Alterations = [
  // Summary page extraction - store extracted page(s) in Vercel Blob
  `ALTER TABLE proposal_searches ADD COLUMN IF NOT EXISTS summary_blob_url VARCHAR(500)`,
  `ALTER TABLE proposal_searches ADD COLUMN IF NOT EXISTS summary_filename VARCHAR(255)`,
  `ALTER TABLE proposal_searches ADD COLUMN IF NOT EXISTS summary_pages VARCHAR(50)`, // e.g., "2" or "1,2"
  // Full proposal blob URL (already uploaded via existing flow)
  `ALTER TABLE proposal_searches ADD COLUMN IF NOT EXISTS full_proposal_blob_url VARCHAR(500)`,
  // Co-PI information for email templates
  `ALTER TABLE proposal_searches ADD COLUMN IF NOT EXISTS co_investigators TEXT`, // comma-separated names
  `ALTER TABLE proposal_searches ADD COLUMN IF NOT EXISTS co_investigator_count INTEGER`,
  // Also add to reviewer_suggestions for email generation
  `ALTER TABLE reviewer_suggestions ADD COLUMN IF NOT EXISTS co_investigators TEXT`,
  `ALTER TABLE reviewer_suggestions ADD COLUMN IF NOT EXISTS co_investigator_count INTEGER`,
  // Summary blob URL in reviewer_suggestions (for My Candidates email generation)
  `ALTER TABLE reviewer_suggestions ADD COLUMN IF NOT EXISTS summary_blob_url VARCHAR(500)`,
];

// V5 data migration: merge duplicate proposals based on title
async function mergeDuplicateProposals() {
  console.log('\nChecking for duplicate proposals to merge...');

  // Find proposals with duplicate titles
  const duplicates = await sql`
    SELECT proposal_title, array_agg(DISTINCT proposal_id) as proposal_ids, COUNT(DISTINCT proposal_id) as count
    FROM reviewer_suggestions
    WHERE proposal_title IS NOT NULL
    GROUP BY proposal_title
    HAVING COUNT(DISTINCT proposal_id) > 1
  `;

  if (duplicates.rows.length === 0) {
    console.log('  No duplicate proposals found.');
    return;
  }

  console.log(`  Found ${duplicates.rows.length} proposal(s) with duplicate entries.`);

  for (const row of duplicates.rows) {
    const title = row.proposal_title;
    const proposalIds = row.proposal_ids;

    // Generate canonical proposal ID from title
    const canonicalId = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').substring(0, 50);

    console.log(`  Merging ${proposalIds.length} entries for: "${title.substring(0, 40)}..."`);
    console.log(`    New ID: ${canonicalId}`);

    // First, delete duplicate researcher entries for the same title
    // Keep only the most recent entry for each researcher
    await sql`
      DELETE FROM reviewer_suggestions
      WHERE id NOT IN (
        SELECT DISTINCT ON (researcher_id) id
        FROM reviewer_suggestions
        WHERE proposal_title = ${title}
        ORDER BY researcher_id, suggested_at DESC
      )
      AND proposal_title = ${title}
    `;

    // Now update all remaining entries to use the canonical ID
    await sql`
      UPDATE reviewer_suggestions
      SET proposal_id = ${canonicalId}
      WHERE proposal_title = ${title}
    `;
  }

  console.log('  Duplicate proposals merged successfully.');
}

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

    // Run V2 column additions
    console.log(`\nApplying v2 schema updates (${v2Alterations.length} alterations)...`);
    for (let i = 0; i < v2Alterations.length; i++) {
      const statement = v2Alterations[i];
      const preview = statement.substring(0, 60).replace(/\s+/g, ' ');

      try {
        await sql.query(statement);
        console.log(`[v2-${i + 1}/${v2Alterations.length}] ✓ ${preview}...`);
      } catch (error) {
        if (error.message.includes('already exists') || error.message.includes('duplicate column')) {
          console.log(`[v2-${i + 1}/${v2Alterations.length}] ○ Already exists: ${preview}...`);
        } else {
          console.error(`[v2-${i + 1}/${v2Alterations.length}] ✗ Error: ${error.message}`);
          // Don't throw on alter table errors - continue with other alterations
        }
      }
    }

    // Run V3 column additions (contact enrichment)
    console.log(`\nApplying v3 schema updates - contact enrichment (${v3Alterations.length} alterations)...`);
    for (let i = 0; i < v3Alterations.length; i++) {
      const statement = v3Alterations[i];
      const preview = statement.substring(0, 60).replace(/\s+/g, ' ');

      try {
        await sql.query(statement);
        console.log(`[v3-${i + 1}/${v3Alterations.length}] ✓ ${preview}...`);
      } catch (error) {
        if (error.message.includes('already exists') || error.message.includes('duplicate column')) {
          console.log(`[v3-${i + 1}/${v3Alterations.length}] ○ Already exists: ${preview}...`);
        } else {
          console.error(`[v3-${i + 1}/${v3Alterations.length}] ✗ Error: ${error.message}`);
          // Don't throw on alter table errors - continue with other alterations
        }
      }
    }

    // Run V4 column additions (email generation)
    console.log(`\nApplying v4 schema updates - email generation (${v4Alterations.length} alterations)...`);
    for (let i = 0; i < v4Alterations.length; i++) {
      const statement = v4Alterations[i];
      const preview = statement.substring(0, 60).replace(/\s+/g, ' ');

      try {
        await sql.query(statement);
        console.log(`[v4-${i + 1}/${v4Alterations.length}] ✓ ${preview}...`);
      } catch (error) {
        if (error.message.includes('already exists') || error.message.includes('duplicate column')) {
          console.log(`[v4-${i + 1}/${v4Alterations.length}] ○ Already exists: ${preview}...`);
        } else {
          console.error(`[v4-${i + 1}/${v4Alterations.length}] ✗ Error: ${error.message}`);
          // Don't throw on alter table errors - continue with other alterations
        }
      }
    }

    // Run V5 data migration (merge duplicate proposals)
    await mergeDuplicateProposals();

    // Run V6 column additions (proposal summary attachments & Co-PI)
    console.log(`\nApplying v6 schema updates - summary attachments & Co-PI (${v6Alterations.length} alterations)...`);
    for (let i = 0; i < v6Alterations.length; i++) {
      const statement = v6Alterations[i];
      const preview = statement.substring(0, 60).replace(/\s+/g, ' ');

      try {
        await sql.query(statement);
        console.log(`[v6-${i + 1}/${v6Alterations.length}] ✓ ${preview}...`);
      } catch (error) {
        if (error.message.includes('already exists') || error.message.includes('duplicate column')) {
          console.log(`[v6-${i + 1}/${v6Alterations.length}] ○ Already exists: ${preview}...`);
        } else {
          console.error(`[v6-${i + 1}/${v6Alterations.length}] ✗ Error: ${error.message}`);
          // Don't throw on alter table errors - continue with other alterations
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

    // Run V7 column additions (FK columns)
    console.log(`\nApplying v7 schema updates - grant cycle FK columns (${v7Alterations.length} alterations)...`);
    for (let i = 0; i < v7Alterations.length; i++) {
      const statement = v7Alterations[i];
      const preview = statement.substring(0, 60).replace(/\s+/g, ' ');

      try {
        await sql.query(statement);
        console.log(`[v7-${i + 1}/${v7Alterations.length}] ✓ ${preview}...`);
      } catch (error) {
        if (error.message.includes('already exists') || error.message.includes('duplicate column')) {
          console.log(`[v7-${i + 1}/${v7Alterations.length}] ○ Already exists: ${preview}...`);
        } else {
          console.error(`[v7-${i + 1}/${v7Alterations.length}] ✗ Error: ${error.message}`);
          // Don't throw on alter table errors - continue with other alterations
        }
      }
    }

    // Run V8 column additions (declined status)
    console.log(`\nApplying v8 schema updates - declined status (${v8Alterations.length} alterations)...`);
    for (let i = 0; i < v8Alterations.length; i++) {
      const statement = v8Alterations[i];
      const preview = statement.substring(0, 60).replace(/\s+/g, ' ');

      try {
        await sql.query(statement);
        console.log(`[v8-${i + 1}/${v8Alterations.length}] ✓ ${preview}...`);
      } catch (error) {
        if (error.message.includes('already exists') || error.message.includes('duplicate column')) {
          console.log(`[v8-${i + 1}/${v8Alterations.length}] ○ Already exists: ${preview}...`);
        } else {
          console.error(`[v8-${i + 1}/${v8Alterations.length}] ✗ Error: ${error.message}`);
        }
      }
    }

    // Run V9 column additions (program_area)
    console.log(`\nApplying v9 schema updates - program area (${v9Alterations.length} alterations)...`);
    for (let i = 0; i < v9Alterations.length; i++) {
      const statement = v9Alterations[i];
      const preview = statement.substring(0, 60).replace(/\s+/g, ' ');

      try {
        await sql.query(statement);
        console.log(`[v9-${i + 1}/${v9Alterations.length}] ✓ ${preview}...`);
      } catch (error) {
        if (error.message.includes('already exists') || error.message.includes('duplicate column')) {
          console.log(`[v9-${i + 1}/${v9Alterations.length}] ○ Already exists: ${preview}...`);
        } else {
          console.error(`[v9-${i + 1}/${v9Alterations.length}] ✗ Error: ${error.message}`);
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

    // Run V10 column additions (user_profile_id FK columns)
    console.log(`\nApplying v10 schema updates - user profile FK columns (${v10Alterations.length} alterations)...`);
    for (let i = 0; i < v10Alterations.length; i++) {
      const statement = v10Alterations[i];
      const preview = statement.substring(0, 60).replace(/\s+/g, ' ');

      try {
        await sql.query(statement);
        console.log(`[v10-${i + 1}/${v10Alterations.length}] ✓ ${preview}...`);
      } catch (error) {
        if (error.message.includes('already exists') || error.message.includes('duplicate column')) {
          console.log(`[v10-${i + 1}/${v10Alterations.length}] ○ Already exists: ${preview}...`);
        } else {
          console.error(`[v10-${i + 1}/${v10Alterations.length}] ✗ Error: ${error.message}`);
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

    // Run V12 column additions (researcher notes)
    console.log(`\nApplying v12 schema updates - Researcher notes (${v12Alterations.length} alterations)...`);
    for (let i = 0; i < v12Alterations.length; i++) {
      const statement = v12Alterations[i];
      const preview = statement.substring(0, 60).replace(/\s+/g, ' ');

      try {
        await sql.query(statement);
        console.log(`[v12-${i + 1}/${v12Alterations.length}] ✓ ${preview}...`);
      } catch (error) {
        if (error.message.includes('already exists') || error.message.includes('duplicate column')) {
          console.log(`[v12-${i + 1}/${v12Alterations.length}] ○ Already exists: ${preview}...`);
        } else {
          console.error(`[v12-${i + 1}/${v12Alterations.length}] ✗ Error: ${error.message}`);
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

    // Run V18 alterations (Review Manager columns)
    console.log(`\nApplying v18 schema updates - Review Manager (${v18Alterations.length} statements)...`);
    for (let i = 0; i < v18Alterations.length; i++) {
      const statement = v18Alterations[i];
      const preview = statement.substring(0, 60).replace(/\s+/g, ' ');

      try {
        await sql.query(statement);
        console.log(`[v18-${i + 1}/${v18Alterations.length}] ✓ ${preview}...`);
      } catch (error) {
        if (error.message.includes('already exists')) {
          console.log(`[v18-${i + 1}/${v18Alterations.length}] ○ Already exists: ${preview}...`);
        } else {
          console.error(`[v18-${i + 1}/${v18Alterations.length}] ✗ Error: ${error.message}`);
          throw error;
        }
      }
    }

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

    // Run V23a alterations (request_number columns)
    console.log(`\nApplying v23a schema updates - Request number columns (${v23aAlterations.length} statements)...`);
    for (let i = 0; i < v23aAlterations.length; i++) {
      const statement = v23aAlterations[i];
      const preview = statement.substring(0, 60).replace(/\s+/g, ' ');

      try {
        await sql.query(statement);
        console.log(`[v23a-${i + 1}/${v23aAlterations.length}] ✓ ${preview}...`);
      } catch (error) {
        if (error.message.includes('already exists')) {
          console.log(`[v23a-${i + 1}/${v23aAlterations.length}] ○ Already exists: ${preview}...`);
        } else {
          console.error(`[v23a-${i + 1}/${v23aAlterations.length}] ✗ Error: ${error.message}`);
        }
      }
    }

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

    console.log('\n✓ Database migration completed successfully!');
    console.log('\nTables created/updated:');
    console.log('  • search_cache (API search result caching)');
    console.log('  • researchers (deduplicated researcher profiles)');
    console.log('  • publications (papers linked to researchers)');
    console.log('  • researcher_keywords (expertise areas)');
    console.log('  • reviewer_suggestions (proposal-researcher matches)');
    console.log('  • proposal_searches (v2: search history tracking)');
    console.log('\nV2 column additions:');
    console.log('  • researchers.google_scholar_url');
    console.log('  • researchers.orcid_url');
    console.log('  • researchers.metrics_updated_at');
    console.log('  • publications.url');
    console.log('\nV3 column additions (contact enrichment):');
    console.log('  • researchers.email_source');
    console.log('  • researchers.email_year');
    console.log('  • researchers.email_verified_at');
    console.log('  • researchers.faculty_page_url');
    console.log('  • researchers.contact_enriched_at');
    console.log('  • researchers.contact_enrichment_source');
    console.log('  • reviewer_suggestions.email_sent_at');
    console.log('  • reviewer_suggestions.response_type');
    console.log('\nV4 column additions (email generation):');
    console.log('  • reviewer_suggestions.proposal_abstract');
    console.log('  • reviewer_suggestions.proposal_authors');
    console.log('  • reviewer_suggestions.proposal_institution');
    console.log('\nV6 column additions (summary attachments & Co-PI):');
    console.log('  • proposal_searches.summary_blob_url');
    console.log('  • proposal_searches.summary_filename');
    console.log('  • proposal_searches.summary_pages');
    console.log('  • proposal_searches.full_proposal_blob_url');
    console.log('  • proposal_searches.co_investigators');
    console.log('  • proposal_searches.co_investigator_count');
    console.log('  • reviewer_suggestions.co_investigators');
    console.log('  • reviewer_suggestions.co_investigator_count');
    console.log('  • reviewer_suggestions.summary_blob_url');
    console.log('\nV7 new table: grant_cycles');
    console.log('  • grant_cycles (id, name, short_code, program_name, review_deadline,');
    console.log('    summary_pages, review_template_blob_url, additional_attachments,');
    console.log('    custom_fields, is_active, created_at, updated_at)');
    console.log('\nV7 column additions (grant cycle FK):');
    console.log('  • proposal_searches.grant_cycle_id');
    console.log('  • reviewer_suggestions.grant_cycle_id');
    console.log('\nV10 new table: user_profiles');
    console.log('  • user_profiles (id, name, display_name, avatar_color, is_default,');
    console.log('    is_active, created_at, last_used_at)');
    console.log('\nV10 column additions (user profile FK):');
    console.log('  • proposal_searches.user_profile_id');
    console.log('  • reviewer_suggestions.user_profile_id');
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
    console.log('\nV18 column additions (Review Manager):');
    console.log('  • reviewer_suggestions.proposal_url');
    console.log('  • reviewer_suggestions.materials_sent_at');
    console.log('  • reviewer_suggestions.reminder_sent_at');
    console.log('  • reviewer_suggestions.reminder_count');
    console.log('  • reviewer_suggestions.review_received_at');
    console.log('  • reviewer_suggestions.review_blob_url');
    console.log('  • reviewer_suggestions.review_filename');
    console.log('  • reviewer_suggestions.thankyou_sent_at');
    console.log('  • reviewer_suggestions.review_status');
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
    console.log('\nIndexes created: 64 (plus 7 added in V30)');

  } catch (error) {
    console.error('\n✗ Migration failed:', error.message);
    process.exit(1);
  }
}

// Run migration
runMigration();
