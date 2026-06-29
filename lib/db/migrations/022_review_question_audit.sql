-- Migration 022: Append-only audit trail for staff edits to the review question set
-- See docs/atlas/dataverse-wmkf-reviewquestion.md (write paths) and
-- docs/STAFF_EDITABLE_REVIEW_QUESTIONS_BUILD_PLAN.md §4 (admin editor).
--
-- Records every save of the staff-editable review question set
-- (wmkf_reviewquestion) from pages/api/admin/review-questions.js. Mirrors the
-- policy_publish_audit precedent (migration 006): a purpose-named Postgres
-- table rather than overloading a Dataverse log, so a config change is
-- traceable ("who changed Q6, when, from what to what").
--
-- Append-only: no UPDATE or DELETE during normal operation. The route writes a
-- "pending" row BEFORE the atomic executeChangeset (and hard-aborts the save if
-- the audit is unavailable — audit availability is a precondition), then a
-- "final" row after, capturing the before/after set + the op summary even if
-- the Dataverse changeset fails. Pairing is by request_id (uuid the route
-- mints). Unlike policies, the save is ONE atomic $batch, so there is no
-- partial-Dataverse-write state — but pending/final still distinguishes an
-- attempted save from a committed one.

CREATE TABLE IF NOT EXISTS review_question_audit (
  id              SERIAL PRIMARY KEY,
  request_id      TEXT NOT NULL,                       -- uuid minted by the route; pairs pending+final rows
  profile_id      INT REFERENCES user_profiles(id),    -- who initiated; null only if requireSuperuser is in dev-bypass mode
  phase           TEXT NOT NULL CHECK (phase IN ('pending', 'final')),
  status          TEXT NOT NULL CHECK (status IN ('pending', 'completed', 'set_changed', 'invalid', 'audit_unavailable', 'failed')),
  base_version    TEXT,                                -- the questionSetVersion the editor loaded against (optimistic token)
  result_version  TEXT,                                -- the questionSetVersion after a completed save (null otherwise)
  summary_json    JSONB,                               -- { created, updated, deleted, reordered } op counts — set on final
  before_json     JSONB,                               -- the question set as it was before the save (null on pending)
  after_json      JSONB,                               -- the submitted set the editor produced
  warnings_json   JSONB,                               -- non-fatal warnings — set on final
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_review_question_audit_request ON review_question_audit (request_id);
CREATE INDEX IF NOT EXISTS idx_review_question_audit_created ON review_question_audit (created_at DESC);
