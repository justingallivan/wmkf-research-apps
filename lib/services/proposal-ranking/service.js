import crypto from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { resolveProfileToSystemUser, resolveSystemUserToProfile } from '../dataverse-identity-map.js';
import {
  cancelRoundChangeset,
  eraseDryRunChangeset,
  createRoundAndLists,
  createCombinedMeeting,
  findCycleCoordinator,
  findRoundByCreationOperation,
  listRoundRows,
  makeOpenOperations,
  patchRound,
  patchRoundAndList,
  readRound,
} from '../../dataverse/adapters/proposal-ranking.js';
import { readEnabledProposalRankingStaff } from '../../dataverse/adapters/proposal-ranking-source.js';
import { listAllGrantsForAdmin } from '../app-access-service.js';
import { combineMeetingOrders, calculateComposite, calculateCumulativeTotals, canonicalGuid, validateCompleteOrder } from './calculations.js';
import { buildProposalRankingPreview, assertPreviewCanOpen } from './preview-service.js';
import { readDefaultFacilitator } from './config.js';
import { assertProposalRankingReady } from './readiness.js';

const ROUND_STATE = Object.freeze({ active: 100000000, canceled: 100000001 });
const LIST_STATE = Object.freeze({ draft: 100000000, submitted: 100000001, collecting: 100000002, 'composite-draft': 100000003, published: 100000004 });
const ROUND_STATE_BY_VALUE = new Map(Object.entries(ROUND_STATE).map(([key, value]) => [value, key]));
const LIST_STATE_BY_VALUE = new Map(Object.entries(LIST_STATE).map(([key, value]) => [value, key]));
const PROGRAMS = ['se', 'mr'];
const MAX_ADMIN_LOG_BYTES = 131072;
const ACTION_FIELDS = Object.freeze({
  preview: ['action', 'cycleCode'],
  open: ['action', 'cycleCode', 'previewFingerprint', 'operationId', 'dryRun'],
  read: ['action', 'roundId', 'operationId'],
  save: ['action', 'roundId', 'programKey', 'order', 'etag', 'policyRevision', 'operationId'],
  submit: ['action', 'roundId', 'programKey', 'order', 'etag', 'policyRevision', 'operationId'],
  combine: ['action', 'roundId', 'policyRevision', 'confirmationFingerprint', 'operationId'],
  generate: ['action', 'roundId', 'programKey', 'etag', 'policyRevision', 'confirmationFingerprint', 'operationId'],
  edit: ['action', 'roundId', 'programKey', 'order', 'etag', 'policyRevision', 'operationId'],
  publish: ['action', 'roundId', 'programKey', 'etag', 'policyRevision', 'confirmationFingerprint', 'operationId'],
  transfer: ['action', 'roundId', 'successorSystemUserId', 'policyRevision', 'operationId'],
  resetDryRun: ['action', 'roundId', 'policyRevision', 'confirmationFingerprint', 'operationId'],
  cancel: ['action', 'roundId', 'policyRevision', 'confirmationFingerprint', 'operationId'],
});

function error(message, status = 409, code = 'conflict', current = null, retryable = false) {
  const out = new Error(message);
  out.status = status;
  out.code = code;
  out.current = current;
  out.retryable = retryable;
  out.publicMessage = true;
  return out;
}

function parseJson(raw, label, fallback = null) {
  if (raw == null || raw === '') return fallback;
  try { return typeof raw === 'string' ? JSON.parse(raw) : raw; }
  catch { throw error(`${label} could not be read. Contact an administrator.`, 503, 'dependency_unavailable'); }
}

function guid(value, field) {
  const normalized = canonicalGuid(value);
  if (!normalized) throw error(`${field} must be a valid identifier.`, 400, 'invalid_request');
  return normalized;
}

function stableHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function idempotentRoundState(round, operationId, expectedType = null) {
  const log = parseJson(round.wmkf_administrationlogjson, 'Round administration log', []);
  return (expectedType == null && round.wmkf_creationoperationid === operationId)
    || log.some((event) => event.operationId === operationId && (!expectedType || event.type === expectedType));
}

function appendAdministrationEvent(round, event) {
  const events = parseJson(round.wmkf_administrationlogjson, 'Round administration log', []);
  events.push(event);
  const json = JSON.stringify(events);
  if (Buffer.byteLength(json, 'utf8') > MAX_ADMIN_LOG_BYTES) {
    throw error('The round administration log is full. Contact an administrator.', 409, 'storage_limit');
  }
  return json;
}

function actorPatch(actorSystemUserId, operationId, operationKind, now = new Date().toISOString()) {
  return {
    wmkf_lastoperationid: operationId,
    wmkf_lastoperationkind: operationKind,
    wmkf_updatedbyactorsystemuserid: actorSystemUserId,
    wmkf_updatedat: now,
  };
}

function parseRound(round) {
  const state = ROUND_STATE_BY_VALUE.get(round.wmkf_state);
  if (!state) throw error('The round has an unknown lifecycle state.', 503, 'dependency_unavailable');
  const snapshot = parseJson(round.wmkf_snapshotjson, 'Round snapshot');
  if (!snapshot || snapshot.version !== 1 || !snapshot.proposals || !snapshot.seedOrders || !Array.isArray(snapshot.roster)) {
    throw error('The round snapshot is incomplete. Contact an administrator.', 503, 'dependency_unavailable');
  }
  return { state, snapshot, etag: round['@odata.etag'], policyRevision: Number(round.wmkf_policyrevision) };
}

function parseList(row) {
  const status = LIST_STATE_BY_VALUE.get(row.wmkf_status);
  if (!status) throw error('A proposal list has an unknown lifecycle state.', 503, 'dependency_unavailable');
  const order = parseJson(row.wmkf_orderjson, 'Proposal list order');
  if (!Array.isArray(order)) throw error('A proposal list order is unavailable.', 503, 'dependency_unavailable');
  return { ...row, status, order, etag: row['@odata.etag'] };
}

function listKey(programKey, userId = null) {
  return userId ? `pd:${programKey}:${userId}` : `meeting:${programKey}`;
}

function statusToValue(status) {
  const value = LIST_STATE[status];
  if (!value) throw error('The requested list state is invalid.', 400, 'invalid_request');
  return value;
}

function requestConfirmationToken(round, lists, action, programKey = null) {
  return stableHash({
    roundId: round.wmkf_proposalrankingroundid,
    policyRevision: Number(round.wmkf_policyrevision),
    action,
    ...(['resetDryRun', 'combine'].includes(action) ? { revision: round['@odata.etag'] } : {}),
    programKey,
    lists: lists.map((list) => [list.wmkf_listkey, list.wmkf_status, list.wmkf_submittedoperationid || null]).sort((a, b) => a[0].localeCompare(b[0])),
    facilitator: round.wmkf_facilitatorsystemuserid,
    state: round.wmkf_state,
  });
}

// Retain old snapshots/results for reading, but never publish a new partial-roster composite.
function hasLegacyExcusal(snapshot) {
  return Boolean(snapshot.excusedSystemUserIds?.length || snapshot.roster.some((person) => person.excluded));
}

function requiredParticipantIds(snapshot) {
  const excused = new Set(snapshot.excusedSystemUserIds || []);
  return snapshot.roster.map((person) => person.systemUserId).filter((id) => !excused.has(id));
}

function sortedRowsByKey(rows) { return [...rows].sort((a, b) => a.wmkf_listkey.localeCompare(b.wmkf_listkey)); }

function getListByKey(rows, key) { return rows.find((row) => row.wmkf_listkey === key) || null; }

function emptyProgram() {
  return { proposalIds: [], progress: { required: 0, submitted: 0, outstandingNames: [] }, ownList: null, facilitatorLists: null, meeting: null, meetingStatus: null };
}

