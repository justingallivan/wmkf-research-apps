/**
 * Slice 0 Preview-only proof for browser-direct Graph upload and non-buffered
 * playback/download. This module deliberately has no durable application
 * schema. The upload permit is authenticated encryption bound to the creating
 * profile; cleanup preserves that retry authority unless cancellation or exact
 * item deletion is confirmed. The public playback token is a five-minute,
 * audience-scoped JWT.
 */

import crypto from 'node:crypto';
import * as grantRequestAdapter from '../../dataverse/adapters/grant-request.js';
import { classifyDeployment } from '../../dataverse/core/interlock.js';
import { GraphService } from '../graph-service.js';
import { ServiceHttpError } from '../service-http-error.js';
import { mintScopedToken, verifyToken } from '../external-token.js';
import { getRequestSharePointBuckets } from '../../utils/sharepoint-buckets.js';
import { isGuid } from '../../utils/guid.js';

export const PROOF_AUDIENCE = 'presentation-media-proof';
export const PROOF_OPERATION = 'view_presentation_media_proof';
// Keep proof fragments at Graph's 320 KiB alignment unit so the disposable
// browser test does not depend on a long-lived single PUT. Production sizing
// remains a follow-on decision.
export const PROOF_CHUNK_BYTES = 320 * 1024;
export const PROOF_MIN_BYTES = 50 * 1024 * 1024 + 1;
export const PROOF_MAX_BYTES = 2_000_000_000;
const PROOF_TOKEN_MS = 5 * 60 * 1000;
const CLEANUP_GRACE_MS = 24 * 60 * 60 * 1000;
const PERMIT_CONTEXT = 'presentation-media-proof-upload-v1';
const VIEW_CONTEXT = 'presentation-media-proof-view-v1';
const REQUEST_SELECT = ['akoya_requestid', 'akoya_requestnum'];

const DEFAULT_DEPENDENCIES = Object.freeze({
  deployment: classifyDeployment,
  getRequest: (requestId) => grantRequestAdapter.getById(requestId, { select: REQUEST_SELECT }),
  getBuckets: (requestId, requestNumber) => getRequestSharePointBuckets(
    requestId,
    requestNumber,
    { requireResolvedParents: true },
  ),
  ensureFolder: (...args) => GraphService.ensureFolderPath(...args),
  createSession: (...args) => GraphService.createBrowserUploadSession(...args),
  getSessionStatus: (...args) => GraphService.getBrowserUploadSessionStatus(...args),
  cancelSession: (...args) => GraphService.cancelBrowserUploadSession(...args),
  getByPath: (...args) => GraphService.getFileMetadataByPath(...args),
  getById: (...args) => GraphService.getFileMetadataById(...args),
  readRange: (...args) => GraphService.readMediaRange(...args),
  resolveMedia: (...args) => GraphService.resolveMediaDownloadUrl(...args),
  deleteFile: (...args) => GraphService.deleteFile(...args),
  mint: mintScopedToken,
  verify: verifyToken,
  now: () => new Date(),
  randomUUID: () => crypto.randomUUID(),
  secret: () => process.env.EXTERNAL_LINK_SECRET,
});

function proofError(message, code, httpStatus = 409) {
  return new ServiceHttpError(message, { httpStatus, code, body: { error: message, code } });
}

export function assertPreviewProofDeployment(dependencies = DEFAULT_DEPENDENCIES) {
  if (dependencies.deployment() !== 'preview') {
    throw proofError('Not found.', 'presentation_media_proof_not_found', 404);
  }
}

