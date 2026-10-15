#!/usr/bin/env node

/**
 * Retained synthetic D26 ranking rehearsal in the registered Dataverse sandbox.
 * Default invocation is read-only preflight. --execute writes only ranking
 * coordinator/round/list rows and a private receipt; it never changes settings,
 * Requests, staff identities, or prior rehearsal records. Personas call the
 * trusted service boundary directly; this does not claim independent Microsoft
 * sign-ins. Unknown writes stay in the receipt for --readback reconciliation.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const TARGET = 'https://orgd9e66399.crm.dynamics.com';
export const CYCLE = 'D96';
export const RECEIPT_PATH = '/private/tmp/proposal-ranking-d26-d96-sandbox-receipt.json';
export const PERSONA_NAMES = Object.freeze(['Beth Pruitt', 'Justin Gallivan', 'Rob Harrison', 'Jean Kim']);
export const FACILITATOR_NAMES = Object.freeze(['Beth Pruitt', 'Justin Gallivan']);
export const PROPOSAL_COUNT = 23;
const ACTION_FAILURE_CODES = new Set(['conflict', 'stale_scope', 'stale_coordinator', 'confirmation_stale']);

export function isExactSandboxUrl(value) {
  try {
    const url = new URL(value);
    return url.origin === TARGET && url.pathname === '/' && !url.search && !url.hash && !url.username && !url.password;
  } catch { return false; }
}

export function validateHarnessPreflight({ env, cycle = CYCLE, receiptExists = false, coordinatorExists = false, activeRound = null }) {
  if (!isExactSandboxUrl(env.DYNAMICS_URL)) throw new Error('Refusing to run: DYNAMICS_URL must be the registered ranking sandbox.');
  if (env.DYNAMICS_SANDBOX_URL && !isExactSandboxUrl(env.DYNAMICS_SANDBOX_URL)) throw new Error('Refusing to run: DYNAMICS_SANDBOX_URL must be the registered ranking sandbox when set.');
  if (env.DATAVERSE_TARGET_INTERLOCK !== 'on') throw new Error('Refusing to run: DATAVERSE_TARGET_INTERLOCK must be explicitly on.');
  if (env.DATAVERSE_ALLOW_PROD_READS !== 'no') throw new Error('Refusing to run: DATAVERSE_ALLOW_PROD_READS must be no.');
  if (cycle !== CYCLE) throw new Error(`Refusing cycle ${cycle}; this harness is fixed to ${CYCLE}.`);
  if (receiptExists) throw new Error(`Receipt already exists at ${RECEIPT_PATH}; inspect it with --readback. It will never be replaced.`);
  if (coordinatorExists) throw new Error(`${CYCLE} already has a coordinator; refusing to reuse or replace it.`);
  if (activeRound) throw new Error(`${CYCLE} already has an active round; refusing to reuse or replace it.`);
  return true;
}

export function validateReceipt(receipt) {
  const guid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
  const facilitatorIdsFromRoster = Array.isArray(receipt?.roster)
    ? receipt.roster.filter(person => FACILITATOR_NAMES.includes(person.name)).map(person => person.systemUserId).sort()
    : [];
  if (!receipt || receipt.version !== 1 || receipt.target !== TARGET || receipt.cycle !== CYCLE
    || receipt.receiptPath !== RECEIPT_PATH || receipt.synthetic !== true
    || !Array.isArray(receipt.roster) || receipt.roster.length !== 4
    || !receipt.roster.every(person => PERSONA_NAMES.includes(person.name) && guid(person.systemUserId))
    || new Set(receipt.roster.map(person => person.systemUserId)).size !== 4
    || !Array.isArray(receipt.facilitatorSystemUserIds) || receipt.facilitatorSystemUserIds.length !== 2
    || !receipt.facilitatorSystemUserIds.every(guid)
    || JSON.stringify([...receipt.facilitatorSystemUserIds].sort()) !== JSON.stringify(facilitatorIdsFromRoster)
    || receipt.proposalCount !== PROPOSAL_COUNT) {
    throw new Error('The rehearsal receipt is malformed or belongs to another rehearsal.');
  }
  return receipt;
}

function loadEnvLocal() {
  const { loadEnvLocal: load } = require('../lib/dataverse/client.js');
  load();
  process.env.DYNAMICS_URL = TARGET;
  // This tool can never grant itself production-read permission.
  process.env.DATAVERSE_ALLOW_PROD_READS = 'no';
}

function writeInitialReceipt(receipt) {
  // wx is an atomic refusal if a different process created this receipt after preflight.
  const fd = openSync(RECEIPT_PATH, 'wx', 0o600);
  try { writeFileSync(fd, `${JSON.stringify(receipt, null, 2)}\n`); }
  finally { require('node:fs').closeSync(fd); }
}

function updateReceipt(receipt) {
  validateReceipt(receipt);
  const tempPath = `${RECEIPT_PATH}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(tempPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    chmodSync(tempPath, 0o600);
    renameSync(tempPath, RECEIPT_PATH);
    chmodSync(RECEIPT_PATH, 0o600);
  } finally {
    try { if (existsSync(tempPath)) unlinkSync(tempPath); } catch { /* preserve original error */ }
  }
}

