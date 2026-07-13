/**
 * Owner-reviewed fixture allowlist for scripts/smoke-reviewer-binding.js.
 *
 * Adding a GUID here is an owner-reviewed commit: it authorizes that exact
 * production akoya_request row as the manual smoke fixture. This mirrors the
 * tracked target-registry convention: fixture authorization is code review, not
 * an invocation-time value supplied by the same command that performs writes.
 */

export const APPROVED_FIXTURE_REQUEST_IDS = Object.freeze([]);
