/** @jest-environment jsdom */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ProposalDrafts from '../../shared/components/workbench/ProposalDrafts';
import ProposalTab from '../../shared/components/workbench/ProposalTab';

const requestId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', otherRequest='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const jobId='cccccccc-cccc-4ccc-8ccc-cccccccccccc', key='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const response=(data,status=200)=>({ok:status>=200&&status<300,status,json:async()=>data});
const task=(taskKey,state='queued',resultAvailable=false)=>({taskKey,state,resultAvailable,errorCode:null});
const makeJob=(extra={})=>({id:jobId,requestId,version:1,createdAt:'2026-11-11T00:00:00Z',status:'queued',tasks:[task('proposal.executive-summary'),task('proposal.methodology')],...extra});
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const storageKey=`wmkf:proposal-drafts:v1:12:${requestId}`;
function mount(props={}) { return render(<ProposalDrafts requestId={requestId} profileId={12} {...props}/>); }
beforeEach(()=>{window.sessionStorage.clear();Object.defineProperty(globalThis.crypto,'randomUUID',{configurable:true,value:jest.fn(()=>key)});global.fetch=jest.fn(async(url,opts={})=>{if(url.startsWith('/api/workbench/prompt-jobs?'))return response({enabled:true,jobs:[]});if(url==='/api/workbench/prompt-jobs'&&opts.method==='POST')return response({job:makeJob()},202);throw new Error(`Unexpected ${url}`);});});
afterEach(()=>{jest.useRealTimers();});
test('disabled and preview surfaces make no draft actions, preview makes no request',async()=>{
  const view=mount({previewReadOnly:true});expect(global.fetch).not.toHaveBeenCalled();view.unmount();global.fetch.mockResolvedValueOnce(response({enabled:false,jobs:[]}));mount();await waitFor(()=>expect(global.fetch).toHaveBeenCalledTimes(1));expect(screen.queryByText('AI drafts')).not.toBeInTheDocument();
});
test('sends only request and idempotency key; accepted response clears recovery key',async()=>{
  mount();await screen.findByText('AI drafts');fireEvent.click(screen.getByRole('button',{name:'Generate drafts'}));await screen.findByText('Draft generation is in progress.');const [,options]=global.fetch.mock.calls.find(([url])=>url==='/api/workbench/prompt-jobs');expect(options.headers['Idempotency-Key']).toBe(key);expect(JSON.parse(options.body)).toEqual({requestId});expect(sessionStorage.getItem(storageKey)).toBeNull();expect(screen.getByRole('button',{name:'Trial already started'})).toBeDisabled();
});
test('lost submission survives remount, old discovery cannot clear it, replay uses same key',async()=>{
  let submitCalls=0;global.fetch=jest.fn(async(url,opts={})=>{if(url.startsWith('/api/workbench/prompt-jobs?'))return response({enabled:true,jobs:submitCalls?[makeJob({id:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',status:'complete'})]:[]});if(url==='/api/workbench/prompt-jobs'&&opts.method==='POST'){submitCalls++;if(submitCalls===1)throw new Error('lost');return response({job:makeJob()},202);}throw new Error('unexpected');});
  const view=mount();await screen.findByText('AI drafts');fireEvent.click(screen.getByRole('button',{name:'Generate drafts'}));await screen.findByText(/may have been accepted/);expect(sessionStorage.getItem(storageKey)).toBe(key);view.unmount();mount();expect(await screen.findByRole('button',{name:'Retry draft request'})).toBeEnabled();expect(sessionStorage.getItem(storageKey)).toBe(key);fireEvent.click(screen.getByRole('button',{name:'Retry draft request'}));await waitFor(()=>expect(sessionStorage.getItem(storageKey)).toBeNull());const writes=global.fetch.mock.calls.filter(([url])=>url==='/api/workbench/prompt-jobs');expect(writes).toHaveLength(2);expect(writes.map(([,opts])=>opts.headers['Idempotency-Key'])).toEqual([key,key]);
});
test('late request and actor changes cannot display prior results',async()=>{
  const first=deferred();global.fetch=jest.fn(async url=>url.includes(requestId)?first.promise:response({enabled:true,jobs:[]}));const view=mount();view.rerender(<ProposalDrafts requestId={otherRequest} profileId={13}/>);await screen.findByText('No drafts have been generated for this Request yet.');await act(async()=>first.resolve(response({enabled:true,jobs:[makeJob()]})));expect(screen.queryByText('Draft generation is in progress.')).not.toBeInTheDocument();
});
test('results are separately loaded, and a 403 clears sensitive display',async()=>{
  const readyJob=makeJob({status:'complete',tasks:[task('proposal.executive-summary','validated',true),task('proposal.methodology','failed_validation',false)]});global.fetch=jest.fn(async(url)=>{if(url.includes('/results?'))return response({jobId,version:1,expiresAt:'2026-12-01',results:[{taskKey:'proposal.executive-summary',status:'available',text:'Private draft text'}]});if(url.startsWith('/api/workbench/prompt-jobs?'))return response({enabled:true,jobs:[readyJob]});throw new Error('unexpected');});
  const view=mount();expect(await screen.findByText('Private draft text')).toBeInTheDocument();expect(screen.getByText('Draft could not be validated')).toBeInTheDocument();view.unmount();global.fetch=jest.fn(async(url)=>url.includes('/results?')?response({},403):response({enabled:true,jobs:[readyJob]}));mount();await waitFor(()=>expect(global.fetch.mock.calls.some(([url])=>url.includes('/results?'))).toBe(true));await waitFor(()=>expect(screen.queryByText('AI drafts')).not.toBeInTheDocument());expect(screen.queryByText('Private draft text')).not.toBeInTheDocument();
});
test('polling is serial, stops on terminal, and preserves prior response version',async()=>{
  const poll=deferred();global.fetch=jest.fn(async(url)=>{if(url.startsWith('/api/workbench/prompt-jobs?'))return response({enabled:true,jobs:[makeJob({version:3})]});if(url.includes(`/${jobId}?`))return poll.promise;throw new Error('unexpected');});mount();await screen.findByText('Draft generation is in progress.');jest.useFakeTimers();
  // Remount the poll timer under fake timers.
  Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});fireEvent(document,new Event('visibilitychange'));Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});fireEvent(document,new Event('visibilitychange'));
  await act(async()=>{jest.advanceTimersByTime(5000);});expect(global.fetch.mock.calls.filter(([url])=>url.includes(`/${jobId}?`))).toHaveLength(1);await act(async()=>{jest.advanceTimersByTime(20000);});expect(global.fetch.mock.calls.filter(([url])=>url.includes(`/${jobId}?`))).toHaveLength(1);
  await act(async()=>poll.resolve(response({job:makeJob({version:2,status:'complete'})})));expect(screen.getByText('Draft generation is in progress.')).toBeInTheDocument();
});
test('unavailable session storage never permits an untracked submission',async()=>{
  const getter=jest.spyOn(Storage.prototype,'getItem').mockImplementation(()=>{throw new Error('disabled');});mount();await screen.findByText('AI drafts');expect(screen.getByRole('button',{name:'Generate drafts'})).toBeDisabled();expect(screen.getByRole('alert')).toHaveTextContent('cannot safely retain');getter.mockRestore();
});
test('unknown generation blocks a competing request while retaining available sibling result',async()=>{
  const value=makeJob({status:'needs_attention',tasks:[task('proposal.executive-summary','unknown'),task('proposal.methodology','validated',true)]});global.fetch=jest.fn(async url=>url.includes('/results?')?response({jobId,version:1,expiresAt:'2026-12-01',results:[{taskKey:'proposal.methodology',status:'available',text:'Retained methodology'}]}):response({enabled:true,jobs:[value]}));mount();await screen.findByText('Retained methodology');expect(screen.getByRole('button',{name:'Trial already started'})).toBeDisabled();expect(screen.getByText('Needs attention')).toBeInTheDocument();
});
test('result-read error offers retry without a new paid job',async()=>{
  let reads=0;const value=makeJob({status:'complete',tasks:[task('proposal.executive-summary','validated',true)]});global.fetch=jest.fn(async url=>{if(url.includes('/results?')){reads++;return reads===1?response({},503):response({jobId,version:1,expiresAt:'2026-12-01',results:[{taskKey:'proposal.executive-summary',status:'available',text:'Recovered draft'}]});}return response({enabled:true,jobs:[value]});});mount();fireEvent.click(await screen.findByRole('button',{name:'Reload saved drafts'}));expect(await screen.findByText('Recovered draft')).toBeInTheDocument();expect(reads).toBe(2);expect(global.fetch.mock.calls.some(([url,opts])=>url==='/api/workbench/prompt-jobs'&&opts.method==='POST')).toBe(false);
});
test('a late submission after actor switch neither updates the new view nor clears the old recovery key',async()=>{
  const delayed=deferred();global.fetch=jest.fn(async(url,opts={})=>url==='/api/workbench/prompt-jobs'&&opts.method==='POST'?delayed.promise:response({enabled:true,jobs:[]}));const view=mount();await screen.findByText('AI drafts');fireEvent.click(screen.getByRole('button',{name:'Generate drafts'}));await waitFor(()=>expect(sessionStorage.getItem(storageKey)).toBe(key));view.rerender(<ProposalDrafts requestId={requestId} profileId={13}/>);await screen.findByText('No drafts have been generated for this Request yet.');await act(async()=>delayed.resolve(response({job:makeJob()},202)));expect(sessionStorage.getItem(storageKey)).toBe(key);expect(screen.queryByText('Draft generation is in progress.')).not.toBeInTheDocument();
});
test('unknown future task state cannot enable another request',async()=>{
  global.fetch=jest.fn(async()=>response({enabled:true,jobs:[makeJob({status:'needs_attention',tasks:[task('proposal.executive-summary','new_unrecognized_state')]})]}));mount();await screen.findByText('Status unavailable');expect(screen.getByRole('button',{name:'Trial already started'})).toBeDisabled();
});
test('polling pauses while hidden and stops after a terminal response',async()=>{
  let polls=0;global.fetch=jest.fn(async url=>{if(url.startsWith('/api/workbench/prompt-jobs?'))return response({enabled:true,jobs:[makeJob()]});if(url.includes(`/${jobId}?`)){polls++;return response({job:makeJob({version:2,status:'complete',tasks:[task('proposal.executive-summary','failed_validation'),task('proposal.methodology','failed_validation')]})});}throw new Error('unexpected');});mount();await screen.findByText('Draft generation is in progress.');jest.useFakeTimers();Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});fireEvent(document,new Event('visibilitychange'));await act(async()=>{jest.advanceTimersByTime(15000);});expect(polls).toBe(0);Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});fireEvent(document,new Event('visibilitychange'));await act(async()=>{jest.advanceTimersByTime(5000);});expect(polls).toBe(1);expect(screen.getByText('Draft processing complete.')).toBeInTheDocument();await act(async()=>{jest.advanceTimersByTime(15000);});expect(polls).toBe(1);
});
test('expired validated result is not presented as ready',async()=>{
  global.fetch=jest.fn(async()=>response({enabled:true,jobs:[makeJob({status:'expired',tasks:[task('proposal.executive-summary','validated',false)]})]}));mount();expect(await screen.findByText('Draft expired')).toBeInTheDocument();expect(screen.queryByText('Draft ready')).not.toBeInTheDocument();expect(screen.getByRole('button',{name:'Trial already started'})).toBeDisabled();
});

