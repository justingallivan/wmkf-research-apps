/**
 * Application-owned Proposal Ranking persistence adapter.
 * All updates are ETag-conditional changesets. Actor IDs are required payload
 * fields; this adapter never impersonates staff via actingUserSystemId.
 */

import { DynamicsService } from '../../services/dynamics-service.js';
import { executeChangeset } from '../../services/dynamics/changeset.js';
import * as odata from '../core/odata.js';
import { isGuid } from '../../utils/guid.js';
import { entitySet } from '../core/entity-registry.js';

const CYCLE_SET = entitySet('wmkf_proposalrankingcycles');
const ROUND_SET = entitySet('wmkf_proposalrankingrounds');
const LIST_SET = entitySet('wmkf_proposalrankinglists');

const CYCLE_SELECT = 'wmkf_proposalrankingcycleid,wmkf_cyclecode,wmkf_activeroundid,wmkf_version';
const ROUND_SELECT = [
  'wmkf_proposalrankingroundid,wmkf_cyclecode,wmkf_creationoperationid,wmkf_snapshotjson',
  'wmkf_facilitatorsystemuserid,wmkf_policyrevision,wmkf_state,wmkf_administrationlogjson',
  'wmkf_lastoperationid,wmkf_lastoperationkind,wmkf_createdbyactorsystemuserid,wmkf_createdat',
].join(',');
const LIST_SELECT = [
  'wmkf_proposalrankinglistid,wmkf_roundid,wmkf_listkey,wmkf_programkey,wmkf_participantsystemuserid',
  'wmkf_orderjson,wmkf_status,wmkf_version,wmkf_compositejson,wmkf_lastoperationid,wmkf_lastoperationkind',
  'wmkf_updatedbyactorsystemuserid,wmkf_updatedat,wmkf_submittedat,wmkf_submittedoperationid',
  'wmkf_publishedat,wmkf_publishedoperationid',
].join(',');

function complete(result, label) {
  if (result?.capped || !Array.isArray(result?.records)) throw new Error(`${label} did not return a complete Dataverse result.`);
  return result.records;
}

function exposeConcurrencyEtag(row) {
  if (!row || row['@odata.etag'] || !row._etag) return row;
  return { ...row, '@odata.etag': row._etag };
}

async function oneByFilter(entitySetName, filter, select, label) {
  const rows = complete(await DynamicsService.queryAllRecords(entitySetName, { select, filter }), label);
  if (rows.length > 1) throw new Error(`${label} returned duplicate application rows.`);
  return exposeConcurrencyEtag(rows[0] || null);
}

export async function findCycleCoordinator(cycleCode) {
  if (typeof cycleCode !== 'string' || !/^[A-Za-z]\d{2}$/.test(cycleCode)) throw new Error('Cycle code is invalid.');
  return oneByFilter(CYCLE_SET, odata.eq('wmkf_cyclecode', cycleCode), CYCLE_SELECT, 'Cycle coordinator lookup');
}

/** Saved cycle codes only; no private assessments or round contents are returned. */
export async function listSavedRankingCycles() {
  return complete(await DynamicsService.queryAllRecords(CYCLE_SET, {
    select: 'wmkf_cyclecode,wmkf_activeroundid',
  }), 'Saved ranking cycles').filter(row => row.wmkf_activeroundid)
    .map(row => row.wmkf_cyclecode);
}

export async function findRoundByCreationOperation(operationId) {
  if (!isGuid(operationId)) throw new Error('Creation operation ID must be a GUID.');
  return oneByFilter(ROUND_SET, odata.eq('wmkf_creationoperationid', operationId), ROUND_SELECT, 'Round operation lookup');
}

export async function readRound(roundId) {
  if (!isGuid(roundId)) throw new Error('Round ID must be a GUID.');
  return exposeConcurrencyEtag(await DynamicsService.getRecord(ROUND_SET, roundId, { select: ROUND_SELECT }));
}

export async function listRoundRows(roundId) {
  if (!isGuid(roundId)) throw new Error('Round ID must be a GUID.');
  const result = await DynamicsService.queryAllRecords(LIST_SET, {
    select: LIST_SELECT,
    filter: odata.eq('wmkf_roundid', roundId),
    orderby: 'wmkf_listkey asc',
  });
  return complete(result, 'Round list lookup').map(exposeConcurrencyEtag);
}

