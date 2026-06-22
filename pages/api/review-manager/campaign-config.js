/**
 * Review Manager — Reviewer-engagement campaign config (Phase 1)
 *
 * GET  /api/review-manager/campaign-config?requestId=<GUID>
 *   → { requestId, config: { respondOffsetDays, reviewDueDate, respondReminderEnabled,
 *       respondReminderLeadDays, reviewDueReminderEnabled, reviewDueReminderLeadDays,
 *       desiredCount, quotaNotifiedAt } }   (nulls where unset)
 *
 * POST /api/review-manager/campaign-config
 *   body: { requestId: <GUID>, config: { <any subset of the editable fields above> } }
 *   → { success: true, requestId, config }   (only provided fields are written)
 *
 * Per-request reviewer-engagement campaign config persisted as DISCRETE columns on
 * `akoya_request` (provisioned 2026-06-21, wave7-reviewer-engagement) so the Phase-3
 * reminder cron and Phase-4 quota sweep can OData $filter server-side. Written first on
 * the initial invite-batch send (send-emails.js); this route is the "editable later from
 * the Reviewers tab" surface (spec §3.E). `quotaNotifiedAt` is a Phase-4 system marker —
 * READ-ONLY here; the route refuses to write it.
 *
 * Auth: same boundary as the rest of the review-manager reviewer surface —
 * requireAppAccess('review-manager','reviewers') + bypassDynamicsRestrictions (reviewer
 * outreach is a foundation-owned, staff-shared workflow, not user-private). requestId is
 * GUID-validated before it reaches a Dataverse selector (trust-boundary-guid).
 */

import { requireAppAccess } from '../../../lib/utils/auth';
import { isGuid } from '../../../lib/utils/guid';
import { DynamicsService } from '../../../lib/services/dynamics-service';
import { bypassDynamicsRestrictions } from '../../../lib/services/dynamics-context';

// camelCase field → { Dataverse column, value kind }. quotaNotifiedAt is intentionally
// absent from the WRITABLE set (system marker, read-only).
const WRITABLE_FIELDS = {
  respondOffsetDays: { col: 'wmkf_respondoffsetdays', kind: 'int' },
  reviewDueDate: { col: 'wmkf_reviewduedate', kind: 'date' },
  respondReminderEnabled: { col: 'wmkf_respondreminderenabled', kind: 'bool' },
  respondReminderLeadDays: { col: 'wmkf_respondreminderleaddays', kind: 'int' },
  reviewDueReminderEnabled: { col: 'wmkf_reviewduereminderenabled', kind: 'bool' },
  reviewDueReminderLeadDays: { col: 'wmkf_reviewduereminderleaddays', kind: 'int' },
  desiredCount: { col: 'wmkf_desiredcount', kind: 'int' },
};

const READ_SELECT = [
  'akoya_requestid',
  ...Object.values(WRITABLE_FIELDS).map((f) => f.col),
  'wmkf_quotanotifiedat',
].join(',');

function isYmd(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function readConfig(rec) {
  return {
    respondOffsetDays: rec?.wmkf_respondoffsetdays ?? null,
    reviewDueDate: rec?.wmkf_reviewduedate ?? null,
    respondReminderEnabled: rec?.wmkf_respondreminderenabled ?? null,
    respondReminderLeadDays: rec?.wmkf_respondreminderleaddays ?? null,
    reviewDueReminderEnabled: rec?.wmkf_reviewduereminderenabled ?? null,
    reviewDueReminderLeadDays: rec?.wmkf_reviewduereminderleaddays ?? null,
    desiredCount: rec?.wmkf_desiredcount ?? null,
    quotaNotifiedAt: rec?.wmkf_quotanotifiedat ?? null,
  };
}

// Validate + coerce a single provided field. Returns { col, value } or throws a
// caller-facing message. `null` is allowed (explicitly clears the column).
function coerceField(name, raw) {
  const spec = WRITABLE_FIELDS[name];
  if (!spec) throw new Error(`Unknown or read-only config field: ${name}`);
  if (raw === null) return { col: spec.col, value: null };
  if (spec.kind === 'int') {
    if (!Number.isInteger(raw) || raw < 0) throw new Error(`${name} must be a non-negative integer`);
    return { col: spec.col, value: raw };
  }
  if (spec.kind === 'bool') {
    if (typeof raw !== 'boolean') throw new Error(`${name} must be a boolean`);
    return { col: spec.col, value: raw };
  }
  if (spec.kind === 'date') {
    if (!isYmd(raw)) throw new Error(`${name} must be a YYYY-MM-DD date or null`);
    return { col: spec.col, value: raw };
  }
  throw new Error(`Unhandled field kind for ${name}`);
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const access = await requireAppAccess(req, res, 'review-manager', 'reviewers');
  if (!access) return;

  const actingUserSystemId = access.session?.user?.dynamicsSystemuserId || null;

  const requestId = req.method === 'GET'
    ? (typeof req.query.requestId === 'string' ? req.query.requestId.trim() : '')
    : (typeof req.body?.requestId === 'string' ? req.body.requestId.trim() : '');
  if (!isGuid(requestId)) {
    return res.status(400).json({ error: 'requestId must be a GUID' });
  }

  return bypassDynamicsRestrictions('review-manager-campaign-config', async () => {
    try {
      if (req.method === 'GET') {
        let rec;
        try {
          rec = await DynamicsService.getRecord('akoya_requests', requestId, { select: READ_SELECT });
        } catch {
          rec = null;
        }
        if (!rec?.akoya_requestid) {
          return res.status(404).json({ error: `No request found for ${requestId}` });
        }
        return res.status(200).json({ requestId, config: readConfig(rec) });
      }

      // POST — build the patch from only the provided, valid fields.
      const config = req.body?.config;
      if (!config || typeof config !== 'object' || Array.isArray(config)) {
        return res.status(400).json({ error: 'config object is required' });
      }
      const patch = {};
      try {
        for (const [name, raw] of Object.entries(config)) {
          if (raw === undefined) continue;
          const { col, value } = coerceField(name, raw);
          patch[col] = value;
        }
      } catch (validationErr) {
        return res.status(400).json({ error: validationErr.message });
      }
      if (Object.keys(patch).length === 0) {
        return res.status(400).json({ error: 'config must contain at least one editable field' });
      }

      // Confirm the request exists before writing (a 404 from updateRecord is opaque).
      let rec;
      try {
        rec = await DynamicsService.getRecord('akoya_requests', requestId, { select: READ_SELECT });
      } catch {
        rec = null;
      }
      if (!rec?.akoya_requestid) {
        return res.status(404).json({ error: `No request found for ${requestId}` });
      }

      await DynamicsService.updateRecord('akoya_requests', requestId, patch, { actingUserSystemId });

      const merged = { ...readConfig(rec) };
      for (const [name, raw] of Object.entries(config)) {
        if (raw !== undefined && WRITABLE_FIELDS[name]) merged[name] = raw;
      }
      return res.status(200).json({ success: true, requestId, config: merged });
    } catch (error) {
      console.error('campaign-config error:', error);
      return res.status(500).json({ error: 'Failed to read or write campaign config' });
    }
  });
}