function progressFor(snapshot, rows, programKey, namesById) {
  if (!snapshot.seedOrders[programKey]?.length) return { required: 0, submitted: 0, outstandingNames: [] };
  const excused = new Set(snapshot.excusedSystemUserIds || []);
  const required = requiredParticipantIds(snapshot);
  const submitted = required.filter((id) => getListByKey(rows, listKey(programKey, id))?.status === 'submitted');
  return {
    required: required.length,
    submitted: submitted.length,
    outstandingNames: required.filter((id) => !submitted.includes(id)).map((id) => namesById.get(id) || 'Program Director'),
  };
}

function buildCompositePayload(composite, submissions, snapshot, programKey, operationId, actorSystemUserId, now) {
  const namesById = new Map(snapshot.roster.map((person) => [person.systemUserId, person.name]));
  const tieCounts = new Map();
  for (const score of Object.values(composite.scores)) tieCounts.set(score.rankSum, (tieCounts.get(score.rankSum) || 0) + 1);
  const ranks = [];
  const proposalIds = snapshot.seedOrders[programKey];
  for (const requestId of proposalIds) {
    const participants = submissions.map((submission) => ({
      systemUserId: submission.ownerSystemUserId,
      name: namesById.get(submission.ownerSystemUserId) || 'Program Director',
      rank: submission.order.indexOf(requestId) + 1,
    }));
    const range = composite.ranges[requestId];
    ranks.push({
      requestId,
      participants,
      minRank: range.min,
      maxRank: range.max,
      disagreement: range.disagreement,
    });
  }
  return {
    generationOperationId: operationId,
    generatedBySystemUserId: actorSystemUserId,
    generatedAt: now,
    programKey,
    sourceSubmissionIds: submissions.map((submission) => submission.wmkf_proposalrankinglistid),
    baselineOrder: composite.order,
    scores: Object.fromEntries(Object.entries(composite.scores).map(([requestId, score]) => [requestId, {
      ...score,
      tied: tieCounts.get(score.rankSum) > 1,
    }])),
    ranks,
  };
}

async function readCurrentActor(profileId) {
  if (profileId == null) throw error('A linked staff identity is required for Proposal Ranking.', 403, 'access_denied');
  const user = await resolveProfileToSystemUser(profileId);
  const systemUserId = canonicalGuid(user?.systemuserid);
  if (!systemUserId) throw error('Your Dynamics staff identity is unavailable. Contact an administrator.', 503, 'dependency_unavailable');
  return systemUserId;
}

function emptyResponse({ mode, cycleCode, viewer, roundId = null, round = null, preview = null, programs = null, operation = null, confirmations = null }) {
  return {
    mode, cycleCode, roundId,
    viewer,
    round,
    preview,
    confirmations: confirmations || { generate: { se: null, mr: null }, publish: { se: null, mr: null }, excuse: null, cancel: null, resetDryRun: null },
    programs: programs || { se: emptyProgram(), mr: emptyProgram() },
    operation,
  };
}

function transferAcknowledgement(roundRow, actorSystemUserId, isSuperuser, operationId, status = 'confirmed') {
  const snapshot = parseRound(roundRow).snapshot;
  return emptyResponse({
    mode: 'waiting',
    cycleCode: snapshot.cycleCode,
    roundId: roundRow.wmkf_proposalrankingroundid,
    viewer: {
      systemUserId: actorSystemUserId,
      isFacilitator: false,
      isSuperuser,
      isRosterParticipant: snapshot.roster.some((person) => person.systemUserId === actorSystemUserId),
      capabilities: {},
    },
    operation: { operationId, status, result: 'facilitator-transferred' },
  });
}

async function buildRoundResponse({ roundRow, listRows, actorSystemUserId, isSuperuser, operation = null }) {
  const roundData = parseRound(roundRow);
  const snapshot = roundData.snapshot;
  const rows = listRows.map(parseList);
  const facilitatorId = canonicalGuid(roundRow.wmkf_facilitatorsystemuserid);
  const isFacilitator = actorSystemUserId === facilitatorId;
  const rosterById = new Map(snapshot.roster.map((person) => [person.systemUserId, person]));
  const isRosterParticipant = rosterById.has(actorSystemUserId);
  const actorIsMember = isRosterParticipant;
  const namesById = new Map(snapshot.roster.map((person) => [person.systemUserId, person.name]));
  const proposalById = new Map(snapshot.proposals.map((proposal) => [proposal.requestId, {
    ...proposal,
    currencyCode: proposal.currency?.code || null,
  }]));
  const programs = { se: emptyProgram(), mr: emptyProgram() };
  for (const programKey of [...PROGRAMS, 'co']) {
    const proposalIds = programKey === 'co' ? PROGRAMS.flatMap((key) => snapshot.seedOrders[key] || []) : snapshot.seedOrders[programKey] || [];
    const meeting = getListByKey(rows, listKey(programKey));
    const meetingStatus = meeting?.status || null;
    const progress = progressFor(snapshot, rows, programKey, namesById);
    const own = isRosterParticipant ? getListByKey(rows, listKey(programKey, actorSystemUserId)) : null;
    const visibleMeeting = meeting && (
      (meetingStatus === 'published' && (isRosterParticipant || isFacilitator))
      || (meetingStatus !== 'published' && isFacilitator)
    );
    const privateLists = isFacilitator
      ? rows.filter((list) => list.wmkf_programkey === programKey && list.wmkf_participantsystemuserid)
      : null;
    const serializeList = (list, includeComposite = false) => {
      const totals = calculateCumulativeTotals(list.order, proposalById);
      const ownerId = canonicalGuid(list.wmkf_participantsystemuserid);
      const compositeRaw = includeComposite ? parseJson(list.wmkf_compositejson, 'Program composite') : null;
      return {
        listKey: list.wmkf_listkey,
        programKey,
        owner: ownerId ? { systemUserId: ownerId, name: namesById.get(ownerId) || '' } : null,
        status: list.status,
        order: list.order,
        etag: list.etag,
        version: Number(list.wmkf_version),
        updatedAt: list.wmkf_updatedat,
        totals,
        ...(includeComposite ? { composite: compositeRaw } : {}),
      };
    };
    programs[programKey] = {
      ...(programKey === 'co' ? { available: (isFacilitator || isRosterParticipant) && combinedSourcesReady(snapshot, rows) } : {}),
      proposalIds,
      progress: { required: progress.required, submitted: progress.submitted, outstandingNames: isFacilitator ? progress.outstandingNames : [] },
      ownList: own ? serializeList(own, false) : null,
      facilitatorLists: privateLists ? privateLists.map((list) => serializeList(list, false)) : null,
      meeting: visibleMeeting ? serializeList(meeting, meetingStatus === 'composite-draft' || meetingStatus === 'published') : null,
      meetingStatus: isFacilitator ? meetingStatus : (meetingStatus === 'published' ? 'published' : null),
    };
  }

  const roundView = {
    etag: roundData.etag,
    policyRevision: roundData.policyRevision,
    state: roundData.state,
    dryRun: snapshot.dryRun === true,
    erased: snapshot.erased === true,
    facilitator: { systemUserId: facilitatorId, name: namesById.get(facilitatorId) || '' },
    snapshot: {
      proposals: snapshot.proposals,
      seedOrders: snapshot.seedOrders,
      roster: snapshot.roster.map((person) => ({
        ...person,
        excluded: person.excluded === true || (snapshot.excusedSystemUserIds || []).includes(person.systemUserId),
      })),
    },
  };
  // A superuser outside the captured roster may inspect lifecycle metadata, but
  // gets no proposal order or individual-list contents.
  if (isSuperuser && !actorIsMember && !isFacilitator) {
    roundView.snapshot = { proposals: [], seedOrders: { se: [], mr: [] }, roster: snapshot.roster.map(({ systemUserId, name, excluded }) => ({ systemUserId, name, excluded })) };
    for (const programKey of [...PROGRAMS, 'co']) programs[programKey].proposalIds = [];
  }
  const lists = rows;
  const confirmations = { generate: { se: null, mr: null }, publish: { se: null, mr: null }, excuse: null, cancel: null, resetDryRun: null };
  if (isFacilitator && roundData.state === 'active') {
    for (const programKey of PROGRAMS) {
      const meeting = getListByKey(rows, listKey(programKey));
      if (!meeting) continue;
      const outstandingNames = PROGRAMS.flatMap((key) => progressFor(snapshot, rows, key, namesById).outstandingNames);
      if (!hasLegacyExcusal(snapshot) && meeting.status === 'collecting' && progressFor(snapshot, rows, programKey, namesById).submitted === progressFor(snapshot, rows, programKey, namesById).required) {
        confirmations.generate[programKey] = {
          fingerprint: requestConfirmationToken(roundRow, lists, 'generate', programKey),
          message: `Generate the ${programKey.toUpperCase()} composite from every participant’s submitted ranking.`,
          outstandingNames: [...new Set(outstandingNames)],
        };
      }
      if (!hasLegacyExcusal(snapshot) && meeting.status === 'composite-draft') {
        const otherOutstanding = PROGRAMS.filter((key) => key !== programKey)
          .flatMap((key) => progressFor(snapshot, rows, key, namesById).outstandingNames);
        confirmations.publish[programKey] = {
          fingerprint: requestConfirmationToken(roundRow, lists, 'publish', programKey),
          message: snapshot.dryRun === true ? `Publish the ${programKey.toUpperCase()} dry-run order. This dry run can still be erased.` : `Publishing ${programKey.toUpperCase()} ends cancellation for this round.`,
          outstandingNames: [...new Set(otherOutstanding)],
        };
      }
    }
    if (!hasLegacyExcusal(snapshot) && combinedSourcesReady(snapshot, rows) && !getListByKey(rows, listKey('co'))) {
      confirmations.generate.co = { fingerprint: requestConfirmationToken(roundRow, lists, 'combine'), message: 'Create a shared combined meeting list from the current SE and MR orders. Later edits to either program will not change this combined list.' };
    }
    if (snapshot.dryRun === true) {
      confirmations.resetDryRun = { fingerprint: requestConfirmationToken(roundRow, lists, 'resetDryRun'), message: 'Permanently erase all rankings, submissions, composites and meeting edits in this dry run. Source proposals and external-review scores are preserved.' };
    }
    if (snapshot.dryRun !== true && !rows.some((row) => row.status === 'published')) {
      confirmations.cancel = { fingerprint: requestConfirmationToken(roundRow, lists, 'cancel'), message: 'Canceling keeps this round read-only. A replacement round will use a fresh source snapshot.' };
    }
  }
  const capabilities = {
    preview: isFacilitator,
    open: false,
    saveOwnList: roundData.state === 'active' && isRosterParticipant && !new Set(snapshot.excusedSystemUserIds || []).has(actorSystemUserId),
    submitOwnList: roundData.state === 'active' && isRosterParticipant && !new Set(snapshot.excusedSystemUserIds || []).has(actorSystemUserId),
    generate: isFacilitator && Boolean(confirmations.generate.se || confirmations.generate.mr || confirmations.generate.co),
    editMeetingOrder: roundData.state === 'active' && (isFacilitator || (isRosterParticipant && Object.values(programs).some((program) => program.meeting?.status === 'published'))),
    publish: isFacilitator && Boolean(confirmations.publish.se || confirmations.publish.mr),
    transferFacilitator: roundData.state === 'active' && (isFacilitator || isSuperuser),
    excuseParticipant: false,
    resetDryRun: isFacilitator && Boolean(confirmations.resetDryRun),
    cancelRound: isFacilitator && Boolean(confirmations.cancel),
  };
  const response = emptyResponse({
    mode: 'round',
    cycleCode: snapshot.cycleCode,
    roundId: roundRow.wmkf_proposalrankingroundid,
    viewer: { systemUserId: actorSystemUserId, isFacilitator, isSuperuser, isRosterParticipant, capabilities },
    round: roundView,
    programs,
    operation,
    confirmations,
  });
  return response;
}