function readReceipt() {
  if (!existsSync(RECEIPT_PATH)) throw new Error(`No rehearsal receipt exists at ${RECEIPT_PATH}.`);
  const stat = lstatSync(RECEIPT_PATH);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) throw new Error('The rehearsal receipt must be a private regular file (mode 0600).');
  return validateReceipt(JSON.parse(readFileSync(RECEIPT_PATH, 'utf8')));
}

function makeProposals(roster) {
  return Array.from({ length: PROPOSAL_COUNT }, (_, i) => {
    const n = i + 1;
    return {
      requestId: randomUUID(),
      requestNumber: `D26-SYN-${String(n).padStart(2, '0')}`,
      title: `Synthetic D26 research proposal ${n}`,
      organization: `Sandbox Demonstration Institution ${n}`,
      programKey: i % 2 === 0 ? 'mr' : 'se',
      leadSystemUserId: roster[i % roster.length].systemUserId,
      amountMinorUnits: (n + 3) * 125000,
      currency: { code: 'USD', name: 'US Dollar', precision: 2 },
      institutionGeography: i % 3 === 0 ? 'East' : 'West',
      researchFunding: { status: 'available', qualifyingGrantCount: i % 4, latestAwardYear: i % 4 ? 2024 : null },
      score: {
        mean: Number((4.9 - i * 0.07).toFixed(2)),
        displayMean: (4.9 - i * 0.07).toFixed(2),
        ratedCount: 3,
        receivedCount: 3,
        distribution: { Excellent: 2, 'Very Good': 1 },
      },
    };
  });
}

function syntheticAssessment(list, variant) {
  const order = [...list.order];
  // Deterministic, distinct rotations make each persona's private ordering a sentinel.
  const shift = variant % order.length;
  const rotated = [...order.slice(shift), ...order.slice(0, shift)];
  return {
    ...list,
    order: rotated,
    boundaries: list.boundaries?.length ? [...list.boundaries] : [Math.floor(rotated.length / 3), Math.floor((rotated.length * 2) / 3)],
    confidence: Object.fromEntries(rotated.map((id, i) => [id, (i + variant) % 2 ? 'not-sure' : 'confident'])),
  };
}

export function operationBody(view, action, operationId, extra = {}) {
  const key = action === 'resetProgram' ? `resetProgram:${extra.programKey}` : action;
  return {
    action,
    roundId: view.roundId,
    operationId,
    roundEtag: view.round.etag,
    policyRevision: view.round.policyRevision,
    preparationVersion: view.workflow.preparationVersion,
    revealId: view.workflow.revealId,
    ...(view.confirmations[key] ? { confirmationFingerprint: view.confirmations[key].fingerprint } : {}),
    ...(extra.programKey !== undefined ? { programKey: extra.programKey } : {}),
    ...(extra.assessment !== undefined ? { assessment: extra.assessment } : {}),
    ...(extra.listVersion !== undefined ? { listVersion: extra.listVersion } : {}),
    ...(extra.order !== undefined ? { order: extra.order } : {}),
    ...(extra.boundaries !== undefined ? { boundaries: extra.boundaries } : {}),
  };
}

