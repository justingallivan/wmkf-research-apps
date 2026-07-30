/**
 * Grantee deliverable package row helper.
 *
 * The package lifecycle moved off akoya_request into wmkf_granteedeliverable.
 * Abstract fields remain on akoya_request; this helper owns only
 * status/image/caption/invited/reminded data and the request relationship.
 */

import * as granteeDeliverableAdapter from '../dataverse/adapters/grantee-deliverable.js';

export const GRANTEE_DELIVERABLE_ENTITY_SET = 'wmkf_granteedeliverables';

export const DELIVERABLE_SELECT = [
  'wmkf_granteedeliverableid',
  'wmkf_name',
  '_wmkf_request_value',
  'wmkf_deliverablestatus',
  'wmkf_imagefileref',
  'wmkf_imagecaption',
  'wmkf_inviteddate',
  'wmkf_remindeddate',
  // Stamped inside the same submit changeset as the caption/image, so it is the
  // de-facto submission time — there is no wmkf_submitteddate field. Read-only
  // here: the waiver fields are written by lib/services/grantee-upload.js and
  // are deliberately absent from patchDeliverable's field allowlist.
  'wmkf_waiverackedat',
].join(',');

function normalizeRequestId(requestId) {
  return typeof requestId === 'string' ? requestId.trim() : '';
}

function isAltKeyConflict(err) {
  return err?.status === 409 || err?.status === 412
    || /duplicate|already exists|matching key values|alternate key|0x80060892|0x80040237/i.test(err?.message || '');
}

/**
 * Read the deliverable row for a request. Never creates.
 *
 * Missing row is a valid "not started" state and callers must treat it as not
 * editable unless a staff write path explicitly ensures the row.
 */
export async function getDeliverableForRequest(requestId) {
  const id = normalizeRequestId(requestId);
  if (!id) return null;

  const { records } = await granteeDeliverableAdapter.queryDeliverables(`_wmkf_request_value eq ${id}`, {
    select: DELIVERABLE_SELECT,
    orderby: 'modifiedon desc',
    top: 2,
  });
  return records?.[0] || null;
}

/**
 * Find or create the request's deliverable row. Staff write paths only.
 *
 * The Dataverse alternate key on wmkf_request is the race guard; if another
 * writer creates first, recover by re-reading the existing row.
 */
export async function ensureDeliverableForRequest(requestId, { requestNumber, actingUserSystemId } = {}) {
  const id = normalizeRequestId(requestId);
  if (!id) throw new Error('ensureDeliverableForRequest: requestId required');

  const existing = await getDeliverableForRequest(id);
  if (existing) return existing;

  const payload = {
    wmkf_name: requestNumber ? `Request ${requestNumber} Deliverable` : `Request ${id} Deliverable`,
    'wmkf_Request@odata.bind': `/akoya_requests(${id})`,
  };

  try {
    return await granteeDeliverableAdapter.create(payload, {
      actingUserSystemId,
    });
  } catch (err) {
    if (isAltKeyConflict(err)) {
      const reread = await getDeliverableForRequest(id);
      if (reread) return reread;
    }
    throw err;
  }
}

/**
 * Patch only the package-owned fields. `requestId` is resolved through the
 * relationship so callers do not need to know the package row id.
 */
export async function patchDeliverable(requestId, fields, { ifMatch, actingUserSystemId } = {}) {
  const row = await getDeliverableForRequest(requestId);
  if (!row?.wmkf_granteedeliverableid) {
    const err = new Error(`No grantee deliverable row for request ${requestId}`);
    err.status = 404;
    throw err;
  }

  const patch = {};
  for (const key of [
    'wmkf_deliverablestatus',
    'wmkf_imagefileref',
    'wmkf_imagecaption',
    'wmkf_inviteddate',
    'wmkf_remindeddate',
  ]) {
    if (Object.prototype.hasOwnProperty.call(fields || {}, key)) patch[key] = fields[key];
  }

  await granteeDeliverableAdapter.update(
    row.wmkf_granteedeliverableid,
    patch,
    { ifMatch: ifMatch || row._etag, actingUserSystemId },
  );
  return { ...row, ...patch };
}
