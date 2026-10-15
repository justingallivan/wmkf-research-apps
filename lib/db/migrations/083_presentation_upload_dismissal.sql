-- Dismissal does not confirm cancellation or stop reconciliation.
ALTER TABLE presentation_material_uploads ADD COLUMN IF NOT EXISTS staff_dismissed_at TIMESTAMPTZ;
COMMENT ON COLUMN presentation_material_uploads.staff_dismissed_at IS
  'Staff hid an uncertain browser attempt; reconciliation continues. Recovered candidates clear dismissal and receive a fresh review window.';
