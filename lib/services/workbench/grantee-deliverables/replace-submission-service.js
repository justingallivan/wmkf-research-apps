/**
 * Workbench grantee-deliverables — STAFF replacement of what the grantee returned.
 *
 * Holds all business logic for POST /api/workbench/grantee-deliverables/
 * replace-submission (S412); the route is a thin shell (method, auth, multipart
 * parse, GUID validation, DAL context, HTTP mapping).
 *
 * WHY THIS EXISTS, and why it is not a second caller of writeGranteeDeliverables:
 * revisions are agreed with the grantee case-by-case over email rather than
 * through a built `Revision Requested` transition (owner decision 2026-08-10, see
 * docs/GRANTEE_SUBMIT_VISIBILITY_SPEC.md). The grantee therefore never re-enters
 * the portal, and staff need to put the agreed change in themselves — but the
 * portal writer is welded to grantee consent: it REQUIRES an acknowledged waiver
 * version and fails closed without one (grantee-upload.js:85-88), and it re-stamps
 * status to Submitted (:139). A staff replacement has no acknowledgment to supply
 * and must not move status. Hence a separate, narrower writer.
 *
 * The original waiver STANDS for a staff replacement (owner decision 2026-08-10):
 * consent is assigned at first submission and a resubmission is a narrow agreed
 * change. This service therefore never writes any waiver field — structurally, not
 * just by convention, since `patchDeliverable` whitelists the fields it will send
 * and the waiver fields are not among them (grantee-deliverable-record.js:100-108).
 *
 * The SharePoint filename pattern is deliberately IDENTICAL to the portal
 * writer's `{reqNum}_grantee_image_{nonce}.{ext}`. It is not cosmetic:
 *   - the staff image proxy's filename allowlist is the only validation on that
 *     path, and it matches exactly this pattern (image-service.js:37);
 *   - the prior-image cleanup resolves the stored ref through that same parser.
 * A `staff_image_` variant would 404 the inline image AND escape the prune. If a
 * staff-substitution marker is ever wanted, add a FIELD — never change the name.
 *
 * Contract: plain args; returns a plain 200 body; throws ServiceHttpError.
 * ASSUMES a trusted DAL context already exists.
 */

import { randomBytes } from 'crypto';
import * as grantRequestAdapter from '../../../dataverse/adapters/grant-request.js';
import { GraphService } from '../../graph-service.js';
import { scanBytes } from '../../cloudmersive-scan.js';
import { isVirusScanEnabled } from '../../../utils/virus-scan-config.js';
import { validateGranteeImage } from '../../../utils/file-magic.js';
import { cleanupSharePointItems } from '../../sharepoint-cleanup.js';
import { getDeliverableForRequest, patchDeliverable } from '../../grantee-deliverable-record.js';
import { GRANTEE_LIBRARY, granteeUploadFolder, MAX_IMAGE_BYTES } from '../../grantee-upload.js';
import { imageFilenameFromRef } from './image-service.js';
import {
  GRANTEE_DELIVERABLE_LABEL,
  isStaffReplaceableStatus,
} from '../../../../shared/config/granteeDeliverableStatus.js';
import { ServiceHttpError } from '../../service-http-error.js';

const REQUEST_SELECT = 'akoya_requestid,akoya_requestnum';
const IMAGE_CONTENT_TYPE = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' };

const normStatus = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

const statusLabelOf = (status) =>
  (status !== null ? (GRANTEE_DELIVERABLE_LABEL[status] || null) : null);

/**
 * Replace the grantee-returned image and/or caption on behalf of the grantee,
 * after an off-portal (email) agreement.
 *
 * @param {Object} args
 * @param {string} args.requestId - GUID, already validated by the shell.
 * @param {string|null} args.caption - new caption, or null to leave it unchanged.
 * @param {{ buffer: Buffer, filename: string }|null} args.imageFile - new image,
 *   or null to leave the existing one.
 * @param {string} args.clientEtag - the deliverable etag the client loaded.
 * @param {string|null} [args.actingUserSystemId]
 * @returns {Promise<{ ok: true, caption: string|null, imageRef: string|null,
 *   etag: string|null, status: number|null, statusLabel: string|null }>}
 * @throws {ServiceHttpError}
 */
