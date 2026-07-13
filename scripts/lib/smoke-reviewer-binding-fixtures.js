/**
 * Owner-reviewed fixture allowlist for scripts/smoke-reviewer-binding.js.
 *
 * Adding a GUID here is an owner-reviewed commit: it authorizes that exact
 * production akoya_request row as the manual smoke fixture. This mirrors the
 * tracked target-registry convention: fixture authorization is code review, not
 * an invocation-time value supplied by the same command that performs writes.
 */

export const APPROVED_FIXTURE_REQUEST_IDS = Object.freeze([
  // Owner-approved 2026-07-13: request 1002379, "Quantum Chimera: Connecting
  // Synthesis to Function to Explore New Frontiers in Chemical Space".
  '54e2b88b-04b9-f011-bbd3-6045bd02b4cc',
]);