async function getRoundResponse(roundId, actorSystemUserId, isSuperuser, operationId = null) {
  const round = await readRound(roundId);
  const listRows = await listRoundRows(roundId);
  const roundSnapshot = parseRound(round).snapshot;
  const actorIsRosterParticipant = roundSnapshot.roster.some((person) => person.systemUserId === actorSystemUserId);
  const actorIsCurrentFacilitator = canonicalGuid(round.wmkf_facilitatorsystemuserid) === actorSystemUserId;
  if (!actorIsRosterParticipant && !actorIsCurrentFacilitator && !isSuperuser) {
    throw error('You are not a participant or current facilitator for this round.', 403, 'access_denied');
  }
  if (round.wmkf_state === ROUND_STATE.canceled) {
    const response = await buildRoundResponse({ roundRow: round, listRows, actorSystemUserId, isSuperuser });
    if (operationId) {
      const erasedByThisOperation = idempotentRoundState(round, operationId, 'dry-run-erased');
      const canceledByThisOperation = idempotentRoundState(round, operationId, 'round-canceled');
      response.operation = {
        operationId,
        status: erasedByThisOperation || canceledByThisOperation || listRows.some((row) => persistedListOperationMatches(row, operationId)) ? 'confirmed' : 'superseded',
        result: erasedByThisOperation ? 'dry-run-erased' : canceledByThisOperation ? 'round-canceled' : 'readback',
      };
    }
    return response;
  }
  const response = await buildRoundResponse({ roundRow: round, listRows, actorSystemUserId, isSuperuser });
  if (operationId) {
    const matched = idempotentRoundState(round, operationId) || listRows.some((row) => persistedListOperationMatches(row, operationId));
    response.operation = { operationId, status: matched ? 'confirmed' : 'superseded', result: 'readback' };
  }
  return response;
}

function verifyRoundEditable(roundRow, policyRevision) {
  const parsed = parseRound(roundRow);
  if (parsed.state !== 'active') throw error('This round is read-only.', 409, 'round_closed');
  if (!Number.isInteger(policyRevision) || policyRevision !== parsed.policyRevision) throw error('The round policy changed. Refresh before continuing.', 409, 'stale_policy');
  return parsed;
}

function verifyListOrder(order, programKey, snapshot, meeting = false) {
  if (!PROGRAMS.includes(programKey) && !(meeting && programKey === 'co')) throw error('Choose Science and Engineering or Medical Research.', 400, 'invalid_request');
  const expected = programKey === 'co' ? PROGRAMS.flatMap((key) => snapshot.seedOrders[key] || []) : snapshot.seedOrders[programKey] || [];
  if (!validateCompleteOrder(order, expected)) throw error('The proposal order must contain every proposal exactly once.', 400, 'invalid_order');
}

function verifyEtag(row, supplied, label) {
  if (!supplied || supplied !== row?.['@odata.etag']) throw error(`${label} changed. Refresh before continuing.`, 409, 'stale_list');
}

function ensureActorOwnsList(list, actorSystemUserId, snapshot) {
  if (!snapshot.roster.some((person) => person.systemUserId === actorSystemUserId)
    || list.wmkf_participantsystemuserid !== actorSystemUserId) throw error('You can only change your own private ranking.', 403, 'access_denied');
  if ((snapshot.excusedSystemUserIds || []).includes(actorSystemUserId)) throw error('This ranking was locked when the participant was excused.', 403, 'access_denied');
}

function verifyTerminalOperation(row, storedOperationId, requestedOperationId, action) {
  if (storedOperationId === requestedOperationId) return true;
  if (row.wmkf_status === statusToValue('submitted') || row.wmkf_status === statusToValue('published') || row.wmkf_status === statusToValue('composite-draft')) {
    throw error(`This ${action} transition has already completed. Refresh the current round.`, 409, 'already_completed');
  }
  return false;
}

async function afterMutation(roundId, operationId, actorSystemUserId, isSuperuser, initialError = null, knownCommitted = false) {
  const response = await getRoundResponse(roundId, actorSystemUserId, isSuperuser, operationId);
  if (knownCommitted) {
    response.operation = { operationId, status: 'confirmed', result: response.operation?.result || 'committed' };
    return response;
  }
  if (response.operation.status === 'confirmed') return response;
  if (Number(initialError?.status) === 412) {
    throw error('The round changed while saving. Review the current round and retry.', 409, 'conflict', response);
  }
  if (initialError && Number(initialError.status) >= 400 && Number(initialError.status) < 500) throw initialError;
  throw error('The save outcome is uncertain. Refresh this round before trying again.', 409, 'uncertain_outcome', response, true);
}

