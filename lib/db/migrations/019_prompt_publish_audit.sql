-- Migration 019: Append-only audit trail for superuser-initiated prompt publishes
-- See docs/atlas/dataverse-wmkf-ai-run-and-prompt.md (write paths) and the
-- reviewer-prompt → Dataverse migration plan.
--
-- Records every "Publish New Version" action against a wmkf_ai_prompt row from
-- the /admin prompt editor. Modeled directly on policy_publish_audit (migration
-- 006): Dataverse has no $batch transaction, so the versioned publish
-- (create new current row → flip prior row's iscurrent=false) is non-atomic.
-- The route writes a "pending" row before the first Dataverse mutation and a
-- separate "final" row after, so the trail captures intent + outcome even when
-- an intermediate write partially fails. Pairing + idempotent retry are by
-- request_id (a uuid the route mints); body_hash dedups identical re-submits.
--
-- Unlike policy slots (which carry a user version_label), prompts are same-name
-- rows discriminated by wmkf_ai_iscurrent + an integer wmkf_promptversion, so
-- the idempotency key is (prompt_name, target_version, request_id).
--
-- Append-only: no UPDATE/DELETE during normal operation. The prompt BODY is not
-- stored here (it lives on the wmkf_ai_prompt row); only audit metadata.

CREATE TABLE IF NOT EXISTS prompt_publish_audit (
  id                SERIAL PRIMARY KEY,
  request_id        TEXT NOT NULL,                        -- uuid minted by the route; pairs pending+final + idempotency
  prompt_name       TEXT NOT NULL,                        -- e.g. 'reviewer-finder.analyze'
  target_version    INTEGER NOT NULL,                     -- new wmkf_promptversion being published (prior + 1)
  new_prompt_id     TEXT,                                 -- wmkf_ai_prompt GUID of the created row (null on pending)
  prior_prompt_id   TEXT,                                 -- wmkf_ai_prompt GUID of the row being superseded
  body_hash         TEXT,                                 -- sha256 of the published body, for idempotent retry dedup
  profile_id        INTEGER REFERENCES user_profiles(id), -- who initiated; null only if requireSuperuser is in dev-bypass mode
  phase             TEXT NOT NULL CHECK (phase IN ('pending', 'final')),
  status            TEXT NOT NULL CHECK (status IN ('pending', 'completed', 'partial', 'already_published', 'concurrency_conflict', 'invalid_body', 'no_current_row', 'duplicate_current_rows', 'audit_unavailable', 'failed')),
  outcome_json      JSONB,                                -- structured outcome (created/flipped/resumed) — set on final
  warnings_json     JSONB,                                -- ['prior_flip_failed', 'audit_finalize_failed', ...] — set on final
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- One pending + one final row per publish (request_id). Backs the route's
  -- idempotent retry: a re-submitted request_id can't silently duplicate the
  -- pending/final pair (INSERT ... ON CONFLICT detects the prior attempt).
  UNIQUE (request_id, phase)
);

CREATE INDEX IF NOT EXISTS idx_prompt_publish_audit_name ON prompt_publish_audit (prompt_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_prompt_publish_audit_request ON prompt_publish_audit (request_id);
CREATE INDEX IF NOT EXISTS idx_prompt_publish_audit_created ON prompt_publish_audit (created_at DESC);
