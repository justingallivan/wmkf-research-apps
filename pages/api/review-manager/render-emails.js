/**
 * Review Manager - Render Emails (Dataverse-backed preview)
 *
 * POST /api/review-manager/render-emails
 *
 * Renders per-recipient email drafts by applying the template + settings to
 * each reviewer's data. Recipient + proposal data come from Dataverse so the
 * preview matches what `send-emails` will use. Cycle-level template config
 * (deadline, programName, customFields) moved to Dataverse `wmkf_appgrantcycle`
 * at W3 cutover (2026-05-12); the snake_case return shape of
 * `loadCycleConfigs` is preserved for backwards-compat with the renderer.
 *
 * suggestionIds are Dataverse GUIDs (strings).
 *
 * Request body:
 *   - suggestionIds: string[]
 *   - templateType: 'materials' | 'followup' | 'thankyou'
 *   - template: { subject, body }
 *   - settings: { signature, reviewerFormLink, customFields, ... }
 *
 * Response:
 *   - drafts: Array<{ suggestionId, candidateName, candidateEmail, requestNumber,
 *                     subject, body, skipped?: 'no_email' }>
 */

import { BASE_CONFIG } from '../../../shared/config/baseConfig';
import { findByShortCode as findCycleByShortCode } from '../../../lib/services/grant-cycles-dataverse';
import {
  replacePlaceholders,
  buildTemplateData,
} from '../../../lib/utils/email-generator';
import { requireAppAccess } from '../../../lib/utils/auth';
import { nextRateLimiter } from '../../../shared/api/middleware/rateLimiter';
import { DynamicsService } from '../../../lib/services/dynamics-service';
import { bypassDynamicsRestrictions } from '../../../lib/services/dynamics-context';
import { meetingDateToCycleCode } from '../../../lib/utils/cycle-code';
import { getHonorariumAmount } from '../../../lib/services/honorarium-config';
import * as suggestionAdapter from '../../../lib/dataverse/adapters/reviewer-suggestion';
import { mintAndStore } from '../../../lib/external/token-lifecycle';

const limiter = nextRateLimiter({ max: 30 });

const EXTERNAL_LINK_TTL_DAYS = 90;
const EXTERNAL_LINK_PLACEHOLDER = '{{externalLink}}';

