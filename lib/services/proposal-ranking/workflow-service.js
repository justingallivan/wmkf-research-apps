/**
 * Version-2 Proposal Ranking: authorized, round-fenced transitions with immutable
 * operation receipts. Old rounds remain in service.js's explicit v1 path.
 */
import crypto, { randomUUID } from 'node:crypto';
import {
  readAssessmentRound,
  readAssessmentRows,
  commitAssessmentChanges,
  findCycleCoordinator,
} from '../../dataverse/adapters/proposal-ranking.js';
import {
  initialPreparation,
  participantIsReady,
  transitionWorkflow,
  workflowError,
} from './workflow.js';
import { validateAssessment, calculateSectionTotals } from './assessments.js';
import { rehearsalPresentation } from './test-fixtures.js';
import { getRankingTestPolicy } from './test-policy.js';
import { resolveRoundFacilitation } from './facilitation.js';

export const WORKFLOW_ACTIONS = Object.freeze([
  'saveAssessment',
  'buildCombined',
  'confirmCombined',
  'ready',
  'reopenOwn',
  'resetProgram',
  'reveal',
  'editCollective',
  'resetCollective',
  'reopenPreparation',
  'restartWalkthrough',
]);
const CONFIRMED_ACTIONS = [
  'buildCombined',
  'resetProgram',
  'reveal',
  'resetCollective',
  'reopenPreparation',
  'restartWalkthrough',
];
const SHARED_ACTIONS = [
  'reveal',
  'resetCollective',
  'reopenPreparation',
  'restartWalkthrough',
];
const messages = {
  buildCombined:
    'Rebuild the combined list from your current MR and SE assessments? This will replace any edits you made directly in the combined list.',
  resetProgram:
    'Restore reviewer-score order and starting thirds for this program? Its confidence answers will be cleared and the combined list will need rebuilding.',
  reveal:
    'Reveal every Program Director’s named assessments and create the group starting order?',
  resetCollective:
    'Restore this reveal’s calculated order and starting dividers? The current group revision will remain in history.',
  reopenPreparation:
    'Start a new private preparation version? Everyone must mark ready again. This reveal and group order remain in history.',
  restartWalkthrough:
    'Start again with the same proposals and reviewer scores, starting thirds and unanswered confidence? The previous run stays in history.',
};
const pdKey = (version, program, actor) => `p:${version}:${program}:${actor}`;
const hash = (value) =>
  crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const json = (value, label) => {
  try {
    return JSON.parse(value);
  } catch {
    throw workflowError(
      `${label} cannot be read.`,
      'dependency_unavailable',
      503,
    );
  }
};
const fail = (message, code = 'conflict', status = 409) => {
  throw workflowError(message, code, status);
};
const stamp = (actor, operationId, action, now) => ({
  wmkf_lastoperationid: operationId,
  wmkf_lastoperationkind: action.slice(0, 16),
  wmkf_updatedbyactorsystemuserid: actor,
  wmkf_updatedat: now,
});
function record(
  roundId,
  key,
  value,
  actor,
  operationId,
  now,
  program = 'co',
  owner = null,
) {
  return {
    wmkf_proposalrankinglistid: randomUUID(),
    wmkf_name: `Ranking ${key}`.slice(0, 200),
    wmkf_roundid: roundId,
    wmkf_listkey: key,
    wmkf_programkey: program,
    wmkf_participantsystemuserid: owner,
    wmkf_orderjson: JSON.stringify(value?.order || []),
    wmkf_assessmentjson: JSON.stringify(value),
    wmkf_status: 100000000,
    wmkf_version: value?.version || 1,
    ...stamp(actor, operationId, 'workflow', now),
  };
}
export function assertWorkflowCapacity(snapshot) {
  if (
    snapshot.version !== 2 ||
    !Array.isArray(snapshot.proposals) ||
    !Array.isArray(snapshot.roster) ||
    snapshot.proposals.length > 100 ||
    snapshot.roster.length < 1 ||
    snapshot.roster.length > 12 ||
    new Set(snapshot.roster.map((person) => person.systemUserId)).size !==
      snapshot.roster.length
  ) {
    fail(
      'This workflow supports up to 100 proposals and 12 distinct Program Directors.',
      'storage_limit',
    );
  }
}
export function makeInitialWorkflowRecords(
  snapshot,
  roundId,
  actor,
  operationId,
  now,
  facilitation = null,
) {
  assertWorkflowCapacity(snapshot);
  const capturedFacilitation = facilitation
    ? resolveRoundFacilitation({ facilitation }, facilitation.systemUserIds?.[0])
    : null;
  const state = initialPreparation(snapshot);
  const lists = [];
  for (const [id, participant] of Object.entries(state.participants)) {
    for (const program of ['se', 'mr', 'co'])
      lists.push(
        record(
          roundId,
          pdKey(1, program, id),
          participant[program],
          actor,
          operationId,
          now,
          program,
          id,
        ),
      );
  }
  return {
    lists,
    workflow: {
      version: 2,
      preparationVersion: 1,
      stage: 'private',
      revealId: null,
      historyCount: 0,
      previousRoundId: null,
      supersededBy: null,
      ...(capturedFacilitation ? { facilitation: capturedFacilitation } : {}),
    },
  };
}
function token(round, workflow, actor, action, program = null) {
  return hash({
    roundId: round.wmkf_proposalrankingroundid,
    etag: round['@odata.etag'],
    policy: round.wmkf_policyrevision,
    workflow,
    actor,
    action,
    program,
  });
}
async function load(roundId, actor, isSuperuser) {
  const round = await readAssessmentRound(roundId);
  const snapshot = json(round.wmkf_snapshotjson, 'Snapshot');
  assertWorkflowCapacity(snapshot);
  const participant = snapshot.roster.some(
    (person) => person.systemUserId === actor,
  );
  const workflow = json(round.wmkf_workflowjson, 'Workflow');
  const facilitation = resolveRoundFacilitation(workflow, round.wmkf_facilitatorsystemuserid);
  const facilitator = facilitation.systemUserIds.includes(actor);
  // The route admits only explicit proposal-ranking grant holders; anyone who
  // is neither a captured participant nor a facilitator reads as an observer.
  const observer = !facilitator && !participant;
  if (
    workflow?.version !== 2 ||
    !Number.isSafeInteger(workflow.preparationVersion) ||
    workflow.preparationVersion < 1 ||
    !Number.isSafeInteger(workflow.historyCount) ||
    workflow.historyCount < 0 ||
    !['private', 'revealed'].includes(workflow.stage)
  ) {
    fail('Unsupported ranking workflow.', 'dependency_unavailable', 503);
  }
  const keys = snapshot.roster.flatMap(({ systemUserId }) =>
    ['se', 'mr', 'co'].map((program) =>
      pdKey(workflow.preparationVersion, program, systemUserId),
    ),
  );
  if (workflow.revealId)
    keys.push(`g:${workflow.revealId}`, `r:${workflow.revealId}`);
  const rows = await readAssessmentRows(roundId, keys);
  const byKey = new Map(rows.map((row) => [row.wmkf_listkey, row]));
  if (rows.length !== keys.length || byKey.size !== keys.length)
    fail(
      'Active ranking records are incomplete.',
      'dependency_unavailable',
      503,
    );
  const value = (key) => json(byKey.get(key).wmkf_assessmentjson, 'Assessment');
  const participants = Object.fromEntries(
    snapshot.roster.map(({ systemUserId }) => [
      systemUserId,
      Object.fromEntries(
        ['se', 'mr', 'co'].map((program) => [
          program,
          value(pdKey(workflow.preparationVersion, program, systemUserId)),
        ]),
      ),
    ]),
  );
  for (const person of Object.values(participants)) {
    person.ready = person.co?.ready || null;
    for (const program of ['se', 'mr'])
      if (!validateAssessment(person[program], snapshot.seedOrders[program]))
        fail('Saved assessment is invalid.', 'dependency_unavailable', 503);
    if (
      person.co &&
      !validateAssessment(
        person.co,
        snapshot.proposals.map((proposal) => proposal.requestId),
      )
    )
      fail(
        'Saved combined assessment is invalid.',
        'dependency_unavailable',
        503,
      );
  }
  const reveal = workflow.revealId ? value(`r:${workflow.revealId}`) : null;
  const collective = reveal
    ? {
        ...value(`g:${workflow.revealId}`),
        baseline: reveal.baseline,
        individuals: reveal.individuals,
      }
    : null;
  if ((workflow.stage === 'revealed') !== Boolean(collective))
    fail('Reveal state is incomplete.', 'dependency_unavailable', 503);
  return {
    round,
    snapshot,
    workflow: { ...workflow, facilitation },
    state: { ...workflow, participants, collective },
    rows,
    byKey,
    facilitator,
    participant,
    observer,
    actor,
    isSuperuser,
  };
}
function publicSnapshot(snapshot) {
  const proposals = snapshot.proposals.map((proposal) => ({
    requestId: proposal.requestId,
    requestNumber: proposal.requestNumber,
    title: proposal.title,
    organization: proposal.organization,
    institutionGeography: proposal.institutionGeography ?? null,
    ...(Object.hasOwn(proposal, 'researchFunding') ? { researchFunding: proposal.researchFunding } : {}),
    programKey: proposal.programKey,
    leadSystemUserId: proposal.leadSystemUserId,
    amountMinorUnits: proposal.amountMinorUnits,
    currency: proposal.currency ? {
      code: proposal.currency.code,
      name: proposal.currency.name,
      precision: proposal.currency.precision,
    } : null,
    score: proposal.score ? {
      mean: proposal.score.mean,
      displayMean: proposal.score.displayMean,
      ratedCount: proposal.score.ratedCount,
      receivedCount: proposal.score.receivedCount,
      distribution: proposal.score.distribution,
    } : null,
  }));
  return {
    version: 2,
    cycleCode: snapshot.cycleCode,
    proposals,
    seedOrders: {
      se: snapshot.seedOrders.se || [],
      mr: snapshot.seedOrders.mr || [],
    },
    roster: snapshot.roster.map(({ systemUserId, name, excluded }) => ({
      systemUserId,
      name,
      ...(excluded === true ? { excluded: true } : {}),
    })),
    excusedSystemUserIds: snapshot.excusedSystemUserIds || [],
    openedAt: snapshot.openedAt || null,
  };
}
function publicBaseline(value) {
  return value ? {
    order: value.order,
    boundaries: value.boundaries,
    scores: value.scores,
    ranges: value.ranges,
  } : null;
}
function publicCollective(value) {
  if (!value) return null;
  return {
    order: value.order,
    boundaries: value.boundaries,
    version: value.version,
    baseline: publicBaseline(value.baseline),
    individuals: Array.isArray(value.individuals)
      ? value.individuals.map(publicIndividual)
      : [],
  };
}
function publicIndividual(individual) {
  return {
    systemUserId: individual.systemUserId,
    name: individual.name,
    order: individual.order,
    boundaries: individual.boundaries,
    confidence: individual.confidence,
    version: individual.version,
    sourceVersions: individual.sourceVersions,
    confirmed: individual.confirmed,
  };
}
function publicView(context, operation = null) {
  const {
    round,
    snapshot,
    workflow,
    state,
    actor,
    facilitator,
    participant,
    observer,
    isSuperuser,
  } = context;
  const content = facilitator || participant;
  // Observers see revealed group work only. load() guarantees a collective
  // exists exactly when the stage is revealed, so this stays private before
  // reveal and again after preparation is reopened.
  const groupContent = content || (observer && state.stage === 'revealed');
  const active = round.wmkf_state === 100000000 && !workflow.supersededBy;
  const confirmations = {};
  if (active && content)
    for (const action of CONFIRMED_ACTIONS) {
      if (SHARED_ACTIONS.includes(action) && !facilitator) continue;
      if (action === 'resetProgram')
        for (const program of ['se', 'mr'])
          confirmations[`resetProgram:${program}`] = {
            fingerprint: token(round, workflow, actor, action, program),
            message: messages[action],
          };
      else
        confirmations[action] = {
          fingerprint: token(round, workflow, actor, action),
          message: action === 'buildCombined' && !state.participants[actor]?.co
            ? 'Combine your MR and SE assessments into one list? You can review and adjust it afterward.'
            : messages[action],
        };
    }
  return {
    mode: 'round',
    workflowVersion: 2,
    roundId: round.wmkf_proposalrankingroundid,
    cycleCode: snapshot.cycleCode,
    viewer: {
      systemUserId: actor,
      isFacilitator: facilitator,
      isRosterParticipant: participant,
      isObserver: observer,
      isSuperuser,
    },
    round: {
      etag: round['@odata.etag'],
      policyRevision: Number(round.wmkf_policyrevision),
      state: active ? 'active' : 'canceled',
      // The source snapshot (proposals, reviewer scores, seed order) carries
      // no Program Director work, so every authorized viewer receives it.
      snapshot: publicSnapshot(snapshot),
    },
    workflow: {
      version: workflow.version,
      preparationVersion: workflow.preparationVersion,
      stage: workflow.stage,
      revealId: workflow.revealId,
      historyCount: workflow.historyCount,
      previousRoundId: workflow.previousRoundId,
      supersededBy: workflow.supersededBy,
      facilitation: workflow.facilitation,
    },
    own: content && participant ? state.participants[actor] : null,
    facilitatorLists: null,
    progress: snapshot.roster.map(({ systemUserId, name }) => ({
      systemUserId,
      name,
      ready: participantIsReady(state.participants[systemUserId]),
    })),
    collective: groupContent ? publicCollective(state.collective) : null,
    totals:
      groupContent && state.collective
        ? calculateSectionTotals(
            state.collective.order,
            state.collective.boundaries,
            snapshot.proposals,
          )
        : null,
    confirmations,
    operation,
  };
}
async function receipt(context, operationId) {
  if (!operationId) return null;
  const rows = await readAssessmentRows(
    context.round.wmkf_proposalrankingroundid,
    [`o:${operationId}`],
  );
  if (!rows.length) return null;
  if (rows.length !== 1)
    fail('Duplicate operation receipt.', 'dependency_unavailable', 503);
  const result = json(rows[0].wmkf_assessmentjson, 'Operation receipt');
  // Receipts reveal no private work and are visible only to their original actor.
  return result.actor === context.actor ? result : null;
}
export async function readWorkflowRound({
  roundId,
  actor,
  isSuperuser = false,
  operationId = null,
}) {
  const context = await load(roundId, actor, isSuperuser);
  const found = await receipt(context, operationId);
  return publicView(
    context,
    operationId
      ? {
          operationId,
          status: found ? 'confirmed' : 'uncertain',
          result: found?.outcome || null,
        }
      : null,
  );
}
export async function readWorkflowHistory({
  roundId,
  actor,
  isSuperuser = false,
  before,
}) {
  // History holds only reveal and collective records (enforced below). Observers
  // read it only while the group is revealed; during (re)opened preparation
  // they get readiness alone, like the round view.
  const context = await load(roundId, actor, isSuperuser);
  if (context.observer && context.state.stage !== 'revealed')
    fail('History is available to observers while the group is revealed.', 'access_denied', 403);
  const end = before == null ? context.workflow.historyCount : before;
  if (
    !Number.isSafeInteger(end) ||
    end < 0 ||
    end > context.workflow.historyCount
  )
    fail('Invalid history position.', 'invalid_request', 400);
  const start = Math.max(0, end - 10);
  const keys = Array.from(
    { length: end - start },
    (_, i) => `h:${start + i + 1}`,
  );
  const rows = keys.length ? await readAssessmentRows(roundId, keys) : [];
  const byKey = new Map(rows.map((row) => [row.wmkf_listkey, row]));
  if (byKey.size !== keys.length)
    fail('History records are incomplete.', 'dependency_unavailable', 503);
  const entries = [...keys].reverse().map((key) => json(byKey.get(key).wmkf_assessmentjson, 'History'));
  const safeEntries = entries.map((entry) => {
    if (!entry || !['reveal', 'collective'].includes(entry.kind))
      fail('History contains an unsupported record.', 'dependency_unavailable', 503);
    if (entry.kind === 'reveal') {
      return {
        kind: 'reveal',
        revealId: entry.revealId,
        preparationVersion: entry.preparationVersion,
        individuals: Array.isArray(entry.individuals)
          ? entry.individuals.map(publicIndividual)
          : [],
        baseline: publicBaseline(entry.baseline),
        at: entry.at,
      };
    }
    return {
      kind: 'collective',
      revealId: entry.revealId,
      preparationVersion: entry.preparationVersion,
      collective: publicCollective(entry.collective),
      at: entry.at,
    };
  });
  return {
    entries: safeEntries,
    before: start || null,
    previousRoundId: context.workflow.previousRoundId,
  };
}
export async function mutateWorkflow({ body, actor, isSuperuser = false }) {
  const { action, roundId, operationId } = body;
  if (!WORKFLOW_ACTIONS.includes(action))
    fail('Unsupported workflow action.', 'invalid_request', 400);
  const allowed = [
    'action',
    'roundId',
    'operationId',
    'roundEtag',
    'policyRevision',
    'preparationVersion',
    'revealId',
    'confirmationFingerprint',
    'programKey',
    'assessment',
    'listVersion',
    'order',
    'boundaries',
  ];
  if (Object.keys(body).some((key) => !allowed.includes(key)))
    fail('Unsupported action fields.', 'invalid_request', 400);
  const context = await load(roundId, actor, isSuperuser);
  const { round, snapshot, workflow, state } = context;
  if (context.observer)
    fail('Observers can follow this round but cannot change it.', 'access_denied', 403);
  if (SHARED_ACTIONS.includes(action) && !context.facilitator)
    fail('Only a captured facilitator can perform this action.', 'access_denied', 403);
  const requestHash = hash(body);
  const prior = await receipt(context, operationId);
  if (prior) {
    if (prior.requestHash !== requestHash)
      fail(
        'The operation identifier was used for a different request.',
        'operation_id_reused',
      );
    return publicView(context, {
      operationId,
      status: 'confirmed',
      result: prior.outcome,
    });
  }
  if (round.wmkf_creationoperationid === operationId)
    fail('This operation identifier opened the round.', 'operation_id_reused');
  if (round.wmkf_state !== 100000000 || workflow.supersededBy)
    fail('This round is read-only.', 'round_closed');
  if (
    body.roundEtag !== round['@odata.etag'] ||
    body.policyRevision !== Number(round.wmkf_policyrevision)
  )
    fail('The saved round changed. Refresh before continuing.', 'stale_scope');
  if (
    CONFIRMED_ACTIONS.includes(action) &&
    body.confirmationFingerprint !==
      token(
        round,
        workflow,
        actor,
        action,
        action === 'resetProgram' ? body.programKey : null,
      )
  )
    fail(
      'Review the current reset or reveal confirmation.',
      'confirmation_stale',
    );
  const now = new Date().toISOString();
  const result = transitionWorkflow({
    state,
    snapshot,
    actorId: actor,
    facilitatorIds: workflow.facilitation.systemUserIds,
    action,
    payload: body,
    operationId,
    now,
  });
  let nextWorkflow = {
    ...workflow,
    preparationVersion: result.state.preparationVersion,
    stage: result.state.stage,
    revealId: result.state.revealId,
  };
  const creates = [];
  const updates = [];
  const add = (key, value, program = 'co', owner = null, id = roundId) =>
    creates.push(
      record(id, key, value, actor, operationId, now, program, owner),
    );
  const update = (key, value) => {
    const row = context.byKey.get(key);
    updates.push({
      row,
      patch: {
        wmkf_assessmentjson: JSON.stringify(value),
        wmkf_orderjson: JSON.stringify(value?.order || []),
        wmkf_version: value?.version || Number(row.wmkf_version) + 1,
        ...stamp(actor, operationId, action, now),
      },
    });
  };
  for (const archive of result.archives) {
    nextWorkflow.historyCount += 1;
    add(`h:${nextWorkflow.historyCount}`, archive);
    if (archive.kind === 'reveal') add(`r:${archive.revealId}`, archive);
  }
  let newRound = null;
  let coordinator = null;
  let coordinatorPatch = null;
  const newRoundId = result.restart ? randomUUID() : null;
  if (result.restart) {
    coordinator = await findCycleCoordinator(snapshot.cycleCode);
    if (coordinator?.wmkf_activeroundid !== roundId)
      fail('The active round changed.', 'stale_coordinator');
    const initial = makeInitialWorkflowRecords(
      snapshot,
      newRoundId,
      actor,
      operationId,
      now,
      workflow.facilitation,
    );
    creates.push(...initial.lists);
    newRound = {
      wmkf_proposalrankingroundid: newRoundId,
      wmkf_name: `${snapshot.cycleCode} Ranking walkthrough`,
      wmkf_cyclecode: snapshot.cycleCode,
      wmkf_creationoperationid: operationId,
      wmkf_snapshotjson: JSON.stringify({ ...snapshot, openedAt: now }),
      wmkf_workflowjson: JSON.stringify({
        ...initial.workflow,
        previousRoundId: roundId,
      }),
      wmkf_facilitatorsystemuserid: workflow.facilitation.systemUserIds[0],
      wmkf_policyrevision: 1,
      wmkf_state: 100000000,
      wmkf_administrationlogjson: '[]',
      wmkf_createdbyactorsystemuserid: actor,
      wmkf_createdat: now,
      ...stamp(actor, operationId, action, now),
    };
    coordinatorPatch = {
      wmkf_activeroundid: newRoundId,
      wmkf_version: Number(coordinator.wmkf_version) + 1,
    };
    // Keep the old active pointers intact for read-only inspection of the old run.
    nextWorkflow = {
      ...workflow,
      historyCount: nextWorkflow.historyCount,
      supersededBy: newRoundId,
    };
  } else {
    for (const [id, person] of Object.entries(result.state.participants)) {
      for (const program of ['se', 'mr', 'co']) {
        const value =
          program === 'co' && person.co
            ? { ...person.co, ready: person.ready }
            : person[program];
        const key = pdKey(result.state.preparationVersion, program, id);
        if (result.state.preparationVersion !== state.preparationVersion)
          add(key, value, program, id);
        else {
          const old =
            program === 'co' && state.participants[id].co
              ? {
                  ...state.participants[id].co,
                  ready: state.participants[id].ready,
                }
              : state.participants[id][program];
          if (JSON.stringify(value) !== JSON.stringify(old)) update(key, value);
        }
      }
    }
    if (result.state.collective) {
      const { order, boundaries, version } = result.state.collective;
      const value = { order, boundaries, version };
      if (result.state.revealId !== state.revealId)
        add(`g:${result.state.revealId}`, value);
      else if (
        JSON.stringify(result.state.collective) !==
        JSON.stringify(state.collective)
      )
        update(`g:${state.revealId}`, value);
    }
  }
  const outcome = {
    action,
    roundId: newRoundId || roundId,
    preparationVersion: result.state.preparationVersion,
    revealId: result.state.revealId,
    at: now,
  };
  add(`o:${operationId}`, { actor, requestHash, outcome });
  const roundPatch = {
    wmkf_workflowjson: JSON.stringify(nextWorkflow),
    ...stamp(actor, operationId, action, now),
    ...(result.restart ? { wmkf_state: 100000001 } : {}),
  };
  try {
    await commitAssessmentChanges({
      round,
      roundPatch,
      creates,
      updates,
      newRound,
      coordinator,
      coordinatorPatch,
    });
  } catch (writeError) {
    const found = await receipt(context, operationId).catch(() => null);
    if (!found || found.requestHash !== requestHash) {
      if (Number(writeError.status) === 412)
        fail(
          'Another save or reset won. Refresh before trying again.',
          'conflict',
        );
      if (Number(writeError.status) >= 400 && Number(writeError.status) < 500)
        throw writeError;
      throw Object.assign(
        workflowError(
          'The operation outcome is uncertain. Check its status before retrying.',
          'uncertain_outcome',
        ),
        { retryable: true },
      );
    }
  }
  return readWorkflowRound({
    roundId: newRoundId || roundId,
    actor,
    isSuperuser,
  }).then((response) => ({
    ...response,
    operation: { operationId, status: 'confirmed', result: outcome },
  }));
}

