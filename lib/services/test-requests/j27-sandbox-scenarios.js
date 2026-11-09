/** Owner-run J27 sandbox scenarios. No shared-target adapter and no generated content.
 * Preview is read-only. Ready-run resource SQL belongs to run-ledger.js.
 */
import crypto from 'node:crypto';
import { classifyTarget } from '../../dataverse/core/interlock.js';
import { assertTrustedDalContext, isDalEnforcementOn } from '../dynamics-context.js';
import { createReviewsSandboxDeps } from './reviews-sandbox-deps.js';
import { buildCastSuggestionBody } from './cast-binding-runner.js';
import { bodyOrThrow, guidEqual, READBACK_FIELDS, validateCloneManifest } from './basic-clone-steps.js';
import { verifyCloneRequestReadback } from './sandbox-clone.js';
import { runStatusChange, readLiveOptions, assertWritePermitted, awaitJobs, COMPLETION_DEFAULTS } from './status-change-runner.js';
import { fenceReadinessClient } from './production-write-fence.js';
import { deriveWorkRemaining, emptyCounts } from '../reviewer-rollup.js';

export const MEMO = 'wmkf_initialassessmentrationale';
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = message => { throw new Error(`J27: ${message}`); };
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export const digest = value => crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
export const SCENARIOS = Object.freeze([
  ['Intake', null], ['Rationale saved', null], ['First Cut Not Scored', 100000005], ['First Cut Scored', 100000004],
  ['Semi-finalist No', 707510006], ['Semi-finalist Yes', 707510005], ['Chairs approved', 100000003], ['Unready control', null],
].map(([name, phase1], index) => Object.freeze({ id: index + 1, title: `J27 ${String(index + 1).padStart(2, '0')} ${name}`, phase1,
  phase2: index === 6 ? 100000002 : null, ready: index !== 7, reviewers: index === 6 ? 2 : 0,
  memo: index > 0 && index < 7 ? `TEST: Synthetic J27 scenario ${index + 1} rationale for Factory rehearsal; not a real assessment.` : null })));
export function scenarioFor(id) { return SCENARIOS.find(s => s.id === id) || fail('scenario must be an integer from 1 through 8'); }
export function deterministicId(batch, scenario, slot) {
  scenarioFor(scenario);
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(batch)) fail('invalid batch key');
  const hex = digest(['j27-v1', batch, scenario, slot]);
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;
}
export function assertSandboxOrigin(origin, env = process.env) {
  let url; try { url = new URL(origin); } catch { fail('invalid sandbox origin'); }
  if (url.protocol !== 'https:' || url.origin !== origin || url.port || classifyTarget(origin) !== 'sandbox') fail('registered bare sandbox HTTPS origin required');
  if (env.DATAVERSE_TARGET_INTERLOCK !== 'on' || !isDalEnforcementOn()) fail('interlock must be explicitly on and DAL enforcement must be enabled');
  return origin;
}
/** Single CLI process transport guard. Dataverse redirects are refused before following.
 * Other hosts are restricted to OAuth/Graph, never another Dataverse origin. */
