-- Consultant Feedback slice 2 (docs/plans/CONSULTANT_FEEDBACK_PLAN_2026-09-14.md
-- §4 "Slice 2 registry contract" / "Slice 2 attachment lifecycle").
--
-- Widen the shared `portal_upload_staging` scope allowlist to add
-- 'consultant_feedback', mirroring how migration 043 widened it for
-- 'site_visit_material'. Nothing else about `portal_upload_staging` changes.
--
-- `consultant_feedback` itself already has `requestdocument_id UUID UNIQUE`
-- and `status IN ('active', 'deleting')` from migration 048 (slice 1); no
-- table change is needed here.
ALTER TABLE portal_upload_staging
  DROP CONSTRAINT IF EXISTS portal_upload_staging_scope_check;
ALTER TABLE portal_upload_staging
  ADD CONSTRAINT portal_upload_staging_scope_check
  CHECK (scope IN ('grantee_image', 'staff_grantee_image', 'site_visit_material', 'consultant_feedback'));
