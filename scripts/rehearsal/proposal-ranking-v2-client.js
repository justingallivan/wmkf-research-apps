/** Synthetic UI rehearsal only. Production service transactions are tested separately. */
import {
  initialPreparation,
  transitionWorkflow,
} from '../../lib/services/proposal-ranking/workflow';
let ids = ['a', 'b', 'c', 'd'];
export const snapshot = {
  version: 2,
  cycleCode: 'J27',
  roster: ['Alex', 'Casey', 'Morgan', 'Dana'].map((name, i) => ({
    name,
    systemUserId: `pd-${i}`,
  })),
  seedOrders: { mr: ['a', 'c'], se: ['b', 'd'] },
  proposals: [
    [
      'Northlake University',
      'Mapping the mechanics of cellular repair',
      'mr',
      'West',
      125000,
      4.7,
    ],
    [
      'Redwood Institute',
      'A new window into quantum materials',
      'se',
      'West',
      87500,
      4.3,
    ],
    [
      'Eastbridge University',
      'Decoding immune memory across tissues',
      'mr',
      'East',
      245000,
      3.3,
    ],
    [
      'Pine Harbor Research Center',
      'Programmable surfaces for optical sensing',
      'se',
      'West',
      150000,
      2.3,
    ],
  ].map(
    (
      [organization, title, programKey, institutionGeography, amount, mean],
      i,
    ) => ({
      requestId: ids[i],
      requestNumber: `Example ${i + 1}`,
      organization,
      title,
      programKey,
      institutionGeography,
      amountMinorUnits: amount * 100,
      currency: { code: 'USD', precision: 2 },
      score: {
        mean,
        displayMean: mean,
        ratedCount: 3,
        receivedCount: 3,
        distribution: {
          Excellent: i < 2 ? 2 : 0,
          'Very Good': i < 2 ? 1 : 0,
          Good: i >= 2 ? 2 : 0,
          Fair: i >= 2 ? 1 : 0,
        },
      },
      researchFunding: {
        status: 'available',
        qualifyingGrantCount: i % 3,
        latestAwardYear: i % 3 ? 2021 : null,
      },
    }),
  ),
};
const smallSnapshot = structuredClone(snapshot);
export function chooseFixture(large = false) {
  Object.assign(snapshot, structuredClone(smallSnapshot));
  if (large) {
    snapshot.roster = Array.from({ length: 12 }, (_, i) => ({
      name: `Example PD ${i + 1}`, systemUserId: `pd-${i}`,
    }));
    snapshot.proposals = Array.from({ length: 100 }, (_, i) => ({
      ...structuredClone(smallSnapshot.proposals[i % 4]),
      requestId: `example-${i + 1}`,
      requestNumber: `Example ${i + 1}`,
      organization: `Example Institution ${i + 1}`,
    }));
    snapshot.seedOrders = Object.fromEntries(['mr', 'se'].map((program) => [
      program, snapshot.proposals.filter((p) => p.programKey === program).map((p) => p.requestId),
    ]));
  }
  ids = snapshot.proposals.map((p) => p.requestId);
  actor = 'pd-0';
  return seed(true);
}
let state;
let actor = 'pd-0';
let revision = 0;
let roundId = 'fictional-round';
let archives = [];
const confirmations = () =>
  Object.fromEntries(
    [
      'buildCombined',
      'reveal',
      'resetCollective',
      'reopenPreparation',
      'restartWalkthrough',
      'resetProgram:mr',
      'resetProgram:se',
    ].map((key) => [
      key,
      {
        fingerprint: String(revision),
        message: key.startsWith('resetProgram')
          ? 'Restore this program’s reviewer order and starting thirds, clearing confidence?'
          : key === 'restartWalkthrough'
            ? 'Start a new rehearsal from the same fictional proposals?'
            : key === 'reopenPreparation'
              ? 'Reopen private preparation for everyone, retaining this reveal?'
              : key === 'resetCollective'
                ? 'Restore the calculated group order, retaining current work in history?'
                : key === 'reveal'
                  ? 'Reveal the named individual assessments?'
                  : 'Replace combined-only changes with the current MR/SE assessments?',
      },
    ]),
  );
export function currentView() {
  return structuredClone({
    workflowVersion: 2,
    mode: 'round',
    roundId,
    cycleCode: 'J27',
    viewer: {
      systemUserId: actor,
      isFacilitator: actor === 'pd-0',
      isRosterParticipant: true,
    },
    round: {
      state: 'active',
      etag: String(revision),
      policyRevision: 1,
      snapshot,
    },
    workflow: {
      stage: state.stage,
      preparationVersion: state.preparationVersion,
      revealId: state.revealId,
    },
    own: state.participants[actor],
    facilitatorLists: actor === 'pd-0' ? state.participants : null,
    collective: state.collective,
    progress: snapshot.roster.map((p) => ({
      ...p,
      ready: Boolean(state.participants[p.systemUserId].ready),
    })),
    confirmations: confirmations(),
  });
}
export function chooseActor(value) {
  actor = value;
  return currentView();
}
export function seed(group = false) {
  state = initialPreparation(snapshot);
  archives = [];
  revision += 1;
  roundId = `fictional-round-${revision}`;
  if (group) {
    snapshot.roster.forEach((p, i) => {
      const person = state.participants[p.systemUserId];
      person.co = {
        order: i === 2 ? [...ids.slice(0, 2), ids[3], ids[2], ...ids.slice(4)] : ids,
        boundaries:
          ids.length > 4
            ? [i === 0 ? 34 : 33, 67]
            : i === 0 ? [3, 3] : i === 1 ? [2, 3] : i === 2 ? [2, 2] : [1, 3],
        confidence: Object.fromEntries(
          ids.map((id) => [
            id,
            (id === 'c' && i < 3) || (id === 'b' && i === 3)
              ? 'not-sure'
              : 'confident',
          ]),
        ),
        version: 1,
        sourceVersions: { mr: 1, se: 1 },
        confirmed: true,
      };
      person.ready = { combinedVersion: 1 };
    });
    const result = transitionWorkflow({
      state,
      snapshot,
      actorId: 'pd-0',
      facilitatorId: 'pd-0',
      action: 'reveal',
      payload: { preparationVersion: 1, revealId: null },
      operationId: 'fictional-reveal',
      now: new Date().toISOString(),
    });
    state = result.state;
    archives.push(...result.archives);
  }
  return currentView();
}
seed(true);
export function createOperationId() {
  return crypto.randomUUID();
}
export async function loadProposalRanking() {
  return currentView();
}
export async function sendProposalRankingAction(body) {
  if (body.action === 'history')
    return { entries: archives.slice().reverse(), before: null };
  if (body.action === 'sentiment')
    return { status: 'available', sentiments: {} };
  if (body.action === 'exportWorkbook')
    throw new Error(
      'This isolated UI rehearsal has no download endpoint; workbook bytes are covered by service tests.',
    );
  if (body.roundEtag !== String(revision))
    throw new Error('Round changed. Refresh before continuing.');
  const result = transitionWorkflow({
    state,
    snapshot,
    actorId: actor,
    facilitatorId: 'pd-0',
    action: body.action,
    payload: body,
    operationId: body.operationId,
    now: new Date().toISOString(),
  });
  state = result.state;
  archives.push(...result.archives);
  revision += 1;
  if (result.restart) roundId = `fictional-round-${revision}`;
  return currentView();
}
