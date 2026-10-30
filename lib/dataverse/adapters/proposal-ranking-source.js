/**
 * Read-only source adapter for Proposal Ranking's frozen proposal/review inputs.
 * Every scan is paginated and a capped or failed scan aborts the preview.
 */

import { DynamicsService } from '../../services/dynamics-service.js';
import { fetchAnswersBySuggestion } from './review-answer.js';
import { entitySet } from '../core/entity-registry.js';
import { withOrdinaryTestRequestODataFilter, syntheticReviewerVisibilityDto } from '../../services/test-requests/isolation.js';
import { parseCycleCode } from '../../utils/cycle-code.js';
import { linkedCycleExpand, linkedCycleFilter } from './operations-grant-cycle.js';
import { RESEARCH_PROGRAM_IDS } from '../../../shared/config/researchPrograms.js';
import { PHASE_II_PENDING } from '../../../shared/config/workbenchVisibility.js';
import { summarizeResearchFunding, unavailableResearchFunding } from '../../services/proposal-ranking/research-funding.js';
import { applyProposalRankingTrialCutoff } from '../../services/proposal-ranking/trial-cutoff.js';
import { getRankingTestPolicy, RANKING_TEST_CYCLE, RANKING_TEST_REQUESTS, RANKING_TEST_RUN } from '../../services/proposal-ranking/test-policy.js';
import { rehearsalPresentation } from '../../services/proposal-ranking/test-fixtures.js';

const REQUEST_SET = entitySet('akoya_requests');
const SUGGESTION_SET = entitySet('wmkf_appreviewersuggestions');
const REVIEWER_SET = entitySet('wmkf_potentialreviewerses');
const USER_SET = entitySet('systemusers');
const CURRENCY_SET = entitySet('transactioncurrencies');
const ACCOUNT_SET = entitySet('accounts');
const REQUEST_SELECT = [
  'akoya_requestid', 'akoya_requestnum', 'akoya_title', 'akoya_request', 'wmkf_invitedamount',
  'wmkf_meetingdate', 'akoya_requeststatus',
  'wmkf_istestrequest', 'wmkf_testcreationrunid',
  '_akoya_programid_value', '_akoya_applicantid_value', '_wmkf_programdirector_value', '_transactioncurrencyid_value',
].join(',');
const SUGGESTION_SELECT = [
  'wmkf_appreviewersuggestionid', '_wmkf_request_value', '_wmkf_potentialreviewer_value',
  'wmkf_reviewreceivedat', 'wmkf_selected', 'wmkf_accepted', 'wmkf_invited', 'wmkf_declined',
].join(',');
const REVIEWER_SELECT = 'wmkf_potentialreviewersid,wmkf_issyntheticreviewer,statecode';
const USER_SELECT = 'systemuserid,fullname,isdisabled';

function requireComplete(result, label) {
  if (result?.capped) throw new Error(`${label} reached Dataverse's pagination limit.`);
  if (!Array.isArray(result?.records)) throw new Error(`${label} did not return a complete record set.`);
  return result.records;
}

function odataGuidOr(field, ids) {
  return `(${ids.map((id) => `${field} eq ${id}`).join(' or ')})`;
}

async function queryChunked(entitySetName, ids, field, select, label, chunkSize = 20) {
  const all = [];
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const result = await DynamicsService.queryAllRecords(entitySetName, {
      select,
      filter: odataGuidOr(field, chunk),
      orderby: 'createdon asc',
    });
    all.push(...requireComplete(result, label));
  }
  return all;
}

const FUNDING_SELECT = [
  'akoya_requestid', 'akoya_requestnum', '_akoya_applicantid_value',
  'akoya_grant', 'akoya_fiscalyear', 'akoya_decisiondate',
  'akoya_requeststatus', '_akoya_programid_value', '_wmkf_grantprogram_value',
  'wmkf_typeforrollup', 'wmkf_supporttype2', '_transactioncurrencyid_value',
].join(',');

async function readInstitutionFunding(accounts, env) {
  const rows = [];
  const ids = accounts.map((account) => account.accountid.toLowerCase());
  for (let i = 0; i < ids.length; i += 20) {
    const filter = `${odataGuidOr('_akoya_applicantid_value', ids.slice(i, i + 20))} and akoya_grant gt 0`;
    rows.push(...requireComplete(await DynamicsService.queryAllRecords(REQUEST_SET, {
      select: FUNDING_SELECT,
      filter: withOrdinaryTestRequestODataFilter(filter, env),
      orderby: 'akoya_requestid asc',
    }), 'Institution research funding scan'));
  }
  const currencyIds = [...new Set(rows.map((row) => row._transactioncurrencyid_value?.toLowerCase()).filter(Boolean))];
  const currencies = await queryChunked(CURRENCY_SET, currencyIds, 'transactioncurrencyid', 'transactioncurrencyid,isocurrencycode', 'Historical award currency scan');
  const currencyById = new Map(currencies.map((row) => [row.transactioncurrencyid.toLowerCase(), row]));
  return new Map(accounts.map((account) => [account.accountid.toLowerCase(), summarizeResearchFunding(
    rows.filter((row) => row._akoya_applicantid_value?.toLowerCase() === account.accountid.toLowerCase()), account, currencyById,
  )]));
}

