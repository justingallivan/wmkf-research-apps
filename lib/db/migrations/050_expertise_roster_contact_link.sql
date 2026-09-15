-- Roster Contact Link (docs/plans/ROSTER_CONTACT_LINK_PLAN_2026-09-14.md).
--
-- Dataverse remains read-only. The roster row stays the durable attendee
-- identity; this nullable GUID only points at the Contact that owns email.
ALTER TABLE expertise_roster
  ADD COLUMN IF NOT EXISTS dataverse_contact_id UUID;

COMMENT ON COLUMN expertise_roster.dataverse_contact_id IS
  'Optional Dataverse Contact reference used to resolve the live primary email; linked rows never fall back to preferred_email.';

-- Soft-deleted rows retain their link for undo/audit and do not reserve it.
CREATE UNIQUE INDEX IF NOT EXISTS idx_expertise_roster_active_contact
  ON expertise_roster (dataverse_contact_id)
  WHERE dataverse_contact_id IS NOT NULL AND is_active = true;
