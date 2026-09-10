-- Deliberation email without a writeup attachment (owner decision 2026-09-10,
-- docs/plans/STAFF_DELIBERATIONS_TAB_SHAPE_BRIEF_2026-09-09.md). The briefing
-- page (docs/DELIBERATION_BRIEFING_PAGE_PLAN.md) is the carrier for the writeup,
-- reviews, and narrative, so new attempts record attachment_mode = 'none'. The
-- DOCX and PDF snapshots are still pinned on every prepared row (the briefing
-- page serves them); pre_site_distribution_prepared_shape already requires
-- both whenever attachment_mode <> 'docx', so it needs no change. Legacy values
-- stay valid for the rows already sent.
ALTER TABLE pre_site_distribution_attempts
  DROP CONSTRAINT IF EXISTS pre_site_distribution_mode_check;
ALTER TABLE pre_site_distribution_attempts
  ADD CONSTRAINT pre_site_distribution_mode_check
  CHECK (attachment_mode IN ('none', 'docx', 'pdf', 'both'));
