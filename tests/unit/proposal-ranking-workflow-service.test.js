jest.mock('../../lib/dataverse/adapters/proposal-ranking.js', () => ({
  readAssessmentRound: jest.fn(),
  readAssessmentRows: jest.fn(),
  commitAssessmentChanges: jest.fn(),
  findCycleCoordinator: jest.fn(),
}));
import {
  readAssessmentRound,
  readAssessmentRows,
  commitAssessmentChanges,
  findCycleCoordinator,
} from '../../lib/dataverse/adapters/proposal-ranking';
import {
  makeInitialWorkflowRecords,
  readWorkflowRound,
  mutateWorkflow,
  readWorkflowHistory,
} from '../../lib/services/proposal-ranking/workflow-service';

const alice = '11111111-1111-4111-8111-111111111111';
const bob = '22222222-2222-4222-8222-222222222222';
const charlie = '44444444-4444-4444-8444-444444444444';
const roundId = '33333333-3333-4333-8333-333333333333';
const snapshot = {
  version: 2,
  cycleCode: 'J27',
  roster: [
    { systemUserId: alice, name: 'Alice' },
    { systemUserId: bob, name: 'Bob' },
  ],
  seedOrders: { mr: ['m'], se: ['s'] },
  proposals: [
    { requestId: 'm', programKey: 'mr', score: { mean: 4 } },
    { requestId: 's', programKey: 'se', score: { mean: 3 } },
  ],
};
let rounds, rows, serial;
const etag = () => `W/"${++serial}"`;
const copy = (v) => JSON.parse(JSON.stringify(v));
async function send(action, actor = alice, extra = {}, override = {}) {
  const view = await readWorkflowRound({ roundId, actor });
  const key =
    action === 'resetProgram' ? `resetProgram:${extra.programKey}` : action;
  const body = {
    action,
    roundId,
    operationId: `operation-${++serial}`,
    roundEtag: view.round.etag,
    policyRevision: view.round.policyRevision,
    preparationVersion: view.workflow.preparationVersion,
    revealId: view.workflow.revealId,
    ...(view.confirmations[key]
      ? { confirmationFingerprint: view.confirmations[key].fingerprint }
      : {}),
    ...extra,
    ...override,
  };
  return { body, result: await mutateWorkflow({ body, actor }) };
}
async function prepare(actor) {
  for (const programKey of ['mr', 'se']) {
    const view = await readWorkflowRound({ roundId, actor });
    const list = view.own[programKey];
    await send('saveAssessment', actor, {
      programKey,
      listVersion: list.version,
      assessment: { ...list, confidence: { [list.order[0]]: 'confident' } },
    });
  }
  await send('buildCombined', actor);
  await send('ready', actor);
}
beforeEach(() => {
  jest.clearAllMocks();
  serial = 0;
  const initial = makeInitialWorkflowRecords(
    snapshot,
    roundId,
    alice,
    'open',
    '2026-10-13',
  );
  rounds = {
    [roundId]: {
      wmkf_proposalrankingroundid: roundId,
      wmkf_snapshotjson: JSON.stringify(snapshot),
      wmkf_workflowjson: JSON.stringify(initial.workflow),
      wmkf_facilitatorsystemuserid: alice,
      wmkf_state: 100000000,
      wmkf_policyrevision: 1,
      '@odata.etag': etag(),
    },
  };
  rows = initial.lists.map((row) => ({ ...row, '@odata.etag': etag() }));
  readAssessmentRound.mockImplementation(async (id) => copy(rounds[id]));
  readAssessmentRows.mockImplementation(async (id, keys) =>
    copy(
      rows.filter(
        (row) => row.wmkf_roundid === id && keys.includes(row.wmkf_listkey),
      ),
    ),
  );
  findCycleCoordinator.mockResolvedValue({
    wmkf_proposalrankingcycleid: 'cycle',
    wmkf_activeroundid: roundId,
    wmkf_version: 1,
    '@odata.etag': 'cycle-1',
  });
  commitAssessmentChanges.mockImplementation(
    async ({ round, roundPatch, creates, updates, newRound }) => {
      if (rounds[roundId]['@odata.etag'] !== round['@odata.etag'])
        throw Object.assign(new Error('Conflict'), { status: 412 });
      if (
        creates.some((candidate) =>
          rows.some(
            (row) =>
              row.wmkf_roundid === candidate.wmkf_roundid &&
              row.wmkf_listkey === candidate.wmkf_listkey,
          ),
        )
      )
        throw Object.assign(new Error('Duplicate'), { status: 409 });
      if (
        updates.some(
          ({ row }) =>
            rows.find(
              (stored) =>
                stored.wmkf_proposalrankinglistid ===
                row.wmkf_proposalrankinglistid,
            )['@odata.etag'] !== row['@odata.etag'],
        )
      )
        throw Object.assign(new Error('Conflict'), { status: 412 });
      Object.assign(rounds[roundId], roundPatch, { '@odata.etag': etag() });
      rows.push(...creates.map((row) => ({ ...row, '@odata.etag': etag() })));
      updates.forEach(({ row, patch }) =>
        Object.assign(
          rows.find(
            (stored) =>
              stored.wmkf_proposalrankinglistid ===
              row.wmkf_proposalrankinglistid,
          ),
          patch,
          { '@odata.etag': etag() },
        ),
      );
      if (newRound)
        rounds[newRound.wmkf_proposalrankingroundid] = {
          ...newRound,
          '@odata.etag': etag(),
        };
    },
  );
});

