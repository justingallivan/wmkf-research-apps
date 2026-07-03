/**
 * Trusted request metadata for reviewer analysis.
 *
 * Reviewer-finder Stage 1 still needs scientific interpretation from the LLM,
 * but request identity fields already live in Dataverse. Keep those fields out
 * of the model's inference burden and merge them back into the stable
 * `proposalInfo` shape downstream consumers already expect.
 */

import { DynamicsService } from './dynamics-service.js';
import { fetchCoPIs } from './proposal-participants.js';
import { isGuid } from '../utils/guid.js';
import { normalizeSuggestionProgramArea } from '../dataverse/adapters/reviewer-suggestion.js';

const REQUEST_SELECT = [
  'akoya_requestid',
  'akoya_title',
  'wmkf_abstract',
  'wmkf_organizationname',
  '_akoya_applicantid_value',
  '_wmkf_projectleader_value',
  '_akoya_programid_value',
  '_wmkf_programareaserved_value',
  '_wmkf_grantprogram_value',
].join(',');

function clean(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  if (!text) return null;
  if (/^(?:n\/?a|n\.a\.?|none|null|not specified|unknown)$/i.test(text)) return null;
  return text;
}

function firstClean(...values) {
  for (const value of values) {
    const text = clean(value);
    if (text) return text;
  }
  return null;
}

export function projectReviewerRequestContext(request, coPIs = []) {
  if (!request) return null;
  const coInvestigatorNames = Array.isArray(coPIs)
    ? coPIs.map(clean).filter(Boolean)
    : [];
  const programArea = normalizeSuggestionProgramArea(firstClean(
    request._akoya_programid_value_formatted,
    request._wmkf_programareaserved_value_formatted,
    request._wmkf_grantprogram_value_formatted,
  ));
  const principalInvestigator = clean(request._wmkf_projectleader_value_formatted);

  return {
    requestId: request.akoya_requestid || null,
    title: clean(request.akoya_title),
    programArea,
    principalInvestigator,
    proposalAuthors: principalInvestigator,
    coInvestigators: coInvestigatorNames.length ? coInvestigatorNames.join(', ') : 'None',
    coInvestigatorCount: String(coInvestigatorNames.length),
    authorInstitution: firstClean(
      request._akoya_applicantid_value_formatted,
      request.wmkf_organizationname,
    ),
    abstract: clean(request.wmkf_abstract),
  };
}

export async function loadReviewerRequestContext(requestId) {
  if (!requestId) {
    const err = new Error('requestId is required for reviewer analysis');
    err.statusCode = 400;
    throw err;
  }
  if (!isGuid(requestId)) {
    const err = new Error('requestId is not a valid GUID');
    err.statusCode = 400;
    throw err;
  }
  const request = await DynamicsService.getRecord('akoya_requests', requestId, {
    select: REQUEST_SELECT,
  });
  if (!request?.akoya_requestid) {
    const err = new Error(`Request ${requestId} was not found`);
    err.statusCode = 404;
    throw err;
  }
  const coPIs = await fetchCoPIs(requestId);
  return projectReviewerRequestContext(request, coPIs);
}

export function mergeRequestContextIntoAnalysisResult(result, requestContext) {
  if (!requestContext) return result;

  const proposalInfo = {
    ...(result?.proposalInfo || {}),
  };
  for (const key of [
    'title',
    'programArea',
    'principalInvestigator',
    'proposalAuthors',
    'coInvestigators',
    'coInvestigatorCount',
    'authorInstitution',
    'abstract',
  ]) {
    const value = clean(requestContext[key]);
    if (value) proposalInfo[key] = value;
  }

  // Co-PI absence is meaningful when the context came from the request row and
  // the apprequestperson junction returned no Co-PI rows.
  if (requestContext.coInvestigators === 'None') proposalInfo.coInvestigators = 'None';
  if (requestContext.coInvestigatorCount === '0') proposalInfo.coInvestigatorCount = '0';

  return {
    ...(result || {}),
    proposalInfo,
    reviewerSuggestions: result?.reviewerSuggestions || [],
    searchQueries: result?.searchQueries || { pubmed: [], arxiv: [], biorxiv: [], chemrxiv: [] },
  };
}

export function formatTrustedRequestMetadata(requestContext) {
  if (!requestContext) return '';
  const rows = [
    ['TITLE', requestContext.title],
    ['PRINCIPAL_INVESTIGATOR', requestContext.principalInvestigator],
    ['CO_INVESTIGATORS', requestContext.coInvestigators],
    ['CO_INVESTIGATOR_COUNT', requestContext.coInvestigatorCount],
    ['AUTHOR_INSTITUTION', requestContext.authorInstitution],
  ];
  const lines = rows
    .map(([label, value]) => `${label}: ${clean(value) || 'Not specified'}`)
    .join('\n');
  return `**TRUSTED REQUEST METADATA (from Dataverse; do not infer or override from proposal text):**\n${lines}`;
}
