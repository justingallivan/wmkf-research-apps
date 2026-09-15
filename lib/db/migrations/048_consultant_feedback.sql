-- Consultant Feedback slice 1 (docs/plans/CONSULTANT_FEEDBACK_PLAN_2026-09-14.md §4).
--
-- Staff-recorded informal feedback from retained consultants on a proposal,
-- attributed to an `expertise_roster` consultant or a one-off name stored on
-- the entry itself (CF6: one-offs never become roster rows). Shared on the
-- deliberation briefing page by default (CF2); staff may edit/delete with no
-- audit trail (CF5).
--
-- `mutation_id` + the unique (request_id, mutation_id) index make create
-- idempotent: the insert path (`writeFeedbackEntry`,
-- lib/services/consultant-feedback-service.js) inserts with
-- `ON CONFLICT (request_id, mutation_id) DO NOTHING` and then selects the row
-- for that mutation id, so a retry after a lost response replays the
-- original row instead of duplicating it (Codex AR-2 finding 5, AR-3
-- precision pass on client-side id lifecycle).
--
-- `status` is 'active' or 'deleting'. Slice 1 never writes 'deleting' — hard
-- delete goes straight from 'active' to gone (CF5) — but the column and
-- constraint are added now so slice 2's supersede-first delete (§3.6) needs
-- no further schema change. External and tab readers select
-- `status = 'active'` only.
--
-- `consultant_feedback_one_author` enforces exactly one of
-- `consultant_roster_id` / `one_off_name` (§3.2); `consultant_feedback_has_content`
-- requires `body_html` or `requestdocument_id` (slice 2) since slice 1 has no
-- attachments and therefore always requires a non-empty sanitized body.
CREATE TABLE IF NOT EXISTS consultant_feedback (
  id                     BIGSERIAL PRIMARY KEY,
  request_id             UUID NOT NULL,
  consultant_roster_id   INTEGER REFERENCES expertise_roster(id),
  one_off_name           TEXT,
  one_off_affiliation    TEXT,
  body_html              TEXT,
  received_on            DATE NOT NULL,
  requestdocument_id     UUID UNIQUE,
  shared                 BOOLEAN NOT NULL DEFAULT true,
  mutation_id            UUID NOT NULL,
  status                 TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deleting')),
  created_by             INTEGER NOT NULL REFERENCES user_profiles(id),
  updated_by             INTEGER NOT NULL REFERENCES user_profiles(id),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT consultant_feedback_has_content CHECK (body_html IS NOT NULL OR requestdocument_id IS NOT NULL),
  CONSTRAINT consultant_feedback_one_author CHECK (
    (consultant_roster_id IS NOT NULL AND one_off_name IS NULL)
    OR (consultant_roster_id IS NULL AND one_off_name IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS consultant_feedback_request_idx ON consultant_feedback (request_id, received_on DESC);
CREATE UNIQUE INDEX IF NOT EXISTS consultant_feedback_mutation_idx ON consultant_feedback (request_id, mutation_id);
