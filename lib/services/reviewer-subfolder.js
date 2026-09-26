/**
 * Pure per-reviewer SharePoint subfolder naming, extracted from
 * `review-upload.js` (slice 6c-ii Stage C) so callers that only need this
 * one pure function -- the Test Request Factory's `review-file-copy.js`
 * planner and `run-runner.js`'s `copy_review_file` step -- do not have to
 * import `review-upload.js`'s full dependency graph (Cloudmersive scanning,
 * token lifecycle, notification service, etc.), which pulls in an ESM-only
 * package (`jose`) that at least one existing Jest suite's transform config
 * cannot parse. `review-upload.js` re-exports this function unchanged so
 * every existing importer keeps working with no call-site change.
 */

/**
 * Build the per-reviewer subfolder name for a SharePoint upload path.
 *
 * Format: `{sanitizedLastName}_{shortId}` where shortId is the first
 * 8 chars of the suggestion GUID. Falls back to `{shortId}` only when
 * the lastname sanitizes to an empty string (e.g. CJK-only names with
 * no ASCII fold).
 *
 * Why human-readable: lets staff browse SharePoint and identify whose
 * review is whose without cross-referencing Dataverse. Automation
 * doesn't depend on the format — `wmkf_reviewsharepointfolder` on the
 * row is the canonical pointer, and reviewer identity always comes
 * from the joined `wmkf_potentialreviewer` row, never from parsing
 * folder names.
 *
 * The subfolder name is computed once at first upload and frozen on the
 * row. Replacing files reuses the same folder. Renames to the source
 * row (e.g., reviewer's name corrected later) do not propagate to
 * SharePoint.
 *
 * Sanitization recipe:
 *   1. Pull lastname (or last word of full name if lastname unset)
 *   2. NFD normalize, drop combining marks (`José` → `Jose`)
 *   3. Strip everything not [A-Za-z0-9]
 *   4. Truncate to 30 chars
 *   5. If empty, fall back to short-id-only
 *   6. Append `_` + first 8 chars of suggestion GUID
 *
 * @param {string} suggestionId
 * @param {Object|null} reviewer - expanded wmkf_PotentialReviewer row,
 *   or null. Reads `wmkf_lastname` first, falls back to last word of
 *   `wmkf_name`.
 * @returns {string}
 */
export function buildReviewerSubfolder(suggestionId, reviewer) {
  const shortId = String(suggestionId || '').replace(/-/g, '').slice(0, 8);
  const rawLast = (reviewer?.wmkf_lastname && reviewer.wmkf_lastname.trim())
    || lastWordOf(reviewer?.wmkf_name)
    || '';
  const sanitized = rawLast
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritical marks
    .replace(/[^A-Za-z0-9]/g, '')
    .slice(0, 30);
  return sanitized ? `${sanitized}_${shortId}` : shortId;
}

function lastWordOf(name) {
  if (!name || typeof name !== 'string') return '';
  const cleaned = name.trim().replace(/^(dr\.?|prof\.?|professor)\s+/i, '');
  const parts = cleaned.split(/\s+/).filter(Boolean);
  return parts[parts.length - 1] || '';
}