async function commitMutation(roundRow, listRow, roundPatch, listPatch, roundId, operationId, actorSystemUserId, isSuperuser) {
  try {
    await patchRoundAndList(roundRow, listRow, roundPatch, listPatch);
  } catch (writeError) {
    return afterMutation(roundId, operationId, actorSystemUserId, isSuperuser, writeError);
  }
  return afterMutation(roundId, operationId, actorSystemUserId, isSuperuser, null, true);
}

function currentOperationMatches(list, operationId, expectedKind) {
  if (list?.wmkf_lastoperationid === operationId && list?.wmkf_lastoperationkind === expectedKind) return true;
  if (list?.wmkf_submittedoperationid === operationId && expectedKind === 'submit') return true;
  if (list?.wmkf_publishedoperationid === operationId && expectedKind === 'publish') return true;
  if (list?.wmkf_compositejson) {
    const composite = parseJson(list.wmkf_compositejson, 'Program composite');
    if (composite?.generationOperationId === operationId && expectedKind === (list.wmkf_programkey === 'co' ? 'combine' : 'generate')) return true;
  }
  return false;
}

function persistedListOperationMatches(list, operationId) {
  if (list?.wmkf_lastoperationid === operationId || list?.wmkf_submittedoperationid === operationId || list?.wmkf_publishedoperationid === operationId) return true;
  return Boolean(list?.wmkf_compositejson
    && parseJson(list.wmkf_compositejson, 'Program composite')?.generationOperationId === operationId);
}

function assertOperationKindAvailable(round, rows, operationId, expectedKind, targetListKey = null) {
  if (round.wmkf_creationoperationid === operationId && expectedKind !== 'open') {
    throw error('This operation identifier was already used to open the round.', 409, 'operation_id_reused');
  }
  if (round.wmkf_lastoperationid === operationId && round.wmkf_lastoperationkind && round.wmkf_lastoperationkind !== expectedKind) {
    throw error('This operation identifier was already used for a different action.', 409, 'operation_id_reused');
  }
  for (const row of rows) {
    const kind = row.wmkf_lastoperationid === operationId ? row.wmkf_lastoperationkind : null;
    const terminalKind = row.wmkf_submittedoperationid === operationId ? 'submit'
      : row.wmkf_publishedoperationid === operationId ? (row.wmkf_programkey === 'co' ? 'combine' : 'publish')
        : null;
    const composite = row.wmkf_compositejson ? parseJson(row.wmkf_compositejson, 'Program composite') : null;
    const storedKind = kind || terminalKind || (composite?.generationOperationId === operationId ? (row.wmkf_programkey === 'co' ? 'combine' : 'generate') : null);
    if (storedKind && (storedKind !== expectedKind || (targetListKey && row.wmkf_listkey !== targetListKey))) {
      throw error('This operation identifier was already used for a different action.', 409, 'operation_id_reused');
    }
  }
  const events = parseJson(round.wmkf_administrationlogjson, 'Round administration log', []);
  const expectedEvent = { transfer: 'facilitator-transferred', excuse: 'participant-excused', cancel: 'round-canceled', resetDryRun: 'dry-run-erased' }[expectedKind];
  if (events.some((event) => event.operationId === operationId && event.type !== expectedEvent)) {
    throw error('This operation identifier was already used for a different action.', 409, 'operation_id_reused');
  }
}

async function openRound({ cycleCode, previewFingerprint, operationId, actorSystemUserId, isSuperuser, dryRun = false }) {
  assertProposalRankingReady();
  if (typeof dryRun !== 'boolean') throw error('Dry run must be true or false.', 400, 'invalid_request');
  const canonicalOperationId = guid(operationId, 'Operation');
  if (canonicalOperationId !== operationId) throw error('Operation must be a canonical identifier.', 400, 'invalid_request');
  const existingByOperation = await findRoundByCreationOperation(operationId);
  if (existingByOperation && (parseRound(existingByOperation).snapshot.dryRun === true) !== dryRun) throw error('This opening operation used a different round mode.', 409, 'operation_id_reused');
  if (existingByOperation) return getRoundResponse(existingByOperation.wmkf_proposalrankingroundid, actorSystemUserId, isSuperuser, operationId);
  const preview = await buildProposalRankingPreview(cycleCode);
  if (preview.facilitatorSystemUserId !== actorSystemUserId) throw error('Only the configured facilitator can open this round.', 403, 'access_denied');
  if (preview.previewFingerprint !== previewFingerprint) {
    throw error('The proposal preview changed. Review the new snapshot before opening the round.', 409, 'preview_changed', emptyResponse({
      mode: 'preview', cycleCode, preview: {
        proposals: preview.proposals,
        seedOrders: preview.seedOrders,
        roster: preview.roster,
        outstandingReviewCount: preview.outstandingReviewCount,
        unexpectedStatuses: preview.unexpectedStatuses,
        warnings: preview.warnings,
        canOpen: preview.canOpen,
        previewFingerprint: preview.previewFingerprint,
      },
      viewer: { systemUserId: actorSystemUserId, isFacilitator: true, isSuperuser, isRosterParticipant: false, capabilities: {} },
    }));
  }
  assertPreviewCanOpen(preview);

  const coordinator = await findCycleCoordinator(cycleCode);
  if (coordinator?.wmkf_activeroundid) {
    const activeRound = await readRound(coordinator.wmkf_activeroundid).catch(() => null);
    if (activeRound && activeRound.wmkf_state === ROUND_STATE.active) {
      throw error('This cycle already has an active Proposal Ranking round.', 409, 'active_round_exists', await getRoundResponse(activeRound.wmkf_proposalrankingroundid, actorSystemUserId, isSuperuser));
    }
    throw error('The cycle coordinator points to an unavailable round. Ask an administrator to resolve the pointer.', 503, 'dependency_unavailable');
  }

  const roundId = randomUUID().toLowerCase();
  const now = new Date().toISOString();
  const snapshot = { ...preview.snapshot, dryRun, facilitatorSystemUserId: preview.facilitatorSystemUserId, openedAt: now, excusedSystemUserIds: [] };
  const proposalsByProgram = {
    se: preview.seedOrders.se,
    mr: preview.seedOrders.mr,
  };
  const lists = [];
  for (const programKey of PROGRAMS) {
    const proposalIds = proposalsByProgram[programKey];
    if (!proposalIds.length) continue;
    for (const participant of snapshot.roster) {
      const id = randomUUID().toLowerCase();
      const key = listKey(programKey, participant.systemUserId);
      const row = {
        wmkf_proposalrankinglistid: id,
        wmkf_name: `${cycleCode} ${programKey.toUpperCase()} ${participant.name}`.slice(0, 200),
        wmkf_roundid: roundId,
        wmkf_listkey: key,
        wmkf_programkey: programKey,
        wmkf_participantsystemuserid: participant.systemUserId,
        wmkf_orderjson: JSON.stringify(proposalIds),
        wmkf_status: statusToValue('draft'),
        wmkf_version: 1,
        wmkf_lastoperationid: operationId,
        wmkf_lastoperationkind: 'open',
        wmkf_updatedbyactorsystemuserid: actorSystemUserId,
        wmkf_updatedat: now,
      };
      if (Buffer.byteLength(row.wmkf_orderjson, 'utf8') > 65536) throw error('A proposal list exceeds the storage limit.', 409, 'storage_limit');
      lists.push(row);
    }
    lists.push({
      wmkf_proposalrankinglistid: randomUUID().toLowerCase(),
      wmkf_name: `${cycleCode} ${programKey.toUpperCase()} meeting order`,
      wmkf_roundid: roundId,
      wmkf_listkey: listKey(programKey),
      wmkf_programkey: programKey,
      wmkf_orderjson: JSON.stringify(proposalIds),
      wmkf_status: statusToValue('collecting'),
      wmkf_version: 1,
      wmkf_lastoperationid: operationId,
      wmkf_lastoperationkind: 'open',
      wmkf_updatedbyactorsystemuserid: actorSystemUserId,
      wmkf_updatedat: now,
    });
  }
  const roundRow = {
    wmkf_proposalrankingroundid: roundId,
    wmkf_name: `${cycleCode} Proposal Ranking ${operationId}`.slice(0, 200),
    wmkf_cyclecode: cycleCode,
    wmkf_creationoperationid: operationId,
    wmkf_snapshotjson: JSON.stringify(snapshot),
    wmkf_facilitatorsystemuserid: actorSystemUserId,
    wmkf_policyrevision: 1,
    wmkf_state: ROUND_STATE.active,
    wmkf_administrationlogjson: '[]',
    wmkf_lastoperationid: operationId,
    wmkf_lastoperationkind: 'open',
    wmkf_createdbyactorsystemuserid: actorSystemUserId,
    wmkf_createdat: now,
    wmkf_updatedbyactorsystemuserid: actorSystemUserId,
    wmkf_updatedat: now,
  };
  const roundBytes = Buffer.byteLength(roundRow.wmkf_snapshotjson, 'utf8');
  if (roundBytes > 524288) throw error('The round snapshot exceeds the storage limit.', 409, 'storage_limit');
  const coordinatorPayload = coordinator
    ? {
      existing: true,
      id: coordinator.wmkf_proposalrankingcycleid,
      etag: coordinator['@odata.etag'],
      patch: { wmkf_activeroundid: roundId, wmkf_version: Number(coordinator.wmkf_version || 0) + 1 },
    }
    : {
      existing: false,
      create: {
        wmkf_proposalrankingcycleid: randomUUID().toLowerCase(),
        wmkf_name: cycleCode,
        wmkf_cyclecode: cycleCode,
        wmkf_activeroundid: roundId,
        wmkf_version: 1,
      },
    };
  const operations = makeOpenOperations({ coordinator: coordinatorPayload, round: roundRow, lists });
  try {
    await createRoundAndLists(operations);
  } catch (writeError) {
    const uncertain = writeError?.noResponse === true || writeError?.status == null || writeError?.status >= 500
      || /could not confirm an atomic commit/i.test(writeError?.message || '');
    const duplicateKey = writeError?.dataverseCode === '0x80040237'
      || /duplicate|alternate key|unique key|unique constraint/i.test(`${writeError?.dataverseMessage || ''} ${writeError?.message || ''}`);
    const concurrentConflict = writeError?.status === 412 || (writeError?.status === 409 && duplicateKey);
    if (!uncertain && !concurrentConflict) throw writeError;
    let createdByOperation = null;
    try { createdByOperation = await findRoundByCreationOperation(operationId); } catch { /* Retry with the same operation ID performs this lookup again. */ }
    if (createdByOperation) return getRoundResponse(createdByOperation.wmkf_proposalrankingroundid, actorSystemUserId, isSuperuser, operationId);
    let latestCoordinator = null;
    try { latestCoordinator = await findCycleCoordinator(cycleCode); } catch { /* Keep the write classification below. */ }
    if (latestCoordinator?.wmkf_activeroundid) {
      const winner = await readRound(latestCoordinator.wmkf_activeroundid).catch(() => null);
      if (winner && winner.wmkf_state === ROUND_STATE.active) {
        throw error('Another facilitator opened this cycle first. Review the active round.', 409, 'active_round_exists', await getRoundResponse(winner.wmkf_proposalrankingroundid, actorSystemUserId, isSuperuser));
      }
    }
    if (uncertain) {
      const current = emptyResponse({
        mode: 'waiting', cycleCode, roundId: null,
        viewer: { systemUserId: actorSystemUserId, isFacilitator: true, isSuperuser, isRosterParticipant: false, capabilities: { preview: true, open: false } },
        operation: { operationId, status: 'uncertain', result: 'open' },
      });
      throw error('The round opening outcome is uncertain. Retry with the same operation identifier to resolve it.', 409, 'uncertain_outcome', current, true);
    }
    throw error('The cycle changed while the round was opening. Refresh the preview and retry.', 409, 'open_conflict');
  }
  return getRoundResponse(roundId, actorSystemUserId, isSuperuser, operationId);
}

