-- Production import verified 2026-11-19 before this cutover migration was introduced.
-- ADD validates all existing rows. Failure rolls back the entire migration.
ALTER TABLE consultant_feedback DROP CONSTRAINT consultant_feedback_consultant_roster_id_fkey;
ALTER TABLE consultant_feedback ADD CONSTRAINT consultant_feedback_consultant_roster_id_fkey
  FOREIGN KEY (consultant_roster_id) REFERENCES expertise_roster_identity(id);