function safeDisplayName(value) {
  const name = String(value || '').split(/[\\/]/).pop().trim();
  if (!name || name.length > 180 || !/\.mp4$/i.test(name)) {
    throw proofError('Choose an MP4 recording.', 'presentation_media_proof_file_invalid', 400);
  }
  return name.replace(/[\r\n"]/g, '');
}

function validateBeginInput({ requestId, profileId, filename, mimeType, size, lastModified }) {
  if (!isGuid(requestId)) throw proofError('A valid request id is required.', 'presentation_media_proof_request_invalid', 400);
  if (profileId === null || profileId === undefined || profileId === '') {
    throw proofError('Your authenticated profile could not be resolved.', 'presentation_media_proof_profile_required', 403);
  }
  const displayName = safeDisplayName(filename);
  if (mimeType !== 'video/mp4') throw proofError('The proof accepts video/mp4 only.', 'presentation_media_proof_mime_invalid', 400);
  const bytes = Number(size);
  if (!Number.isInteger(bytes) || bytes < PROOF_MIN_BYTES || bytes > PROOF_MAX_BYTES) {
    throw proofError('Choose an MP4 larger than 50 MB and no larger than 2,000,000,000 bytes.', 'presentation_media_proof_size_invalid', 400);
  }
  const modified = Number(lastModified);
  if (!Number.isFinite(modified) || modified <= 0) {
    throw proofError('The selected file has no valid modification timestamp.', 'presentation_media_proof_file_invalid', 400);
  }
  return { displayName, bytes, modified };
}

function encryptionKey(secretValue, context) {
  const secret = String(secretValue || '');
  if (secret.length < 32) throw new Error('EXTERNAL_LINK_SECRET is not configured for the Preview proof');
  return crypto.createHash('sha256').update(`${context}\0${secret}`).digest();
}

function sealPayload(payload, dependencies, context) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(dependencies.secret(), context), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url');
}

function openPayload(value, dependencies, context) {
  const bytes = Buffer.from(String(value || ''), 'base64url');
  if (bytes.length < 29) throw new Error('short encrypted payload');
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    encryptionKey(dependencies.secret(), context),
    bytes.subarray(0, 12),
  );
  decipher.setAuthTag(bytes.subarray(12, 28));
  const plaintext = Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8');
  return JSON.parse(plaintext);
}

function sealPermit(payload, dependencies) {
  return sealPayload(payload, dependencies, PERMIT_CONTEXT);
}

function openPermit(value, dependencies) {
  try {
    const permit = openPayload(value, dependencies, PERMIT_CONTEXT);
    if (permit?.v !== 1 || !Number.isFinite(permit.exp) || permit.exp <= dependencies.now().getTime()) {
      throw new Error('expired permit');
    }
    return permit;
  } catch {
    throw proofError('The upload proof is invalid or expired.', 'presentation_media_proof_permit_invalid', 401);
  }
}

function requirePermit(value, profileId, dependencies) {
  const permit = openPermit(value, dependencies);
  if (String(permit.profileId) !== String(profileId)) {
    throw proofError('This upload belongs to another staff session.', 'presentation_media_proof_permit_forbidden', 403);
  }
  return permit;
}

function assertPathItemIdentity(permit, item) {
  const size = Number(item?.size);
  if (!item?.id
    || item.driveId !== permit.driveId
    || item.name !== permit.physicalFilename
    || !Number.isInteger(size)
    || size < 0
    || size > permit.size) {
    throw proofError('The committed SharePoint item does not match the upload proof.', 'presentation_media_proof_identity_mismatch', 409);
  }
  return size;
}

async function resolveCommittedItem(permit, dependencies) {
  const item = await dependencies.getByPath(
    permit.library,
    permit.folderPath,
    permit.physicalFilename,
    { siteId: permit.siteId, driveId: permit.driveId },
  );
  if (!item) return null;
  if (assertPathItemIdentity(permit, item) !== permit.size) {
    throw proofError('The committed SharePoint item does not match the upload proof.', 'presentation_media_proof_identity_mismatch', 409);
  }
  return item;
}

export async function beginPresentationMediaProofUpload(input, dependencies = DEFAULT_DEPENDENCIES) {
  assertPreviewProofDeployment(dependencies);
  const { displayName, bytes, modified } = validateBeginInput(input);
  const request = await dependencies.getRequest(input.requestId);
  if (!request || String(request.akoya_requestid).toLowerCase() !== input.requestId.toLowerCase()) {
    throw proofError('The request could not be resolved.', 'presentation_media_proof_request_not_found', 404);
  }
  const buckets = await dependencies.getBuckets(input.requestId, request.akoya_requestnum);
  const bucket = buckets.find((candidate) => candidate.source === 'dynamics');
  if (!bucket) throw proofError('The request has no governed SharePoint location.', 'presentation_media_proof_location_missing', 409);

  const proofId = dependencies.randomUUID();
  // One governed container plus a collision-resistant create-only filename
  // avoids leaving an empty per-attempt folder when an upload is cancelled.
  const folderPath = `${bucket.folder}/Artifacts/Presentation Media Proof`;
  const physicalFilename = `${proofId}.mp4`;
  const folder = await dependencies.ensureFolder(bucket.library, folderPath);
  const session = await dependencies.createSession(bucket.library, folderPath, physicalFilename, {
    conflictBehavior: 'fail',
    siteId: folder.siteId,
    driveId: folder.driveId,
  });
  const sessionExpiry = Date.parse(session.expiresAt);
  if (!Number.isFinite(sessionExpiry) || sessionExpiry <= dependencies.now().getTime()) {
    throw new Error('Graph returned an invalid upload-session expiry');
  }
  const permit = sealPermit({
    v: 1,
    exp: sessionExpiry + CLEANUP_GRACE_MS,
    sessionExpiresAt: sessionExpiry,
    proofId,
    profileId: String(input.profileId),
    requestId: input.requestId,
    requestNumber: request.akoya_requestnum,
    library: bucket.library,
    folderPath,
    physicalFilename,
    displayName,
    mimeType: input.mimeType,
    size: bytes,
    lastModified: modified,
    siteId: session.siteId,
    driveId: session.driveId,
    uploadUrl: session.uploadUrl,
  }, dependencies);
  return {
    permit,
    uploadUrl: session.uploadUrl,
    expiresAt: session.expiresAt,
    nextExpectedRanges: session.nextExpectedRanges,
    chunkBytes: PROOF_CHUNK_BYTES,
    file: { name: displayName, size: bytes, lastModified: modified },
  };
}

