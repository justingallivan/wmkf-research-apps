/**
 * Review Manager - Render Emails (Dataverse-backed preview)
 *
 * POST /api/review-manager/render-emails
 *
 * Renders per-recipient email drafts by applying the template + settings to
 * each reviewer's data. suggestionIds are Dataverse GUIDs (strings).
 *
 * Request body:
 *   - suggestionIds: string[]
 *   - templateType: 'invitation' | 'materials' | 'followup' | 'thankyou' (validated; the
 *     caller supplies subject/body. 'invitation' carries {{externalLink}} → a magic accept/
 *     decline link is minted, same placeholder-driven path as materials.)
 *   - template: { subject, body }
 *   - settings: { signature, reviewerFormLink, customFields, ... }
 *
 * Response:
 *   - drafts: Array<{ suggestionId, candidateName, candidateEmail, requestNumber,
 *                     subject, body, skipped?: 'no_email' }>
 *
 * Thin route shell (Route→Service Consolidation Plan, Stage 2): method
 * dispatch → auth guard → rate limit → input validation → withDalContext →
 * one service call → result/error→HTTP mapping. All rendering/minting logic
 * lives in lib/services/review-manager/render-emails-service.js.
 * NOTE (pinned): the 405 sends NO Allow header — characterized behavior.
 */

import { BASE_CONFIG } from '../../../shared/config/baseConfig';
import { requireAppAccess } from '../../../lib/utils/auth';
import { allGuids } from '../../../lib/utils/guid';
import { nextRateLimiter } from '../../../shared/api/middleware/rateLimiter';
import { withDalContext } from '../../../lib/dataverse/core/context';
import { isKnownTemplateType } from '../../../lib/utils/reviewer-invite';
import { ServiceHttpError } from '../../../lib/services/service-http-error';
import { renderEmails } from '../../../lib/services/review-manager/render-emails-service';

const limiter = nextRateLimiter({ max: 30 });

export const config = {
  api: { bodyParser: { sizeLimit: '1mb' } },
  maxDuration: 30,
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const access = await requireAppAccess(req, res, 'review-manager', 'reviewers');
  if (!access) return;

  const actingUserSystemId = access.session?.user?.dynamicsSystemuserId || null;

  const allowed = await limiter(req, res);
  if (allowed !== true) return;

  const {
    suggestionIds,
    templateType = 'materials',
    template,
    settings = {},
  } = req.body;

  if (!Array.isArray(suggestionIds) || suggestionIds.length === 0) {
    return res.status(400).json({ error: 'suggestionIds array is required' });
  }
  // GUID-validate every id before findById (record-id selector interpolated
  // raw into the request URL).
  if (!allGuids(suggestionIds)) {
    return res.status(400).json({ error: 'suggestionIds must all be valid GUIDs' });
  }
  if (!template || !template.subject || !template.body) {
    return res.status(400).json({ error: 'template with subject and body is required' });
  }
  if (!isKnownTemplateType(templateType)) {
    return res.status(400).json({ error: `Unknown templateType: ${templateType}` });
  }

  return withDalContext('review-manager-render', async () => {
    try {
      const result = await renderEmails({ suggestionIds, template, settings, templateType, actingUserSystemId });
      return res.status(200).json(result);
    } catch (error) {
      if (error instanceof ServiceHttpError) {
        return res.status(error.httpStatus).json(error.body ?? { error: error.message });
      }
      console.error('Review Manager render-emails error:', error);
      return res.status(500).json({
        error: BASE_CONFIG.ERROR_MESSAGES?.EMAIL_GENERATION_FAILED || 'Failed to render emails',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  });
}
