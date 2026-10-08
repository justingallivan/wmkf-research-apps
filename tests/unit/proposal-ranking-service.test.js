import { createHash } from 'node:crypto';
jest.mock('../../lib/dataverse/adapters/proposal-ranking.js', () => ({
  readRound: jest.fn(),
  listRoundRows: jest.fn(),
  patchRound: jest.fn(),
  patchRoundAndList: jest.fn(),
  findCycleCoordinator: jest.fn(),
  findRoundByCreationOperation: jest.fn(),
  makeOpenOperations: jest.fn(),
  createRoundAndLists: jest.fn(),
  cancelRoundChangeset: jest.fn(),
}));
jest.mock('../../lib/dataverse/adapters/proposal-ranking-source.js', () => ({
  readEnabledProposalRankingStaff: jest.fn(),
  listEnabledProposalRankingStaff: jest.fn(),
}));
jest.mock('../../lib/services/dataverse-identity-map.js', () => ({
  resolveProfileToSystemUser: jest.fn(),
  resolveSystemUserToProfile: jest.fn(),
}));
jest.mock('../../lib/services/app-access-service.js', () => ({ listAllGrantsForAdmin: jest.fn() }));
jest.mock('../../lib/services/proposal-ranking/config.js', () => ({ readDefaultFacilitator: jest.fn(), saveDefaultFacilitator: jest.fn() }));
jest.mock('../../lib/services/proposal-ranking/preview-service.js', () => ({
  buildProposalRankingPreview: jest.fn(),
  assertPreviewCanOpen: jest.fn(),
}));

import {
  readRound, listRoundRows, patchRound, patchRoundAndList, findCycleCoordinator,
  findRoundByCreationOperation, makeOpenOperations, createRoundAndLists,
  cancelRoundChangeset,
} from '../../lib/dataverse/adapters/proposal-ranking.js';
import { readEnabledProposalRankingStaff, listEnabledProposalRankingStaff } from '../../lib/dataverse/adapters/proposal-ranking-source.js';
import { buildProposalRankingPreview } from '../../lib/services/proposal-ranking/preview-service.js';
import { resolveProfileToSystemUser, resolveSystemUserToProfile } from '../../lib/services/dataverse-identity-map.js';
import { listAllGrantsForAdmin } from '../../lib/services/app-access-service.js';
import { readDefaultFacilitator, saveDefaultFacilitator } from '../../lib/services/proposal-ranking/config.js';
import { handleProposalRankingAction, handleProposalRankingGet } from '../../lib/services/proposal-ranking/service.js';
import { handleProposalRankingAdminSettings } from '../../lib/services/proposal-ranking/service.js';

const facilitatorId = '11111111-1111-4111-8111-111111111111';
const participantId = '22222222-2222-4222-8222-222222222222';
const seId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const mrId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const dynamicsStaffId = 'f1111111-1111-1111-1111-111111111111';
const dynamicsRoundId = 'ee11eeee-eeee-eeee-eeee-eeeeeeeeeeee';
let round;
let rows;

function makeList(listKey, programKey, participantSystemUserId, status, order) {
  return {
    wmkf_proposalrankinglistid: `${programKey}${participantSystemUserId ? 'p' : 'm'}`,
    wmkf_roundid: '33333333-3333-4333-8333-333333333333',
    wmkf_listkey: listKey,
    wmkf_programkey: programKey,
    wmkf_participantsystemuserid: participantSystemUserId,
    wmkf_orderjson: JSON.stringify(order),
    wmkf_status: status,
    wmkf_version: 1,
    wmkf_lastoperationid: '00000000-0000-4000-8000-000000000000',
    wmkf_updatedat: '2026-10-07T12:00:00.000Z',
    '@odata.etag': `W/"${listKey}"`,
  };
}

