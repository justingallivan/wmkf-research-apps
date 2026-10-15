import {
  initialPreparation,
  participantIsReady,
  transitionWorkflow,
} from '../../lib/services/proposal-ranking/workflow';

const snapshot = {
  version: 2,
  roster: [
    { systemUserId: 'alice', name: 'Alice' },
    { systemUserId: 'bob', name: 'Bob' },
  ],
  seedOrders: { mr: ['m'], se: ['s'] },
  proposals: [
    { requestId: 'm', programKey: 'mr', score: { mean: 4 } },
    { requestId: 's', programKey: 'se', score: { mean: 3 } },
  ],
};
let state;
let serial;
function act(action, actorId = 'alice', payload = {}) {
  const result = transitionWorkflow({
    state,
    snapshot,
    actorId,
    facilitatorId: 'alice',
    action,
    operationId: `op-${++serial}`,
    now: '2026-10-13T12:00:00Z',
    payload: {
      preparationVersion: state.preparationVersion,
      revealId: state.revealId,
      ...payload,
    },
  });
  state = result.state;
  return result;
}
function prepare(actorId) {
  for (const programKey of ['mr', 'se']) {
    const current = state.participants[actorId][programKey];
    act('saveAssessment', actorId, {
      programKey,
      listVersion: current.version,
      assessment: {
        ...current,
        confidence: { [current.order[0]]: 'confident' },
      },
    });
  }
  act('buildCombined', actorId);
  act('ready', actorId);
}
beforeEach(() => {
  state = initialPreparation(snapshot);
  serial = 0;
});

test('complete rehearsal preserves reveal and collective archives across all reset stages', () => {
  act('resetProgram', 'alice', { programKey: 'mr' });
  prepare('alice');
  act('reopenOwn');
  expect(participantIsReady(state.participants.alice)).toBe(false);
  act('ready');
  prepare('bob');
  const revealed = act('reveal');
  const immutable = JSON.stringify(revealed.archives[0]);
  const revealId = state.revealId;
  act('editCollective', 'bob', {
    listVersion: 1,
    order: ['s', 'm'],
    boundaries: [0, 1],
  });
  const reset = act('resetCollective');
  expect(reset.archives[0].collective.order).toEqual(['s', 'm']);
  expect(state.collective.order).toEqual(['m', 's']);
  expect(state.revealId).toBe(revealId);
  expect(JSON.stringify(revealed.archives[0])).toBe(immutable);
  const reopened = act('reopenPreparation');
  expect(reopened.archives).toHaveLength(1);
  expect(state.preparationVersion).toBe(2);
  expect(state.revealId).toBeNull();
  expect(state.participants.alice.co.order).toEqual(['m', 's']);
  expect(Object.values(state.participants).every((p) => p.ready === null)).toBe(
    true,
  );
  expect(() => act('reveal')).toThrow(/Every Program Director/);
  act('ready', 'alice');
  act('ready', 'bob');
  act('reveal');
  const restarted = act('restartWalkthrough');
  expect(restarted.restart).toBe(true);
  expect(restarted.archives).toHaveLength(1);
  expect(state.participants.alice.co).toBeNull();
  expect(state.participants.alice.mr.confidence).toEqual({});
});

test('source edit invalidates combined confirmation without overwriting the combined order', () => {
  prepare('alice');
  act('reopenOwn');
  const before = [...state.participants.alice.co.order];
  const mr = state.participants.alice.mr;
  act('saveAssessment', 'alice', {
    programKey: 'mr',
    listVersion: mr.version,
    assessment: { ...mr, boundaries: [0, 0] },
  });
  expect(state.participants.alice.co.order).toEqual(before);
  expect(state.participants.alice.co.confirmed).toBe(false);
  expect(() => act('confirmCombined')).toThrow(/Rebuild/);
  expect(() => act('ready')).toThrow(/Rebuild/);
  act('buildCombined');
  expect(state.participants.alice.co.order).toEqual(['s', 'm']);
});

test('ready confirms a complete combined order and marks it ready in one transition', () => {
  for (const programKey of ['mr', 'se']) {
    const current = state.participants.alice[programKey];
    act('saveAssessment', 'alice', {
      programKey,
      listVersion: current.version,
      assessment: { ...current, confidence: { [current.order[0]]: 'confident' } },
    });
  }
  act('buildCombined');
  expect(state.participants.alice.co.confirmed).toBe(false);

  act('ready');

  expect(state.participants.alice.co.confirmed).toBe(true);
  expect(state.participants.alice.ready).toMatchObject({
    combinedVersion: state.participants.alice.co.version,
    operationId: 'op-4',
  });
  expect(participantIsReady(state.participants.alice)).toBe(true);
});

