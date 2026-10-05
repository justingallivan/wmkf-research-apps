-- Staff Discussion Transcript (artifact type 100000013): the transcript after
-- the confirmed presentation end, kept for staff only (owner decision
-- 2026-10-05; docs/plans/SITE_VISIT_SUMMARIES_AND_BOARD_SHARING_PLAN_2026-10-04.md
-- §7 decision 7). The shared post-presentation slot lease and upload tables
-- admit it so the derivative writer can fence its row. Re-declares the two
-- named CHECKs last set by 068.
ALTER TABLE presentation_material_uploads
  DROP CONSTRAINT IF EXISTS presentation_material_uploads_artifact_type_check;
ALTER TABLE presentation_material_uploads
  ADD CONSTRAINT presentation_material_uploads_artifact_type_check CHECK (
    artifact_type IN (100000005, 100000006, 100000007, 100000010, 100000011, 100000012, 100000013)
  );
ALTER TABLE presentation_material_slot_leases
  DROP CONSTRAINT IF EXISTS presentation_material_slot_leases_artifact_type_check;
ALTER TABLE presentation_material_slot_leases
  ADD CONSTRAINT presentation_material_slot_leases_artifact_type_check CHECK (
    artifact_type IN (100000005, 100000006, 100000007, 100000010, 100000011, 100000012, 100000013)
  );
