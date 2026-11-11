import { advanceJob } from '../../lib/services/prompt-jobs/worker';

const jobId='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', requestId='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', promptId='cccccccc-cccc-cccc-cccc-cccccccccccc', attemptId='dddddddd-dddd-dddd-dddd-dddddddddddd', runId='eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
const notes=(outcome,code='none',stop='end_turn') => `profiled=true; outcome=${outcome}; code=${code}; stopReason=${stop}`;
const auditPayload=(status='completed', code='none', stop='end_turn') => ({wmkf_ai_status:status==='completed'?682090000:682090001,wmkf_ai_runsource:682090002,wmkf_ai_model:'claude-sonnet-4-6','wmkf_ai_Prompt@odata.bind':`/wmkf_ai_prompts(${promptId})`,wmkf_ai_promptversion:1,'wmkf_ai_Request@odata.bind':`/akoya_requests(${requestId})`,wmkf_ai_promptoverridden:false,wmkf_ai_notes:notes(status,code,stop)});
function fixture({operation='initialize', two=false}={}) {
  const job={id:jobId,environment:'test',request_id:requestId,operation,authorization_scope:'tenant:synthetic',lease_expires_at:new Date(Date.now()+60000).toISOString(),snapshot_content_id:'snapshot',target_etag:operation==='initialize'?'etag-original':null};
  const tasks=[{id:'t1',task_key:'synthetic.executive-summary',state:'queued',model:'claude-sonnet-4-6',destination_field:'field1',configuration_content_id:'config1'}];
  if (two) tasks.push({...tasks[0],id:'t2',task_key:'synthetic.methodology',destination_field:'field2',configuration_content_id:'config2'});
  const contents={snapshot:{integrity:'synthetic',scope:{authorizationScope:'tenant:synthetic'}}};
  for (const t of tasks) contents[t.configuration_content_id]={promptRow:{wmkf_ai_promptname:t.task_key,wmkf_ai_promptid:promptId,wmkf_promptversion:1,wmkf_ai_model:t.model},profile:{key:'synthetic'},scope:{environment:'test',requestId,authorizationScope:'tenant:synthetic'},runSource:'Vercel Test'};
  const state={job,tasks,attempts:[],publication:null,contents,events:[]};
  const store={
    claim:jest.fn(async()=>({...state,leaseToken:'lease',lease_expires_at:state.job.lease_expires_at})), releaseClaim:jest.fn(async()=>{}),
    readContent:jest.fn(async({contentId})=>contents[contentId] || null),
    markDispatching:jest.fn(async({taskId})=>{state.events.push('intent');const t=tasks.find(x=>x.id===taskId);t.state='dispatching';const a={id:`${attemptId.slice(0,-1)}${tasks.indexOf(t)+1}`,task_id:taskId,state:'dispatching',audit_run_id:runId,audit_state:'none'};state.attempts.push(a);return a;}),
    saveResponse:jest.fn(async({taskId,attemptId:aid,response})=>{state.events.push('checkpoint');const a=state.attempts.find(x=>x.id===aid);a.state='response_saved';a.response_content_id=`response-${taskId}`;contents[a.response_content_id]=response;tasks.find(x=>x.id===taskId).state='response_saved';return a;}),
    markAttemptFailed:jest.fn(async({taskId,attemptId:aid,outcome,deferredAudit})=>{const t=tasks.find(x=>x.id===taskId),a=state.attempts.find(x=>x.id===aid);if(a && a.state!=='dispatching' && outcome==='unknown')return null;t.state=outcome;if(a){a.state=outcome;if(deferredAudit){a.audit_state='pending';a.audit_content_id=`audit-${taskId}`;contents[a.audit_content_id]=deferredAudit;}}return t;}),
    saveValidated:jest.fn(async({taskId,attemptId:aid,result,deferredAudit})=>{state.events.push('validated');const t=tasks.find(x=>x.id===taskId),a=state.attempts.find(x=>x.id===aid);t.state='validated';t.result=result;a.state='validated';a.audit_state='pending';a.audit_content_id=`audit-${taskId}`;contents[a.audit_content_id]=deferredAudit;return t;}),
    markAuditDispatching:jest.fn(async({attemptId:aid})=>{const a=state.attempts.find(x=>x.id===aid);if(a.audit_state!=='pending')return null;a.audit_state='dispatching';return true;}),
    markAudit:jest.fn(async({attemptId:aid,outcome})=>{const a=state.attempts.find(x=>x.id===aid);if(a.audit_state!=='dispatching')return null;a.audit_state=outcome;return true;}),
    freezePublication:jest.fn(async()=>{const fields={};for(const t of tasks.filter(x=>x.state==='validated')) fields[t.destination_field]=t.result;contents.patch=fields;state.publication={id:'pub',state:'ready',expected_etag:job.target_etag,payload_content_id:'patch'};return state.publication;}),
    markPublicationDispatched:jest.fn(async()=>{state.publication.state='dispatching';return true;}),finishPublication:jest.fn(async({outcome})=>{state.publication.state=outcome;return true;}),
  };
  const executePrompt=jest.fn(async opts=>{await opts.onDispatch();state.events.push('provider');await opts.onResponse({version:1,binding:'hash',response:{text:'actual response'}});return {parsed:{[opts.promptName==='synthetic.methodology'?'methodology':'summary']:'validated result'},deferredAudit:auditPayload()};});
  const args={jobId,store,executePrompt,authorize:jest.fn(async()=>true),checkFreshness:jest.fn(async()=>true),audit:jest.fn(async()=>{}),writer:jest.fn(async()=> 'applied'),nonceSecret:'synthetic'};
  return {state,store,args,executePrompt,tick:()=>advanceJob(args)};
}
test('intent precedes provider and response checkpoint precedes validation and audit; siblings coalesce once', async()=>{
  const f=fixture({two:true});
  expect(await f.tick()).toEqual({stage:'validated'});expect(f.state.events).toEqual(['intent','provider','checkpoint','validated']);
  expect(await f.tick()).toEqual({stage:'validated'});expect(f.args.audit).not.toHaveBeenCalled();
  expect(await f.tick()).toEqual({stage:'audit_delivered'});expect(await f.tick()).toEqual({stage:'audit_delivered'});
  expect(await f.tick()).toEqual({stage:'published'});expect(f.args.writer).toHaveBeenCalledTimes(1);
  expect(f.args.writer.mock.calls[0][0]).toMatchObject({expectedEtag:'etag-original',fields:{field1:'validated result',field2:'validated result'}});
  expect(await f.tick()).toEqual({stage:'complete'});expect(f.args.writer).toHaveBeenCalledTimes(1);
});
test('post-dispatch ambiguity blocks queued siblings and publication', async()=>{
  const f=fixture({two:true});f.executePrompt.mockImplementationOnce(async o=>{await o.onDispatch();throw new Error('timeout');});
  expect(await f.tick()).toEqual({stage:'unknown'});expect(await f.tick()).toEqual({stage:'needs_attention'});
  expect(f.executePrompt).toHaveBeenCalledTimes(1);expect(f.args.writer).not.toHaveBeenCalled();
});
test('checkpoint is reused without provider call after validation stage crash', async()=>{
  const f=fixture();f.executePrompt.mockImplementationOnce(async o=>{await o.onDispatch();await o.onResponse({version:1,binding:'hash',response:{text:'saved'}});throw new Error('crashed after checkpoint');});
  expect(await f.tick()).toEqual({stage:'response_saved'});
  f.executePrompt.mockImplementationOnce(async o=>{expect(o.responseCheckpoint.response.text).toBe('saved');expect(o.onDispatch).toBeUndefined();return {parsed:{summary:'recovered'},deferredAudit:auditPayload()};});
  expect(await f.tick()).toEqual({stage:'validated'});expect(f.store.markDispatching).toHaveBeenCalledTimes(1);
});
test('audit failure never regenerates and publication 412 preserves result and baseline', async()=>{
  const f=fixture();f.args.audit.mockRejectedValueOnce(new Error('lost audit response'));f.args.writer.mockRejectedValueOnce(Object.assign(new Error('conflict'),{status:412}));
  expect(await f.tick()).toEqual({stage:'validated'});expect(await f.tick()).toEqual({stage:'audit_failed'});expect(await f.tick()).toEqual({stage:'needs_attention'});
  expect(f.executePrompt).toHaveBeenCalledTimes(1);expect(f.state.tasks[0].result).toBe('validated result');expect(f.args.writer).not.toHaveBeenCalled();
  const g=fixture();await g.tick();await g.tick();g.args.writer.mockRejectedValueOnce(Object.assign(new Error('conflict'),{status:412}));expect(await g.tick()).toEqual({stage:'conflict'});expect(await g.tick()).toEqual({stage:'needs_attention'});expect(g.state.publication.expected_etag).toBe('etag-original');expect(g.args.writer).toHaveBeenCalledTimes(1);
});
test('unknown write is never repeated, and freshness or authorization denial stops dispatch', async()=>{
  const f=fixture();f.args.checkFreshness.mockResolvedValueOnce(false);await expect(f.tick()).rejects.toThrow();expect(f.executePrompt).not.toHaveBeenCalled();
  f.args.authorize.mockResolvedValueOnce(false);await expect(f.tick()).rejects.toThrow();expect(f.executePrompt).not.toHaveBeenCalled();
  await f.tick();await f.tick();f.args.writer.mockRejectedValueOnce(new Error('timeout'));expect(await f.tick()).toEqual({stage:'unknown'});expect(await f.tick()).toEqual({stage:'needs_attention'});expect(f.args.writer).toHaveBeenCalledTimes(1);
});
test('content-free audit whitelist rejects response text and validation failures preserve audit', async()=>{
  const f=fixture();f.executePrompt.mockImplementationOnce(async o=>{await o.onDispatch();await o.onResponse({version:1,response:{text:'actual'}});const e=Object.assign(new Error('bad output'),{code:'claude_output_invalid_json',deferredAudit:auditPayload('failed','claude_output_invalid_json')});throw e;});
  expect(await f.tick()).toEqual({stage:'failed_validation'});expect(await f.tick()).toEqual({stage:'audit_delivered'});expect(f.executePrompt).toHaveBeenCalledTimes(1);
  const g=fixture();g.executePrompt.mockImplementationOnce(async o=>{await o.onDispatch();await o.onResponse({version:1,response:{text:'actual'}});return {parsed:{summary:'result'},deferredAudit:{...auditPayload(),wmkf_ai_rawoutput:'secret'}};});
  await expect(g.tick()).rejects.toThrow('invalid audit payload');expect(g.state.tasks[0].state).toBe('response_saved');expect(g.store.saveValidated).not.toHaveBeenCalled();
});
test('publication rechecks source and authorization after generation', async()=>{
  const f=fixture();await f.tick();await f.tick();f.args.checkFreshness.mockResolvedValueOnce(false);await expect(f.tick()).rejects.toThrow();expect(f.store.freezePublication).not.toHaveBeenCalled();expect(f.args.writer).not.toHaveBeenCalled();
  f.args.authorize.mockImplementationOnce(async ({stage})=>stage==='read').mockResolvedValueOnce(false);await expect(f.tick()).rejects.toThrow();expect(f.args.writer).not.toHaveBeenCalled();
});
test('a committed checkpoint whose acknowledgement fails is never overwritten as unknown', async()=>{
  const f=fixture();const save=f.store.saveResponse.getMockImplementation();f.store.saveResponse.mockImplementationOnce(async opts=>{await save(opts);throw new Error('lost acknowledgement');});
  expect(await f.tick()).toEqual({stage:'needs_attention'});expect(f.state.tasks[0].state).toBe('response_saved');expect(f.executePrompt).toHaveBeenCalledTimes(1);
  f.executePrompt.mockImplementationOnce(async o=>({parsed:{summary:o.responseCheckpoint.response.text},deferredAudit:auditPayload()}));expect(await f.tick()).toEqual({stage:'validated'});expect(f.store.markDispatching).toHaveBeenCalledTimes(1);
});
test('stale publication fence and missing audit sink never cause an external write', async()=>{
  const f=fixture();await f.tick();f.args.audit=undefined;expect(await f.tick()).toEqual({stage:'audit_pending'});expect(f.args.writer).not.toHaveBeenCalled();
  f.args.audit=jest.fn(async()=>{});await f.tick();f.store.markPublicationDispatched.mockResolvedValueOnce(null);await expect(f.tick()).rejects.toThrow();expect(f.args.writer).not.toHaveBeenCalled();
});
test('captures initial target before dispatch and rejects malformed target state', async()=>{
  const f=fixture();f.state.job.target_etag=null;f.args.readTarget=jest.fn(async()=>({etag:'etag-original',fields:{field1:{blank:true,sha256:'a'.repeat(64)}}}));f.store.captureTarget=jest.fn(async({etag})=>{f.state.job.target_etag=etag;return f.state.job;});
  expect(await f.tick()).toEqual({stage:'target_captured'});expect(f.executePrompt).not.toHaveBeenCalled();expect(await f.tick()).toEqual({stage:'validated'});expect(f.args.readTarget).toHaveBeenCalledTimes(1);
  const g=fixture();g.state.job.target_etag=null;g.args.readTarget=jest.fn(async()=>({etag:'',fields:{}}));await expect(g.tick()).rejects.toThrow();expect(g.executePrompt).not.toHaveBeenCalled();
});
test('checks freshness immediately at dispatch and again before physical write', async()=>{
  const f=fixture();f.args.checkFreshness.mockResolvedValueOnce(true).mockResolvedValueOnce(false);expect(await f.tick()).toEqual({stage:'failed_pre_dispatch'});expect(f.store.markDispatching).not.toHaveBeenCalled();
  const g=fixture();await g.tick();await g.tick();g.args.checkFreshness.mockResolvedValueOnce(true).mockResolvedValueOnce(false);await expect(g.tick()).rejects.toThrow();expect(g.store.markPublicationDispatched).not.toHaveBeenCalled();expect(g.args.writer).not.toHaveBeenCalled();
});
test('scope, wildcard target and exhausted lease reject before dispatch', async()=>{
  const f=fixture();f.state.job.authorization_scope='foreign';await expect(f.tick()).rejects.toThrow();expect(f.executePrompt).not.toHaveBeenCalled();
  const g=fixture();g.state.job.target_etag='*';await expect(g.tick()).rejects.toThrow();expect(g.executePrompt).not.toHaveBeenCalled();
  const h=fixture();h.state.job.lease_expires_at=new Date(Date.now()+1000).toISOString();await expect(h.tick()).rejects.toThrow();expect(h.executePrompt).not.toHaveBeenCalled();
});