test('ready rejects incomplete confidence without changing the combined order', () => {
  for (const programKey of ['mr', 'se']) {
    const current = state.participants.alice[programKey];
    act('saveAssessment', 'alice', {
      programKey,
      listVersion: current.version,
      assessment: { ...current, confidence: { [current.order[0]]: 'confident' } },
    });
  }
  act('buildCombined');
  state.participants.alice.co.confidence.m = undefined;
  const before = JSON.stringify(state);

  expect(() => act('ready')).toThrow(/Answer confidence/);
  expect(JSON.stringify(state)).toBe(before);
});

test('ready locks own edits; reveal locks all private edits and stale scopes fail', () => {
  prepare('alice');
  expect(() => act('resetProgram', 'alice', { programKey: 'se' })).toThrow(
    /Reopen/,
  );
  prepare('bob');
  act('reveal');
  expect(() => act('reopenOwn')).toThrow(/Private preparation is closed/);
  expect(() =>
    act('editCollective', 'bob', {
      preparationVersion: 0,
      listVersion: 1,
      order: ['m', 's'],
      boundaries: [1, 1],
    }),
  ).toThrow(/changed/);
  act('reopenPreparation');
  expect(() => act('ready', 'alice', { revealId: 'old-reveal' })).toThrow(
    /changed/,
  );
});

test.each([
  'reveal',
  'resetCollective',
  'reopenPreparation',
  'restartWalkthrough',
])('%s rejects a participant who is not facilitator', (action) => {
  expect(() => act(action, 'bob')).toThrow(/Only the facilitator/);
});

test('unknown actions, versions, stages and nonparticipants fail closed', () => {
  expect(() => act('typo')).toThrow(/Unsupported/);
  expect(() => act('buildCombined', 'outsider')).toThrow(
    /captured participant/,
  );
  expect(() =>
    transitionWorkflow({
      state,
      snapshot: { ...snapshot, version: 3 },
      payload: {},
    }),
  ).toThrow(/version-2/);
  state.stage = 'unknown';
  expect(() => act('ready')).toThrow(/Unknown/);
});

test.each(['private', 'ready', 'revealed'])(
  'restart is available at %s stage',
  (stage) => {
    if (stage !== 'private') {
      prepare('alice');
      prepare('bob');
    }
    if (stage === 'revealed') act('reveal');
    expect(act('restartWalkthrough').restart).toBe(true);
    expect(state.stage).toBe('private');
  },
);

test('failed transition leaves its complete input unchanged', () => {
  prepare('alice');
  const before = JSON.stringify(state);
  expect(() => act('reveal')).toThrow(/Every/);
  expect(JSON.stringify(state)).toBe(before);
});

test('100 proposals and 12 PDs reveal within the additive assessment field capacity', () => {
  const proposals = Array.from({ length: 100 }, (_, i) => ({
    requestId: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    programKey: i % 2 ? 'mr' : 'se',
    score: { mean: 4 },
    requestNumber: String(i),
  }));
  const roster = Array.from({ length: 12 }, (_, i) => ({
    systemUserId: `10000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    name: `Program Director ${i}`,
  }));
  const large = {
    version: 2,
    proposals,
    roster,
    seedOrders: Object.fromEntries(
      ['mr', 'se'].map((program) => [
        program,
        proposals
          .filter((p) => p.programKey === program)
          .map((p) => p.requestId),
      ]),
    ),
  };
  let current = initialPreparation(large);
  const perform = (action, actorId, extra = {}) => {
    const result = transitionWorkflow({
      state: current,
      snapshot: large,
      actorId,
      facilitatorId: roster[0].systemUserId,
      action,
      operationId: `op-${++serial}`,
      now: '2026-10-13',
      payload: {
        preparationVersion: current.preparationVersion,
        revealId: current.revealId,
        ...extra,
      },
    });
    current = result.state;
    return result;
  };
  for (const { systemUserId } of roster) {
    for (const programKey of ['mr', 'se']) {
      const list = current.participants[systemUserId][programKey];
      perform('saveAssessment', systemUserId, {
        programKey,
        listVersion: list.version,
        assessment: {
          ...list,
          confidence: Object.fromEntries(
            list.order.map((id) => [id, 'confident']),
          ),
        },
      });
    }
    perform('buildCombined', systemUserId);
    perform('confirmCombined', systemUserId);
    perform('ready', systemUserId);
  }
  const reveal = perform('reveal', roster[0].systemUserId);
  expect(current.collective.order).toHaveLength(100);
  expect(Buffer.byteLength(JSON.stringify(current.collective))).toBeLessThan(
    524288,
  );
  expect(Buffer.byteLength(JSON.stringify(reveal.archives[0]))).toBeLessThan(
    524288,
  );
});
