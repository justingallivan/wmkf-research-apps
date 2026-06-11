/**
 * Shared logic for grant-cycle blob "materials" — the review-email template and
 * additional attachments on `wmkf_appgrantcycle` — during the Phase 1 private-blob
 * migration. Every reader of these materials (the `cycle-material` download proxy,
 * `grant-cycles` GET, and the `generate-emails` / `send-emails` server-reads) must
 * classify a stored ref identically, so that logic lives here.
 *
 * A material is one of:
 *   - LEGACY PUBLIC — an http(s) Vercel Blob URL. Read via `safeFetch`; surfaced to
 *     the browser via `blob-proxy.js` (`proxifyBlobUrl`). Unchanged by this migration.
 *   - PRIVATE — a bare blob pathname under `CYCLE_MATERIAL_PREFIX` in the dedicated
 *     `wmkf-uploads-private` store. Read server-side via `readUploadedBlobBuffer`;
 *     downloaded in the browser via the record-scoped `/api/reviewer-finder/cycle-material`
 *     proxy. The template carries the bare pathname in `wmkf_reviewtemplateurl`;
 *     each private attachment is `{ pathname, access: 'private', filename }`.
 *
 * Discriminator policy (resolved 2026-06-11, Codex SLICE2-4): the template field has no
 * explicit access flag, so private-ness is a STRICT ALLOWLIST PREFIX, not a "not http://"
 * shape guess. A value counts as a private cycle-material pathname ONLY if it starts with
 * `CYCLE_MATERIAL_PREFIX` (and is not an http(s) URL). Anything else — public URLs,
 * protocol-relative `//…`, malformed legacy values — is treated as legacy-public, so the
 * code fails safe toward the unchanged public path and never misroutes to a private read.
 */

// Pathname prefix every PRIVATE cycle-material upload is written under (added at
// upload time by the modals via FileUploaderSimple's `pathPrefix` prop). Changing
// this is a breaking change for already-stored private refs.
const CYCLE_MATERIAL_PREFIX = 'cycle-materials/';

/**
 * True iff `value` is a private cycle-material blob pathname (strict prefix allowlist).
 * @param {unknown} value
 * @returns {boolean}
 */
function isPrivateCycleMaterialPathname(value) {
  if (typeof value !== 'string' || value.length === 0) return false;
  const lower = value.toLowerCase();
  if (lower.startsWith('http://') || lower.startsWith('https://')) return false;
  return value.startsWith(CYCLE_MATERIAL_PREFIX);
}

/**
 * The record-scoped download URL for a private cycle material.
 * @param {string} cycleId
 * @param {string} pathname
 * @returns {string}
 */
function cycleMaterialDownloadPath(cycleId, pathname) {
  return `/api/reviewer-finder/cycle-material?cycleId=${encodeURIComponent(cycleId)}&pathname=${encodeURIComponent(pathname)}`;
}

module.exports = {
  CYCLE_MATERIAL_PREFIX,
  isPrivateCycleMaterialPathname,
  cycleMaterialDownloadPath,
};