test('audit dispatch is fenced and lost sink acknowledgement is never resent', async()=>{
  const f=fixture();await f.tick();f.store.markAuditDispatching.mockResolvedValueOnce(null);await expect(f.tick()).rejects.toThrow('audit dispatch fenced');expect(f.args.audit).not.toHaveBeenCalled();
  f.store.markAudit.mockRejectedValueOnce(new Error('lost receipt'));await expect(f.tick()).rejects.toThrow('lost receipt');expect(f.args.audit).toHaveBeenCalledTimes(1);expect(f.state.attempts[0].audit_state).toBe('dispatching');
  // Claim recovery converts a previously dispatched audit into an uncertain outcome.
  f.state.attempts[0].audit_state='unknown';expect(await f.tick()).toEqual({stage:'needs_attention'});expect(f.args.audit).toHaveBeenCalledTimes(1);expect(f.args.writer).not.toHaveBeenCalled();
});
test('audit authorization denial prevents a dispatch intent and sink call', async()=>{
  const f=fixture();await f.tick();f.args.authorize.mockImplementation(async ({stage})=>stage!=='audit');await expect(f.tick()).rejects.toThrow('authorization or freshness denied');expect(f.store.markAuditDispatching).not.toHaveBeenCalled();expect(f.args.audit).not.toHaveBeenCalled();
});

test('saved response recovery still proceeds when another task is unknown', async()=>{
  const f=fixture({two:true});f.state.tasks[0].state='unknown';f.state.tasks[1].state='response_saved';
  f.state.attempts.push({id:attemptId,task_id:'t2',state:'response_saved',response_content_id:'saved',audit_run_id:runId,audit_state:'none'});f.state.contents.saved={version:1,response:{text:'saved'}};
  f.executePrompt.mockImplementationOnce(async o=>({parsed:{methodology:o.responseCheckpoint.response.text},deferredAudit:auditPayload()}));
  expect(await f.tick()).toEqual({stage:'validated'});expect(f.store.markDispatching).not.toHaveBeenCalled();
});
