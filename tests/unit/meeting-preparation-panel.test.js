/** @jest-environment jsdom */
import {render,screen,fireEvent,waitFor,act} from '@testing-library/react';
import PreparationPanel from '../../shared/components/meeting-tracker/PreparationPanel.js';
jest.mock('../../shared/components/Layout',()=>({Button:({children,variant,size,...p})=><button {...p}>{children}</button>}));
const id='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const source={kind:'published',artifactId:id,fingerprint:'a'.repeat(64)};
const response=body=>Promise.resolve({ok:true,status:200,json:async()=>({canRecoverUnknown:true,...body})});
const step=(state='blocked',over={})=>({id:other,kind:'presentation_summary',state,version:4,output:null,...over});
const preparation=s=>({id,version:5,steps:s});
beforeEach(()=>{global.fetch=jest.fn(()=>response({preparation:null}));});
test('start persists the inspected source and shows queued progress without waiting for processing',async()=>{
 const queued=preparation([step('pending')]);let saved=null;global.fetch.mockImplementation((_,opts)=>{if(opts?.method==='POST')saved=queued;return response({preparation:saved});});
 render(<PreparationPanel requestId={id} source={source}/>);fireEvent.click(await screen.findByRole('button',{name:'Prepare saved materials'}));
 await screen.findByText('Waiting');expect(JSON.parse(global.fetch.mock.calls.find(([,o])=>o?.method==='POST')[1].body)).toEqual({action:'start',source});
 expect(screen.getByText(/continues if you leave/)).toBeVisible();
});
test('unknown retry requires a separate explicit possible-charge confirmation',async()=>{
 global.fetch.mockImplementation(()=>response({preparation:preparation([step('unknown')])}));render(<PreparationPanel requestId={id} source={source}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Review recovery'}));expect(global.fetch.mock.calls.some(([,o])=>o?.method==='POST')).toBe(false);
 expect(screen.getByText(/first summary call may already have incurred a charge/)).toBeVisible();fireEvent.click(screen.getByRole('button',{name:'Abandon attempt and try again'}));
 await waitFor(()=>expect(global.fetch.mock.calls.some(([,o])=>o?.method==='POST')).toBe(true));
 expect(JSON.parse(global.fetch.mock.calls.find(([,o])=>o?.method==='POST')[1].body)).toEqual({action:'retry',preparationId:id,stepId:other,expectedVersion:4,acknowledgePotentialDuplicateCharge:true});
});
test('a failed step retry leaves successful steps visible',async()=>{
 global.fetch.mockImplementation(()=>response({preparation:preparation([step('succeeded',{id,kind:'transcripts'}),step('blocked')])}));render(<PreparationPanel requestId={id} source={source}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Retry this step'}));await screen.findByText('Prepared');
 expect(JSON.parse(global.fetch.mock.calls.find(([,o])=>o?.method==='POST')[1].body).stepId).toBe(other);
});
test('edited draft replacement names the exact conflict draft/version',async()=>{
 global.fetch.mockImplementation(()=>response({preparation:preparation([step('blocked',{failureCode:'summary_draft_exists',output:{draftId:id,version:8}})])}));render(<PreparationPanel requestId={id} source={source}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Review replacement'}));fireEvent.click(screen.getByRole('button',{name:'Replace existing draft'}));
 await waitFor(()=>expect(global.fetch.mock.calls.some(([,o])=>o?.method==='POST')).toBe(true));expect(JSON.parse(global.fetch.mock.calls.find(([,o])=>o?.method==='POST')[1].body).replaceDraft).toEqual({draftId:id,expectedVersion:8});
});
test('a late read for an earlier request cannot replace the current progress',async()=>{
 let resolveOld;global.fetch.mockImplementationOnce(()=>new Promise(resolve=>{resolveOld=resolve;})).mockImplementation(()=>response({preparation:preparation([step('succeeded')])}));
 const view=render(<PreparationPanel requestId={id} source={source}/>);await waitFor(()=>expect(global.fetch).toHaveBeenCalledTimes(1));view.rerender(<PreparationPanel requestId={other} source={source}/>);
 await screen.findByText('Prepared');await act(async()=>{resolveOld(await response({preparation:preparation([step('unknown')])}));});expect(screen.queryByText('Outcome unknown')).toBeNull();
});


test('save and prepare queues the exact newly saved version after the review save completes', async()=>{
 const savedSource={kind:'correction',operationId:other,expectedVersion:9};
 let resolveSave;const beforeStart=jest.fn(()=>new Promise(resolve=>{resolveSave=resolve;}));
 render(<PreparationPanel requestId={id} source={{...savedSource,expectedVersion:8}} beforeStart={beforeStart} startLabel="Save and prepare materials"/>);
 fireEvent.click(await screen.findByRole('button',{name:'Save and prepare materials'}));
 expect(global.fetch.mock.calls.some(([,o])=>o?.method==='POST')).toBe(false);
 await act(async()=>resolveSave(savedSource));
 await waitFor(()=>expect(global.fetch.mock.calls.some(([,o])=>o?.method==='POST')).toBe(true));
 expect(JSON.parse(global.fetch.mock.calls.find(([,o])=>o?.method==='POST')[1].body)).toEqual({action:'start',source:savedSource});
});

test('failed review save never starts preparation',async()=>{
 render(<PreparationPanel requestId={id} source={source} beforeStart={async()=>{throw new Error('Attendance changed. Review it again.');}} startLabel="Save and prepare materials"/>);
 fireEvent.click(await screen.findByRole('button',{name:'Save and prepare materials'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('Attendance changed');
 expect(global.fetch.mock.calls.some(([,o])=>o?.method==='POST')).toBe(false);
});

test('navigating during a review save cannot queue preparation for either page',async()=>{
 let resolveSave;const beforeStart=()=>new Promise(resolve=>{resolveSave=resolve;});
 const view=render(<PreparationPanel requestId={id} source={source} beforeStart={beforeStart}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Prepare saved materials'}));
 view.rerender(<PreparationPanel requestId={other} source={source} beforeStart={beforeStart}/>);
 await act(async()=>resolveSave(source));
 expect(global.fetch.mock.calls.some(([,o])=>o?.method==='POST')).toBe(false);
});


test('changed saved inputs require a new preparation rather than retrying the immutable old version',async()=>{
 global.fetch.mockImplementation(()=>response({preparation:preparation([step('blocked',{failureCode:'preparation_source_changed'})])}));
 render(<PreparationPanel requestId={id} source={source}/>);
 expect(await screen.findByText('The transcript changed. Start preparation from the saved review.')).toBeVisible();
 expect(screen.queryByRole('button',{name:'Retry this step'})).toBeNull();
});

test('an incomplete admission receipt never closes the saved review',async()=>{
 const onStarted=jest.fn();render(<PreparationPanel requestId={id} source={source} onStarted={onStarted}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Prepare saved materials'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('Preparation could not be confirmed');expect(onStarted).not.toHaveBeenCalled();
});
