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
import { DynamicsService } from './dynamics-service.js';
import { GraphService } from './graph-service.js';
import { scanBytes } from './cloudmersive-scan.js';
import { isVirusScanEnabled } from '../utils/virus-scan-config.js';
import { validateGranteeImage } from '../utils/file-magic.js';
import { cleanupSharePointItems } from './sharepoint-cleanup.js';
import { patchDeliverable } from './grantee-deliverable-record.js';
import { GRANTEE_DELIVERABLE_STATUS } from '../../shared/config/granteeDeliverableStatus.js';

const GRANTEE_LIBRARY = 'akoya_request';
const GRANTEE_SUBFOLDER = 'Grantee_Uploads';
const MIN_ABSTRACT_CHARS = 20;
export const MAX_IMAGE_BYTES = 15 * 1024 * 1024; // 15 MB

const IMAGE_CONTENT_TYPE = { png: 'image/png', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
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
 * @returns {Promise<{ ok: true } | { ok: false, reason: string, status: number }>}
 */
export async function writeGranteeDeliverables({ request, deliverable, editedAbstract, caption, imageFile }) {
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

  const patch = {
    wmkf_abstractapproved: abstract,
  };
  const deliverablePatch = {
    wmkf_imagecaption: cap,
    wmkf_deliverablestatus: GRANTEE_DELIVERABLE_STATUS.SUBMITTED,
  };
  if (newImageRef) deliverablePatch.wmkf_imagefileref = newImageRef;

  // Conditional (ETag) PATCH; roll back the new upload on any failure.
  try {
    await DynamicsService.updateRecord('akoya_requests', requestId, patch, { ifMatch: request._etag });
    await patchDeliverable(requestId, deliverablePatch, { ifMatch: deliverable._etag });
  } catch (e) {
    if (uploadedItem) await cleanupSharePointItems(driveId, [uploadedItem], 'grantee-upload');
    if (e.status === 412) return { ok: false, reason: 'conflict', status: 409 };
    console.error('[grantee-upload] dataverse patch failed:', e.message);
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
