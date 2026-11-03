import crypto from 'node:crypto';
import { jest } from '@jest/globals';
import { PREPARED_FIXTURE_CONTRACT } from '../../lib/services/test-requests/prepared-fixture-contract.js';
const hash = v => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const statusHash = crypto.createHash('sha256').update('Phase II Pending').digest('hex');
jest.mock('../../lib/services/test-requests/basic-clone-steps.js', () => ({
  bodyOrThrow: (_label, r) => { if (!r.ok) throw Error('read failed'); return r.body; },
  guidEqual: (a,b) => Boolean(a && b && a.toLowerCase() === b.toLowerCase()),
  sha256: v => require('node:crypto').createHash('sha256').update(JSON.stringify(v)).digest('hex'),
  READBACK_FIELDS: ['akoya_requestid'], validateCloneManifest: jest.fn(), bundleSourceOf: jest.fn(() => ({request:{}})),
  observe: jest.fn(async () => ({ request: {}, locations: [] })),
  listSharePointFiles: jest.fn(async () => []), reverifyClone: jest.fn(async () => []),
}));
jest.mock('../../lib/services/test-requests/run-runner.js', () => ({ inflateFileCopyEntry: row => ({ status: row.outcome, ...row.copy }) }));
jest.mock('../../lib/services/test-requests/bundle-file-copy.js', () => ({ verifyCopiedFiles: jest.fn(() => []), usesPackageIntegrity: mime => mime.includes('spreadsheet') }));
jest.mock('../../lib/services/test-requests/sandbox-clone.js', () => ({ verifyCloneRequestReadback: jest.fn(() => []), assertCopiedSourceValues: jest.fn() }));
jest.mock('../../lib/services/test-requests/foundation-transition.js', () => ({ recheckFoundationTransition: jest.fn(async () => ({ failures: [] })) }));
jest.mock('../../lib/services/test-requests/status-change-runner.js', () => ({
  assertChangeable: jest.fn(), assertWritePermitted: jest.fn(), COMPLETION_DEFAULTS: {},
  awaitJobs: jest.fn(async () => ({ jobs: [], failed: [] })),
  censusSince: jest.fn(async () => ({ emails: [], tracking: [], payments: [], requestStatus: 'Phase II Pending' })),
}));
const { finalizeReadiness, recoverReadiness, verifyPreparedCopyBytes } = require('../../lib/services/test-requests/readiness-finalizer.js');
const { bundleSourceOf, observe } = require('../../lib/services/test-requests/basic-clone-steps.js');
const { censusSince } = require('../../lib/services/test-requests/status-change-runner.js');
const RUN = '11111111-1111-4111-8111-111111111111';
const DEST = '22222222-2222-4222-8222-222222222222';
const CYCLE = '33333333-3333-4333-8333-333333333333';
function fixture({ ready = false, entry = null } = {}) {
  const bundle = { abstract: 'Applicant abstract', documents: ['reviewerProposal','proposalNarrative','proposalBibliography'].map(kind => ({ kind })) };
  const body = { akoya_requestid: DEST, wmkf_readyforreview: false, 'akoya_applicantid@odata.bind': `/accounts(${CYCLE})`, 'wmkf_ProjectLeader@odata.bind': `/contacts(${CYCLE})`, 'akoya_primarycontactid@odata.bind': `/contacts(${CYCLE})`, 'wmkf_ResearchLeader@odata.bind': `/contacts(${CYCLE})` };
  const manifest = { recipe: 'basic', targetEnvironment: 'production', createBody: body, createBodySha256: hash(body), bundle,
    source: { bundleSha256: hash(bundle) }, values: { preparedFixture: PREPARED_FIXTURE_CONTRACT, cycleCode: 'J27', grantCycleId: CYCLE, requestId: DEST, runId: RUN },
    expectedRequestType: { value: 1 }, expectedGraphSiteId: 'site', expectedGraphDriveId: 'drive', plannedFiles: [{},{},{}] };
  const run = { runId: RUN, destinationRequestId: DEST, sourceRequestId: '44444444-4444-4444-8444-444444444444', status: 'ready', recipe: 'basic', destinationEnvironment: 'production', createBodySha256: hash(body), bundleSha256: hash(bundle), destinationRequestNumber: '900001' };
  const row = { akoya_requestid: DEST, wmkf_istestrequest: true, wmkf_testcreationrunid: RUN, wmkf_phaseistatus: 100000003, wmkf_phaseiistatus: 100000002, akoya_requeststatus: 'Phase II Pending', wmkf_readyforreview: ready, _wmkf_grantcycle_value: CYCLE, wmkf_GrantCycle: { wmkf_cyclecode: 'J27' }, '@odata.etag': 'W/"100"' };
  Object.assign(row, { _akoya_applicantid_value: CYCLE, _wmkf_projectleader_value: CYCLE, _akoya_primarycontactid_value: CYCLE, _wmkf_researchleader_value: CYCLE });
  observe.mockImplementation(async () => ({ request: { ...row } }));
  const metadata = { LogicalName: 'wmkf_readyforreview', AttributeType: 'Boolean', IsValidForUpdate: true };
  let journalRow = entry;
  const move = (from, to, more = {}) => { if (journalRow?.status !== from) return null; journalRow = { ...journalRow, status: to, ...more }; return { ...journalRow }; };
  const journal = {
    get: jest.fn(async () => journalRow),
    plan: jest.fn(async (_runId, etag, before) => { if (!journalRow || journalRow.status === 'abandoned') journalRow = { status: 'planned', attempt: (journalRow?.attempt ?? 0) + 1, updated_at: '2026-11-02T00:00:00Z', etag_before: etag, ready_before: before }; return journalRow; }),
    dispatch: jest.fn(async () => move('planned','dispatched',{ dispatched_at: '2026-11-02T00:00:00Z' })),
    applied: jest.fn(async () => move('dispatched','applied')), complete: jest.fn(async () => move('applied','complete')),
    attention: jest.fn(async () => (journalRow.status = 'needs_attention')),
    recover: jest.fn(async (_runId, previous) => (journalRow = { ...previous, status: 'abandoned' })),
  };
  const client = { get: jest.fn(async path => ({ ok: true, body: path.includes('EntityDefinitions') ? { ...metadata } : { ...row } })),
    patchWithOptions: jest.fn(async () => { row.wmkf_readyforreview = true; row['@odata.etag'] = 'W/"101"'; return { ok: true }; }) };
  const bytes=Buffer.from('copied proposal bytes');
  const digest=crypto.createHash('sha256').update(bytes).digest('hex');
  const resources = [0,1,2].map(index => ({ step: 'copy_file', resourceKind: 'sharepoint_file', outcome: 'verified', copy: { destinationDriveId:'drive', destination:{filename:`Proposal_${index}.pdf`}, source:{mimeType:'application/pdf',size:bytes.length,contentHash:digest},item:{id:String(index),size:bytes.length,eTag:'W/"1"',versionId:'1'} } }));
  const graph={getSiteId:async()=> 'site',getDriveId:async()=> 'drive',getFileMetadataById:jest.fn(async(_drive,id)=> ({name:`Proposal_${id}.pdf`,size:bytes.length,eTag:'W/"1"',versionId:'1'})),downloadFile:jest.fn(async()=>({buffer:bytes}))};
  const ledger = { getRun: jest.fn(async () => run), listStatusChanges: jest.fn(async () => [{ status: 'complete', effects: { requestStatusSha256: statusHash } }]), listRunResources: jest.fn(async () => resources) };
  return { client, ledger, journal, graph, manifest, runId: RUN, row, run, metadata, resources };
}
beforeEach(() => jest.clearAllMocks());
test('preview performs no journal or Dataverse writes', async () => { const f=fixture(); expect(await finalizeReadiness(f)).toMatchObject({ written: false }); expect(f.journal.plan).not.toHaveBeenCalled(); expect(f.client.patchWithOptions).not.toHaveBeenCalled(); });
test('confirmed finalization writes exact true-only patch once; repeat is read-only', async () => { const f=fixture(); await finalizeReadiness({ ...f, confirm: true }); await finalizeReadiness({ ...f, confirm: true }); expect(f.client.patchWithOptions).toHaveBeenCalledTimes(1); expect(f.client.patchWithOptions).toHaveBeenCalledWith(`/akoya_requests(${DEST})`, { wmkf_readyforreview: true }, { 'If-Match': 'W/"100"' }); });
test('ambiguous landed write recovers by reading, without redispatch', async () => { const f=fixture(); f.client.patchWithOptions.mockImplementation(async () => { f.row.wmkf_readyforreview=true; throw Error('network'); }); await expect(finalizeReadiness({...f,confirm:true})).rejects.toThrow('unknown'); await finalizeReadiness({...f,confirm:true}); expect(f.client.patchWithOptions).toHaveBeenCalledTimes(1); });
test('ambiguous non-landed write stays unresolved and is never resent', async () => { const f=fixture(); f.client.patchWithOptions.mockRejectedValue(Error('network')); await expect(finalizeReadiness({...f,confirm:true})).rejects.toThrow('unknown'); await expect(finalizeReadiness({...f,confirm:true})).rejects.toThrow('does not yet'); expect(f.client.patchWithOptions).toHaveBeenCalledTimes(1); });
test.each(['marker','owner','phase','cycle','metadata','package','legacy','true','journal'])('refuses %s before any patch', async kind => {
  const f=fixture();
  if(kind==='marker')f.row.wmkf_istestrequest=false;
  if(kind==='owner')f.row.wmkf_testcreationrunid=CYCLE;
  if(kind==='phase')f.row.wmkf_phaseiistatus=null;
  if(kind==='cycle')f.row.wmkf_GrantCycle.wmkf_cyclecode='D26';
  if(kind==='metadata')f.metadata.IsValidForUpdate=false;
  if(kind==='package')f.resources.pop();
  if(kind==='legacy')delete f.manifest.values.preparedFixture;
  if(kind==='true')f.row.wmkf_readyforreview=true;
  if(kind==='journal')f.ledger.listStatusChanges.mockResolvedValue([{status:'applied'}]);
  await expect(finalizeReadiness({...f,confirm:true})).rejects.toThrow(); expect(f.client.patchWithOptions).not.toHaveBeenCalled();
});
test('stale file fails before journal intent and patch', async () => { const f=fixture(); f.graph.downloadFile.mockResolvedValueOnce({buffer:Buffer.from('changed')}); await expect(finalizeReadiness({...f,confirm:true})).rejects.toThrow('integrity'); expect(f.journal.plan).not.toHaveBeenCalled(); });
test('a losing dispatcher cannot send', async () => { const f=fixture(); f.journal.dispatch.mockResolvedValue(null); await expect(finalizeReadiness({...f,confirm:true})).rejects.toThrow('Another dispatcher'); expect(f.client.patchWithOptions).not.toHaveBeenCalled(); });
test('ETag drift cannot dispatch an old intent', async () => { const f=fixture({entry:{status:'planned',etag_before:'W/"99"',ready_before:false}}); await expect(finalizeReadiness({...f,confirm:true})).rejects.toThrow('precondition'); expect(f.journal.dispatch).not.toHaveBeenCalled(); });
test('unexpected post-write effects remain needs-attention rather than complete', async () => { const f=fixture(); censusSince.mockResolvedValueOnce({emails:['present-email-id'],tracking:[],payments:[],requestStatus:'Phase II Pending'}); await expect(finalizeReadiness({...f,confirm:true})).rejects.toThrow('effects'); expect(f.journal.attention).toHaveBeenCalled(); expect(f.journal.complete).not.toHaveBeenCalled(); });

