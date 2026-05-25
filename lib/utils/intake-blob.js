/**
 * Resolve the intake-portal's PRIVATE Vercel Blob store token.
 *
 * The `@vercel/blob` SDK defaults to `BLOB_READ_WRITE_TOKEN` (the shared
 * `phase-ii-summaries-blob` store used by uploads/reviewer-finder/etc.).
 * The intake portal has its own dedicated PRIVATE store
 * (`intake-applicant-private`) keyed by `INTAKE_BLOB_RW_TOKEN`. Every
 * Blob call in the intake-portal attach + sweep path must pass this
 * token EXPLICITLY — otherwise it silently hits the wrong store and
 * applicant PII spills into the shared public-ish space.
 *
 * Single source of truth so the four call sites (upload-token mint,
 * attach blobGet, attach del-on-infected, sweep del) all enforce
 * the same fail-loud-on-missing posture.
 *
 * See docs/INTAKE_ATTACH_BUILD_SCOPING.md § A4 and CLAUDE.md's
 * `INTAKE_BLOB_RW_TOKEN` notes.
 */

/**
 * @returns {string} the `INTAKE_BLOB_RW_TOKEN` env value.
 * @throws {Error} if the env var is unset or empty. The error message
 *   is intentionally explicit — callers should surface the structured
 *   `scan_misconfigured`-shaped failure to the operator, not propagate
 *   to applicants.
 */
export function getIntakeBlobToken() {
  const token = process.env.INTAKE_BLOB_RW_TOKEN;
  if (typeof token !== 'string' || token.length === 0) {
    throw new Error(
      'INTAKE_BLOB_RW_TOKEN not configured — intake-portal Blob store unreachable. ' +
        'See docs/CREDENTIALS_RUNBOOK.md § "Vercel Blob (private intake store)".',
    );
  }
  return token;
}
