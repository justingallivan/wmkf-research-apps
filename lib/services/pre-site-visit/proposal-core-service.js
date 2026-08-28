/**
 * Pre-Site Visit proposal-core producer.
 *
 * Caller contract:
 * - caller already established a trusted Dataverse restriction context;
 * - requestId is a server-resolved Dataverse GUID;
 * - the proposal input is the exact AI Materials narrative;
 * - DV:InstitutionName prefers applicant account akoya_aka, then account name,
 *   then the request's formatted applicant lookup; Request Bill.com fields are excluded;
 * - AI:InstitutionalFundingHistory is a deterministic Dataverse sentence (account
 *   program-grant rollups + newest program grant; lib/services/pre-site-visit/
 *   funding-history.js). It is NOT prompt input. The applicant account and the
 *   program-grant query are required — either failing aborts generation (fail
 *   closed) rather than rendering a wrong funding history;
 * - the governed prompt is pass-through-only (normal wmkf_ai_run audit aside);
 * - layout targets produce content-free diagnostics, while malformed, empty,
 *   reserved-token-bearing, or >30,000-character sections fail before reuse.
 */

import * as grantRequestAdapter from '../../dataverse/adapters/grant-request.js';
import * as accountAdapter from '../../dataverse/adapters/account.js';
import { isGuid } from '../../utils/guid.js';
import { executePrompt } from '../execute-prompt.js';
import { fetchCoPIs } from '../proposal-participants.js';
import { getAiProposalNarrativeText } from '../workbench-proposal-documents.js';
import { formatAwardAmount, formatLocation } from '../grantee-document-assembly.js';
import { ServiceHttpError } from '../service-http-error.js';
import { validateAiJson } from '../../utils/ai-output-schema.js';
import { findMostRecentProgramGrant, formatInstitutionalFundingHistory } from './funding-history.js';
import { meetingDateToCycleCode } from '../../utils/cycle-code.js';
import {
  PRE_SITE_VISIT_CONTENT_POLICY,
  PROMPT_NAME,
  PROMPT_OUTPUT_SCHEMA,
  PROPOSAL_CORE_KEYS,
  REQUIRED_SYSTEM_ASSERTIONS,
} from '../../../shared/config/prompts/pre-site-visit-proposal-core.js';

const RESERVED_TEMPLATE_TOKEN = /\[\[\s*(?:AI|DV|STAFF)\s*:[^\]]+\]\]/i;

const REQUEST_SELECT = [
  'akoya_requestid',
  'akoya_requestnum',
  'akoya_title',
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

const ACCOUNT_SELECT = 'akoya_aka,name,address1_city,address1_stateorprovince,wmkf_countofprogramgrants,wmkf_sumofprogramgrants';

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
  getProposalNarrative: getAiProposalNarrativeText,
  getMostRecentProgramGrant: findMostRecentProgramGrant,
  runPrompt: executePrompt,
});

function clean(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function cleanInstitutionName(value) {
  const text = clean(value);
  if (!text || /^(?:n\/?a|n\.a\.?|none|null|not specified|unknown)$/i.test(text)) return null;
  return text;
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
  const [coPIs, proposalNarrative] = await Promise.all([
    dependencies.getCoPIs(requestId),
    dependencies.getProposalNarrative(requestId, requestNumber),
  ]);
  if (!proposalNarrative?.text || proposalNarrative.text.trim().length < 60) {
    throw new ServiceHttpError(
      `No usable AI proposal narrative was found at AI Materials/ProposalNarrative_${requestNumber || ''}.pdf.`,
      { httpStatus: 409, code: 'proposal_narrative_unavailable' },
    );
  }

  const applicantId = request._akoya_applicantid_value;
  if (!isGuid(applicantId)) {
    throw new ServiceHttpError('The request has no applicant institution; funding history cannot be determined.', {
      httpStatus: 409,
      code: 'pre_site_visit_funding_history_unavailable',
    });
  }
  let applicant;
  let mostRecentProgramGrant;
  try {
    [applicant, mostRecentProgramGrant] = await Promise.all([
      dependencies.getApplicant(applicantId),
      dependencies.getMostRecentProgramGrant(applicantId),
    ]);
  } catch (error) {
    console.warn('[pre-site-visit] applicant funding-history read failed', {
      requestId,
      error: error?.message || String(error),
    });
    throw new ServiceHttpError('The applicant institution or its funding history could not be read from Dataverse.', {
      httpStatus: 409,
      code: 'pre_site_visit_funding_history_unavailable',
    });
  }
  if (!applicant) {
    throw new ServiceHttpError('The applicant institution record could not be found; funding history cannot be determined.', {
      httpStatus: 409,
      code: 'pre_site_visit_funding_history_unavailable',
    });
  }
  // The rollups recalculate on a schedule. If the live query finds a program
  // grant the rollup count does not yet reflect, rendering "has not previously
  // received" would be false — fail closed until the rollup catches up.
  const programGrantCount = Number(applicant.wmkf_countofprogramgrants);
  if (!(programGrantCount > 0) && mostRecentProgramGrant) {
    throw new ServiceHttpError(
      'The applicant account award-history rollup has not caught up with a program grant on record; retry after the rollup refreshes.',
      { httpStatus: 409, code: 'pre_site_visit_funding_history_unavailable' },
    );
  }

  const applicantInstitution = cleanInstitutionName(applicant?.akoya_aka)
    || cleanInstitutionName(applicant?.name)
    || cleanInstitutionName(request._akoya_applicantid_value_formatted);
  const institutionalFundingHistory = applicantInstitution
    ? formatInstitutionalFundingHistory({
      institutionName: applicantInstitution,
      programGrantCount: applicant.wmkf_countofprogramgrants,
      programGrantSum: applicant.wmkf_sumofprogramgrants,
      mostRecentGrant: mostRecentProgramGrant ? {
        awardedIn: clean(mostRecentProgramGrant.akoya_fiscalyear)
          || formatMeetingDate(mostRecentProgramGrant.akoya_decisiondate),
        description: mostRecentProgramGrant.wmkf_wmkfprojectdescription,
      } : null,
    })
    : null;
  const personnel = personnelRoster(request._wmkf_projectleader_value_formatted, coPIs);
  const city = clean(applicant?.address1_city);
  const state = abbreviateState(applicant?.address1_stateorprovince);

  const context = {
    requestId: request.akoya_requestid,
    requestNumber,
    projectTitle: clean(request.akoya_title),
    cycleCode: request.wmkf_meetingdate
      ? meetingDateToCycleCode(request.wmkf_meetingdate)?.toUpperCase() || null
      : null,
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
      institutionalFundingHistory,
    },
  };
  requireIdentity(context);

  return {
    context,
    proposalNarrative,
  };
}

