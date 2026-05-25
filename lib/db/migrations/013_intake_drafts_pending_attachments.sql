-- Migration 013: Intake Portal — pending_attachments column on intake_drafts
-- See docs/INTAKE_ATTACH_BUILD_SCOPING.md § Q1 (Option A) + A5.
--
-- The three-call attachment dance (POST /upload-token → browser PUT → POST
-- /attach) needs a server-managed list of in-flight uploads. The locked
-- drain plan originally stored these in draft_json.pendingAttachments[],
-- but the S183 autosave endpoint (upsertDraftJson) writes draft_json
-- wholesale — preserving only idempotency_key — so any autosave between
-- /upload-token and /attach would clobber the pending entry.
--
-- Option A: separate top-level JSONB column `pending_attachments`.
-- Mirrors the existing `attachments` column (server-managed, never
-- overwritten by autosave). Same atomic-append / atomic-remove patterns
-- as IntakeDraftService.addAttachment / removeAttachment.
--
-- Each pending entry shape (set by /upload-token, read by /attach +
-- sweep cron):
--   { attachmentId: UUID,
--     fieldKey:    string,
--     filename:    string (sanitized),
--     pathname:    string ('drafts/{draftId}/{attachmentId}' — opaque, no filename per A5),
--     contentType: string,
--     maxBytes:    number,
--     createdAt:   ISO-8601 timestamp string,
--     validUntil:  ISO-8601 timestamp string (token expiry — 1h after createdAt) }
--
-- The sweep cron removes entries with createdAt < now() - 2h (per A6 —
-- 2h cutoff is 1h longer than token expiry, gives slow /attach calls a
-- safety margin).
--
-- Idempotent: ADD COLUMN IF NOT EXISTS.

BEGIN;

ALTER TABLE intake_drafts
  ADD COLUMN IF NOT EXISTS pending_attachments JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN intake_drafts.pending_attachments IS
  'In-flight attachment uploads (three-call dance). Server-managed; never overwritten by autosave. See docs/INTAKE_ATTACH_BUILD_SCOPING.md § Q1 + A5 + A6.';

COMMIT;