async function main() {
  const flags = new Set(process.argv.slice(2));
  for (const flag of flags) assert.ok(['--execute', '--readback'].includes(flag), `Unknown option ${flag}`);
  assert.ok(!(flags.has('--execute') && flags.has('--readback')), 'Choose --execute or --readback.');
  loadEnvLocal();
  if (!isExactSandboxUrl(process.env.DYNAMICS_URL)
    || (process.env.DYNAMICS_SANDBOX_URL && !isExactSandboxUrl(process.env.DYNAMICS_SANDBOX_URL))
    || process.env.DATAVERSE_TARGET_INTERLOCK !== 'on'
    || process.env.DATAVERSE_ALLOW_PROD_READS !== 'no') {
    throw new Error('Refusing to connect: exact sandbox target, explicit interlock on, and production reads disabled are required.');
  }
  const { getAccessToken, createClient } = require('../lib/dataverse/client.js');
  const client = createClient({ resourceUrl: TARGET, token: await getAccessToken(TARGET) });
  const interlock = await import('../lib/dataverse/core/interlock.js');
  if (interlock.classifyTarget(TARGET) !== 'sandbox') throw new Error('Target registry does not classify the fixed host as sandbox.');
  if (!flags.has('--readback')) {
    const adapter = await import('../lib/dataverse/adapters/proposal-ranking.js');
    const withContext = await import('../lib/dataverse/core/context.js');
    const usersResponse = await client.get('/systemusers?$select=systemuserid,fullname,isdisabled,accessmode&$filter=isdisabled eq false and accessmode eq 0&$top=200');
    if (!usersResponse.ok || usersResponse.body['@odata.nextLink']) throw new Error('Could not completely resolve enabled sandbox staff.');
    const roster = PERSONA_NAMES.map(name => {
      const matches = usersResponse.body.value.filter(user => user.fullname === name);
      if (matches.length !== 1) throw new Error(`Expected exactly one enabled sandbox persona named ${name}.`);
      return { systemUserId: matches[0].systemuserid, name };
    });
    const facilitatorSystemUserIds = roster
      .filter(person => FACILITATOR_NAMES.includes(person.name))
      .map(person => person.systemUserId)
      .sort();
    if (facilitatorSystemUserIds.length !== 2) throw new Error('Beth and Justin must both resolve as enabled sandbox systemusers.');
    const coordinator = await withContext.withDalContext('proposal-ranking-d26-sandbox-preflight', () => adapter.findCycleCoordinator(CYCLE));
    const preflight = {
      target: TARGET,
      cycle: CYCLE,
      mode: flags.has('--execute') ? 'execute' : 'read-only preflight',
      cycleAvailable: !coordinator,
      activeRoundId: coordinator?.wmkf_activeroundid || null,
      receiptAvailable: !existsSync(RECEIPT_PATH),
      personas: roster.map(({ name }) => ({ name, enabledSandboxSystemuser: true })),
      capturedFacilitatorNames: FACILITATOR_NAMES,
      profileMappingChecked: false,
      proposalRankingGrantChecked: false,
      independentSsoChecked: false,
      proposalCount: PROPOSAL_COUNT,
      writesAllowedByInterlock: process.env.DATAVERSE_TARGET_INTERLOCK === 'on',
    };
    console.log(JSON.stringify(preflight, null, 2));
    if (!flags.has('--execute')) return;
    validateHarnessPreflight({ env: process.env, receiptExists: existsSync(RECEIPT_PATH), coordinatorExists: Boolean(coordinator), activeRound: coordinator?.wmkf_activeroundid || null });
    // The adapter's Dataverse HTTP seam enforces the registered sandbox write
    // classification for every create and changeset below.
    const { withDalContext: withDal } = withContext;
    await withDal('proposal-ranking-d26-sandbox-rehearsal', async () => {
      const workflow = await import('../lib/services/proposal-ranking/workflow-service.js');
      const { buildSeedOrder } = await import('../lib/services/proposal-ranking/calculations.js');
      const proposals = makeProposals(roster);
      const snapshot = {
        version: 2,
        cycleCode: CYCLE,
        openedAt: new Date().toISOString(),
        rehearsal: { synthetic: true, label: 'D26 23-proposal four-person retained rehearsal', facilitationRevisionIsSynthetic: true },
        proposals,
        roster,
        seedOrders: Object.fromEntries(['mr', 'se'].map(program => [program, buildSeedOrder(proposals.filter(p => p.programKey === program))])),
      };
      const roundId = randomUUID();
      const creationOperationId = randomUUID();
      const now = new Date().toISOString();
      const settingRevisionMarker = `sandbox-rehearsal:${randomUUID()}`;
      const facilitation = {
        version: 1,
        systemUserIds: facilitatorSystemUserIds,
        source: 'set',
        settingRevision: settingRevisionMarker,
      };
      const initial = workflow.makeInitialWorkflowRecords(snapshot, roundId, roster[0].systemUserId, creationOperationId, now, facilitation);
      const round = {
        wmkf_proposalrankingroundid: roundId,
        wmkf_name: 'D26 23-proposal synthetic ranking rehearsal',
        wmkf_cyclecode: CYCLE,
        wmkf_creationoperationid: creationOperationId,
        wmkf_snapshotjson: JSON.stringify(snapshot),
        wmkf_workflowjson: JSON.stringify(initial.workflow),
        wmkf_facilitatorsystemuserid: facilitatorSystemUserIds[0],
        wmkf_policyrevision: 1,
        wmkf_state: 100000000,
        wmkf_administrationlogjson: '[]',
        wmkf_lastoperationid: creationOperationId,
        wmkf_lastoperationkind: 'open',
        wmkf_createdbyactorsystemuserid: roster[0].systemUserId,
        wmkf_createdat: now,
        wmkf_updatedbyactorsystemuserid: roster[0].systemUserId,
        wmkf_updatedat: now,
      };
      const receipt = {
        version: 1, target: TARGET, cycle: CYCLE, receiptPath: RECEIPT_PATH,
        synthetic: true, createdAt: now, proposalCount: PROPOSAL_COUNT,
        facilitationProvenance: 'Synthetic fixture marker; this direct persistence rehearsal does not prove service preview/open setting-revision capture.',
        identityVerificationScope: 'Enabled sandbox Dataverse systemusers only; active profile mapping, application grants, route authorization and independent SSO are not tested.',
        roster, facilitatorSystemUserIds,
        authenticationScope: 'trusted direct service personas; no independent Microsoft SSO sessions',
        initialRoundId: roundId, roundId, roundIds: [roundId], checks: [], stage: 'creating',
        pendingCreate: { creationOperationId, roundId, round, lists: initial.lists, workflow: initial.workflow },
      };
      writeInitialReceipt(receipt);
      const operations = await import('../lib/dataverse/adapters/proposal-ranking.js');
      await operations.createRoundAndLists(operations.makeOpenOperations({
        coordinator: { existing: false, create: {
          wmkf_proposalrankingcycleid: randomUUID(), wmkf_name: CYCLE,
          wmkf_cyclecode: CYCLE, wmkf_activeroundid: roundId, wmkf_version: 1,
        } },
        round, lists: initial.lists,
      }));
      receipt.pendingCreate = null;
      receipt.stage = 'initialized';
      updateReceipt(receipt);
      await runRehearsal({ receipt, workflow, roster });
    });
    return;
  }

  const receipt = readReceipt();
  const adapter = await import('../lib/dataverse/adapters/proposal-ranking.js');
  const { withDalContext } = await import('../lib/dataverse/core/context.js');
  await withDalContext('proposal-ranking-d26-sandbox-readback', async () => {
    if (receipt.pendingCreate) {
      const found = await adapter.findRoundByCreationOperation(receipt.pendingCreate.creationOperationId);
      const coordinator = await adapter.findCycleCoordinator(CYCLE);
      if (!found) {
        console.log(JSON.stringify({ status: 'creation-not-yet-confirmed', cycle: CYCLE, receipt: RECEIPT_PATH, coordinatorHasRound: Boolean(coordinator?.wmkf_activeroundid) }, null, 2));
        return;
      }
      if (coordinator?.wmkf_activeroundid !== found.wmkf_proposalrankingroundid) {
        console.log(JSON.stringify({ status: 'creation-found-but-coordinator-mismatch', cycle: CYCLE, foundRoundId: found.wmkf_proposalrankingroundid, coordinatorRoundId: coordinator?.wmkf_activeroundid || null, receipt: RECEIPT_PATH }, null, 2));
        return;
      }
      receipt.roundId = found.wmkf_proposalrankingroundid;
      if (!receipt.roundIds.includes(receipt.roundId)) receipt.roundIds.push(receipt.roundId);
      receipt.pendingCreate = null;
      receipt.stage = 'initialized';
      updateReceipt(receipt);
    }
    const workflow = await import('../lib/services/proposal-ranking/workflow-service.js');
    const reconciled = [];
    for (const pending of receipt.pendingOperations || []) {
      const result = await workflow.readWorkflowRound({ roundId: pending.body.roundId, actor: pending.actor, operationId: pending.body.operationId });
      reconciled.push({ operationId: pending.body.operationId, status: result.operation?.status || 'unknown', result: result.operation?.result || null });
      if (result.operation?.status === 'confirmed' && result.operation.result?.roundId && !receipt.roundIds.includes(result.operation.result.roundId)) {
        receipt.roundId = result.operation.result.roundId;
        receipt.roundIds.push(receipt.roundId);
      }
    }
    console.log(JSON.stringify({ cycle: CYCLE, roundId: receipt.roundId, stage: receipt.stage, pendingOperations: reconciled, receipt: RECEIPT_PATH }, null, 2));
  });
}

