/**
 * Trusted request metadata for reviewer analysis.
 *
 * Reviewer-finder Stage 1 still needs scientific interpretation from the LLM,
 * but request identity fields already live in Dataverse. Keep those fields out
 * of the model's inference burden and merge them back into the stable
 * `proposalInfo` shape downstream consumers already expect.
 */

import { fetchCoPIs } from './proposal-participants.js';
import { resolveProposalPI, piInstitutions } from './proposal-pi-identity.js';
import { ServiceHttpError } from './service-http-error.js';
import { isGuid } from '../utils/guid.js';
import { normalizeSuggestionProgramArea } from '../dataverse/adapters/reviewer-suggestion.js';
import * as grantRequestAdapter from '../dataverse/adapters/grant-request.js';
import * as accountAdapter from '../dataverse/adapters/account.js';

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

// The applicant account carries several name forms (DYNAMICS_SCHEMA_ANNOTATION.md
// → accounts): `name` (legal or common), `akoya_aka` (common/short, ~95%),
// `wmkf_legalname` (official legal, ~83%). We gather all three so same-institution
// exclusion matches whichever form a candidate's affiliation uses.
const APPLICANT_ACCOUNT_SELECT = 'name,akoya_aka,wmkf_legalname';

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

function institutionDisplayName(institution) {
  if (!institution) return null;
  if (typeof institution === 'string') return clean(institution);
  return firstClean(
    institution.name,
    institution.displayName,
    institution.institution,
    institution.affiliation,
    institution.currentAffiliation,
    institution.lastKnownInstitution,
  );
}

function coiInstitutionEntry(institution) {
  const display = institutionDisplayName(institution);
  if (!display) return null;
  return {
    identity: institution,
    display,
  };
}

// Dedupe cleaned names case/space-insensitively, preserving first-seen form.
function dedupeNames(values) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const text = clean(value);
    if (!text) continue;
    const key = text.toLowerCase().replace(/\s+/g, ' ').trim();
    if (!seen.has(key)) { seen.add(key); out.push(text); }
  }
  return out;
}

function errorSummary(error) {
  if (!error) return null;
  return {
    message: error?.message || String(error),
    name: error?.name || null,
  };
}

function projectApplicantInstitutionContext(request, applicantAccount = null, fetchError = null) {
  const applicantAccountId = clean(request?._akoya_applicantid_value);
  const canFetchAccount = applicantAccountId && isGuid(applicantAccountId);
  const names = dedupeNames([
    request?._akoya_applicantid_value_formatted,
    request?.wmkf_organizationname,
    applicantAccount?.name,
    applicantAccount?.akoya_aka,
    applicantAccount?.wmkf_legalname,
  ]);

  return {
    state: !canFetchAccount || applicantAccount ? 'complete' : 'fallback',
    names,
    applicantAccountId: applicantAccountId || null,
    fetchError: errorSummary(fetchError),
  };
}

function assertCompleteApplicantInstitutionContext(requestId, context) {
  const applicantInstitutionContext = context?.applicantInstitutionContext;
  if (
    applicantInstitutionContext?.state === 'complete'
    && Array.isArray(applicantInstitutionContext.names)
    && applicantInstitutionContext.names.length > 0
  ) {
    return;
  }
  throw new ServiceHttpError(
    'Applicant institution context is unavailable; save aborted to preserve institution COI enforcement.',
    {
      httpStatus: 503,
      code: 'applicant_institution_context_unavailable',
      body: {
        error: 'Applicant institution context is unavailable; save aborted to preserve institution COI enforcement.',
        code: 'applicant_institution_context_unavailable',
        requestId,
        applicantInstitutionContext: context?.applicantInstitutionContext || null,
      },
    },
  );
}

async function fetchApplicantAccountVariants(applicantId, requestId) {
  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      return {
        account: await accountAdapter.getById(applicantId, { select: APPLICANT_ACCOUNT_SELECT }),
        error: null,
      };
    } catch (error) {
      lastError = error;
      if (attempt < 2) continue;
    }
  }

  console.warn('[reviewer-request-context] applicant_account_variant_fetch_failed', {
    requestId,
    applicantId,
    select: APPLICANT_ACCOUNT_SELECT,
    attempts: 2,
    error: lastError?.message || String(lastError),
  });
  return { account: null, error: lastError };
}

export function projectReviewerRequestContext(request, coPIs = [], applicantAccount = null, applicantFetchError = null) {
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
  const applicantInstitutionContext = projectApplicantInstitutionContext(
    request,
    applicantAccount,
    applicantFetchError,
  );

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
    // All known name forms of the applicant institution, for same-institution
    // exclusion. Falls back to the single formatted-lookup name when the
    // applicant account could not be fetched.
    applicantInstitutionNames: applicantInstitutionContext.names,
    applicantInstitutionContext,
    abstract: clean(request.wmkf_abstract),
  };
}

export async function loadReviewerRequestContext(requestId, {
  includeCoPIs = true,
  requireCompleteInstitutions = false,
} = {}) {
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
  const request = await grantRequestAdapter.getById(requestId, { select: REQUEST_SELECT });
  if (!request?.akoya_requestid) {
    const err = new Error(`Request ${requestId} was not found`);
    err.statusCode = 404;
    throw err;
  }
  const coPIs = includeCoPIs ? await fetchCoPIs(requestId) : [];

  // Fetch the applicant account's name variants (aka / legal name) for
  // same-institution exclusion. Non-fatal: on any failure we fall back to the
  // request's formatted applicant name (still captured in the projection).
  let applicantAccount = null;
  let applicantFetchError = null;
  const applicantId = request._akoya_applicantid_value;
  if (applicantId && isGuid(applicantId)) {
    const result = await fetchApplicantAccountVariants(applicantId, requestId);
    applicantAccount = result.account;
    applicantFetchError = result.error;
  }

  const context = projectReviewerRequestContext(request, coPIs, applicantAccount, applicantFetchError);
  if (requireCompleteInstitutions) {
    assertCompleteApplicantInstitutionContext(requestId, context);
  }
  return context;
}

export async function loadCoiContext(requestId, {
  signal,
  resolvePi = true,
  includeCoPIs = false,
  requireCompleteInstitutions = true,
} = {}) {
  const requestContext = await loadReviewerRequestContext(requestId, {
    includeCoPIs,
    requireCompleteInstitutions,
  });

  let piIdentity = null;
  if (resolvePi) {
    try {
      piIdentity = await resolveProposalPI(requestId, { signal });
    } catch (error) {
      if (signal?.aborted) throw error;
      console.warn('[reviewer-request-context] proposal_pi_identity_resolve_failed', {
        requestId,
        error: error?.message || String(error),
      });
    }
  }

  const institutionEntries = [
    ...(requestContext.applicantInstitutionContext?.names || requestContext.applicantInstitutionNames || []),
    ...piInstitutions(piIdentity, requestContext.authorInstitution),
  ].map(coiInstitutionEntry).filter(Boolean);

  return {
    requestContext,
    applicantInstitutionContext: requestContext.applicantInstitutionContext || null,
    piIdentity,
    institutionEntries,
  };
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
