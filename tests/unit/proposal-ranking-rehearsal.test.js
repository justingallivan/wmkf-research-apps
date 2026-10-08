jest.mock('../../lib/dataverse/adapters/proposal-ranking.js', () => ({ ...jest.requireActual('../../scripts/rehearsal/proposal-ranking-memory.js') }));
jest.mock('../../lib/dataverse/adapters/proposal-ranking-source.js', () => jest.requireActual('../../scripts/rehearsal/proposal-ranking-memory.js'));
jest.mock('../../lib/services/dataverse-identity-map.js', () => jest.requireActual('../../scripts/rehearsal/proposal-ranking-memory.js'));
jest.mock('../../lib/services/app-access-service.js', () => jest.requireActual('../../scripts/rehearsal/proposal-ranking-memory.js'));
jest.mock('../../lib/services/proposal-ranking/config.js', () => jest.requireActual('../../scripts/rehearsal/proposal-ranking-memory.js'));

import {
  getRehearsalProfiles,
  listRoundRows,
  readRound,
  readProposalRankingSource,
  findCycleCoordinator,
  patchRound,
  eraseDryRunChangeset,
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

async function openRehearsal(dryRun = false) {
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
      dryRun,
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

test('erases a published dry run, fences old requests, and opens a clean round without changing sources', async () => {
  const source = await readProposalRankingSource(REHEARSAL_CYCLE_CODE);
  const { facilitator, roundId, generation } = await openRehearsal(true);
  const opening = await readRound(roundId);
  await submitOwnPrograms(facilitator, roundId);
  await simulateOtherSubmissions({ roundId }, generation);
  let current = await handleProposalRankingRehearsalGet({ profileId: facilitator.profileId, roundId });
  const action = async (name, extra = {}) => handleProposalRankingRehearsalAction({ profileId: facilitator.profileId, action: name, body: { roundId, policyRevision: current.round.policyRevision, operationId: operationId(), ...extra } });
  for (const programKey of ['se', 'mr']) {
    current = await action('generate', { programKey, etag: current.programs[programKey].meeting.etag, confirmationFingerprint: current.confirmations.generate[programKey].fingerprint });
    current = await action('publish', { programKey, etag: current.programs[programKey].meeting.etag, confirmationFingerprint: current.confirmations.publish[programKey].fingerprint });
  }
  current = await action('edit', { programKey: 'se', order: [...current.programs.se.meeting.order].reverse(), etag: current.programs.se.meeting.etag });
  expect((await listRoundRows(roundId)).some((row) => row.wmkf_compositejson)).toBe(true);
  const body = { roundId, policyRevision: current.round.policyRevision, operationId: operationId(), confirmationFingerprint: current.confirmations.resetDryRun.fingerprint };
  await expect(handleProposalRankingRehearsalAction({ profileId: getRehearsalProfiles()[1].profileId, action: 'resetDryRun', body })).rejects.toMatchObject({ status: 403 });
  await expect(handleProposalRankingRehearsalAction({ profileId: facilitator.profileId, action: 'resetDryRun', body: { ...body, confirmationFingerprint: 'stale' } })).rejects.toMatchObject({ code: 'confirmation_stale' });
  const erased = await handleProposalRankingRehearsalAction({ profileId: facilitator.profileId, action: 'resetDryRun', body });
  expect(erased.round).toMatchObject({ erased: true, dryRun: true, state: 'canceled' });
  expect(await listRoundRows(roundId)).toEqual([]);
  expect(JSON.parse((await readRound(roundId)).wmkf_snapshotjson)).toMatchObject({ proposals: [], roster: [], seedOrders: { se: [], mr: [] } });
  expect((await findCycleCoordinator(REHEARSAL_CYCLE_CODE)).wmkf_activeroundid).toBeNull();
  expect(await readProposalRankingSource(REHEARSAL_CYCLE_CODE)).toEqual(source);
  const retry = await handleProposalRankingRehearsalAction({ profileId: facilitator.profileId, action: 'resetDryRun', body });
  expect(retry.operation).toMatchObject({ status: 'confirmed', result: 'dry-run-erased' });
  await expect(action('edit', { programKey: 'se', order: current.programs.se.meeting.order, etag: current.programs.se.meeting.etag })).rejects.toMatchObject({ code: 'program_empty' });
  const delayedOpen = await handleProposalRankingRehearsalAction({ profileId: facilitator.profileId, action: 'open', body: { cycleCode: REHEARSAL_CYCLE_CODE, dryRun: true, operationId: opening.wmkf_creationoperationid, previewFingerprint: 'old' } });
  expect(delayedOpen.round.erased).toBe(true);
  const fresh = await openRehearsal();
  expect(fresh.roundId).not.toBe(roundId);
  const freshView = await handleProposalRankingRehearsalGet({ profileId: facilitator.profileId, roundId: fresh.roundId });
  expect(freshView.round.dryRun).toBe(false);
  for (const key of ['se', 'mr']) {
    expect(freshView.programs[key].ownList.status).toBe('draft');
    expect(freshView.programs[key].ownList.order).toEqual(freshView.round.snapshot.seedOrders[key]);
    expect(freshView.programs[key].meetingStatus).toBe('collecting');
    expect(freshView.programs[key].meeting.composite).toBeUndefined();
    expect(freshView.programs[key].progress.submitted).toBe(0);
  }
  await handleProposalRankingRehearsalAction({ profileId: facilitator.profileId, action: 'resetDryRun', body });
  expect((await findCycleCoordinator(REHEARSAL_CYCLE_CODE)).wmkf_activeroundid).toBe(fresh.roundId);
  expect(await listRoundRows(fresh.roundId)).toHaveLength(8);
});

test('ordinary rounds cannot be erased or relabeled, and concurrent writes leave dry-run data intact', async () => {
  const { facilitator, roundId } = await openRehearsal();
  const normal = await handleProposalRankingRehearsalGet({ profileId: facilitator.profileId, roundId });
  expect(normal.confirmations.resetDryRun).toBeNull();
  await expect(handleProposalRankingRehearsalAction({ profileId: facilitator.profileId, action: 'resetDryRun', body: { roundId, policyRevision: 1, operationId: operationId(), confirmationFingerprint: 'x' } })).rejects.toMatchObject({ code: 'not_dry_run' });
  await expect(handleProposalRankingRehearsalAction({ profileId: facilitator.profileId, action: 'resetDryRun', body: { roundId, dryRun: true } })).rejects.toMatchObject({ code: 'invalid_request' });
  expect(await listRoundRows(roundId)).toHaveLength(8);
  resetProposalRankingServiceRehearsal();
  const trial = await openRehearsal(true);
  const round = await readRound(trial.roundId);
  const lists = await listRoundRows(trial.roundId);
  const coordinator = await findCycleCoordinator(REHEARSAL_CYCLE_CODE);
  await patchRound(round, { wmkf_policyrevision: 2 });
  await expect(eraseDryRunChangeset(round, lists, {}, coordinator, { wmkf_activeroundid: null })).rejects.toMatchObject({ status: 412 });
  expect(await listRoundRows(trial.roundId)).toEqual(lists);
  expect((await findCycleCoordinator(REHEARSAL_CYCLE_CODE)).wmkf_activeroundid).toBe(trial.roundId);
});

test('a save after reset confirmation requires fresh confirmation, and loss of the commit response is retry-safe', async () => {
  const { facilitator, roundId } = await openRehearsal(true);
  const before = await handleProposalRankingRehearsalGet({ profileId: facilitator.profileId, roundId });
  const body = { roundId, policyRevision: before.round.policyRevision, operationId: operationId(), confirmationFingerprint: before.confirmations.resetDryRun.fingerprint };
  const own = before.programs.se.ownList;
  const saved = await handleProposalRankingRehearsalAction({ profileId: facilitator.profileId, action: 'save', body: { roundId, programKey: 'se', order: [...own.order].reverse(), etag: own.etag, policyRevision: before.round.policyRevision, operationId: operationId() } });
  await expect(handleProposalRankingRehearsalAction({ profileId: facilitator.profileId, action: 'resetDryRun', body })).rejects.toMatchObject({ code: 'confirmation_stale' });
  expect(await listRoundRows(roundId)).toHaveLength(8);
  const adapter = require('../../lib/dataverse/adapters/proposal-ranking.js');
  const realErase = adapter.eraseDryRunChangeset;
  const spy = jest.spyOn(adapter, 'eraseDryRunChangeset').mockImplementationOnce(async (...args) => { await realErase(...args); throw new Error('Lost response'); });
  try {
    const result = await handleProposalRankingRehearsalAction({ profileId: facilitator.profileId, action: 'resetDryRun', body: { ...body, confirmationFingerprint: saved.confirmations.resetDryRun.fingerprint } });
    expect(result.operation).toMatchObject({ status: 'confirmed', result: 'dry-run-erased' });
    expect(await listRoundRows(roundId)).toEqual([]);
  } finally { spy.mockRestore(); }
});

test('combined list requires publication, preserves program order, retries safely, and permits independent shared edits', async () => {
  const { facilitator, roundId, generation } = await openRehearsal(true);
  const participant = getRehearsalProfiles()[1];
  let current = await handleProposalRankingRehearsalGet({ profileId: facilitator.profileId, roundId });
  const act = (action, extra = {}, profileId = facilitator.profileId) => handleProposalRankingRehearsalAction({ profileId, action, body: { roundId, policyRevision: current.round.policyRevision, operationId: operationId(), ...extra } });
  expect(current.programs.co.available).toBe(false);
  await expect(act('combine', { confirmationFingerprint: 'x' })).rejects.toMatchObject({ code: 'invalid_transition' });
  await submitOwnPrograms(facilitator, roundId);
  await simulateOtherSubmissions({ roundId }, generation);
  current = await handleProposalRankingRehearsalGet({ profileId: facilitator.profileId, roundId });
  for (const programKey of ['se', 'mr']) {
    current = await act('generate', { programKey, etag: current.programs[programKey].meeting.etag, confirmationFingerprint: current.confirmations.generate[programKey].fingerprint });
    current = await act('publish', { programKey, etag: current.programs[programKey].meeting.etag, confirmationFingerprint: current.confirmations.publish[programKey].fingerprint });
    if (programKey === 'se') expect(current.programs.co.available).toBe(false);
  }
  const stale = current.confirmations.generate.co.fingerprint;
  const seOrder = [...current.programs.se.meeting.order].reverse();
  current = await act('edit', { programKey: 'se', order: seOrder, etag: current.programs.se.meeting.etag });
  await expect(act('combine', { confirmationFingerprint: stale })).rejects.toMatchObject({ code: 'confirmation_stale' });
  const combineBody = { confirmationFingerprint: current.confirmations.generate.co.fingerprint, operationId: operationId() };
  await expect(act('combine', combineBody, participant.profileId)).rejects.toMatchObject({ status: 403 });
  const original = current;
  const adapter = require('../../lib/dataverse/adapters/proposal-ranking.js');
  const realCreate = adapter.createCombinedMeeting;
  const spy = jest.spyOn(adapter, 'createCombinedMeeting').mockImplementationOnce(async (...args) => {
    await realCreate(...args);
    throw new Error('Lost creation response');
  });
  try { current = await act('combine', combineBody); } finally { spy.mockRestore(); }
  expect(current.operation.status).toBe('confirmed');
  expect(current.programs.co.meeting.status).toBe('published');
  const order = current.programs.co.meeting.order;
  expect(order).toHaveLength(6);
  expect(order.filter((id) => seOrder.includes(id))).toEqual(seOrder);
  expect(order.filter((id) => original.programs.mr.proposalIds.includes(id))).toEqual(original.programs.mr.meeting.order);
  expect(current.programs.co.meeting.composite.ranks).toHaveLength(6);
  expect(current.programs.co.meeting.totals.at(-1).complete).toBe(true);
  expect(current.programs.se.meeting).toEqual(original.programs.se.meeting);
  const participantView = await handleProposalRankingRehearsalGet({ profileId: participant.profileId, roundId });
  expect(participantView.programs.co.meeting.order).toEqual(order);
  expect(participantView.programs.co.ownList).toBeNull();
  expect(participantView.programs.co.facilitatorLists).toBeNull();
  await expect(act('edit', { programKey: 'co', order: order.slice(1), etag: current.programs.co.meeting.etag })).rejects.toMatchObject({ code: 'invalid_order' });
  current = await act('edit', { programKey: 'co', order: [...order].reverse(), etag: current.programs.co.meeting.etag }, participant.profileId);
  const combinedEtag = current.programs.co.meeting.etag;
  current = await act('combine', combineBody);
  expect(current.operation.status).toBe('confirmed');
  expect(current.programs.co.meeting.etag).toBe(combinedEtag);
  expect(current.programs.co.meeting.order).toEqual([...order].reverse());
  await expect(act('combine', { confirmationFingerprint: stale })).rejects.toMatchObject({ code: 'already_completed' });
  await expect(act('generate', { programKey: 'co' })).rejects.toMatchObject({ code: 'invalid_request' });
  await expect(act('submit', { programKey: 'co', order })).rejects.toMatchObject({ code: 'invalid_request' });
  current = await act('edit', { programKey: 'se', order: [...seOrder].reverse(), etag: current.programs.se.meeting.etag });
  expect(current.programs.co.meeting.etag).toBe(combinedEtag);
  expect(await listRoundRows(roundId)).toHaveLength(9);
  await act('resetDryRun', { confirmationFingerprint: current.confirmations.resetDryRun.fingerprint });
  expect(await listRoundRows(roundId)).toEqual([]);
});