function setupRound() {
  process.env.PROPOSAL_RANKING_ENABLED = 'on';
  process.env.PROPOSAL_RANKING_SCHEMA_READY = 'on';
  process.env.TEST_REQUEST_ISOLATION = 'on';
  process.env.SYNTHETIC_REVIEWER_ISOLATION = 'on';
  round = {
    wmkf_proposalrankingroundid: '33333333-3333-4333-8333-333333333333',
    wmkf_cyclecode: 'J27',
    wmkf_snapshotjson: JSON.stringify({
      version: 1,
      cycleCode: 'J27',
      proposals: [
        { requestId: seId, amountMinorUnits: 12500, currency: { code: 'USD' } },
        { requestId: mrId, amountMinorUnits: 5000, currency: { code: 'USD' } },
      ],
      seedOrders: { se: [seId], mr: [mrId] },
      roster: [
        { systemUserId: facilitatorId, name: 'Facilitator', excluded: false },
        { systemUserId: participantId, name: 'Participant', excluded: false },
      ],
      excusedSystemUserIds: [],
    }),
    wmkf_facilitatorsystemuserid: facilitatorId,
    wmkf_policyrevision: 1,
    wmkf_state: 100000000,
    wmkf_administrationlogjson: '[]',
    wmkf_lastoperationid: '00000000-0000-4000-8000-000000000000',
    '@odata.etag': 'W/"round-v1"',
  };
  rows = [
    makeList(`pd:se:${facilitatorId}`, 'se', facilitatorId, 100000000, [seId]),
    makeList(`pd:se:${participantId}`, 'se', participantId, 100000000, [seId]),
    makeList('meeting:se', 'se', null, 100000002, [seId]),
    makeList(`pd:mr:${facilitatorId}`, 'mr', facilitatorId, 100000000, [mrId]),
    makeList(`pd:mr:${participantId}`, 'mr', participantId, 100000000, [mrId]),
    makeList('meeting:mr', 'mr', null, 100000002, [mrId]),
  ];
  readRound.mockImplementation(async () => ({ ...round }));
  listRoundRows.mockImplementation(async () => rows.map((row) => ({ ...row })));
  patchRoundAndList.mockImplementation(async (_round, list, roundPatch, listPatch) => {
    Object.assign(round, roundPatch, { '@odata.etag': 'W/"round-v2"' });
    const saved = rows.find((row) => row.wmkf_proposalrankinglistid === list.wmkf_proposalrankinglistid);
    Object.assign(saved, listPatch, { '@odata.etag': 'W/"list-v2"' });
  });
  patchRound.mockImplementation(async (_round, patch) => Object.assign(round, patch, { '@odata.etag': 'W/"round-v2"' }));
  readEnabledProposalRankingStaff.mockResolvedValue({ systemUserId: participantId, name: 'Participant', enabled: true });
  listEnabledProposalRankingStaff.mockResolvedValue([]);
  findRoundByCreationOperation.mockResolvedValue(null);
  findCycleCoordinator.mockResolvedValue(null);
  makeOpenOperations.mockReturnValue([]);
  createRoundAndLists.mockResolvedValue({ ok: true });
  cancelRoundChangeset.mockImplementation(async (_round, roundPatch, _coordinator, _coordinatorPatch) => Object.assign(round, roundPatch, { '@odata.etag': 'W/"round-v2"' }));
  resolveProfileToSystemUser.mockResolvedValue({ systemuserid: facilitatorId });
  resolveSystemUserToProfile.mockResolvedValue(null);
  listAllGrantsForAdmin.mockResolvedValue([]);
  readDefaultFacilitator.mockResolvedValue({ systemUserId: facilitatorId, configured: true, revision: 1 });
}