test('412 stops permanently without another PATCH', async () => {
  const f=fixture(); f.client.patchWithOptions.mockResolvedValue({ok:false,status:412});
  await expect(finalizeReadiness({...f,confirm:true})).rejects.toThrow('refused');
  await expect(finalizeReadiness({...f,confirm:true})).rejects.toThrow('owner inspection');
  expect(f.client.patchWithOptions).toHaveBeenCalledTimes(1);
});
test('unselected readiness is unknown, never treated as null', async () => {
  const f=fixture();delete f.row.wmkf_readyforreview;
  await expect(finalizeReadiness({...f,confirm:true})).rejects.toThrow('unavailable');
  expect(f.journal.plan).not.toHaveBeenCalled();
});
test('changed synthetic contact refuses finalization', async () => {
  const f=fixture();f.row._akoya_primarycontactid_value=DEST;
  await expect(finalizeReadiness({...f,confirm:true})).rejects.toThrow('binding changed');
  expect(f.client.patchWithOptions).not.toHaveBeenCalled();
});

test('completed fixture uses saved source without export freshness/live revision dependency', async () => { const f=fixture();await finalizeReadiness(f);expect(bundleSourceOf).toHaveBeenCalledWith(f.manifest,{allowStale:true});expect(f.graph.downloadFile.mock.calls.every(([drive])=>drive==='drive')).toBe(true); });

