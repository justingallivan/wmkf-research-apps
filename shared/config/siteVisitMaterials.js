/**
 * Applicant materials collection — shared constants
 * (docs/APPLICANT_ADDITIONAL_MATERIALS_PLAN.md §16, owner decisions M1–M5).
 */

export const SITE_VISIT_MATERIALS_UPLOAD_MAX_MB_SETTING = 'site_visit_materials.upload_max_mb';
export const SITE_VISIT_MATERIALS_UPLOAD_MAX_MB_DEFAULT = 100;
export const SITE_VISIT_MATERIALS_UPLOAD_MAX_MB_LIMITS = Object.freeze({ min: 1, max: 500 });

export const SITE_VISIT_MATERIALS_AUDIENCE = 'materials';
export const SITE_VISIT_MATERIALS_DUE_BUSINESS_DAYS = 2;
export const SITE_VISIT_MATERIALS_CLOSE_AFTER_DAYS = 7;

/** M1: the cycle checklist template. Keys are stable; labels are copy. */
export const SITE_VISIT_MATERIALS_CHECKLIST = Object.freeze([
  Object.freeze({ key: 'presentation_pdf', label: 'Presentation (PDF)', required: true }),
  Object.freeze({ key: 'presentation_source', label: 'Presentation source (PowerPoint or Keynote)', required: true }),
  Object.freeze({ key: 'participant_bios', label: 'Participant bios (PDF or Word)', required: true }),
]);

/**
 * Owner decision (2026-09-11, S507): the optional "Anything else" upload is
 * hidden from applicants for now. The slot's storage path, folder, and
 * artifact type stay built; flipping this to `true` restores the uploader on
 * the contributor page and reopens the mint/finalize gates. Never a checklist
 * item, so the reminder cron's required-item check is unaffected either way.
 */
export const SITE_VISIT_MATERIALS_OTHER_UPLOADS_ENABLED = false;

export const SITE_VISIT_MATERIALS_STATUS = Object.freeze({ OPEN: 'open', READY: 'ready', CLOSED: 'closed' });

/** M4: flat request-relative SharePoint folders. */
export const SITE_VISIT_MATERIALS_FOLDERS = Object.freeze({
  presentation_pdf: 'Site Visit - Slides',
  presentation_source: 'Site Visit - Slides',
  participant_bios: 'Site Visit - Participant Bios',
  other: 'Site Visit - Other',
});

export function normalizeUploadMaxMb(value) {
  const n = Number(value);
  if (!Number.isInteger(n)) return null;
  if (n < SITE_VISIT_MATERIALS_UPLOAD_MAX_MB_LIMITS.min || n > SITE_VISIT_MATERIALS_UPLOAD_MAX_MB_LIMITS.max) return null;
  return n;
}
