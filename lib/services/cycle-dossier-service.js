/** Cycle Dossier application service: complete Workbench roster, private preview,
 * source/config pinning, launch/retry semantics and owner-only state projections.
 * Entry revisions are shared across superusers. No request input supplies identity.
 */
import { randomUUID } from 'crypto';
import * as requests from '../dataverse/adapters/grant-request';
import { isGuid } from '../utils/guid';
import { resolveWorkbenchProgramScope } from './workbench/program-scope-service';
import { resolveDossierDestination } from './cycle-dossier-sharepoint';
import { prepareRequestInput, snapshotConfiguration, estimateGenerationCost } from './cycle-dossier-generation';
import * as store from './cycle-dossier-store';
import { assertDossierStorageConfigured, dossierDigest, storeDossierJSON, readDossierJSON, readDossierFile } from './cycle-dossier-storage';
import { assertDossierPilotEnabled, assertDossierCohortConfigured, assertDossierRequestAllowed, assertDossierProfileAllowed, buildDossierRosterFilter, DOSSIER_CYCLE } from './cycle-dossier-rollout';

const CYCLE = DOSSIER_CYCLE;
export async function dossierPool(values, fn, limit = 3) {
  const results = new Array(values.length); let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (next < values.length) { const i = next++; results[i] = await fn(values[i], i); }
  }));
  return results;
}
export async function loadDossierRoster() {
  assertDossierPilotEnabled();
  assertDossierCohortConfigured();
  // Server-owned program scope: the Workbench default program (Research), no
  // caller identity and no selector. See buildDossierRosterFilter.
  const programScope = await resolveWorkbenchProgramScope({});
  const result = await requests.queryAllRequests({
    select: 'akoya_requestid,akoya_requestnum,akoya_title,wmkf_meetingdate,akoya_requeststatus,wmkf_triagestatus,wmkf_organizationname,_akoya_applicantid_value,_wmkf_projectleader_value,_wmkf_programdirector_value',
    filter: buildDossierRosterFilter(programScope.programId),
    orderby: 'akoya_requestnum asc',
  });
  if (result.capped || !Array.isArray(result.records)) throw store.dossierError('The D26 Workbench list is incomplete. Please retry.', 503);
  return result.records.map(r => ({ requestId: r.akoya_requestid.toLowerCase(), requestNumber: r.akoya_requestnum,
    title: r.akoya_title || '', institution: r.wmkf_organizationname || r._akoya_applicantid_value_formatted || '',
    pi: r._wmkf_projectleader_value_formatted || '', programDirectorId: r._wmkf_programdirector_value || null,
    programDirector: r._wmkf_programdirector_value_formatted || 'Unassigned' }))
    .filter(item => {
      try { assertDossierRequestAllowed(item); return true; }
      catch (error) { if (error.httpStatus === 403) return false; throw error; }
    });
}
function ids(value, name) {
  if (!Array.isArray(value) || value.length > 200 || value.some(v => !isGuid(v))) throw store.dossierError(`Invalid ${name}.`, 400);
  return [...new Set(value.map(v => v.toLowerCase()))].sort();
}
function budget(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 10000) throw store.dossierError('Spending limit must be a positive dollar amount up to $10,000.', 400);
  return value;
}
function guid(value, name) { if (!isGuid(value)) throw store.dossierError(`Invalid ${name}.`, 400); return value; }
function inputFingerprint(input) {
  const { capturedAt: _observedAt, ...narrative } = input.narrative;
  return dossierDigest({ requestId: input.requestId, requestNumber: input.requestNumber, narrative, priorAiContext: input.priorAiContext });
}
export function projectDossierRun(row) {
  return { id: row.id, status: row.status, createdAt: row.created_at, spentUsd: row.data.spentUsd || 0,
    reservedUsd: row.data.reservedUsd || 0, budgetUsd: row.data.budgetUsd,
    error: row.data.pauseReason || row.data.error || null, items: row.data.items.map(i => ({
      requestId: i.requestId, requestNumber: i.requestNumber, status: i.status, stage: i.stage || 'queued',
      error: i.error || null, revisionId: i.revisionId || i.reuseId || null, fallback: !!i.fallbackId,
    })) };
}
export function projectDossier(row) {
  return { id: row.id, cycle: row.cycle, selection: row.selection, latestEditionId: row.latest_edition_id };
}
export async function getCycleDossierPage(owner) {
  await store.assertDossierActor(owner);
  assertDossierProfileAllowed(owner);
  assertDossierPilotEnabled();
  const [dossier, roster, entries, runs, editions, control] = await Promise.all([
    store.getDossier(owner), loadDossierRoster(), store.listDossierEntries(), store.listDossierRuns(owner), store.listDossierEditions(owner), store.readDossierControl(),
  ]);
  let configuration;
  try {
    assertDossierStorageConfigured();
    if (process.env.CYCLE_DOSSIER_ENABLED !== 'true') throw store.dossierError('The dossier pilot is awaiting activation.', 503);
    const config = await snapshotConfiguration();
    configuration = { ready: true, prompts: Object.values(config.prompts || {}).map(p => ({ name: p.wmkf_ai_promptname, version: p.wmkf_promptversion, model: p.wmkf_ai_model })) };
  } catch (error) { configuration = { ready: false, error: error.httpStatus ? error.message : 'Published dossier prompts are not ready. Check Admin configuration.' }; }
  const byId = new Map(entries.map(e => [e.request_id, e]));
  return { dossier: projectDossier(dossier), candidates: roster.map(c => {
    const e = byId.get(c.requestId);
    return { ...c, latestRevision: e ? { id: e.id, revision: e.revision, createdAt: e.created_at, createdBy: e.created_by } : null };
  }), runs: runs.map(projectDossierRun), editions: editions.map(e => ({ id: e.id, createdAt: e.created_at,
    status: e.data.status, missing: e.data.missing || [], fallback: e.data.fallback || [] })), configuration,
    control: control ? { stopRequested: !!control.stop_requested, reason: control.reason || null,
      updatedAt: control.updated_at || null, updatedBy: control.updated_by || null } : null };
}