test('Proposal tab forwards read-only Preview without making a draft API call',async()=>{
  global.fetch=jest.fn(async url=>url.startsWith('/api/workbench/proposal-documents?')?response({success:true,reviewerMaterials:[],aiMaterials:[],phaseIIDocuments:[],otherDocuments:[],slots:[],errors:[]}):response({enabled:true,jobs:[]}));
  render(<ProposalTab context={{requestId,proposalInfo:{coPIs:[]},aiContent:{}}} requestId={requestId} actorProfileId={12} previewReadOnly />);await waitFor(()=>expect(global.fetch).toHaveBeenCalled());expect(global.fetch.mock.calls.some(([url])=>url.startsWith('/api/workbench/prompt-jobs'))).toBe(false);expect(screen.queryByText('AI drafts')).not.toBeInTheDocument();
});
test('an uncertain submission does not claim no drafts exist',async()=>{
  global.fetch=jest.fn(async(url,opts={})=>url==='/api/workbench/prompt-jobs'&&opts.method==='POST'?Promise.reject(new Error('lost')):response({enabled:true,jobs:[]}));mount();await screen.findByText('AI drafts');fireEvent.click(screen.getByRole('button',{name:'Generate drafts'}));await screen.findByRole('button',{name:'Retry draft request'});expect(screen.queryByText('No drafts have been generated for this Request yet.')).not.toBeInTheDocument();
});
test('a newer result version refreshes terminal status before showing that result',async()=>{
  let reads=0;const value=makeJob({status:'complete',tasks:[task('proposal.executive-summary','validated',true)]});global.fetch=jest.fn(async url=>{if(url.includes('/results?')){reads++;return response({jobId,version:2,expiresAt:'2026-12-01',results:[{taskKey:'proposal.executive-summary',status:'available',text:'Latest draft'}]});}if(url.includes(`/${jobId}?`))return response({job:{...value,version:2}});return response({enabled:true,jobs:[value]});});mount();expect(await screen.findByText('Latest draft')).toBeInTheDocument();expect(reads).toBe(2);expect(global.fetch.mock.calls.some(([url])=>url.includes(`/${jobId}?`))).toBe(true);
});
