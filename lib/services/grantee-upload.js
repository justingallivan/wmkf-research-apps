/**
 * Grantee deliverables upload service (chunk 5).
 *
 * Atomic persist of a grantee submission — parallel grantee variant of
 * review-upload.js (NOT a mutation of it). The caller (the submit route) has
 * already verified the token, status-guarded (editable allowlist), and parsed
 * the multipart body; this service validates + scans + uploads the image, then
 * conditionally PATCHes Dataverse with rollback.
 *
 * Image filename is SERVER-CONTROLLED and UNIQUE: `{reqNum}_grantee_image_{nonce}.{ext}`.
 * Server-controlled → the attacker-supplied filename is ignored. Unique (not a
 * deterministic overwrite) → a PATCH-failure rollback deletes ONLY the new file,
 * leaving the prior image (which the un-updated Dataverse ref still points to)
 * intact. On PATCH success we best-effort prune the prior image (orphan cleanup).
 */

import { randomBytes } from 'crypto';
import { GraphService } from './graph-service.js';
import { scanBytes } from './cloudmersive-scan.js';
import { isVirusScanEnabled } from '../utils/virus-scan-config.js';
import { validateGranteeImage } from '../utils/file-magic.js';
import { cleanupSharePointItems } from './sharepoint-cleanup.js';
import { getDeliverableForRequest, GRANTEE_DELIVERABLE_ENTITY_SET } from './grantee-deliverable-record.js';
import { runChangeset } from '../dataverse/core/changeset.js';
import { GRANTEE_DELIVERABLE_STATUS } from '../../shared/config/granteeDeliverableStatus.js';

const REQUEST_ENTITY_SET = 'akoya_requests';

const GRANTEE_LIBRARY = 'akoya_request';
const GRANTEE_SUBFOLDER = 'Grantee_Uploads';
const MIN_ABSTRACT_CHARS = 20;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB (mirror the client-side check in GranteeDeliverableForm)

const IMAGE_CONTENT_TYPE = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' };
const requestFolderName = (num, id) => `${num}_${id.replace(/-/g, '').toUpperCase()}`;

/**
 * @param {Object} args
 * @param {Object} args.request - verified akoya_request row: akoya_requestid,
 *   akoya_requestnum, _etag
 * @param {Object} args.deliverable - read-only package row with image/status fields.
 * @param {string} args.editedAbstract
 * @param {string} args.caption
 * @param {{ buffer: Buffer, filename: string }|null} args.imageFile - new image, or
 *   null to keep an existing one
 * @param {string} args.waiverVersionId - the wmkf_policyversion GUID the grantee
 *   acknowledged (resolved server-side from the signed render token; recorded on
 *   the deliverable row as the consent-of-record). Required.
 * @returns {Promise<{ ok: true } | { ok: false, reason: string, status: number }>}
 */