test('ready writes combined confirmation, readiness, and its receipt in one commit', async () => {
  await prepare(alice);

  const commit = commitAssessmentChanges.mock.calls.at(-1)[0];
  const combinedUpdate = commit.updates.find(({ patch }) => {
    const value = JSON.parse(patch.wmkf_assessmentjson);
    return Boolean(value.ready);
  });
  const combined = JSON.parse(combinedUpdate.patch.wmkf_assessmentjson);
  expect(combined.confirmed).toBe(true);
  expect(combined.ready.combinedVersion).toBe(combined.version);
  expect(commit.creates.some((row) => row.wmkf_listkey.startsWith('o:')
    && JSON.parse(row.wmkf_assessmentjson).outcome.action === 'ready')).toBe(true);

  const view = await readWorkflowRound({ roundId, actor: alice });
  expect(view.own.co.confirmed).toBe(true);
  expect(view.progress.find((person) => person.systemUserId === alice).ready).toBe(true);
});

test('private response excludes actual peer assessments; superuser gets no content', async () => {
  await prepare(alice);
  const view = await readWorkflowRound({ roundId, actor: bob });
  expect(view.facilitatorLists).toBeNull();
  expect(view.own.co).toBeNull();
  expect(view.collective).toBeNull();
  const admin = await readWorkflowRound({
    roundId,
    actor: 'outsider',
    isSuperuser: true,
  });
  expect(admin.round.snapshot.proposals).toEqual([]);
  expect(admin.own).toBeNull();
  expect(admin.facilitatorLists).toBeNull();
  expect(admin.progress).toHaveLength(snapshot.roster.length);

  const participantSuperuser = await readWorkflowRound({ roundId, actor: alice, isSuperuser: true });
  expect(participantSuperuser.round.snapshot.proposals).toHaveLength(snapshot.proposals.length);
  expect(participantSuperuser.own).not.toBeNull();
  expect(participantSuperuser.own.co).not.toBeNull();
  expect(participantSuperuser.facilitatorLists).toBeNull();
});

test('a nonfacilitator participant can reset their own program preparation', async () => {
  const before = await readWorkflowRound({ roundId, actor: bob });
  await send('saveAssessment', bob, {
    programKey: 'mr',
    listVersion: before.own.mr.version,
    assessment: { ...before.own.mr, confidence: { m: 'confident' } },
  });
  const reset = await send('resetProgram', bob, { programKey: 'mr' });
  expect(reset.result.operation).toMatchObject({ status: 'confirmed', result: { action: 'resetProgram' } });
  const after = await readWorkflowRound({ roundId, actor: bob });
  expect(after.own.mr.order).toEqual(['m']);
  expect(after.own.mr.confidence).toEqual({});
  expect(after.facilitatorLists).toBeNull();
});

