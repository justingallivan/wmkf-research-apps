-- Advisor picks (docs/plans/J27_PROPOSAL_LIST_EMAILS_PLAN_2026-11-18.md,
-- owner decisions 2026-11-19). During Scoring, any Workbench staff member ticks
-- the Chairs and Board members who should see a scored proposal. Creating that
-- person's proposal list highlights the proposals ticked for them; a rebuild
-- highlights newly listed proposals the same way and keeps existing marks.
-- roster_id is the numeric expertise roster identity (migration 103) and, like
-- proposal_list_links.recipient_source, carries no foreign key. An untick
-- deletes the row.

CREATE TABLE IF NOT EXISTS proposal_list_advisor_picks (
  request_id UUID NOT NULL,
  roster_id INTEGER NOT NULL CHECK (roster_id > 0),
  picked_by UUID NOT NULL,
  picked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (request_id, roster_id)
);

CREATE INDEX IF NOT EXISTS idx_proposal_list_advisor_picks_roster
  ON proposal_list_advisor_picks (roster_id);

COMMENT ON TABLE proposal_list_advisor_picks IS
  'Chairs and Board members staff ticked during Scoring to see a proposal; pre-fills highlights when that person''s proposal list is created or rebuilt.';