export async function writeGranteeDeliverables({ request, deliverable, editedAbstract, caption, imageFile, waiverVersionId }) {
  const requestId = request?.akoya_requestid;
  const requestNum = request?.akoya_requestnum;
  if (!requestId || !requestNum || !deliverable?.wmkf_granteedeliverableid) {
    return { ok: false, reason: 'not_found', status: 404 };
  }

  const abstract = (editedAbstract || '').trim();
  const cap = (caption || '').trim();
  if (abstract.length < MIN_ABSTRACT_CHARS) return { ok: false, reason: 'abstract_required', status: 400 };
  if (!cap) return { ok: false, reason: 'caption_required', status: 400 };

  const hasExistingImage = Boolean(deliverable.wmkf_imagefileref);
  if (!imageFile && !hasExistingImage) return { ok: false, reason: 'image_required', status: 400 };

  // The conditional PATCH needs an ETag; fail closed rather than a bare last-write.
  if (!request._etag || !deliverable._etag) return { ok: false, reason: 'no_etag', status: 503 };

  // The acknowledged waiver version is the consent-of-record; the route resolves
  // it from the signed render token before calling us. Missing here = a bug or a
  // bypassed route — fail closed rather than record a submission without consent.
  if (!waiverVersionId) return { ok: false, reason: 'policy_misconfigured', status: 500 };

  const folder = `${requestFolderName(requestNum, requestId)}/${GRANTEE_SUBFOLDER}`;
  let uploadedItem = null;
  let driveId = null;
  let newImageRef = null;
  let newFilename = null;

  if (imageFile) {
    if (!Buffer.isBuffer(imageFile.buffer) || imageFile.buffer.length === 0) {
      return { ok: false, reason: 'empty_image', status: 400 };
    }
    if (imageFile.buffer.length > MAX_IMAGE_BYTES) {
      return { ok: false, reason: 'image_too_large', status: 400 };
    }
    // Magic-byte validation (declared extension must match the bytes).
    const v = validateGranteeImage(imageFile.filename || '', imageFile.buffer);
    if (!v.ok) return { ok: false, reason: 'image_invalid', status: 400 };

    // Virus scan — soft-pass when disabled (no SharePoint downstream scanner).
    if (isVirusScanEnabled()) {
      let scan;
      try {
        scan = await scanBytes(imageFile.buffer, imageFile.filename);
      } catch (e) {
        console.error('[grantee-upload] scan failed:', e.message);
        return e.isTransient
          ? { ok: false, reason: 'scan_unavailable', status: 503 }
          : { ok: false, reason: 'scan_misconfigured', status: 500 };
      }
      if (scan?.scan_result !== 'clean') return { ok: false, reason: 'infected', status: 422 };
    }

    // Server-controlled, unique filename (attacker name ignored; ext from magic).
    newFilename = `${requestNum}_grantee_image_${randomBytes(4).toString('hex')}.${v.ext}`;
    try {
      driveId = await GraphService.getDriveId(GRANTEE_LIBRARY);
      uploadedItem = await GraphService.uploadFile(
        GRANTEE_LIBRARY, folder, newFilename, imageFile.buffer,
        IMAGE_CONTENT_TYPE[v.type] || 'application/octet-stream',
      );
    } catch (e) {
      console.error('[grantee-upload] sharepoint upload failed:', e.message);
      if (uploadedItem) await cleanupSharePointItems(driveId, [uploadedItem], 'grantee-upload');
      return { ok: false, reason: 'sharepoint_failed', status: 502 };
    }
    newImageRef = uploadedItem.webUrl || `${folder}/${newFilename}`;
  }

  const deliverablePatch = {
    wmkf_imagecaption: cap,
    wmkf_deliverablestatus: GRANTEE_DELIVERABLE_STATUS.SUBMITTED,
    // Consent-of-record: pin the exact waiver version the grantee acknowledged.
    'wmkf_WaiverPolicyVersion@odata.bind': `/wmkf_policyversions(${waiverVersionId})`,
    wmkf_waiverackedat: new Date().toISOString(),
  };
  if (newImageRef) deliverablePatch.wmkf_imagefileref = newImageRef;

  // Atomic Dataverse write: the akoya_request (abstract) and wmkf_granteedeliverable
  // (status/caption/image/waiver) PATCHes commit together or not at all. Each op
  // carries its own If-Match, so a stale ETag on EITHER row rolls back the whole
  // changeset (no partial submit). SharePoint is OUTSIDE this changeset, so the
  // catch below reconciles the cross-store seam. External flow → no acting user.
  const ops = [
    { method: 'PATCH', entitySet: REQUEST_ENTITY_SET, key: requestId, body: { wmkf_abstractapproved: abstract }, ifMatch: request._etag },
    { method: 'PATCH', entitySet: GRANTEE_DELIVERABLE_ENTITY_SET, key: deliverable.wmkf_granteedeliverableid, body: deliverablePatch, ifMatch: deliverable._etag },
  ];
  try {
    await runChangeset(ops);
  } catch (e) {
    const is412 = e.status === 412 || /\b412\b/.test(e.message || '');
    if (is412) {
      // Stale ETag on either row → nothing committed. Safe to remove the upload.
      if (uploadedItem) await cleanupSharePointItems(driveId, [uploadedItem], 'grantee-upload');
      return { ok: false, reason: 'conflict', status: 409 };
    }
    // Non-412: the changeset is atomic, so a throw normally means NOTHING
    // committed — but a response drop AFTER a server-side commit is possible.
    // Never delete an image a committed row may now reference: re-read first.
    if (uploadedItem) {
      let state = 'not_committed';
      try {
        const after = await getDeliverableForRequest(requestId);
        state = (after?.wmkf_imagefileref === newImageRef
          && Number(after?.wmkf_deliverablestatus) === GRANTEE_DELIVERABLE_STATUS.SUBMITTED)
          ? 'committed' : 'not_committed';
      } catch (reReadErr) {
        state = 'unknown';
        console.error('[grantee-upload] post-error re-read failed; leaving upload in place:', reReadErr?.message || reReadErr);
      }
      if (state === 'not_committed') {
        await cleanupSharePointItems(driveId, [uploadedItem], 'grantee-upload');
      } else if (state === 'committed') {
        // The write actually landed despite the thrown response — surface success
        // (the deliverable references the uploaded image; deleting it would break it).
        console.warn('[grantee-upload] changeset threw but write committed (response drop); returning success');
        return { ok: true };
      }
      // 'unknown' → leave the item (a possible orphan beats deleting a referenced image).
    }
    console.error('[grantee-upload] dataverse changeset failed:', e.message);
    return { ok: false, reason: 'dataverse_failed', status: 502 };
  }

  // Best-effort: retire a prior image now that the new one is committed. Orphan
  // cleanup, never data loss — logged and swallowed on failure.
  if (imageFile && hasExistingImage) {
    try {
      const existing = await GraphService.listFiles(GRANTEE_LIBRARY, folder);
      // Exclude the just-uploaded item by ID (exact) rather than by filename — the
      // new file's name is a random nonce, so an id compare is the robust guard.
      const stale = (existing || []).filter((it) => /grantee_image_/i.test(it.name) && it.id !== uploadedItem?.id);
      if (stale.length) {
        if (!driveId) driveId = await GraphService.getDriveId(GRANTEE_LIBRARY);
        await cleanupSharePointItems(driveId, stale, 'grantee-upload-orphan');
      }
    } catch (e) {
      console.error('[grantee-upload] stale-image prune failed (non-fatal):', e.message);
    }
  }

  return { ok: true };
}
