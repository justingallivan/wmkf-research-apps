/**
 * API: /api/workbench/pre-site-visit
 *
 * POST { requestId } -> generate and download one governed Pre-Site Visit
 * Word draft. This minimum slice is pass-through-only: it records the normal
 * wmkf_ai_run audit but does not upload to SharePoint or write request-document
 * registry/business fields.
 */

import { requireAppAccess } from '../../../lib/utils/auth';
import { withDalContext } from '../../../lib/dataverse/core/context';
import { isGuid } from '../../../lib/utils/guid';
import { ServiceHttpError } from '../../../lib/services/service-http-error';
import { generatePreSiteVisitProposalCore } from '../../../lib/services/pre-site-visit/proposal-core-service';
import { renderPreSiteVisitDocx } from '../../../lib/services/pre-site-visit/docx-renderer';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export const config = {
  api: {
    responseLimit: false,
    bodyParser: { sizeLimit: '16kb' },
  },
  maxDuration: 300,
};

function downloadFilename(requestNumber) {
  const safeNumber = String(requestNumber || 'Request')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'Request';
  return `Phase II Pre-Site Visit Writeup ${safeNumber}.docx`;
}
function sendError(res, error) {
  if (error instanceof ServiceHttpError) {
    return res.status(error.httpStatus).json(error.body ?? { error: error.message });
  }
  console.error('workbench pre-site-visit error:', error);
  return res.status(500).json({
    error: 'Pre-Site Visit draft generation failed.',
    details: process.env.NODE_ENV === 'development' ? error.message : undefined,
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const access = await requireAppAccess(req, res, 'reviewers');
  if (!access) return;

  return withDalContext('workbench-pre-site-visit', async () => {
    try {
      if (!req.body
        || typeof req.body !== 'object'
        || Array.isArray(req.body)
        || Object.keys(req.body).some((key) => key !== 'requestId')) {
        return res.status(400).json({ error: 'POST body must contain only requestId' });
      }
      const requestId = String(req.body.requestId || '').trim();
      if (!isGuid(requestId)) {
        return res.status(400).json({ error: 'requestId is required and must be a GUID' });
      }

      const generated = await generatePreSiteVisitProposalCore({
        requestId,
        actingUserSystemId: access.session?.user?.dynamicsSystemuserId || null,
        runSource: 'Vercel User',
      });
      const document = await renderPreSiteVisitDocx({
        documentFields: generated.context.documentFields,
        proposalCore: generated.proposalCore,
      });
      const filename = downloadFilename(generated.context.requestNumber);

      res.setHeader('Content-Type', DOCX_MIME);
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Length', document.length);
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      return res.status(200).send(document);
    } catch (error) {
      return sendError(res, error);
    }
  });
}