export const config = {
  api: { bodyParser: { sizeLimit: '1mb' } },
  maxDuration: 30,
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const access = await requireAppAccess(req, res, 'review-manager');
  if (!access) return;

  const actingUserSystemId = access.session?.user?.dynamicsSystemuserId || null;

  const allowed = await limiter(req, res);
  if (allowed !== true) return;

  return bypassDynamicsRestrictions('review-manager-render', async () => {
  try {
    const {
      suggestionIds,
      templateType = 'materials',
      template,
      settings = {},
    } = req.body;

    if (!Array.isArray(suggestionIds) || suggestionIds.length === 0) {
      return res.status(400).json({ error: 'suggestionIds array is required' });
    }
    if (!template || !template.subject || !template.body) {
      return res.status(400).json({ error: 'template with subject and body is required' });
    }

    // Hydrate each suggestion: suggestion row + linked person + linked request.
    const rows = [];
    for (const suggestionId of suggestionIds) {
      const sug = await suggestionAdapter.findById(suggestionId);
      if (!sug) continue;
      const personId = sug._wmkf_potentialreviewer_value;
      const requestId = sug._wmkf_request_value;
      const [person, request] = await Promise.all([
        personId ? DynamicsService.getRecord('wmkf_potentialreviewerses', personId, {
          select: 'wmkf_name,wmkf_emailaddress,wmkf_organizationname',
        }).catch(() => null) : null,
        requestId ? DynamicsService.getRecord('akoya_requests', requestId, {
          select: 'akoya_requestid,akoya_requestnum,akoya_title,wmkf_abstract,wmkf_organizationname,_akoya_applicantid_value,_wmkf_projectleader_value,wmkf_meetingdate',
        }).catch(() => null) : null,
      ]);
      rows.push({ suggestionId, sug, person, request });
    }

    if (rows.length === 0) {
      return res.status(404).json({ error: 'No reviewers found for the provided IDs' });
    }

    // Cycle-level config from Dataverse `wmkf_appgrantcycle` (W3 cutover).
    const distinctCycleCodes = [...new Set(
      rows.map((r) => r.request?.wmkf_meetingdate ? meetingDateToCycleCode(r.request.wmkf_meetingdate) : null).filter(Boolean)
    )];
    const cycleByCode = await loadCycleConfigs(distinctCycleCodes);

    // Honorarium amount is a single Dataverse ground-truth (decided S199);
    // read once server-side and override any client/cycle value so the
    // {{customField:honorarium}} placeholder can't drift per-user. On a read
    // failure, leave the existing customFields value rather than fail the whole
    // render (email is lower-stakes than the money-stamping create path).
    let honorariumOverride = {};
    try {
      honorariumOverride = { honorarium: String(await getHonorariumAmount()) };
    } catch (e) {
      console.warn('[render-emails] honorarium amount read failed; using existing customField:', e.message);
    }

    // Mint external links only when the template body actually references
    // them — avoids churning the stored hash for templates (thankyou,
    // older customs) that don't use the placeholder. Each render produces
    // a fresh JWT and overwrites the prior hash, so any link previously
    // copied from the UI for the same recipient stops verifying. That's
    // intentional: the email body becomes the canonical link.
    const needsExternalLink = (template.body || '').includes(EXTERNAL_LINK_PLACEHOLDER) ||
      (template.subject || '').includes(EXTERNAL_LINK_PLACEHOLDER);
    const externalLinkBySuggestion = {};
    if (needsExternalLink) {
      const expires = new Date(Date.now() + EXTERNAL_LINK_TTL_DAYS * 24 * 60 * 60 * 1000);
      for (const { suggestionId, sug } of rows) {
        const requestId = sug?._wmkf_request_value;
        if (!requestId) continue;
        try {
          const { url } = await mintAndStore({ suggestionId, requestId, expiresAt: expires, actingUserSystemId });
          externalLinkBySuggestion[suggestionId] = url;
        } catch (e) {
          console.error(`[render-emails] mint failed for ${suggestionId}: ${e.message}`);
          // Leave externalLink empty for this recipient; placeholder
          // substitution will yield "" rather than crash the render.
        }
      }
    }

    const drafts = rows.map(({ suggestionId, sug, person, request }) => {
      const requestNumber = request?.akoya_requestnum || null;
      const candidateName = person?.wmkf_name || null;
      const candidateEmail = person?.wmkf_emailaddress || null;

      if (!candidateEmail) {
        return {
          suggestionId,
          candidateName,
          candidateEmail: null,
          requestNumber,
          subject: '',
          body: '',
          skipped: 'no_email',
        };
      }

      const cycleCode = request?.wmkf_meetingdate ? meetingDateToCycleCode(request.wmkf_meetingdate) : null;
      const cycle = cycleByCode[cycleCode] || {};

      const candidate = {
        name: candidateName,
        affiliation: person?.wmkf_organizationname || null,
        email: candidateEmail,
      };
      const proposal = {
        title: request?.akoya_title || null,
        abstract: request?.wmkf_abstract || null,
        authors: request?._wmkf_projectleader_value_formatted
          || request?._akoya_applicantid_value_formatted
          || null,
        institution: (request?.wmkf_organizationname || request?._akoya_applicantid_value_formatted || '').trim() || null,
        coInvestigators: null, // historical Postgres-only field; not migrated
        coInvestigatorCount: null,
      };
      const templateSettings = {
        signature: settings.signature || '',
        reviewDueDate: settings.reviewDueDate || cycle.review_deadline || null,
        reviewerFormLink: settings.reviewerFormLink || '',
        externalLink: externalLinkBySuggestion[suggestionId] || '',
        grantCycle: {
          programName: cycle.program_name || '',
          reviewDeadline: cycle.review_deadline || null,
          customFields: { ...(cycle.custom_fields || {}), ...(settings.customFields || {}), ...honorariumOverride },
        },
      };

      const templateData = buildTemplateData(candidate, proposal, templateSettings);
      return {
        suggestionId,
        candidateName,
        candidateEmail,
        requestNumber,
        subject: replacePlaceholders(template.subject, templateData),
        body: replacePlaceholders(template.body, templateData),
      };
    });

    return res.status(200).json({
      drafts,
      stats: {
        total: drafts.length,
        ready: drafts.filter((d) => !d.skipped).length,
        skipped: drafts.filter((d) => d.skipped).length,
      },
    });
  } catch (error) {
    console.error('Review Manager render-emails error:', error);
    return res.status(500).json({
      error: BASE_CONFIG.ERROR_MESSAGES?.EMAIL_GENERATION_FAILED || 'Failed to render emails',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
  });
}

// Dataverse-backed at W3 cutover. Returns the same snake_case shape the
// renderer below consumes (short_code, name, program_name, review_deadline,
// custom_fields) so downstream code is unchanged. Transport errors
// propagate to the endpoint catch (matches pre-cutover behavior where a
// failed `WHERE short_code = ANY(...)` query would have surfaced as 500);
// only the "row not found" case (handled inside findByShortCode → null)
// is silent.
async function loadCycleConfigs(cycleCodes) {
  const out = {};
  if (!cycleCodes.length) return out;
  const results = await Promise.all(cycleCodes.map(code => findCycleByShortCode(code)));
  for (const cycle of results) {
    if (!cycle || !cycle.shortCode) continue;
    if (out[cycle.shortCode]) continue;
    out[cycle.shortCode] = {
      short_code: cycle.shortCode,
      name: cycle.name,
      program_name: cycle.programName,
      review_deadline: cycle.reviewDeadline,
      custom_fields: cycle.customFields,
    };
  }
  return out;
}