async function previewResponse(cycleCode, actorSystemUserId, isSuperuser) {
  assertProposalRankingReady();
  const defaultConfig = await readDefaultFacilitator();
  if (defaultConfig.systemUserId !== actorSystemUserId) {
    throw error('Only the configured facilitator can preview a cycle before opening it.', 403, 'access_denied');
  }
  const preview = await buildProposalRankingPreview(cycleCode);
  return emptyResponse({
    mode: 'preview',
    cycleCode,
    viewer: {
      systemUserId: actorSystemUserId,
      isFacilitator: defaultConfig.systemUserId === actorSystemUserId,
      isSuperuser,
      isRosterParticipant: false,
      capabilities: { preview: true, open: preview.canOpen, saveOwnList: false, submitOwnList: false, generate: false, editMeetingOrder: false, publish: false, transferFacilitator: false, excuseParticipant: false, cancelRound: false },
    },
    preview: {
      proposals: preview.proposals,
      seedOrders: preview.seedOrders,
      roster: preview.roster,
      outstandingReviewCount: preview.outstandingReviewCount,
      unexpectedStatuses: preview.unexpectedStatuses,
      warnings: preview.warnings,
      canOpen: preview.canOpen,
      previewFingerprint: preview.previewFingerprint,
    },
  });
}

async function readByCycleOrWait(cycleCode, actorSystemUserId, isSuperuser) {
  assertProposalRankingReady();
  const coordinator = await findCycleCoordinator(cycleCode);
  if (coordinator?.wmkf_activeroundid) {
    return getRoundResponse(coordinator.wmkf_activeroundid, actorSystemUserId, isSuperuser);
  }
  const defaultConfig = await readDefaultFacilitator();
  if (defaultConfig.systemUserId === actorSystemUserId) return previewResponse(cycleCode, actorSystemUserId, isSuperuser);
  return emptyResponse({
    mode: 'waiting', cycleCode,
    viewer: { systemUserId: actorSystemUserId, isFacilitator: false, isSuperuser: false, isRosterParticipant: false, capabilities: { preview: false, open: false } },
  });
}

async function mutateOwnList({ action, body, actorSystemUserId, isSuperuser }) {
  const roundId = guid(body.roundId, 'Round');
  const operationId = guid(body.operationId, 'Operation');
  const roundRow = await readRound(roundId);
  const parsedRound = parseRound(roundRow);
  const snapshot = parsedRound.snapshot;
  const programKey = body.programKey;
  verifyListOrder(body.order, programKey, snapshot);
  const rows = await listRoundRows(roundId);
  const targetListKey = listKey(programKey, actorSystemUserId);
  const listRow = getListByKey(rows, targetListKey);
  if (!listRow) throw error('Your private ranking is not available for this program.', 403, 'access_denied');
  const list = parseList(listRow);
  ensureActorOwnsList(list, actorSystemUserId, snapshot);
  assertOperationKindAvailable(roundRow, rows, operationId, action, targetListKey);
  if (currentOperationMatches(list, operationId, action)) return getRoundResponse(roundId, actorSystemUserId, isSuperuser, operationId);
  const state = verifyRoundEditable(roundRow, body.policyRevision);
  verifyEtag(list, body.etag, 'Your ranking');
  if (action === 'submit' && list.status === 'submitted') {
    if (verifyTerminalOperation(list, list.wmkf_submittedoperationid, operationId, 'submission')) return getRoundResponse(roundId, actorSystemUserId, isSuperuser, operationId);
  }
  if (list.status !== 'draft') throw error('This ranking is locked and can no longer be changed.', 409, 'list_locked');
  const now = new Date().toISOString();
  const listPatch = {
    wmkf_orderjson: JSON.stringify(body.order),
    wmkf_version: Number(list.wmkf_version || 0) + 1,
    ...actorPatch(actorSystemUserId, operationId, action, now),
  };
  if (action === 'submit') {
    listPatch.wmkf_status = statusToValue('submitted');
    listPatch.wmkf_submittedat = now;
    listPatch.wmkf_submittedoperationid = operationId;
  }
  const roundPatch = actorPatch(actorSystemUserId, operationId, action, now);
  return commitMutation(roundRow, list, roundPatch, listPatch, roundId, operationId, actorSystemUserId, isSuperuser);
}