export async function getPresentationMediaProofUploadStatus({ permit: value, profileId }, dependencies = DEFAULT_DEPENDENCIES) {
  assertPreviewProofDeployment(dependencies);
  const permit = requirePermit(value, profileId, dependencies);
  const item = await dependencies.getByPath(
    permit.library,
    permit.folderPath,
    permit.physicalFilename,
    { siteId: permit.siteId, driveId: permit.driveId },
  );
  if (item && assertPathItemIdentity(permit, item) === permit.size) {
    return { complete: true, canFinalize: true, file: { name: permit.displayName, size: permit.size, lastModified: permit.lastModified } };
  }
  // SharePoint can expose a same-path, partial-size placeholder while the
  // preauthenticated upload session is still live. It is not a committed
  // file: only the upload-session ranges are authoritative for resume.
  if (permit.sessionExpiresAt <= dependencies.now().getTime()) {
    throw proofError('The Graph upload session expired before the file committed.', 'presentation_media_proof_session_expired', 410);
  }
  let status;
  try {
    status = await dependencies.getSessionStatus(permit.uploadUrl);
  } catch (error) {
    if ([404, 410].includes(error?.status)) {
      throw proofError('The Graph upload session expired before the file committed.', 'presentation_media_proof_session_expired', 410);
    }
    throw error;
  }
  return {
    complete: false,
    canFinalize: false,
    uploadUrl: permit.uploadUrl,
    expiresAt: status.expiresAt,
    nextExpectedRanges: status.nextExpectedRanges,
    chunkBytes: PROOF_CHUNK_BYTES,
    file: { name: permit.displayName, size: permit.size, lastModified: permit.lastModified },
  };
}

function hasMp4Ftyp(bytes) {
  return Buffer.isBuffer(bytes) && bytes.length >= 12 && bytes.subarray(4, 8).toString('ascii') === 'ftyp';
}