export async function previewCycleDossier(owner, body) {
  await store.assertDossierActor(owner); assertDossierProfileAllowed(owner); assertDossierPilotEnabled(); assertDossierStorageConfigured();
  const selected = ids(body.selectedRequestIds, 'selection');
  const generate = ids(body.generateRequestIds || [], 'rewrite selection');
  if (!selected.length || generate.some(id => !selected.includes(id))) throw store.dossierError('Select requests before previewing.', 400);
  const [roster, existing, config, dossier] = await Promise.all([loadDossierRoster(), store.listDossierEntries(), snapshotConfiguration(), store.getDossier(owner)]);
  if (selected.some(id => !roster.some(r => r.requestId === id))) throw store.dossierError('The Workbench roster changed. Refresh the selection.');
  const latest = new Map(existing.map(e => [e.request_id, e]));
  const items = await dossierPool(selected, async requestId => {
    const info = roster.find(r => r.requestId === requestId);
    const previous = latest.get(requestId);
    if (previous && !generate.includes(requestId)) return { ...info, status: 'ready', reuseId: previous.id, revision: previous.revision, stage: 'reuse' };
    try {
      const input = await prepareRequestInput(requestId);
      const destination = await resolveDossierDestination(requestId, info.requestNumber);
      const inputHash = inputFingerprint(input);
      const inputRef = await storeDossierJSON(`cycle-dossier/inputs/${owner}/${randomUUID()}.json`, input);
      const estimate = estimateGenerationCost(input, config);
      return { ...info, status: 'queued', stage: 'prepared', inputRef, inputHash, estimate, destination,
        fallbackId: previous?.id || null, revisionId: randomUUID() };
    } catch (error) {
      return { ...info, status: 'failed', stage: 'source', error: error.httpStatus ? error.message : 'The Proposal Narrative or source context could not be prepared.', fallbackId: previous?.id || null };
    }
  });
  const newItems = items.filter(i => !i.reuseId && i.inputRef);
  const known = newItems.every(i => Number.isFinite(i.estimate?.highUsd));
  const estimate = { lowUsd: known ? newItems.reduce((s, i) => s + (i.estimate.lowUsd || 0), 0) : null,
    highUsd: known ? newItems.reduce((s, i) => s + i.estimate.highUsd, 0) : null,
    newCount: newItems.length, reuseCount: items.filter(i => i.reuseId).length };
  const preview = await store.createDossierPreview(owner, dossier.id, { items, config, estimate, rosterHash: dossierDigest(roster), selected });
  await store.saveDossierSelection(owner, selected);
  return { preview: { id: preview.id, expiresAt: preview.expires_at, estimate,
    items: items.map(i => ({ requestId: i.requestId, requestNumber: i.requestNumber, status: i.status, reuseId: i.reuseId, error: i.error, fallback: !!i.fallbackId })),
    errors: items.filter(i => i.error).map(i => ({ requestId: i.requestId, error: i.error })) } };
}