test('owner recovery previews read-only, abandons without pre-planning or a PATCH', async () => {
  const f=fixture({entry:{status:'dispatched',attempt:1,etag_before:'W/"99"',ready_before:false}});
  expect(await recoverReadiness(f)).toMatchObject({mode:'READ_ONLY_READINESS_RECOVERY_PLAN',attempt:1});
  expect(f.journal.recover).not.toHaveBeenCalled();
  await expect(recoverReadiness({...f,confirmRequestId:CYCLE})).rejects.toThrow('exact destination');
  expect(await recoverReadiness({...f,confirmRequestId:DEST})).toMatchObject({status:'abandoned',attempt:1,dataverseWritten:false});
  expect(f.client.patchWithOptions).not.toHaveBeenCalled();
});
test('readiness already true cannot be reset even with exact owner confirmation', async () => {
  const f=fixture({ready:true,entry:{status:'needs_attention',attempt:1}});
  await expect(recoverReadiness({...f,confirmRequestId:DEST})).rejects.toThrow('already true');
  expect(f.journal.recover).not.toHaveBeenCalled();
});
test('a historical definitive no-write status 412 does not block a later complete transition', async () => {
  const f=fixture();f.ledger.listStatusChanges.mockResolvedValue([{status:'needs_attention',error:'The Request changed since it was read (412); nothing was written.'},{status:'complete',effects:{requestStatusSha256:statusHash}}]);
  await expect(finalizeReadiness(f)).resolves.toMatchObject({written:false});
});
test('post-copy OOXML verification uses exact attested destination bytes without reading a real source', async () => {
  const f=fixture();const copy=f.resources[0].copy;
  copy.source.mimeType='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  copy.attestedDigest=copy.source.contentHash;copy.source.contentHash='0'.repeat(64);
  expect(await verifyPreparedCopyBytes(f.graph,[{status:'verified',...copy}])).toEqual([]);
  expect(f.graph.downloadFile).toHaveBeenCalledTimes(1);
  delete copy.attestedDigest;expect(await verifyPreparedCopyBytes(f.graph,[{status:'verified',...copy}])).toHaveLength(1);
});

