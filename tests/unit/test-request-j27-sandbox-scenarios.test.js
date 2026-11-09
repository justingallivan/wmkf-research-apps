import { jest } from '@jest/globals';
// Shared clone validators have their own Factory suites; these tests exercise
// the new orchestration with a stateful transport and durable-dispatch model.
jest.mock('../../lib/services/test-requests/basic-clone-steps.js', () => ({
  bodyOrThrow: (_label,r) => { if (!r.ok) throw Error(`HTTP ${r.status}`); return r.body; }, guidEqual:(a,b) => !!a && !!b && a.toLowerCase() === b.toLowerCase(),
  READBACK_FIELDS:['akoya_requestid'], validateCloneManifest:jest.fn(),
}));
jest.mock('../../lib/services/test-requests/sandbox-clone.js', () => ({ ...jest.requireActual('../../lib/services/test-requests/sandbox-clone.js'), verifyCloneRequestReadback:jest.fn(() => []) }));
jest.mock('../../lib/services/test-requests/reviews-sandbox-deps.js', () => ({ createReviewsSandboxDeps:jest.fn() }));
jest.mock('../../lib/services/test-requests/status-change-runner.js', () => ({
  assertWritePermitted:jest.fn(), COMPLETION_DEFAULTS:{}, awaitJobs:jest.fn(async () => ({jobs:[],failed:[]})),
  readLiveOptions:jest.fn(async (_client,field) => (field === 'wmkf_phaseistatus' ? [100000005,100000004,707510006,707510005,100000003] : [100000002]).map(value => ({value,label:String(value)}))),
  runStatusChange:jest.fn(async ({client,field,optionLabel,ledger,runId}) => {
    const run = await ledger.getRun(runId); const response = await client.get(`/akoya_requests(${run.destinationRequestId})`);
    await client.patchWithOptions(`/akoya_requests(${run.destinationRequestId})`,{[field]:Number(optionLabel)},{'If-Match':response.body['@odata.etag']});
    ledger.changes.push({field,optionAfter:Number(optionLabel),status:'complete'});
  }),
}));
import { withDalContext } from '../../lib/dataverse/core/context.js';
import { createReadinessJournal } from '../../lib/services/test-requests/readiness-journal.js';
import { createRunLedger, assertLedgerReceipt } from '../../lib/services/test-requests/run-ledger.js';
const { SCENARIOS, MEMO, PROPOSAL_RECEIVED, digest, deterministicId, assertSandboxOrigin, sandboxFetch, completeList, readScenarioMetadata, assertDraftEmails, assertSyntheticReviewer, assertSuggestion, candidateBodies, scenarioClient, assertScenarioRow, finalizeScenario, previewScenario, validateScenarioEffects } = require('../../lib/services/test-requests/j27-sandbox-scenarios.js');
const ORIGIN='https://orgd9e66399.crm.dynamics.com';
const id = n => `${String(n).padStart(8,'0')}-1111-4111-8111-111111111111`;
const actor='cli:'+ 'a'.repeat(16);
const trusted = fn => withDalContext('j27-unit',fn);
const env={DATAVERSE_TARGET_INTERLOCK:'on',DATAVERSE_DAL_ENFORCEMENT:'on'};
beforeEach(() => { Object.assign(process.env,env); jest.clearAllMocks(); });
function fixture(n=1) {
  const scenario=SCENARIOS[n-1]; const resources=[]; const suggestions=new Map(); let stamp=null; let version=1;
  const manifest={bundle:{sandboxScenarioSource:true,source:{dataverseHost:new URL(ORIGIN).hostname}},values:{j27Scenario:n,cycleCode:'J27',runId:id(1),requestId:id(2),grantCycleId:id(3),programDirectorId:id(4),grantProgramId:id(5)},source:{bundleSha256:'b'.repeat(64)},createBodySha256:'c'.repeat(64)};
  const run={runId:id(1),destinationRequestId:id(2),sourceRequestId:id(9),destinationEnvironment:'sandbox',sourceDataverseHost:new URL(ORIGIN).hostname,destinationDataverseHost:new URL(ORIGIN).hostname,status:'ready',actorId:actor,createBodySha256:manifest.createBodySha256,bundleSha256:manifest.source.bundleSha256};
  const row={akoya_requestid:id(2),wmkf_istestrequest:true,wmkf_testcreationrunid:id(1),_wmkf_grantcycle_value:id(3),_wmkf_programdirector_value:id(4),_wmkf_grantprogram_value:id(5),wmkf_respondreminderenabled:false,wmkf_reviewduereminderenabled:false,akoya_title:'TEST: J27',wmkf_readyforreview:false,wmkf_phaseistatus:null,wmkf_phaseiistatus:null,[PROPOSAL_RECEIVED]:null,[MEMO]:null,'@odata.etag':'W/"1"'};
  const emails=[]; const payments=[]; const jobs=[]; const tracking=[];
  const attributes=[{LogicalName:'wmkf_readyforreview',AttributeType:'Boolean',IsValidForUpdate:true},{LogicalName:MEMO,AttributeType:'Memo',IsValidForUpdate:true}];
  const client={baseUrl:ORIGIN+'/api/data/v9.2',get:jest.fn(async path => {
    if(path.includes('DateTimeAttributeMetadata')) return {ok:true,body:{AttributeType:'DateTime',IsValidForUpdate:true,DateTimeBehavior:{Value:'DateOnly'},Format:'DateOnly'}};
    if(path.includes("LogicalName='email'")) return {ok:true,body:{OptionSet:{Options:[{Value:path.includes('statecode')?0:1,State:0,Label:{UserLocalizedLabel:{Label:'Draft'}}}]}}};
    const value=path.includes('/Attributes?')?attributes:path.startsWith('/emails?')?emails:path.startsWith('/akoya_requestpayments?')?payments:path.startsWith('/asyncoperations?')?jobs:path.startsWith('/akoya_goapplystatustrackings?')?tracking:null;
    return {ok:true,body:value?{value}: {...row}};
  })};
  const ledger={changes:[],getRun:jest.fn(async()=>run),listRunResources:jest.fn(async()=>resources),listStatusChanges:jest.fn(async()=>ledger.changes),assertJ27Lock:jest.fn(async()=>true),withJ27RunLock:jest.fn(async(_id,_actor,fn)=>fn(ledger)),
    planJ27Resource:jest.fn(async spec=>{ const identity={...spec.plannedIdentity,kind:spec.kind,index:spec.index}; assertLedgerReceipt(identity); if(spec.sourceProvenance)assertLedgerReceipt(spec.sourceProvenance);let r=resources.find(r=>r.plannedIdentity.kind===spec.kind&&r.plannedIdentity.index===spec.index);if(!r){r={resourceId:resources.length+1,plannedIdentity:identity,sourceProvenance:spec.sourceProvenance,outcome:'planned'};resources.push(r);}return {...r};}),
    dispatchJ27Resource:jest.fn(async key=>{const r=resources.find(r=>r.resourceId===key);if(r.outcome!=='planned')return null;r.outcome='dispatched';return {...r};}),
    finishJ27Resource:jest.fn(async(key,readback)=>{assertLedgerReceipt(readback);const r=resources.find(r=>r.resourceId===key);r.outcome='verified';r.readback=readback;return {...r};})};
  const person=personId=>({wmkf_potentialreviewersid:personId,wmkf_issyntheticreviewer:true,statecode:0,_wmkf_contact_value:null});
  const deps={getPersonById:jest.fn(async personId=>person(personId)),listSuggestionsByRequest:jest.fn(async()=>[...suggestions.keys()]),getSuggestionById:jest.fn(async key=>suggestions.get(key)||null),
    createSuggestion:jest.fn(async body=>{const key=body.wmkf_appreviewersuggestionid; suggestions.set(key,{wmkf_appreviewersuggestionid:key,_wmkf_potentialreviewer_value:/\(([^)]+)\)/.exec(body['wmkf_PotentialReviewer@odata.bind'])[1],_wmkf_request_value:id(2),wmkf_grantcyclecode:'J27',wmkf_selected:true,wmkf_applicantdisposition:body.wmkf_applicantdisposition,statecode:0,wmkf_invited:false,wmkf_emailsentat:null,wmkf_accepted:false,wmkf_declined:false,wmkf_externaltokenhash:null,wmkf_externaltokenissued:null,wmkf_externaltokenexpires:null,wmkf_responsetype:null,wmkf_reviewstatus:null});}),
    runChangeset:jest.fn(async ops=>{Object.assign(row,ops[0].body);row['@odata.etag']=`W/"${++version}"`;if(row.wmkf_phaseiistatus===100000002 && row[PROPOSAL_RECEIVED] != null)row.akoya_requeststatus='Phase II Pending';return {ok:true,operations:[{status:204}]};})};
  const journal={get:jest.fn(async()=>stamp),plan:jest.fn(async(_id,etag,before)=>stamp={status:'planned',attempt:1,etag_before:etag,ready_before:before}),dispatch:jest.fn(async()=>{if(stamp.status!=='planned')return null;stamp={...stamp,status:'dispatched',dispatched_at:new Date().toISOString()};return stamp;}),applied:jest.fn(async()=>stamp={...stamp,status:'applied'}),complete:jest.fn(async()=>stamp={...stamp,status:'complete'})};
  return {client,ledger,journal,manifest,actorId:actor,reviewerIds:n===7?[id(6),id(7)]:[],deps,row,run,resources,suggestions,attributes,emails,payments,jobs,tracking,scenario,metadata:{memo:true,emailOptions:{statecode:0,statuscode:1}}};
}
async function confirmed(f){return trusted(async()=>{const p=await previewScenario(f);return finalizeScenario({...f,confirm:p.digest});});}
test.each(SCENARIOS)('scenario $id exact final state and no forbidden writes',async scenario=>{const f=fixture(scenario.id);const result=await confirmed(f);expect(result.status).toBe('complete');expect(f.row.wmkf_readyforreview).toBe(scenario.ready);expect(f.row.wmkf_phaseistatus).toBe(scenario.phase1);expect(f.row.wmkf_phaseiistatus).toBe(scenario.phase2);expect(f.row[MEMO]).toBe(scenario.memo);expect(f.suggestions.size).toBe(scenario.reviewers);for(const [ops]of f.deps.runChangeset.mock.calls){expect(Object.keys(ops[0].body)).toHaveLength(1);expect(ops[0].body).not.toHaveProperty('wmkf_triagestatus');expect(ops[0].body).not.toHaveProperty('akoya_requeststatus');expect(ops[0].body.wmkf_readyforreview).not.toBe(false);}if(scenario.id===7)expect(result.workRemaining).toBe('invite');});
test.each([1,2,8])('scenario %i retains pending clone Phase I',async n=>{const f=fixture(n);f.row.wmkf_phaseistatus=100000000;await confirmed(f);expect(f.row.wmkf_phaseistatus).toBe(100000000);});
test('preview is read-only with an actual requested memo/status/readiness change',async()=>{const f=fixture(7);const p=await trusted(()=>finalizeScenario(f));expect(p.writes.some(w=>w.action==='patch')).toBe(true);expect(f.ledger.planJ27Resource).not.toHaveBeenCalled();expect(f.journal.plan).not.toHaveBeenCalled();expect(f.deps.runChangeset).not.toHaveBeenCalled();expect(f.deps.createSuggestion).not.toHaveBeenCalled();});
test.each(['https://wmkf.crm.dynamics.com','https://unknown.crm.dynamics.com','http://orgd9e66399.crm.dynamics.com','https://orgd9e66399.crm.dynamics.com/','https://user@orgd9e66399.crm.dynamics.com','https://orgd9e66399.crm.dynamics.com:8443','not-a-url'])('refuses unsafe origin %s',origin=>expect(()=>assertSandboxOrigin(origin,env)).toThrow());
test.each(['DATAVERSE_TARGET_INTERLOCK','DATAVERSE_DAL_ENFORCEMENT'])('refuses disabled %s',key=>{process.env[key]='off';expect(()=>assertSandboxOrigin(ORIGIN)).toThrow();});
test('mixed target is refused before transport',async()=>{const fetcher=jest.fn();await expect(sandboxFetch(fetcher,ORIGIN)('https://wmkf.crm.dynamics.com/api/data/v9.2/accounts')).rejects.toThrow('mixed-target');expect(fetcher).not.toHaveBeenCalled();});
test('redirect response is refused and automatic following disabled',async()=>{const fetcher=jest.fn(async()=>({redirected:true,url:'https://wmkf.crm.dynamics.com'}));await expect(sandboxFetch(fetcher,ORIGIN)(ORIGIN+'/api/data/v9.2/accounts')).rejects.toThrow('redirect');expect(fetcher.mock.calls[0][1].redirect).toBe('error');});
test('untrusted context refuses before reads',async()=>{const f=fixture();await expect(previewScenario(f)).rejects.toThrow();expect(f.client.get).not.toHaveBeenCalled();});
test.each([
  ['wmkf_istestrequest',false],['wmkf_testcreationrunid',id(90)],['_wmkf_grantprogram_value',id(90)],['_wmkf_programdirector_value',id(90)],['_wmkf_grantcycle_value',id(90)],['wmkf_respondreminderenabled',true],['wmkf_reviewduereminderenabled',true],['wmkf_phaseistatus',100000003],['wmkf_phaseiistatus',100000002],[MEMO,'A real human rationale'],['@odata.etag','*'],
])('rejects unsafe fixture %s=%s',async(field,value)=>{const f=fixture();f.row[field]=value;await expect(trusted(()=>previewScenario(f))).rejects.toThrow();expect(f.deps.runChangeset).not.toHaveBeenCalled();});
test.each([['actorId','cli:foreign'],['destinationEnvironment','production'],['createBodySha256','stale'],['status','creating']])('refuses unsafe run %s',async(field,value)=>{const f=fixture();f.run[field]=value;await expect(trusted(()=>previewScenario(f))).rejects.toThrow();});
test('control already true is refused without repair',async()=>{const f=fixture(8);f.row.wmkf_readyforreview=true;await expect(confirmed(f)).rejects.toThrow('control already ready');expect(f.deps.runChangeset).not.toHaveBeenCalled();});
test('bad digest and state drift refuse before journal',async()=>{const f=fixture(2);const p=await trusted(()=>previewScenario(f));f.row['@odata.etag']='W/"99"';await expect(trusted(()=>finalizeScenario({...f,confirm:p.digest}))).rejects.toThrow('digest');expect(f.ledger.planJ27Resource).not.toHaveBeenCalled();});
test('deterministic identities bind scenario and slot',()=>{expect(deterministicId('batch',1,'run')).toBe(deterministicId('batch',1,'run'));expect(deterministicId('batch',1,'run')).not.toBe(deterministicId('batch',2,'run'));expect(digest(null)).not.toBe(digest(''));});
test('confirmed memo absence produces legal skip and no memo dispatch',async()=>{const f=fixture(2);f.attributes.pop();const result=await confirmed(f);expect(result.memoSkipped).toBe(true);const skip=f.resources.find(r=>r.plannedIdentity.kind==='j27_memo_skip');expect(skip.readback).toEqual({exists:false,outcome:'memo_absent'});expect(f.deps.runChangeset.mock.calls.every(([ops])=>!Object.hasOwn(ops[0].body,MEMO))).toBe(true);});
test.each([401,403,500])('metadata HTTP %i is not absent',async status=>{const f=fixture(2);f.client.get.mockResolvedValue({ok:false,status});await expect(readScenarioMetadata(f.client)).rejects.toThrow();});
test('wrong memo type is not absent',async()=>{const f=fixture(2);f.attributes[1].AttributeType='String';await expect(readScenarioMetadata(f.client)).rejects.toThrow('not absence');});
test.each([{wmkf_triagestatus:707510000},{akoya_requeststatus:'Phase II Pending'},{wmkf_readyforreview:false},{wmkf_phaseistatus:null},{[MEMO]:'human text'},{wmkf_readyforreview:true,wmkf_phaseistatus:100000003}])('actual unsafe PATCH %j rejected',async body=>{const f=fixture(7);const client=scenarioClient({...f,verify:async()=>f.row});await expect(trusted(()=>client.patchWithOptions(`/akoya_requests(${id(2)})`,body,{'If-Match':'W/"1"'}))).rejects.toThrow('unsafe PATCH');expect(f.deps.runChangeset).not.toHaveBeenCalled();});
test('stale ETag refuses before transport',async()=>{const f=fixture();const client=scenarioClient({...f,verify:async()=>({...f.row,'@odata.etag':'W/"2"'})});await expect(trusted(()=>client.patchWithOptions(`/akoya_requests(${id(2)})`,{wmkf_readyforreview:true},{'If-Match':'W/"1"'}))).rejects.toThrow('ETag');expect(f.deps.runChangeset).not.toHaveBeenCalled();});
test('failed intent persistence prevents transport',async()=>{const f=fixture(2);f.ledger.planJ27Resource.mockRejectedValue(Error('database disconnected'));await expect(confirmed(f)).rejects.toThrow('disconnected');expect(f.deps.runChangeset).not.toHaveBeenCalled();});
test('lost memo CAS prevents transport',async()=>{const f=fixture(2);f.ledger.dispatchJ27Resource.mockResolvedValue(null);await expect(confirmed(f)).rejects.toThrow('CAS');expect(f.deps.runChangeset).not.toHaveBeenCalled();});
test.each([true,false])('ambiguous memo landed=%s never redispatched',async landed=>{const f=fixture(2);const original=f.deps.runChangeset.getMockImplementation();f.deps.runChangeset.mockImplementation(async ops=>{if(landed)await original(ops);throw Error('connection lost');});await expect(confirmed(f)).rejects.toThrow('connection lost');const sends=f.deps.runChangeset.mock.calls.length;f.deps.runChangeset.mockImplementation(original);if(landed)await confirmed(f);else await expect(confirmed(f)).rejects.toThrow('never resend');expect(f.deps.runChangeset.mock.calls.slice(sends).every(([ops])=>!Object.hasOwn(ops[0].body,MEMO))).toBe(true);});
test('lost advisory connection refuses real planned write',async()=>{const f=fixture(2);f.ledger.assertJ27Lock.mockRejectedValue(Error('connection lost'));await expect(confirmed(f)).rejects.toThrow('connection lost');expect(f.deps.runChangeset).not.toHaveBeenCalled();});
test.each([{statecode:1,statuscode:2,senton:null},{statecode:0,statuscode:6,senton:null},{statecode:0,statuscode:7,senton:null},{statecode:0,statuscode:999,senton:null},{statecode:0,statuscode:1,senton:'2026-11-08T00:00:00Z'}])('unsafe email %j fails',row=>expect(()=>assertDraftEmails([row],{statecode:0,statuscode:1})).toThrow());
test('Draft and expected tracking accepted',async()=>{const f=fixture(7);f.emails.push({activityid:id(10),statecode:0,statuscode:1,senton:null});f.tracking.push({akoya_goapplystatustrackingid:id(11)});expect((await confirmed(f)).effects.emailIds).toEqual([id(10)]);});
test('late sent draft blocks resume',async()=>{const f=fixture(7);f.emails.push({activityid:id(10),statecode:0,statuscode:1,senton:null});await confirmed(f);f.emails[0].statuscode=3;f.emails[0].senton='2026-11-08T00:00:00Z';await expect(confirmed(f)).rejects.toThrow('Draft');});
test('incomplete census is refused with actual continuation',async()=>{const client={get:async()=>({ok:true,body:{value:[{activityid:id(1)}],'@odata.nextLink':ORIGIN+'/api/data/v9.2/emails?$skiptoken=x'}})};await expect(completeList(client,'/emails')).rejects.toThrow('incomplete');});
test.each(['payments','jobs'])('actual unsafe %s blocks',async kind=>{const f=fixture(7);f[kind].push(kind==='payments'?{akoya_requestpaymentid:id(12)}:{asyncoperationid:id(12),statecode:1,statuscode:20});await expect(confirmed(f)).rejects.toThrow();expect(f.deps.runChangeset).not.toHaveBeenCalled();});
test.each([{wmkf_issyntheticreviewer:false},{statecode:1},{_wmkf_contact_value:id(88)}])('unsafe reviewer %j refused',override=>expect(()=>assertSyntheticReviewer({wmkf_potentialreviewersid:id(6),wmkf_issyntheticreviewer:true,statecode:0,_wmkf_contact_value:null,...override},id(6))).toThrow());
test.each([{wmkf_selected:false},{wmkf_invited:true},{wmkf_externaltokenhash:'tokenhash'},{_wmkf_request_value:id(88)},{wmkf_accepted:true}])('unsafe suggestion %j refused',async override=>{const f=fixture(7);await confirmed(f);const [key,row]=[...f.suggestions.entries()][0];Object.assign(row,override);expect(()=>assertSuggestion(row,candidateBodies(id(1),id(2),[id(6),id(7)])[0])).toThrow();expect(key).toBeTruthy();});
test('readiness SQL defaults production and explicitly opts into sandbox',async()=>{for(const environment of [undefined,'sandbox']){const queries=[];const tx={query:async(sql,args)=>{queries.push({sql,args});return{rows:[]};}};const db={...tx,transaction:fn=>fn(tx)};await createReadinessJournal(db,environment?{environment}:undefined).plan(id(1),'W/"1"',false);expect(queries[0].args).toEqual([id(1),environment||'production']);}});
test('readiness false/null prior only; true is an actual rejected input',async()=>{const db={transaction:jest.fn()};await expect(createReadinessJournal(db,{environment:'sandbox'}).plan(id(1),'W/"1"',true)).rejects.toThrow();expect(db.transaction).not.toHaveBeenCalled();});
test('concurrent advisory lock loser never enters invocation',async()=>{const fn=jest.fn();const db={transaction:cb=>cb({query:async()=>({rows:[{locked:false}]})})};await expect(createRunLedger(db).withJ27RunLock(id(1),actor,fn)).rejects.toThrow('Another J27 invocation');expect(fn).not.toHaveBeenCalled();});

