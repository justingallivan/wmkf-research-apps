/**
 * Virus-scan kill switch.
 *
 * Single source of truth for whether app-side virus scanning runs on user-
 * uploaded files. Read by every upload surface that integrates the scanner:
 *   - lib/services/review-upload.js (staff + external-reviewer uploads)
 *   - pages/api/intake/draft/attach.js (applicant intake three-call dance)
 *
 * Default OFF. Operators must explicitly opt in via env var
 * `VIRUS_SCAN_ENABLED=true`. When off, callers skip the scan step entirely
 * with no degraded behavior and no scan_result tracking — uploads behave
 * exactly as they did before the scanner existed.
 *
 * When on, the contract callers MUST honor is fail-closed: a scanner outage
 * or misconfiguration blocks the upload. The opt-in via env flag means the
 * operator has explicitly accepted the scanner as gatekeeper; partial
 * degradation would defeat the point of having a gatekeeper at all. To
 * intentionally bypass during an outage, set the flag back to false and
 * redeploy — that's the emergency runbook.
 *
 * Why env, not a Dataverse setting: malware gates should not be flippable
 * via runtime settings UI without an audit trail and role enforcement. The
 * redeploy requirement is a feature here, not a bug. If a Dataverse-backed
 * override is ever added, it should only be permitted to STRENGTHEN — i.e.
 * turn scanning on for a surface, not silently disable it in production.
 */
'use strict';

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);

function isVirusScanEnabled() {
  const raw = process.env.VIRUS_SCAN_ENABLED;
  if (raw == null) return false;
  return TRUE_VALUES.has(String(raw).trim().toLowerCase());
}

module.exports = { isVirusScanEnabled };