async function runRehearsal({ receipt, workflow, roster }) {
  const save = () => updateReceipt(receipt);
  const check = label => { receipt.checks.push({ label, at: new Date().toISOString() }); save(); console.log(`PASS ${label}`); };
  const read = (actor, roundId = receipt.roundId, operationId = null) => workflow.readWorkflowRound({ roundId, actor, operationId });
  async function send(action, actor, extra = {}) {
    const view = await read(actor);
    const body = operationBody(view, action, randomUUID(), extra);
    receipt.pendingOperations = [{ actor, body }];
    save();
    const result = await workflow.mutateWorkflow({ body, actor });
    receipt.pendingOperations = [];
    if (result.roundId !== receipt.roundId) {
      receipt.roundId = result.roundId;
      receipt.roundIds.push(result.roundId);
    }
    save();
    return result;
  }
  async function prepare(actor, variant) {
    let view = await read(actor);
    if (view.own.ready) await send('reopenOwn', actor);
    for (const programKey of ['mr', 'se']) {
      view = await read(actor);
      await send('saveAssessment', actor, {
        programKey,
        listVersion: view.own[programKey].version,
        assessment: syntheticAssessment(view.own[programKey], variant + (programKey === 'se' ? 1 : 0)),
      });
    }
    await send('buildCombined', actor);
    await send('confirmCombined', actor);
    await send('ready', actor);
  }
  async function prepareAll() {
    for (let i = 0; i < roster.length; i++) await prepare(roster[i].systemUserId, i + 1);
  }
  async function race(action, actors, extraForActor = () => ({})) {
    const requests = [];
    const baseViews = [];
    for (const actor of actors) {
      const view = await read(actor);
      baseViews.push(view);
      requests.push({ actor, body: operationBody(view, action, randomUUID(), extraForActor(view, actor)) });
    }
    assert.ok(requests.every(request => request.body.roundEtag === requests[0].body.roundEtag), `${action} actors must race the same persisted ETag`);
    assert.ok(requests.every(request => request.body.preparationVersion === requests[0].body.preparationVersion && request.body.revealId === requests[0].body.revealId), `${action} actors must race the same workflow generation`);
    // Preserve both exact ETag-scoped attempts before either write can reach Dataverse.
    receipt.pendingOperations = requests;
    save();
    const results = await Promise.allSettled(requests.map(({ actor, body }) => workflow.mutateWorkflow({ body, actor })));
    const winners = results.filter(result => result.status === 'fulfilled');
    const losers = results.filter(result => result.status === 'rejected');
    assert.equal(winners.length, 1, `${action} must have exactly one committed actor`);
    assert.equal(losers.length, 1, `${action} must reject the stale concurrent actor`);
    const code = losers[0].reason?.code;
    assert.ok(ACTION_FAILURE_CODES.has(code), `${action} loser must receive an explicit stale/conflict result, got ${code || losers[0].reason?.message}`);
    const winnerRequest = requests[results.findIndex(result => result.status === 'fulfilled')];
    const loserRequest = requests[results.findIndex(result => result.status === 'rejected')];
    const next = winners[0].value;
    const adapter = await import('../lib/dataverse/adapters/proposal-ranking.js');
    const winningOperationId = winnerRequest.body.operationId;
    const receiptRows = await adapter.readAssessmentRows(winnerRequest.body.roundId, [`o:${winningOperationId}`]);
    assert.equal(receiptRows.length, 1, `${action} operation receipt must persist exactly once`);
    const persistedReceipt = JSON.parse(receiptRows[0].wmkf_assessmentjson);
    assert.equal(persistedReceipt.actor, winnerRequest.actor, `${action} receipt must preserve the actual acting persona`);
    assert.equal(persistedReceipt.outcome.action, action);
    const loserRows = await adapter.readAssessmentRows(loserRequest.body.roundId, [`o:${loserRequest.body.operationId}`]);
    assert.equal(loserRows.length, 0, `${action} rejected actor must not have a persisted operation receipt`);
    const oldRound = await adapter.readAssessmentRound(winnerRequest.body.roundId);
    assert.equal(oldRound.wmkf_lastoperationid, winningOperationId, `${action} round must retain the winning operation stamp`);
    let effective;
    if (action === 'restartWalkthrough') effective = await read(winnerRequest.actor, next.roundId);
    else effective = await read(winnerRequest.actor, winnerRequest.body.roundId);
    if (action === 'reveal') {
      assert.equal(effective.workflow.stage, 'revealed');
      assert.equal(effective.workflow.revealId, winningOperationId);
      assert.equal(effective.workflow.historyCount, baseViews[0].workflow.historyCount + 1);
    } else if (action === 'editCollective') {
      assert.equal(effective.workflow.stage, 'revealed');
      assert.equal(effective.collective.version, baseViews[0].collective.version + 1);
      assert.equal(effective.workflow.historyCount, baseViews[0].workflow.historyCount);
    } else if (action === 'reopenPreparation') {
      assert.equal(effective.workflow.stage, 'private');
      assert.equal(effective.workflow.preparationVersion, baseViews[0].workflow.preparationVersion + 1);
      assert.equal(effective.collective, null);
      assert.ok(effective.workflow.historyCount > baseViews[0].workflow.historyCount);
    } else if (action === 'restartWalkthrough') {
      const prior = await read(winnerRequest.actor, winnerRequest.body.roundId);
      assert.equal(prior.round.state, 'canceled');
      assert.equal(prior.workflow.supersededBy, next.roundId);
      assert.equal(effective.workflow.stage, 'private');
      assert.equal(effective.workflow.preparationVersion, 1);
      assert.equal(effective.workflow.previousRoundId, winnerRequest.body.roundId);
      assert.equal(effective.workflow.historyCount, 0);
      assert.equal(prior.workflow.historyCount, baseViews[0].workflow.historyCount);
    }
    receipt.races ||= [];
    receipt.races.push({ action, winnerActor: winnerRequest.actor, winnerOperationId: winningOperationId, loserActor: loserRequest.actor, loserOperationId: loserRequest.body.operationId, loserCode: code, sourceRoundId: winnerRequest.body.roundId, roundId: next.roundId, at: new Date().toISOString() });
    if (next.roundId !== receipt.roundId) {
      receipt.roundId = next.roundId;
      receipt.roundIds.push(next.roundId);
    }
    if (action === 'restartWalkthrough') {
      const coordinator = await adapter.findCycleCoordinator(CYCLE);
      assert.equal(coordinator?.wmkf_activeroundid, next.roundId, 'Coordinator readback must point at the committed successor.');
      const successor = await adapter.readAssessmentRound(next.roundId);
      assert.equal(successor.wmkf_createdbyactorsystemuserid, winnerRequest.actor, 'Successor round must retain the restart actor.');
      const history = await workflow.readWorkflowHistory({ roundId: winnerRequest.body.roundId, actor: winnerRequest.actor });
      assert.ok(history.entries.some(entry => entry.kind === 'reveal'), 'The prior revealed state must remain in retained history.');
      assert.ok(history.entries.every(entry => !(entry.kind === 'reveal' && entry.individuals.some(individual => Object.hasOwn(individual, 'ready')))), 'History must omit other actors’ ready/operation metadata.');
      receipt.lastReadback = { coordinatorRoundId: coordinator.wmkf_activeroundid, priorHistoryEntries: history.entries.length, restartActor: successor.wmkf_createdbyactorsystemuserid };
    }
    // Keep both recovery handles on disk until both the winner and rejected
    // actor have been checked against persisted operation receipts and state.
    receipt.pendingOperations = [];
    save();
    return next;
  }

  // Reconcile public reads with four distinct private order sentinels.
  for (let i = 0; i < roster.length; i++) await prepare(roster[i].systemUserId, i + 1);
  const privateViews = await Promise.all(roster.map(person => read(person.systemUserId)));
  for (let i = 0; i < roster.length; i++) {
    const peerSentinelOrders = roster.filter((_, j) => j !== i).map((_, j) => privateViews[(i + j + 1) % roster.length].own.mr.order);
    assert.equal(privateViews[i].facilitatorLists, null);
    assert.ok(!Object.hasOwn(privateViews[i], 'participants'));
    for (const order of peerSentinelOrders) assert.ok(!JSON.stringify(privateViews[i]).includes(JSON.stringify(order)), 'A peer private order leaked into the public response.');
  }
  check('four distinct private preparations remain actor-only');

  await race('reveal', receipt.facilitatorSystemUserIds);
  let revealed = await read(receipt.facilitatorSystemUserIds[0]);
  assert.equal(revealed.workflow.stage, 'revealed');
  assert.equal(revealed.workflow.facilitation.systemUserIds.length, 2);
  assert.equal(revealed.facilitatorLists, null);
  check('persisted two-facilitator reveal race has one winner');

  await race('editCollective', receipt.facilitatorSystemUserIds, view => ({
    listVersion: view.collective.version,
    order: [...view.collective.order].reverse(),
    boundaries: [...view.collective.boundaries].reverse().sort((a, b) => a - b),
  }));
  check('persisted two-facilitator collective edit race has one winner');

  await race('reopenPreparation', receipt.facilitatorSystemUserIds);
  const reopened = await read(receipt.facilitatorSystemUserIds[0]);
  assert.equal(reopened.workflow.stage, 'private');
  assert.equal(reopened.collective, null);
  assert.equal(reopened.workflow.facilitation.systemUserIds.length, 2);
  check('reopen keeps the captured facilitator set and hides the new private version');

  await prepareAll();
  await race('restartWalkthrough', receipt.facilitatorSystemUserIds);
  const afterRestart = await read(receipt.facilitatorSystemUserIds[0]);
  assert.equal(afterRestart.workflow.stage, 'private');
  assert.deepEqual([...afterRestart.workflow.facilitation.systemUserIds].sort(), [...receipt.facilitatorSystemUserIds].sort());
  assert.equal(afterRestart.round.snapshot.proposals.length, PROPOSAL_COUNT);
  assert.equal(afterRestart.round.snapshot.roster.length, 4);
  check('persisted restart preserves 23 proposals, four captured people, and both facilitators');

  await prepareAll();
  await race('reveal', receipt.facilitatorSystemUserIds);
  const current = await read(receipt.facilitatorSystemUserIds[0]);
  const supplement = {
    action: 'exportWorkbook', roundId: current.roundId, roundEtag: current.round.etag,
    preparationVersion: current.workflow.preparationVersion, revealId: current.workflow.revealId,
    listVersion: current.collective.version,
  };
  const workbookResult = await workflow.readWorkflowSupplement({ body: supplement, actor: receipt.facilitatorSystemUserIds[0] });
  const ExcelJS = require('exceljs');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(workbookResult.base64, 'base64'));
  assert.equal(workbook.worksheets.length, 2);
  assert.equal(workbook.getWorksheet('Group recommendation').rowCount, PROPOSAL_COUNT + 3);
  assert.equal(workbook.getWorksheet('Individual assessments').rowCount, PROPOSAL_COUNT * roster.length + 3);
  const allCells = workbook.worksheets.flatMap(sheet => sheet.getSheetValues().flat()).join(' ');
  for (const proposal of current.round.snapshot.proposals) assert.ok(allCells.includes(proposal.requestNumber), `Workbook omitted ${proposal.requestNumber}.`);
  assert.equal(current.collective.individuals.length, roster.length);
  assert.ok(current.collective.individuals.every(individual => individual.order.length === PROPOSAL_COUNT));
  assert.equal(current.collective.individuals.reduce((total, individual) => total + individual.order.length, 0), PROPOSAL_COUNT * roster.length);
  check('revealed workbook contains all 23 synthetic proposals and 92 captured assessments');

  receipt.stage = 'passed';
  receipt.completedAt = new Date().toISOString();
  receipt.pendingOperations = [];
  save();
  console.log(JSON.stringify({ stage: receipt.stage, cycle: CYCLE, roundId: receipt.roundId, retainedRoundIds: receipt.roundIds, checks: receipt.checks.length, receipt: RECEIPT_PATH }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(`${error.code || 'rehearsal_error'}: ${error.message || error}`);
    process.exitCode = 1;
  });
}
