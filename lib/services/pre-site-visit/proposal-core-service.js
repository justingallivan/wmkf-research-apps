/**
 * Pre-Site Visit proposal-core producer.
 *
 * Caller contract:
 * - caller already established a trusted Dataverse restriction context;
 * - requestId is a server-resolved Dataverse GUID;
 * - proposal inputs are the exact AI Materials narrative and bibliography;
 * - the governed prompt is pass-through-only (normal wmkf_ai_run audit aside).
 */

import * as grantRequestAdapter from '../../dataverse/adapters/grant-request.js';
import * as accountAdapter from '../../dataverse/adapters/account.js';
import { isGuid } from '../../utils/guid.js';
import { executePrompt } from '../execute-prompt.js';
import { fetchCoPIs } from '../proposal-participants.js';
import { getAiProposalMaterialsText } from '../workbench-proposal-documents.js';
import { formatAwardAmount, formatLocation } from '../grantee-document-assembly.js';
import { ServiceHttpError } from '../service-http-error.js';
import { validateAiJson } from '../../utils/ai-output-schema.js';
import {
  PROMPT_NAME,
  PROMPT_OUTPUT_SCHEMA,
  REQUIRED_SYSTEM_ASSERTIONS,
} from '../../../shared/config/prompts/pre-site-visit-proposal-core.js';

const REQUEST_SELECT = [
  'akoya_requestid',
  'akoya_requestnum',
  'akoya_title',
  'wmkf_organizationname',
  '_akoya_applicantid_value',
  '_wmkf_projectleader_value',
  '_akoya_programid_value',
  '_wmkf_programdirector_value',
  'wmkf_meetingdate',
  'akoya_request',
  'wmkf_invitedamount',
  'akoya_expenses',
  'akoya_begindate',
  'akoya_enddate',
].join(',');

const ACCOUNT_SELECT = 'name,address1_city,address1_stateorprovince';

const STATE_ABBREVIATIONS = Object.freeze({
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
  colorado: 'CO', connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA',
  hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA', kansas: 'KS',
  kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD', massachusetts: 'MA',
  michigan: 'MI', minnesota: 'MN', mississippi: 'MS', missouri: 'MO', montana: 'MT',
  nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ',
  'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND',
  ohio: 'OH', oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI',
  'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT',
  vermont: 'VT', virginia: 'VA', washington: 'WA', 'west virginia': 'WV',
  wisconsin: 'WI', wyoming: 'WY', 'district of columbia': 'DC',
  'puerto rico': 'PR', guam: 'GU', 'american samoa': 'AS',
  'northern mariana islands': 'MP', 'u.s. virgin islands': 'VI',
  'united states virgin islands': 'VI',
});

const DEFAULT_DEPENDENCIES = Object.freeze({
  getRequest: (requestId) => grantRequestAdapter.getById(requestId, { select: REQUEST_SELECT }),
  getApplicant: (applicantId) => accountAdapter.getById(applicantId, { select: ACCOUNT_SELECT }),
  getCoPIs: fetchCoPIs,
  getProposalMaterials: getAiProposalMaterialsText,
  runPrompt: executePrompt,
});

