-- Serialize applicant-material finalization per collection checklist slot.
-- Each key is a canonical slot and each value is the server-owned lease token
-- plus its millisecond expiry. Conditional UPDATEs in collection-store.js are
-- the only writers; malformed/live entries fail closed until operator repair
-- or a valid holder releases them.
ALTER TABLE site_visit_material_collections
  ADD COLUMN IF NOT EXISTS slot_leases JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN site_visit_material_collections.slot_leases IS
  'Per-canonical-slot finalize leases: {slot:{token,expiresAt}}; five-minute expiry, conditionally acquired and released.';
