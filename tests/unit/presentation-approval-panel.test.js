/** @jest-environment jsdom */
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import PresentationApprovalPanel from '../../shared/components/meeting-tracker/PresentationApprovalPanel';
jest.mock('../../shared/components/Layout',()=>({Button:({children,variant,size,loading,...props})=><button {...props}>{children}</button>}));
const requestId='11111111-1111-4111-8111-111111111111';
const editionId='22222222-2222-4222-8222-222222222222';
const approved={enrolled:true,version:2,activeEditionId:editionId,canApprove:true,candidate:{ready:true,fingerprint:'a'.repeat(64)}};
const response=body=>Promise.resolve({ok:true,status:200,json:async()=>body});
beforeEach(()=>{global.fetch=jest.fn(()=>response(approved));Object.defineProperty(global.crypto,'randomUUID',{configurable:true,value:()=>editionId});});
test('requires both reviews and separate final confirmation, then refreshes durable status',async()=>{
 render(<PresentationApprovalPanel requestId={requestId}/>);
 const approve=await screen.findByRole('button',{name:'Approve replacement for Board'});expect(approve).toBeDisabled();
 fireEvent.click(screen.getByLabelText('I checked the presentation video ending.'));fireEvent.click(screen.getByLabelText('I reviewed the presentation summary.'));
 fireEvent.click(approve);expect(global.fetch).toHaveBeenCalledTimes(1);
 fireEvent.click(screen.getByRole('button',{name:'Confirm approval'}));
 await screen.findByText('Presentation materials approved for the Board.');
 const post=global.fetch.mock.calls.find(([,opts])=>opts?.method==='POST');expect(JSON.parse(post[1].body)).toMatchObject({action:'approve',expectedVersion:2,candidateFingerprint:'a'.repeat(64),videoReviewed:true,summaryReviewed:true});
});
test('withdrawal explains the access limit and uses the inspected edition/version',async()=>{
 render(<PresentationApprovalPanel requestId={requestId}/>);fireEvent.click(await screen.findByRole('button',{name:'Withdraw from Board'}));
 expect(screen.getByText(/Files already downloaded or a video already opened cannot be recalled/)).toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:'Withdraw presentation'}));await screen.findByText('Presentation materials withdrawn from the Board page.');
 expect(JSON.parse(global.fetch.mock.calls.find(([,o])=>o?.method==='POST')[1].body)).toEqual({action:'withdraw',expectedVersion:2,expectedEditionId:editionId});
});
test('other staff see approval status but cannot mutate it',async()=>{
 global.fetch.mockImplementation(()=>response({...approved,canApprove:false}));render(<PresentationApprovalPanel requestId={requestId}/>);
 await screen.findByText(/assigned Program Coordinator approves/);expect(screen.queryByRole('button',{name:'Withdraw from Board'})).toBeNull();expect(screen.queryByRole('checkbox')).toBeNull();
});
test('setup warns before hiding legacy presentation and never sends email',async()=>{
 global.fetch.mockImplementation(()=>response({enrolled:false,version:0,activeEditionId:null,canApprove:true,candidate:{ready:true}}));
 render(<PresentationApprovalPanel requestId={requestId}/>);fireEvent.click(await screen.findByRole('button',{name:'Set up presentation approval'}));
 expect(screen.getByText(/Presentation items currently on the Board page will be hidden/)).toBeVisible();expect(global.fetch).toHaveBeenCalledTimes(1);
 fireEvent.click(screen.getByRole('button',{name:'Set up approval'}));await screen.findByText(/Board approval is set up/);
 expect(JSON.parse(global.fetch.mock.calls.find(([,o])=>o?.method==='POST')[1].body)).toEqual({action:'enroll',expectedVersion:0});
});
test('a refresh failure cannot relabel a confirmed withdrawal as a failed action',async()=>{
 global.fetch.mockImplementationOnce(()=>response(approved)).mockImplementationOnce(()=>response({version:3})).mockRejectedValueOnce(new Error('offline'));
 render(<PresentationApprovalPanel requestId={requestId}/>);fireEvent.click(await screen.findByRole('button',{name:'Withdraw from Board'}));fireEvent.click(screen.getByRole('button',{name:'Withdraw presentation'}));
 await screen.findByText('Presentation materials withdrawn from the Board page.');await screen.findByRole('alert');expect(screen.queryByRole('button',{name:'Withdraw from Board'})).toBeNull();
});
test('an older request read cannot populate a new request after navigation',async()=>{
 let resolveOld;global.fetch.mockImplementationOnce(()=>new Promise(resolve=>{resolveOld=resolve;})).mockImplementationOnce(()=>response({...approved,canApprove:false}));
 const {rerender}=render(<PresentationApprovalPanel requestId={requestId}/>);rerender(<PresentationApprovalPanel requestId={editionId}/>);
 await screen.findByText(/assigned Program Coordinator approves/);
 await act(async()=>{resolveOld(await response(approved));});
 await waitFor(()=>expect(screen.queryByRole('button',{name:'Withdraw from Board'})).toBeNull());
});
