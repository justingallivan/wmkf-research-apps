import crypto from 'node:crypto';
import { assertCopiedSourceValues, verifyCloneRequestReadback } from './sandbox-clone.js';
import { recheckFoundationTransition } from './foundation-transition.js';
/** Owner CLI readiness finalization. Does not advance phases, run AI or send email.
 * A completed prepared Basic clone and guarded phase advancement are prerequisites.
 * Preview is read-only; confirm dispatches a single journaled, true-only PATCH.
 */
import { assertPreparedFixtureContract, isPreparedCycle } from './prepared-fixture-contract.js';
import { assertChangeable, assertWritePermitted, awaitJobs, censusSince, COMPLETION_DEFAULTS } from './status-change-runner.js';
import { READBACK_FIELDS, bodyOrThrow, bundleSourceOf, guidEqual, listSharePointFiles, observe, sha256, validateCloneManifest } from './basic-clone-steps.js';
import { inflateFileCopyEntry } from './run-runner.js';
import { usesPackageIntegrity, verifyCopiedFiles } from './bundle-file-copy.js';
import { fenceReadinessClient } from './production-write-fence.js';
import { PHASE_I, PHASE_II } from './status-transitions.js';
const statusDigest = value => crypto.createHash('sha256').update(String(value ?? '')).digest('hex');
const requiredPair = row => row.wmkf_phaseistatus === PHASE_I.INVITED && row.wmkf_phaseiistatus === PHASE_II.PENDING_COMMITTEE_REVIEW && row.akoya_requeststatus === 'Phase II Pending';
const fail = message => { throw new Error(message); };
async function readFixtureState(client, run, manifest) {
  const path = `/akoya_requests(${run.destinationRequestId})?$select=${[...READBACK_FIELDS, 'wmkf_phaseistatus', 'wmkf_readyforreview'].join(',')}&$expand=wmkf_GrantCycle($select=wmkf_cyclecode)`;
  const row = bodyOrThrow('prepared fixture', await client.get(path));
  if (!guidEqual(row.akoya_requestid, run.destinationRequestId) || row.wmkf_istestrequest !== true || !guidEqual(row.wmkf_testcreationrunid, run.runId)
      || !guidEqual(row._wmkf_grantcycle_value, manifest.values.grantCycleId) || !isPreparedCycle(row.wmkf_GrantCycle?.wmkf_cyclecode)
      || row.wmkf_GrantCycle.wmkf_cyclecode !== manifest.values.cycleCode || !requiredPair(row)) fail('Prepared fixture identity, cycle or final status pair does not match.');
  if (!Object.hasOwn(row, 'wmkf_readyforreview') || ![null, false, true].includes(row.wmkf_readyforreview)) fail('Readiness value is unavailable or invalid.');
  const binds = { _akoya_applicantid_value: 'akoya_applicantid', _wmkf_projectleader_value: 'wmkf_projectleader', _akoya_primarycontactid_value: 'akoya_primarycontactid', _wmkf_researchleader_value: 'wmkf_researchleader' };
  for (const [readField, bindField] of Object.entries(binds)) {
    const key = Object.keys(manifest.createBody).find(k => k.toLowerCase() === `${bindField}@odata.bind`);
    const expected = /\(([0-9a-f-]{36})\)$/i.exec(manifest.createBody[key] || '')?.[1];
    if (!guidEqual(row[readField], expected)) fail('Fixture applicant or synthetic contact binding changed.');
  }
  if (verifyCloneRequestReadback(manifest, row).length) fail('Clone metadata changed after provisioning.');
  return row;
}

/** Completed copy receipts bind exact destination bytes, including the post-SharePoint
 * OOXML attestation hash. Finalization does not depend on mutable real-source files. */
export async function verifyPreparedCopyBytes(graph, copies) {
  const failures = [];
  for (const copy of copies) {
    try {
      const expectedHash = usesPackageIntegrity(copy.source.mimeType) ? copy.attestedDigest : copy.source.contentHash;
      const expectedSize = copy.item?.size ?? copy.source.size;
      if (!/^[a-f0-9]{64}$/.test(expectedHash || '') || !copy.item?.id || !copy.destinationDriveId) throw Error('missing receipt');
      const matches = meta => meta && meta.name === copy.destination.filename && meta.size === expectedSize
        && (meta.eTag ?? null) === (copy.item.eTag ?? null) && (meta.versionId ?? null) === (copy.item.versionId ?? null);
      if (!matches(await graph.getFileMetadataById(copy.destinationDriveId, copy.item.id))) throw Error('metadata changed');
      const download = await graph.downloadFile(copy.destinationDriveId, copy.item.id);
      if (!Buffer.isBuffer(download?.buffer) || crypto.createHash('sha256').update(download.buffer).digest('hex') !== expectedHash) throw Error('bytes changed');
      if (!matches(await graph.getFileMetadataById(copy.destinationDriveId, copy.item.id))) throw Error('metadata changed during read');
    } catch { failures.push('Copied destination no longer matches its verified receipt.'); }
  }
  return failures;
}