export function promptContext(context) {
  return {
    requestNumber: context.requestNumber,
    projectTitle: context.projectTitle,
    applicantInstitution: context.applicantInstitution,
    projectPeriod: context.projectPeriod,
    personnel: context.personnel,
  };
}

function paragraphs(value) {
  return String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n+/)
    .map((paragraph) => paragraph.replace(/\s*\n\s*/g, ' ').replace(/[\t ]+/g, ' ').trim())
    .filter(Boolean);
}

function normalizeSection(value, maxParagraphs) {
  const normalized = paragraphs(value);
  return normalized.join(maxParagraphs === 1 ? ' ' : '\n\n');
}

function wordCount(value) {
  const text = String(value || '').trim();
  return text ? text.split(/\s+/).length : 0;
}

function contentDiagnostics(proposalCore, {
  personnelNames = [],
  aiPayloadBoundaries = [],
  droppedOutputPaths = [],
} = {}) {
  const diagnostics = [];
  for (const key of PROPOSAL_CORE_KEYS) {
    const policy = PRE_SITE_VISIT_CONTENT_POLICY.sections[key];
    const value = proposalCore[key];
    const observedWords = wordCount(value);
    const observedChars = value.length;
    if (observedChars > policy.targetChars
      || (policy.targetWords && observedWords > policy.targetWords.max)) {
      diagnostics.push({
        code: 'section_over_target',
        section: key,
        observedWords,
        observedChars,
        targetWords: policy.targetWords?.max ?? null,
        targetChars: policy.targetChars,
      });
    }
    const observedParagraphs = paragraphs(value).length;
    if (policy.maxParagraphs > 1 && observedParagraphs > policy.maxParagraphs) {
      diagnostics.push({
        code: 'paragraphs_over_target',
        section: key,
        observed: observedParagraphs,
        target: policy.maxParagraphs,
      });
    }
  }

  const combined = PRE_SITE_VISIT_CONTENT_POLICY.combinedLongForm.fields
    .reduce((total, key) => total + wordCount(proposalCore[key]), 0);
  if (combined > PRE_SITE_VISIT_CONTENT_POLICY.combinedLongForm.targetWords) {
    diagnostics.push({
      code: 'long_form_over_target',
      observedWords: combined,
      targetWords: PRE_SITE_VISIT_CONTENT_POLICY.combinedLongForm.targetWords,
    });
  }

  for (const section of ['personnelOverview', 'personnelDetails']) {
    for (const rawName of personnelNames) {
      const name = String(rawName || '').trim();
      if (name && !proposalCore[section].includes(name)) {
        diagnostics.push({ code: 'personnel_name_not_matched', section, rosterDisplayName: name });
      }
    }
  }

  const proposalBoundary = aiPayloadBoundaries.find((boundary) => (
    boundary?.dataClass === 'proposal_text'
    && boundary?.truncated === true
  ));
  if (proposalBoundary) {
    diagnostics.push({
      code: 'proposal_input_truncated',
      originalChars: proposalBoundary.originalChars,
      transmittedChars: proposalBoundary.transmittedChars,
    });
  }

  for (const path of droppedOutputPaths) {
    diagnostics.push({ code: 'extra_output_key_dropped', path: String(path).slice(0, 200) });
  }
  return diagnostics;
}