export async function launchCycleDossier(owner, body) {
  await store.assertDossierActor(owner); assertDossierProfileAllowed(owner); assertDossierPilotEnabled(); assertDossierStorageConfigured();
  const previewId = guid(body.previewId, 'preview');
  const idempotencyKey = guid(body.idempotencyKey, 'launch key');
  const budgetUsd = budget(body.budgetUsd);
  const launchHash = dossierDigest({ previewId, budgetUsd });
  const replay = await store.findDossierLaunch(owner, idempotencyKey);
  if (replay) {
    if (replay.launch_hash !== launchHash) throw store.dossierError('That launch key was already used with different parameters.');
    return { run: projectDossierRun(replay) };
  }
  const preview = await store.readDossierPreview(owner, previewId);
  const roster = await loadDossierRoster();
  if (dossierDigest(roster) !== preview.data.rosterHash) throw store.dossierError('The Workbench roster changed. Preview again.');
  // Prove retained bytes remain available and the source still matches the reviewed input.
  await dossierPool(preview.data.items.filter(i => i.inputRef), async item => {
    await readDossierJSON(item.inputRef);
    const current = await prepareRequestInput(item.requestId);
    if (inputFingerprint(current) !== item.inputHash) throw store.dossierError(`Sources changed for ${item.requestNumber}. Preview again.`);
    if (dossierDigest(await resolveDossierDestination(item.requestId, item.requestNumber)) !== dossierDigest(item.destination)) throw store.dossierError(`SharePoint destination changed for ${item.requestNumber}. Preview again.`);
  });
  const run = await store.withDossierTransaction(async client => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1),0)', [`cycle-dossier-launch:${owner}:${idempotencyKey}`]);
    const existing = (await client.query('SELECT * FROM cycle_dossier_runs WHERE owner_profile_id=$1 AND idempotency_key=$2', [owner, idempotencyKey])).rows[0];
    if (existing) { if (existing.launch_hash !== launchHash) throw store.dossierError('Launch key conflict.'); return existing; }
    await store.assertDossierActor(owner, client);
    const data = { ...preview.data, budgetUsd, spentUsd: 0, reservedUsd: 0, cutCounter: 0, cutPending: false };
    for (const item of data.items) if (item.revisionId) {
      const entry = await store.reserveDossierEntry({ id: item.revisionId, requestId: item.requestId, owner, data: { request: item } }, client);
      item.revision = entry.revision;
    }
    return store.createDossierRun({ owner, dossierId: preview.dossier_id, idempotencyKey, launchHash, data }, client);
  });
  return { run: projectDossierRun(run) };
}

