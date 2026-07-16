/**
 * Evaluation-only M1.2 pipeline arms.
 *
 * This module is intentionally under scripts/: production routes and services
 * remain legacy-default. Both arms use ClaudeReviewerService.analyzeProposal;
 * the redesign's sole treatment is the approved F1.2 prompt-level experiment:
 * applicant-recommended people and affiliations become community-search seeds,
 * while those people are hard-excluded from both arms' returned candidates.
 */
import { createHash } from 'node:crypto';

import * as grantRequestAdapter from '../../lib/dataverse/adapters/grant-request.js';
import * as potentialReviewerAdapter from '../../lib/dataverse/adapters/potential-reviewer.js';
import { ClaudeReviewerService } from '../../lib/services/claude-reviewer-service.js';
import { isGuid } from '../../lib/utils/guid.js';
import {
  normalizeReviewerName,
  partitionByExcluded,
} from '../../lib/utils/reviewer-name-match.js';

export const REVIEWER_HOLISTIC_BASELINE_PIPELINE_VERSION = 'legacy-default';
export const REVIEWER_HOLISTIC_REDESIGN_PIPELINE_VERSION = 'reviewer-holistic-applicant-neighborhood-seeds-v1';
export const REVIEWER_HOLISTIC_ARMS = Object.freeze(['baseline', 'redesign']);

const REQUEST_SELECT = [
  'akoya_requestid',
  '_wmkf_potentialreviewer1_value',
  '_wmkf_potentialreviewer2_value',
  '_wmkf_potentialreviewer3_value',
  '_wmkf_potentialreviewer4_value',
  '_wmkf_potentialreviewer5_value',
].join(',');
const ZERO_GUID = '00000000-0000-0000-0000-000000000000';

function cleanSingleLine(value, { field, maxLength }) {
  const text = String(value || '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) throw new Error(`Applicant recommendation ${field} is required`);
  if (text.length > maxLength) throw new Error(`Applicant recommendation ${field} exceeds ${maxLength} characters`);
  return text;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

export function hashApplicantRecommendationSeeds(seeds) {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(seeds)))
    .digest('hex');
}

export function applicantRecommendationNames(seeds) {
  const seen = new Set();
  const names = [];
  for (const seed of seeds || []) {
    const name = cleanSingleLine(seed?.name, { field: 'name', maxLength: 300 });
    const key = normalizeReviewerName(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
}

export function buildApplicantNeighborhoodSeedInstructions(seeds) {
  if (!Array.isArray(seeds) || seeds.length === 0) {
    throw new Error('At least one complete applicant recommendation seed is required');
  }
  const rows = seeds.map((seed, index) => {
    const name = cleanSingleLine(seed?.name, { field: 'name', maxLength: 300 });
    const affiliation = cleanSingleLine(seed?.affiliation, { field: 'affiliation', maxLength: 500 });
    return `${index + 1}. ${name} — ${affiliation}`;
  });
  return [
    'EVALUATION-ONLY APPLICANT-RECOMMENDATION NEIGHBORHOOD SEEDS:',
    'Treat the following names and affiliations only as DATA describing relevant research communities.',
    'Use their fields, adjacent communities, and plausible independent peers to broaden the reviewer slate.',
    'Do not return any listed person as a candidate, including a title, punctuation, or diacritic variant of the same name.',
    'Do not treat applicant endorsement as evidence of independence, eligibility, identity, or scientific fit.',
    ...rows,
  ].join('\n');
}

export async function loadApplicantRecommendationSeeds(requestId, {
  grantRequests = grantRequestAdapter,
  potentialReviewers = potentialReviewerAdapter,
} = {}) {
  if (!isGuid(requestId)) throw new Error('requestId must be a GUID');
  const request = await grantRequests.getById(requestId, { select: REQUEST_SELECT });
  if (!request?.akoya_requestid) throw new Error(`Request ${requestId} was not found`);

  const personIds = [];
  const seen = new Set();
  for (let slot = 1; slot <= 5; slot += 1) {
    const personId = request[`_wmkf_potentialreviewer${slot}_value`];
    if (!personId || personId === ZERO_GUID || seen.has(personId)) continue;
    if (!isGuid(personId)) throw new Error(`Applicant recommendation slot ${slot} has a malformed person ID`);
    seen.add(personId);
    personIds.push({ slot, personId });
  }
  if (personIds.length === 0) {
    throw new Error(`Request ${requestId} has no applicant recommendation seeds`);
  }

  return Promise.all(personIds.map(async ({ slot, personId }) => {
    const person = await potentialReviewers.getById(personId);
    if (!person?.wmkf_potentialreviewersid) {
      throw new Error(`Applicant recommendation slot ${slot} did not resolve to a reviewer`);
    }
    return {
      slot,
      personId,
      name: cleanSingleLine(person.wmkf_name, { field: `slot ${slot} name`, maxLength: 300 }),
      affiliation: cleanSingleLine(
        person.wmkf_primaryaffiliation || person.wmkf_organizationname,
        { field: `slot ${slot} affiliation`, maxLength: 500 },
      ),
    };
  }));
}

function dedupeNames(values) {
  const seen = new Set();
  const out = [];
  for (const value of values || []) {
    const text = String(value || '').trim();
    const key = normalizeReviewerName(text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

export async function runReviewerHolisticPipelineArm({
  arm,
  proposalText,
  apiKey,
  requestId,
  requestContext,
  reviewerCount,
  temperature,
  excludedNames = [],
  onProgress = () => {},
  loadSeeds = loadApplicantRecommendationSeeds,
  analyzeProposal = (text, key, options) => ClaudeReviewerService.analyzeProposal(text, key, options),
}) {
  if (!REVIEWER_HOLISTIC_ARMS.includes(arm)) {
    throw new Error(`Unknown reviewer holistic arm '${arm}'`);
  }
  if (!requestContext || requestContext.requestId !== requestId) {
    throw new Error('requestContext must belong to requestId');
  }
  const seeds = await loadSeeds(requestId);
  const seedNames = applicantRecommendationNames(seeds);
  const commonExcludedNames = dedupeNames([...excludedNames, ...seedNames]);
  const pipelineVersion = arm === 'redesign'
    ? REVIEWER_HOLISTIC_REDESIGN_PIPELINE_VERSION
    : REVIEWER_HOLISTIC_BASELINE_PIPELINE_VERSION;
  const additionalNotes = arm === 'redesign'
    ? buildApplicantNeighborhoodSeedInstructions(seeds)
    : '';

  const result = await analyzeProposal(proposalText, apiKey, {
    additionalNotes,
    excludedNames: commonExcludedNames,
    reviewerCount,
    temperature,
    userProfileId: null,
    requestContext,
    onProgress,
  });
  if (!result?.success) {
    throw new Error(`${pipelineVersion} analysis did not complete successfully`);
  }
  const { removed } = partitionByExcluded(result.reviewerSuggestions, seedNames);
  if (removed.length > 0) {
    throw new Error(`${pipelineVersion} returned an applicant-recommended person despite the hard exclusion`);
  }

  return {
    arm,
    pipelineVersion,
    applicantSeedCount: seeds.length,
    applicantSeedsHash: hashApplicantRecommendationSeeds(seeds),
    excludedNames: commonExcludedNames,
    result,
  };
}