async function prerequisites({ client, ledger, graph, manifest, runId }) {
  const run = await ledger.getRun(runId);
  if (!run) fail('Factory run not found.');
  assertPreparedFixtureContract(manifest, run);
  validateCloneManifest(manifest, { allowExpired: true });
  if (run.bundleSha256 !== manifest.source.bundleSha256 || sha256(manifest.bundle) !== run.bundleSha256) fail('Source bundle differs from reserved run.');
  await assertChangeable(client, run);
  const row = await readFixtureState(client, run, manifest);
  const changes = await ledger.listStatusChanges(runId);
  if (changes.some(c => c.status !== 'complete' && !(c.status === 'needs_attention' && c.error === 'The Request changed since it was read (412); nothing was written.')) || !changes.some(c => c.status === 'complete' && c.effects?.requestStatusSha256 === statusDigest('Phase II Pending'))) fail('Status changes are unresolved or derived status lacks journal corroboration.');
  const meta = bodyOrThrow('readiness metadata', await client.get("/EntityDefinitions(LogicalName='akoya_request')/Attributes(LogicalName='wmkf_readyforreview')?$select=LogicalName,AttributeType,IsValidForUpdate"));
  if (meta.LogicalName !== 'wmkf_readyforreview' || meta.AttributeType !== 'Boolean' || meta.IsValidForUpdate !== true) fail('Readiness Boolean is not explicitly updateable.');
  const siteId = await graph.getSiteId();
  if (siteId !== manifest.expectedGraphSiteId || await graph.getDriveId('akoya_request', { siteId }) !== manifest.expectedGraphDriveId) fail('SharePoint target changed.');
  const resources = await ledger.listRunResources(runId);
  const copies = resources.filter(r => r.step === 'copy_file' && r.resourceKind === 'sharepoint_file').map(inflateFileCopyEntry);
  if (copies.length !== manifest.plannedFiles.length || copies.some(c => c.status !== 'verified')) fail('Copied package is incomplete.');
  const snapshot = await observe(client, run.destinationRequestId, { observationMs: 0 });
  const foundation = await recheckFoundationTransition({ client, organizationId: run.expectedOrganizationId, resources });
  if (foundation.failures.length) fail('Foundation isolation check failed.');
  const files = await listSharePointFiles(graph, snapshot);
  const failures = [...verifyCopiedFiles(copies, files), ...await verifyPreparedCopyBytes(graph, copies)];
  if (failures.length) fail('Copied package failed final integrity checks.');
  const { request: savedSource } = bundleSourceOf(manifest, { allowStale: true });
  assertCopiedSourceValues(savedSource, manifest.createBody);
  return { run, row };
}
export async function finalizeReadiness({ client, ledger, journal, graph, manifest, runId, confirm = false, completion = {} }) {
  const input = { client, ledger, graph, manifest, runId };
  let { run, row } = await prerequisites(input);
  let entry = await journal.get(runId);
  // Inspection must remain available for failed and abandoned attempts, including
  // already-true stamps with unexpected effects. Confirmation guards apply below.
  if (!confirm) return { mode: 'READ_ONLY_READINESS_PLAN', runId, requestNumber: run.destinationRequestNumber, ready: row.wmkf_readyforreview ?? null, attempt: entry?.attempt ?? null, journalStatus: entry?.status ?? null, error: entry?.error ?? null, effects: entry?.effects ?? null, written: false };
  if (entry?.status === 'abandoned') entry = null;
  let written = false;
  if (row.wmkf_readyforreview === true && (!entry || entry.status === 'planned')) fail('Readiness was set outside this finalization; refusing adoption.');
  if (entry?.status === 'needs_attention') fail('Readiness finalization needs owner inspection; no write was repeated.');
  assertWritePermitted(client, run);
  if (entry?.status === 'complete') {
    if (row.wmkf_readyforreview !== true) fail('Completed readiness stamp no longer reads true.');
    return { runId, status: 'complete', recovered: true, written: false };
  }
  row = await readFixtureState(client, run, manifest); // fresh ETag after the heavy package check
  if (!entry) entry = await journal.plan(runId, row['@odata.etag'], row.wmkf_readyforreview ?? null);
  if (!entry) fail('Readiness intent could not be journaled.');
  if (entry.status === 'planned') {
    if (row.wmkf_readyforreview === true || row['@odata.etag'] !== entry.etag_before || (row.wmkf_readyforreview ?? null) !== entry.ready_before) fail('Readiness precondition changed; no write was sent.');
    const dispatched = await journal.dispatch(runId, entry.attempt);
    if (!dispatched) fail('Another dispatcher owns readiness; nothing was sent.');
    entry = dispatched;
    written = true;
    const fenced = fenceReadinessClient(client, { destinationRequestId: run.destinationRequestId, sourceRequestId: run.sourceRequestId });
    let response;
    try { response = await fenced.patchWithOptions(`/akoya_requests(${run.destinationRequestId})`, { wmkf_readyforreview: true }, { 'If-Match': entry.etag_before }); }
    catch { fail('Readiness outcome is unknown; resume to read it, never resend.'); }
    if (!response?.ok) {
      await journal.attention(runId, response?.status === 412 ? 'readiness_etag_conflict' : 'readiness_patch_refused', entry.attempt);
      fail('Readiness PATCH was refused; inspect the journal.');
    }
  }
  // Re-read all inputs after a successful or ambiguous dispatch; never re-PATCH.
  row = await readFixtureState(client, run, manifest);
  if (row.wmkf_readyforreview !== true) fail('Dispatched readiness does not yet read true; no write repeated.');
  if (entry.status === 'dispatched') { entry = await journal.applied(runId, entry.attempt); if (!entry) fail('Readiness journal moved concurrently.'); }
  if (entry.status !== 'applied') fail('Unknown readiness journal state.');
  const timing = { ...COMPLETION_DEFAULTS, now: Date.now, sleep: ms => new Promise(resolve => setTimeout(resolve, ms)), ...completion };
  const jobs = await awaitJobs(client, run.destinationRequestId, entry.dispatched_at, timing);
  if (jobs.open?.length || jobs.notQuiet) fail('Readiness is written; background work is not quiet yet. Resume without another PATCH.');
  const census = await censusSince(client, run.destinationRequestId, entry.dispatched_at);
  if (jobs.failed.length || census.emails.length || census.tracking.length || census.payments.length || census.requestStatus !== 'Phase II Pending') {
    await journal.attention(runId, 'readiness_unexpected_effects', entry.attempt, { kind: 'readiness_finalization', outcome: 'unexpected_effects', emailIds: census.emails, trackingIds: census.tracking, paymentIds: census.payments, jobIds: jobs.jobs.map(j => j.asyncoperationid), count: jobs.failed.length }); fail('Readiness effects require owner inspection.');
  }
  row = await readFixtureState(client, run, manifest);
  if (row.wmkf_readyforreview !== true) fail('Readiness changed during observation.');
  const effects = { kind: 'readiness_finalization', outcome: 'complete', emailIds: census.emails, trackingIds: census.tracking, paymentIds: census.payments, jobIds: jobs.jobs.map(j => j.asyncoperationid), requestStatusSha256: statusDigest(census.requestStatus) };
  if (!await journal.complete(runId, effects, entry.attempt)) fail('Readiness completion lost its journal fence.');
  return { runId, status: 'complete', ready: true, written };
}