async function mutateMeeting({ action, body, actorSystemUserId, isSuperuser }) {
  const roundId = guid(body.roundId, 'Round');
  const operationId = guid(body.operationId, 'Operation');
  const roundRow = await readRound(roundId);
  const parsedRound = parseRound(roundRow);
  const roundState = parsedRound;
  const programKey = body.programKey;
  if (!PROGRAMS.includes(programKey) && !(action === 'edit' && programKey === 'co')) throw error('Choose a valid program.', 400, 'invalid_request');
  const rows = await listRoundRows(roundId);
  const listRow = getListByKey(rows, listKey(programKey));
  if (!listRow) throw error('This program has no proposals in the round.', 409, 'program_empty');
  const list = parseList(listRow);
  if ((action === 'generate' || action === 'publish') && roundRow.wmkf_facilitatorsystemuserid !== actorSystemUserId) {
    throw error('Only the current facilitator can change a program composite.', 403, 'access_denied');
  }
  assertOperationKindAvailable(roundRow, rows, operationId, action, listKey(programKey));
  if (currentOperationMatches(listRow, operationId, action)) return getRoundResponse(roundId, actorSystemUserId, isSuperuser, operationId);
  verifyRoundEditable(roundRow, body.policyRevision);
  verifyEtag(listRow, body.etag, 'The program meeting list');
  if (action === 'edit') {
    if (list.status === 'composite-draft') {
      if (roundRow.wmkf_facilitatorsystemuserid !== actorSystemUserId) throw error('Only the facilitator can edit the composite draft before publication.', 403, 'access_denied');
    } else if (list.status === 'published') {
      if (roundRow.wmkf_facilitatorsystemuserid !== actorSystemUserId && !roundState.snapshot.roster.some((person) => person.systemUserId === actorSystemUserId)) {
        throw error('Only the facilitator or a captured participant can edit the published meeting order.', 403, 'access_denied');
      }
    } else throw error('The meeting order is not available for editing yet.', 409, 'invalid_transition');
    verifyListOrder(body.order, programKey, roundState.snapshot, true);
    const now = new Date().toISOString();
    return commitMutation(
      roundRow,
      listRow,
      actorPatch(actorSystemUserId, operationId, action, now),
      { wmkf_orderjson: JSON.stringify(body.order), wmkf_version: Number(listRow.wmkf_version || 0) + 1, ...actorPatch(actorSystemUserId, operationId, action, now) },
      roundId, operationId, actorSystemUserId, isSuperuser,
    );
  }

  if (hasLegacyExcusal(roundState.snapshot)) {
    throw error('Every participant is required. This older round contains an excusal and cannot generate or publish another composite.', 409, 'legacy_excusal');
  }
  const allParsedRows = rows.map(parseList);
  const token = requestConfirmationToken(roundRow, rows, action, programKey);
  if (action === 'generate') {
    if (list.status !== 'collecting') {
      throw error('This program composite has already been generated or is unavailable.', 409, 'invalid_transition');
    }
    if (body.confirmationFingerprint !== token) throw error('Round activity changed. Review the updated confirmation before continuing.', 409, 'confirmation_stale', await getRoundResponse(roundId, actorSystemUserId, isSuperuser));
    const voterIds = roundState.snapshot.roster.map((person) => person.systemUserId);
    if (!voterIds.length) throw error('At least one participant must remain for this program.', 409, 'incomplete_submissions');
    const submissions = voterIds.map((id) => {
      const row = getListByKey(allParsedRows, listKey(programKey, id));
      return row?.status === 'submitted' ? { ...row, ownerSystemUserId: id } : null;
    });
    if (submissions.some((item) => !item)) throw error('Every participant must submit before a composite can be generated.', 409, 'incomplete_submissions');
    const composite = calculateComposite(submissions, roundState.snapshot.seedOrders[programKey]);
    const now = new Date().toISOString();
    const calculation = buildCompositePayload(composite, submissions, roundState.snapshot, programKey, operationId, actorSystemUserId, now);
    const compositeJson = JSON.stringify(calculation);
    if (Buffer.byteLength(compositeJson, 'utf8') > 65536) throw error('The composite calculation exceeds the storage limit.', 409, 'storage_limit');
    const roundPatch = {
      ...actorPatch(actorSystemUserId, operationId, action, now),
      wmkf_policyrevision: roundState.policyRevision + 1,
    };
    const listPatch = {
      wmkf_orderjson: JSON.stringify(composite.order),
      wmkf_status: statusToValue('composite-draft'),
      wmkf_compositejson: compositeJson,
      wmkf_version: Number(listRow.wmkf_version || 0) + 1,
      ...actorPatch(actorSystemUserId, operationId, action, now),
    };
    return commitMutation(roundRow, listRow, roundPatch, listPatch, roundId, operationId, actorSystemUserId, isSuperuser);
  }

  if (action === 'publish') {
    if (list.status !== 'composite-draft') throw error('Generate the program composite before publishing.', 409, 'invalid_transition');
    if (body.confirmationFingerprint !== token) throw error('Round activity changed. Review the updated confirmation before continuing.', 409, 'confirmation_stale', await getRoundResponse(roundId, actorSystemUserId, isSuperuser));
    const now = new Date().toISOString();
    const roundPatch = { ...actorPatch(actorSystemUserId, operationId, action, now), wmkf_policyrevision: roundState.policyRevision + 1 };
    const listPatch = {
      wmkf_status: statusToValue('published'),
      wmkf_publishedat: now,
      wmkf_publishedoperationid: operationId,
      wmkf_version: Number(listRow.wmkf_version || 0) + 1,
      ...actorPatch(actorSystemUserId, operationId, action, now),
    };
    return commitMutation(roundRow, listRow, roundPatch, listPatch, roundId, operationId, actorSystemUserId, isSuperuser);
  }
  throw error('Unsupported meeting action.', 400, 'invalid_request');
}

