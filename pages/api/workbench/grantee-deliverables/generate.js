/**
 * API: POST /api/workbench/grantee-deliverables/generate
 *
 * Chunk 3 of the Grantee Deliverables Portal (docs/GRANTEE_PORTAL_BUILD_PLAN.md).
 * Staff-initiated from the workbench Awardee tab: generate a house-style rewrite
 * of the applicant abstract (akoya_request.wmkf_abstract) via the chunk-2 service
 * and PERSIST it to wmkf_abstractformatted, stamping status -> Drafted.
 *
 * Idempotency (Option B, Codex pre-impl approved — full lease/nonce is overkill
 * for this low-volume, single-staff action, and wmkf_abstractformatted holds
 * human-readable prose, not a JSON envelope that could carry a lease sentinel):
 *   - reuse-existing: if wmkf_abstractformatted is already populated and
 *     regenerate !== true, return it (no paid call).
 *   - ETag-conditional write: the only Dataverse write is a PATCH with If-Match
 *     on the row's _etag — a concurrent write 412s (re-read → return existing 200,
 *     or 409 if still empty). Refuse to write without an _etag (no bare PATCH).
 *   - status non-downgrade: stamp Drafted ONLY when the current status is
 *     null/empty or already Drafted — never downgrade Invited/Submitted/etc.
 *
 * AUTH: requireAppAccess('reviewers') (matches the triage workbench-write
 * precedent). Generating a draft is a staff workbench op, not the authoritative
 * visibility decision triage protects, so no lead-PD gate. requestId is
 * GUID-validated straight off req.body before it becomes a Dataverse selector.
 */

import { requireAppAccess } from '../../../../lib/utils/auth';
import { DynamicsService } from '../../../../lib/services/dynamics-service';
import { bypassDynamicsRestrictions } from '../../../../lib/services/dynamics-context';
import { loadModelOverrides } from '../../../../lib/services/model-override-loader';
import { isGuid } from '../../../../lib/utils/guid';
import { generateGranteeAbstract } from '../../../../lib/services/grantee-abstract-service';
import {
  ensureDeliverableForRequest,
  patchDeliverable,
} from '../../../../lib/services/grantee-deliverable-record';
import { GRANTEE_DELIVERABLE_STATUS, GRANTEE_DELIVERABLE_LABEL } from '../../../../shared/config/granteeDeliverableStatus';

export const config = {
  api: { bodyParser: { sizeLimit: '8kb' } },
};

const REQUEST_SELECT = 'akoya_requestid,akoya_requestnum,wmkf_abstract,wmkf_abstractformatted';
const MIN_SOURCE_CHARS = 50;