describe('Proposal Ranking service access and voting', () => {
  beforeEach(() => {
    setupRound();
    jest.clearAllMocks();
    resolveProfileToSystemUser.mockResolvedValue({ systemuserid: facilitatorId });
  });

  test('allows a facilitator who is also a captured participant to submit only their own ballot', async () => {
    const actorList = rows[0];
    const response = await handleProposalRankingAction({
      action: 'submit',
      profileId: 'profile-facilitator',
      body: {
        action: 'submit',
        roundId: round.wmkf_proposalrankingroundid,
        programKey: 'se',
        order: [seId],
        etag: actorList['@odata.etag'],
        policyRevision: 1,
        operationId: '44444444-4444-4444-8444-444444444444',
      },
    });
    expect(patchRoundAndList).toHaveBeenCalledTimes(1);
    expect(rows[0]).toMatchObject({ wmkf_status: 100000001, wmkf_submittedoperationid: '44444444-4444-4444-8444-444444444444' });
    expect(rows[1].wmkf_status).toBe(100000000);
    expect(response.viewer.isFacilitator).toBe(true);
    expect(response.programs.se.ownList.status).toBe('submitted');
  });

  test('accepts real Dataverse GUID formats throughout round reads', async () => {
    round.wmkf_proposalrankingroundid = dynamicsRoundId;
    round.wmkf_facilitatorsystemuserid = dynamicsStaffId;
    const snapshot = JSON.parse(round.wmkf_snapshotjson);
    snapshot.roster[0].systemUserId = dynamicsStaffId;
    round.wmkf_snapshotjson = JSON.stringify(snapshot);
    for (const row of rows) row.wmkf_roundid = dynamicsRoundId;
    rows[0].wmkf_participantsystemuserid = dynamicsStaffId;
    rows[0].wmkf_listkey = `pd:se:${dynamicsStaffId}`;
    resolveProfileToSystemUser.mockResolvedValue({ systemuserid: dynamicsStaffId });

    const response = await handleProposalRankingGet({ roundId: dynamicsRoundId, profileId: 'profile-facilitator' });
    expect(response.round.facilitator.systemUserId).toBe(dynamicsStaffId);
    expect(readRound).toHaveBeenCalledWith(dynamicsRoundId);
    expect(response.programs.se.ownList.owner.systemUserId).toBe(dynamicsStaffId);
  });

  test('confirmation ignores unrelated autosaves but changes when a ballot is submitted', async () => {
    const initial = await handleProposalRankingGet({ roundId: round.wmkf_proposalrankingroundid, profileId: 'profile-facilitator' });
    const originalFingerprint = initial.confirmations.cancel.fingerprint;
    rows[1].wmkf_lastoperationid = 'abababab-1111-4111-8111-abababababab';
    rows[1].wmkf_lastoperationkind = 'save';
    const afterAutosave = await handleProposalRankingGet({ roundId: round.wmkf_proposalrankingroundid, profileId: 'profile-facilitator' });
    expect(afterAutosave.confirmations.cancel.fingerprint).toBe(originalFingerprint);

    await handleProposalRankingAction({
      action: 'submit', profileId: 'profile-facilitator',
      body: {
        action: 'submit', roundId: round.wmkf_proposalrankingroundid, programKey: 'se', order: [seId],
        etag: rows[0]['@odata.etag'], policyRevision: afterAutosave.round.policyRevision,
        operationId: 'cdcdcdcd-1111-4111-8111-cdcdcdcdcdcd',
      },
    });
    const afterSubmit = await handleProposalRankingGet({ roundId: round.wmkf_proposalrankingroundid, profileId: 'profile-facilitator' });
    expect(afterSubmit.confirmations.cancel.fingerprint).not.toBe(originalFingerprint);
  });

  test('maps a Dataverse ETag failure to a safe conflict with the current private-filtered view', async () => {
    patchRoundAndList.mockRejectedValueOnce(Object.assign(new Error('Dataverse raw stack detail'), { status: 412 }));
    await expect(handleProposalRankingAction({
      action: 'save', profileId: 'profile-facilitator',
      body: {
        action: 'save', roundId: round.wmkf_proposalrankingroundid, programKey: 'se', order: [seId],
        etag: rows[0]['@odata.etag'], policyRevision: 1,
        operationId: '12121212-1212-4212-8212-121212121212',
      },
    })).rejects.toMatchObject({ status: 409, code: 'conflict', current: { viewer: { isFacilitator: true } } });
  });

  test('confirms a committed save even when a newer order wins before readback', async () => {
    const snapshot = JSON.parse(round.wmkf_snapshotjson);
    snapshot.seedOrders.se = [seId, mrId];
    round.wmkf_snapshotjson = JSON.stringify(snapshot);
    rows[0].wmkf_orderjson = JSON.stringify([seId, mrId]);
    patchRoundAndList.mockImplementationOnce(async (_round, list, roundPatch, listPatch) => {
      Object.assign(round, roundPatch, { '@odata.etag': 'W/"round-v2"' });
      const saved = rows.find((row) => row.wmkf_proposalrankinglistid === list.wmkf_proposalrankinglistid);
      Object.assign(saved, listPatch, { '@odata.etag': 'W/"list-v2"' });
      Object.assign(saved, {
        wmkf_orderjson: JSON.stringify([seId, mrId]),
        wmkf_lastoperationid: '34343434-3434-4434-8434-343434343434',
        wmkf_lastoperationkind: 'save',
        '@odata.etag': 'W/"list-v3"',
      });
    });
    const response = await handleProposalRankingAction({
      action: 'save', profileId: 'profile-facilitator',
      body: {
        action: 'save', roundId: round.wmkf_proposalrankingroundid, programKey: 'se', order: [mrId, seId],
        etag: rows[0]['@odata.etag'], policyRevision: 1,
        operationId: '56565656-5656-4565-8565-565656565656',
      },
    });
    expect(response.programs.se.ownList.order).toEqual([seId, mrId]);
    expect(response.operation).toMatchObject({ operationId: '56565656-5656-4565-8565-565656565656', status: 'confirmed' });
  });

  test('accepts Dataverse-format staff GUIDs in facilitator Admin configuration', async () => {
    readDefaultFacilitator.mockResolvedValueOnce({ systemUserId: null, configured: false, revision: 2 });
    readDefaultFacilitator.mockResolvedValue({ systemUserId: dynamicsStaffId, configured: true, revision: 3 });
    readEnabledProposalRankingStaff.mockResolvedValue({ systemUserId: dynamicsStaffId, name: 'Eligible staff' });
    listEnabledProposalRankingStaff.mockResolvedValue([{ systemUserId: dynamicsStaffId, name: 'Eligible staff' }]);
    resolveSystemUserToProfile.mockResolvedValue('eligible-profile');
    listAllGrantsForAdmin.mockResolvedValue([{ user_profile_id: 'eligible-profile', apps: ['proposal-ranking'] }]);

    const response = await handleProposalRankingAdminSettings({
      method: 'PUT', profileId: 'admin-profile',
      body: { systemUserId: dynamicsStaffId.toUpperCase(), revision: 2 },
    });

    expect(saveDefaultFacilitator).toHaveBeenCalledWith(dynamicsStaffId, 2, 'admin-profile');
    expect(response).toMatchObject({ systemUserId: dynamicsStaffId, name: 'Eligible staff', revision: 3 });
  });

  test('generated composite uses the API/UI ranks array wire shape', async () => {
    rows[0].wmkf_status = 100000001;
    rows[1].wmkf_status = 100000001;
    rows[0].wmkf_submittedoperationid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    rows[1].wmkf_submittedoperationid = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const before = await handleProposalRankingGet({ roundId: round.wmkf_proposalrankingroundid, profileId: 'profile-facilitator' });
    const meeting = rows[2];
    const response = await handleProposalRankingAction({
      action: 'generate',
      profileId: 'profile-facilitator',
      body: {
        action: 'generate', roundId: round.wmkf_proposalrankingroundid, programKey: 'se',
        etag: meeting['@odata.etag'], policyRevision: before.round.policyRevision,
        confirmationFingerprint: before.confirmations.generate.se.fingerprint,
        operationId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      },
    });
    expect(response.programs.se.meeting.composite.ranks).toEqual([{
      requestId: seId,
      participants: [
        { systemUserId: facilitatorId, name: 'Facilitator', rank: 1 },
        { systemUserId: participantId, name: 'Participant', rank: 1 },
      ],
      minRank: 1,
      maxRank: 1,
      disagreement: false,
    }]);

    const generatedMeeting = response.programs.se.meeting;
    resolveProfileToSystemUser.mockResolvedValue({ systemuserid: participantId });
    await expect(handleProposalRankingAction({
      action: 'edit', profileId: 'profile-participant',
      body: {
        action: 'edit', roundId: round.wmkf_proposalrankingroundid, programKey: 'se', order: [seId],
        etag: generatedMeeting.etag, policyRevision: response.round.policyRevision,
        operationId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      },
    })).rejects.toMatchObject({ status: 403, code: 'access_denied' });

    resolveProfileToSystemUser.mockResolvedValue({ systemuserid: facilitatorId });
    const edited = await handleProposalRankingAction({
      action: 'edit', profileId: 'profile-facilitator',
      body: {
        action: 'edit', roundId: round.wmkf_proposalrankingroundid, programKey: 'se', order: [seId],
        etag: generatedMeeting.etag, policyRevision: response.round.policyRevision,
        operationId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      },
    });
    const published = await handleProposalRankingAction({
      action: 'publish', profileId: 'profile-facilitator',
      body: {
        action: 'publish', roundId: round.wmkf_proposalrankingroundid, programKey: 'se',
        etag: edited.programs.se.meeting.etag, policyRevision: edited.round.policyRevision,
        confirmationFingerprint: edited.confirmations.publish.se.fingerprint,
        operationId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      },
    });
    expect(published.programs.se.meeting.status).toBe('published');

    resolveProfileToSystemUser.mockResolvedValue({ systemuserid: participantId });
    const participantEdit = await handleProposalRankingAction({
      action: 'edit', profileId: 'profile-participant',
      body: {
        action: 'edit', roundId: round.wmkf_proposalrankingroundid, programKey: 'se', order: [seId],
        etag: published.programs.se.meeting.etag, policyRevision: published.round.policyRevision,
        operationId: '99999999-9999-4999-8999-999999999999',
      },
    });
    expect(participantEdit.programs.se.meeting.status).toBe('published');
  });

  test('rejects excusal even for the facilitator without changing any stored state', async () => {
    const before = await handleProposalRankingGet({ roundId: round.wmkf_proposalrankingroundid, profileId: 'profile-facilitator' });
    expect(before.viewer.capabilities.excuseParticipant).toBe(false);
    expect(before.confirmations.excuse).toBeNull();
    await expect(handleProposalRankingAction({
      action: 'excuse', profileId: 'profile-facilitator',
      body: {
        action: 'excuse', roundId: round.wmkf_proposalrankingroundid, participantSystemUserId: participantId,
        reason: 'Unable to participate', policyRevision: before.round.policyRevision,
        confirmationFingerprint: 'old-client-token', operationId: 'abababab-abab-4bab-8bab-abababababab',
      },
    })).rejects.toMatchObject({ status: 400, code: 'invalid_request' });
    expect(patchRound).not.toHaveBeenCalled();
    expect(patchRoundAndList).not.toHaveBeenCalled();
    expect(before.programs.se.progress.required).toBe(2);
  });

  test('withholds generation until every roster member submits, independently per program', async () => {
    rows[0].wmkf_status = 100000001;
    const before = await handleProposalRankingGet({ roundId: round.wmkf_proposalrankingroundid, profileId: 'profile-facilitator' });
    expect(before.programs.se.progress).toEqual({ required: 2, submitted: 1, outstandingNames: ['Participant'] });
    expect(before.confirmations.generate.se).toBeNull();
    expect(before.viewer.capabilities.generate).toBe(false);
    // Even a correctly constructed confirmation cannot waive a missing ballot.
    const fingerprint = createHash('sha256').update(JSON.stringify({
      roundId: round.wmkf_proposalrankingroundid, policyRevision: 1, action: 'generate', programKey: 'se',
      lists: rows.map((row) => [row.wmkf_listkey, row.wmkf_status, row.wmkf_submittedoperationid || null])
        .sort((a, b) => a[0].localeCompare(b[0])),
      facilitator: facilitatorId, state: round.wmkf_state,
    })).digest('hex');
    await expect(handleProposalRankingAction({
      action: 'generate', profileId: 'profile-facilitator',
      body: {
        action: 'generate', roundId: round.wmkf_proposalrankingroundid, programKey: 'se',
        etag: rows[2]['@odata.etag'], policyRevision: 1, confirmationFingerprint: fingerprint,
        operationId: 'bcbcbcbc-bcbc-4bcb-8bcb-bcbcbcbcbcbc',
      },
    })).rejects.toMatchObject({ status: 409, code: 'incomplete_submissions' });
    expect(patchRoundAndList).not.toHaveBeenCalled();
    rows[1].wmkf_status = 100000001;
    const after = await handleProposalRankingGet({ roundId: round.wmkf_proposalrankingroundid, profileId: 'profile-facilitator' });
    expect(after.confirmations.generate.se).not.toBeNull();
    expect(after.confirmations.generate.mr).toBeNull();
    expect(after.programs.se.progress).toMatchObject({ required: 2, submitted: 2 });
  });

  test.each(['generate', 'publish'])('legacy excusal cannot bypass full participation through %s', async (action) => {
    const snapshot = JSON.parse(round.wmkf_snapshotjson);
    snapshot.excusedSystemUserIds = [participantId];
    round.wmkf_snapshotjson = JSON.stringify(snapshot);
    rows[0].wmkf_status = 100000001;
    if (action === 'publish') {
      rows[2].wmkf_status = 100000003;
      rows[2].wmkf_compositejson = JSON.stringify({ sourceSubmissionIds: [rows[0].wmkf_proposalrankinglistid] });
    }
    const before = await handleProposalRankingGet({ roundId: round.wmkf_proposalrankingroundid, profileId: 'profile-facilitator' });
    expect(before.confirmations[action].se).toBeNull();
    await expect(handleProposalRankingAction({
      action, profileId: 'profile-facilitator',
      body: { action, roundId: round.wmkf_proposalrankingroundid, programKey: 'se',
        etag: rows[2]['@odata.etag'], policyRevision: 1, confirmationFingerprint: 'old-token',
        operationId: 'bcbcbcbc-bcbc-4bcb-8bcb-bcbcbcbcbcbc' },
    })).rejects.toMatchObject({ status: 409, code: 'legacy_excusal' });
    expect(patchRoundAndList).not.toHaveBeenCalled();
  });

  test('cancel commits a durable terminal state and an exact retry reads it back', async () => {
    findCycleCoordinator.mockResolvedValue({
      wmkf_proposalrankingcycleid: 'abababab-abab-4bab-8bab-abababababab',
      wmkf_activeroundid: round.wmkf_proposalrankingroundid,
      wmkf_version: 1,
      '@odata.etag': 'W/"cycle-v1"',
    });
    const before = await handleProposalRankingGet({ roundId: round.wmkf_proposalrankingroundid, profileId: 'profile-facilitator' });
    const operationId = 'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd';
    const body = {
      action: 'cancel', roundId: round.wmkf_proposalrankingroundid,
      policyRevision: before.round.policyRevision, confirmationFingerprint: before.confirmations.cancel.fingerprint, operationId,
    };
    const first = await handleProposalRankingAction({ action: 'cancel', profileId: 'profile-facilitator', body });
    const retry = await handleProposalRankingAction({ action: 'cancel', profileId: 'profile-facilitator', body });
    expect(cancelRoundChangeset).toHaveBeenCalledTimes(1);
    expect(first.round.state).toBe('canceled');
    expect(retry.operation).toMatchObject({ operationId, status: 'confirmed', result: 'round-canceled' });
  });

  test('superuser outside the roster receives lifecycle metadata without proposal or private-list contents', async () => {
    resolveProfileToSystemUser.mockResolvedValue({ systemuserid: '99999999-9999-4999-8999-999999999999' });
    const response = await handleProposalRankingGet({
      roundId: round.wmkf_proposalrankingroundid,
      profileId: 'profile-superuser',
      isSuperuser: true,
    });
    expect(response.round.snapshot.proposals).toEqual([]);
    expect(response.round.snapshot.seedOrders).toEqual({ se: [], mr: [] });
    expect(response.programs.se.proposalIds).toEqual([]);
    expect(response.programs.mr.proposalIds).toEqual([]);
    expect(response.programs.se.ownList).toBeNull();
    expect(response.programs.se.facilitatorLists).toBeNull();
    expect(response.programs.se.meeting).toBeNull();
  });

  test('non-facilitator open with stale confirmation cannot receive the preview in conflict.current', async () => {
    resolveProfileToSystemUser.mockResolvedValue({ systemuserid: participantId });
    buildProposalRankingPreview.mockResolvedValue({
      facilitatorSystemUserId: facilitatorId,
      previewFingerprint: 'current-fingerprint',
      snapshot: JSON.parse(round.wmkf_snapshotjson),
      proposals: [{ requestId: seId, title: 'Private proposal title' }],
      seedOrders: { se: [seId], mr: [mrId] },
      canOpen: true,
      warnings: [],
      roster: [],
    });
    await expect(handleProposalRankingAction({
      action: 'open',
      profileId: 'profile-outside',
      body: {
        action: 'open', cycleCode: 'J27', previewFingerprint: 'stale-fingerprint',
        operationId: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',
      },
    })).rejects.toMatchObject({ status: 403, code: 'access_denied', current: null });
  });

  test('losing concurrent first-open reloads the winner instead of reading a nonexistent local round ID', async () => {
    buildProposalRankingPreview.mockResolvedValue({
      facilitatorSystemUserId: facilitatorId,
      previewFingerprint: 'current-fingerprint',
      snapshot: JSON.parse(round.wmkf_snapshotjson),
      proposals: JSON.parse(round.wmkf_snapshotjson).proposals,
      seedOrders: { se: [seId], mr: [mrId] },
      roster: [{ systemUserId: facilitatorId, name: 'Facilitator', hasAppAccess: true }],
      canOpen: true,
      warnings: [],
      outstandingReviewCount: 0,
      unexpectedStatuses: [],
    });
    findCycleCoordinator.mockResolvedValueOnce(null).mockResolvedValueOnce({ wmkf_activeroundid: round.wmkf_proposalrankingroundid });
    createRoundAndLists.mockRejectedValueOnce(Object.assign(new Error('Dataverse duplicate key'), { status: 409 }));
    await expect(handleProposalRankingAction({
      action: 'open',
      profileId: 'profile-facilitator',
      body: {
        action: 'open', cycleCode: 'J27', previewFingerprint: 'current-fingerprint',
        operationId: 'bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb',
      },
    })).rejects.toMatchObject({ status: 409, code: 'active_round_exists', current: { mode: 'round' } });
    expect(readRound).toHaveBeenCalledWith(round.wmkf_proposalrankingroundid);
  });

  test.each([400, 403])('preserves unrelated confirmed Dataverse %s errors while opening', async (status) => {
    const snapshot = JSON.parse(round.wmkf_snapshotjson);
    buildProposalRankingPreview.mockResolvedValue({
      facilitatorSystemUserId: facilitatorId,
      previewFingerprint: 'current-fingerprint',
      snapshot,
      proposals: snapshot.proposals,
      seedOrders: { se: [seId], mr: [mrId] },
      roster: snapshot.roster,
      canOpen: true,
      warnings: [],
      outstandingReviewCount: 0,
      unexpectedStatuses: [],
    });
    const writeError = Object.assign(new Error('Dataverse write denied'), { status });
    createRoundAndLists.mockRejectedValueOnce(writeError);
    await expect(handleProposalRankingAction({
      action: 'open', profileId: 'profile-facilitator',
      body: { action: 'open', cycleCode: 'J27', previewFingerprint: 'current-fingerprint', operationId: 'eeeeeeee-1111-4111-8111-eeeeeeeeeeee' },
    })).rejects.toBe(writeError);
    expect(findCycleCoordinator).toHaveBeenCalledTimes(1);
  });

  test('does not treat the original open operation as a cancellation retry', async () => {
    const creationOperationId = 'cccccccc-1111-4111-8111-cccccccccccc';
    round.wmkf_creationoperationid = creationOperationId;
    round.wmkf_state = 100000001;
    round.wmkf_administrationlogjson = JSON.stringify([{
      type: 'round-canceled',
      operationId: 'dddddddd-1111-4111-8111-dddddddddddd',
      actorSystemUserId: facilitatorId,
    }]);
    await expect(handleProposalRankingAction({
      action: 'cancel',
      profileId: 'profile-facilitator',
      body: {
        action: 'cancel', roundId: round.wmkf_proposalrankingroundid, policyRevision: 1,
        confirmationFingerprint: 'irrelevant', operationId: creationOperationId,
      },
    })).rejects.toMatchObject({ status: 409, code: 'round_closed' });
  });

  test('non-roster, non-facilitator cannot read the round even when authenticated', async () => {
    resolveProfileToSystemUser.mockResolvedValue({ systemuserid: '99999999-9999-4999-8999-999999999999' });
    await expect(handleProposalRankingGet({
      roundId: round.wmkf_proposalrankingroundid,
      profileId: 'profile-outsider',
    })).rejects.toMatchObject({ status: 403, code: 'access_denied' });
  });

  test('rejects reuse of a save operation ID for submit', async () => {
    const operationId = '55555555-5555-4555-8555-555555555555';
    rows[0].wmkf_lastoperationid = operationId;
    rows[0].wmkf_lastoperationkind = 'save';
    round.wmkf_lastoperationid = operationId;
    round.wmkf_lastoperationkind = 'save';
    await expect(handleProposalRankingAction({
      action: 'submit',
      profileId: 'profile-facilitator',
      body: {
        action: 'submit', roundId: round.wmkf_proposalrankingroundid, programKey: 'se',
        order: [seId], etag: rows[0]['@odata.etag'], policyRevision: 1, operationId,
      },
    })).rejects.toMatchObject({ status: 409, code: 'operation_id_reused' });
    expect(patchRoundAndList).not.toHaveBeenCalled();
  });

  test('rejects reuse of an edit operation ID for publish', async () => {
    const meeting = rows[2];
    const operationId = '66666666-6666-4666-8666-666666666666';
    meeting.wmkf_status = 100000003;
    meeting.wmkf_lastoperationid = operationId;
    meeting.wmkf_lastoperationkind = 'edit';
    meeting.wmkf_compositejson = JSON.stringify({ generationOperationId: '77777777-7777-4777-8777-777777777777' });
    round.wmkf_lastoperationid = operationId;
    round.wmkf_lastoperationkind = 'edit';
    await expect(handleProposalRankingAction({
      action: 'publish',
      profileId: 'profile-facilitator',
      body: {
        action: 'publish', roundId: round.wmkf_proposalrankingroundid, programKey: 'se',
        etag: meeting['@odata.etag'], policyRevision: 1, confirmationFingerprint: 'unused', operationId,
      },
    })).rejects.toMatchObject({ status: 409, code: 'operation_id_reused' });
    expect(patchRoundAndList).not.toHaveBeenCalled();
  });

  test('returns a private acknowledgement for a non-roster facilitator transfer, then denies later reads', async () => {
    const snapshot = JSON.parse(round.wmkf_snapshotjson);
    snapshot.roster = [{ systemUserId: participantId, name: 'Participant', excluded: false }];
    round.wmkf_snapshotjson = JSON.stringify(snapshot);
    const operationId = '88888888-8888-4888-8888-888888888888';
    patchRound.mockImplementationOnce(async (_row, patch) => Object.assign(round, patch, { '@odata.etag': 'W/"round-v2"' }));
    const response = await handleProposalRankingAction({
      action: 'transfer',
      profileId: 'profile-former-facilitator',
      body: { action: 'transfer', roundId: round.wmkf_proposalrankingroundid, successorSystemUserId: participantId, policyRevision: 1, operationId },
    });
    expect(response.mode).toBe('waiting');
    expect(response.operation).toEqual({ operationId, status: 'confirmed', result: 'facilitator-transferred' });
    expect(response.round).toBeNull();
    expect(patchRound).toHaveBeenCalledTimes(1);
    await expect(handleProposalRankingGet({ roundId: round.wmkf_proposalrankingroundid, profileId: 'profile-former-facilitator' }))
      .rejects.toMatchObject({ status: 403, code: 'access_denied' });
  });

  test('maps facilitator transfer ETag loss to a safe current conflict', async () => {
    patchRound.mockRejectedValueOnce(Object.assign(new Error('Dataverse raw transfer detail'), { status: 412 }));
    await expect(handleProposalRankingAction({
      action: 'transfer', profileId: 'profile-facilitator',
      body: {
        action: 'transfer', roundId: round.wmkf_proposalrankingroundid, successorSystemUserId: participantId,
        policyRevision: 1, operationId: '78787878-7878-4787-8787-787878787878',
      },
    })).rejects.toMatchObject({ status: 409, code: 'conflict', current: { viewer: { isFacilitator: true } } });
  });
});
