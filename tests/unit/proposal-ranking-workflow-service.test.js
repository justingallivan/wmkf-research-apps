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
  await send('confirmCombined', actor);
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
      wmkf_assessmentjson: JSON.stringify({ sequence: i }),
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
  expect(result.entries.map((row) => row.sequence)).toEqual([
    12, 11, 10, 9, 8, 7, 6, 5, 4, 3,
  ]);
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
