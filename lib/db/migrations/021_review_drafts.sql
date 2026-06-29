-- Migration 021: External reviewer review-form autosave drafts
-- See docs/atlas/postgres-review-drafts.md and
-- docs/REVIEWER_REVIEW_FORM_AUTHORING_BUILD_PLAN.md §3b.
--
-- Backs the in-browser reviewer authoring surface. As a reviewer answers the
-- 11 questions in the rich-text editor, work autosaves here (high-frequency
-- partial writes — Dataverse is the wrong store for that, exactly as with
-- intake_drafts). This table is a SCRATCHPAD only; the system of record for a
-- SUBMITTED review is the Dataverse wmkf_appreviewanswer snapshot child table
-- (+ the discrete ratings on the parent wmkf_appreviewersuggestion row).
--
-- One row per review (suggestion_id UNIQUE → at most one active draft per
-- reviewer/review). draft_json holds answers keyed by review-form-schema
-- field.key: sanitized HTML strings for richtext answers, ints for picklist
-- ratings. Richtext answers are ALWAYS server-sanitized
-- (lib/external/sanitize-review-html.js) before they land here — the autosave
-- PUT is a write boundary, not just render.
--
-- Lifecycle (plan §5/§9):
--   - Draft GET/PUT refuse once the review is submitted (wmkf_reviewreceivedat
--     set on the parent) — finality is enforced server-side, not by hiding UI.
--   - The draft is deleted ONLY after the submit changeset commits to Dataverse,
--     and on staff token revoke/regenerate (the leak/compromise actions), never
--     on a benign email resend.
--   - GC mirrors intake's deleteExpired (tied to token expiry; finalized Phase 5).

CREATE TABLE IF NOT EXISTS review_drafts (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  suggestion_id UUID NOT NULL UNIQUE,                  -- wmkf_appreviewersuggestion GUID
  draft_json    JSONB NOT NULL DEFAULT '{}'::jsonb,    -- answers keyed by field.key
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
