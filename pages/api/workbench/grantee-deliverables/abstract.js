/**
 * API: /api/workbench/grantee-deliverables/abstract
 *
 * Lets a Program Director review + EDIT + SAVE the grantee award abstract that
 * will be PUBLISHED, from the Workbench Awardee tab (S278). The published body is
 * `wmkf_abstractapproved ?? wmkf_abstractformatted`
 * (lib/services/grantee-document-assembly.js:123-132), so the editable target is
 * the "effective" field:
 *   - before grantee submission: wmkf_abstractformatted (the AI/PD draft)
 *   - after grantee submission:  wmkf_abstractapproved (grantee-approved → published)
 *
 *   GET ?requestId=  -> { abstractFormatted, abstractApproved, effective,
 *                         effectiveField, etag, status, statusLabel, editable }
 *   PUT { requestId, text, etag, baseField }
 *
 * Design (Codex pre-impl review, S278):
 *  - Effective field is derived from a FRESH SERVER READ, never the client's
 *    `baseField` (which is only a stale-edit consistency check).
 *  - Provenance guard: only writes `wmkf_abstractapproved` when it is already
 *    non-empty (i.e. the grantee has submitted). Staff text never lands in the
 *    grantee-authored field before a submission (docs/GRANTEE_PORTAL_SPEC.md).
 *  - Concurrency: If-Match uses the etag the CLIENT loaded (not a fresh-read
 *    etag), so a grantee submit / concurrent staff save / regenerate that landed
 *    during the (human-timescale) edit window 412s -> 409 reload. A `baseField`
 *    mismatch (effective field flipped draft->approved since load) also 409s.
 *  - Status gate (Safe default, owner decision S278): draft editable in
 *    null/DRAFTED/INVITED/REMINDER_SENT; approved editable in SUBMITTED/STAFF_REVIEW
 *    only. REVISION_REQUESTED is blocked (a grantee resubmit would silently
 *    overwrite the fix); COMPLETE/CLOSED_NO_RESPONSE are blocked.
 *  - Never touches `wmkf_deliverablestatus` (status transitions are owned by
 *    generate / send-invite / submit).
 *  - Never blanks the field (empty text -> 400).
 *
 * AUTH: requireAppAccess('reviewers') (matches the other grantee-deliverable
 * workbench routes). requestId GUID-validated off req.body/req.query before it
 * becomes a record selector (check:trust-boundary-guid).
 */

import { requireAppAccess } from '../../../../lib/utils/auth';
import { DynamicsService } from '../../../../lib/services/dynamics-service';
import { bypassDynamicsRestrictions } from '../../../../lib/services/dynamics-context';
import { isGuid } from '../../../../lib/utils/guid';
import { getDeliverableForRequest } from '../../../../lib/services/grantee-deliverable-record';
import {
  GRANTEE_DELIVERABLE_STATUS,
  GRANTEE_DELIVERABLE_LABEL,
} from '../../../../shared/config/granteeDeliverableStatus';

export const config = {
  api: { bodyParser: { sizeLimit: '32kb' } },
};

const REQUEST_SELECT = 'akoya_requestid,wmkf_abstractformatted,wmkf_abstractapproved';
const MAX_TEXT = 20000;

const normStatus = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

// Statuses in which the DRAFT (wmkf_abstractformatted) may be edited by staff.
// null is allowed (pre-Drafted). Safe default, S278.
const DRAFT_EDITABLE = new Set([
  GRANTEE_DELIVERABLE_STATUS.DRAFTED,
  GRANTEE_DELIVERABLE_STATUS.INVITED,
  GRANTEE_DELIVERABLE_STATUS.REMINDER_SENT,
]);
// Statuses in which the APPROVED (wmkf_abstractapproved) version may be edited by
// staff. Excludes REVISION_REQUESTED (a grantee resubmit would clobber the fix),
// COMPLETE and CLOSED_NO_RESPONSE.
const APPROVED_EDITABLE = new Set([
  GRANTEE_DELIVERABLE_STATUS.SUBMITTED,
  GRANTEE_DELIVERABLE_STATUS.STAFF_REVIEW,
]);

// Which field a save lands in, decided from the fresh-read row: the grantee's
// approved text once it exists, else the draft. Mirrors the publish precedence.
function resolveTarget(row) {
  const approved = (row.wmkf_abstractapproved || '').trim();
  if (approved) {
    return { which: 'approved', field: 'wmkf_abstractapproved', text: row.wmkf_abstractapproved };
  }
  return { which: 'formatted', field: 'wmkf_abstractformatted', text: row.wmkf_abstractformatted || '' };
}