async function transferFacilitator(body, actorSystemUserId, isSuperuser) {
  const roundId = guid(body.roundId, 'Round');
  const operationId = guid(body.operationId, 'Operation');
  const successor = guid(body.successorSystemUserId, 'Successor');
  const roundRow = await readRound(roundId);
  const roundState = parseRound(roundRow);
  const isCurrent = roundRow.wmkf_facilitatorsystemuserid === actorSystemUserId;
  const events = parseJson(roundRow.wmkf_administrationlogjson, 'Round administration log', []);
  const priorTransfer = events.find((event) => event.operationId === operationId && event.type === 'facilitator-transferred');
  if (!isCurrent && !isSuperuser) {
    if (priorTransfer?.actorSystemUserId === actorSystemUserId && priorTransfer.toSystemUserId === successor) {
      return transferAcknowledgement(roundRow, actorSystemUserId, isSuperuser, operationId);
    }
    throw error('Only the current facilitator or a superuser can transfer facilitation.', 403, 'access_denied');
  }
  assertOperationKindAvailable(roundRow, [], operationId, 'transfer');
  if (priorTransfer) {
    if (priorTransfer.toSystemUserId !== successor || priorTransfer.actorSystemUserId !== actorSystemUserId) {
      throw error('This operation identifier was already used for a different transfer.', 409, 'operation_id_reused');
    }
    return roundState.snapshot.roster.some((person) => person.systemUserId === actorSystemUserId) || isSuperuser
      ? getRoundResponse(roundId, actorSystemUserId, isSuperuser, operationId)
      : transferAcknowledgement(roundRow, actorSystemUserId, isSuperuser, operationId);
  }
  verifyRoundEditable(roundRow, body.policyRevision);
  if (!roundState.snapshot.roster.some((person) => person.systemUserId === successor)) throw error('The successor must be a participant captured in this round.', 400, 'invalid_successor');
  const enabled = await readEnabledProposalRankingStaff(successor);
  if (!enabled) throw error('The selected participant is not an active staff member.', 409, 'invalid_successor');
  const now = new Date().toISOString();
  const eventJson = appendAdministrationEvent(roundRow, { type: 'facilitator-transferred', fromSystemUserId: roundRow.wmkf_facilitatorsystemuserid, toSystemUserId: successor, actorSystemUserId, at: now, operationId });
  const patch = {
    wmkf_facilitatorsystemuserid: successor,
    wmkf_policyrevision: roundState.policyRevision + 1,
    wmkf_administrationlogjson: eventJson,
    ...actorPatch(actorSystemUserId, operationId, 'transfer', now),
  };
  try { await patchRound(roundRow, patch); }
  catch (writeError) {
    const current = await readRound(roundId).catch(() => null);
    const committedEvent = current && parseJson(current.wmkf_administrationlogjson, 'Round administration log', [])
      .find((event) => event.operationId === operationId && event.type === 'facilitator-transferred'
        && event.actorSystemUserId === actorSystemUserId && event.toSystemUserId === successor);
    if (committedEvent) {
      return roundState.snapshot.roster.some((person) => person.systemUserId === actorSystemUserId) || isSuperuser
        ? getRoundResponse(roundId, actorSystemUserId, isSuperuser, operationId)
        : transferAcknowledgement(current, actorSystemUserId, isSuperuser, operationId);
    }
    if (Number(writeError?.status) === 412) {
      const currentResponse = await getRoundResponse(roundId, actorSystemUserId, isSuperuser, operationId).catch(() => null);
      throw error('The round changed while transferring the facilitator. Review the current round and retry.', 409, 'conflict', currentResponse);
    }
    const uncertain = writeError?.noResponse === true || writeError?.status == null || writeError?.status >= 500;
    if (!uncertain) throw writeError;
    const canStillRead = roundState.snapshot.roster.some((person) => person.systemUserId === actorSystemUserId) || isCurrent || isSuperuser;
    const currentResponse = canStillRead
      ? await getRoundResponse(roundId, actorSystemUserId, isSuperuser, operationId).catch(() => null)
      : transferAcknowledgement(roundRow, actorSystemUserId, isSuperuser, operationId, 'uncertain');
    throw error('The transfer outcome is uncertain. Refresh to resolve the facilitator.', 409, 'uncertain_outcome', currentResponse, true);
  }
  const updated = await readRound(roundId);
  return roundState.snapshot.roster.some((person) => person.systemUserId === actorSystemUserId) || isSuperuser
    ? getRoundResponse(roundId, actorSystemUserId, isSuperuser, operationId)
    : transferAcknowledgement(updated, actorSystemUserId, isSuperuser, operationId);
}

async function cancelRound(body, actorSystemUserId, isSuperuser) {
  const roundId = guid(body.roundId, 'Round');
  const operationId = guid(body.operationId, 'Operation');
  const roundRow = await readRound(roundId);
  if (roundRow.wmkf_facilitatorsystemuserid !== actorSystemUserId) throw error('Only the current facilitator can cancel this round.', 403, 'access_denied');
  if (idempotentRoundState(roundRow, operationId, 'round-canceled') && roundRow.wmkf_state === ROUND_STATE.canceled) return getRoundResponse(roundId, actorSystemUserId, isSuperuser, operationId);
  const roundState = verifyRoundEditable(roundRow, body.policyRevision);
  if (roundState.snapshot.dryRun === true) throw error('Use dry-run erasure to end this trial.', 409, 'dry_run_requires_reset');
  const rows = await listRoundRows(roundId);
  assertOperationKindAvailable(roundRow, rows, operationId, 'cancel');
  if (body.confirmationFingerprint !== requestConfirmationToken(roundRow, rows, 'cancel')) throw error('Round activity changed. Review the updated confirmation before continuing.', 409, 'confirmation_stale', await getRoundResponse(roundId, actorSystemUserId, isSuperuser));
  if (rows.some((row) => row.wmkf_status === statusToValue('published'))) throw error('A round cannot be canceled after a program is published.', 409, 'invalid_transition');
  const coordinator = await findCycleCoordinator(roundState.snapshot.cycleCode);
  if (!coordinator || coordinator.wmkf_activeroundid !== roundId) throw error('The active cycle pointer changed. Refresh before canceling.', 409, 'stale_coordinator');
  const now = new Date().toISOString();
  const eventJson = appendAdministrationEvent(roundRow, { type: 'round-canceled', actorSystemUserId, at: now, operationId });
  const roundPatch = {
    wmkf_state: ROUND_STATE.canceled,
    wmkf_administrationlogjson: eventJson,
    ...actorPatch(actorSystemUserId, operationId, 'cancel', now),
  };
  const coordinatorPatch = { wmkf_activeroundid: null, wmkf_version: Number(coordinator.wmkf_version || 0) + 1 };
  try { await cancelRoundChangeset(roundRow, roundPatch, coordinator, coordinatorPatch); }
  catch (writeError) { return afterMutation(roundId, operationId, actorSystemUserId, isSuperuser, writeError); }
  return getRoundResponse(roundId, actorSystemUserId, isSuperuser, operationId);
}

// Delete only lists from an explicitly marked dry run. A content-free receipt
// makes retries safe and prevents delayed opening requests from recreating it.
async function resetDryRun(body, actorSystemUserId, isSuperuser) {
  const roundId = guid(body.roundId, 'Round');
  const operationId = guid(body.operationId, 'Operation');
  const round = await readRound(roundId);
  if (round.wmkf_facilitatorsystemuserid !== actorSystemUserId) throw error('Only the current facilitator can erase this dry run.', 403, 'access_denied');
  const parsed = parseRound(round);
  if (parsed.snapshot.dryRun !== true) throw error('Only a round opened as a dry run can be erased.', 409, 'not_dry_run');
  if (parsed.snapshot.erased === true && idempotentRoundState(round, operationId, 'dry-run-erased')) return getRoundResponse(roundId, actorSystemUserId, isSuperuser, operationId);
  verifyRoundEditable(round, body.policyRevision);
  const rows = await listRoundRows(roundId);
  assertOperationKindAvailable(round, rows, operationId, 'resetDryRun');
  if (body.confirmationFingerprint !== requestConfirmationToken(round, rows, 'resetDryRun')) throw error('Round activity changed. Review the reset confirmation again.', 409, 'confirmation_stale', await getRoundResponse(roundId, actorSystemUserId, isSuperuser));
  const coordinator = await findCycleCoordinator(parsed.snapshot.cycleCode);
  if (!coordinator || coordinator.wmkf_activeroundid !== roundId) throw error('The active cycle pointer changed. Refresh before resetting.', 409, 'stale_coordinator');
  const now = new Date().toISOString();
  const patch = {
    wmkf_state: ROUND_STATE.canceled,
    wmkf_policyrevision: parsed.policyRevision + 1,
    wmkf_snapshotjson: JSON.stringify({ version: 1, cycleCode: parsed.snapshot.cycleCode, dryRun: true, erased: true, proposals: [], seedOrders: { se: [], mr: [] }, roster: [] }),
    wmkf_administrationlogjson: JSON.stringify([{ type: 'dry-run-erased', actorSystemUserId, at: now, operationId }]),
    ...actorPatch(actorSystemUserId, operationId, 'resetDryRun', now),
  };
  try {
    await eraseDryRunChangeset(round, rows, patch, coordinator, { wmkf_activeroundid: null, wmkf_version: Number(coordinator.wmkf_version || 0) + 1 });
  } catch (writeError) { return afterMutation(roundId, operationId, actorSystemUserId, isSuperuser, writeError); }
  return getRoundResponse(roundId, actorSystemUserId, isSuperuser, operationId);
}

