/** @jest-environment jsdom */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ExternalServicesSection from '../../shared/components/admin/ExternalServicesSection';
import seed from '../../lib/services/external-services/seed.json';
jest.mock('../../shared/components/admin/useAdminUnsavedChangesGuard',()=>({__esModule:true,default:jest.fn()}));
jest.mock('../../shared/components/Layout',()=>({Button:({children,variant,...props})=><button {...props}>{children}</button>}));
const assembly={...seed.services.find(s=>s.id==='assemblyai'),version:1,lastReviewedOn:'2026-11-20'};
const response=(body,status=200)=>({ok:status<400,status,json:async()=>body});
beforeEach(()=>{
  global.structuredClone=value=>JSON.parse(JSON.stringify(value));
  Object.defineProperty(global.crypto,'randomUUID',{configurable:true,value:jest.fn().mockReturnValueOnce('17f6def6-7b48-4ce0-8197-14219608a6a0').mockReturnValue('217aee48-3637-4c5b-9387-84a371089a27')});
  global.fetch=jest.fn(async url=>response(url.includes('?id=')?{reviews:[{id:'438dce63-e462-4e8d-877b-8aefc8f40840',data:seed.assemblyAIReview}]}:{services:[assembly]}));
});
test('shows completed review and records a new review with current service version',async()=>{
  render(<ExternalServicesSection/>);
  fireEvent.click(await screen.findByRole('button',{name:'AssemblyAI · Recorded-audio transcription'}));
  expect(await screen.findByText('2026-11-20 · Change · Implemented')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Record review'}));
  for(const [label,value] of [['What prompted this review?','Monthly check'],['What changed / findings','No changes'],['Evidence and limitations','Vendor release notes; no local benchmark'],['Decision rationale','Keep current model']])fireEvent.change(screen.getByLabelText(label),{target:{value}});
  fireEvent.click(screen.getByRole('button',{name:'Save review'}));
  await waitFor(()=>expect(global.fetch).toHaveBeenCalledWith('/api/admin/external-services',expect.objectContaining({method:'PUT'})));
  const put=global.fetch.mock.calls.find(([,o])=>o?.method==='PUT');
  expect(JSON.parse(put[1].body)).toMatchObject({id:'assemblyai',expectedVersion:1,review:{trigger:'Monthly check',status:'Proposed'}});
});
test('retains new-service ID across ambiguous failures so retry cannot create duplicates',async()=>{
  global.fetch.mockImplementation(async(url,options)=>{if(options?.method==='PUT')throw new Error('network');return response({services:[]});});
  render(<ExternalServicesSection/>);await screen.findByText(/0 services/);
  fireEvent.click(screen.getByRole('button',{name:'Add service'}));
  for(const label of ['Service name','Provider','Used for','Current model, API, or plan'])fireEvent.change(screen.getByLabelText(label),{target:{value:'Test service'}});
  fireEvent.click(screen.getByRole('button',{name:'Save service'}));await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button',{name:'Save service'}));
  await waitFor(()=>expect(global.fetch.mock.calls.filter(([,o])=>o?.method==='PUT')).toHaveLength(2));
  const ids=global.fetch.mock.calls.filter(([,o])=>o?.method==='PUT').map(([,o])=>JSON.parse(o.body).id);
  expect(ids[0]).toBe(ids[1]);
  expect(global.crypto.randomUUID).toHaveBeenCalledTimes(1);
});
test('failed save preserves the draft and never displays success',async()=>{
  render(<ExternalServicesSection/>);fireEvent.click(await screen.findByRole('button',{name:'AssemblyAI · Recorded-audio transcription'}));
  fireEvent.click(screen.getByRole('button',{name:'Edit service'}));
  global.fetch.mockResolvedValue(response({error:'stale'},409));
  fireEvent.change(screen.getByLabelText('Owner'),{target:{value:'New owner'}});fireEvent.click(screen.getByRole('button',{name:'Save service'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('Copy any unsaved notes');
  expect(screen.getByLabelText('Owner')).toHaveValue('New owner');expect(screen.queryByText('Saved.')).not.toBeInTheDocument();
});
test('cancel after a conflict reloads the service version before the next edit',async()=>{
  let row=assembly;
  global.fetch.mockImplementation(async(url,options)=>{
    if(options?.method==='PUT'){row={...assembly,version:2,data:{...assembly.data,owner:'Saved by another editor'}};return response({error:'stale'},409);}
    return response(url.includes('?id=')?{reviews:[]}:{services:[row]});
  });
  render(<ExternalServicesSection/>);fireEvent.click(await screen.findByRole('button',{name:'AssemblyAI · Recorded-audio transcription'}));
  fireEvent.click(screen.getByRole('button',{name:'Edit service'}));fireEvent.click(screen.getByRole('button',{name:'Save service'}));
  await screen.findByRole('alert');fireEvent.click(screen.getByRole('button',{name:'Cancel'}));
  await screen.findByText(/Owner: Saved by another editor/);
  fireEvent.click(screen.getByRole('button',{name:'Edit service'}));fireEvent.click(screen.getByRole('button',{name:'Save service'}));
  await waitFor(()=>expect(global.fetch.mock.calls.filter(([,o])=>o?.method==='PUT')).toHaveLength(2));
  expect(JSON.parse(global.fetch.mock.calls.filter(([,o])=>o?.method==='PUT')[1][1].body).expectedVersion).toBe(2);
});
test('cancel after a lost create response reveals the saved row instead of an empty list',async()=>{
  let saved=null;
  global.fetch.mockImplementation(async(url,options)=>{
    if(options?.method==='PUT'){const body=JSON.parse(options.body);saved={id:body.id,data:body.data,version:1,lastReviewedOn:null};throw new Error('reply lost');}
    return response({services:saved?[saved]:[]});
  });
  render(<ExternalServicesSection/>);await screen.findByText(/0 services/);fireEvent.click(screen.getByRole('button',{name:'Add service'}));
  for(const label of ['Service name','Provider','Used for','Current model, API, or plan'])fireEvent.change(screen.getByLabelText(label),{target:{value:'New service'}});
  fireEvent.click(screen.getByRole('button',{name:'Save service'}));await screen.findByRole('alert');fireEvent.click(screen.getByRole('button',{name:'Cancel'}));
  expect(await screen.findByRole('button',{name:'New service · New service'})).toBeInTheDocument();
  expect(global.fetch.mock.calls.filter(([,o])=>o?.method==='PUT')).toHaveLength(1);
});

test('review date drives next-review suggestion and preserves an explicit next date',async()=>{
  render(<ExternalServicesSection/>);fireEvent.click(await screen.findByRole('button',{name:'AssemblyAI · Recorded-audio transcription'}));
  fireEvent.click(screen.getByRole('button',{name:'Record review'}));
  fireEvent.change(screen.getByLabelText('Review date (Pacific time)'),{target:{value:'2026-10-01'}});
  expect(screen.getByLabelText('Next review date')).toHaveValue('2026-10-31');
  fireEvent.change(screen.getByLabelText('Next review date'),{target:{value:'2027-01-01'}});
  fireEvent.change(screen.getByLabelText('Review date (Pacific time)'),{target:{value:'2026-10-02'}});
  expect(screen.getByLabelText('Next review date')).toHaveValue('2027-01-01');
});
test('new non-AI services default to quarterly and corporate providers exclude costs',async()=>{
  render(<ExternalServicesSection/>);await screen.findByText(/1 services/);fireEvent.click(screen.getByRole('button',{name:'Add service'}));
  fireEvent.change(screen.getByLabelText('Category'),{target:{value:'Hosting & storage'}});
  expect(screen.getByLabelText('Review interval (days)')).toHaveValue(90);
  fireEvent.change(screen.getByLabelText('Review interval (days)'),{target:{value:'45'}});
  fireEvent.change(screen.getByLabelText('Category'),{target:{value:'AI'}});
  expect(screen.getByLabelText('Review interval (days)')).toHaveValue(45);
  fireEvent.change(screen.getByLabelText('Provider'),{target:{value:'Microsoft'}});
  expect(screen.getByLabelText('Cost tracking')).toHaveValue('Corporate-managed — excluded');
  expect(screen.getByLabelText('Cost tracking')).toBeDisabled();
});
test('oversized save explains how to recover and retains text',async()=>{
  render(<ExternalServicesSection/>);fireEvent.click(await screen.findByRole('button',{name:'AssemblyAI · Recorded-audio transcription'}));fireEvent.click(screen.getByRole('button',{name:'Edit service'}));
  global.fetch.mockResolvedValue(response({},413));fireEvent.click(screen.getByRole('button',{name:'Save service'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('Shorten the text');expect(screen.getByLabelText('Service name')).toHaveValue(assembly.data.name);
});
test('unusual review years do not crash or discard the review draft',async()=>{
  render(<ExternalServicesSection/>);fireEvent.click(await screen.findByRole('button',{name:'AssemblyAI · Recorded-audio transcription'}));fireEvent.click(screen.getByRole('button',{name:'Record review'}));
  fireEvent.change(screen.getByLabelText('What prompted this review?'),{target:{value:'Keep this draft'}});
  const prior=screen.getByLabelText('Next review date').value;
  fireEvent.change(screen.getByLabelText('Review date (Pacific time)'),{target:{value:'20266-10-01'}});
  expect(screen.getByLabelText('What prompted this review?')).toHaveValue('Keep this draft');
  expect(screen.getByLabelText('Next review date')).toHaveValue(prior);
  fireEvent.change(screen.getByLabelText('Review date (Pacific time)'),{target:{value:'9999-12-31'}});
  expect(screen.getByLabelText('Next review date')).toHaveValue(prior);
});
test('typing through a corporate name does not exclude the completed non-corporate provider',async()=>{
  render(<ExternalServicesSection/>);await screen.findByText(/1 services/);fireEvent.click(screen.getByRole('button',{name:'Add service'}));
  for(const name of ['Zoom','ZoomInfo'])fireEvent.change(screen.getByLabelText('Provider'),{target:{value:name}});
  expect(screen.getByLabelText('Cost tracking')).toHaveValue('Review costs');expect(screen.getByLabelText('Cost tracking')).not.toBeDisabled();
  for(const label of ['Service name','Used for','Current model, API, or plan'])fireEvent.change(screen.getByLabelText(label),{target:{value:'Example'}});
  fireEvent.click(screen.getByRole('button',{name:'Save service'}));
  await waitFor(()=>expect(global.fetch.mock.calls.some(([,o])=>o?.method==='PUT')).toBe(true));
  const body=JSON.parse(global.fetch.mock.calls.find(([,o])=>o?.method==='PUT')[1].body);
  expect(body.data).toMatchObject({provider:'ZoomInfo',costTracking:'Review costs'});
});

const checked = {checkedAt:'2026-11-21T12:00:00Z',serviceVersion:1,sources:[
  {key:'pricing',label:'Public pricing',status:'changed',summary:'Reference changed.',lines:['Recorded audio rate changed'],previousLines:['Prior rate'],url:'https://www.assemblyai.com/pricing.md'},
  {key:'models',label:'Models',status:'unavailable',summary:'Could not check this source.',lines:[],url:'https://www.assemblyai.com/llms/models.md'},
]};
test('manual check shows partial results and drafts an unsaved proposed review',async()=>{
  global.fetch.mockImplementation(async(url,options)=>response(options?.method==='POST'?{check:checked}:url.includes('?id=')?{reviews:[],check:null}:{services:[assembly]}));
  render(<ExternalServicesSection/>);fireEvent.click(await screen.findByRole('button',{name:'AssemblyAI · Recorded-audio transcription'}));
  await waitFor(()=>expect(screen.getByRole('button',{name:'Check for updates'})).toBeEnabled());
  fireEvent.click(screen.getByRole('button',{name:'Check for updates'}));
  expect(await screen.findByText('Recorded audio rate changed')).toBeInTheDocument();
  expect(screen.getByText('Could not check')).toBeInTheDocument();
  const post=global.fetch.mock.calls.find(([,o])=>o?.method==='POST');
  expect(JSON.parse(post[1].body)).toEqual({action:'check',id:'assemblyai'});
  fireEvent.click(screen.getByRole('button',{name:'Start review from findings'}));
  expect(screen.getByLabelText('What changed / findings').value).toContain('Models: unavailable');
  expect(screen.getByLabelText('Decision rationale')).toHaveValue('');
  expect(global.fetch.mock.calls.some(([,o])=>o?.method==='PUT')).toBe(false);
});
test('lost check response can be recovered by reloading saved results',async()=>{
  let saved=null;
  global.fetch.mockImplementation(async(url,options)=>{
    if(options?.method==='POST'){saved=checked;throw new Error('lost reply');}
    return response(url.includes('?id=')?{reviews:[],check:saved}:{services:[assembly]});
  });
  render(<ExternalServicesSection/>);fireEvent.click(await screen.findByRole('button',{name:'AssemblyAI · Recorded-audio transcription'}));
  await waitFor(()=>expect(screen.getByRole('button',{name:'Check for updates'})).toBeEnabled());
  fireEvent.click(screen.getByRole('button',{name:'Check for updates'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not confirm the check');
  fireEvent.click(screen.getByRole('button',{name:'Reload check results'}));
  expect(await screen.findByText('Recorded audio rate changed')).toBeInTheDocument();
  expect(global.fetch.mock.calls.filter(([,o])=>o?.method==='POST')).toHaveLength(1);
});
test('late check response cannot overwrite a different service selection',async()=>{
  let resolveCheck;
  const other={...assembly,id:'other',data:{...assembly.data,name:'Other',provider:'Other',purpose:'Example'}};
  global.fetch.mockImplementation(async(url,options)=>options?.method==='POST'?new Promise(resolve=>{resolveCheck=resolve;}):response(url.includes('?id=')?{reviews:[],check:null}:{services:[assembly,other]}));
  render(<ExternalServicesSection/>);fireEvent.click(await screen.findByRole('button',{name:'AssemblyAI · Recorded-audio transcription'}));
  await waitFor(()=>expect(screen.getByRole('button',{name:'Check for updates'})).toBeEnabled());
  fireEvent.click(screen.getByRole('button',{name:'Check for updates'}));
  expect(screen.getByRole('button',{name:'Checking…'})).toBeDisabled();
  fireEvent.click(screen.getByRole('button',{name:/Back/}));
  fireEvent.click(await screen.findByRole('button',{name:'Other · Other'}));
  await require('@testing-library/react').act(async()=>{resolveCheck(response({check:checked}));});
  expect(screen.queryByText('Recorded audio rate changed')).not.toBeInTheDocument();
  expect(screen.queryByRole('button',{name:'Check for updates'})).not.toBeInTheDocument();
});