function clean(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

export function abbreviateState(value) {
  const text = clean(value);
  if (!text) return null;
  if (/^[A-Za-z]{2}$/.test(text)) return text.toUpperCase();
  return STATE_ABBREVIATIONS[text.toLowerCase()] || text;
}

export function formatMeetingDate(value) {
  const text = clean(value);
  if (!text) return null;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text;
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

function projectPeriod(startDate, endDate) {
  const start = clean(startDate);
  const end = clean(endDate);
  if (!start && !end) return null;
  return { startDate: start, endDate: end };
}

function personnelRoster(pi, coPIs) {
  const roster = [];
  const principalInvestigator = clean(pi);
  if (principalInvestigator) {
    roster.push({ name: principalInvestigator, role: 'Principal Investigator' });
  }
  for (const name of coPIs || []) {
    const cleaned = clean(name);
    if (cleaned) roster.push({ name: cleaned, role: 'Co-Principal Investigator' });
  }
  return roster;
}

function requireIdentity(context) {
  const missing = [];
  if (!context.requestNumber) missing.push('request number');
  if (!context.projectTitle) missing.push('project title');
  if (!context.applicantInstitution) missing.push('applicant institution');
  if (!context.personnel.length || context.personnel[0].role !== 'Principal Investigator') {
    missing.push('principal investigator');
  }
  if (missing.length) {
    throw new ServiceHttpError(
      `The request is missing required Pre-Site Visit context: ${missing.join(', ')}.`,
      { httpStatus: 409, code: 'pre_site_visit_context_incomplete' },
    );
  }
}

/**
 * Load the exact proposal source plus the read-only Dataverse fields used by
 * the prompt and Word renderer. Optional document fields remain null.
 */
export async function loadPreSiteVisitInputs({ requestId }, dependencies = DEFAULT_DEPENDENCIES) {
  if (!isGuid(requestId)) {
    throw new ServiceHttpError('A valid requestId is required.', {
      httpStatus: 400,
      code: 'invalid_request_id',
    });
  }

  const request = await dependencies.getRequest(requestId);
  if (!request?.akoya_requestid) {
    throw new ServiceHttpError('Request not found.', { httpStatus: 404, code: 'request_not_found' });
  }

  const requestNumber = clean(request.akoya_requestnum);
  const [coPIs, proposalMaterials] = await Promise.all([
    dependencies.getCoPIs(requestId),
    dependencies.getProposalMaterials(requestId, requestNumber),
  ]);
  if (!proposalMaterials?.narrative?.text
      || proposalMaterials.narrative.text.trim().length < 60) {
    throw new ServiceHttpError(
      `No usable AI proposal narrative was found at AI Materials/ProposalNarrative_${requestNumber || ''}.pdf.`,
      { httpStatus: 409, code: 'proposal_narrative_unavailable' },
    );
  }
  if (!proposalMaterials?.bibliography?.text
      || proposalMaterials.bibliography.text.trim().length < 20) {
    throw new ServiceHttpError(
      `No usable AI proposal bibliography was found at AI Materials/ProposalBibliography_${requestNumber || ''}.pdf.`,
      { httpStatus: 409, code: 'proposal_bibliography_unavailable' },
    );
  }

  let applicant = null;
  if (isGuid(request._akoya_applicantid_value)) {
    try {
      applicant = await dependencies.getApplicant(request._akoya_applicantid_value);
    } catch (error) {
      console.warn('[pre-site-visit] applicant read failed; using request annotations', {
        requestId,
        error: error?.message || String(error),
      });
    }
  }

  const applicantInstitution = clean(applicant?.name)
    || clean(request._akoya_applicantid_value_formatted)
    || clean(request.wmkf_organizationname);
  const personnel = personnelRoster(request._wmkf_projectleader_value_formatted, coPIs);
  const city = clean(applicant?.address1_city);
  const state = abbreviateState(applicant?.address1_stateorprovince);

  const context = {
    requestId: request.akoya_requestid,
    requestNumber,
    projectTitle: clean(request.akoya_title),
    applicantInstitution,
    projectPeriod: projectPeriod(request.akoya_begindate, request.akoya_enddate),
    personnel,
    documentFields: {
      institutionName: applicantInstitution,
      cityState: formatLocation(city, state),
      internalProgram: clean(request._akoya_programid_value_formatted),
      projectTitle: clean(request.akoya_title),
      meetingDate: formatMeetingDate(request.wmkf_meetingdate),
      requestedAmount: formatAwardAmount(request.akoya_request),
      programDirector: clean(request._wmkf_programdirector_value_formatted),
      invitedAmount: formatAwardAmount(request.wmkf_invitedamount),
      totalProjectBudget: formatAwardAmount(request.akoya_expenses),
    },
  };
  requireIdentity(context);

  return {
    context,
    proposalMaterials,
  };
}

function promptContext(context) {
  return {
    requestNumber: context.requestNumber,
    projectTitle: context.projectTitle,
    applicantInstitution: context.applicantInstitution,
    projectPeriod: context.projectPeriod,
    personnel: context.personnel,
  };
}

function validateGeneratedCore(value) {
  const validation = validateAiJson(
    { proposalCore: value },
    PROMPT_OUTPUT_SCHEMA.validationSchema,
  );
  if (!validation.ok) {
    throw new ServiceHttpError('The governed Pre-Site Visit prompt returned an invalid proposal core.', {
      httpStatus: 502,
      code: 'pre_site_visit_prompt_invalid',
    });
  }
  return validation.value.proposalCore;
}

/** Generate the governed eight-section proposal core without business-field persistence. */
export async function generatePreSiteVisitProposalCore({
  requestId,
  actingUserSystemId = null,
  runSource = 'Vercel User',
}, dependencies = DEFAULT_DEPENDENCIES) {
  const inputs = await loadPreSiteVisitInputs({ requestId }, dependencies);
  const result = await dependencies.runPrompt({
    promptName: PROMPT_NAME,
    requestId,
    overrideVariables: {
      request_context_json: JSON.stringify(promptContext(inputs.context), null, 2),
      proposal_narrative: inputs.proposalMaterials.narrative.text,
      proposal_bibliography: inputs.proposalMaterials.bibliography.text,
    },
    runSource,
    actingUserSystemId,
    assertSystemIncludes: REQUIRED_SYSTEM_ASSERTIONS,
    requireNoPersistence: true,
  });

  if (result?.blocked || !result?.parsed?.proposalCore) {
    throw new ServiceHttpError('The governed Pre-Site Visit prompt returned no proposal core.', {
      httpStatus: 502,
      code: 'pre_site_visit_prompt_empty',
    });
  }
  const proposalCore = validateGeneratedCore(result.parsed.proposalCore);

  return {
    proposalCore,
    context: inputs.context,
    sources: ['narrative', 'bibliography'].map((role) => {
      const source = inputs.proposalMaterials[role];
      return {
        role: role === 'narrative' ? 'proposalNarrative' : 'proposalBibliography',
        filename: source.filename,
        siteId: source.siteId,
        driveId: source.driveId,
        itemId: source.itemId,
        versionId: source.versionId,
        contentHash: source.contentHash,
      };
    }),
    runId: result.runId || null,
    usage: result.usage || null,
    meta: result.meta || null,
  };
}