test('captured second facilitator gets facilitator actions without anyone else’s private assessments', async () => {
  const workflow = JSON.parse(rounds[roundId].wmkf_workflowjson);
  workflow.facilitation = {
    version: 1,
    systemUserIds: [alice, charlie],
    source: 'set',
    settingRevision: 'setting-r1',
  };
  workflow.privateMarker = 'must-not-leak';
  rounds[roundId].wmkf_workflowjson = JSON.stringify(workflow);
  const storedSnapshot = JSON.parse(rounds[roundId].wmkf_snapshotjson);
  storedSnapshot.privateMarker = 'must-not-leak';
  rounds[roundId].wmkf_snapshotjson = JSON.stringify(storedSnapshot);

  const view = await readWorkflowRound({ roundId, actor: charlie });
  expect(view.viewer.isFacilitator).toBe(true);
  expect(view.facilitatorLists).toBeNull();
  expect(view.own).toBeNull();
  expect(view.workflow).not.toHaveProperty('privateMarker');
  expect(view.round.snapshot).not.toHaveProperty('privateMarker');

  const facilitatorAdmin = await readWorkflowRound({ roundId, actor: charlie, isSuperuser: true });
  expect(facilitatorAdmin.round.snapshot.proposals).toHaveLength(snapshot.proposals.length);
  expect(facilitatorAdmin.own).toBeNull();
  expect(facilitatorAdmin.confirmations.reveal).toBeDefined();

  const facilitatorPd = await readWorkflowRound({ roundId, actor: alice });
  expect(facilitatorPd.own).not.toBeNull();
  expect(facilitatorPd.facilitatorLists).toBeNull();

  await expect(send('reveal', charlie)).rejects.toMatchObject({
    code: 'incomplete_readiness', status: 409,
  });
  await expect(send('reveal', bob)).rejects.toMatchObject({
    code: 'access_denied', status: 403,
  });

  await send('restartWalkthrough', charlie);
  const created = commitAssessmentChanges.mock.calls.at(-1)[0].newRound;
  expect(created.wmkf_facilitatorsystemuserid).toBe(alice);
  const successor = await readWorkflowRound({
    roundId: created.wmkf_proposalrankingroundid,
    actor: charlie,
  });
  expect(successor.workflow.facilitation).toEqual({
    version: 1, systemUserIds: [alice, charlie], source: 'set', settingRevision: 'setting-r1',
  });
  expect(successor.facilitatorLists).toBeNull();
});

test('reveal, reset, replay after later edits, history, reopen and restart retain records', async () => {
  await prepare(alice);
  await prepare(bob);
  const reveal = await send('reveal');
  expect(reveal.result.collective.individuals).toHaveLength(2);
  await send('editCollective', bob, {
    listVersion: 1,
    order: ['s', 'm'],
    boundaries: [0, 1],
  });
  const reset = await send('resetCollective');
  await send('editCollective', bob, {
    listVersion: 3,
    order: ['s', 'm'],
    boundaries: [1, 2],
  });
  const before = rows.length;
  const retry = await mutateWorkflow({ body: reset.body, actor: alice });
  expect(rows).toHaveLength(before);
  expect(retry.collective.order).toEqual(['s', 'm']);
  expect(retry.operation.result).toEqual(reset.result.operation.result);
  const history = await readWorkflowHistory({ roundId, actor: bob });
  expect(history.entries).toHaveLength(2);
  const revealHistory = rows.find((row) => row.wmkf_listkey === 'h:1');
  const storedReveal = JSON.parse(revealHistory.wmkf_assessmentjson);
  storedReveal.individuals[0].ready = { operationId: 'private-ready-sentinel' };
  storedReveal.individuals[0].privateAssessment = 'private-extra-sentinel';
  revealHistory.wmkf_assessmentjson = JSON.stringify(storedReveal);
  const safeHistory = await readWorkflowHistory({ roundId, actor: bob });
  expect(safeHistory.entries.find((entry) => entry.kind === 'reveal').individuals).toHaveLength(2);
  expect(JSON.stringify(safeHistory)).not.toContain('private-ready-sentinel');
  expect(JSON.stringify(safeHistory)).not.toContain('private-extra-sentinel');
  const immutable = copy(rows.find((row) => row.wmkf_listkey.startsWith('r:')));
  await send('reopenPreparation');
  const privateView = await readWorkflowRound({ roundId, actor: bob });
  expect(privateView.collective).toBeNull();
  expect(privateView.own.ready).toBeNull();
  expect(
    rows.find((row) => row.wmkf_listkey === immutable.wmkf_listkey),
  ).toEqual(immutable);
  const restart = await send('restartWalkthrough');
  expect(restart.result.roundId).not.toBe(roundId);
  expect(restart.result.own.co).toBeNull();
  expect(rounds[roundId].wmkf_state).toBe(100000001);
  expect(
    (await mutateWorkflow({ body: restart.body, actor: alice })).operation
      .result.roundId,
  ).toBe(restart.result.roundId);
});

