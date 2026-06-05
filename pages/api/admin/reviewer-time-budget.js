/**
 * API Route: /api/admin/reviewer-time-budget
 *
 * Admin endpoint for the reviewer-search wall-clock time budget (Dataverse
 * `wmkf_appsystemsettings`, key `reviewer.time_budget_seconds`). This is the
 * live, admin-editable knob that governs how long a reviewer search may run
 * before it stops gracefully. The Vercel `maxDuration` route wall is pinned at
 * the plan ceiling (800s) and is NOT runtime-configurable; this number lives
 * below it and is enforced in app code via an AbortSignal deadline. See
 * docs/REVIEWER_TIMEOUT_BUDGET_PLAN.md.
 *
 * Protected: superuser role required (or auth bypassed in dev mode).
 *
 * GET  — { key, seconds, isDefault, defaultSeconds, min, max, malformed }
 * PUT  — { seconds: number } → upsert (clamped to [min, max])
 */

import { requireSuperuser } from '../../../lib/utils/auth';
import { getSetting, setSetting } from '../../../lib/services/settings-service';
import {
  REVIEWER_TIME_BUDGET_KEY,
  DEFAULT_REVIEWER_TIME_BUDGET_SECONDS,
  MIN_REVIEWER_TIME_BUDGET_SECONDS,
  MAX_REVIEWER_TIME_BUDGET_SECONDS,
} from '../../../lib/services/reviewer-time-budget';

function clamp(n) {
  return Math.min(MAX_REVIEWER_TIME_BUDGET_SECONDS, Math.max(MIN_REVIEWER_TIME_BUDGET_SECONDS, n));
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'PUT') {
    res.setHeader('Allow', 'GET, PUT');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const gate = await requireSuperuser(req, res);
  if (!gate) return;

  if (req.method === 'GET') {
    const raw = await getSetting(REVIEWER_TIME_BUDGET_KEY);
    const parsed = raw == null || String(raw).trim() === '' ? null : Number(String(raw).trim());
    const valid = parsed != null && Number.isFinite(parsed) && parsed > 0;
    return res.status(200).json({
      key: REVIEWER_TIME_BUDGET_KEY,
      seconds: valid ? clamp(parsed) : DEFAULT_REVIEWER_TIME_BUDGET_SECONDS,
      isDefault: !valid,
      defaultSeconds: DEFAULT_REVIEWER_TIME_BUDGET_SECONDS,
      min: MIN_REVIEWER_TIME_BUDGET_SECONDS,
      max: MAX_REVIEWER_TIME_BUDGET_SECONDS,
      // Distinguish a malformed stored value from an unset one.
      malformed: raw != null && String(raw).trim() !== '' && !valid,
    });
  }

  // PUT — clamp into range (a soft time limit; clamp rather than reject).
  const seconds = req.body?.seconds;
  const n = typeof seconds === 'number' ? seconds : Number(String(seconds ?? '').trim());
  if (!Number.isFinite(n) || n <= 0) {
    return res.status(400).json({ error: 'seconds must be a positive number' });
  }
  const clamped = clamp(n);
  const ok = await setSetting(REVIEWER_TIME_BUDGET_KEY, String(clamped), gate.profileId);
  if (!ok) {
    return res.status(500).json({ error: 'Failed to save reviewer time budget' });
  }
  return res.status(200).json({ key: REVIEWER_TIME_BUDGET_KEY, seconds: clamped, isDefault: false });
}
