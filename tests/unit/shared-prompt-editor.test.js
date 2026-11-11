/** @jest-environment jsdom */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import SharedPromptEditor from '../../shared/components/admin/SharedPromptEditor';
import PromptTemplatesSection from '../../shared/components/admin/PromptTemplatesSection';

const profile={key:'proposal',revision:1,wrapperVersion:1,sharedInstructions:'Analyze carefully.',documentRoles:['proposal'],recordNames:['pi_name'],limits:{maxDocuments:1,maxDocumentBytes:262144,maxTotalDocumentBytes:262144,maxRecordBytes:16000}};
const publication={profile,sha256:'a'.repeat(64),publishedAt:'2026-01-01',requestId:'ignored'};
const catalog={profiles:[publication],tasks:[{name:'synthetic.executive-summary',outputName:'summary',maxWords:200},{name:'synthetic.methodology',outputName:'methodology',maxChars:12000}],maxOutputTokens:1536,profileLimits:{maxDocuments:16,maxDocumentBytes:262144,maxTotalDocumentBytes:262144,maxRecordBytes:64000}};
const models={modelStatuses:{'claude-sonnet-4-6':{ok:true,capability:{provider:'anthropic',maxOutputTokens:64000}},'other-model':{ok:true,capability:{provider:'openai',maxOutputTokens:5000}}}};
const response=(data,status=200)=>({ok:status>=200&&status<300,status,json:async()=>data});
const preview={system:'Trusted system',documentBlock:'Sample document',taskSuffix:'Task suffix',prefixHash:'hash'};
let taskResponse;
beforeEach(()=>{
  taskResponse=()=>response({},404);
  global.fetch=jest.fn(async (url,opts={})=>{
    if(url==='/api/admin/prompt-profiles' && opts.method==='PUT') return response({status:'completed',publication:{...publication,profile:{...profile,revision:2}}});
    if(url==='/api/admin/prompt-profiles' && opts.method==='POST') return response({sampleOnly:true,preview});
    if(url==='/api/admin/prompt-profiles') return response(catalog);
    if(url==='/api/admin/models') return response(models);
    if(url==='/api/admin/prompts' && opts.method==='POST') return response({status:'completed',version:1});
    if(url.startsWith('/api/admin/prompts/')) return taskResponse(url,opts);
    throw new Error(`Unexpected ${url}`);
  });
});
async function open(){render(<SharedPromptEditor />);fireEvent.click(screen.getByRole('button',{name:'Open editor'}));await screen.findByLabelText('Published revisions');await waitFor(()=>expect(screen.getByText('New task; publishing creates version 1.')).toBeInTheDocument());}
async function ready(){await open();fireEvent.change(screen.getByLabelText('Published profile'),{target:{value:'proposal@1'}});fireEvent.change(screen.getByLabelText('Task instructions'),{target:{value:'Summarize for {{pi_name}}.'}});fireEvent.change(screen.getByLabelText('Reviewed Anthropic model'),{target:{value:'claude-sonnet-4-6'}});}
const callBody=(url,method)=>JSON.parse(global.fetch.mock.calls.find(([u,o])=>u===url&&o.method===method)[1].body);
test('sample preview is required and task creation pins published profile and fixed output',async()=>{
  await ready();expect(screen.getByRole('button',{name:'Publish task'})).toBeDisabled();expect(screen.queryByRole('option',{name:'other-model'})).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Preview sample'}));await screen.findByRole('region',{name:'Sample preview'});expect(screen.getByText('Sample document')).toBeInTheDocument();
  const task=callBody('/api/admin/prompt-profiles','POST').task;const variables=JSON.parse(task.variables);expect(variables.execution.profile).toEqual({key:'proposal',revision:1,sha256:'a'.repeat(64)});expect(variables.variables).toEqual([{name:'proposal_context',source:{kind:'prepared_context'},required:true},{name:'pi_name',source:{kind:'frozen_record'},required:false}]);expect(JSON.parse(task.outputSchema).outputs[0]).toEqual({name:'summary',target:{kind:'none'},maxWords:200});expect(task.systemPrompt).toBe('');
  fireEvent.click(screen.getByRole('button',{name:'Publish task'}));await screen.findByText('Published Synthetic executive summary, version 1.');expect(callBody('/api/admin/prompts','POST')).toMatchObject({...task,catalog:{title:'Synthetic executive summary',usage:'diagnostic'}});
});
test('edits invalidate preview, unknown placeholders and excessive token budgets block it',async()=>{
  await ready();fireEvent.click(screen.getByRole('button',{name:'Preview sample'}));await screen.findByText('Sample document');
  fireEvent.change(screen.getByLabelText('Task instructions'),{target:{value:'Use {{unknown}}'}});expect(screen.queryByText('Sample document')).not.toBeInTheDocument();expect(screen.getByRole('button',{name:'Publish task'})).toBeDisabled();expect(screen.getByRole('button',{name:'Preview sample'})).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Task instructions'),{target:{value:'Use {{pi_name}}'}});fireEvent.change(screen.getByLabelText('Maximum output tokens'),{target:{value:'1537'}});expect(screen.getByRole('button',{name:'Preview sample'})).toBeDisabled();
});
test('profile publication creates immutable next revision with expected version',async()=>{
  await open();fireEvent.change(screen.getByLabelText('Published revisions'),{target:{value:'proposal@1'}});fireEvent.change(screen.getByLabelText('Shared instructions'),{target:{value:'Revised rules'}});fireEvent.click(screen.getByRole('button',{name:'Publish profile revision'}));await screen.findByText('Published proposal, revision 2.');expect(callBody('/api/admin/prompt-profiles','PUT')).toMatchObject({profile:{key:'proposal',revision:2,wrapperVersion:1,sharedInstructions:'Revised rules'},expectedVersion:1});
});
test('publication failure preserves preview and retries the exact request id',async()=>{
  await ready();fireEvent.click(screen.getByRole('button',{name:'Preview sample'}));await screen.findByText('Sample document');let n=0;const old=global.fetch;global.fetch=jest.fn(async (url,opts)=>{if(url==='/api/admin/prompts'&&opts?.method==='POST' && n++===0) return response({error:'failed'},500);return old(url,opts);});
  fireEvent.click(screen.getByRole('button',{name:'Publish task'}));await screen.findByRole('alert');expect(screen.getByText('Sample document')).toBeInTheDocument();const first=callBody('/api/admin/prompts','POST');fireEvent.click(screen.getByRole('button',{name:'Publish task'}));await screen.findByText('Published Synthetic executive summary, version 1.');const calls=global.fetch.mock.calls.filter(([url,opts])=>url==='/api/admin/prompts'&&opts?.method==='POST');expect(JSON.parse(calls[1][1].body).requestId).toBe(first.requestId);
});
test('stale task load cannot replace a newer selection',async()=>{
  let resolveFirst;taskResponse=url=>url.endsWith('synthetic.executive-summary') ? new Promise(resolve=>{resolveFirst=resolve;}) : response({},404);
  render(<SharedPromptEditor />);fireEvent.click(screen.getByRole('button',{name:'Open editor'}));await screen.findByLabelText('Task');await waitFor(()=>expect(resolveFirst).toBeDefined());
  // Selection is disabled while loading, so the old response cannot race a newer selection.
  expect(screen.getByLabelText('Task')).toBeDisabled();
  await act(async()=>resolveFirst(response({},404)));await waitFor(()=>expect(screen.getByLabelText('Task')).toBeEnabled());
  fireEvent.change(screen.getByLabelText('Task'),{target:{value:'synthetic.methodology'}});await screen.findByText('New task; publishing creates version 1.');expect(screen.getByLabelText('Task')).toHaveValue('synthetic.methodology');
});
test('existing task publishes against the loaded version, and conflict preserves the draft',async()=>{
  taskResponse=(url,opts)=> opts.method==='PUT' ? response({status:'concurrency_conflict'},409) : response({name:'synthetic.executive-summary',current:{version:7,body:'Original {{pi_name}}',systemPrompt:'',variables:JSON.stringify({execution:{profile:{key:'proposal',revision:1,sha256:'a'.repeat(64)}}}),model:'claude-sonnet-4-6',maxTokens:1024},invariantError:null});
  render(<SharedPromptEditor />);fireEvent.click(screen.getByRole('button',{name:'Open editor'}));await screen.findByText('Editing version 7; publishing creates a new version.');fireEvent.change(screen.getByLabelText('Task instructions'),{target:{value:'Edited {{pi_name}}'}});fireEvent.click(screen.getByRole('button',{name:'Preview sample'}));await screen.findByText('Sample document');fireEvent.click(screen.getByRole('button',{name:'Publish task'}));expect(await screen.findByRole('alert')).toHaveTextContent('Another admin published');
  expect(screen.getByLabelText('Task instructions')).toHaveValue('Edited {{pi_name}}');expect(screen.getByText('Sample document')).toBeInTheDocument();expect(callBody('/api/admin/prompts/synthetic.executive-summary','PUT')).toMatchObject({body:'Edited {{pi_name}}',expectedVersion:7});
});
test('a draft or duplicate current task is blocked rather than treated as new',async()=>{
  taskResponse=()=>response({current:null,invariantError:null,history:[{version:1}]});render(<SharedPromptEditor />);fireEvent.click(screen.getByRole('button',{name:'Open editor'}));expect(await screen.findByRole('alert')).toHaveTextContent('no single current version');expect(screen.getByRole('button',{name:'Preview sample'})).toBeDisabled();expect(screen.getByRole('button',{name:'Publish task'})).toBeDisabled();
});
test('switching tasks retains each unpublished draft and requires a fresh preview',async()=>{
  await ready();fireEvent.click(screen.getByRole('button',{name:'Preview sample'}));await screen.findByText('Sample document');fireEvent.change(screen.getByLabelText('Task'),{target:{value:'synthetic.methodology'}});await waitFor(()=>expect(screen.getByLabelText('Task instructions')).toHaveValue(''));fireEvent.change(screen.getByLabelText('Task instructions'),{target:{value:'Methods draft'}});fireEvent.change(screen.getByLabelText('Task'),{target:{value:'synthetic.executive-summary'}});await waitFor(()=>expect(screen.getByLabelText('Task instructions')).toHaveValue('Summarize for {{pi_name}}.'));expect(screen.getByRole('button',{name:'Publish task'})).toBeDisabled();expect(screen.queryByText('Sample document')).not.toBeInTheDocument();
});
test('uncertain create followed by navigation cannot silently rebase onto a newly published version',async()=>{
  await ready();fireEvent.click(screen.getByRole('button',{name:'Preview sample'}));await screen.findByText('Sample document');const originalFetch=global.fetch;let lost=true;global.fetch=jest.fn(async (url,opts)=>{if(url==='/api/admin/prompts'&&opts?.method==='POST'&&lost){lost=false;throw new Error('lost reply');}return originalFetch(url,opts);});fireEvent.click(screen.getByRole('button',{name:'Publish task'}));await screen.findByRole('alert');
  taskResponse=url=>url.endsWith('synthetic.methodology')?response({},404):response({current:{version:1,body:'Published content',systemPrompt:'',variables:JSON.stringify({execution:{profile:{key:'proposal',revision:1,sha256:'a'.repeat(64)}}}),model:'claude-sonnet-4-6',maxTokens:1024}});
  fireEvent.change(screen.getByLabelText('Task'),{target:{value:'synthetic.methodology'}});await waitFor(()=>expect(screen.getByLabelText('Task instructions')).toHaveValue(''));fireEvent.change(screen.getByLabelText('Task'),{target:{value:'synthetic.executive-summary'}});expect(await screen.findByRole('alert')).toHaveTextContent('task changed');expect(screen.getByLabelText('Task instructions')).toHaveValue('Summarize for {{pi_name}}.');expect(screen.getByRole('button',{name:'Publish task'})).toBeDisabled();expect(screen.getByText('Current version 1 instructions')).toBeInTheDocument();
});