export async function handleProposalRankingAction({ action, body = {}, profileId, isSuperuser = false }) {
  assertProposalRankingReady();
  const allowedFields = ACTION_FIELDS[action];
  if (!allowedFields || !body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).some((field) => !allowedFields.includes(field))) {
    throw error('The action contains unsupported or invalid fields.', 400, 'invalid_request');
  }
  const actorSystemUserId = await readCurrentActor(profileId);
  if (action === 'preview') return previewResponse(body.cycleCode, actorSystemUserId, isSuperuser);
  if (action === 'open') return openRound({ ...body, actorSystemUserId, isSuperuser });
  if (action === 'read') return getRoundResponse(guid(body.roundId, 'Round'), actorSystemUserId, isSuperuser, body.operationId ? guid(body.operationId, 'Operation') : null);
  if (action === 'save' || action === 'submit') return mutateOwnList({ action, body, actorSystemUserId, isSuperuser });
  if (action === 'generate' || action === 'edit' || action === 'publish') return mutateMeeting({ action, body, actorSystemUserId, isSuperuser });
  if (action === 'combine') return combineMeeting(body, actorSystemUserId, isSuperuser);
  if (action === 'transfer') return transferFacilitator(body, actorSystemUserId, isSuperuser);
  if (action === 'resetDryRun') return resetDryRun(body, actorSystemUserId, isSuperuser);
  if (action === 'cancel') return cancelRound(body, actorSystemUserId, isSuperuser);
  throw error('Choose a supported Proposal Ranking action.', 400, 'invalid_request');
}

export async function handleProposalRankingGet({ cycleCode, roundId, operationId, profileId, isSuperuser = false }) {
  assertProposalRankingReady();
  const actorSystemUserId = await readCurrentActor(profileId);
  if (roundId) return getRoundResponse(guid(roundId, 'Round'), actorSystemUserId, isSuperuser, operationId ? guid(operationId, 'Operation') : null);
  if (cycleCode) return readByCycleOrWait(cycleCode, actorSystemUserId, isSuperuser);
  throw error('Choose a funding cycle or round.', 400, 'invalid_request');
}

export async function handleProposalRankingAdminSettings({ method, body, profileId }) {
  const setting = await readDefaultFacilitator();
  if (method === 'GET') {
    const [staff, grants] = await Promise.all([
      (await import('../../dataverse/adapters/proposal-ranking-source.js')).listEnabledProposalRankingStaff(),
      listAllGrantsForAdmin({ throwOnError: true }),
    ]);
    const grantsByProfile = new Map(grants.map((row) => [String(row.user_profile_id), row]));
    const eligibleStaff = [];
    for (const user of staff) {
      const mappedProfile = await resolveSystemUserToProfile(user.systemUserId);
      if (mappedProfile != null && grantsByProfile.get(String(mappedProfile))?.apps?.includes('proposal-ranking')) {
        eligibleStaff.push({ systemUserId: user.systemUserId, name: user.name });
      }
    }
    const selected = staff.find((user) => user.systemUserId === setting.systemUserId) || null;
    return { systemUserId: setting.systemUserId, name: selected?.name || null, configured: setting.configured, revision: setting.revision, eligibleStaff };
  }
  if (method !== 'PUT') throw error('Method not allowed.', 405, 'method_not_allowed');
  const nextId = guid(body.systemUserId, 'Facilitator');
  const staff = await (await import('../../dataverse/adapters/proposal-ranking-source.js')).readEnabledProposalRankingStaff(nextId);
  if (!staff) throw error('Choose an active staff member.', 400, 'invalid_facilitator');
  const mappedProfile = await resolveSystemUserToProfile(nextId);
  if (mappedProfile == null) throw error('The selected staff member does not have an active profile.', 400, 'invalid_facilitator');
  const grants = await listAllGrantsForAdmin({ throwOnError: true });
  const grant = grants.find((row) => String(row.user_profile_id) === String(mappedProfile));
  if (!grant?.apps?.includes('proposal-ranking')) throw error('Grant Proposal Ranking app access to this staff member before selecting them.', 400, 'invalid_facilitator');
  const { saveDefaultFacilitator } = await import('./config.js');
  await saveDefaultFacilitator(nextId, body.revision ?? null, profileId);
  return handleProposalRankingAdminSettings({ method: 'GET', profileId });
}

function combinedSourcesReady(snapshot, rows) {
  const nonempty = PROGRAMS.filter((key) => snapshot.seedOrders[key]?.length);
  return nonempty.length > 0 && nonempty.every((key) => getListByKey(rows, listKey(key))?.wmkf_status === LIST_STATE.published);
}

async function combineMeeting(body, actorSystemUserId, isSuperuser) {
  const roundId = guid(body.roundId, 'Round');
  const operationId = guid(body.operationId, 'Operation');
  const round = await readRound(roundId);
  if (round.wmkf_facilitatorsystemuserid !== actorSystemUserId) throw error('Only the current facilitator can create the combined list.', 403, 'access_denied');
  const rows = await listRoundRows(roundId);
  assertOperationKindAvailable(round, rows, operationId, 'combine', listKey('co'));
  const existing = getListByKey(rows, listKey('co'));
  if (existing && currentOperationMatches(existing, operationId, 'combine')) return getRoundResponse(roundId, actorSystemUserId, isSuperuser, operationId);
  const { snapshot, policyRevision } = verifyRoundEditable(round, body.policyRevision);
  if (existing) throw error('The combined meeting list already exists.', 409, 'already_completed');
  if (hasLegacyExcusal(snapshot) || !combinedSourcesReady(snapshot, rows)) throw error('Publish every nonempty program before combining the meeting lists.', 409, 'invalid_transition');
  if (body.confirmationFingerprint !== requestConfirmationToken(round, rows, 'combine')) throw error('The program orders changed. Review the updated confirmation.', 409, 'confirmation_stale', await getRoundResponse(roundId, actorSystemUserId, isSuperuser));
  const sources = PROGRAMS.filter((key) => snapshot.seedOrders[key]?.length).map((key) => {
    const list = parseList(getListByKey(rows, listKey(key)));
    verifyListOrder(list.order, key, snapshot);
    const composite = parseJson(list.wmkf_compositejson, 'Program composite');
    return { programKey: key, version: Number(list.wmkf_version), order: list.order, scores: composite?.scores || {}, ranks: composite?.ranks || [] };
  });
  const order = combineMeetingOrders(sources);
  const now = new Date().toISOString();
  const composite = { generationOperationId: operationId, generatedBy: actorSystemUserId, generatedAt: now, programKey: 'co', baselineOrder: order,
    sourceMeetingOrders: sources.map(({ programKey, version, order: sourceOrder }) => ({ programKey, version, order: sourceOrder })),
    scores: Object.assign({}, ...sources.map((source) => source.scores)), ranks: sources.flatMap((source) => source.ranks) };
  const compositeJson = JSON.stringify(composite);
  const orderJson = JSON.stringify(order);
  if ([compositeJson, orderJson].some((value) => Buffer.byteLength(value, 'utf8') > 65536)) throw error('The combined list exceeds the storage limit.', 409, 'storage_limit');
  const row = { wmkf_proposalrankinglistid: randomUUID().toLowerCase(), wmkf_name: `${snapshot.cycleCode} combined meeting order`, wmkf_roundid: roundId,
    wmkf_programkey: 'co', wmkf_listkey: listKey('co'), wmkf_orderjson: orderJson, wmkf_compositejson: compositeJson,
    wmkf_status: LIST_STATE.published, wmkf_version: 1, wmkf_publishedat: now, wmkf_publishedoperationid: operationId,
    ...actorPatch(actorSystemUserId, operationId, 'combine', now) };
  try { await createCombinedMeeting(round, { ...actorPatch(actorSystemUserId, operationId, 'combine', now), wmkf_policyrevision: policyRevision + 1 }, row); }
  catch (writeError) { return afterMutation(roundId, operationId, actorSystemUserId, isSuperuser, writeError); }
  return afterMutation(roundId, operationId, actorSystemUserId, isSuperuser, null, true);
}
