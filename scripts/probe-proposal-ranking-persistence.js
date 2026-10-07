#!/usr/bin/env node

/**
 * Explicit, append-only sandbox persistence rehearsal for Proposal Ranking.
 * Default mode performs GET-only preflight. --execute writes only the three
 * application-owned Proposal Ranking tables and retains the fixture rows.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const requireFromHere = createRequire(__filename);
const { loadEnvLocal, getAccessToken, createClient } = requireFromHere('../lib/dataverse/client.js');

const SANDBOX_URL = 'https://orgd9e66399.crm.dynamics.com';
const REHEARSAL_CYCLE = 'D99';
const DEFAULT_RECEIPT = '/private/tmp/proposal-ranking-persistence-rehearsal.json';
const FIXTURE_REQUEST_IDS = Object.freeze([
  '80000000-0000-4000-8000-000000000001',
  '80000000-0000-4000-8000-000000000002',
]);
const ALLOWED_ENTITY_SETS = new Set([
  'wmkf_proposalrankingcycles',
  'wmkf_proposalrankingrounds',
  'wmkf_proposalrankinglists',
]);

function parseArgs(argv) {
  const args = { cycleCode: REHEARSAL_CYCLE, execute: false, receiptPath: DEFAULT_RECEIPT, staffUserId: null };
  for (const arg of argv.slice(2)) {
    if (arg === '--execute') args.execute = true;
    else if (arg.startsWith('--cycle=')) args.cycleCode = arg.slice('--cycle='.length);
    else if (arg.startsWith('--receipt=')) args.receiptPath = arg.slice('--receipt='.length);
    else if (arg.startsWith('--staff-user-id=')) args.staffUserId = arg.slice('--staff-user-id='.length);
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (!/^[A-Z]\d{2}$/.test(args.cycleCode)) throw new Error('Cycle must be a three-character uppercase cycle code.');
  if (args.staffUserId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(args.staffUserId)) {
    throw new Error('Staff user ID must be a GUID.');
  }
  if (!path.resolve(args.receiptPath).startsWith('/private/tmp/')) {
    throw new Error('Receipt path must be under /private/tmp.');
  }
  return args;
}

function makeFixture({ cycleCode, actorSystemUserId, now, ids }) {
  const snapshot = {
    version: 1,
    cycleCode,
    facilitatorSystemUserId: actorSystemUserId,
    openedAt: now,
    excusedSystemUserIds: [],
    rehearsal: { synthetic: true, label: 'Proposal Ranking sandbox persistence rehearsal' },
    proposals: FIXTURE_REQUEST_IDS.map((requestId, index) => ({
        requestId,
        requestNumber: `REHEARSAL-${index + 1}`,
        title: `Synthetic persistence card ${index + 1}`,
        organization: 'Synthetic rehearsal fixture',
        programKey: 'se',
        leadSystemUserId: actorSystemUserId,
        amountMinorUnits: (index + 1) * 100,
        currency: { code: 'USD', name: 'US Dollar', precision: 2 },
        score: { mean: 5, displayMean: '5.0', ratedCount: 1, receivedCount: 1, distribution: { 5: 1 } },
      })),
    seedOrders: { se: [...FIXTURE_REQUEST_IDS], mr: [] },
    roster: [{ systemUserId: actorSystemUserId, name: 'Sandbox application actor' }],
    initialRoster: [actorSystemUserId],
  };
  const round = {
    wmkf_proposalrankingroundid: ids.roundId,
    wmkf_name: `${cycleCode} Proposal Ranking rehearsal ${ids.creationOperationId}`,
    wmkf_cyclecode: cycleCode,
    wmkf_creationoperationid: ids.creationOperationId,
    wmkf_snapshotjson: JSON.stringify(snapshot),
    wmkf_facilitatorsystemuserid: actorSystemUserId,
    wmkf_policyrevision: 1,
    wmkf_state: 100000000,
    wmkf_administrationlogjson: '[]',
    wmkf_lastoperationid: ids.creationOperationId,
    wmkf_lastoperationkind: 'open',
    wmkf_createdbyactorsystemuserid: actorSystemUserId,
    wmkf_createdat: now,
    wmkf_updatedbyactorsystemuserid: actorSystemUserId,
    wmkf_updatedat: now,
  };
  const list = {
    wmkf_proposalrankinglistid: ids.listId,
    wmkf_name: `${cycleCode} SE meeting rehearsal list`,
    wmkf_roundid: ids.roundId,
    wmkf_listkey: 'meeting:se',
    wmkf_programkey: 'se',
    wmkf_participantsystemuserid: null,
    wmkf_orderjson: JSON.stringify(FIXTURE_REQUEST_IDS),
    wmkf_status: 100000002,
    wmkf_version: 1,
    wmkf_compositejson: null,
    wmkf_lastoperationid: ids.creationOperationId,
    wmkf_lastoperationkind: 'open',
    wmkf_updatedbyactorsystemuserid: actorSystemUserId,
    wmkf_updatedat: now,
  };
  const coordinator = {
    existing: false,
    create: {
      wmkf_proposalrankingcycleid: ids.cycleId,
      wmkf_name: cycleCode,
      wmkf_cyclecode: cycleCode,
      wmkf_activeroundid: ids.roundId,
      wmkf_version: 1,
    },
  };
  return { coordinator, round, list, snapshot };
}

function assertRankingOnly(operations, entitySets) {
  const allowed = new Set(Object.values(entitySets));
  if (allowed.size !== 3 || [...allowed].some((value) => !ALLOWED_ENTITY_SETS.has(value))) {
    throw new Error('Proposal Ranking adapter entity sets do not match the approved three-table scope.');
  }
  for (const operation of operations) {
    const entitySet = String(operation.url || '').split(/[/(]/, 1)[0];
    if (!allowed.has(entitySet) || !['POST', 'PATCH'].includes(operation.method)) {
      throw new Error('Refusing an operation outside the three Proposal Ranking tables.');
    }
  }
}

function parseSearchStatus(body) {
  let payload;
  try { payload = typeof body?.response === 'string' ? JSON.parse(body.response) : body?.response; }
  catch { return { status: 'unverified', rankingEntityStatusListed: null, rankingTablesAbsentFromSearchStatus: null }; }
  const value = payload?.value;
  const status = typeof value?.status === 'string' ? value.status : 'unverified';
  const entries = Array.isArray(value?.entitystatusresults) ? value.entitystatusresults : null;
  if (!entries) return { status, rankingEntityStatusListed: null, rankingTablesAbsentFromSearchStatus: null };
  const logicalNames = new Set(entries.map((entry) => String(entry?.entitylogicalname || '').toLowerCase()));
  const listed = {
    cycle: logicalNames.has('wmkf_proposalrankingcycle'),
    round: logicalNames.has('wmkf_proposalrankinground'),
    list: logicalNames.has('wmkf_proposalrankinglist'),
  };
  return {
    status,
    rankingEntityStatusListed: listed,
    rankingTablesAbsentFromSearchStatus: status === 'provisioned' ? Object.values(listed).every((value) => value === false) : null,
  };
}

function isDuplicateCycleConflict(error) {
  const status = error?.status;
  const duplicateEvidence = error?.dataverseCode === '0x80040237'
    || /duplicate|alternate key|unique key|unique constraint/i.test(`${error?.dataverseCode || ''} ${error?.dataverseMessage || ''} ${error?.message || ''}`);
  return [400, 409, 412].includes(status) && duplicateEvidence;
}

function writeReceipt(receiptPath, receipt, exclusive = false) {
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { flag: exclusive ? 'wx' : 'w', mode: 0o600 });
}

function newId() { return crypto.randomUUID().toLowerCase(); }

async function getWhoAmI(client, callerId = null) {
  const headers = callerId ? { MSCRMCallerID: callerId } : undefined;
  const result = await client.get('/WhoAmI', headers);
  if (!result.ok) return { ok: false, status: result.status, userId: null };
  return { ok: true, status: result.status, userId: String(result.body?.UserId || '').toLowerCase() };
}

async function getEffectiveUserIds(client, callerId) {
  const result = await client.get(
    "/systemusers?$select=systemuserid&$filter=Microsoft.Dynamics.CRM.EqualUserId(PropertyName=@p1)&@p1='systemuserid'",
    callerId ? { MSCRMCallerID: callerId } : undefined,
  );
  if (!result.ok || !Array.isArray(result.body?.value)) return { ok: false, status: result.status, userIds: [] };
  return {
    ok: true,
    status: result.status,
    userIds: result.body.value.map((row) => String(row.systemuserid || '').toLowerCase()).filter(Boolean),
  };
}

async function inspectSearchStatus(client) {
  const result = await client.get('/searchstatus');
  if (!result.ok) return { available: false, httpStatus: result.status, status: 'unverified', rankingEntityStatusListed: null, rankingTablesAbsentFromSearchStatus: null };
  return { available: true, httpStatus: result.status, ...parseSearchStatus(result.body) };
}

async function findOrdinaryStaffCandidate(client, appUserId, requestedId = null) {
  const result = await client.get('/systemusers?$select=systemuserid,isdisabled,accessmode&$filter=isdisabled eq false and accessmode eq 0&$orderby=systemuserid asc&$top=100');
  if (!result.ok || !Array.isArray(result.body?.value)) return { candidate: null, reason: `staff-inventory-http-${result.status || 'unknown'}` };
  for (const row of result.body.value) {
    const id = String(row.systemuserid || '').toLowerCase();
    if (requestedId && id !== requestedId.toLowerCase()) continue;
    if (!id || id === appUserId || row.isdisabled !== false || row.accessmode !== 0) continue;
    const roles = await client.get(`/systemusers(${id})/systemuserroles_association?$select=roleid,name&$top=100`);
    if (!roles.ok || !Array.isArray(roles.body?.value) || roles.body['@odata.nextLink']) continue;
    if (roles.body.value.some((role) => typeof role.name !== 'string')) continue;
    const names = roles.body.value.map((role) => String(role.name || '').toLowerCase());
    if (names.some((name) => ['system administrator', 'system customizer', 'wmkf proposal ranking application user'].includes(name))) continue;
    return { candidate: id, roleCheck: 'bounded-direct-role-scan-found-no-admin-customizer-or-ranking-role; team-inherited-roles-not-checked' };
  }
  return { candidate: null, reason: 'no-verified-enabled-nonapp-user-without-elevated-or-ranking-role' };
}

async function verifyStaffFixtureReadDenial(client, staffUserId, entitySets, ids, appSystemUserId) {
  if (!staffUserId) return { attempted: false, reason: 'no-verified-staff-candidate' };
  const canonical = staffUserId.toLowerCase();
  const effective = await getEffectiveUserIds(client, canonical);
  if (!effective.ok || effective.userIds.length !== 1 || effective.userIds[0] !== canonical
    || effective.userIds[0] === String(appSystemUserId || '').toLowerCase()) {
    return { attempted: true, impersonationVerified: false, equalUserIdStatus: effective.status, fixtureReadStatuses: null };
  }
  const fixtureReadStatuses = {};
  for (const [key, entitySet] of Object.entries(entitySets)) {
    const id = ids[{ cycle: 'cycleId', round: 'roundId', list: 'listId' }[key]];
    const primaryId = { cycle: 'wmkf_proposalrankingcycleid', round: 'wmkf_proposalrankingroundid', list: 'wmkf_proposalrankinglistid' }[key];
    const result = await client.get(`/${entitySet}(${id})?$select=${primaryId}`, { MSCRMCallerID: canonical });
    fixtureReadStatuses[key] = { httpStatus: result.status, denied: result.status === 403 };
  }
  return {
    attempted: true,
    impersonationVerified: true,
    scope: 'specific-retained-fixture-rows-via-MSCRMCallerID; not a delegated staff OAuth session',
    equalUserIdStatus: effective.status,
    fixtureReadStatuses,
    allFixtureReadsDenied: Object.values(fixtureReadStatuses).every((entry) => entry.denied),
  };
}

async function readCycleAndRows(adapter, cycleCode) {
  const coordinator = await adapter.findCycleCoordinator(cycleCode);
  if (!coordinator) return { coordinator: null, round: null, lists: [] };
  const round = coordinator.wmkf_activeroundid ? await adapter.readRound(coordinator.wmkf_activeroundid) : null;
  const lists = round ? await adapter.listRoundRows(round.wmkf_proposalrankingroundid) : [];
  return { coordinator, round, lists };
}

async function run() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log('Usage: node scripts/probe-proposal-ranking-persistence.js [--cycle=D99] [--execute] [--receipt=/private/tmp/file.json] [--staff-user-id=<guid>]');
    return;
  }

  // Load local OAuth credentials, then pin every DynamicsService call to the
  // one registered sandbox regardless of a machine's default DYNAMICS_URL.
  loadEnvLocal();
  process.env.DYNAMICS_URL = SANDBOX_URL;
  if (process.env.DATAVERSE_TARGET_INTERLOCK !== 'on') throw new Error('DATAVERSE_TARGET_INTERLOCK must be explicitly on.');
  const { classifyTarget } = requireFromHere('../lib/dataverse/core/interlock.js');
  if (classifyTarget(process.env.DYNAMICS_URL) !== 'sandbox') throw new Error('The configured target is not a registered sandbox.');
  const token = await getAccessToken(SANDBOX_URL);
  const client = createClient({ resourceUrl: SANDBOX_URL, token });
  const identity = await getWhoAmI(client);
  if (!identity.ok || !identity.userId) throw new Error(`Sandbox WhoAmI failed (${identity.status || 'no response'}).`);

  const [{ withDalContext }, adapter] = await Promise.all([
    import('../lib/dataverse/core/context.js'),
    import('../lib/dataverse/adapters/proposal-ranking.js'),
  ]);
  const searchStatus = await inspectSearchStatus(client);
  const staffCandidate = await findOrdinaryStaffCandidate(client, identity.userId, args.staffUserId);
  let staffRead = {
    attempted: false,
    reason: args.execute ? 'fixture-not-created-yet' : 'read-only-preflight-does-not-create-fixture',
    candidateSystemUserId: staffCandidate.candidate,
    candidateRoleCheck: staffCandidate.roleCheck || staffCandidate.reason,
  };

  await withDalContext('proposal-ranking-persistence-rehearsal', async () => {
    const before = await adapter.findCycleCoordinator(args.cycleCode);
    if (!args.execute) {
      console.log(JSON.stringify({
        mode: 'read-only-preflight', target: new URL(SANDBOX_URL).hostname, writesPerformed: false,
        appSystemUserId: identity.userId, cycleCode: args.cycleCode,
        cycleAvailable: !before, existingCycle: before ? { id: before.wmkf_proposalrankingcycleid, activeRoundIdPresent: Boolean(before.wmkf_activeroundid) } : null,
        searchStatus, staffRead,
      }, null, 2));
      return;
    }
    if (args.cycleCode !== REHEARSAL_CYCLE) throw new Error(`Execute mode is limited to the explicit rehearsal cycle ${REHEARSAL_CYCLE}.`);
    if (before) throw new Error(`Cycle ${args.cycleCode} already exists; refusing to replace or attach to it.`);
    if (fs.existsSync(args.receiptPath)) throw new Error('Receipt already exists; refusing to issue any writes again. Use the saved IDs for readback.');

    const now = new Date().toISOString();
    const ids = {
      cycleId: newId(), roundId: newId(), listId: newId(), creationOperationId: newId(),
      saveOperationId: newId(), staleOperationId: newId(), duplicateCycleId: newId(),
      duplicateRoundId: newId(), duplicateListId: newId(), duplicateOperationId: newId(),
    };
    const fixture = makeFixture({ cycleCode: args.cycleCode, actorSystemUserId: identity.userId, now, ids });
    const receipt = {
      version: 1,
      purpose: 'Proposal Ranking sandbox persistence rehearsal; synthetic fixture only; rows retained.',
      target: new URL(SANDBOX_URL).hostname,
      cycleCode: args.cycleCode,
      actorSystemUserId: identity.userId,
      fixtureRequestIds: [...FIXTURE_REQUEST_IDS],
      ids,
      createdAt: now,
      result: 'writes-started',
    };
    writeReceipt(args.receiptPath, receipt, true);

    const initialOperations = adapter.makeOpenOperations({ coordinator: fixture.coordinator, round: fixture.round, lists: [fixture.list] });
    assertRankingOnly(initialOperations, adapter.ENTITY_SETS);
    let initializationError = null;
    try { await adapter.createRoundAndLists(initialOperations); }
    catch (error) { initializationError = error; }

    let persistedRound = await adapter.findRoundByCreationOperation(ids.creationOperationId);
    if (!persistedRound) {
      receipt.result = 'initialization-unconfirmed-no-retry';
      receipt.initializationStatus = initializationError?.status || null;
      writeReceipt(args.receiptPath, receipt);
      throw new Error('Round initialization could not be confirmed by creation operation ID; no write was retried.');
    }
    if (initializationError) console.log(`Initialization response was uncertain; creation operation readback confirmed the round (HTTP ${initializationError.status || 'unknown'}).`);
    const [coordinator, rows] = await Promise.all([
      adapter.findCycleCoordinator(args.cycleCode),
      adapter.listRoundRows(ids.roundId),
    ]);
    if (!coordinator || coordinator.wmkf_activeroundid !== ids.roundId || rows.length !== 1 || rows[0].wmkf_proposalrankinglistid !== ids.listId) {
      throw new Error('Initialization readback did not match the planned coordinator, round, and list IDs.');
    }
    const roundRow = await adapter.readRound(ids.roundId);
    const initialOrder = JSON.parse(rows[0].wmkf_orderjson);
    if (roundRow.wmkf_createdbyactorsystemuserid?.toLowerCase() !== identity.userId
      || rows[0].wmkf_updatedbyactorsystemuserid?.toLowerCase() !== identity.userId
      || JSON.stringify(initialOrder) !== JSON.stringify(FIXTURE_REQUEST_IDS)) {
      throw new Error('Initialization readback attribution or synthetic order did not match the fixture.');
    }
    staffRead = await verifyStaffFixtureReadDenial(client, staffCandidate.candidate, adapter.ENTITY_SETS, ids, identity.userId);
    staffRead.candidateSystemUserId = staffCandidate.candidate;
    staffRead.candidateRoleCheck = staffCandidate.roleCheck || staffCandidate.reason;

    const savedOrder = [...initialOrder].reverse();
    const saveAt = new Date().toISOString();
    const saveListPatch = {
      wmkf_orderjson: JSON.stringify(savedOrder),
      wmkf_version: Number(rows[0].wmkf_version) + 1,
      wmkf_lastoperationid: ids.saveOperationId,
      wmkf_lastoperationkind: 'save',
      wmkf_updatedbyactorsystemuserid: identity.userId,
      wmkf_updatedat: saveAt,
    };
    const saveRoundPatch = {
      wmkf_lastoperationid: ids.saveOperationId,
      wmkf_lastoperationkind: 'save',
      wmkf_updatedbyactorsystemuserid: identity.userId,
      wmkf_updatedat: saveAt,
    };
    await adapter.patchRoundAndList(roundRow, rows[0], saveRoundPatch, saveListPatch);
    const afterSave = await readCycleAndRows(adapter, args.cycleCode);
    const savedList = afterSave.lists[0];
    if (JSON.stringify(JSON.parse(savedList.wmkf_orderjson)) !== JSON.stringify(savedOrder)
      || afterSave.round.wmkf_lastoperationid !== ids.saveOperationId) {
      throw new Error('Conditional save did not persist the expected order and operation receipt.');
    }

    const staleList = rows[0]; // This is the real list revision captured before the successful save.
    const staleAt = new Date().toISOString();
    let staleRejected = false;
    let staleStatus = null;
    try {
      await adapter.patchRoundAndList(afterSave.round, staleList, {
        wmkf_lastoperationid: ids.staleOperationId,
        wmkf_lastoperationkind: 'save',
        wmkf_updatedbyactorsystemuserid: identity.userId,
        wmkf_updatedat: staleAt,
      }, {
        ...saveListPatch,
        wmkf_orderjson: JSON.stringify(initialOrder),
        wmkf_lastoperationid: ids.staleOperationId,
        wmkf_updatedat: staleAt,
      });
    } catch (error) {
      staleRejected = true;
      staleStatus = error.status || null;
    }
    const afterStale = await readCycleAndRows(adapter, args.cycleCode);
    const staleAtomic = staleRejected && staleStatus === 412
      && JSON.stringify(JSON.parse(afterStale.lists[0].wmkf_orderjson)) === JSON.stringify(savedOrder)
      && afterStale.round.wmkf_lastoperationid === ids.saveOperationId;
    if (!staleAtomic) throw new Error('Stale list ETag did not reject atomically; inspect the retained receipt and rows.');

    const duplicateFixture = makeFixture({
      cycleCode: args.cycleCode,
      actorSystemUserId: identity.userId,
      now: new Date().toISOString(),
      ids: { cycleId: ids.duplicateCycleId, roundId: ids.duplicateRoundId, listId: ids.duplicateListId, creationOperationId: ids.duplicateOperationId },
    });
    const duplicateOperations = adapter.makeOpenOperations({ coordinator: duplicateFixture.coordinator, round: duplicateFixture.round, lists: [duplicateFixture.list] });
    assertRankingOnly(duplicateOperations, adapter.ENTITY_SETS);
    let duplicateRejected = false;
    let duplicateStatus = null;
    try { await adapter.createRoundAndLists(duplicateOperations); }
    catch (error) {
      duplicateRejected = isDuplicateCycleConflict(error);
      duplicateStatus = error.status || null;
    }
    const [duplicateRound, duplicateLists, afterDuplicate] = await Promise.all([
      adapter.findRoundByCreationOperation(ids.duplicateOperationId),
      adapter.listRoundRows(ids.duplicateRoundId),
      readCycleAndRows(adapter, args.cycleCode),
    ]);
    const duplicateAtomic = duplicateRejected && !duplicateRound
      && duplicateLists.length === 0
      && afterDuplicate.coordinator?.wmkf_activeroundid === ids.roundId
      && afterDuplicate.lists.length === 1;
    if (!duplicateAtomic) throw new Error('Duplicate cycle create was not rejected atomically; inspect the retained receipt and rows.');

    receipt.result = 'verified-persistence';
    receipt.assertions = {
      initializeAndRead: true,
      conditionalSave: true,
      staleEtagRejectedAtomically: { passed: staleAtomic, httpStatus: staleStatus },
      duplicateCycleRejectedAtomically: { passed: duplicateAtomic, httpStatus: duplicateStatus },
      ordinaryStaffFixtureReadDenied: staffRead.allFixtureReadsDenied ?? null,
    };
    receipt.searchStatus = searchStatus;
    receipt.staffRead = staffRead;
    receipt.retained = { cycleId: ids.cycleId, roundId: ids.roundId, listId: ids.listId };
    receipt.completedAt = new Date().toISOString();
    writeReceipt(args.receiptPath, receipt);
    console.log(JSON.stringify({
      mode: 'execute', target: new URL(SANDBOX_URL).hostname, writesPerformed: true,
      receiptPath: args.receiptPath, actorSystemUserId: identity.userId,
      fixtureRequestIds: [...FIXTURE_REQUEST_IDS], assertions: receipt.assertions,
      searchStatus, staffRead, retained: receipt.retained,
    }, null, 2));
  });
}

if (require.main === module) {
  run().catch((error) => {
    const status = Number.isInteger(error?.status) ? `Dataverse request failed with HTTP ${error.status}` : 'Rehearsal stopped; internal error details omitted';
    console.error(`FATAL: ${status}`);
    process.exitCode = 1;
  });
}

module.exports = { parseArgs, makeFixture, assertRankingOnly, parseSearchStatus, isDuplicateCycleConflict, getEffectiveUserIds, verifyStaffFixtureReadDenial, REHEARSAL_CYCLE, FIXTURE_REQUEST_IDS };