function jsonSize(value) {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

export function makeOpenOperations({ coordinator, round, lists }) {
  if (jsonSize(round.wmkf_snapshotjson) > 524288) throw new Error('Round snapshot exceeds the 512 KiB storage limit.');
  for (const row of lists) {
    if (jsonSize(row.wmkf_orderjson) > 65536) throw new Error('A proposal list exceeds the 64 KiB storage limit.');
  }
  const operations = [];
  if (coordinator.existing) {
    if (!coordinator.etag) throw new Error('Cycle coordinator revision is unavailable.');
    operations.push({
      method: 'PATCH',
      url: `${CYCLE_SET}(${coordinator.id})`,
      ifMatch: coordinator.etag,
      body: coordinator.patch,
    });
  } else {
    operations.push({ method: 'POST', url: CYCLE_SET, body: coordinator.create });
  }
  operations.push({ method: 'POST', url: ROUND_SET, body: round });
  for (const list of lists) operations.push({ method: 'POST', url: LIST_SET, body: list });
  return operations;
}

export async function createRoundAndLists(operations) {
  // Deliberately omit actingUserSystemId. The service records the authenticated
  // actor in mandatory application columns and keeps DAL/interlock enforcement.
  return executeChangeset(DynamicsService, operations);
}

export async function patchRoundAndList(round, list, roundPatch, listPatch) {
  if (!round?.['@odata.etag'] || !list?.['@odata.etag']) throw new Error('A current round and list revision are required.');
  return executeChangeset(DynamicsService, [
    { method: 'PATCH', url: `${ROUND_SET}(${round.wmkf_proposalrankingroundid})`, ifMatch: round['@odata.etag'], body: roundPatch },
    { method: 'PATCH', url: `${LIST_SET}(${list.wmkf_proposalrankinglistid})`, ifMatch: list['@odata.etag'], body: listPatch },
  ]);
}

export async function patchRound(round, roundPatch) {
  if (!round?.['@odata.etag']) throw new Error('A current round revision is required.');
  return executeChangeset(DynamicsService, [
    { method: 'PATCH', url: `${ROUND_SET}(${round.wmkf_proposalrankingroundid})`, ifMatch: round['@odata.etag'], body: roundPatch },
  ]);
}

export async function cancelRoundChangeset(round, roundPatch, coordinator, coordinatorPatch) {
  if (!round?.['@odata.etag'] || !coordinator?.['@odata.etag']) throw new Error('Current round and cycle revisions are required.');
  return executeChangeset(DynamicsService, [
    { method: 'PATCH', url: `${ROUND_SET}(${round.wmkf_proposalrankingroundid})`, ifMatch: round['@odata.etag'], body: roundPatch },
    { method: 'PATCH', url: `${CYCLE_SET}(${coordinator.wmkf_proposalrankingcycleid})`, ifMatch: coordinator['@odata.etag'], body: coordinatorPatch },
  ]);
}

export const ENTITY_SETS = Object.freeze({ cycle: CYCLE_SET, round: ROUND_SET, list: LIST_SET });

/** Read additive fields only after the legacy round reader identifies version 2. */
export async function readAssessmentRound(roundId) {
  if (!isGuid(roundId)) throw new Error('Round ID must be a GUID.');
  return exposeConcurrencyEtag(await DynamicsService.getRecord(ROUND_SET, roundId, { select: `${ROUND_SELECT},wmkf_workflowjson` }));
}

export async function readAssessmentRows(roundId, keys) {
  if (!isGuid(roundId) || !Array.isArray(keys) || !keys.length || keys.length > 64
    || keys.some((key) => typeof key !== 'string' || key.length > 100)) throw new Error('Invalid assessment selectors.');
  const filter = `${odata.eq('wmkf_roundid', roundId)} and (${keys.map((key) => odata.eq('wmkf_listkey', key)).join(' or ')})`;
  return complete(await DynamicsService.queryAllRecords(LIST_SET, {
    select: `${LIST_SELECT},wmkf_assessmentjson`, filter, orderby: 'wmkf_listkey asc',
  }), 'Assessment lookup').map(exposeConcurrencyEtag);
}

/** Strictly create/update; this workflow never deletes retained versions. */
export async function commitAssessmentChanges({ round, roundPatch, creates = [], updates = [], newRound = null, coordinator = null, coordinatorPatch = null }) {
  if (!isGuid(round?.wmkf_proposalrankingroundid) || !round['@odata.etag']) throw new Error('A current round revision is required.');
  const operations = [{ method:'PATCH', url:`${ROUND_SET}(${round.wmkf_proposalrankingroundid})`, ifMatch:round['@odata.etag'], body:roundPatch }];
  if (newRound) operations.push({ method:'POST', url:ROUND_SET, body:newRound });
  for (const row of creates) operations.push({ method:'POST', url:LIST_SET, body:row });
  for (const { row, patch } of updates) {
    if (!isGuid(row.wmkf_proposalrankinglistid) || !row['@odata.etag']) throw new Error('A current list revision is required.');
    operations.push({ method:'PATCH', url:`${LIST_SET}(${row.wmkf_proposalrankinglistid})`, ifMatch:row['@odata.etag'], body:patch });
  }
  if (coordinator) {
    if (!isGuid(coordinator.wmkf_proposalrankingcycleid) || !coordinator['@odata.etag']) throw new Error('A current coordinator revision is required.');
    operations.push({ method:'PATCH', url:`${CYCLE_SET}(${coordinator.wmkf_proposalrankingcycleid})`, ifMatch:coordinator['@odata.etag'], body:coordinatorPatch });
  }
  if (operations.length > 64) throw new Error('Ranking transaction exceeds its supported capacity.');
  for (const { body } of operations) {
    for (const [field, max] of [['wmkf_snapshotjson',524288],['wmkf_assessmentjson',524288],['wmkf_workflowjson',65536],['wmkf_orderjson',65536]]) {
      if (body[field] != null && Buffer.byteLength(body[field], 'utf8') > max) throw new Error('Ranking payload exceeds its storage capacity.');
    }
  }
  return executeChangeset(DynamicsService, operations);
}
