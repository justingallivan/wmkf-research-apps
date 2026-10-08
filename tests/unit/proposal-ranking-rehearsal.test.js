jest.mock('../../lib/dataverse/adapters/proposal-ranking.js', () => jest.requireActual('../../scripts/rehearsal/proposal-ranking-memory.js'));
jest.mock('../../lib/dataverse/adapters/proposal-ranking-source.js', () => jest.requireActual('../../scripts/rehearsal/proposal-ranking-memory.js'));
jest.mock('../../lib/services/dataverse-identity-map.js', () => jest.requireActual('../../scripts/rehearsal/proposal-ranking-memory.js'));
jest.mock('../../lib/services/app-access-service.js', () => jest.requireActual('../../scripts/rehearsal/proposal-ranking-memory.js'));
jest.mock('../../lib/services/proposal-ranking/config.js', () => jest.requireActual('../../scripts/rehearsal/proposal-ranking-memory.js'));

import {
  getRehearsalProfiles,
  REHEARSAL_CYCLE_CODE,
  REHEARSAL_DEPENDENCY_PATHS,
} from '../../scripts/rehearsal/proposal-ranking-memory.js';
import {
  getGeneration,
  getLastCreatedRoundId,
  handleProposalRankingRehearsalAction,
  handleProposalRankingRehearsalGet,
  reset,
  resetProposalRankingServiceRehearsal,
  simulateOtherSubmissions,
} from '../../scripts/rehearsal/proposal-ranking-service-entry.js';

let operationNumber = 1;
const operationId = () => `76000000-0000-4000-8000-${String(operationNumber++).padStart(12, '0')}`;

async function openRehearsal() {
  const facilitator = getRehearsalProfiles()[0];
  const generation = getGeneration();
  const preview = await handleProposalRankingRehearsalGet({ profileId: facilitator.profileId, cycleCode: REHEARSAL_CYCLE_CODE });
  expect(preview.mode).toBe('preview');
  expect(preview.preview.canOpen).toBe(true);
  const opened = await handleProposalRankingRehearsalAction({
    profileId: facilitator.profileId,
    action: 'open',
    body: {
      cycleCode: REHEARSAL_CYCLE_CODE,
      previewFingerprint: preview.preview.previewFingerprint,
      operationId: operationId(),
    },
  });
  return { facilitator, roundId: opened.roundId, generation };
}

async function submitOwnPrograms(facilitator, roundId) {
  let current = await handleProposalRankingRehearsalGet({ profileId: facilitator.profileId, roundId });
  for (const programKey of ['se', 'mr']) {
    const ownList = current.programs[programKey].ownList;
    current = await handleProposalRankingRehearsalAction({
      profileId: facilitator.profileId,
      action: 'submit',
      body: {
        roundId,
        programKey,
        order: ownList.order,
        etag: ownList.etag,
        policyRevision: current.round.policyRevision,
        operationId: operationId(),
      },
    });
  }
}

beforeEach(() => {
  operationNumber = 1;
  resetProposalRankingServiceRehearsal();
});

test('aliases every live service dependency to the synthetic in-memory module', () => {
  expect(REHEARSAL_DEPENDENCY_PATHS).toEqual(expect.arrayContaining([
    'lib/dataverse/adapters/proposal-ranking.js',
    'lib/dataverse/adapters/proposal-ranking-source.js',
    'lib/services/dataverse-identity-map.js',
    'lib/services/app-access-service.js',
    'lib/services/proposal-ranking/config.js',
  ]));
  expect(REHEARSAL_DEPENDENCY_PATHS).toHaveLength(5);
});

test('launcher accepts only its three fixed synthetic profile choices', async () => {
  const preview = await (await import('../../scripts/rehearsal/proposal-ranking-service-entry.js')).get({ cycleCode: REHEARSAL_CYCLE_CODE }, 1, getGeneration());
  expect(preview.mode).toBe('preview');
  await expect((await import('../../scripts/rehearsal/proposal-ranking-service-entry.js')).get({ cycleCode: REHEARSAL_CYCLE_CODE, profileId: getRehearsalProfiles()[1].profileId }, 99, getGeneration()))
    .rejects.toMatchObject({ status: 403, code: 'rehearsal_identity_denied' });
});