test('fresh ETag is read after the heavy copied-file checks', async () => {
  const f=fixture();f.graph.downloadFile.mockImplementation(async()=>{f.row['@odata.etag']='W/"200"';return {buffer:Buffer.from('copied proposal bytes')};});
  await finalizeReadiness({...f,confirm:true});
  expect(f.journal.plan).toHaveBeenCalledWith(RUN,'W/"200"',false);
  expect(f.client.patchWithOptions).toHaveBeenCalledWith(`/akoya_requests(${DEST})`,{wmkf_readyforreview:true},{'If-Match':'W/"200"'});
  expect(f.graph.downloadFile).toHaveBeenCalledTimes(3);
});

test.each(['planned','dispatched'])('owner recovery from %s allows a fresh plan after changed ETag and package checks', async status => {
  const f=fixture({entry:{status,attempt:1,etag_before:'W/"99"',ready_before:false}});
  await recoverReadiness({...f,confirmRequestId:DEST});
  f.row['@odata.etag']='W/"300"';
  await expect(finalizeReadiness({...f,confirm:true})).resolves.toMatchObject({status:'complete'});
  expect(f.client.patchWithOptions).toHaveBeenCalledTimes(1);
  expect(f.client.patchWithOptions.mock.calls[0][2]).toEqual({'If-Match':'W/"300"'});
  expect(f.journal.dispatch).toHaveBeenCalledWith(RUN,2);
});
test('a 412 then explicit owner recovery finalizes successfully with a new attempt', async () => {
  const f=fixture(); f.client.patchWithOptions.mockResolvedValueOnce({ok:false,status:412});
  await expect(finalizeReadiness({...f,confirm:true})).rejects.toThrow('refused');
  await recoverReadiness({...f,confirmRequestId:DEST});f.row['@odata.etag']='W/"400"';
  await finalizeReadiness({...f,confirm:true});expect(f.client.patchWithOptions).toHaveBeenCalledTimes(2);
  expect(f.journal.dispatch.mock.calls.map(call=>call[1])).toEqual([1,2]);
});