/** Optional context and workbook use one authorized, saved reveal scope. */
export async function readWorkflowSupplement({
  body,
  actor,
  isSuperuser = false,
  profileId,
}) {
  const allowed = [
    'action',
    'roundId',
    'roundEtag',
    'preparationVersion',
    'revealId',
    'listVersion',
  ];
  if (Object.keys(body).some((key) => !allowed.includes(key)))
    fail('Unsupported supplement fields.', 'invalid_request', 400);
  const context = await load(body.roundId, actor, isSuperuser);
  const { round, state, workflow, snapshot } = context;
  // Supplements exist only for the active revealed group (checked next),
  // which observers may see; sentiment keeps its own Meeting Tracker check.
  if (
    state.stage !== 'revealed' ||
    !state.collective ||
    round.wmkf_state !== 100000000 ||
    workflow.supersededBy
  )
    fail(
      'Only the active revealed group has this information.',
      'invalid_transition',
    );
  if (
    body.roundEtag !== round['@odata.etag'] ||
    body.revealId !== state.revealId ||
    body.preparationVersion !== state.preparationVersion ||
    body.listVersion !== state.collective.version
  )
    fail(
      'The saved group revision changed. Refresh before continuing.',
      'stale_scope',
    );
  let result;
  if (body.action === 'sentiment') {
    const { getDeliberationSentiments, hasMeetingTrackerAccess } = await import(
      '../post-presentation-materials/discussion-sentiment-reader.js'
    );
    const ids = snapshot.proposals.map((p) => p.requestId);
    let sentiments = {};
    let status = 'available';
    try {
      if (getRankingTestPolicy().enabled) {
        if (!await hasMeetingTrackerAccess(profileId)) {
          status = 'access-denied';
        } else {
          for (const id of ids) {
            const sample = rehearsalPresentation(id);
            if (sample) sentiments[id] = { status: 'current', sample: true, sentiment: sample.discussion };
          }
        }
      } else for (let i = 0; i < ids.length; i += 50)
        Object.assign(
          sentiments,
          await getDeliberationSentiments(ids.slice(i, i + 50), { profileId }),
        );
    } catch (err) {
      sentiments = {};
      status =
        err.code === 'sentiment_read_forbidden'
          ? 'access-denied'
          : 'temporarily-unavailable';
    }
    result = { status, sentiments };
  } else if (body.action === 'exportWorkbook') {
    const { buildRankingWorkbook } = await import('./workbook.js');
    const buffer = await buildRankingWorkbook({
      snapshot,
      collective: state.collective,
      roundId: body.roundId,
      revealId: state.revealId,
      exportedAt: new Date().toISOString(),
    });
    result = {
      filename: `proposal-ranking-${snapshot.cycleCode}-revision-${state.collective.version}.xlsx`,
      base64: buffer.toString('base64'),
    };
  } else fail('Unsupported group supplement.', 'invalid_request', 400);
  const current = await readAssessmentRound(body.roundId);
  if (current['@odata.etag'] !== round['@odata.etag'])
    fail(
      'The group changed while preparing this result. Refresh and try again.',
      'stale_scope',
    );
  return result;
}
