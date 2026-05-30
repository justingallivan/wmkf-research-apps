/**
 * Sanitize a client-supplied filename for use in audit rows + the
 * intake-portal applicant UI echo. The sanitized name is NEVER embedded
 * in the Blob pathname — pathnames are opaque `drafts/{draftId}/{attachmentId}`
 * per docs/INTAKE_ATTACH_BUILD_SCOPING.md § A5 — but it still needs to
 * be storable in JSONB (no control chars), free of path-traversal
 * sequences, and length-bounded.
 *
 * Constraints:
 *   - Strip C0 controls (0x00–0x1F) and DEL (0x7F).
 *   - Strip path separators (`/` and `\`) — defense in depth even though
 *     they never reach a pathname today.
 *   - Reject any input that contains `..` as a path segment after
 *     normalization. Overzealous for non-pathname use, but the filename
 *     CAN end up logged in audit material; never let a path-traversal
 *     pattern survive sanitization.
 *   - Normalize to Unicode NFKC so visually-identical compositions
 *     hash to the same audit digest.
 *   - Strip leading dots (hidden-file convention) and leading/trailing
 *     whitespace.
 *   - Cap at 200 chars total, preserving the extension if present.
 *   - Fail-loud on empty result so the caller never silently substitutes
 *     a default filename.
 */

const CONTROL_CHARS = /[\x00-\x1F\x7F]/g;
const PATH_SEPARATORS = /[/\\]/g;
const LEADING_DOTS = /^\.+/;

/**
 * @param {unknown} input — must be a non-empty string; everything else
 *   throws.
 * @returns {string} sanitized filename (length ≤ 200, no control chars,
 *   no path separators, no leading dots, NFKC-normalized).
 * @throws {Error} if input is not a string, is empty after sanitization,
 *   or contains `..` segments.
 */
export function sanitizeBlobFilename(input) {
  if (typeof input !== 'string') {
    throw new Error('sanitizeBlobFilename: input must be a string');
  }

  if (input.length === 0) {
    throw new Error('sanitizeBlobFilename: input must be a non-empty string');
  }

  // NFKC first so compatibility-equivalent forms collapse before any
  // further checks (e.g., fullwidth `．．` → `..`).
  let s = input.normalize('NFKC');

  // Trim whitespace BEFORE the traversal check so a whitespace-padded
  // attack like `"  ../x.pdf"` can't slip past the regex (which anchors
  // `..` to `^` or path separators, not to whitespace) and then get
  // trimmed clean. Codex round-2 catch.
  s = s.trim();

  // Path-traversal detection BEFORE separators are stripped — `..` is
  // an attack signal only as a path segment (between separators or at
  // the boundary). Detect on the still-pathy form, not after flattening.
  if (s === '..' || /(^|[/\\])\.\.([/\\]|$)/.test(s)) {
    throw new Error('sanitizeBlobFilename: input contains a `..` segment');
  }

  // Strip controls and separators, then leading dots (hidden-file convention).
  s = s.replace(CONTROL_CHARS, '').replace(PATH_SEPARATORS, '').replace(LEADING_DOTS, '');

  if (!s) {
    throw new Error('sanitizeBlobFilename: input empty after sanitization');
  }

  // Length cap. Codepoint-aware so a multi-codepoint character (emoji,
  // CJK, etc.) at the boundary isn't split mid-surrogate-pair. Preserve
  // the extension if reasonable (≤ 16 chars including the dot) so a
  // 250-char filename still ends in `.pdf` and not in the middle of a name.
  const MAX_LEN = 200;
  const codepoints = Array.from(s);
  if (codepoints.length > MAX_LEN) {
    const extMatch = s.match(/\.[^.]{1,16}$/);
    if (extMatch) {
      const ext = extMatch[0];
      const extCodepoints = Array.from(ext).length;
      s = codepoints.slice(0, MAX_LEN - extCodepoints).join('') + ext;
    } else {
      s = codepoints.slice(0, MAX_LEN).join('');
    }
  }

  return s;
}
