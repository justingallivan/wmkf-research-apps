/**
 * POST /api/workbench/consultant-feedback/upload-token
 * (docs/plans/CONSULTANT_FEEDBACK_PLAN_2026-09-14.md §3.4, §5)
 *
 * Authenticated staff mint for one private, request-bound consultant-feedback
 * attachment (PDF or DOCX). Actor from the session; the client never chooses
 * the staging pathname or scope.
 */
import { requireAppAccess } from '../../../../lib/utils/auth';
import { withDalContext } from '../../../../lib/dataverse/core/context';
import { isGuid } from '../../../../lib/utils/guid';
import { ServiceHttpError } from '../../../../lib/services/service-http-error';
import { mintAttachmentUpload } from '../../../../lib/services/consultant-feedback-attachment-service';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const access = await requireAppAccess(req, res, 'reviewers');
  if (!access) return;

  const requestId = typeof req.body?.requestId === 'string' ? req.body.requestId.trim() : '';
  const filename = typeof req.body?.filename === 'string' ? req.body.filename : '';
  const contentType = typeof req.body?.contentType === 'string' ? req.body.contentType : '';
  const size = Number(req.body?.size);
  if (!isGuid(requestId)) return res.status(400).json({ error: 'requestId must be a GUID' });

  return withDalContext('consultant-feedback-upload-token', async () => {
    try {
      const upload = await mintAttachmentUpload({
        requestId,
        actorProfileId: access.profileId,
        filename,
        contentType,
        size,
      });
      return res.status(200).json({ ok: true, ...upload });
    } catch (error) {
      if (error instanceof ServiceHttpError) {
        return res.status(error.httpStatus).json(error.body ?? { error: error.message });
      }
      console.error('[consultant-feedback/upload-token] failed:', error?.message || error);
      return res.status(503).json({ error: 'Could not prepare the attachment upload.' });
    }
  });
}

export const config = {
  api: { bodyParser: { sizeLimit: '16kb' } },
};
