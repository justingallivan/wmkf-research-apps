/**
 * API Route: /api/admin/honorarium-amount
 *
 * Admin endpoint for the single reviewer-honorarium ground-truth amount
 * (Dataverse `wmkf_appsystemsettings`, key `honorarium.default_amount`).
 * Decided S199: one admin-editable value replaces the former per-user
 * preference; read live at portal honorarium-create + Review Manager email
 * render. See docs/BILL_CHUNK_4_DESIGN.md (Thread 2).
 *
 * Protected: superuser role required (or auth bypassed in dev mode).
 *
 * GET  — { amount, isDefault, defaultAmount } (effective value; isDefault=true
 *        when the key is unset and the documented fallback is in effect)
 * PUT  — { amount: number } → upsert the setting (positive number only)
 */

import { requireSuperuser } from '../../../lib/utils/auth';
import { getSetting, setSetting } from '../../../lib/services/settings-service';
import { HONORARIUM_AMOUNT_KEY, DEFAULT_HONORARIUM_AMOUNT } from '../../../lib/services/honorarium-config';

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'PUT') {
    res.setHeader('Allow', 'GET, PUT');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const gate = await requireSuperuser(req, res);
  if (!gate) return;

  if (req.method === 'GET') {
    const raw = await getSetting(HONORARIUM_AMOUNT_KEY);
    const parsed = raw == null || String(raw).trim() === '' ? null : Number(String(raw).trim());
    const valid = parsed != null && Number.isFinite(parsed) && parsed > 0;
    return res.status(200).json({
      key: HONORARIUM_AMOUNT_KEY,
      amount: valid ? parsed : DEFAULT_HONORARIUM_AMOUNT,
      isDefault: !valid,
      defaultAmount: DEFAULT_HONORARIUM_AMOUNT,
      // Surfaced so the admin UI can flag a malformed stored value distinctly
      // from an unset one (a non-empty raw that didn't parse).
      malformed: raw != null && String(raw).trim() !== '' && !valid,
    });
  }

  // PUT
  const amount = req.body?.amount;
  const n = typeof amount === 'number' ? amount : Number(String(amount ?? '').trim());
  if (!Number.isFinite(n) || n <= 0) {
    return res.status(400).json({ error: 'amount must be a positive number' });
  }
  const ok = await setSetting(HONORARIUM_AMOUNT_KEY, String(n), gate.profileId);
  if (!ok) {
    return res.status(500).json({ error: 'Failed to save honorarium amount' });
  }
  return res.status(200).json({ key: HONORARIUM_AMOUNT_KEY, amount: n, isDefault: false });
}