export function sandboxFetch(fetchImpl, origin) {
  assertSandboxOrigin(origin);
  return async (input, options = {}) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (url.origin !== origin && !['https://login.microsoftonline.com', 'https://graph.microsoft.com'].includes(url.origin)) fail('mixed-target transport refused');
    const response = await fetchImpl(input, { ...options, redirect: 'error' });
    if (response.redirected || (response.url && new URL(response.url).origin !== url.origin)) fail('redirected response refused');
    return response;
  };
}
export async function completeList(client, path) {
  const body = bodyOrThrow('complete sandbox census', await client.get(path));
  if (!Array.isArray(body.value) || body['@odata.nextLink']) fail('incomplete census refused');
  return body.value;
}
export async function readScenarioMetadata(client) {
  const attributes = await completeList(client, `/EntityDefinitions(LogicalName='akoya_request')/Attributes?$select=LogicalName,AttributeType,IsValidForUpdate&$filter=${encodeURIComponent(`LogicalName eq '${MEMO}' or LogicalName eq 'wmkf_readyforreview'`)}`);
  const ready = attributes.find(a => a.LogicalName === 'wmkf_readyforreview');
  if (ready?.AttributeType !== 'Boolean' || ready.IsValidForUpdate !== true) fail('readiness metadata invalid');
  const memo = attributes.find(a => a.LogicalName === MEMO);
  if (memo && (memo.AttributeType !== 'Memo' || memo.IsValidForUpdate !== true)) fail('memo metadata invalid; not absence');
  const options = {};
  for (const field of ['wmkf_phaseistatus','wmkf_phaseiistatus']) options[field] = await readLiveOptions(client, field);
  const emailSets = {};
  for (const [field, type] of [['statecode', 'State'], ['statuscode', 'Status']]) {
    const body = bodyOrThrow('email metadata', await client.get(`/EntityDefinitions(LogicalName='email')/Attributes(LogicalName='${field}')/Microsoft.Dynamics.CRM.${type}AttributeMetadata?$expand=OptionSet`));
    emailSets[field] = body.OptionSet?.Options || [];
  }
  const drafts = emailSets.statuscode.filter(o => o.Label?.UserLocalizedLabel?.Label === 'Draft');
  if (drafts.length !== 1 || !Number.isInteger(drafts[0].Value) || !Number.isInteger(drafts[0].State)
      || !emailSets.statecode.some(o => o.Value === drafts[0].State)) fail('unambiguous Draft status and associated email state required');
  const emailOptions = { statuscode:drafts[0].Value, statecode:drafts[0].State };
  return { memo: !!memo, options, emailOptions };
}
export function assertDraftEmails(rows, draft) {
  for (const row of rows) if (row.statecode !== draft.statecode || row.statuscode !== draft.statuscode || row.senton !== null) fail('email is not a verified unsent Draft');
}
export async function validateScenarioEffects(client, requestId, metadata) {
  if (!GUID.test(requestId)) fail('invalid effect request identity');
  const regarding = encodeURIComponent(`_regardingobjectid_value eq ${requestId}`);
  const emails = await completeList(client, `/emails?$select=activityid,statecode,statuscode,senton&$filter=${regarding}`);
  assertDraftEmails(emails, metadata.emailOptions);
  const payments = await completeList(client, `/akoya_requestpayments?$select=akoya_requestpaymentid&$filter=${encodeURIComponent(`_akoya_requestlookup_value eq ${requestId}`)}`);
  if (payments.length) fail('unexpected payments');
  const jobs = await completeList(client, `/asyncoperations?$select=asyncoperationid,statecode,statuscode&$filter=${regarding}`);
  if (jobs.some(j => j.statecode !== 3 || j.statuscode === 31)) fail('unsettled or failed jobs');
  const tracking = await completeList(client, `/akoya_goapplystatustrackings?$select=akoya_goapplystatustrackingid&$filter=${encodeURIComponent(`_akoya_request_value eq ${requestId}`)}`);
  return { emailIds: emails.map(e => e.activityid), paymentIds: [], jobIds: jobs.map(j => j.asyncoperationid), trackingIds: tracking.map(t => t.akoya_goapplystatustrackingid) };
}
export function assertSyntheticReviewer(row, id) {
  if (!guidEqual(row?.wmkf_potentialreviewersid, id) || row.wmkf_issyntheticreviewer !== true || row.statecode !== 0 || row._wmkf_contact_value !== null) fail('reviewer must be an active synthetic person without a Contact binding');
}
export const SUGGESTION_FIELDS = ['wmkf_appreviewersuggestionid','_wmkf_potentialreviewer_value','_wmkf_request_value','wmkf_grantcyclecode','wmkf_selected','wmkf_invited','wmkf_emailsentat','wmkf_accepted','wmkf_declined','wmkf_responsetype','wmkf_reviewstatus','wmkf_externaltokenhash','wmkf_externaltokenissued','wmkf_externaltokenexpires','statecode','wmkf_applicantdisposition'];
export function assertSuggestion(row, body) {
  const person = /\(([^)]+)\)/.exec(body['wmkf_PotentialReviewer@odata.bind'])[1];
  const request = /\(([^)]+)\)/.exec(body['wmkf_Request@odata.bind'])[1];
  if (!row || SUGGESTION_FIELDS.some(field => !Object.hasOwn(row,field))) fail('suggestion projection incomplete');
  if (!guidEqual(row?.wmkf_appreviewersuggestionid, body.wmkf_appreviewersuggestionid) || !guidEqual(row._wmkf_potentialreviewer_value, person)
      || !guidEqual(row._wmkf_request_value, request) || row.wmkf_grantcyclecode !== 'J27' || row.wmkf_selected !== true || row.statecode !== 0
      || row.wmkf_applicantdisposition !== body.wmkf_applicantdisposition || row.wmkf_invited !== false || row.wmkf_emailsentat !== null
      || row.wmkf_accepted !== false || row.wmkf_declined !== false || row.wmkf_responsetype != null || row.wmkf_externaltokenhash != null || row.wmkf_externaltokenissued != null || row.wmkf_externaltokenexpires != null || row.wmkf_reviewstatus != null) fail('suggestion is foreign or has engagement state');
}
export function candidateBodies(runId, requestId, reviewerIds) {
  if (reviewerIds.length !== 2 || !reviewerIds.every(id => GUID.test(id)) || new Set(reviewerIds.map(id => id.toLowerCase())).size !== 2) fail('two distinct reviewer GUIDs required');
  return reviewerIds.map((personId, index) => ({ ...buildCastSuggestionBody({ bindingId: deterministicId(runId, 7, `reviewer-${index}`), personId, requestId, cycleCode: 'J27' }), wmkf_selected: true }));
}
export function assertScenarioRow({ run, row, manifest, actorId, scenario, metadata }) {
  validateCloneManifest(manifest, { allowExpired: true });
  if (manifest.bundle?.sandboxScenarioSource !== true || classifyTarget(`https://${manifest.bundle?.source?.dataverseHost}`) !== 'sandbox'
      || run?.destinationDataverseHost !== manifest.bundle.source.dataverseHost || run?.sourceDataverseHost !== manifest.bundle.source.dataverseHost) fail('sandbox source/destination provenance mismatch');
  if (!run || run.destinationEnvironment !== 'sandbox' || run.status !== 'ready' || run.actorId !== actorId
      || run.createBodySha256 !== manifest.createBodySha256 || run.bundleSha256 !== manifest.source.bundleSha256
      || manifest.values.j27Scenario !== scenario.id || manifest.values.cycleCode !== 'J27'
      || !guidEqual(run.runId, manifest.values.runId) || !guidEqual(run.destinationRequestId, manifest.values.requestId)
      || verifyCloneRequestReadback(manifest, row).length || row.wmkf_istestrequest !== true || !guidEqual(row.wmkf_testcreationrunid, run.runId)
      || !guidEqual(row._wmkf_grantcycle_value, manifest.values.grantCycleId) || !guidEqual(row._wmkf_programdirector_value, manifest.values.programDirectorId)
      || !guidEqual(row._wmkf_grantprogram_value, manifest.values.grantProgramId) || row.wmkf_respondreminderenabled !== false || row.wmkf_reviewduereminderenabled !== false
      || !row.akoya_title?.startsWith('TEST:') || !/^W\/"\d{1,20}"$/.test(row['@odata.etag'] || '')) fail('run, manifest, ownership or fixture identity mismatch');
  if (![true,false,null].includes(row.wmkf_readyforreview)) fail('readiness unavailable');
  if (scenario.id === 8 && row.wmkf_readyforreview === true) fail('control already ready; never repair with false');
  if (metadata.memo && !Object.hasOwn(row,MEMO)) fail('memo projection unavailable');
  if (metadata.memo && row[MEMO] != null && row[MEMO] !== '' && row[MEMO] !== scenario.memo) fail('unexpected human memo; refusing overwrite');
  if (scenario.phase1 !== null && ![null,100000000,scenario.phase1].includes(row.wmkf_phaseistatus)) fail('unexpected Phase I baseline');
  if (scenario.id === 7 && ![null,scenario.phase2].includes(row.wmkf_phaseiistatus)) fail('unexpected Phase II baseline');
  if (scenario.phase1 === null && ![null,100000000].includes(row.wmkf_phaseistatus)) fail('advanced retained Phase I');
  if (scenario.id !== 7 && row.wmkf_phaseiistatus !== null) fail('unexpected Phase II');
}
async function readRow(client, run, metadata) {
  return bodyOrThrow('scenario request', await client.get(`/akoya_requests(${run.destinationRequestId})?$select=${[...READBACK_FIELDS,'wmkf_phaseistatus','wmkf_readyforreview',...(metadata.memo ? [MEMO] : [])].join(',')}`));
}
/** No arbitrary PATCH: callers can send only a scenario's exact one-field value. */
export function scenarioClient({ client, deps, run, scenario, ledger, verify }) {
  assertSandboxOrigin(new URL(client.baseUrl).origin);
  return { baseUrl: client.baseUrl, get: (...args) => client.get(...args), async patchWithOptions(path, body, headers) {
    assertTrustedDalContext('j27-sandbox-scenarios.patch');
    const fields = Object.keys(body);
    const allowed = { ...(scenario.memo ? { [MEMO]: scenario.memo } : {}), ...(scenario.phase1 !== null ? { wmkf_phaseistatus: scenario.phase1 } : {}), ...(scenario.phase2 !== null ? { wmkf_phaseiistatus: scenario.phase2 } : {}), ...(scenario.ready ? { wmkf_readyforreview: true } : {}) };
    if (path !== `/akoya_requests(${run.destinationRequestId})` || fields.length !== 1 || !Object.hasOwn(allowed, fields[0]) || body[fields[0]] !== allowed[fields[0]] || !/^W\/"\d{1,20}"$/.test(headers?.['If-Match'] || '')) fail('unsafe PATCH refused');
    await ledger.assertJ27Lock(run.runId);
    const row = await verify();
    if (row['@odata.etag'] !== headers['If-Match']) fail('ETag drift before dispatch');
    assertWritePermitted(client, run);
    const result = await deps.runChangeset([{ method: 'PATCH', entitySet: 'akoya_requests', key: run.destinationRequestId, body, ifMatch: headers['If-Match'] }]);
    if (result?.ok !== true || result.operations?.length !== 1 || result.operations[0].status < 200 || result.operations[0].status >= 300) fail('ambiguous PATCH result');
    return { ok: true, status: result.operations[0].status };
  } };
}
export async function previewScenario({ client, ledger, manifest, actorId, reviewerIds = [], deps = null, journal }) {
  assertSandboxOrigin(new URL(client.baseUrl).origin);
  assertTrustedDalContext('j27-sandbox-scenarios.preview');
  const scenario = scenarioFor(manifest.values.j27Scenario);
  const run = await ledger.getRun(manifest.values.runId);
  const metadata = await readScenarioMetadata(client);
  if (!run) fail('Factory run not found');
  const row = await readRow(client, run, metadata);
  assertScenarioRow({ run, row, manifest, actorId, scenario, metadata });
  if (!journal) fail('sandbox readiness journal required');
  const readiness = await journal.get(run.runId);
  if (readiness && !['planned','dispatched','applied','complete'].includes(readiness.status)) fail('readiness journal needs inspection');
  if (row.wmkf_readyforreview === true && (!readiness || !['dispatched','applied','complete'].includes(readiness.status))) fail('readiness set outside this finalizer');
  if (readiness && ((scenario.phase1 !== null && row.wmkf_phaseistatus !== scenario.phase1) || row.wmkf_phaseiistatus !== scenario.phase2
      || (metadata.memo && scenario.memo && row[MEMO] !== scenario.memo)
      || (readiness.status === 'complete' && row.wmkf_readyforreview !== true))) fail('readiness journal requires exact prior final state; no repair');
  const resources = await ledger.listRunResources(run.runId);
  if (resources.some(r => r.plannedIdentity?.kind?.startsWith('j27_') && ['conflict','failed','rejected'].includes(r.outcome))) fail('resource journal needs inspection');
  const changes = await ledger.listStatusChanges(run.runId);
  if (changes.some(c => c.status === 'needs_attention')) fail('status journal needs attention');
  const sandboxDeps = deps || createReviewsSandboxDeps({ resourceUrl: new URL(client.baseUrl).origin });
  const candidates = scenario.reviewers ? candidateBodies(run.runId, run.destinationRequestId, reviewerIds) : [];
  for (const id of reviewerIds) assertSyntheticReviewer(await sandboxDeps.getPersonById(id, { select: ['wmkf_potentialreviewersid','wmkf_issyntheticreviewer','statecode','_wmkf_contact_value'] }), id);
  const roster = await sandboxDeps.listSuggestionsByRequest(run.destinationRequestId);
  if (roster.some(id => !candidates.some(b => guidEqual(b.wmkf_appreviewersuggestionid, id)))) fail('foreign suggestion on request');
  if (readiness && roster.length !== candidates.length) fail('readiness roster drift; no repair');
  for (const id of roster) assertSuggestion(await sandboxDeps.getSuggestionById(id, {select:SUGGESTION_FIELDS}), candidates.find(b => guidEqual(b.wmkf_appreviewersuggestionid,id)));
  const effects = await validateScenarioEffects(client, run.destinationRequestId, metadata);
  const writes = [];
  if (scenario.memo) writes.push({ field: MEMO, before: metadata.memo ? row[MEMO] : 'absent', after: scenario.memo, action: metadata.memo ? row[MEMO] === scenario.memo ? 'reconcile' : 'patch' : 'skip_absent' });
  for (const [field, target] of [['wmkf_phaseistatus',scenario.phase1],['wmkf_phaseiistatus',scenario.phase2]]) {
    if (target === null) continue;
    const option = metadata.options[field].find(o => o.value === target && o.label);
    if (!option) fail(`required option unavailable: ${field}`);
    writes.push({ field, before: row[field], after: target, label: option.label, action: row[field] === target ? 'reconcile' : 'status_setter' });
  }
  writes.push({ field: 'wmkf_readyforreview', before: row.wmkf_readyforreview, after: scenario.ready ? true : row.wmkf_readyforreview, action: scenario.ready ? row.wmkf_readyforreview === true ? 'reconcile' : 'patch_last' : 'no_write' });
  const plan = { version: 1, scenario: scenario.id, actorId, runId: run.runId, requestId: run.destinationRequestId, requestNumber: run.destinationRequestNumber, manifestHash: digest(manifest), etag: row['@odata.etag'], writes, candidates, effects,
    expectedDerivedStatus: 'observe_only', observedDerivedStatus: row.akoya_requeststatus ?? null, permittedEffects: { drafts: [5,6,7].includes(scenario.id), tracking: scenario.id === 7 }, retainedPhase1: scenario.phase1 === null ? row.wmkf_phaseistatus : null,
    readiness, journal: resources.filter(r => r.plannedIdentity?.kind?.startsWith('j27_')).map(r => ({ resourceId:r.resourceId, outcome:r.outcome, identity:r.plannedIdentity })), changes: changes.map(c => ({ changeId:c.changeId, status:c.status, field:c.field, after:c.optionAfter })) };
  return { plan, digest: digest(plan), run, row, scenario, metadata, deps: sandboxDeps };
}
export async function finalizeScenario(input) {
  const preview = await previewScenario(input);
  if (!input.confirm) return { mode: 'READ_ONLY_J27_PLAN', ...preview.plan, digest: preview.digest, written: false };
  if (input.confirm !== preview.digest) fail('confirmation digest mismatch or drift');
  return input.ledger.withJ27RunLock(preview.run.runId, input.actorId, async ledger => {
    const fresh = await previewScenario({ ...input, ledger });
    if (fresh.digest !== input.confirm) fail('state changed while acquiring lock');
    const { run, scenario, metadata, deps } = fresh;
    const verify = async () => { await ledger.assertJ27Lock(run.runId); const row = await readRow(input.client, run, metadata); assertScenarioRow({ ...input, run, row, scenario, metadata }); return row; };
    const client = scenarioClient({ client: input.client, deps, run, scenario, ledger, verify });
    const stable = digest({ manifest: fresh.plan.manifestHash, scenario: scenario.id, candidates: fresh.plan.candidates, actorId: input.actorId });
    const priorMarker = (await ledger.listRunResources(run.runId)).find(r => r.plannedIdentity?.kind === 'j27_scenario');
    const confirmedDigest = priorMarker?.plannedIdentity.inputFingerprint || input.confirm;
    const receipt = (kind, index, identity = {}, provenance = null, resourceKind = 'dataverse_request_patch') => ledger.planJ27Resource({ kind, index, resourceKind, plannedIdentity: { requestId:run.destinationRequestId, inputFingerprint:confirmedDigest, ...identity }, sourceProvenance:provenance });
    const finish = async (entry, readback, options) => { if (!await ledger.finishJ27Resource(entry.resourceId, readback, options)) fail('resource completion lost fence'); };
    const marker = await receipt('j27_scenario', scenario.id, { contentHash:stable });
    if (marker.outcome === 'planned') await finish(marker, { exists:true }, { noWrite:true });
    if (scenario.memo) {
      let row = await verify();
      if (!metadata.memo) {
        const entry = await receipt('j27_memo_skip', scenario.id, { field:MEMO });
        if (entry.outcome === 'planned') await finish(entry, { exists:false, outcome:'memo_absent' }, { noWrite:true });
      } else {
        const entry = await receipt('j27_memo', scenario.id, { field:MEMO, contentHash:digest(scenario.memo), eTagBefore:row['@odata.etag'] }, { contentHash:digest(row[MEMO]) });
        if (entry.outcome === 'planned') {
          if (row[MEMO] === scenario.memo || row['@odata.etag'] !== entry.plannedIdentity.eTagBefore || digest(row[MEMO]) !== entry.sourceProvenance.contentHash) fail('memo prior state changed');
          if (!await ledger.dispatchJ27Resource(entry.resourceId)) fail('memo dispatcher lost CAS');
          await client.patchWithOptions(`/akoya_requests(${run.destinationRequestId})`, { [MEMO]:scenario.memo }, { 'If-Match':entry.plannedIdentity.eTagBefore });
        } else if (!['dispatched','ambiguous','verified','recovered'].includes(entry.outcome)) fail('memo needs inspection');
        row = await verify();
        if (row[MEMO] !== scenario.memo) fail('memo outcome unknown; never resend');
        if (!['verified','recovered'].includes(entry.outcome)) await finish(entry, { contentHash:digest(row[MEMO]), eTagAfter:row['@odata.etag'] });
      }
    }
    for (const write of fresh.plan.writes.filter(w => w.action === 'status_setter' || (w.action === 'reconcile' && w.label))) {
      const prior = await ledger.listStatusChanges(run.runId);
      const row = await verify();
      if (row[write.field] === write.after && prior.some(c => c.field === write.field && c.optionAfter === write.after && c.status === 'complete')) continue;
      await runStatusChange({ client, ledger, runId:run.runId, field:write.field, optionLabel:write.label, environment:'sandbox', validateEffects: () => validateScenarioEffects(client, run.destinationRequestId, metadata), completion:input.completion });
    }
    let row = await verify();
    // The derived akoya_requeststatus is observed, never asserted: the sandbox's 2024 business rules
    // differ from production's, so only the option values are the scenario's contract.
    if (scenario.id === 7 && (row.wmkf_phaseistatus !== scenario.phase1 || row.wmkf_phaseiistatus !== scenario.phase2)) fail('scenario 7 status mismatch');
    for (const [index, body] of fresh.plan.candidates.entries()) {
      const personId = /\(([^)]+)\)/.exec(body['wmkf_PotentialReviewer@odata.bind'])[1];
      assertSyntheticReviewer(await deps.getPersonById(personId, { select:['wmkf_potentialreviewersid','wmkf_issyntheticreviewer','statecode','_wmkf_contact_value'] }), personId);
      const entry = await receipt('j27_reviewer', index, { suggestionId:body.wmkf_appreviewersuggestionid, destinationPersonId:personId, contentHash:digest(body) }, null, 'dataverse_reviewer_suggestion');
      let suggestion = await deps.getSuggestionById(body.wmkf_appreviewersuggestionid, { select:SUGGESTION_FIELDS });
      if (entry.outcome === 'planned') {
        if (suggestion) fail('unjournaled suggestion exists');
        if (!await ledger.dispatchJ27Resource(entry.resourceId)) fail('suggestion dispatcher lost CAS');
        await verify();
        await deps.createSuggestion(body);
        suggestion = await deps.getSuggestionById(body.wmkf_appreviewersuggestionid, { select:SUGGESTION_FIELDS });
      } else if (!['dispatched','ambiguous','verified','recovered'].includes(entry.outcome)) fail('suggestion needs inspection');
      assertSuggestion(suggestion, body);
      if (!['verified','recovered'].includes(entry.outcome)) await finish(entry, { suggestionId:body.wmkf_appreviewersuggestionid, exists:true });
    }
    const roster = await deps.listSuggestionsByRequest(run.destinationRequestId);
    if (roster.length !== scenario.reviewers || roster.some(id => !fresh.plan.candidates.some(b => guidEqual(b.wmkf_appreviewersuggestionid,id)))) fail('roster mismatch');
    const counts = { ...emptyCounts(), candidates:roster.length };
    if (scenario.id === 7 && deriveWorkRemaining(counts) !== 'invite') fail('rollup contract mismatch');
    const verifyFinal = async (requireReady = false) => {
      const current = await verify();
      if ((scenario.phase1 !== null && current.wmkf_phaseistatus !== scenario.phase1)
          || current.wmkf_phaseiistatus !== scenario.phase2
          || (metadata.memo && scenario.memo && current[MEMO] !== scenario.memo)
          || (requireReady && scenario.ready && current.wmkf_readyforreview !== true)) fail('final scenario state drift');
      const ids = await deps.listSuggestionsByRequest(run.destinationRequestId);
      if (ids.length !== fresh.plan.candidates.length || ids.some(id => !fresh.plan.candidates.some(b => guidEqual(b.wmkf_appreviewersuggestionid,id)))) fail('final roster drift');
      for (const body of fresh.plan.candidates) assertSuggestion(await deps.getSuggestionById(body.wmkf_appreviewersuggestionid, {select:SUGGESTION_FIELDS}), body);
      const census = await validateScenarioEffects(client, run.destinationRequestId, metadata);
      if ((!fresh.plan.permittedEffects.drafts && census.emailIds.length) || (!fresh.plan.permittedEffects.tracking && census.trackingIds.length)) fail('unexpected passive effects');
      return census;
    };
    let effects = await verifyFinal();
    if (!fresh.plan.permittedEffects.drafts && effects.emailIds.length || !fresh.plan.permittedEffects.tracking && effects.trackingIds.length) fail('unexpected passive effects');
    if (scenario.ready) {
      let entry = await input.journal.get(run.runId);
      row = await verify();
      if (row.wmkf_readyforreview === true && (!entry || entry.status === 'planned')) fail('readiness set outside this finalizer');
      if (!entry) entry = await input.journal.plan(run.runId, row['@odata.etag'], row.wmkf_readyforreview);
      if (!entry || !['planned','dispatched','applied','complete'].includes(entry.status)) fail('readiness needs inspection');
      if (entry.status === 'planned') {
        if (row['@odata.etag'] !== entry.etag_before || row.wmkf_readyforreview !== entry.ready_before) fail('readiness precondition drift');
        if (!await input.journal.dispatch(run.runId, entry.attempt)) fail('readiness dispatcher lost CAS');
        await fenceReadinessClient(client, { destinationRequestId:run.destinationRequestId, sourceRequestId:run.sourceRequestId }).patchWithOptions(`/akoya_requests(${run.destinationRequestId})`, { wmkf_readyforreview:true }, { 'If-Match':entry.etag_before });
        entry = await input.journal.get(run.runId);
      }
      row = await verify();
      if (row.wmkf_readyforreview !== true) fail('readiness outcome unknown; never resend');
      if (entry.status === 'dispatched') entry = await input.journal.applied(run.runId, entry.attempt);
      if (!entry) fail('readiness applied fence lost');
      const timing = { ...COMPLETION_DEFAULTS, now:Date.now, sleep:ms => new Promise(resolve => setTimeout(resolve,ms)), ...input.completion };
      const jobs = await awaitJobs(client, run.destinationRequestId, entry.dispatched_at, timing);
      if (jobs.open?.length || jobs.notQuiet || jobs.failed.length) fail('readiness jobs not settled');
      effects = await validateScenarioEffects(client, run.destinationRequestId, metadata);
      if ((!fresh.plan.permittedEffects.drafts && effects.emailIds.length) || (!fresh.plan.permittedEffects.tracking && effects.trackingIds.length)) fail('unexpected readiness effects');
      if (entry.status !== 'complete' && !await input.journal.complete(run.runId, { kind:'j27_complete', ...effects }, entry.attempt)) fail('readiness completion fence lost');
    }
    effects = await verifyFinal(true);
    const done = await receipt('j27_complete', scenario.id);
    if (done.outcome === 'planned') await finish(done, { exists:true, ...effects }, { noWrite:true });
    return { scenario:scenario.id, runId:run.runId, requestId:run.destinationRequestId, requestNumber:run.destinationRequestNumber, status:'complete', ready:scenario.ready ? true : row.wmkf_readyforreview, memoSkipped:!!scenario.memo && !metadata.memo, effects, counts, workRemaining:deriveWorkRemaining(counts) };
  });
}