export async function controlCycleDossier(owner, body) {
  assertDossierProfileAllowed(owner);
  if (body.action === 'operator-stop') {
    const control = await store.setDossierOperatorStop(owner, body.stop !== false, body.reason || null);
    return { control: { stopRequested: control.stop_requested, reason: control.reason || null, updatedAt: control.updated_at } };
  }
  const runId = guid(body.runId, 'run');
  if (body.action === 'retry') {
    // Every retry starts from the prior pinned composition, never today's unrelated revisions.
    return store.withDossierTransaction(async client => {
      const source = (await client.query('SELECT * FROM cycle_dossier_runs WHERE id=$1 AND owner_profile_id=$2 FOR UPDATE', [runId, owner])).rows[0];
      if (!source) throw store.dossierError('Run not found.', 404);
      await store.assertDossierActor(owner, client);
      if (source.lease_token || ['queued', 'running'].includes(source.status)) throw store.dossierError('Wait for this run to settle before retrying.');
      const data = structuredClone(source.data);
      if (data.retryRunId) { const prior = (await client.query('SELECT * FROM cycle_dossier_runs WHERE id=$1', [data.retryRunId])).rows[0]; return { run: projectDossierRun(prior) }; }
      data.cutCounter = 0; data.cutPending = false; delete data.cut; delete data.error; delete data.pauseReason; delete data.assemblyAttempts;
      // An explicit retry is a new spending authorization. Prior charges and
      // uncertain reservations remain in the source run's immutable history.
      data.spentUsd = 0; data.reservedUsd = 0; data.retryOfRunId = source.id;
      data.budgetUsd = body.budgetUsd == null ? source.data.budgetUsd : budget(body.budgetUsd);
      data.items = data.items.map(i => {
        if (i.status === 'ready') return i;
        if (!i.inputRef) return { ...i, status: 'failed', error: 'This entry needs a fresh preview to resolve its source.' };
        return { ...i, status: 'queued', paidInFlight: false, reserved: false, error: null };
      });
      const key = randomUUID();
      const retry = await store.createDossierRun({ owner, dossierId: source.dossier_id, idempotencyKey: key, launchHash: dossierDigest({ source: runId, key }), data }, client);
      source.data.retryRunId = retry.id;
      await client.query('UPDATE cycle_dossier_runs SET data=$2::jsonb WHERE id=$1', [source.id, JSON.stringify(source.data)]);
      return { run: projectDossierRun(retry) };
    });
  }
  const row = await store.mutateDossierRun(runId, run => {
    if (body.action === 'pause' || body.action === 'cancel') {
      if (!['queued','running','paused'].includes(run.status)) throw store.dossierError('This run is already settled.');
      if (body.action === 'pause' && run.status === 'paused') return;
      run.status = body.action === 'cancel' ? 'cancelled' : 'paused';
      run.data.pauseReason = body.action === 'cancel' ? 'Cancelled by owner.' : 'Paused by owner.';
      run.data.cutPending = true; run.data.cutCounter += 1;
    } else if (body.action === 'resume') {
      if (run.status !== 'paused' || run.lease_token || run.data.cutPending) throw store.dossierError('Wait for paused work and its partial edition to settle before resuming.');
      if (body.budgetUsd != null) run.data.budgetUsd = budget(body.budgetUsd);
      run.status = 'queued'; delete run.data.pauseReason; delete run.data.cut;
      run.data.cutCounter += 1; delete run.data.assemblyAttempts; delete run.data.error;
    } else throw store.dossierError('Unknown run action.', 400);
  }, { owner });
  return { run: projectDossierRun(row) };
}

export async function cycleDossierAction(owner, body) {
  await store.assertDossierActor(owner);
  assertDossierProfileAllowed(owner);
  if (body.action === 'selection') {
    assertDossierPilotEnabled();
    const selection = ids(body.selectedRequestIds, 'selection');
    const cohort = assertDossierCohortConfigured();
    if ((process.env.CYCLE_DOSSIER_ROLLOUT_MODE || 'pilot') === 'smoke'
      && (selection.length !== 1 || !cohort.includes(selection[0]))) {
      throw store.dossierError('Smoke mode requires exactly one allowlisted request.', 400);
    }
    await store.getDossier(owner);
    return { dossier: projectDossier(await store.saveDossierSelection(owner, selection)) };
  }
  if (body.action === 'preview') return previewCycleDossier(owner, body);
  if (body.action === 'launch') return launchCycleDossier(owner, body);
  if (['pause','resume','cancel','retry','operator-stop'].includes(body.action)) return controlCycleDossier(owner, body);
  throw store.dossierError('Unknown dossier action.', 400);
}
export async function downloadCycleDossier(owner, query) {
  await store.assertDossierActor(owner);
  assertDossierProfileAllowed(owner);
  if (!['docx','pdf'].includes(query.format) || Boolean(query.editionId) === Boolean(query.entryId)) throw store.dossierError('Choose an entry or edition and a document format.', 400);
  let files; let name;
  if (query.editionId) {
    const row = await store.readDossierEdition(owner, guid(query.editionId, 'edition'));
    files = row.data.files; name = `D26-Dossier-${row.id}`;
  } else {
    const row = await store.getDossierEntry(guid(query.entryId, 'entry'));
    if (!row?.ready || row.cycle !== CYCLE) throw store.dossierError('Entry not found.', 404);
    files = row.data.files; name = `D26-${row.data.request.requestNumber}-v${row.revision}`;
  }
  const ref = files?.[query.format];
  if (!ref) throw store.dossierError('Saved document is unavailable.', 404);
  const bytes = await readDossierFile(ref);
  return { bytes, contentType: ref.contentType, filename: `${name}.${query.format}` };
}
