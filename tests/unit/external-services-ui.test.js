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
  Object.defineProperty(global.crypto,'randomUUID',{configurable:true,value:jest.fn(()=> '17f6def6-7b48-4ce0-8197-14219608a6a0')});
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