test('old confirmations and concurrent round writes fail before a second commit', async () => {
  const before = await readWorkflowRound({ roundId, actor: alice });
  await send('resetProgram', alice, { programKey: 'mr' });
  await expect(
    send(
      'resetProgram',
      alice,
      { programKey: 'se' },
      {
        confirmationFingerprint:
          before.confirmations['resetProgram:se'].fingerprint,
      },
    ),
  ).rejects.toMatchObject({ code: 'confirmation_stale' });
  commitAssessmentChanges.mockRejectedValueOnce(
    Object.assign(new Error('race'), { status: 412 }),
  );
  const count = rows.length;
  await expect(send('restartWalkthrough')).rejects.toMatchObject({
    code: 'conflict',
  });
  expect(rows).toHaveLength(count);
});

test('ambiguous transaction readback confirms only a persisted receipt', async () => {
  const commit = commitAssessmentChanges.getMockImplementation();
  commitAssessmentChanges.mockImplementationOnce(async (args) => {
    await commit(args);
    throw new Error('network timeout');
  });
  expect(
    (await send('resetProgram', alice, { programKey: 'mr' })).result.operation
      .status,
  ).toBe('confirmed');
  commitAssessmentChanges.mockRejectedValueOnce(new Error('network timeout'));
  await expect(
    send('resetProgram', alice, { programKey: 'mr' }),
  ).rejects.toMatchObject({ code: 'uncertain_outcome' });
});

test('history is newest-first across numeric boundaries even when storage sorts lexicographically', async () => {
  const workflow = JSON.parse(rounds[roundId].wmkf_workflowjson);
  workflow.historyCount = 12;
  rounds[roundId].wmkf_workflowjson = JSON.stringify(workflow);
  for (let i = 1; i <= 12; i++)
    rows.push({
      wmkf_roundid: roundId,
      wmkf_listkey: `h:${i}`,
      wmkf_assessmentjson: JSON.stringify({
        kind: 'collective',
        revealId: `reveal-${i}`,
        preparationVersion: 1,
        at: `time-${i}`,
        collective: {
          order: ['s', 'm'], boundaries: [1, 1], version: i,
          individuals: [{
            systemUserId: alice, name: 'Alice', order: ['s', 'm'], boundaries: [1, 1],
            confidence: { s: 'confident' }, version: i, sourceVersions: { mr: i }, confirmed: true,
            ready: { operationId: 'private-ready-operation' }, privateAssessment: 'must-not-leak',
          }],
          privateOperationId: 'must-not-leak',
        },
        privateRequestHash: 'must-not-leak',
      }),
    });
  readAssessmentRows.mockImplementation(async (id, keys) =>
    copy(
      rows
        .filter(
          (row) => row.wmkf_roundid === id && keys.includes(row.wmkf_listkey),
        )
        .sort((a, b) => a.wmkf_listkey.localeCompare(b.wmkf_listkey)),
    ),
  );
  const result = await readWorkflowHistory({ roundId, actor: bob });
  expect(result.entries.map((row) => row.revealId)).toEqual([
    'reveal-12', 'reveal-11', 'reveal-10', 'reveal-9', 'reveal-8',
    'reveal-7', 'reveal-6', 'reveal-5', 'reveal-4', 'reveal-3',
  ]);
  expect(result.entries[0]).not.toHaveProperty('privateRequestHash');
  expect(result.entries[0].collective).not.toHaveProperty('privateOperationId');
  expect(result.entries[0].collective.individuals[0]).not.toHaveProperty('ready');
  expect(result.entries[0].collective.individuals[0]).not.toHaveProperty('privateAssessment');
  expect(result.entries[0].collective.individuals[0]).not.toHaveProperty('ready');
  expect(result.entries[0].collective.individuals[0]).toMatchObject({
    systemUserId: alice, name: 'Alice', order: ['s', 'm'], version: 12, confirmed: true,
  });
  expect(result.before).toBe(2);
});