test('real service opens, submits, generates, publishes, edits, and resets an isolated round', async () => {
  const { facilitator, roundId, generation } = await openRehearsal();
  expect(getLastCreatedRoundId()).toBe(roundId);

  await submitOwnPrograms(facilitator, roundId);
  const simulated = await simulateOtherSubmissions({ roundId }, generation);
  expect(simulated.submitted).toHaveLength(4);
  expect(simulated.submitted.every((item) => item.status === 'submitted')).toBe(true);

  let current = await handleProposalRankingRehearsalGet({ profileId: facilitator.profileId, roundId });
  const meeting = current.programs.se.meeting;
  current = await handleProposalRankingRehearsalAction({
    profileId: facilitator.profileId,
    action: 'generate',
    body: {
      roundId,
      programKey: 'se',
      etag: meeting.etag,
      policyRevision: current.round.policyRevision,
      confirmationFingerprint: current.confirmations.generate.se.fingerprint,
      operationId: operationId(),
    },
  });
  expect(current.programs.se.meetingStatus).toBe('composite-draft');
  current = await handleProposalRankingRehearsalAction({
    profileId: facilitator.profileId,
    action: 'publish',
    body: {
      roundId,
      programKey: 'se',
      etag: current.programs.se.meeting.etag,
      policyRevision: current.round.policyRevision,
      confirmationFingerprint: current.confirmations.publish.se.fingerprint,
      operationId: operationId(),
    },
  });
  expect(current.programs.se.meetingStatus).toBe('published');

  const reordered = [...current.programs.se.meeting.order].reverse();
  current = await handleProposalRankingRehearsalAction({
    profileId: facilitator.profileId,
    action: 'edit',
    body: {
      roundId,
      programKey: 'se',
      order: reordered,
      etag: current.programs.se.meeting.etag,
      policyRevision: current.round.policyRevision,
      operationId: operationId(),
    },
  });
  expect(current.programs.se.meeting.order).toEqual(reordered);

  resetProposalRankingServiceRehearsal();
  expect(getLastCreatedRoundId()).toBeNull();
  const reset = await handleProposalRankingRehearsalGet({ profileId: facilitator.profileId, cycleCode: REHEARSAL_CYCLE_CODE });
  expect(reset.mode).toBe('preview');
  expect(reset.roundId).toBeNull();
});

test('synthetic submissions run as their own actors and private rankings stay private', async () => {
  const { facilitator, roundId, generation } = await openRehearsal();
  const profiles = getRehearsalProfiles();
  const facilitatorView = await handleProposalRankingRehearsalGet({ profileId: facilitator.profileId, roundId });
  const participantView = await handleProposalRankingRehearsalGet({ profileId: profiles[1].profileId, roundId });
  expect(facilitatorView.programs.se.facilitatorLists).toHaveLength(3);
  expect(participantView.programs.se.facilitatorLists).toBeNull();
  expect(participantView.programs.se.ownList.owner.systemUserId).toBe(profiles[1].systemUserId);

  await simulateOtherSubmissions({ roundId, programKey: 'se' }, generation);
  const refreshed = await handleProposalRankingRehearsalGet({ profileId: profiles[2].profileId, roundId });
  expect(refreshed.programs.se.ownList.status).toBe('submitted');
  expect(refreshed.programs.se.facilitatorLists).toBeNull();
  expect(refreshed.programs.mr.ownList.status).toBe('draft');
});

test('reset fences delayed actions from the previous rehearsal generation', async () => {
  const rehearsalService = await import('../../scripts/rehearsal/proposal-ranking-service-entry.js');
  const facilitator = getRehearsalProfiles()[0];
  const oldGeneration = getGeneration();
  const stalePreview = await rehearsalService.get({ cycleCode: REHEARSAL_CYCLE_CODE }, 1, oldGeneration);
  expect(stalePreview.preview.canOpen).toBe(true);

  const resetResult = reset();
  expect(resetResult.generation).toBe(oldGeneration + 1);
  expect(getLastCreatedRoundId()).toBeNull();
  await expect(rehearsalService.action({
    action: 'open',
    cycleCode: REHEARSAL_CYCLE_CODE,
    previewFingerprint: stalePreview.preview.previewFingerprint,
    operationId: operationId(),
  }, 1, oldGeneration)).rejects.toMatchObject({ status: 409, code: 'stale_rehearsal' });
  expect(getLastCreatedRoundId()).toBeNull();

  const currentGeneration = getGeneration();
  const currentPreview = await rehearsalService.get({ cycleCode: REHEARSAL_CYCLE_CODE }, facilitator.profileId, currentGeneration);
  const opened = await rehearsalService.action({
    action: 'open',
    cycleCode: REHEARSAL_CYCLE_CODE,
    previewFingerprint: currentPreview.preview.previewFingerprint,
    operationId: operationId(),
  }, facilitator.profileId, currentGeneration);
  expect(opened.roundId).toBe(getLastCreatedRoundId());
});
