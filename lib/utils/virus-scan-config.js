/**
 * Virus-scan kill switch.
 *
 * Single source of truth for whether app-side virus scanning runs on user-
 * uploaded files. Read by every upload surface that integrates the scanner
 * (today: lib/services/review-upload.js; future: intake-portal attach
 * endpoint).
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

/**
 * Always-on recipient for virus-scan detection alerts.
 *
 * On every infected upload, this address receives the notification alongside
 * any per-event recipient (e.g. the Program Director on the related
 * akoya_request, when resolvable). The PD path may legitimately be empty
 * (intake-portal drafts have no request yet); this address guarantees that
 * detection events never go unwatched.
 *
 * Single source of truth so review-upload.js and intake-attach.js can't drift.
 */
const VIRUS_DETECTION_ALERT_EMAIL = 'alerts@wmkeck.org';

module.exports = { isVirusScanEnabled, VIRUS_DETECTION_ALERT_EMAIL };