test.each([['needs_attention',true,'readiness_unexpected_effects'],['needs_attention',false,'readiness_etag_conflict'],['abandoned',false,'readiness_patch_refused']])('inspection preserves %s diagnostics without authorizing a write', async (status,ready,error) => {
  const f=fixture({ready,entry:{status,attempt:1,error,effects:{kind:'readiness_finalization'}}});
  expect(await finalizeReadiness(f)).toMatchObject({written:false,ready,journalStatus:status,attempt:1,error,effects:{kind:'readiness_finalization'}});
  expect(f.journal.plan).not.toHaveBeenCalled();expect(f.client.patchWithOptions).not.toHaveBeenCalled();
  if(status==='needs_attention')await expect(finalizeReadiness({...f,confirm:true})).rejects.toThrow('owner inspection');
});


test('readiness preview passes explicit prior-PDF evidence to the Foundation check and refuses its failure', async () => {
  const { recheckFoundationTransition } = require('../../lib/services/test-requests/foundation-transition.js');
  const f = fixture();
  await finalizeReadiness({ ...f, previousGoVerifyPdf: 'synthetic-prior-evidence' });
  expect(recheckFoundationTransition).toHaveBeenLastCalledWith(expect.objectContaining({ previousGoVerifyPdf: 'synthetic-prior-evidence' }));
  recheckFoundationTransition.mockResolvedValueOnce({ failures: ['protected drift'] });
  await expect(finalizeReadiness({ ...f, previousGoVerifyPdf: 'synthetic-prior-evidence', confirm: true })).rejects.toThrow('Foundation isolation');
  expect(f.client.patchWithOptions).not.toHaveBeenCalled();
});

test('readiness recovery also passes the same prior-PDF evidence to its prerequisite check', async () => {
  const { recheckFoundationTransition } = require('../../lib/services/test-requests/foundation-transition.js');
  const f = fixture({ entry: { status: 'needs_attention', attempt: 1 } });
  await recoverReadiness({ ...f, previousGoVerifyPdf: 'synthetic-prior-evidence' });
  expect(recheckFoundationTransition).toHaveBeenLastCalledWith(expect.objectContaining({ previousGoVerifyPdf: 'synthetic-prior-evidence' }));
  expect(f.client.patchWithOptions).not.toHaveBeenCalled();
});