/** Ledger-only owner abandonment; the next finalization plans with a fresh ETag after package verification. Exact destination confirmation also affirms every
 * possible dispatcher (including paused CLIs and form invocations) has stopped.
 * Readiness true never resets: unexpected stamped effects require owner review. */
export async function recoverReadiness({ client, ledger, journal, graph, manifest, runId, confirmRequestId = null }) {
  const { run } = await prerequisites({ client, ledger, graph, manifest, runId });
  const entry = await journal.get(runId);
  if (!entry || !['planned','dispatched','needs_attention'].includes(entry.status)) fail('No recoverable readiness attempt.');
  const row = await readFixtureState(client, run, manifest);
  if (row.wmkf_readyforreview === true) fail('Readiness is already true; resume readback or inspect effects, never reset it.');
  if (!confirmRequestId) return { mode: 'READ_ONLY_READINESS_RECOVERY_PLAN', runId, requestId: run.destinationRequestId, attempt: entry.attempt, journalStatus: entry.status, written: false };
  if (!guidEqual(confirmRequestId, run.destinationRequestId)) fail('Recovery confirmation must name the exact destination Request.');
  const recovered = await journal.recover(runId, entry);
  if (!recovered) fail('Readiness attempt moved concurrently; nothing was recovered.');
  return { runId, attempt: recovered.attempt, status: 'abandoned', nextAction: 'finalize_readiness', dataverseWritten: false };
}
