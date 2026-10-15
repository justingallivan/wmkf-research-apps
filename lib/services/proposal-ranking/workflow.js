/**
 * Version-2 transition rules. The service must authorize the actor, bind these
 * changes to current ETags, and commit the complete result in one changeset.
 * This module never mutates its input or performs I/O.
 */
import {
  calculateRevealedAssessment,
  mergeProgramAssessments,
  seedAssessment,
  validateAssessment,
  validBoundaries,
} from './assessments.js';
import { validateCompleteOrder } from './calculations.js';

export function workflowError(
  message,
  code = 'invalid_transition',
  status = 409,
) {
  return Object.assign(new Error(message), {
    code,
    status,
    publicMessage: true,
  });
}
const fail = (message, code, status) => {
  throw workflowError(message, code, status);
};

export function initialPreparation(snapshot, preparationVersion = 1) {
  if (snapshot.version !== 2 || !snapshot.roster.length)
    fail('A version-2 snapshot and participants are required.');
  return {
    preparationVersion,
    stage: 'private',
    revealId: null,
    participants: Object.fromEntries(
      snapshot.roster.map(({ systemUserId }) => [
        systemUserId,
        {
          se: { ...seedAssessment(snapshot.seedOrders.se), version: 1 },
          mr: { ...seedAssessment(snapshot.seedOrders.mr), version: 1 },
          co: null,
          ready: null,
        },
      ]),
    ),
    collective: null,
  };
}

function sourceVersions(participant) {
  return { se: participant.se.version, mr: participant.mr.version };
}
function sourceMatches(participant) {
  return (
    participant.co?.sourceVersions?.se === participant.se.version &&
    participant.co?.sourceVersions?.mr === participant.mr.version
  );
}
export function participantIsReady(participant) {
  return Boolean(
    participant?.co?.confirmed &&
      sourceMatches(participant) &&
      participant.ready?.combinedVersion === participant.co.version,
  );
}
function requirePrivate(state) {
  if (state.stage !== 'private')
    fail('Private preparation is closed. The facilitator must reopen it.');
}
function requireGroup(state) {
  if (state.stage !== 'revealed' || !state.collective || !state.revealId)
    fail(
      'Reveal the individual rankings before working on the collective list.',
    );
}
function requireFacilitator(actorId, facilitatorIds) {
  if (!facilitatorIds.includes(actorId))
    fail('Only the facilitator can perform this action.', 'access_denied', 403);
}
function requireOwn(state, actorId) {
  const participant = Object.hasOwn(state.participants, actorId)
    ? state.participants[actorId]
    : null;
  if (!participant)
    fail(
      'Only a captured participant can edit their preparation.',
      'access_denied',
      403,
    );
  return participant;
}
function requireEditable(participant) {
  if (participant.ready) fail('Reopen your preparation before editing it.');
}

/**
 * Scope must match even for apparently harmless writes. Operation replay is
 * handled by durable service receipts BEFORE this reducer is called.
 * Returned archives must be persisted atomically, not appended to a mutable log.
 */