function decodeProofSubject(value, dependencies) {
  try {
    const parsed = openPayload(value, dependencies, VIEW_CONTEXT);
    if (parsed?.v !== 1 || !isGuid(parsed.requestId) || !parsed.driveId || !parsed.itemId
      || !parsed.physicalFilename || !parsed.displayName || !Number.isInteger(parsed.size)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function finalizePresentationMediaProofUpload({ permit: value, profileId }, dependencies = DEFAULT_DEPENDENCIES) {
  assertPreviewProofDeployment(dependencies);
  const permit = requirePermit(value, profileId, dependencies);
  const item = await resolveCommittedItem(permit, dependencies);
  if (!item) throw proofError('Finish the browser upload before creating the playback proof.', 'presentation_media_proof_upload_incomplete', 409);
  const signature = await dependencies.readRange(item.driveId, item.id, { start: 0, end: 31 });
  if (!hasMp4Ftyp(signature.bytes)) {
    throw proofError('The uploaded file does not have an MP4 ftyp signature.', 'presentation_media_proof_signature_invalid', 415);
  }
  if (signature.malware) {
    throw proofError('Microsoft flagged this file as unsafe.', 'presentation_media_proof_malware', 409);
  }
  const claims = {
    v: 1,
    requestId: permit.requestId,
    driveId: item.driveId,
    itemId: item.id,
    physicalFilename: permit.physicalFilename,
    displayName: permit.displayName,
    size: permit.size,
  };
  const expiresAt = new Date(dependencies.now().getTime() + PROOF_TOKEN_MS);
  const { jwt } = await dependencies.mint({
    subject: sealPayload(claims, dependencies, VIEW_CONTEXT),
    audience: PROOF_AUDIENCE,
    ops: [PROOF_OPERATION],
    expiresAt,
  });
  return {
    proofUrl: `/external/presentation-media-proof/${jwt}`,
    expiresAt: expiresAt.toISOString(),
    file: { name: permit.displayName, size: permit.size },
  };
}

export async function cleanupPresentationMediaProofUpload({ permit: value, profileId }, dependencies = DEFAULT_DEPENDENCIES) {
  assertPreviewProofDeployment(dependencies);
  const permit = requirePermit(value, profileId, dependencies);
  let cancellationError = null;
  let cancellation = null;
  try {
    cancellation = await dependencies.cancelSession(permit.uploadUrl);
  } catch (error) {
    // A committed session is already closed, so an exact committed item can
    // still make cleanup authoritative. If no item exists, however, the
    // caller must retain the permit: another browser tab may still commit.
    cancellationError = error;
  }
  const item = await dependencies.getByPath(
    permit.library,
    permit.folderPath,
    permit.physicalFilename,
    { siteId: permit.siteId, driveId: permit.driveId },
  );
  const itemSize = item ? assertPathItemIdentity(permit, item) : null;
  if (item && itemSize === permit.size) {
    await dependencies.deleteFile(item.driveId, item.id);
    return { cleaned: true, cleanupOutcome: 'item_deleted', deletedItem: true };
  }
  if (cancellationError) {
    throw proofError(
      'Microsoft did not confirm that the upload session was cancelled. Retry cleanup with the retained permit.',
      'presentation_media_proof_cleanup_uncertain',
      502,
    );
  }
  const sessionTerminal = ['cancelled', 'gone', 'expired'].includes(cancellation?.outcome);
  if (item && sessionTerminal) {
    // Graph may leave a smaller same-path placeholder after a terminal
    // session. Only the exact server-chosen path and stable item may be
    // removed; a live or uncertain session never grants this authority.
    await dependencies.deleteFile(item.driveId, item.id);
    return { cleaned: true, cleanupOutcome: 'placeholder_deleted', deletedItem: true };
  }
  if (cancellation?.outcome === 'cancelled') {
    return { cleaned: true, cleanupOutcome: 'session_cancelled', deletedItem: false };
  }
  if (cancellation?.outcome === 'gone') {
    return { cleaned: true, cleanupOutcome: 'session_gone', deletedItem: false };
  }
  if (cancellation?.outcome === 'expired') {
    return { cleaned: true, cleanupOutcome: 'session_expired', deletedItem: false };
  }
  throw proofError(
    'Microsoft returned an unknown cancellation result. Retry cleanup with the retained permit.',
    'presentation_media_proof_cleanup_uncertain',
    502,
  );
}

export async function verifyPresentationMediaProofToken(jwt, dependencies = DEFAULT_DEPENDENCIES) {
  assertPreviewProofDeployment(dependencies);
  const verified = await dependencies.verify(jwt);
  if (!verified.valid) return { ok: false, reason: verified.reason };
  if (verified.payload.aud !== PROOF_AUDIENCE
    || !Array.isArray(verified.payload.ops)
    || verified.payload.ops.length !== 1
    || verified.payload.ops[0] !== PROOF_OPERATION) {
    return { ok: false, reason: 'invalid_claim' };
  }
  const claims = decodeProofSubject(verified.payload.subject, dependencies);
  if (!claims) return { ok: false, reason: 'malformed' };
  return { ok: true, claims, expiresAt: new Date(verified.payload.exp * 1000).toISOString() };
}

async function assertProofItem(claims, dependencies) {
  const item = await dependencies.getById(claims.driveId, claims.itemId);
  if (!item || item.name !== claims.physicalFilename || Number(item.size) !== claims.size) {
    throw proofError('The proof media is not available.', 'presentation_media_proof_media_not_found', 404);
  }
  return item;
}

export async function getPresentationMediaProofContext({ claims, expiresAt }, dependencies = DEFAULT_DEPENDENCIES) {
  assertPreviewProofDeployment(dependencies);
  await assertProofItem(claims, dependencies);
  return {
    ok: true,
    title: 'Presentation media transport proof',
    filename: claims.displayName,
    size: claims.size,
    expiresAt,
  };
}

export async function resolvePresentationMediaProof({ claims }, dependencies = DEFAULT_DEPENDENCIES) {
  assertPreviewProofDeployment(dependencies);
  await assertProofItem(claims, dependencies);
  const media = await dependencies.resolveMedia(claims.driveId, claims.itemId);
  if (media.itemId !== claims.itemId || media.filename !== claims.physicalFilename || media.size !== claims.size) {
    throw proofError('The proof media identity changed.', 'presentation_media_proof_identity_mismatch', 409);
  }
  if (media.malware) throw proofError('Microsoft flagged this file as unsafe.', 'presentation_media_proof_malware', 409);
  return media;
}

export { DEFAULT_DEPENDENCIES as PRESENTATION_MEDIA_PROOF_DEPENDENCIES };
