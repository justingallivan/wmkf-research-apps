-- Applicant materials (docs/APPLICANT_ADDITIONAL_MATERIALS_PLAN.md §16, PR 2):
-- the contributor portal stages site-visit documents (PDF, PowerPoint, Keynote,
-- Word) through the same private-Blob ledger the grantee image path uses.
-- Widen the scope allowlist; nothing else about the table changes.
ALTER TABLE portal_upload_staging
  DROP CONSTRAINT IF EXISTS portal_upload_staging_scope_check;
ALTER TABLE portal_upload_staging
  ADD CONSTRAINT portal_upload_staging_scope_check
  CHECK (scope IN ('grantee_image', 'staff_grantee_image', 'site_visit_material'));
