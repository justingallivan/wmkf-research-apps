/**
 * GET /api/workbench/consultant-feedback/attachment?requestId=<GUID>&entryId=<positive integer>
 *
 * Authenticated staff proxy for one Consultant Feedback attachment. The
 * service resolves the Postgres entry and the Dataverse registry row; the
 * client never supplies SharePoint path, drive, item, or filename values.
 */
import { requireAppAccess } from '../../../../lib/utils/auth';
import { withDalContext } from '../../../../lib/dataverse/core/context';
import { ServiceHttpError } from '../../../../lib/services/service-http-error';
import { downloadConsultantFeedbackAttachment } from '../../../../lib/services/consultant-feedback-service';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const access = await requireAppAccess(req, res, 'reviewers');
  if (!access) return;

  return withDalContext('workbench-consultant-feedback-attachment', async () => {
    try {
      const file = await downloadConsultantFeedbackAttachment({
        requestId: typeof req.query?.requestId === 'string' ? req.query.requestId.trim() : '',
        entryId: typeof req.query?.entryId === 'string' ? req.query.entryId : '',
      });
      res.setHeader('Content-Type', file.mimeType);
      res.setHeader('Content-Disposition', `${file.inline ? 'inline' : 'attachment'}; filename="${encodeFilename(file.filename)}"`);
      res.setHeader('Content-Length', file.size);
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      return res.status(200).send(file.buffer);
    } catch (error) {
      if (error instanceof ServiceHttpError) {
        return res.status(error.httpStatus).json(error.body ?? { error: error.message });
      }
      console.error('[consultant-feedback/attachment] failed:', error?.message || error);
      return res.status(500).json({ error: 'Consultant feedback attachment request failed.' });
    }
  });
}

function encodeFilename(name) {
  return String(name || 'consultant-feedback').replace(/["\r\n\\]/g, '').slice(0, 180);
}

export const config = {
  api: { responseLimit: false },
};
