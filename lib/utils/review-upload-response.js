/**
 * Shared response mapper for review-upload endpoint failures.
 *
 * Both `/api/review-manager/upload-review` and
 * `/api/external/review/[token]/upload` funnel writeReviewFiles failures
 * through this function so the two endpoints can never drift on status
 * codes or message wording.
 *
 * Mapping:
 *   validation         → 400 (echo errors)
 *   not_found          → 404
 *   infected           → 422 (echo errors — caller-actionable: lists which
 *                              files + virus names; safe to surface)
 *   scan_misconfigured → 500 (generic message; structured details already
 *                              logged server-side by review-upload.js)
 *   scan_unavailable   → 503 (generic message; retry-friendly)
 *   anything else      → 500 (echoes the result envelope; defensive — a
 *                              new ok:false reason should land here only
 *                              if a switch case is missed during a refactor)
 *
 * Client-facing messages are intentionally opaque on the scan_* paths. The
 * server-side log carries the structured Cloudmersive error (serviceName,
 * status, isTransient, dataverseCode if any) for operator triage.
 */
'use strict';

function respondForFailedReviewUpload(res, result) {
  switch (result.reason) {
    case 'validation':
      return res.status(400).json(result);
    case 'not_found':
      return res.status(404).json(result);
    case 'infected':
      return res.status(422).json({ ok: false, reason: 'infected', errors: result.errors });
    case 'scan_misconfigured':
      return res.status(500).json({
        ok: false,
        reason: 'scan_misconfigured',
        message: 'Virus scanner is misconfigured. Contact an administrator.',
      });
    case 'scan_unavailable':
      return res.status(503).json({
        ok: false,
        reason: 'scan_unavailable',
        message: 'Virus scanner is temporarily unavailable. Please try again in a few minutes.',
      });
    default:
      return res.status(500).json(result);
  }
}

module.exports = { respondForFailedReviewUpload };
