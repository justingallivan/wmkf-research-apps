/**
 * GET /api/review-manager/export-reviews?proposalId=<guid>
 *
 * Regenerates a combined review DOCX from authoritative Dataverse answer
 * snapshots. The client supplies no report content or reviewer data.
 */

import { requireAppAccess } from '../../../lib/utils/auth';
import { isGuid } from '../../../lib/utils/guid';
import { withDalContext } from '../../../lib/dataverse/core/context';
import { ServiceHttpError } from '../../../lib/services/service-http-error';
import { exportCombinedReviews } from '../../../lib/services/review-manager/export-reviews-service';
import { withRequestCorrelation, mintCorrelationId } from '../../../lib/observability/request-correlation';

const DOCX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export default async function handler(req, res) {
  return withRequestCorrelation(
    { correlationId: mintCorrelationId(), routeName: '/api/review-manager/export-reviews' },
    () => handleWithCorrelation(req, res),
  );
}

async function handleWithCorrelation(req, res) {
  const access = await requireAppAccess(req, res, 'review-manager', 'reviewers');
  if (!access) return;
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { proposalId } = req.query;
  if (!proposalId || Array.isArray(proposalId) || !isGuid(proposalId)) {
    return res.status(400).json({ error: 'proposalId is not a valid GUID' });
  }

  try {
    const exported = await withDalContext('review-manager-export-reviews', () =>
      exportCombinedReviews({
        proposalId,
        azureEmail: access.session?.user?.azureEmail,
      }),
    );
    res.setHeader('Content-Type', DOCX_CONTENT_TYPE);
    res.setHeader('Content-Disposition', `attachment; filename="${exported.filename}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    return res.status(200).send(exported.content);
  } catch (error) {
    if (error instanceof ServiceHttpError) {
      return res.status(error.httpStatus).json(error.body ?? { error: error.message });
    }
    console.error('Review export error:', error);
    return res.status(500).json({ error: 'Failed to export reviews' });
  }
}