jest.mock('../../lib/services/post-presentation-materials/discussion-sentiment-reader.js',()=>({getDeliberationSentiments:jest.fn(),hasMeetingTrackerAccess:jest.fn()}));
import {getDeliberationSentiments,hasMeetingTrackerAccess} from '../../lib/services/post-presentation-materials/discussion-sentiment-reader';
import {readWorkflowSupplement} from '../../lib/services/proposal-ranking/workflow-service';
function installReveal(count=2){
  const proposals=Array.from({length:count},(_,i)=>({requestId:`request-${i}`,programKey:'mr',score:{mean:3}}));
  const order=proposals.map((p)=>p.requestId);
  const nextSnapshot={...snapshot,proposals,seedOrders:{mr:order,se:[]}};
  const initial=makeInitialWorkflowRecords(nextSnapshot,roundId,alice,'open','now');
  rounds[roundId].wmkf_snapshotjson=JSON.stringify(nextSnapshot);
  rounds[roundId].wmkf_workflowjson=JSON.stringify({...initial.workflow,stage:'revealed',revealId:'revealed'});
  rows=initial.lists.map((row)=>({...row,'@odata.etag':etag()}));
  const baseline={order,boundaries:[count,count],scores:Object.fromEntries(order.map((id,i)=>[id,{rankSum:(i+1)*2,averageRank:i+1}]))};
  const individuals=snapshot.roster.map((p)=>({...p,order,boundaries:[count,count],confidence:Object.fromEntries(order.map((id)=>[id,'confident']))}));
  for(const [key,value] of [['g:revealed',{order,boundaries:[count,count],version:1}],['r:revealed',{baseline,individuals}]])rows.push({wmkf_roundid:roundId,wmkf_listkey:key,wmkf_assessmentjson:JSON.stringify(value)});
  return {roundId,roundEtag:rounds[roundId]['@odata.etag'],preparationVersion:1,revealId:'revealed',listVersion:1};
}
test('sentiment batches over 50 and discards already-loaded quotes when later authorization fails',async()=>{
  const body={...installReveal(51),action:'sentiment'};
  getDeliberationSentiments.mockResolvedValueOnce({'request-0':{status:'current',sentiment:{headline:'PRIVATE QUOTE'}}}).mockRejectedValueOnce(Object.assign(new Error('denied'),{code:'sentiment_read_forbidden'}));
  const response=await readWorkflowSupplement({body,actor:alice,profileId:1});
  expect(getDeliberationSentiments.mock.calls.map(([ids])=>ids.length)).toEqual([50,1]);
  expect(response).toEqual({status:'access-denied',sentiments:{}});
  expect(JSON.stringify(response)).not.toContain('PRIVATE QUOTE');
});
test('sentiment is absent before reveal and for nonparticipant superusers',async()=>{
  await expect(readWorkflowSupplement({body:{action:'sentiment',roundId},actor:alice,profileId:1})).rejects.toMatchObject({code:'invalid_transition'});
  const body={...installReveal(),action:'sentiment'};
  await expect(readWorkflowSupplement({body,actor:'outsider',isSuperuser:true,profileId:1})).rejects.toMatchObject({code:'access_denied'});
  expect(getDeliberationSentiments).not.toHaveBeenCalled();
});
test('a reset racing sentiment delivery rejects the previously loaded quotes',async()=>{
  const body={...installReveal(),action:'sentiment'};
  getDeliberationSentiments.mockImplementationOnce(async()=>{rounds[roundId]['@odata.etag']=etag();return {'request-0':{status:'current',sentiment:{headline:'OLD QUOTE'}}};});
  await expect(readWorkflowSupplement({body,actor:alice,profileId:1})).rejects.toMatchObject({code:'stale_scope'});
});