test('the shared editor is reachable on an empty legacy inventory',async()=>{
  global.fetch=jest.fn(async url=>{if(url==='/api/admin/prompts')return response({prompts:[]});if(url==='/api/admin/models')return response(models);if(url==='/api/admin/executor-budgets')return response({});throw new Error('unexpected');});
  render(<PromptTemplatesSection />);expect(await screen.findByText('No prompts found.')).toBeInTheDocument();expect(screen.getByRole('button',{name:'Open editor'})).toBeInTheDocument();expect(global.fetch.mock.calls.some(([url])=>url==='/api/admin/prompt-profiles')).toBe(false);
});
test('lost profile publication reply followed by refresh retries original revision and request ID',async()=>{
  let saved=null, attempts=[];const old=global.fetch;global.fetch=jest.fn(async (url,opts={})=>{
    if(url==='/api/admin/prompt-profiles'&&opts.method==='PUT'){const body=JSON.parse(opts.body);attempts.push(body);if(!saved){saved={...publication,profile:body.profile,requestId:body.requestId};throw new Error('lost reply');}return response({status:'already_published',publication:saved});}
    if(url==='/api/admin/prompt-profiles'&&(!opts.method||opts.method==='GET'))return response({...catalog,profiles:saved?[...catalog.profiles,saved]:catalog.profiles});return old(url,opts);
  });
  await open();fireEvent.change(screen.getByLabelText('Published revisions'),{target:{value:'proposal@1'}});fireEvent.change(screen.getByLabelText('Shared instructions'),{target:{value:'Updated'}});fireEvent.click(screen.getByRole('button',{name:'Publish profile revision'}));await screen.findByRole('alert');expect(attempts[0].profile.revision).toBe(2);expect(attempts[0].expectedVersion).toBe(1);
  fireEvent.click(screen.getByRole('button',{name:'Refresh profiles'}));await waitFor(()=>expect(screen.getByText(/Latest loaded revision for this key: 2/)).toBeInTheDocument());expect(screen.getByText('Next revision: 2')).toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'Retry profile publication'}));expect(await screen.findByText('Published proposal, revision 2.')).toBeInTheDocument();expect(attempts).toHaveLength(2);expect(attempts[1]).toEqual(attempts[0]);
});
test('changed profile draft cannot reuse an unresolved publication until explicitly reviewed',async()=>{
  const old=global.fetch;global.fetch=jest.fn(async (url,opts={})=>url==='/api/admin/prompt-profiles'&&opts.method==='PUT'?response({error:'unavailable'},503):old(url,opts));await open();fireEvent.change(screen.getByLabelText('Published revisions'),{target:{value:'proposal@1'}});fireEvent.change(screen.getByLabelText('Shared instructions'),{target:{value:'Initial draft'}});fireEvent.click(screen.getByRole('button',{name:'Publish profile revision'}));await screen.findByRole('alert');fireEvent.change(screen.getByLabelText('Shared instructions'),{target:{value:'Different draft'}});expect(screen.getByRole('button',{name:'Retry profile publication'})).toBeDisabled();expect(screen.getByRole('button',{name:'Start a different revision after review'})).toBeDisabled();fireEvent.click(screen.getByRole('button',{name:'Refresh profiles'}));await waitFor(()=>expect(screen.getByRole('button',{name:'Start a different revision after review'})).toBeEnabled());
});
test.each(['partial','failed','concurrency_conflict'])('%s with a written task enters reconciliation instead of replaying a final audit',async status=>{
  let stage='initial';const writtenId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';const firstFetch=global.fetch;
  global.fetch=jest.fn(async (url,opts={})=>{
    if(url==='/api/admin/prompts'&&opts.method==='POST'){stage='duplicate';return response({status,newPromptId:writtenId,targetVersion:1},status==='partial'?200:409);}
    if(url==='/api/admin/prompts/synthetic.executive-summary'&&stage==='duplicate')return response({invariantError:'duplicate_current_rows',current:{version:1},history:[{id:writtenId},{id:'older'}]});
    if(url==='/api/admin/prompts/synthetic.executive-summary'&&stage==='resolved')return response({invariantError:null,current:{id:writtenId,version:1,body:'Published instructions',systemPrompt:'',variables:JSON.stringify({execution:{profile:{key:'proposal',revision:1,sha256:'a'.repeat(64)}}}),model:'claude-sonnet-4-6',maxTokens:1024}});
    return firstFetch(url,opts);
  });
  await ready();fireEvent.click(screen.getByRole('button',{name:'Preview sample'}));await screen.findByText('Sample document');fireEvent.click(screen.getByRole('button',{name:'Publish task'}));
  expect(await screen.findByText('The new version may exist and needs reconciliation. Reload the task.')).toBeInTheDocument();expect(await screen.findByRole('alert')).toHaveTextContent('no single current version');expect(screen.getByLabelText('Task instructions')).toHaveValue('Summarize for {{pi_name}}.');expect(screen.getByRole('button',{name:'Publish task'})).toBeDisabled();expect(screen.queryByText(/Retry the same previewed draft/)).not.toBeInTheDocument();
  expect(global.fetch.mock.calls.filter(([url,opts])=>url==='/api/admin/prompts'&&opts.method==='POST')).toHaveLength(1);
  stage='resolved';fireEvent.click(screen.getByRole('button',{name:'Reload task'}));await screen.findByText('Current version 1 instructions');expect(screen.getByRole('button',{name:'Publish task'})).toBeDisabled();fireEvent.click(screen.getByRole('button',{name:'Use latest version with my draft'}));await waitFor(()=>expect(screen.getByText('Editing version 1; publishing creates a new version.')).toBeInTheDocument());expect(screen.getByLabelText('Task instructions')).toHaveValue('Summarize for {{pi_name}}.');expect(screen.getByRole('button',{name:'Publish task'})).toBeDisabled();
});
test('a replayed failed audit with the same request ID reloads and blocks republication',async()=>{
  let writes=0;const old=global.fetch;global.fetch=jest.fn(async(url,opts={})=>{
    if(url==='/api/admin/prompts'&&opts.method==='POST'){writes++;if(writes===1)throw new Error('response lost');return response({status:'failed',newPromptId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',targetVersion:1},409);}
    if(url==='/api/admin/prompts/synthetic.executive-summary'&&writes>1)return response({invariantError:'duplicate_current_rows',current:{version:1},history:[]});
    return old(url,opts);
  });
  await ready();fireEvent.click(screen.getByRole('button',{name:'Preview sample'}));await screen.findByText('Sample document');fireEvent.click(screen.getByRole('button',{name:'Publish task'}));await screen.findByText('Could not publish the task. Retry the same previewed draft.');fireEvent.click(screen.getByRole('button',{name:'Publish task'}));await screen.findByText('The new version may exist and needs reconciliation. Reload the task.');await screen.findByText('This task has no single current version. Resolve its history before editing.');
  const calls=global.fetch.mock.calls.filter(([url,opts])=>url==='/api/admin/prompts'&&opts.method==='POST');expect(calls).toHaveLength(2);expect(JSON.parse(calls[0][1].body).requestId).toBe(JSON.parse(calls[1][1].body).requestId);expect(screen.getByRole('button',{name:'Publish task'})).toBeDisabled();expect(screen.queryByRole('button',{name:'Retry task load'})).not.toBeInTheDocument();expect(screen.getByLabelText('Task instructions')).toHaveValue('Summarize for {{pi_name}}.');
});

test('proposal task publication requires the stored PI declaration and uses its draft label',async()=>{
  catalog.tasks.push({name:'proposal.executive-summary',kind:'proposal',outputName:'summary',maxWords:200});
  try {
    await open();fireEvent.change(screen.getByLabelText('Task'),{target:{value:'proposal.executive-summary'}});
    await waitFor(()=>expect(screen.getByText('New task; publishing creates version 1.')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Published profile'),{target:{value:'proposal@1'}});
    fireEvent.change(screen.getByLabelText('Task instructions'),{target:{value:'Summarize the proposal.'}});
    fireEvent.change(screen.getByLabelText('Reviewed Anthropic model'),{target:{value:'claude-sonnet-4-6'}});
    expect(screen.getByRole('button',{name:'Preview sample'})).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Task instructions'),{target:{value:'Summarize for {{pi_name}}.'}});
    fireEvent.click(screen.getByRole('button',{name:'Preview sample'}));await screen.findByText('Sample document');
    const task=callBody('/api/admin/prompt-profiles','POST').task;
    expect(JSON.parse(task.variables).variables).toContainEqual({name:'pi_name',source:{kind:'frozen_record'},required:true});
    fireEvent.click(screen.getByRole('button',{name:'Publish task'}));await screen.findByText('Published Proposal executive summary, version 1.');
    expect(callBody('/api/admin/prompts','POST').catalog.title).toBe('Proposal executive summary');
  } finally {catalog.tasks.pop();}
});