export function prepareGeneratedCore(value, options = {}) {
  const rawExtraPaths = value && typeof value === 'object' && !Array.isArray(value)
    ? Object.keys(value)
      .filter((key) => !PROPOSAL_CORE_KEYS.includes(key))
      .map((key) => `$.proposalCore.${key}`)
    : [];
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
  const proposalCore = Object.fromEntries(PROPOSAL_CORE_KEYS.map((key) => {
    const policy = PRE_SITE_VISIT_CONTENT_POLICY.sections[key];
    return [key, normalizeSection(validation.value.proposalCore[key], policy.maxParagraphs)];
  }));
  for (const key of PROPOSAL_CORE_KEYS) {
    if (!proposalCore[key]) {
      throw new ServiceHttpError(`The governed Pre-Site Visit prompt returned an empty ${key} section.`, {
        httpStatus: 502,
        code: 'pre_site_visit_prompt_empty_section',
      });
    }
    if (RESERVED_TEMPLATE_TOKEN.test(proposalCore[key])) {
      throw new ServiceHttpError(`The governed Pre-Site Visit prompt returned a reserved template token in ${key}.`, {
        httpStatus: 502,
        code: 'pre_site_visit_prompt_reserved_token',
      });
    }
  }
  return {
    proposalCore,
    diagnostics: contentDiagnostics(proposalCore, {
      ...options,
      droppedOutputPaths: [
        ...rawExtraPaths,
        ...(options.droppedOutputPaths || []),
      ],
    }),
  };
}

export function validateGeneratedCore(value, options = {}) {
  return prepareGeneratedCore(value, options).proposalCore;
}

/** Execute the governed prompt against an already-frozen input load. */
export async function generatePreSiteVisitProposalCoreFromInputs({
  requestId,
  inputs,
  actingUserSystemId = null,
  runSource = 'Vercel User',
}, dependencies = DEFAULT_DEPENDENCIES) {
  if (!inputs?.context || !inputs?.proposalNarrative) {
    throw new ServiceHttpError('Frozen Pre-Site Visit inputs are required.', {
      httpStatus: 500,
      code: 'pre_site_visit_inputs_missing',
    });
  }
  const result = await dependencies.runPrompt({
    promptName: PROMPT_NAME,
    requestId,
    overrideVariables: {
      request_context_json: JSON.stringify(promptContext(inputs.context), null, 2),
      proposal_text: inputs.proposalNarrative.text,
    },
    runSource,
    actingUserSystemId,
    assertSystemIncludes: REQUIRED_SYSTEM_ASSERTIONS,
    requireNoPersistence: true,
    // Eight governed sections over a full proposal is the suite's longest
    // Claude call; the shared 120s default timed out in production
    // (2026-08-28, run 88f7c877). 240s still fits the route's 300s budget
    // with render/upload margin; overruns land in the durable failure
    // contract as before.
    timeoutMsOverride: 240_000,
  });

  if (result?.blocked || !result?.parsed?.proposalCore) {
    throw new ServiceHttpError('The governed Pre-Site Visit prompt returned no proposal core.', {
      httpStatus: 502,
      code: 'pre_site_visit_prompt_empty',
    });
  }
  const prepared = prepareGeneratedCore(result.parsed.proposalCore, {
    personnelNames: inputs.context.personnel.map((person) => person.name),
    aiPayloadBoundaries: result.meta?.aiPayloadBoundaries || [],
    droppedOutputPaths: result.meta?.droppedOutputPaths || [],
  });

  return {
    proposalCore: prepared.proposalCore,
    diagnostics: prepared.diagnostics,
    context: inputs.context,
    sources: [{
      role: 'proposalNarrative',
      filename: inputs.proposalNarrative.filename,
      siteId: inputs.proposalNarrative.siteId,
      driveId: inputs.proposalNarrative.driveId,
      itemId: inputs.proposalNarrative.itemId,
      versionId: inputs.proposalNarrative.versionId,
      contentHash: inputs.proposalNarrative.contentHash,
    }],
    runId: result.runId || null,
    usage: result.usage || null,
    meta: result.meta || null,
  };
}

/** Generate the governed eight-section proposal core without business-field persistence. */
export async function generatePreSiteVisitProposalCore({
  requestId,
  actingUserSystemId = null,
  runSource = 'Vercel User',
}, dependencies = DEFAULT_DEPENDENCIES) {
  const inputs = await loadPreSiteVisitInputs({ requestId }, dependencies);
  return generatePreSiteVisitProposalCoreFromInputs({
    requestId,
    inputs,
    actingUserSystemId,
    runSource,
  }, dependencies);
}