/** Read current-cycle proposals, assignment identities, peer reviews, and currency metadata. */
export async function readProposalRankingSource(cycleCode, env = process.env) {
  const testPolicy = getRankingTestPolicy(env);
  if (testPolicy.requested && (!testPolicy.enabled || cycleCode !== RANKING_TEST_CYCLE)) {
    throw new Error('Ranking rehearsal source is unavailable.');
  }
  const cycleFilter = parseCycleCode(cycleCode) ? linkedCycleFilter(cycleCode.trim().toUpperCase()) : null;
  if (!cycleFilter) throw new Error('Choose a valid June or December funding cycle.');
  const programFilter = `(${RESEARCH_PROGRAM_IDS.map((id) => `_akoya_programid_value eq ${id}`).join(' or ')})`;
  const baseFilter = `${cycleFilter} and ${programFilter}`;
  const requestResult = await DynamicsService.queryAllRecords(REQUEST_SET, {
    select: REQUEST_SELECT,
    filter: testPolicy.enabled
      ? `${baseFilter} and wmkf_istestrequest eq true and wmkf_testcreationrunid eq '${RANKING_TEST_RUN}' and ${odataGuidOr('akoya_requestid', RANKING_TEST_REQUESTS)}`
      : withOrdinaryTestRequestODataFilter(baseFilter, env),
    expand: linkedCycleExpand(),
    orderby: 'akoya_requestnum asc,akoya_requestid asc',
  });
  const scannedCycleRows = requireComplete(requestResult, 'Funding-cycle proposal scan');
  if (testPolicy.enabled && (scannedCycleRows.length !== RANKING_TEST_REQUESTS.length
    || new Set(scannedCycleRows.map((row) => row.akoya_requestid)).size !== RANKING_TEST_REQUESTS.length
    || scannedCycleRows.some((row) => !RANKING_TEST_REQUESTS.includes(row.akoya_requestid?.toLowerCase())
      || row.wmkf_istestrequest !== true || row.wmkf_testcreationrunid !== RANKING_TEST_RUN
      || row.akoya_requeststatus !== PHASE_II_PENDING))) {
    throw new Error('The exact ranking rehearsal proposal set is not available.');
  }
  const { requests: cycleRows } = applyProposalRankingTrialCutoff(scannedCycleRows);
  const eligible = cycleRows.filter((row) => row.akoya_requeststatus === PHASE_II_PENDING);
  const unexpectedStatuses = [...new Set(cycleRows
    .map((row) => row.akoya_requeststatus)
    .filter((status) => status !== PHASE_II_PENDING))]
    .sort((a, b) => String(a ?? '').localeCompare(String(b ?? '')));
  const requestIds = eligible.map((row) => String(row.akoya_requestid || '').toLowerCase()).filter(Boolean);
  const suggestionRows = await queryChunked(
    SUGGESTION_SET, requestIds, '_wmkf_request_value', SUGGESTION_SELECT, 'Peer-review assignment scan',
  );
  const reviewerIds = [...new Set(suggestionRows.map((row) => row._wmkf_potentialreviewer_value).filter(Boolean).map((id) => id.toLowerCase()))];
  const reviewerRows = await queryChunked(
    REVIEWER_SET, reviewerIds, 'wmkf_potentialreviewersid', REVIEWER_SELECT, 'Reviewer isolation scan',
  );
  const reviewerById = new Map(reviewerRows.map((row) => [row.wmkf_potentialreviewersid.toLowerCase(), row]));
  const receivedSuggestions = suggestionRows.filter((row) => Boolean(row.wmkf_reviewreceivedat));
  const answersBySuggestion = await fetchAnswersBySuggestion(
    receivedSuggestions.map((row) => row.wmkf_appreviewersuggestionid).filter(Boolean),
  );
  const reviewsByRequest = new Map();
  for (const row of suggestionRows) {
    const requestId = String(row._wmkf_request_value || '').toLowerCase();
    const reviewerId = String(row._wmkf_potentialreviewer_value || '').toLowerCase();
    const reviewer = reviewerById.get(reviewerId);
    if (!reviewer) throw new Error('A peer-review assignment has no readable reviewer identity.');
    const markerDto = syntheticReviewerVisibilityDto(reviewer, env);
    const answerRows = answersBySuggestion[row.wmkf_appreviewersuggestionid] || [];
    const ratingAnswer = answerRows.find((answer) => answer.questionKey === 'overallAssessment') || null;
    const review = {
      received: Boolean(row.wmkf_reviewreceivedat),
      outstanding: row.wmkf_selected === true
        && (row.wmkf_accepted === true || row.wmkf_invited === true)
        && row.wmkf_declined !== true
        && !row.wmkf_reviewreceivedat,
      synthetic: markerDto.isSyntheticReviewer === true,
      answer: ratingAnswer ? {
        answerValue: ratingAnswer.answerValue,
        answerText: ratingAnswer.answerText,
        questionOptions: ratingAnswer.questionOptions,
        questionOptionsUnreadable: ratingAnswer.questionOptionsUnreadable,
      } : null,
    };
    if (!reviewsByRequest.has(requestId)) reviewsByRequest.set(requestId, []);
    reviewsByRequest.get(requestId).push(review);
  }

  const currencyIds = [...new Set(eligible.map((row) => row._transactioncurrencyid_value).filter(Boolean).map((id) => id.toLowerCase()))];
  const currencies = currencyIds.length
    ? await queryChunked(CURRENCY_SET, currencyIds, 'transactioncurrencyid', 'transactioncurrencyid,currencyname,isocurrencycode,currencyprecision', 'Currency metadata scan')
    : [];
  const currencyById = new Map(currencies.map((currency) => [currency.transactioncurrencyid.toLowerCase(), currency]));
  const applicantIds = [...new Set(eligible.map((row) => row._akoya_applicantid_value).filter(Boolean).map((id) => id.toLowerCase()))];
  const accounts = applicantIds.length
    ? await queryChunked(ACCOUNT_SET, applicantIds, 'accountid', env.PROPOSAL_RANKING_WORKFLOW_V2 === 'on' ? 'accountid,name,wmkf_eastwest,wmkf_countofprogramgrants,wmkf_sumofprogramgrants' : 'accountid,name,wmkf_eastwest', 'Applicant institution scan')
    : [];
  const fundingByApplicantId = env.PROPOSAL_RANKING_WORKFLOW_V2 === 'on' ? await readInstitutionFunding(accounts, env) : new Map();
  const accountByApplicantId = new Map(accounts.map((account) => [account.accountid.toLowerCase(), account]));
  const leadIds = [...new Set(eligible.map((row) => row._wmkf_programdirector_value).filter(Boolean).map((id) => id.toLowerCase()))];
  const users = leadIds.length
    ? await queryChunked(USER_SET, leadIds, 'systemuserid', USER_SELECT, 'Program Director identity scan')
    : [];
  const userById = new Map(users.map((user) => [user.systemuserid.toLowerCase(), user]));

  return {
    proposals: eligible.map((row) => {
      const requestId = row.akoya_requestid.toLowerCase();
      const currencyId = row._transactioncurrencyid_value?.toLowerCase() || null;
      const currency = currencyId ? currencyById.get(currencyId) : null;
      const applicantAccount = accountByApplicantId.get(row._akoya_applicantid_value?.toLowerCase());
      const sample = rehearsalPresentation(requestId, env);
      return {
        requestId,
        requestNumber: row.akoya_requestnum || '',
        title: row.akoya_title || '',
        organization: sample?.organization || applicantAccount?.name || '',
        institutionGeography: sample?.institutionGeography || (applicantAccount?.wmkf_eastwest === 100000000
          ? 'East'
          : applicantAccount?.wmkf_eastwest === 100000001 ? 'West' : null),
        researchFunding: sample?.researchFunding || fundingByApplicantId.get(row._akoya_applicantid_value?.toLowerCase()) || unavailableResearchFunding(),
        programKey: row._akoya_programid_value?.toLowerCase() === RESEARCH_PROGRAM_IDS[0] ? 'se' : 'mr',
        leadSystemUserId: row._wmkf_programdirector_value?.toLowerCase() || null,
        leadSystemUser: row._wmkf_programdirector_value ? userById.get(row._wmkf_programdirector_value.toLowerCase()) || null : null,
        // Invited amount is the ranking amount; requested is the fallback when it is blank.
        amount: row.wmkf_invitedamount != null ? Number(row.wmkf_invitedamount)
          : row.akoya_request == null ? null : Number(row.akoya_request),
        amountSource: row.wmkf_invitedamount != null ? 'invited' : row.akoya_request == null ? null : 'requested',
        currency: currency ? {
          id: currency.transactioncurrencyid.toLowerCase(),
          code: currency.isocurrencycode || null,
          name: currency.currencyname || null,
          precision: Number(currency.currencyprecision),
        } : null,
        reviews: reviewsByRequest.get(requestId) || [],
      };
    }),
    unexpectedStatuses,
    sourceRequestCount: cycleRows.length,
    scannedRequestCount: scannedCycleRows.length,
  };
}

export async function listEnabledProposalRankingStaff() {
  const result = await DynamicsService.queryAllRecords(USER_SET, {
    select: USER_SELECT,
    filter: 'isdisabled eq false',
    orderby: 'fullname asc',
  });
  return requireComplete(result, 'Active staff directory').map((row) => ({
    systemUserId: String(row.systemuserid || '').toLowerCase(),
    name: row.fullname || '',
    enabled: row.isdisabled === false,
  }));
}

export async function readEnabledProposalRankingStaff(systemUserId) {
  const id = String(systemUserId || '').toLowerCase();
  const result = await DynamicsService.getRecord(USER_SET, id, { select: USER_SELECT });
  if (!result || result.isdisabled !== false) return null;
  return { systemUserId: id, name: result.fullname || '', enabled: true };
}