function isEditable(which, status) {
  if (which === 'approved') return APPROVED_EDITABLE.has(status);
  return status === null || DRAFT_EDITABLE.has(status);
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'PUT') {
    res.setHeader('Allow', 'GET, PUT');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const access = await requireAppAccess(req, res, 'reviewers');
  if (!access) return;

  if (req.method === 'GET') {
    // GUID-validate BEFORE requestId becomes a record-id selector.
    const requestId = typeof req.query?.requestId === 'string' ? req.query.requestId.trim() : '';
    if (!isGuid(requestId)) {
      return res.status(400).json({ error: 'requestId must be a GUID' });
    }
    return bypassDynamicsRestrictions('grantee-abstract-load', async () => {
      try {
        let row;
        try {
          row = await DynamicsService.getRecord('akoya_requests', requestId, { select: REQUEST_SELECT });
        } catch {
          row = null;
        }
        if (!row?.akoya_requestid) {
          return res.status(404).json({ error: `No request found for ${requestId}` });
        }
        const target = resolveTarget(row);
        const deliverable = await getDeliverableForRequest(requestId);
        const status = normStatus(deliverable?.wmkf_deliverablestatus);
        return res.status(200).json({
          abstractFormatted: row.wmkf_abstractformatted || '',
          abstractApproved: row.wmkf_abstractapproved || '',
          effective: target.text || '',
          effectiveField: target.which,
          etag: row._etag || null,
          status,
          statusLabel: status !== null ? (GRANTEE_DELIVERABLE_LABEL[status] || null) : null,
          editable: isEditable(target.which, status),
        });
      } catch (error) {
        console.error('[grantee-deliverables/abstract] load error:', error);
        return res.status(500).json({ error: 'Failed to load the abstract.' });
      }
    });
  }

  // PUT — save a PD edit.
  // Read requestId directly off req.body so the trust-boundary-guid gate tracks
  // the taint root through to the isGuid guard.
  const requestId = typeof req.body?.requestId === 'string' ? req.body.requestId.trim() : '';
  if (!isGuid(requestId)) {
    return res.status(400).json({ error: 'requestId must be a GUID' });
  }

  const text = typeof req.body?.text === 'string' ? req.body.text : null;
  const clientEtag = typeof req.body?.etag === 'string' ? req.body.etag.trim() : '';
  const baseField = req.body?.baseField === 'approved' || req.body?.baseField === 'formatted'
    ? req.body.baseField
    : null;

  if (text === null) {
    return res.status(400).json({ error: 'text is required' });
  }
  if (!text.trim()) {
    // Never blank the published abstract through this path.
    return res.status(400).json({ error: 'The abstract cannot be empty.' });
  }
  if (text.length > MAX_TEXT) {
    return res.status(400).json({ error: `The abstract is too long (max ${MAX_TEXT} characters).` });
  }
  // Fail closed: without the loaded etag the write can't be conditional, so we
  // refuse rather than risk a bare last-write PATCH.
  if (!clientEtag) {
    return res.status(400).json({ error: 'etag is required for a conditional save' });
  }

  return bypassDynamicsRestrictions('grantee-abstract-save', async () => {
    try {
      let row;
      try {
        row = await DynamicsService.getRecord('akoya_requests', requestId, { select: REQUEST_SELECT });
      } catch {
        row = null;
      }
      if (!row?.akoya_requestid) {
        return res.status(404).json({ error: `No request found for ${requestId}` });
      }

      // Effective target from the FRESH read (not the client's claim).
      const target = resolveTarget(row);
      const deliverable = await getDeliverableForRequest(requestId);
      const status = normStatus(deliverable?.wmkf_deliverablestatus);

      // Stale-edit guard: if the effective field flipped since the client loaded
      // (e.g. the grantee submitted, draft -> approved), the edit was made against
      // the wrong version — reload rather than write a draft edit over a fresh
      // grantee submission.
      if (baseField && baseField !== target.which) {
        return res.status(409).json({
          code: 'stale',
          error: 'The abstract changed since you loaded it (the grantee may have submitted). Reload and re-apply your edit.',
          currentField: target.which,
        });
      }

      // Status gate (Safe default, S278).
      if (!isEditable(target.which, status)) {
        return res.status(409).json({
          code: 'not_editable',
          error: `This abstract cannot be edited in its current status (${status !== null ? (GRANTEE_DELIVERABLE_LABEL[status] || status) : 'Not started'}).`,
          status,
          statusLabel: status !== null ? (GRANTEE_DELIVERABLE_LABEL[status] || null) : null,
        });
      }

      try {
        await DynamicsService.updateRecord(
          'akoya_requests',
          row.akoya_requestid,
          { [target.field]: text },
          {
            ifMatch: clientEtag,
            actingUserSystemId: access.session?.user?.dynamicsSystemuserId || null,
          },
        );
      } catch (e) {
        if (e.status === 412) {
          // Something wrote the row since the client loaded it.
          return res.status(409).json({
            code: 'stale',
            error: 'The abstract changed since you loaded it. Reload and re-apply your edit.',
          });
        }
        console.error('[grantee-deliverables/abstract] save failed:', e.message);
        return res.status(500).json({ error: 'Failed to save the abstract.' });
      }

      // Re-read for the new etag so the PD can keep editing without a reload.
      let newEtag = null;
      try {
        const after = await DynamicsService.getRecord('akoya_requests', requestId, { select: 'akoya_requestid' });
        newEtag = after._etag || null;
      } catch { /* non-fatal; client can reload to get a fresh etag */ }

      return res.status(200).json({
        ok: true,
        field: target.which,
        etag: newEtag,
        status,
        statusLabel: status !== null ? (GRANTEE_DELIVERABLE_LABEL[status] || null) : null,
      });
    } catch (error) {
      console.error('[grantee-deliverables/abstract] save error:', error);
      return res.status(500).json({ error: 'Failed to save the abstract.' });
    }
  });
}
