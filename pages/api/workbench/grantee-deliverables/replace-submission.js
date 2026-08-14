/**
 * API: POST /api/workbench/grantee-deliverables/replace-submission
 *
 * Lets staff replace the image and/or caption the grantee returned, after a
 * revision agreed off-portal over email (owner decision 2026-08-10 — revisions
 * are case-by-case rather than a built `Revision Requested` transition, so the
 * grantee never comes back to the portal to do it themselves).
 *
 * multipart/form-data: fields `requestId`, optional `caption`, optional `etag`;
 * at most one file part (the new image). At least one of caption/image required.
 *
 * Thin shell (Route→Service Consolidation Plan P1 template): method → auth →
 * multipart parse → GUID validation → withDalContext → one service call → error
 * mapping. All status-gate, upload, concurrency, rollback, and prune logic lives
 * in lib/services/workbench/grantee-deliverables/replace-submission-service.js.
 *
 * AUTH: requireAppAccess('reviewers') — matches every sibling grantee-deliverable
 * workbench route. requestId is GUID-validated off the parsed multipart fields
 * before it becomes a record selector (check:trust-boundary-guid).
 *
 * This route WRITES private grantee material to SharePoint and Dataverse. It does
 * not touch deliverable status and cannot touch the waiver fields.
 */

import Busboy from 'busboy';
import { requireAppAccess } from '../../../../lib/utils/auth';
import { withDalContext } from '../../../../lib/dataverse/core/context';
import { isGuid } from '../../../../lib/utils/guid';
import { ServiceHttpError } from '../../../../lib/services/service-http-error';
import { MAX_IMAGE_BYTES } from '../../../../lib/services/grantee-upload';
import { replaceGranteeSubmission } from '../../../../lib/services/workbench/grantee-deliverables/replace-submission-service';
import { MAX_GRANTEE_CAPTION_MARKDOWN_LENGTH } from '../../../../shared/config/granteeAbstract';

export const config = {
  api: { bodyParser: false }, // busboy needs the raw stream
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const access = await requireAppAccess(req, res, 'reviewers');
  if (!access) return;

  let parsed;
  try {
    parsed = await parseMultipart(req);
  } catch (e) {
    if (e.code === 'FILE_TOO_LARGE') return res.status(400).json({ error: 'The image is too large.' });
    if (e.code === 'TOO_MANY_FILES') return res.status(400).json({ error: 'Only one image can be uploaded.' });
    return res.status(400).json({ error: 'Could not read the upload.' });
  }

  // GUID-validate BEFORE requestId becomes a record-id selector.
  const requestId = typeof parsed.fields.requestId === 'string' ? parsed.fields.requestId.trim() : '';
  if (!isGuid(requestId)) {
    return res.status(400).json({ error: 'requestId must be a GUID' });
  }

  // An absent caption field means "leave it alone"; a present one means "set it".
  // The service refuses a present-but-blank value rather than blanking the record.
  const caption = Object.prototype.hasOwnProperty.call(parsed.fields, 'caption')
    ? String(parsed.fields.caption)
    : null;
  if (caption !== null && caption.length > MAX_GRANTEE_CAPTION_MARKDOWN_LENGTH) {
    return res.status(400).json({ error: `The caption is too long (max ${MAX_GRANTEE_CAPTION_MARKDOWN_LENGTH} characters).` });
  }

  const clientEtag = typeof parsed.fields.etag === 'string' ? parsed.fields.etag.trim() : '';
  const imageFile = parsed.files[0] || null;

  if (caption === null && !imageFile) {
    return res.status(400).json({ error: 'Provide a new image, a new caption, or both.' });
  }

  return withDalContext('grantee-submission-replace', async () => {
    try {
      const body = await replaceGranteeSubmission({
        requestId,
        caption,
        imageFile,
        clientEtag,
        actingUserSystemId: access.session?.user?.dynamicsSystemuserId || null,
      });
      return res.status(200).json(body);
    } catch (error) {
      if (error instanceof ServiceHttpError) {
        return res.status(error.httpStatus).json(error.body ?? { error: error.message });
      }
      console.error('[grantee-deliverables/replace-submission] error:', error);
      return res.status(500).json({ error: 'Failed to save the replacement.' });
    }
  });
}

/**
 * Buffer the multipart body. Limits mirror the grantee submit route
 * (pages/api/external/grantee/[token]/submit.js) — one file, the same byte
 * ceiling, capped field size — so staff and grantee uploads cannot diverge on
 * what they will accept.
 */
function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    let busboy;
    try {
      busboy = Busboy({
        headers: req.headers,
        limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fieldSize: 64 * 1024, fields: 5 },
      });
    } catch (e) {
      return reject(e);
    }

    const files = [];
    const fields = {};
    let aborted = false;

    busboy.on('file', (_fieldname, fileStream, info) => {
      if (aborted) { fileStream.resume(); return; }
      const chunks = [];
      fileStream.on('data', (chunk) => chunks.push(chunk));
      fileStream.on('limit', () => {
        aborted = true;
        const err = new Error('FILE_TOO_LARGE');
        err.code = 'FILE_TOO_LARGE';
        reject(err);
      });
      fileStream.on('end', () => {
        if (aborted) return;
        files.push({ filename: info.filename, buffer: Buffer.concat(chunks), mimeType: info.mimeType });
      });
    });

    busboy.on('filesLimit', () => {
      aborted = true;
      const err = new Error('TOO_MANY_FILES');
      err.code = 'TOO_MANY_FILES';
      reject(err);
    });

    busboy.on('field', (name, value) => { fields[name] = value; });
    busboy.on('error', reject);
    busboy.on('finish', () => { if (!aborted) resolve({ files, fields }); });

    req.pipe(busboy);
  });
}
