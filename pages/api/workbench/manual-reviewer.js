/**
 * API: /api/workbench/manual-reviewer
 *
 * POST one sparse staff-entered reviewer into a request's durable candidate
 * pool. This is Phase 1 only: no enrichment runs here.
 */

import { requireAppAccess } from '../../../lib/utils/auth';
import { DynamicsService } from '../../../lib/services/dynamics-service';
import { bypassDynamicsRestrictions } from '../../../lib/services/dynamics-context';
import { meetingDateToCycleCode } from '../../../lib/utils/cycle-code';
import * as potentialReviewerAdapter from '../../../lib/dataverse/adapters/potential-reviewer';
import * as researcherAdapter from '../../../lib/dataverse/adapters/researcher';
import * as reviewerSuggestionAdapter from '../../../lib/dataverse/adapters/reviewer-suggestion';

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_NAME = 180;
const MAX_EMAIL = 254;
const MAX_AFFILIATION = 500;
const MAX_NOTE = 1000;

export const config = {
  api: { bodyParser: { sizeLimit: '64kb' } },
};

function cleanString(value, max) {
  if (value === undefined || value === null) return '';
  return String(value).trim().slice(0, max);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const access = await requireAppAccess(req, res, 'reviewer-finder', 'reviewers');
  if (!access) return;

  const body = req.body || {};
  const requestId = cleanString(body.requestId, 64);
  const name = cleanString(body.name, MAX_NAME);
  const email = cleanString(body.email, MAX_EMAIL).toLowerCase();
  const affiliation = cleanString(body.affiliation, MAX_AFFILIATION);
  const note = cleanString(body.note, MAX_NOTE);

  if (!requestId) return res.status(400).json({ error: 'requestId is required (akoya_request GUID)' });
  if (!GUID_RE.test(requestId)) return res.status(400).json({ error: 'requestId must be a GUID' });
  if (!name) return res.status(400).json({ error: 'name is required' });
  if (email && !EMAIL_RE.test(email)) return res.status(400).json({ error: 'email must be a valid email address' });

  const actingUserSystemId = access.session?.user?.dynamicsSystemuserId || null;

  return bypassDynamicsRestrictions('workbench-manual-reviewer', async () => {
    try {
      let request;
      try {
        request = await DynamicsService.getRecord('akoya_requests', requestId, {
          select: 'akoya_requestid,akoya_title,wmkf_meetingdate,_wmkf_programareaserved_value',
        });
      } catch {
        request = null;
      }
      if (!request?.akoya_requestid) {
        return res.status(404).json({ error: `No request found for ${requestId}` });
      }

      const cycleCode = request.wmkf_meetingdate ? meetingDateToCycleCode(request.wmkf_meetingdate) : null;
      const programArea = request._wmkf_programareaserved_value_formatted || null;
      const matchReason = note || 'Manually added by staff.';

      const { id: potentialReviewerId, created: personCreated } = await potentialReviewerAdapter.upsertByEmail({
        name,
        email: email || null,
        affiliation: affiliation || null,
        whyChosen: matchReason,
      }, { actingUserSystemId });

      if (email) {
        await researcherAdapter.updateById(potentialReviewerId, { emailSource: 'manual' }, { actingUserSystemId });
      }

      const suggestion = await reviewerSuggestionAdapter.ensureStaffManualCandidate({
        potentialReviewerId,
        requestId,
        suggestionLabel: request.akoya_title ? `${request.akoya_title} — ${name}` : null,
        grantCycleCode: cycleCode,
        programArea,
        matchReason,
      }, { actingUserSystemId });

      if (suggestion.skippedExcluded) {
        return res.status(409).json({
          error: 'This reviewer is excluded for this request and was not added.',
          code: 'applicant_excluded',
          suggestionId: suggestion.id,
        });
      }

      return res.status(200).json({
        success: true,
        candidate: {
          suggestionId: suggestion.id,
          potentialReviewerId,
          name,
          email: email || null,
          affiliation: affiliation || null,
          sources: ['staff_manual'],
          manualAdded: true,
          applicantRecommended: false,
          invitable: !!email,
          reasoning: matchReason,
        },
        created: {
          person: personCreated,
          suggestion: suggestion.created,
        },
      });
    } catch (error) {
      console.error('manual-reviewer error:', error);
      return res.status(500).json({
        error: 'Failed to add manual reviewer',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  });
}