jest.mock('../../lib/services/proposal-ranking/test-policy.js', () => ({...jest.requireActual('../../lib/services/proposal-ranking/test-policy.js'), getRankingTestPolicy:jest.fn(() => ({enabled:false}))}));
import { getRankingTestPolicy, RANKING_TEST_REQUESTS } from '../../lib/services/proposal-ranking/test-policy';
test('sample discussion retains live Meeting Tracker access and stale-response fences', async () => {
  const body = {...installReveal(), action:'sentiment'};
  const stored = JSON.parse(rounds[roundId].wmkf_snapshotjson);
  stored.proposals[0].requestId = RANKING_TEST_REQUESTS[0];
  rounds[roundId].wmkf_snapshotjson = JSON.stringify(stored);
  getRankingTestPolicy.mockReturnValue({enabled:true});
  try {
    hasMeetingTrackerAccess.mockResolvedValue(false);
    expect(await readWorkflowSupplement({body,actor:alice,profileId:1})).toEqual({status:'access-denied',sentiments:{}});
    hasMeetingTrackerAccess.mockResolvedValue(true);
    const result = await readWorkflowSupplement({body,actor:alice,profileId:1});
    expect(result.sentiments[RANKING_TEST_REQUESTS[0]]).toMatchObject({sample:true,status:'current'});
    expect(result.sentiments['request-1']).toBeUndefined();
    expect(getDeliberationSentiments).not.toHaveBeenCalled();
    hasMeetingTrackerAccess.mockImplementationOnce(async () => { rounds[roundId]['@odata.etag']=etag(); return true; });
    await expect(readWorkflowSupplement({body,actor:alice,profileId:1})).rejects.toMatchObject({code:'stale_scope'});
  } finally { getRankingTestPolicy.mockReturnValue({enabled:false}); }
});

jest.mock('../../shared/utils/api-request', () => ({ requestEnvelope: jest.fn() }));
import { requestEnvelope } from '../../shared/utils/api-request';
import { sendProposalRankingAction } from '../../shared/components/proposal-ranking/client';
test('two PDs saving from the same loaded round retain distinct private assessments through client recovery', async () => {
  const bobView = await readWorkflowRound({ roundId, actor: bob });
  await send('saveAssessment', alice, { programKey: 'mr', listVersion: 1,
    assessment: { ...bobView.own.mr, confidence: { m: 'confident' } } });
  requestEnvelope.mockImplementation(async (_url, options) => {
    try {
      const data = options.body
        ? await mutateWorkflow({ body: options.body, actor: bob })
        : await readWorkflowRound({ roundId, actor: bob });
      return { ok: true, status: 200, data };
    } catch (error) {
      return { ok: false, status: error.status, data: { error: { code: error.code, message: error.message } } };
    }
  });
  const response = await sendProposalRankingAction({
    action: 'saveAssessment', roundId, operationId: 'bob-save', roundEtag: bobView.round.etag,
    policyRevision: 1, preparationVersion: 1, revealId: null, programKey: 'mr', listVersion: 1,
    assessment: { ...bobView.own.mr, confidence: { m: 'not-sure' } },
  }, { baseView: bobView });
  expect(response.own.mr.confidence).toEqual({ m: 'not-sure' });
  expect((await readWorkflowRound({ roundId, actor: alice })).own.mr.confidence).toEqual({ m: 'confident' });
  const lastCommit = commitAssessmentChanges.mock.calls.at(-1)[0];
  expect(lastCommit.updates).toHaveLength(1);
  expect(lastCommit.updates[0].row.wmkf_participantsystemuserid).toBe(bob);
  expect(requestEnvelope).toHaveBeenCalledTimes(3);
});