export async function replaceGranteeSubmission({
  requestId, caption, imageFile, clientEtag, actingUserSystemId = null,
}) {
  const wantsCaption = caption !== null && caption !== undefined;
  const cap = wantsCaption ? String(caption).trim() : null;

  if (!wantsCaption && !imageFile) {
    throw new ServiceHttpError('Nothing to replace.', {
      httpStatus: 400,
      body: { error: 'Provide a new image, a new caption, or both.' },
    });
  }
  // Never blank the record through this path — same rule the abstract PUT applies
  // to the published text. Clearing a caption is not a replacement.
  if (wantsCaption && !cap) {
    throw new ServiceHttpError('Caption cannot be empty.', {
      httpStatus: 400,
      body: { error: 'The caption cannot be empty.' },
    });
  }
  // Fail closed: without the loaded etag the write cannot be conditional.
  if (!clientEtag) {
    throw new ServiceHttpError('etag is required for a conditional replace', {
      httpStatus: 400,
      body: { error: 'etag is required for a conditional replace' },
    });
  }

  let row;
  try {
    row = await grantRequestAdapter.getById(requestId, { select: REQUEST_SELECT });
  } catch {
    row = null;
  }
  if (!row?.akoya_requestid || !row?.akoya_requestnum) {
    throw new ServiceHttpError(`No request found for ${requestId}`, { httpStatus: 404 });
  }

  // Fresh server read of the status — never trust a client-supplied one.
  const deliverable = await getDeliverableForRequest(requestId);
  if (!deliverable?.wmkf_granteedeliverableid) {
    throw new ServiceHttpError('No grantee deliverable package for this request.', {
      httpStatus: 404,
      body: { error: 'No grantee deliverable package for this request.' },
    });
  }
  const status = normStatus(deliverable.wmkf_deliverablestatus);
  if (!isStaffReplaceableStatus(status)) {
    throw new ServiceHttpError('package not replaceable in current status', {
      httpStatus: 409,
      code: 'not_replaceable',
      body: {
        code: 'not_replaceable',
        error: `This package cannot be edited in its current status (${statusLabelOf(status) || 'Not started'}).`,
        status,
        statusLabel: statusLabelOf(status),
      },
    });
  }

  // Resolve the exact pre-write ref once. If it is not one of our server-minted
  // filenames, leave it alone: an orphan is safer than deleting a referenced
  // image based on a folder-wide pattern.
  const priorImageFilename = imageFilenameFromRef(deliverable.wmkf_imagefileref);
  const folder = granteeUploadFolder(row.akoya_requestnum, row.akoya_requestid);
  let uploadedItem = null;
  let driveId = null;
  let newImageRef = null;

  if (imageFile) {
    if (!Buffer.isBuffer(imageFile.buffer) || imageFile.buffer.length === 0) {
      throw new ServiceHttpError('Empty image.', { httpStatus: 400, body: { error: 'The image file is empty.' } });
    }
    if (imageFile.buffer.length > MAX_IMAGE_BYTES) {
      throw new ServiceHttpError('Image too large.', { httpStatus: 400, body: { error: 'The image is too large.' } });
    }
    // Magic-byte validation — the declared extension must match the bytes. Same
    // check the portal writer applies; staff upload is not more trusted than the
    // grantee's, because the bytes end up in the same published place.
    const v = validateGranteeImage(imageFile.filename || '', imageFile.buffer);
    if (!v.ok) {
      throw new ServiceHttpError('Invalid image.', {
        httpStatus: 400,
        body: { error: 'That file is not a valid PNG, JPEG, or WebP image.' },
      });
    }

    if (isVirusScanEnabled()) {
      let scan;
      try {
        scan = await scanBytes(imageFile.buffer, imageFile.filename);
      } catch (e) {
        console.error('[grantee-deliverables/replace] scan failed:', e.message);
        throw e.isTransient
          ? new ServiceHttpError('Virus scan unavailable.', { httpStatus: 503, body: { error: 'Virus scan unavailable — try again shortly.' } })
          : new ServiceHttpError('Virus scan misconfigured.', { httpStatus: 500, body: { error: 'Virus scan is misconfigured.' } });
      }
      if (scan?.scan_result !== 'clean') {
        throw new ServiceHttpError('Infected file.', { httpStatus: 422, body: { error: 'That file did not pass the virus scan.' } });
      }
    }

    // Server-controlled + unique, byte-identical to the portal writer's pattern
    // (see the header note — the proxy allowlist and the prune both depend on it).
    const newFilename = `${row.akoya_requestnum}_grantee_image_${randomBytes(4).toString('hex')}.${v.ext}`;
    try {
      driveId = await GraphService.getDriveId(GRANTEE_LIBRARY);
      uploadedItem = await GraphService.uploadFile(
        GRANTEE_LIBRARY, folder, newFilename, imageFile.buffer,
        IMAGE_CONTENT_TYPE[v.type] || 'application/octet-stream',
      );
    } catch (e) {
      console.error('[grantee-deliverables/replace] sharepoint upload failed:', e.message);
      if (uploadedItem) await cleanupSharePointItems(driveId, [uploadedItem], 'grantee-replace');
      throw new ServiceHttpError('SharePoint upload failed.', {
        httpStatus: 502,
        body: { error: 'Could not upload the image to SharePoint.' },
      });
    }
    newImageRef = uploadedItem.webUrl || `${folder}/${newFilename}`;
  }

  const patch = {};
  if (cap !== null) patch.wmkf_imagecaption = cap;
  if (newImageRef) patch.wmkf_imagefileref = newImageRef;

  // Conditional single-row PATCH. Only the package row changes: no status write,
  // no waiver write, and the request row (the abstract) is not touched — staff
  // edit that through the abstract PUT, which owns its own concurrency story.
  //
  // The rollback below mirrors grantee-upload.js:158-193 rather than sharing it:
  // the semantics differ (one-row PATCH vs a two-row changeset, and no status
  // term), and extracting a shared helper would touch the live grantee submit
  // path for no behavioral gain.
  try {
    await patchDeliverable(requestId, patch, { ifMatch: clientEtag, actingUserSystemId });
  } catch (e) {
    if (e.status === 412 || /\b412\b/.test(e.message || '')) {
      // Stale etag → nothing committed. Safe to remove the upload.
      if (uploadedItem) await cleanupSharePointItems(driveId, [uploadedItem], 'grantee-replace');
      throw new ServiceHttpError('stale replace', {
        httpStatus: 409,
        code: 'stale',
        body: {
          code: 'stale',
          error: 'This package changed since you loaded it. Reload and re-apply your change.',
        },
      });
    }
    // Non-412: normally nothing committed, but a response drop AFTER a
    // server-side commit is possible. Re-read for every request shape, including
    // caption-only writes, and compare every field this call requested.
    //
    // NOTE the difference from the portal writer: it confirms a commit by testing
    // the image ref AND status === SUBMITTED. This path does not write status, so
    // testing it would misclassify a genuine commit as `not_committed` and delete
    // a referenced image. The requested caption/ref values alone are the evidence.
    let state = 'not_committed';
    try {
      const after = await getDeliverableForRequest(requestId);
      const captionCommitted = !wantsCaption || after?.wmkf_imagecaption === cap;
      const imageCommitted = !newImageRef || after?.wmkf_imagefileref === newImageRef;
      state = captionCommitted && imageCommitted ? 'committed' : 'not_committed';
    } catch (reReadErr) {
      state = 'unknown';
      console.error('[grantee-deliverables/replace] post-error re-read failed; leaving upload in place:', reReadErr?.message || reReadErr);
    }
    if (state === 'not_committed' && uploadedItem) {
      await cleanupSharePointItems(driveId, [uploadedItem], 'grantee-replace');
    } else if (state === 'committed') {
      console.warn('[grantee-deliverables/replace] patch threw but write committed (response drop); returning success');
      return await successBody({ requestId, status });
    }
    // 'unknown' → leave any upload. A possible orphan beats deleting a referenced image.
    console.error('[grantee-deliverables/replace] patch failed:', e.message);
    throw new ServiceHttpError('Failed to save the replacement.', {
      httpStatus: 502,
      body: { error: 'Could not save the replacement.' },
    });
  }

  // Best-effort: retire only the exact pre-write image now that the new one is
  // committed. A folder-wide sweep can delete a later concurrent winner, so an
  // unrecognized ref or missing item is deliberately left orphaned. Cleanup
  // failures remain non-fatal because the Dataverse write already committed.
  if (imageFile && priorImageFilename) {
    try {
      const existing = await GraphService.listFiles(GRANTEE_LIBRARY, folder);
      const priorItems = (existing || []).filter((it) => it.name === priorImageFilename);
      if (priorItems.length) {
        if (!driveId) driveId = await GraphService.getDriveId(GRANTEE_LIBRARY);
        await cleanupSharePointItems(driveId, priorItems, 'grantee-replace-orphan');
      }
    } catch (e) {
      console.error('[grantee-deliverables/replace] stale-image prune failed (non-fatal):', e.message);
    }
  }

  return await successBody({ requestId, status });
}

/**
 * Re-read the package for the committed values + a fresh etag, so the client can
 * make a second replacement without a full reload. Non-fatal: a failed re-read
 * returns nulls rather than turning a committed write into a reported failure.
 */
async function successBody({ requestId, status }) {
  let after = null;
  try {
    after = await getDeliverableForRequest(requestId);
  } catch { /* client can reload for a fresh etag */ }
  return {
    ok: true,
    caption: after?.wmkf_imagecaption || null,
    imageRef: after?.wmkf_imagefileref || null,
    etag: after?._etag || null,
    status,
    statusLabel: statusLabelOf(status),
  };
}