const normStatus = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const access = await requireAppAccess(req, res, 'reviewers');
  if (!access) return;

  // Read requestId directly off req.body (not via an intermediate var) so the
  // trust-boundary-guid gate tracks the taint root through to the isGuid guard.
  const requestId = typeof req.body?.requestId === 'string' ? req.body.requestId.trim() : '';
  // Only a strict boolean true forces regeneration — a string "false" must not.
  const regenerate = req.body?.regenerate === true;

  // GUID-validate BEFORE requestId becomes a record-id selector (check:trust-boundary-guid).
  if (!isGuid(requestId)) {
    return res.status(400).json({ error: 'requestId must be a GUID' });
  }

  return bypassDynamicsRestrictions('grantee-abstract-generate', async () => {
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

      const deliverable = await ensureDeliverableForRequest(requestId, {
        requestNumber: row.akoya_requestnum,
        actingUserSystemId: access.session?.user?.dynamicsSystemuserId || null,
      });
      const currentStatus = normStatus(deliverable?.wmkf_deliverablestatus);
      const existingFormatted = (row.wmkf_abstractformatted || '').trim();

      // Reuse-existing — no paid call unless the caller explicitly regenerates.
      if (existingFormatted && !regenerate) {
        if (currentStatus === null && deliverable?.wmkf_granteedeliverableid) {
          await patchDeliverable(requestId, {
            wmkf_deliverablestatus: GRANTEE_DELIVERABLE_STATUS.DRAFTED,
          }, {
            ifMatch: deliverable._etag,
            actingUserSystemId: access.session?.user?.dynamicsSystemuserId || null,
          });
        }
        const status = currentStatus === null ? GRANTEE_DELIVERABLE_STATUS.DRAFTED : currentStatus;
        return res.status(200).json({
          abstractFormatted: existingFormatted,
          persisted: true,
          reused: true,
          status,
          statusLabel: status !== null ? (GRANTEE_DELIVERABLE_LABEL[status] || null) : null,
        });
      }

      const source = (row.wmkf_abstract || '').trim();
      if (source.length < MIN_SOURCE_CHARS) {
        return res.status(400).json({ error: 'This request has no applicant abstract (wmkf_abstract) to rewrite.' });
      }

      // Fail closed: without an _etag the write can't be conditional, so we refuse
      // rather than risk a bare last-write PATCH.
      if (!row._etag) {
        return res.status(503).json({ error: 'Could not acquire a write lock; please try again.' });
      }

      // Warm the model-override cache only on the generation path (skip the
      // reuse / early-return paths). Awaited before the service -> Executor
      // resolves a model. check:model-override-warming.
      await loadModelOverrides();

      let gen;
      try {
        gen = await generateGranteeAbstract({ sourceAbstract: source, runSource: 'Vercel Interactive' });
      } catch (e) {
        console.error('[grantee-deliverables/generate] generation failed:', e.message);
        return res.status(500).json({ error: 'Abstract generation failed.' });
      }

      // Status non-downgrade: only stamp Drafted from null/empty or already-Drafted.
      const patch = { wmkf_abstractformatted: gen.abstractFormatted };

      try {
        await DynamicsService.updateRecord('akoya_requests', row.akoya_requestid, patch, {
          ifMatch: row._etag,
          actingUserSystemId: access.session?.user?.dynamicsSystemuserId || null,
        });
      } catch (e) {
        if (e.status === 412) {
          // Concurrent write won the race. Prefer the now-stored value; if still
          // empty, ask the caller to retry rather than leaking the raw 412.
          const re = await DynamicsService.getRecord('akoya_requests', requestId, {
            select: 'wmkf_abstractformatted',
          });
          const reFormatted = (re.wmkf_abstractformatted || '').trim();
          if (reFormatted) {
            const reDeliverable = await ensureDeliverableForRequest(requestId, {
              requestNumber: row.akoya_requestnum,
              actingUserSystemId: access.session?.user?.dynamicsSystemuserId || null,
            });
            const reStatus = normStatus(reDeliverable?.wmkf_deliverablestatus);
            return res.status(200).json({
              abstractFormatted: reFormatted, persisted: true, reused: true, concurrent: true,
              status: reStatus,
              statusLabel: reStatus !== null ? (GRANTEE_DELIVERABLE_LABEL[reStatus] || null) : null,
            });
          }
          return res.status(409).json({ error: 'A concurrent update is in progress; please retry.' });
        }
        console.error('[grantee-deliverables/generate] persist failed:', e.message);
        return res.status(500).json({ error: 'Failed to save the generated abstract.' });
      }

      let newStatus = currentStatus;
      if (currentStatus === null || currentStatus === GRANTEE_DELIVERABLE_STATUS.DRAFTED) {
        await patchDeliverable(requestId, {
          wmkf_deliverablestatus: GRANTEE_DELIVERABLE_STATUS.DRAFTED,
        }, {
          ifMatch: deliverable._etag,
          actingUserSystemId: access.session?.user?.dynamicsSystemuserId || null,
        });
        newStatus = GRANTEE_DELIVERABLE_STATUS.DRAFTED;
      }
      return res.status(200).json({
        abstractFormatted: gen.abstractFormatted,
        persisted: true,
        regenerated: regenerate && !!existingFormatted,
        status: newStatus,
        statusLabel: newStatus !== null ? (GRANTEE_DELIVERABLE_LABEL[newStatus] || null) : null,
        runId: gen.runId,
        model: gen.model,
      });
    } catch (error) {
      console.error('[grantee-deliverables/generate] error:', error);
      return res.status(500).json({ error: 'Failed to generate the grantee abstract.' });
    }
  });
}