test.each(['j27_memo','j27_proposal_received'])('ready-run %s SQL commits intent and one dispatch, then fences escaped scope',async kind=>{
  let stored=null; let scope; const queries=[];
  const db={transaction:async fn=>fn({query:async(sql,args=[])=>{
    queries.push({sql,args});
    if(sql.includes('pg_try_advisory'))return{rows:[{locked:true}]};
    if(sql==='SELECT 1')return{rows:[{}]};
    if(sql.includes('SELECT * FROM test_request_runs'))return{rows:[{destination_request_id:id(2)}]};
    if(sql.includes('SELECT * FROM test_request_run_resources'))return{rows:stored?[stored]:[]};
    if(sql.includes('INSERT INTO test_request_run_resources')){stored={resource_id:1,run_id:id(1),planned_identity:JSON.parse(args[2]),source_provenance:JSON.parse(args[3]),outcome:'planned'};return{rows:[stored]};}
    if(sql.includes("SET outcome='dispatched'")){expect(sql).toContain("'"+kind+"'");expect(sql).toContain("outcome='planned' AND dispatched_at IS NULL");if(stored.outcome!=='planned')return{rows:[]};stored={...stored,outcome:'dispatched'};return{rows:[stored]};}
    throw Error('unexpected SQL');
  }})};
  await createRunLedger(db).withJ27RunLock(id(1),actor,async ledger=>{
    scope=ledger; const spec={kind,index:2,plannedIdentity:{requestId:id(2),field:MEMO,contentHash:digest('synthetic'),inputFingerprint:digest('plan'),eTagBefore:'W/"1"'},sourceProvenance:{contentHash:digest(null)}};
    const first=await ledger.planJ27Resource(spec);const again=await ledger.planJ27Resource(spec);expect(again.resourceId).toBe(first.resourceId);
    expect(await ledger.dispatchJ27Resource(first.resourceId)).toMatchObject({outcome:'dispatched'});expect(await ledger.dispatchJ27Resource(first.resourceId)).toBeNull();
    await expect(ledger.planJ27Resource({...spec,plannedIdentity:{...spec.plannedIdentity,contentHash:digest('changed unsafe memo')}})).rejects.toThrow('intent changed');
  });
  await expect(scope.assertJ27Lock(id(1))).rejects.toThrow('not active');
  expect(queries.filter(q=>q.sql.includes('INSERT INTO test_request_run_resources'))).toHaveLength(1);
});
test('ready-run resource parent must remain sandbox ready and owned',async()=>{
  const unsafeParent={destination_environment:'production',actor_id:'cli:ffffffffffffffff',status:'creating'};
  const db={transaction:fn=>fn({query:async(sql,args)=>{
    if(sql.includes('pg_try_advisory'))return{rows:[{locked:true}]};
    if(sql==='SELECT 1')return{rows:[{}]};
    expect(sql).toContain("destination_environment='sandbox' AND status='ready'");expect(args[1]).toBe(actor);
    return{rows:unsafeParent.destination_environment==='sandbox'&&unsafeParent.actor_id===args[1]&&unsafeParent.status==='ready'?[unsafeParent]:[]};
  }})};
  await expect(createRunLedger(db).withJ27RunLock(id(1),actor,l=>l.planJ27Resource({kind:'j27_memo',index:2,plannedIdentity:{requestId:id(2)}}))).rejects.toThrow('ownership changed');
});
test('late Phase I drift after readiness does not complete',async()=>{const f=fixture(4);const original=f.journal.complete.getMockImplementation();f.journal.complete.mockImplementation(async()=>{f.row.wmkf_phaseistatus=100000000;return original();});await expect(confirmed(f)).rejects.toThrow('final scenario state drift');expect(f.resources.some(r=>r.plannedIdentity.kind==='j27_complete')).toBe(false);});
test('foreign true readiness refuses before memo dispatch',async()=>{const f=fixture(2);f.row.wmkf_readyforreview=true;await expect(confirmed(f)).rejects.toThrow('outside this finalizer');expect(f.deps.runChangeset).not.toHaveBeenCalled();});
test('ambiguous suggestion POST recovers by exact GUID without duplicate',async()=>{const f=fixture(7);const original=f.deps.createSuggestion.getMockImplementation();f.deps.createSuggestion.mockImplementationOnce(async body=>{await original(body);throw Error('POST reply lost');});await expect(confirmed(f)).rejects.toThrow('POST reply lost');await confirmed(f);expect(f.deps.createSuggestion).toHaveBeenCalledTimes(2);expect(f.suggestions.size).toBe(2);});
test('actual 412 transport refusal leaves dispatch evidence and never resends memo',async()=>{const f=fixture(2);f.deps.runChangeset.mockRejectedValue(Object.assign(Error('412 ETag conflict'),{status:412}));await expect(confirmed(f)).rejects.toThrow('412');await expect(confirmed(f)).rejects.toThrow('never resend');expect(f.deps.runChangeset).toHaveBeenCalledTimes(1);});
test('non-Draft state label is valid when Draft status points at it',async()=>{const f=fixture();const original=f.client.get.getMockImplementation();f.client.get.mockImplementation(async path=>{const r=await original(path);if(path.includes("LogicalName='email'")&&path.includes('statecode'))r.body.OptionSet.Options[0].Label.UserLocalizedLabel.Label='Open';return r;});expect((await readScenarioMetadata(f.client)).emailOptions).toEqual({statecode:0,statuscode:1});});
test('sandbox source bundles require explicit opt-in; production default remains closed',()=>{
  const {buildSourceBundle,readSourceBundle}=jest.requireActual('../../lib/services/test-requests/source-bundle.js');
  const spec={sourceRow:{akoya_requestid:id(90),akoya_requestnum:'1000372',akoya_requesttype:100000001,versionnumber:123},documents:[],dataverseHost:new URL(ORIGIN).hostname,exportedAt:new Date('2026-11-08T00:00:00Z'),applicantAbstract:'Synthetic abstract'};
  expect(()=>buildSourceBundle(spec)).toThrow('registered production host');
  const bundle=buildSourceBundle({...spec,sandboxScenarioSource:true});expect(readSourceBundle(bundle)).toEqual(bundle);
  expect(()=>buildSourceBundle({...spec,sandboxScenarioSource:true,dataverseHost:'wmkf.crm.dynamics.com'})).toThrow('registered production host');
  expect(()=>buildSourceBundle({...spec,sandboxScenarioSource:true,reviewers:[]})).toThrow('registered production host');
});
test('compiler sandbox bindings add only program and PD; rejects cast payload',()=>{
  const {compileTestRequestDraft}=jest.requireActual('../../lib/services/test-requests/policy.js');
  const fields={};for(const name of ['akoya_requestid','akoya_title','akoya_purpose','wmkf_abstract','akoya_request','akoya_fiscalyear','akoya_requesttype','wmkf_meetingdate','wmkf_istestrequest','wmkf_testcreationrunid','wmkf_respondreminderenabled','wmkf_reviewduereminderenabled'])fields[name]={createable:true,requiredLevel:'None',type:'String',maxLength:100000};
  Object.assign(fields,{akoya_applicantid:{createable:true,type:'Lookup',lookupTarget:'accounts'},wmkf_programdirector:{createable:true,type:'Lookup',lookupEntity:'systemuser',navigationProperty:'wmkf_ProgramDirector'},wmkf_grantprogram:{createable:true,type:'Lookup',lookupEntity:'wmkf_grantprogram',navigationProperty:'wmkf_GrantProgram'}});
  for (const spec of Object.values(fields)) spec.requiredLevel='None';
  for (const name of ['wmkf_istestrequest','wmkf_respondreminderenabled','wmkf_reviewduereminderenabled']) fields[name].type='Boolean';
  fields.akoya_request.type='Money'; fields.akoya_request.minValue=0; fields.akoya_request.maxValue=1000000; fields.akoya_requesttype.type='Picklist'; fields.wmkf_meetingdate.type='DateOnly';
  fields.akoya_requestid.type='Uniqueidentifier'; fields.wmkf_testcreationrunid.type='Uniqueidentifier';
  const input={recipe:'basic',sourceRequest:{akoya_requestid:id(9),akoya_purpose:'Synthetic',akoya_request:100},sourceAbstract:'Synthetic',testLabel:'J27',fiscalYear:'December 2027',requestType:100000001,meetingDate:'2027-01-01',metadata:{entity:'akoya_request',fields},requestId:id(2),runId:id(1),testOrganizationId:id(3),sandboxAssignment:{programDirectorId:id(4),grantProgramId:id(5)}};
  const output=compileTestRequestDraft(input);expect(output.blockers).toEqual([]);expect(output.createBody['wmkf_ProgramDirector@odata.bind']).toBe(`/systemusers(${id(4)})`);expect(output.createBody['wmkf_GrantProgram@odata.bind']).toBe(`/wmkf_grantprograms(${id(5)})`);
  const bad=compileTestRequestDraft({...input,sandboxAssignment:{...input.sandboxAssignment,piContactId:id(6)}});expect(bad.blockers.some(b=>b.field==='sandboxAssignment')).toBe(true);
});
test('sandbox J27 manifest refuses actual cast and production assignments',()=>{
  const {buildCloneManifest}=jest.requireActual('../../lib/services/test-requests/basic-clone-steps.js');
  const values={j27Scenario:7,cycleCode:'J27',grantCycleId:id(3),programDirector:{systemuserid:id(4)},cast:{piContactId:id(6)},recipe:'basic'};
  expect(()=>buildCloneManifest({targetEnvironment:'sandbox',grantProgram:{grantprogramid:id(5)}},values)).toThrow('Invalid sandbox J27');
  expect(()=>buildCloneManifest({targetEnvironment:'production',grantProgram:{grantprogramid:id(5)}},{...values,cast:null})).toThrow('Invalid sandbox J27');
});
test('prebuilt production manifest cannot smuggle explicit sandbox source',()=>{
  const {validateCloneManifest,MANIFEST_V4}=jest.requireActual('../../lib/services/test-requests/basic-clone-steps.js');
  const manifest={kind:MANIFEST_V4,target:'https://wmkf.crm.dynamics.com',targetEnvironment:'production',values:{programDirectorId:id(4),grantProgramId:id(5),piContactId:id(6),liaisonContactId:id(7),researchLeaderContactId:id(8)},bundle:{sandboxScenarioSource:true,source:{dataverseHost:new URL(ORIGIN).hostname}}};
  expect(()=>validateCloneManifest(manifest)).toThrow('production-origin bundle');
});
test.each(['destinationDataverseHost','sourceDataverseHost'])('actual production %s on named run refused',async field=>{const f=fixture();f.run[field]='wmkf.crm.dynamics.com';await expect(trusted(()=>previewScenario(f))).rejects.toThrow('provenance');expect(f.deps.runChangeset).not.toHaveBeenCalled();});
test('status runner keeps production default and refuses unlocked sandbox invocation',async()=>{
  const {assertChangeable,runStatusChange}=jest.requireActual('../../lib/services/test-requests/status-change-runner.js');
  const f=fixture(7);await expect(assertChangeable(f.client,f.run)).rejects.toThrow('production');expect(f.client.get).not.toHaveBeenCalled();
  await expect(runStatusChange({client:f.client,ledger:{getRun:async()=>f.run},runId:id(1),field:'wmkf_phaseistatus',optionLabel:'Invited',environment:'sandbox'})).rejects.toThrow('J27 lock');expect(f.client.get).not.toHaveBeenCalled();
});
test('CLI closed parser rejects actual unsafe flags before accessing environment',()=>{
  const {execFileSync}=require('node:child_process');
  const base=['--target=sandbox','--all','--batch-key=test','--source-request-number=1000372','--director=test@example.org',`--reviewers=${id(6)},${id(7)}`];
  const unsafe=[base.map(x=>x==='--target=sandbox'?'--target=production':x),[...base,'--wmkf_triagestatus=100000000'],[...base,'--confirm=yes'],[...base,`--run-id=${id(1)}`],base.map(x=>x==='--all'?'--scenario':x),[...base,'--director=other@example.org'],[...base,'--bypass-goverify=yes']];
  const code=`import {parseArgs} from './scripts/rehearse-j27-factory-scenarios.mjs'; const bad=${JSON.stringify(unsafe)}; console.log(JSON.stringify(bad.map(args=>{try{parseArgs(args);return false}catch{return true}})));`;
  const output=execFileSync(process.execPath,['--import','./scripts/lib/use-extensionless.mjs','--input-type=module','-e',code],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
  expect(JSON.parse(output.trim())).toEqual(unsafe.map(()=>true));
});
test('CLI GoVerify bypass is off by default and only a bare flag enables it',()=>{
  const {execFileSync}=require('node:child_process');
  const base=['--target=sandbox','--all','--batch-key=test','--source-request-number=1000372','--director=test@example.org',`--reviewers=${id(6)},${id(7)}`];
  const code=`import {parseArgs} from './scripts/rehearse-j27-factory-scenarios.mjs'; console.log(JSON.stringify([parseArgs(${JSON.stringify(base)}).bypassGoverify, parseArgs(${JSON.stringify([...base,'--bypass-goverify'])}).bypassGoverify]));`;
  const output=execFileSync(process.execPath,['--import','./scripts/lib/use-extensionless.mjs','--input-type=module','-e',code],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
  expect(JSON.parse(output.trim())).toEqual([false,true]);
});
test('unready control retains null without readiness write',async()=>{const f=fixture(8);f.row.wmkf_readyforreview=null;await confirmed(f);expect(f.row.wmkf_readyforreview).toBeNull();expect(f.journal.plan).not.toHaveBeenCalled();});
test('ambiguous non-landed suggestion is never posted again',async()=>{const f=fixture(7);f.deps.createSuggestion.mockRejectedValue(Error('POST lost before response'));await expect(confirmed(f)).rejects.toThrow('POST lost');await expect(confirmed(f)).rejects.toThrow('projection incomplete');expect(f.deps.createSuggestion).toHaveBeenCalledTimes(1);});
test.each([true,false])('ambiguous readiness landed=%s never patches again',async landed=>{const f=fixture();const original=f.deps.runChangeset.getMockImplementation();f.deps.runChangeset.mockImplementation(async ops=>{if(landed)await original(ops);throw Error('readiness connection lost');});await expect(confirmed(f)).rejects.toThrow('connection lost');f.deps.runChangeset.mockImplementation(original);if(landed)await confirmed(f);else await expect(confirmed(f)).rejects.toThrow('never resend');expect(f.deps.runChangeset).toHaveBeenCalledTimes(1);});
test('late unexpected draft blocks completion even when safe Draft',async()=>{const f=fixture();const original=f.journal.complete.getMockImplementation();f.journal.complete.mockImplementation(async()=>{f.emails.push({activityid:id(10),statecode:0,statuscode:1,senton:null});return original();});await expect(confirmed(f)).rejects.toThrow('unexpected passive effects');expect(f.resources.some(r=>r.plannedIdentity.kind==='j27_complete')).toBe(false);});
test('completed readiness forbids repairing later memo/phase drift',async()=>{const f=fixture(4);await confirmed(f);const count=f.deps.runChangeset.mock.calls.length;f.row[MEMO]='';f.row.wmkf_phaseistatus=100000000;await expect(confirmed(f)).rejects.toThrow('no repair');expect(f.deps.runChangeset).toHaveBeenCalledTimes(count);});
test('CLI partial batch retains success, failed identity and unattempted remainder',()=>{
  const {execFileSync}=require('node:child_process');
  const code=`import {runScenarioBatch} from './scripts/rehearse-j27-factory-scenarios.mjs'; const items=[1,2,3].map(id=>({scenario:{id},manifest:{values:{runId:'run-'+id,requestId:'request-'+id}}})); let calls=0; const results=await runScenarioBatch(items,async (item,evidence)=>{calls++;evidence.finalizerPreview={digest:'digest-'+item.scenario.id,writes:[{field:'wmkf_readyforreview',value:true}]};if(item.scenario.id===2)throw Error('unsafe unexpected payment');return {scenario:1,status:'complete'};}); console.log(JSON.stringify({calls,results}));`;
  const result=JSON.parse(execFileSync(process.execPath,['--import','./scripts/lib/use-extensionless.mjs','--input-type=module','-e',code],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim());
  expect(result.calls).toBe(2);expect(result.results).toEqual([{scenario:1,status:'complete',finalizerPreview:{digest:'digest-1',writes:[{field:'wmkf_readyforreview',value:true}]}},{scenario:2,runId:'run-2',requestId:'request-2',status:'NEEDS_INSPECTION',diagnostic:'unsafe unexpected payment',writesMayHaveOccurred:true,finalizerPreview:{digest:'digest-2',writes:[{field:'wmkf_readyforreview',value:true}]}},{scenario:3,runId:'run-3',requestId:'request-3',status:'NOT_ATTEMPTED',written:false}]);
});

test('unset DAL enforcement uses the nonproduction resolver',()=>{delete process.env.DATAVERSE_DAL_ENFORCEMENT; expect(process.env.NODE_ENV).not.toBe('production'); expect(assertSandboxOrigin(ORIGIN)).toBe(ORIGIN);});


test.each(SCENARIOS)('scenario $id proposal write is previewed only for 7', async scenario => {
  const f = fixture(scenario.id);
  const p = await trusted(() => previewScenario(f));
  const writes = p.plan.writes.filter(w => w.field === PROPOSAL_RECEIVED);
  expect(writes).toHaveLength(scenario.id === 7 ? 1 : 0);
  if (scenario.id === 7) {
    expect(writes[0]).toMatchObject({ before:null, after:'finalize_time', format:'date-only', action:'journaled_patch' });
    expect(p.digest).not.toBe(digest({ ...p.plan, writes:p.plan.writes.filter(w => w.field !== PROPOSAL_RECEIVED) }));
  }
  expect(f.client.get.mock.calls.some(([path]) => path.includes('$select=') && path.includes(PROPOSAL_RECEIVED))).toBe(true);
});
test('completed proposal receipt is skipped on resume on a later date', async () => {
  const f = fixture(7);
  await confirmed(f);
  const entry = f.resources.find(r => r.plannedIdentity.kind === 'j27_proposal_received');
  expect(entry.outcome).toBe('verified');
  const value = entry.plannedIdentity.expectedValue;
  expect(f.row[PROPOSAL_RECEIVED]).toBe(value);
  const sends = f.deps.runChangeset.mock.calls.length;
  jest.useFakeTimers({now:new Date('2030-01-01T00:00:00Z')});
  try { await confirmed(f); } finally { jest.useRealTimers(); }
  expect(f.deps.runChangeset).toHaveBeenCalledTimes(sends);
  expect(f.row[PROPOSAL_RECEIVED]).toBe(value);
});
test.each([true,false])('ambiguous proposal landed=%s never redispatches', async landed => {
  const f = fixture(7);
  const original = f.deps.runChangeset.getMockImplementation();
  f.deps.runChangeset.mockImplementation(async ops => {
    if (Object.hasOwn(ops[0].body, PROPOSAL_RECEIVED)) {
      if (landed) await original(ops);
      throw Error('reply lost');
    }
    return original(ops);
  });
  await expect(confirmed(f)).rejects.toThrow('needs inspection; never resend');
  f.deps.runChangeset.mockImplementation(original);
  if (landed) await confirmed(f);
  else await expect(confirmed(f)).rejects.toThrow('needs inspection; never resend');
  expect(f.deps.runChangeset.mock.calls.filter(([ops]) => Object.hasOwn(ops[0].body, PROPOSAL_RECEIVED))).toHaveLength(1);
});
test.each(['UserLocal','TimeZoneIndependent'])('metadata %s chooses ISO datetime', async behavior => {
  const f = fixture(7);
  const original = f.client.get.getMockImplementation();
  f.client.get.mockImplementation(async path => path.includes('DateTimeAttributeMetadata')
    ? {ok:true,body:{AttributeType:'DateTime',IsValidForUpdate:true,DateTimeBehavior:{Value:behavior},Format:'DateAndTime'}} : original(path));
  const preview = await trusted(() => previewScenario(f));
  expect(preview.plan.writes.find(w => w.field === PROPOSAL_RECEIVED).format).toBe('datetime');
  await confirmed(f);
  expect(f.row[PROPOSAL_RECEIVED]).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
});
test.each([{}, {AttributeType:'String',IsValidForUpdate:true,DateTimeBehavior:{Value:'DateOnly'}}, {AttributeType:'DateTime',IsValidForUpdate:false,DateTimeBehavior:{Value:'DateOnly'}}])('invalid proposal metadata blocks %j', async body => {
  const f = fixture(7); const original = f.client.get.getMockImplementation();
  f.client.get.mockImplementation(async path => path.includes('DateTimeAttributeMetadata') ? {ok:true,body} : original(path));
  await expect(confirmed(f)).rejects.toThrow('metadata needs inspection');
  expect(f.deps.runChangeset).not.toHaveBeenCalled();
});
test.each([1,2,3,4,5,6,8])('scenario %i refuses non-null proposal received', async n => {
  const f = fixture(n); f.row[PROPOSAL_RECEIVED] = '2026-11-09';
  await expect(confirmed(f)).rejects.toThrow('unexpected proposal received');
  expect(f.deps.runChangeset).not.toHaveBeenCalled();
});
test('late proposal removal blocks final verification and readiness resume', async () => {
  const f = fixture(7); const original = f.journal.complete.getMockImplementation();
  f.journal.complete.mockImplementation(async () => { f.row[PROPOSAL_RECEIVED] = null; return original(); });
  await expect(confirmed(f)).rejects.toThrow('final scenario state drift');
  await expect(confirmed(f)).rejects.toThrow('no repair');
});

test('bundle freshness is waived only when every selected run is already ready', async () => {
  const { isFinalizeOnlyRerun } = await import('../../scripts/rehearse-j27-factory-scenarios.mjs');
  expect(isFinalizeOnlyRerun([{ status:'ready' }])).toBe(true);
  expect(isFinalizeOnlyRerun([{ status:'ready' }, { status:'ready' }])).toBe(true);
  expect(isFinalizeOnlyRerun([{ status:'ready' }, null])).toBe(false);
  expect(isFinalizeOnlyRerun([{ status:'creating' }])).toBe(false);
  expect(isFinalizeOnlyRerun([{ status:'needs_attention' }])).toBe(false);
  expect(isFinalizeOnlyRerun([])).toBe(false);
});
