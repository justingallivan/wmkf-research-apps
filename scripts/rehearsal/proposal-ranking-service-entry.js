/** Thin server-side boundary for the local synthetic rehearsal. */
import { randomUUID } from 'node:crypto';
import {
  handleProposalRankingAction,
  handleProposalRankingGet,
} from '../../lib/services/proposal-ranking/service.js';
import {
  getLastCreatedRoundId,
  getRehearsalProfiles,
  REHEARSAL_CYCLE_CODE,
  resetProposalRankingRehearsal,
} from './proposal-ranking-memory.js';

// The standalone process opts into only the readiness conditions checked by
// the real service. It does not load .env files or any application credentials.
process.env.PROPOSAL_RANKING_ENABLED = 'on';
process.env.PROPOSAL_RANKING_SCHEMA_READY = 'on';
process.env.TEST_REQUEST_ISOLATION = 'on';
process.env.SYNTHETIC_REVIEWER_ISOLATION = 'on';

export { getLastCreatedRoundId, getRehearsalProfiles, REHEARSAL_CYCLE_CODE };

let generation = 0;

export function getGeneration() {
  return generation;
}

export function resetProposalRankingServiceRehearsal() {
  resetProposalRankingRehearsal();
}

export function reset() {
  resetProposalRankingServiceRehearsal();
  generation += 1;
  return { generation };
}

export async function handleProposalRankingRehearsalGet({ profileId, cycleCode, roundId, operationId }) {
  assertSyntheticProfile(profileId);
  return handleProposalRankingGet({ profileId, cycleCode, roundId, operationId, isSuperuser: false });
}

export async function handleProposalRankingRehearsalAction({ profileId, action, body = {} }) {
  assertSyntheticProfile(profileId);
  return handleProposalRankingAction({ action, body, profileId, isSuperuser: false });
}

function assertSyntheticProfile(profileId) {
  const normalized = normalizeProfileId(profileId);
  if (!normalized) {
    const error = new Error('Choose one of the synthetic rehearsal participants.');
    error.status = 403;
    error.code = 'rehearsal_identity_denied';
    throw error;
  }
  return normalized;
}

function normalizeProfileId(profileId) {
  const people = getRehearsalProfiles();
  const numeric = Number(profileId);
  if (Number.isInteger(numeric) && numeric >= 1 && numeric <= people.length) return people[numeric - 1].profileId;
  return people.find((person) => person.profileId === String(profileId || ''))?.profileId || null;
}

// Launcher API: the server derives the profile from its local rehearsal
// selector/header and passes it separately from request bodies.
function requireCurrentGeneration(suppliedGeneration) {
  if (typeof suppliedGeneration !== 'number' || suppliedGeneration !== generation) {
    const error = new Error('The rehearsal was reset. Refresh and retry the current action.');
    error.status = 409;
    error.code = 'stale_rehearsal';
    throw error;
  }
}

export async function get(query = {}, profileId, suppliedGeneration) {
  requireCurrentGeneration(suppliedGeneration);
  return handleProposalRankingRehearsalGet({ ...query, profileId: assertSyntheticProfile(profileId) });
}

export async function action(body = {}, profileId, suppliedGeneration) {
  requireCurrentGeneration(suppliedGeneration);
  return handleProposalRankingRehearsalAction({ profileId: assertSyntheticProfile(profileId), action: body.action, body });
}

/** Submit both synthetic colleagues' current private lists through real actions. */
export async function simulateOtherSubmissions({ roundId, programKey = null } = {}, suppliedGeneration) {
  requireCurrentGeneration(suppliedGeneration);
  if (!roundId) throw new Error('A synthetic round ID is required.');
  if (programKey != null && !['se', 'mr'].includes(programKey)) throw new Error('Choose se or mr for the synthetic submission.');
  const profiles = getRehearsalProfiles().filter((person) => person.key !== 'facilitator');
  const submitted = [];
  for (const person of profiles) {
    const current = await handleProposalRankingGet({ profileId: person.profileId, roundId, isSuperuser: false });
    for (const key of programKey ? [programKey] : ['se', 'mr']) {
      const ownList = current.programs?.[key]?.ownList;
      if (!ownList || ownList.status !== 'draft') continue;
      const result = await handleProposalRankingAction({
        action: 'submit',
        profileId: person.profileId,
        isSuperuser: false,
        body: {
          roundId,
          programKey: key,
          order: ownList.order,
          etag: ownList.etag,
          policyRevision: current.round.policyRevision,
          operationId: randomUUID().toLowerCase(),
        },
      });
      submitted.push({ personKey: person.key, programKey: key, status: result.programs?.[key]?.ownList?.status || 'submitted' });
    }
  }
  return { submitted };
}

// The generated round ID is exposed only from the local in-memory adapter for
// harness reset/inspection; service reads remain the source for all UI state.
