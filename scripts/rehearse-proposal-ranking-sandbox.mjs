#!/usr/bin/env node
/**
 * Retained, synthetic Proposal Ranking v2 rehearsal against the registered sandbox.
 * No production writes, source-request changes, email, provider or Postgres writes.
 * Uses verified sandbox staff identities at the trusted service boundary; does not
 * claim independent Microsoft login sessions. Default is read-only preflight.
 * --execute initializes D98 only when absent; --resume uses this script's receipt.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const {
  loadEnvLocal,
  getAccessToken,
  createClient
} = require('../lib/dataverse/client.js');
loadEnvLocal();
const TARGET = 'https://orgd9e66399.crm.dynamics.com';
process.env.DYNAMICS_URL = TARGET;
const {
  classifyTarget
} = await import('../lib/dataverse/core/interlock.js');
assert.equal(classifyTarget(TARGET), 'sandbox');
assert.equal(process.env.DATAVERSE_TARGET_INTERLOCK, 'on');
const {
  withDalContext
} = await import('../lib/dataverse/core/context.js');
const adapter = await import('../lib/dataverse/adapters/proposal-ranking.js');
const workflow = await import('../lib/services/proposal-ranking/workflow-service.js');
const { RANKING_TEST_FACILITATOR_NAMES } = await import('../lib/services/proposal-ranking/test-policy.js');
const {
  readDefaultFacilitator,
  saveDefaultFacilitator
} = await import('../lib/services/proposal-ranking/config.js');
const {
  buildSeedOrder
} = await import('../lib/services/proposal-ranking/calculations.js');
const client = createClient({
  resourceUrl: TARGET,
  token: await getAccessToken(TARGET)
});
const CYCLE = 'D98';
const RECEIPT = '/private/tmp/proposal-ranking-v2-sandbox-receipt.json';
const names = [...RANKING_TEST_FACILITATOR_NAMES, 'Rob Harrison', 'Jean Kim'];
const execute = process.argv.includes('--execute');
const resume = process.argv.includes('--resume');
const readOnly = process.argv.includes('--readback');
for (const arg of process.argv.slice(2)) assert.ok(['--execute', '--resume', '--readback'].includes(arg), 'Unknown option');
const response = await client.get('/systemusers?$select=systemuserid,fullname,isdisabled,accessmode&$filter=isdisabled eq false and accessmode eq 0&$top=100');
assert.ok(response.ok && !response.body['@odata.nextLink']);
const roster = names.map(name => {
  const matches = response.body.value.filter(x => x.fullname === name);
  assert.equal(matches.length, 1);
  return {
    systemUserId: matches[0].systemuserid,
    name
  };
});
const facilitator = roster[0].systemUserId;
let receipt;
const save = () => writeFileSync(RECEIPT, JSON.stringify(receipt, null, 2) + '\n', {
  mode: 0o600
});
await withDalContext('proposal-ranking-v2-sandbox-rehearsal', async () => {
  const configured = await readDefaultFacilitator();
  const coordinator = await adapter.findCycleCoordinator(CYCLE);
  if (!execute && !resume && !readOnly) {
    console.log(JSON.stringify({
      target: TARGET,
      cycle: CYCLE,
      available: !coordinator,
      roster,
      facilitatorConfigured: configured.configured
    }, null, 2));
    return;
  }
  if (resume || readOnly) {
    receipt = JSON.parse(readFileSync(RECEIPT, 'utf8'));
    assert.equal(receipt.target, TARGET);
    assert.equal(receipt.cycle, CYCLE);
    assert.deepEqual(receipt.roster, roster);
  } else {
    assert.ok(!coordinator, 'D98 exists; refusing replacement. Use saved receipt.');
    assert.ok(!existsSync(RECEIPT), 'Receipt exists; inspect/resume, never replace.');
    if (configured.configured) assert.equal(configured.systemUserId, facilitator, 'Existing facilitator differs; no silent change');else await saveDefaultFacilitator(facilitator, null, null);
    assert.equal((await readDefaultFacilitator()).systemUserId, facilitator);
    const now = new Date().toISOString(),
      roundId = randomUUID(),
      operationId = randomUUID();
    const proposals = Array.from({
      length: 6
    }, (_, i) => ({
      requestId: randomUUID(),
      requestNumber: `REHEARSAL-${i + 1}`,
      title: `Fictional ${i % 2 ? 'medical' : 'science'} research proposal ${i + 1}`,
      organization: `Sandbox Example Institution ${i + 1}`,
      programKey: i % 2 ? 'mr' : 'se',
      leadSystemUserId: roster[i % 4].systemUserId,
      amountMinorUnits: (i + 1) * 1000000,
      currency: {
        code: 'USD',
        name: 'US Dollar',
        precision: 2
      },
      institutionGeography: i % 3 ? 'West' : 'East',
      researchFunding: {
        status: 'available',
        qualifyingGrantCount: i % 3,
        latestAwardYear: i % 3 ? 2024 : null
      },
      score: {
        mean: 5 - i / 3,
        displayMean: (5 - i / 3).toFixed(1),
        ratedCount: 3,
        receivedCount: 3,
        distribution: Object.fromEntries(['Excellent', 'Very Good', 'Good', 'Fair', 'Poor'].map((label, index) => [label, [0, 1, 2].filter(offset => 5 - Math.floor((i + offset) / 3) === 5 - index).length]))
      }
    }));
    const snapshot = {
      version: 2,
      cycleCode: CYCLE,
      facilitatorSystemUserId: facilitator,
      openedAt: now,
      rehearsal: {
        synthetic: true,
        label: 'Retained sandbox v2 multi-person rehearsal'
      },
      proposals,
      roster,
      seedOrders: Object.fromEntries(['mr', 'se'].map(p => [p, buildSeedOrder(proposals.filter(x => x.programKey === p))]))
    };
    const initial = workflow.makeInitialWorkflowRecords(snapshot, roundId, facilitator, operationId, now);
    const round = {
      wmkf_proposalrankingroundid: roundId,
      wmkf_name: 'D98 Synthetic v2 sandbox walkthrough',
      wmkf_cyclecode: CYCLE,
      wmkf_creationoperationid: operationId,
      wmkf_snapshotjson: JSON.stringify(snapshot),
      wmkf_workflowjson: JSON.stringify(initial.workflow),
      wmkf_facilitatorsystemuserid: facilitator,
      wmkf_policyrevision: 1,
      wmkf_state: 100000000,
      wmkf_administrationlogjson: '[]',
      wmkf_lastoperationid: operationId,
      wmkf_lastoperationkind: 'open',
      wmkf_createdbyactorsystemuserid: facilitator,
      wmkf_createdat: now,
      wmkf_updatedbyactorsystemuserid: facilitator,
      wmkf_updatedat: now
    };
    receipt = {
      target: TARGET,
      cycle: CYCLE,
      roster,
      createdAt: now,
      initialRoundId: roundId,
      roundId,
      roundIds: [roundId],
      checks: [],
      stage: 'initializing',
      authenticationScope: 'trusted service personas; no independent SSO sessions'
    };
    save();
    await adapter.createRoundAndLists(adapter.makeOpenOperations({
      coordinator: {
        existing: false,
        create: {
          wmkf_proposalrankingcycleid: randomUUID(),
          wmkf_name: CYCLE,
          wmkf_cyclecode: CYCLE,
          wmkf_activeroundid: roundId,
          wmkf_version: 1
        }
      },
      round,
      lists: initial.lists
    }));
    receipt.stage = 'initialized';
    save();
  }
  const read = (actor = facilitator, roundId = receipt.roundId) => workflow.readWorkflowRound({
    roundId,
    actor
  });
  if (readOnly) {
    const current = await adapter.findCycleCoordinator(CYCLE);
    const v = await read(facilitator, current.wmkf_activeroundid);
    console.log(JSON.stringify({
      roundId: v.roundId,
      stage: v.workflow.stage,
      progress: v.progress,
      historyCount: v.workflow.historyCount,
      receipt
    }, null, 2));
    return;
  }
  const check = label => {
    receipt.checks.push({
      label,
      at: new Date().toISOString()
    });
    save();
    console.log('PASS ' + label);
  };
  async function send(action, actor = facilitator, extra = {}) {
    const v = await read(actor),
      key = action === 'resetProgram' ? `resetProgram:${extra.programKey}` : action;
    const body = {
      action,
      roundId: v.roundId,
      operationId: randomUUID(),
      roundEtag: v.round.etag,
      policyRevision: v.round.policyRevision,
      preparationVersion: v.workflow.preparationVersion,
      revealId: v.workflow.revealId,
      ...(v.confirmations[key] ? {
        confirmationFingerprint: v.confirmations[key].fingerprint
      } : {}),
      ...extra
    };
    receipt.pending = body;
    receipt.pendingActor = actor;
    save();
    const next = await workflow.mutateWorkflow({
      body,
      actor
    });
    receipt.pending = null;
    receipt.pendingActor = null;
    if (next.roundId !== receipt.roundId) {
      receipt.roundId = next.roundId;
      receipt.roundIds.push(next.roundId);
    }
    save();
    return {
      body,
      next
    };
  }
  async function prepare(actor) {
    let v = await read(actor);
    if (v.own.ready) await send('reopenOwn', actor);
    for (const programKey of ['mr', 'se']) {
      v = await read(actor);
      const list = v.own[programKey];
      await send('saveAssessment', actor, {
        programKey,
        listVersion: list.version,
        assessment: {
          order: list.order,
          boundaries: list.boundaries,
          confidence: Object.fromEntries(list.order.map((id, i) => [id, i % 2 ? 'not-sure' : 'confident']))
        }
      });
    }
    await send('buildCombined', actor);
    await send('confirmCombined', actor);
    await send('ready', actor);
  }
  async function prepareAll() {
    for (const p of roster) await prepare(p.systemUserId);
  }
  async function restart(label) {
    const old = receipt.roundId;
    await send('restartWalkthrough');
    const prior = await read(facilitator, old),
      v = await read();
    assert.equal(prior.round.state, 'canceled');
    assert.equal(prior.workflow.supersededBy, v.roundId);
    assert.equal(v.workflow.stage, 'private');
    assert.ok(v.progress.every(x => !x.ready));
    assert.equal(v.own.co, null);
    assert.deepEqual(v.own.mr.confidence, {});
    check(label);
  }
  if (receipt.pending) throw new Error('Prior operation needs explicit receipt reconciliation before resuming');
  // Each full rerun starts a new retained run, including when an earlier attempt stopped.
  if (resume) await restart('resume starts fresh retained run');
  await restart('restart at initial private stage');
  for (const p of roster) for (const programKey of ['mr', 'se']) {
    await send('resetProgram', p.systemUserId, {
      programKey
    });
    const v = await read(p.systemUserId);
    assert.deepEqual(v.own[programKey].order, v.round.snapshot.seedOrders[programKey]);
    assert.deepEqual(v.own[programKey].confidence, {});
  }
  check('each PD resets both initial program lists');
  await prepareAll();
  const privateView = await read(roster[1].systemUserId);
  assert.equal(privateView.facilitatorLists, null);
  assert.equal(privateView.collective, null);
  const outsider = randomUUID();
  await assert.rejects(() => read(outsider), e => e.status === 403);
  const admin = await workflow.readWorkflowRound({
    roundId: receipt.roundId,
    actor: outsider,
    isSuperuser: true
  });
  assert.equal(admin.own, null);
  assert.equal(admin.collective, null);
  assert.deepEqual(admin.round.snapshot.proposals, []);
  check('private owner/facilitator filtering and outsider denial');
  await send('reopenOwn', roster[1].systemUserId);
  await assert.rejects(() => send('reveal'), /Every Program Director/);
  receipt.pending = null;
  save();
  await send('ready', roster[1].systemUserId);
  check('ready reopen blocks reveal until ready again');
  await restart('restart at all-ready stage');
  await prepareAll();
  await send('reopenOwn', roster[2].systemUserId);
  const combinedBefore = (await read(roster[2].systemUserId)).own.co.order;
  await send('resetProgram', roster[2].systemUserId, {
    programKey: 'mr'
  });
  const outdated = await read(roster[2].systemUserId);
  assert.deepEqual(outdated.own.co.order, combinedBefore);
  assert.equal(outdated.own.co.confirmed, false);
  await prepare(roster[2].systemUserId);
  check('source reset preserves combined draft until explicit rebuild');
  const revealed = await send('reveal');
  const frozen = JSON.stringify(revealed.next.collective.individuals);
  const v = await read(roster[1].systemUserId);
  const savedBody = {
    action: 'editCollective',
    roundId: v.roundId,
    operationId: randomUUID(),
    roundEtag: v.round.etag,
    policyRevision: v.round.policyRevision,
    preparationVersion: v.workflow.preparationVersion,
    revealId: v.workflow.revealId,
    listVersion: v.collective.version,
    order: [...v.collective.order].reverse(),
    boundaries: [2, 4]
  };
  await workflow.mutateWorkflow({
    body: savedBody,
    actor: roster[1].systemUserId
  });
  await assert.rejects(() => workflow.mutateWorkflow({
    body: {
      ...savedBody,
      operationId: randomUUID()
    },
    actor: roster[2].systemUserId
  }), /changed/);
  const groupReset = await send('resetCollective');
  assert.equal(JSON.stringify(groupReset.next.collective.individuals), frozen);
  assert.deepEqual(groupReset.next.collective.order, revealed.next.collective.order);
  await workflow.mutateWorkflow({
    body: savedBody,
    actor: roster[1].systemUserId
  });
  assert.deepEqual((await read()).collective.order, revealed.next.collective.order);
  check('collective edit stale-write rejection reset and replay preserve reveal');
  await restart('restart after reveal and collective editing');
  await prepareAll();
  await send('reveal');
  let current = await read();
  const supplement = action => ({
    action,
    roundId: current.roundId,
    roundEtag: current.round.etag,
    preparationVersion: current.workflow.preparationVersion,
    revealId: current.workflow.revealId,
    listVersion: current.collective.version
  });
  const exported = await workflow.readWorkflowSupplement({
    body: supplement('exportWorkbook'),
    actor: facilitator
  });
  const ExcelJS = require('exceljs');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(exported.base64, 'base64'));
  assert.equal(workbook.worksheets.length, 2);
  assert.equal(workbook.worksheets[0].rowCount, 9);
  assert.equal(workbook.worksheets[1].rowCount, 27);
  writeFileSync('/private/tmp/proposal-ranking-v2-sandbox.xlsx', Buffer.from(exported.base64, 'base64'));
  check('saved workbook contains 6 proposals and 24 preserved individual assessments');
  await send('resetCollective');
  check('collective reset after export');
  current = await read();
  const oldSupplement = supplement('sentiment');
  const oldReveal = current.workflow.revealId;
  await send('reopenPreparation');
  current = await read(roster[1].systemUserId);
  assert.equal(current.collective, null);
  assert.equal(current.workflow.revealId, null);
  assert.ok(current.progress.every(p => !p.ready));
  await assert.rejects(() => workflow.readWorkflowSupplement({
    body: oldSupplement,
    actor: facilitator
  }), /active revealed/);
  await prepareAll();
  await send('reveal');
  assert.notEqual((await read()).workflow.revealId, oldReveal);
  const history = await workflow.readWorkflowHistory({
    roundId: receipt.roundId,
    actor: roster[1].systemUserId
  });
  assert.ok(history.entries.length >= 3);
  check('reopen after export hides current group context and preserves readable history for new reveal');
  await restart('full restart after exported run');
  await prepareAll();
  await send('reveal');
  check('fresh run completes after every-stage resets');
  const final = await read();
  receipt.stage = 'passed';
  receipt.finalRevealId = final.workflow.revealId;
  receipt.completedAt = new Date().toISOString();
  save();
  console.log(JSON.stringify({
    receipt: RECEIPT,
    roundId: receipt.roundId,
    checks: receipt.checks.length,
    stage: receipt.stage
  }));
});