export function transitionWorkflow({
  state,
  snapshot,
  actorId,
  facilitatorId,
  facilitatorIds,
  action,
  payload = {},
  operationId,
  now,
}) {
  if (snapshot.version !== 2)
    fail('This workflow requires a version-2 round.', 'unsupported_version');
  if (!['private', 'revealed'].includes(state.stage))
    fail('Unknown workflow stage.', 'unsupported_version');
  const facilitators = Array.isArray(facilitatorIds) ? facilitatorIds : [facilitatorId];
  if (
    payload.preparationVersion !== state.preparationVersion ||
    (payload.revealId ?? null) !== state.revealId
  ) {
    fail(
      'The preparation or reveal changed. Refresh before continuing.',
      'stale_scope',
    );
  }
  const next = JSON.parse(JSON.stringify(state));
  const archives = [];
  const allIds = snapshot.proposals.map(({ requestId }) => requestId);
  const ownActions = [
    'saveAssessment',
    'buildCombined',
    'confirmCombined',
    'ready',
    'reopenOwn',
    'resetProgram',
  ];
  if (ownActions.includes(action)) {
    requirePrivate(next);
    const own = requireOwn(next, actorId);
    if (action === 'reopenOwn') {
      own.ready = null;
    } else {
      requireEditable(own);
      if (action === 'saveAssessment') {
        if (!['se', 'mr', 'co'].includes(payload.programKey))
          fail('Unknown preparation list.', 'invalid_request', 400);
        const expected =
          payload.programKey === 'co'
            ? allIds
            : snapshot.seedOrders[payload.programKey];
        if (!validateAssessment(payload.assessment, expected))
          fail(
            'The assessment contains invalid order, separators or confidence.',
            'invalid_assessment',
            400,
          );
        const previous = own[payload.programKey];
        if (!previous || payload.listVersion !== previous.version)
          fail('The individual list changed.', 'stale_list');
        own[payload.programKey] = {
          order: [...payload.assessment.order],
          boundaries: [...payload.assessment.boundaries],
          confidence: { ...payload.assessment.confidence },
          version: previous.version + 1,
          ...(payload.programKey === 'co'
            ? { sourceVersions: previous.sourceVersions, confirmed: false }
            : {}),
        };
        if (own.co) own.co.confirmed = false;
      } else if (action === 'resetProgram') {
        if (!['se', 'mr'].includes(payload.programKey))
          fail('Choose a source program to reset.', 'invalid_request', 400);
        own[payload.programKey] = {
          ...seedAssessment(snapshot.seedOrders[payload.programKey]),
          version: own[payload.programKey].version + 1,
        };
        if (own.co) own.co.confirmed = false;
      } else if (action === 'buildCombined') {
        own.co = {
          ...mergeProgramAssessments(own, snapshot.proposals),
          version: (own.co?.version || 0) + 1,
          sourceVersions: sourceVersions(own),
          confirmed: false,
        };
      } else if (action === 'confirmCombined') {
        if (!sourceMatches(own))
          fail(
            'Your program lists changed. Rebuild the combined list before confirming it.',
            'combined_outdated',
          );
        if (!validateAssessment(own.co, allIds, { complete: true }))
          fail('Answer confidence for every proposal before confirming.');
        own.co.confirmed = true;
      } else if (action === 'ready') {
        if (!own.co) fail('Create your combined list before marking ready.');
        if (!sourceMatches(own))
          fail(
            'Your program lists changed. Rebuild the combined list before marking ready.',
            'combined_outdated',
          );
        if (!validateAssessment(own.co, allIds, { complete: true }))
          fail('Answer confidence for every proposal before marking ready.');
        own.co.confirmed = true;
        own.ready = { combinedVersion: own.co.version, operationId, at: now };
      }
    }
  } else if (action === 'reveal') {
    requireFacilitator(actorId, facilitators);
    requirePrivate(next);
    const individuals = snapshot.roster.map(({ systemUserId, name }) => {
      const participant = next.participants[systemUserId];
      if (!participantIsReady(participant))
        fail(
          'Every Program Director must be ready before reveal.',
          'incomplete_readiness',
        );
      return { systemUserId, name, ...participant.co };
    });
    const baseline = calculateRevealedAssessment(
      individuals,
      snapshot.proposals,
    );
    next.stage = 'revealed';
    next.revealId = operationId;
    next.collective = {
      order: baseline.order,
      boundaries: baseline.boundaries,
      version: 1,
      baseline,
      individuals,
    };
    archives.push({
      kind: 'reveal',
      revealId: operationId,
      preparationVersion: state.preparationVersion,
      individuals,
      baseline,
      at: now,
    });
  } else if (action === 'editCollective') {
    requireGroup(next);
    if (
      !facilitators.includes(actorId) &&
      !snapshot.roster.some((person) => person.systemUserId === actorId)
    )
      fail('You cannot edit this collective list.', 'access_denied', 403);
    if (payload.listVersion !== next.collective.version)
      fail('The collective list changed.', 'stale_list');
    if (
      !validateCompleteOrder(payload.order, allIds) ||
      !validBoundaries(payload.boundaries, allIds.length)
    )
      fail(
        'Invalid collective order or separators.',
        'invalid_assessment',
        400,
      );
    next.collective.order = [...payload.order];
    next.collective.boundaries = [...payload.boundaries];
    next.collective.version += 1;
  } else if (action === 'resetCollective') {
    requireFacilitator(actorId, facilitators);
    requireGroup(next);
    archives.push({
      kind: 'collective',
      revealId: next.revealId,
      preparationVersion: state.preparationVersion,
      collective: next.collective,
      at: now,
    });
    next.collective = {
      ...next.collective,
      order: [...next.collective.baseline.order],
      boundaries: [...next.collective.baseline.boundaries],
      version: next.collective.version + 1,
    };
  } else if (action === 'reopenPreparation') {
    requireFacilitator(actorId, facilitators);
    requireGroup(next);
    archives.push({
      kind: 'collective',
      revealId: next.revealId,
      preparationVersion: state.preparationVersion,
      collective: next.collective,
      at: now,
    });
    next.preparationVersion += 1;
    next.stage = 'private';
    next.revealId = null;
    next.collective = null;
    Object.values(next.participants).forEach((participant) => {
      participant.ready = null;
    });
  } else if (action === 'restartWalkthrough') {
    requireFacilitator(actorId, facilitators);
    if (next.collective)
      archives.push({
        kind: 'collective',
        revealId: next.revealId,
        preparationVersion: state.preparationVersion,
        collective: next.collective,
        at: now,
      });
    // The persistence layer must create a NEW round and supersede the old one.
    return { state: initialPreparation(snapshot), archives, restart: true };
  } else {
    fail('Unsupported workflow action.', 'invalid_request', 400);
  }
  return { state: next, archives, restart: false };
}
