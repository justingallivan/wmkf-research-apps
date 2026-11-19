-- Migration 102: second section level on proposal list items.
--
-- A proposal list groups proposals by discipline branch (`section`) and, inside
-- a branch, by discipline group (`subsection`), both taken from the Keywords
-- table when the list is built. Nullable: lists built before this migration and
-- proposals with no discipline keyword have no subsection.
--
-- Apply BEFORE deploying code that selects the column.

ALTER TABLE proposal_list_items ADD COLUMN IF NOT EXISTS subsection TEXT;

COMMENT ON COLUMN proposal_list_items.subsection IS
  'Discipline group inside the section (discipline branch), frozen when the list is built; NULL when the proposal has none.';
