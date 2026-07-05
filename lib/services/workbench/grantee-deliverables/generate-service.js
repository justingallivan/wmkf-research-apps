/**
 * Workbench grantee-deliverables — staff abstract generation service
 * (Route→Service Consolidation Plan, Stage 4 series C).
 *
 * Holds ALL business logic for POST /api/workbench/grantee-deliverables/
 * generate (chunk 3); the route is a thin shell (method, auth, GUID
 * validation, DAL context, HTTP mapping).
 *
 * Idempotency (Option B, Codex pre-impl approved) preserved verbatim:
 *   - reuse-existing: populated wmkf_abstractformatted + regenerate !== true
 *     → return it, no paid call (and no model-override warm);
 *   - ETag-conditional write only (If-Match; refuse without an _etag → 503);
 *   - 412 → re-read → 200 reused/concurrent, or 409 if still empty;
 *   - status non-downgrade: stamp Drafted only from null/Drafted.
 *
 * Contract (plan Decision 3): plain args, plain 200 bodies (reuse / generated
 * variants); throws ServiceHttpError with default `{ error }` bodies —
 * 404 request, 400 missing source, 503 no write lock, 500 generation failed,
 * 409 concurrent, 500 persist failed. ASSUMES a trusted DAL context.
 */

import * as grantRequestAdapter from '../../../dataverse/adapters/grant-request.js';
import { loadModelOverrides } from '../../model-override-loader';
import { generateGranteeAbstract } from '../../grantee-abstract-service';
import {
  ensureDeliverableForRequest,
  patchDeliverable,
} from '../../grantee-deliverable-record';
import { GRANTEE_DELIVERABLE_STATUS, GRANTEE_DELIVERABLE_LABEL } from '../../../../shared/config/granteeDeliverableStatus';
import { ServiceHttpError } from '../../service-http-error';

const REQUEST_SELECT = 'akoya_requestid,akoya_requestnum,wmkf_abstract,wmkf_abstractformatted';
const MIN_SOURCE_CHARS = 50;

const normStatus = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

/**
 * @param {Object} args
 * @param {string} args.requestId - GUID (already validated by the shell)
 * @param {boolean} args.regenerate - strict boolean (shell-coerced)
 * @param {string|null} args.actingUserSystemId
 * @returns {Promise<Object>} the 200 response body
 * @throws {ServiceHttpError} per the historical status codes
 */
export async function generateDeliverableAbstract({ requestId, regenerate, actingUserSystemId }) {
  let row;
  try {
    row = await grantRequestAdapter.getById(requestId, { select: REQUEST_SELECT });
  } catch {
    row = null;
  }
  if (!row?.akoya_requestid) {
    throw new ServiceHttpError(`No request found for ${requestId}`, { httpStatus: 404 });
  }

  const deliverable = await ensureDeliverableForRequest(requestId, {
    requestNumber: row.akoya_requestnum,
    actingUserSystemId,
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
        actingUserSystemId,
      });
    }
    const status = currentStatus === null ? GRANTEE_DELIVERABLE_STATUS.DRAFTED : currentStatus;
    return {
      abstractFormatted: existingFormatted,
      persisted: true,
      reused: true,
      status,
      statusLabel: status !== null ? (GRANTEE_DELIVERABLE_LABEL[status] || null) : null,
    };
  }

  const source = (row.wmkf_abstract || '').trim();
  if (source.length < MIN_SOURCE_CHARS) {
    throw new ServiceHttpError('This request has no applicant abstract (wmkf_abstract) to rewrite.', { httpStatus: 400 });
  }

  // Fail closed: without an _etag the write can't be conditional, so we refuse
  // rather than risk a bare last-write PATCH.
  if (!row._etag) {
    throw new ServiceHttpError('Could not acquire a write lock; please try again.', { httpStatus: 503 });
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
    throw new ServiceHttpError('Abstract generation failed.', { httpStatus: 500 });
  }

  // Status non-downgrade: only stamp Drafted from null/empty or already-Drafted.
  const patch = { wmkf_abstractformatted: gen.abstractFormatted };

  try {
    await grantRequestAdapter.updateById(row.akoya_requestid, patch, {
      ifMatch: row._etag,
      actingUserSystemId,
    });
  } catch (e) {
    if (e.status === 412) {
      // Concurrent write won the race. Prefer the now-stored value; if still
      // empty, ask the caller to retry rather than leaking the raw 412.
      const re = await grantRequestAdapter.getById(requestId, {
        select: 'wmkf_abstractformatted',
      });
      const reFormatted = (re.wmkf_abstractformatted || '').trim();
      if (reFormatted) {
        const reDeliverable = await ensureDeliverableForRequest(requestId, {
          requestNumber: row.akoya_requestnum,
          actingUserSystemId,
        });
        const reStatus = normStatus(reDeliverable?.wmkf_deliverablestatus);
        return {
          abstractFormatted: reFormatted, persisted: true, reused: true, concurrent: true,
          status: reStatus,
          statusLabel: reStatus !== null ? (GRANTEE_DELIVERABLE_LABEL[reStatus] || null) : null,
        };
      }
      throw new ServiceHttpError('A concurrent update is in progress; please retry.', { httpStatus: 409 });
    }
    console.error('[grantee-deliverables/generate] persist failed:', e.message);
    throw new ServiceHttpError('Failed to save the generated abstract.', { httpStatus: 500 });
  }

  let newStatus = currentStatus;
  if (currentStatus === null || currentStatus === GRANTEE_DELIVERABLE_STATUS.DRAFTED) {
    await patchDeliverable(requestId, {
      wmkf_deliverablestatus: GRANTEE_DELIVERABLE_STATUS.DRAFTED,
    }, {
      ifMatch: deliverable._etag,
      actingUserSystemId,
    });
    newStatus = GRANTEE_DELIVERABLE_STATUS.DRAFTED;
  }
  return {
    abstractFormatted: gen.abstractFormatted,
    persisted: true,
    regenerated: regenerate && !!existingFormatted,
    status: newStatus,
    statusLabel: newStatus !== null ? (GRANTEE_DELIVERABLE_LABEL[newStatus] || null) : null,
    runId: gen.runId,
    model: gen.model,
  };
}
