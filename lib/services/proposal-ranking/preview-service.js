import crypto from 'node:crypto';
import { resolveSystemUserToProfile } from '../dataverse-identity-map.js';
import { listAllGrantsForAdmin } from '../app-access-service.js';
import { readProposalRankingSource, readEnabledProposalRankingStaff } from '../../dataverse/adapters/proposal-ranking-source.js';
import {
  buildSeedOrder,
  moneyToMinorUnits,
  summarizeProposalReviews,
} from './calculations.js';
import { readDefaultFacilitator } from './config.js';
import { assertProposalRankingReady } from './readiness.js';

function httpError(message, status, code) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.publicMessage = true;
  return error;
}

export function stableFingerprint(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function countOutstandingOrdinaryReviews(proposals) {
  return proposals.reduce((count, proposal) => count + proposal.reviews.filter((review) => (
    review.synthetic === false && review.outstanding === true
  )).length, 0);
}

function cardScore(score) {
  return {
    mean: score.mean,
    displayMean: score.displayMean,
    ratedCount: score.ratedCount,
    receivedCount: score.receivedCount,
    distribution: score.distribution,
  };
}

/** Build the full server-side preview used both before opening and at open time. */
export async function buildProposalRankingPreview(cycleCode, env = process.env) {
  assertProposalRankingReady(env);
  const source = await readProposalRankingSource(cycleCode, env);
  const grantRows = await listAllGrantsForAdmin({ throwOnError: true });
  const grantsByProfile = new Map(grantRows.map((row) => [String(row.user_profile_id), row]));
  const usersById = new Map();
  for (const proposal of source.proposals) {
    if (proposal.leadSystemUser) usersById.set(proposal.leadSystemUserId, proposal.leadSystemUser);
  }

  const participantIds = [...new Set(source.proposals.map((proposal) => proposal.leadSystemUserId).filter(Boolean))].sort();
  const roster = [];
  const blockingProblems = [];
  for (const systemUserId of participantIds) {
    const user = usersById.get(systemUserId);
    const active = user?.isdisabled === false;
    const profileId = await resolveSystemUserToProfile(systemUserId);
    const grant = profileId == null ? null : grantsByProfile.get(String(profileId));
    const hasAppAccess = Boolean(grant?.apps?.includes('proposal-ranking'));
    if (!active) blockingProblems.push('A proposal is assigned to a staff identity that is missing or disabled. Correct the assignment before opening.');
    if (!profileId) blockingProblems.push('A proposal lead does not map to an active staff profile. Correct the staff identity before opening.');
    if (!hasAppAccess) blockingProblems.push('Every assigned Program Director needs Proposal Ranking app access before the round can open.');
    roster.push({ systemUserId, name: user?.fullname || '', hasAppAccess, active });
  }

  const defaultConfig = await readDefaultFacilitator();
  let defaultFacilitator = null;
  if (!defaultConfig.configured) {
    blockingProblems.push('An administrator must select the default facilitator before a round can open.');
  } else {
    let user;
    try {
      user = await readEnabledProposalRankingStaff(defaultConfig.systemUserId);
    } catch (error) {
      if (error?.status !== 404) throw error;
      user = null;
    }
    const profileId = await resolveSystemUserToProfile(defaultConfig.systemUserId);
    const grant = profileId == null ? null : grantsByProfile.get(String(profileId));
    if (!user) blockingProblems.push('The configured default facilitator is disabled or unavailable. Ask an administrator to choose an active staff member.');
    else if (!grant?.apps?.includes('proposal-ranking')) blockingProblems.push('The configured facilitator needs Proposal Ranking app access before a round can open.');
    defaultFacilitator = user ? { ...user, hasAppAccess: Boolean(grant?.apps?.includes('proposal-ranking')) } : null;
  }

  const summaries = new Map();
  const proposals = [];
  const outstandingReviewCount = countOutstandingOrdinaryReviews(source.proposals);
  const currencyIds = new Set();
  for (const raw of source.proposals) {
    const score = summarizeProposalReviews(raw.reviews);
    if (!score.ready) blockingProblems.push('At least one saved peer-review rating or reviewer marker needs correction before opening.');
    if (raw.amount != null && (!raw.currency || !raw.currency.code)) {
      blockingProblems.push('At least one requested amount has no verified currency. Correct the request before opening.');
    }
    if (raw.currency?.id) currencyIds.add(raw.currency.id);
    if (raw.amount != null && raw.currency) {
      const amountMinorUnits = moneyToMinorUnits(raw.amount, raw.currency.precision);
      if (amountMinorUnits == null) blockingProblems.push('At least one requested amount cannot be represented in its currency precision. Correct the request before opening.');
      proposals.push({
        requestId: raw.requestId,
        requestNumber: raw.requestNumber,
        title: raw.title,
        organization: raw.organization,
        programKey: raw.programKey,
        leadSystemUserId: raw.leadSystemUserId,
        amountMinorUnits,
        currency: { code: raw.currency.code, name: raw.currency.name, precision: raw.currency.precision },
        score: cardScore(score.ready ? score : { mean: null, displayMean: null, ratedCount: 0, receivedCount: 0, distribution: {} }),
      });
    } else {
      proposals.push({
        requestId: raw.requestId,
        requestNumber: raw.requestNumber,
        title: raw.title,
        organization: raw.organization,
        programKey: raw.programKey,
        leadSystemUserId: raw.leadSystemUserId,
        amountMinorUnits: null,
        currency: raw.currency ? { code: raw.currency.code, name: raw.currency.name, precision: raw.currency.precision } : null,
        score: cardScore(score.ready ? score : { mean: null, displayMean: null, ratedCount: 0, receivedCount: 0, distribution: {} }),
      });
    }
    summaries.set(raw.requestId, score);
  }

  if (currencyIds.size > 1) blockingProblems.push('The selected proposals use more than one currency. Resolve currency differences before opening.');
  const proposalIds = new Set(proposals.map((proposal) => proposal.requestId));
  const seedOrders = { se: [], mr: [] };
  for (const programKey of ['se', 'mr']) {
    const programProposals = proposals.filter((proposal) => proposal.programKey === programKey);
    seedOrders[programKey] = buildSeedOrder(programProposals.map((proposal) => ({
      ...proposal,
      score: summaries.get(proposal.requestId),
    })));
    if (programProposals.some((proposal) => !proposal.leadSystemUserId)) {
      blockingProblems.push('Every proposal needs an assigned lead Program Director before opening.');
    }
  }
  if (!proposalIds.size) blockingProblems.push('This cycle has no eligible Phase II proposals. No round can be opened.');
  if (source.unexpectedStatuses.length) {
    // Unexpected statuses are reported but never broadened into the pool.
  }

  const snapshot = {
    version: 1,
    cycleCode,
    proposals,
    seedOrders,
    roster: roster.map(({ systemUserId, name }) => ({ systemUserId, name, excluded: false })),
    initialRoster: participantIds,
  };
  const fingerprintInput = {
    snapshot,
    outstandingReviewCount,
    roster: roster.map(({ systemUserId, name, hasAppAccess, active }) => ({ systemUserId, name, hasAppAccess, active })),
    unexpectedStatuses: source.unexpectedStatuses,
    defaultFacilitatorSystemUserId: defaultConfig.systemUserId,
  };
  const warnings = [...new Set(blockingProblems)];
  if (source.unexpectedStatuses.length) warnings.push('Some proposals in this cycle use other request statuses; only Phase II Pending proposals are included.');
  return {
    cycleCode,
    proposals,
    seedOrders,
    roster,
    outstandingReviewCount,
    unexpectedStatuses: source.unexpectedStatuses,
    warnings,
    canOpen: blockingProblems.length === 0,
    blockingProblems: warnings,
    previewFingerprint: stableFingerprint(fingerprintInput),
    facilitator: defaultFacilitator,
    facilitatorSystemUserId: defaultConfig.systemUserId,
    snapshot,
  };
}

export function assertPreviewCanOpen(preview) {
  if (!preview?.canOpen) throw httpError(preview?.warnings?.join(' ') || 'The preview is not ready to open.', 409, 'incomplete_preview');
}
