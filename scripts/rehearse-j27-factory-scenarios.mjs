#!/usr/bin/env node
/** Sandbox-only J27 owner CLI. Default is read-only, including the ledger.
 * No source exporter fallback: a private sandbox-origin bundle is required
 * for the existing bounded clone runner. Missing inputs become diagnostics.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import dataverse from '../lib/dataverse/client.js';
import { withDalContext } from '../lib/dataverse/core/context.js';
import { eq } from '../lib/dataverse/core/odata.js';
import { requireLedgerUrl, ledgerSchemaCheck } from '../lib/db/ledger-guard.js';
import { pgLedgerDb } from '../lib/services/test-requests/run-ledger-db.js';
import { createRunLedger, cliActorId } from '../lib/services/test-requests/run-ledger.js';
import { createReadinessJournal } from '../lib/services/test-requests/readiness-journal.js';
import { createReviewsSandboxDeps } from '../lib/services/test-requests/reviews-sandbox-deps.js';
import { SANDBOX_URL, SOURCE_SELECT, sha256, buildCloneManifest, runPreflight, resolveDestinationGrantCycle, computeRunPlanDigest } from '../lib/services/test-requests/basic-clone-steps.js';
import { requireUniqueSourceRequest } from '../lib/services/test-requests/sandbox-clone.js';
import { readSourceBundle } from '../lib/services/test-requests/source-bundle.js';
import { assertBundleFresh } from '../lib/services/test-requests/bundle-file-copy.js';
import { advanceRun } from '../lib/services/test-requests/run-runner.js';
import { buildGraphContext } from './rehearse-test-request-sandbox.mjs';
import { SCENARIOS, assertSandboxOrigin, sandboxFetch, completeList, assertSyntheticReviewer, readScenarioMetadata, deterministicId, digest, finalizeScenario, previewScenario, scenarioFor, candidateBodies } from '../lib/services/test-requests/j27-sandbox-scenarios.js';

export function parseArgs(argv) {
  const result = {};
  const allowed = new Set(['target','all','scenario','batch-key','director','reviewers','source-request-number','bundle','manifest-dir','run-id','confirm']);
  for (const arg of argv) {
    const match = /^--([a-z-]+)(?:=(.+))?$/.exec(arg);
    if (!match || !allowed.has(match[1]) || Object.hasOwn(result,match[1])) throw Error('Unknown, duplicate or malformed CLI argument');
    result[match[1]] = match[2] ?? true;
  }
  if (result.target !== 'sandbox') throw Error('Only --target=sandbox is allowed');
  if ((result.all === true) === (result.scenario !== undefined)) throw Error('Choose --all or --scenario=N');
  if (result.scenario !== undefined && (typeof result.scenario !== 'string' || !/^[1-8]$/.test(result.scenario))) throw Error('--scenario must be 1 through 8');
  result.scenarios = result.all ? SCENARIOS : [scenarioFor(Number(result.scenario))];
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(result['batch-key'] || '')) throw Error('--batch-key is required');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.director || '')) throw Error('--director must be a sign-in email');
  if (!/^\d{1,10}$/.test(result['source-request-number'] || '')) throw Error('--source-request-number is required');
  result.reviewerIds = typeof result.reviewers === 'string' ? result.reviewers.split(',') : [];
  if (result.scenarios.some(s => s.id === 7) && (result.reviewerIds.length !== 2 || !result.reviewerIds.every(id => /^[0-9a-f-]{36}$/i.test(id)) || new Set(result.reviewerIds.map(id => id.toLowerCase())).size !== 2)) throw Error('Scenario 7 requires two distinct --reviewers GUIDs');
  if (result['run-id'] && (result.scenarios.length !== 1 || !/^[0-9a-f-]{36}$/i.test(result['run-id']))) throw Error('--run-id requires one scenario and a GUID');
  if (result.confirm && !/^[0-9a-f]{64}$/.test(result.confirm)) throw Error('--confirm must be the exact preview digest');
  if (result['manifest-dir'] && !path.isAbsolute(result['manifest-dir'])) throw Error('--manifest-dir must be absolute');
  return result;
}
export async function runScenarioBatch(items, execute) {
  const results = []; let stopped = false;
  for (const item of items) {
    const identity = {scenario:item.scenario.id,runId:item.manifest.values.runId,requestId:item.manifest.values.requestId};
    if (stopped) { results.push({...identity,status:'NOT_ATTEMPTED',written:false}); continue; }
    const evidence = {};
    try { results.push({...await execute(item, evidence), ...evidence}); }
    catch (error) { results.push({...identity,status:'NEEDS_INSPECTION',diagnostic:error.message,writesMayHaveOccurred:true,...evidence}); stopped=true; }
  }
  return results;
}
export function reservePlan(manifest) {
  return { runId:manifest.values.runId, recipe:'basic', sourceDataverseHost:manifest.bundle.source.dataverseHost, sourceRequestId:manifest.source.requestId,
    sourceRequestNumber:manifest.source.requestNumber, sourceRevision:manifest.source.revision, bundleSha256:manifest.source.bundleSha256, bundleExportedAt:manifest.source.exportedAt,
    copyPolicyVersion:manifest.copyPolicy.version, copyPolicyDigest:manifest.copyPolicy.digest, planDigest:computeRunPlanDigest({manifest}), createBodySha256:manifest.createBodySha256,
    destinationEnvironment:'sandbox', destinationDataverseHost:new URL(SANDBOX_URL).hostname, destinationRequestId:manifest.values.requestId, destinationLocationId:manifest.values.locationId,
    expectedAppUserId:manifest.expectedAppUserId, expectedOrganizationId:manifest.expectedOrganization.accountid, expectedGraphSiteId:manifest.expectedGraphSiteId, expectedGraphDriveId:manifest.expectedGraphDriveId,
    fiscalYear:manifest.values.fiscalYear, meetingDate:manifest.values.meetingDate, testLabel:manifest.values.testLabel };
}
export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  dataverse.loadEnvLocal();
  assertSandboxOrigin(SANDBOX_URL);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = sandboxFetch(originalFetch, SANDBOX_URL);
  let db;
  const report = { mode:args.confirm ? 'J27_CONFIRMED' : 'READ_ONLY_J27_PREVIEW', target:SANDBOX_URL, actorId:cliActorId(os.userInfo().username), written:false, diagnostics:[], prerequisites:{}, scenarios:[] };
  const probe = async (name, fn) => {
    try { const result = await fn(); report.prerequisites[name] = 'VERIFIED'; return result; }
    catch (error) { report.prerequisites[name] = 'REFUSED'; report.diagnostics.push({ prerequisite:name, diagnostic:error.message }); return null; }
  };
  try {
    const ledgerUrl = await probe('sandbox_ledger', async () => { const url = requireLedgerUrl('sandbox'); await ledgerSchemaCheck(url, { mode:'j27-preview' }); return url; });
    if (ledgerUrl) db = pgLedgerDb(ledgerUrl);
    const client = await probe('sandbox_authentication', async () => {
      const token = await dataverse.getAccessToken(SANDBOX_URL);
      return dataverse.createClient({ resourceUrl:SANDBOX_URL, token, allowTestRequestMarkerWrites:true });
    });
    if (!client) return report;
    return await withDalContext('j27-sandbox-owner-cli', async () => {
      const deps = createReviewsSandboxDeps({ resourceUrl:SANDBOX_URL });
      const source = await probe('source_request', async () => {
        const rows = await completeList(client, `/akoya_requests?$select=${SOURCE_SELECT},wmkf_istestrequest&$filter=${encodeURIComponent(eq('akoya_requestnum',args['source-request-number']))}&$top=2`);
        requireUniqueSourceRequest(rows);
        return rows[0];
      });
      if (source) report.source = { requestNumber:source.akoya_requestnum, requestId:source.akoya_requestid, testMarked:source.wmkf_istestrequest === true, note:'Existing source projection does not reject a test marker; bundle and compiler guards still apply.' };
      const pd = await probe('program_director', async () => {
        const rows = await completeList(client, `/systemusers?$select=systemuserid,internalemailaddress,isdisabled,accessmode&$filter=${encodeURIComponent(eq('internalemailaddress',args.director.toLowerCase()))}&$top=2`);
        if (rows.length !== 1 || rows[0].isdisabled !== false || rows[0].accessmode !== 0) throw Error('PD email must resolve to exactly one enabled read-write sandbox systemuser');
        return rows[0];
      });
      if (pd) report.programDirectorId = pd.systemuserid;
      for (const id of args.reviewerIds) await probe(`reviewer_${id}`, async () => assertSyntheticReviewer(await deps.getPersonById(id, { select:['wmkf_potentialreviewersid','wmkf_issyntheticreviewer','statecode','_wmkf_contact_value'] }), id));
      const metadata = await probe('scenario_metadata', () => readScenarioMetadata(client));
      if (args['run-id'] && db && pd && metadata && args['manifest-dir']) {
        const ledger = createRunLedger(db);
        const run = await ledger.getRun(args['run-id']);
        if (run?.status === 'ready') {
          const manifest = JSON.parse(fs.readFileSync(path.join(args['manifest-dir'],`${args['run-id']}.json`),'utf8'));
          if (manifest.values.runId !== args['run-id'] || manifest.source.requestNumber !== args['source-request-number'] || manifest.values.programDirectorId !== pd.systemuserid || manifest.values.j27Scenario !== args.scenarios[0].id) throw Error('Named manifest assignment mismatch');
          // Completed copies do not depend on mutable source or export TTL.
          report.diagnostics = report.diagnostics.filter(d => d.prerequisite !== 'source_request');
          if (report.diagnostics.length) return report;
          const input = {client,ledger,manifest,actorId:report.actorId,reviewerIds:args.scenarios[0].reviewers ? args.reviewerIds : [],deps,journal:createReadinessJournal(db,{environment:'sandbox'})};
          const preview = await finalizeScenario(input);
          report.scenarios = [preview]; report.digest = digest({target:report.target,actorId:report.actorId,scenarios:report.scenarios});
          if (args.confirm) {
            if (args.confirm !== report.digest) throw Error('Confirmation does not match current preview');
            report.scenarios = await runScenarioBatch([{scenario:args.scenarios[0],manifest}], async (_item,evidence) => {
              evidence.finalizerPreview = preview;
              return finalizeScenario({...input,confirm:preview.digest});
            });
            report.partialSuccess = report.scenarios.some(s => s.status === 'NEEDS_INSPECTION');
            report.written = true;
          }
          return report;
        }
      }
      const bundle = await probe('sandbox_source_bundle', async () => {
        if (!args.bundle) throw Error('Missing --bundle: the existing bounded clone runner requires a private v4 manifest built from a source bundle. No production exporter or source fallback was invoked.');
        const saved = readSourceBundle(JSON.parse(fs.readFileSync(args.bundle,'utf8')));
        assertBundleFresh(saved);
        if (saved.source.dataverseHost !== new URL(SANDBOX_URL).hostname || saved.source.request.akoya_requestnum !== args['source-request-number']) throw Error('Bundle must identify the exact sandbox source request');
        return saved;
      });
      let context, preflight, cycle;
      if (bundle && pd && source && db && metadata && !report.diagnostics.length) {
        context = await probe('sharepoint_context', () => buildGraphContext());
        if (context) preflight = await probe('clone_preflight', () => runPreflight(client, context.graph, context.sharePointTarget, { j27Scenario:true }));
        cycle = await probe('J27_cycle', () => resolveDestinationGrantCycle(client,'J27'));
      }
      const ledger = db ? createRunLedger(db) : null;
      const manifests = [];
      for (const scenario of args.scenarios) {
        if (!preflight || !cycle || report.diagnostics.length) {
          report.scenarios.push({ scenario:scenario.id, status:'BLOCKED_PREREQUISITES', intended:{ phase1:scenario.phase1 ?? 'preserve clone', phase2:scenario.phase2, readiness:scenario.ready ? true : 'false/null; no write', memo:scenario.memo, reviewers:scenario.reviewers }, futureIds:'unknown until prerequisites pass', written:false });
          continue;
        }
        const ids = Object.fromEntries(['runId','requestId','locationId'].map(slot => [slot,deterministicId(args['batch-key'],scenario.id,slot)]));
        if (args['run-id']) ids.runId = args['run-id'];
        const manifestPath = args['manifest-dir'] ? path.join(args['manifest-dir'],`${ids.runId}.json`) : null;
        let manifest;
        if (manifestPath && fs.existsSync(manifestPath)) manifest = JSON.parse(fs.readFileSync(manifestPath,'utf8'));
        else manifest = buildCloneManifest(preflight, { ...cycle, source:bundle.source.request, testLabel:scenario.title, bundle, programDirector:pd, j27Scenario:scenario.id, ids });
        if (manifest.values.programDirectorId !== pd.systemuserid || manifest.values.j27Scenario !== scenario.id || manifest.values.runId !== ids.runId || manifest.source.bundleSha256 !== sha256(bundle)) throw Error('Saved manifest input drift');
        const run = await ledger.getRun(ids.runId);
        if (args['run-id'] && !run) throw Error('Named run not found; refusing adoption');
        if (run && run.actorId !== report.actorId) throw Error('Run actor mismatch');
        const entry = run?.status === 'ready' ? await finalizeScenario({ client, ledger, manifest, actorId:report.actorId, reviewerIds:scenario.reviewers ? args.reviewerIds : [], deps, journal:createReadinessJournal(db,{environment:'sandbox'}) })
          : { scenario:scenario.id, status:run?.status || 'not_reserved', runId:ids.runId, requestId:ids.requestId, createBody:manifest.createBody, createBodySha256:manifest.createBodySha256, reservation:reservePlan(manifest), bundleSha256:manifest.source.bundleSha256, candidates:scenario.reviewers ? candidateBodies(ids.runId,ids.requestId,args.reviewerIds) : [], finalizer:{ ...scenario, etag:'unknown until clone readback', memoPresent:metadata.memo }, expectedDerivedStatus:scenario.id === 7 ? 'Phase II Pending' : 'observe_only', effects:{ drafts:[5,6,7].includes(scenario.id), tracking:scenario.id === 7 }, written:false };
        report.scenarios.push(entry);
        manifests.push({ manifest, manifestPath, scenario });
      }
      if (!report.diagnostics.length) report.digest = digest({ target:report.target, actorId:report.actorId, scenarios:report.scenarios });
      if (!args.confirm) return report;
      if (!report.digest || args.confirm !== report.digest) throw Error('Confirmation does not match current preview');
      if (!args['manifest-dir']) throw Error('--manifest-dir is required before confirmation; preview writes no files');
      report.scenarios = await runScenarioBatch(manifests, async ({manifest,manifestPath,scenario}, evidence) => {
          if (!fs.existsSync(manifestPath)) fs.writeFileSync(manifestPath, JSON.stringify(manifest,null,2), { flag:'wx', mode:0o600 });
          if (!await ledger.getRun(manifest.values.runId)) await ledger.reserveRun({ actorId:report.actorId, idempotencyKey:`j27-${args['batch-key']}-${scenario.id}`, plan:reservePlan(manifest) });
          for (let step = 0; step < 60; step++) {
            const run = await ledger.getRun(manifest.values.runId);
            if (run.status === 'ready') break;
            const advanced = await advanceRun({ runId:run.runId, ledger, manifest, bundle, deps:{client,...context}, options:{ bypassGoverify:false } });
            if (advanced.outcome === 'ready') break;
            if (advanced.outcome !== 'advanced') throw Error(advanced.errorMessage || `Clone stopped: ${advanced.outcome}`);
          }
          const input = { client, ledger, manifest, actorId:report.actorId, reviewerIds:scenario.reviewers ? args.reviewerIds : [], deps, journal:createReadinessJournal(db,{environment:'sandbox'}) };
          const finalizerPreview = await previewScenario(input);
          evidence.finalizerPreview = { ...finalizerPreview.plan, digest:finalizerPreview.digest };
          const result = await finalizeScenario({ ...input, confirm:finalizerPreview.digest });
          return result;
      });
      report.partialSuccess = report.scenarios.some(s => s.status === 'NEEDS_INSPECTION');
      report.written = report.partialSuccess ? 'unknown; inspect per-scenario receipts' : true;
      return report;
    });
  } finally { if (db) await db.end(); globalThis.fetch = originalFetch; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(report => { console.log(JSON.stringify(report,null,2)); if (report.diagnostics.length || report.partialSuccess) process.exitCode = 1; }).catch(error => { console.error(`J27 refused: ${error.message}`); process.exitCode = 1; });
}
