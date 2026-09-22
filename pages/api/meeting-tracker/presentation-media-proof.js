/**
 * Preview-only Slice 0 proof controller. MP4 bytes never enter this route;
 * the browser uploads directly to the preauthenticated Graph session.
 */

import { requireAppAccess } from '../../../lib/utils/auth';
import { withDalContext } from '../../../lib/dataverse/core/context';
import { ServiceHttpError } from '../../../lib/services/service-http-error';
import {
  assertPreviewProofDeployment,
  beginPresentationMediaProofUpload,
  cleanupPresentationMediaProofUpload,
  finalizePresentationMediaProofUpload,
  getPresentationMediaProofUploadStatus,
} from '../../../lib/services/post-presentation-materials/presentation-media-proof-service';

export const config = { api: { bodyParser: { sizeLimit: '16kb' } }, maxDuration: 60 };

const ACTION_FIELDS = Object.freeze({
  begin: new Set(['action', 'requestId', 'filename', 'mimeType', 'size', 'lastModified']),
  status: new Set(['action', 'permit']),
  finalize: new Set(['action', 'permit']),
  cleanup: new Set(['action', 'permit']),
});

function exactBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
  const fields = ACTION_FIELDS[body.action];
  if (!fields) return false;
  return Object.keys(body).every((key) => fields.has(key))
    && [...fields].every((key) => Object.prototype.hasOwnProperty.call(body, key));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    assertPreviewProofDeployment();
  } catch {
    return res.status(404).json({ error: 'Not found.' });
  }
  const access = await requireAppAccess(req, res, 'meeting-tracker');
  if (!access) return;
  if (!exactBody(req.body)) {
    return res.status(400).json({ error: 'The proof request contains unsupported or missing fields.' });
  }
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  return withDalContext('meeting-tracker-presentation-media-proof', async () => {
    try {
      const profileId = access.profileId;
      let result;
      if (req.body.action === 'begin') {
        result = await beginPresentationMediaProofUpload({
          requestId: String(req.body.requestId || '').trim(),
          profileId,
          filename: req.body.filename,
          mimeType: req.body.mimeType,
          size: req.body.size,
          lastModified: req.body.lastModified,
        });
      } else if (req.body.action === 'status') {
        result = await getPresentationMediaProofUploadStatus({ permit: req.body.permit, profileId });
      } else if (req.body.action === 'finalize') {
        result = await finalizePresentationMediaProofUpload({ permit: req.body.permit, profileId });
      } else {
        result = await cleanupPresentationMediaProofUpload({ permit: req.body.permit, profileId });
      }
      return res.status(200).json({ ok: true, ...result });
    } catch (error) {
      if (error instanceof ServiceHttpError) {
        return res.status(error.httpStatus).json(error.body ?? { error: error.message, code: error.code });
      }
      console.error('[presentation-media-proof] action failed:', error?.message || error);
      return res.status(500).json({ error: 'The presentation media proof action failed.' });
    }
  });
}
