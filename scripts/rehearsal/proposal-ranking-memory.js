/**
 * Synthetic, process-local dependencies for the Proposal Ranking rehearsal.
 * This module contains no network, environment-file, or Dataverse access.
 */
export const REHEARSAL_PROFILE_IDS = Object.freeze({
  facilitator: '1',
  pd1: '2',
  pd2: '3',
});
export const REHEARSAL_SYSTEM_USER_IDS = Object.freeze({
  facilitator: '72000000-0000-4000-8000-000000000001',
  pd1: '72000000-0000-4000-8000-000000000002',
  pd2: '72000000-0000-4000-8000-000000000003',
});
export const REHEARSAL_ROUND_ID = '73000000-0000-4000-8000-000000000001';
export const REHEARSAL_CYCLE_CODE = 'D26';

const PEOPLE = [
  { key: 'facilitator', name: 'Alex Rehearsal (Facilitator)' },
  { key: 'pd1', name: 'Casey Sample (Program Director)' },
  { key: 'pd2', name: 'Morgan Example (Program Director)' },
].map((person) => ({ ...person, profileId: REHEARSAL_PROFILE_IDS[person.key], systemUserId: REHEARSAL_SYSTEM_USER_IDS[person.key] }));
const RATINGS = [
  { label: 'Excellent', value: 5 }, { label: 'Very Good', value: 4 }, { label: 'Good', value: 3 },
  { label: 'Fair', value: 2 }, { label: 'Poor', value: 1 },
];
const USD = { id: '74000000-0000-4000-8000-000000000001', code: 'USD', name: 'US Dollar', precision: 2 };
const FIXTURE = ['se', 'mr'].flatMap((programKey, programIndex) => [0, 1, 2].map((index) => {
  const n = programIndex * 3 + index + 1;
  const lead = PEOPLE[index];
  const rating = 5 - ((index + programIndex) % 3);
  return {
    requestId: `75000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    requestNumber: `R-${String(n).padStart(3, '0')}`,
    title: `${programKey === 'se' ? 'Science and Engineering' : 'Medical Research'} Sample ${index + 1}`,
    organization: `Synthetic Institution ${index + 1}`,
    institutionGeography: index % 2 === 0 ? 'East' : 'West',
    programKey,
    leadSystemUserId: lead.systemUserId,
    leadSystemUser: { systemuserid: lead.systemUserId, fullname: lead.name, isdisabled: false },
    amount: [125000, 245000, 87500][index],
    currency: { ...USD },
    reviews: [{
      received: true,
      outstanding: false,
      synthetic: false,
      answer: { answerValue: rating, questionOptions: RATINGS },
    }],
  };
}));

let rounds = new Map();
let lists = new Map();
let coordinators = new Map();
let revision = 0;
let lastCreatedRoundId = null;

const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));
const etag = (kind, id) => `W/"rehearsal-${kind}-${id}-${++revision}"`;
function stamp(row, kind, id) { row['@odata.etag'] = etag(kind, id); return row; }
function currentMapRow(map, id, kind) {
  const normalized = String(id).toLowerCase();
  const row = map.get(normalized) || [...map.values()].find((candidate) => [
    candidate.wmkf_proposalrankingcycleid,
    candidate.wmkf_proposalrankingroundid,
    candidate.wmkf_proposalrankinglistid,
  ].some((candidateId) => String(candidateId || '').toLowerCase() === normalized));
  if (!row) { const error = new Error(`Synthetic ${kind} was not found.`); error.status = 404; throw error; }
  return row;
}
function checkEtag(current, supplied) {
  if (!supplied || supplied !== current['@odata.etag']) { const error = new Error('Synthetic row revision changed.'); error.status = 412; throw error; }
}
function applyConditional(current, supplied, patch, kind, id) {
  checkEtag(current, supplied);
  Object.assign(current, clone(patch));
  stamp(current, kind, id);
}

export const REHEARSAL_DEPENDENCY_PATHS = Object.freeze([
  'lib/dataverse/adapters/proposal-ranking.js',
  'lib/dataverse/adapters/proposal-ranking-source.js',
  'lib/services/dataverse-identity-map.js',
  'lib/services/app-access-service.js',
  'lib/services/proposal-ranking/config.js',
]);

export function resetProposalRankingRehearsal() {
  rounds = new Map();
  lists = new Map();
  coordinators = new Map();
  revision = 0;
  lastCreatedRoundId = null;
}

export function getRehearsalProfiles() { return clone(PEOPLE); }
export function getLastCreatedRoundId() { return lastCreatedRoundId; }

// Dataverse identity map alias.
export async function resolveProfileToSystemUser(profileId) {
  const person = PEOPLE.find((item) => item.profileId === String(profileId));
  return person ? { systemuserid: person.systemUserId } : null;
}
export async function resolveSystemUserToProfile(systemUserId) {
  return PEOPLE.find((item) => item.systemUserId === String(systemUserId).toLowerCase())?.profileId ?? null;
}

// Source adapter alias.
export async function readProposalRankingSource(cycleCode) {
  if (cycleCode !== REHEARSAL_CYCLE_CODE) throw new Error('Only the synthetic rehearsal cycle is available.');
  return { proposals: clone(FIXTURE), unexpectedStatuses: [], sourceRequestCount: FIXTURE.length, scannedRequestCount: FIXTURE.length };
}
export async function readEnabledProposalRankingStaff(systemUserId) {
  const person = PEOPLE.find((item) => item.systemUserId === String(systemUserId).toLowerCase());
  return person ? { systemUserId: person.systemUserId, name: person.name, enabled: true } : null;
}
export async function listEnabledProposalRankingStaff() {
  return PEOPLE.map((item) => ({ systemUserId: item.systemUserId, name: item.name, enabled: true }));
}

// Access and config aliases.
export async function listAllGrantsForAdmin() {
  return PEOPLE.map((person) => ({ user_profile_id: person.profileId, apps: ['proposal-ranking'] }));
}
export async function readDefaultFacilitator() {
  return { systemUserId: REHEARSAL_SYSTEM_USER_IDS.facilitator, configured: true, revision: 1 };
}
export async function saveDefaultFacilitator() { return { systemUserId: REHEARSAL_SYSTEM_USER_IDS.facilitator }; }

// Persistence adapter alias. Every read returns a clone and every write checks
// the ETag supplied by the real service before advancing the stored revision.
export async function findCycleCoordinator(cycleCode) {
  return clone(coordinators.get(cycleCode) || null);
}
export async function findRoundByCreationOperation(operationId) {
  const row = [...rounds.values()].find((round) => round.wmkf_creationoperationid === operationId);
  return clone(row || null);
}
export async function readRound(roundId) { return clone(currentMapRow(rounds, roundId, 'round')); }
export async function listRoundRows(roundId) {
  return clone([...lists.values()].filter((row) => row.wmkf_roundid === String(roundId).toLowerCase()).sort((a, b) => a.wmkf_listkey.localeCompare(b.wmkf_listkey)));
}
export function makeOpenOperations({ coordinator, round, lists: newLists }) {
  return { coordinator: clone(coordinator), round: clone(round), lists: clone(newLists) };
}
export async function createRoundAndLists(operations) {
  const { coordinator, round, lists: newLists } = operations;
  if (!round || !Array.isArray(newLists) || newLists.length === 0) throw new Error('Incomplete synthetic round creation.');
  if (coordinator.existing) {
    const current = currentMapRow(coordinators, coordinator.id, 'cycle coordinator');
    checkEtag(current, coordinator.etag);
    Object.assign(current, clone(coordinator.patch));
    stamp(current, 'cycle', coordinator.id);
  } else {
    const cycleCode = round.wmkf_cyclecode;
    if (coordinators.has(cycleCode)) { const error = new Error('Synthetic cycle already exists.'); error.status = 409; throw error; }
    const created = clone(coordinator.create);
    coordinators.set(cycleCode, stamp(created, 'cycle', created.wmkf_proposalrankingcycleid));
  }
  const createdRound = clone(round);
  const roundId = createdRound.wmkf_proposalrankingroundid.toLowerCase();
  stamp(createdRound, 'round', roundId);
  rounds.set(roundId, createdRound);
  lastCreatedRoundId = roundId;
  for (const item of newLists) {
    const row = clone(item);
    const id = row.wmkf_proposalrankinglistid.toLowerCase();
    stamp(row, 'list', id);
    lists.set(id, row);
  }
  return { ok: true };
}
export async function patchRoundAndList(round, list, roundPatch, listPatch) {
  const storedRound = currentMapRow(rounds, round.wmkf_proposalrankingroundid, 'round');
  const storedList = currentMapRow(lists, list.wmkf_proposalrankinglistid, 'list');
  checkEtag(storedRound, round['@odata.etag']);
  checkEtag(storedList, list['@odata.etag']);
  Object.assign(storedRound, clone(roundPatch));
  Object.assign(storedList, clone(listPatch));
  stamp(storedRound, 'round', storedRound.wmkf_proposalrankingroundid);
  stamp(storedList, 'list', storedList.wmkf_proposalrankinglistid);
  return { ok: true };
}
export async function patchRound(round, patch) {
  const stored = currentMapRow(rounds, round.wmkf_proposalrankingroundid, 'round');
  applyConditional(stored, round['@odata.etag'], patch, 'round', stored.wmkf_proposalrankingroundid);
  return { ok: true };
}
export async function cancelRoundChangeset(round, roundPatch, coordinator, coordinatorPatch) {
  const storedRound = currentMapRow(rounds, round.wmkf_proposalrankingroundid, 'round');
  const storedCoordinator = currentMapRow(coordinators, coordinator.wmkf_proposalrankingcycleid, 'cycle coordinator');
  checkEtag(storedRound, round['@odata.etag']);
  checkEtag(storedCoordinator, coordinator['@odata.etag']);
  Object.assign(storedRound, clone(roundPatch));
  Object.assign(storedCoordinator, clone(coordinatorPatch));
  stamp(storedRound, 'round', storedRound.wmkf_proposalrankingroundid);
  stamp(storedCoordinator, 'cycle', storedCoordinator.wmkf_proposalrankingcycleid);
  return { ok: true };
}

// This module is webpack-aliased only by the standalone rehearsal build. Keep
// environment mutation out of this dependency adapter; the harness provides
// explicit readiness flags to the local process before importing the service.
