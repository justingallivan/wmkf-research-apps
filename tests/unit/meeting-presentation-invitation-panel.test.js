/** @jest-environment jsdom */
import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import PresentationInvitationPanel from '../../shared/components/meeting-tracker/PresentationInvitationPanel';
jest.mock('../../shared/context/ProfileContext',()=>({useProfile:()=>({profileId:7})}));
jest.mock('../../shared/components/Layout',()=>({Button:({children,variant,size,...props})=><button {...props}>{children}</button>}));
const requestId='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222',other='33333333-3333-4333-8333-333333333333';
const row=(state='prepared',over={})=>({id,version:1,state,subject:'Reviewed subject',message:'Join us.',bodyText:'Meeting: saved time and link',fromEmail:'pc@wmkeck.org',to:['staff@wmkeck.org'],cc:['consultant@example.org'],...over});
const response=(body,status=200)=>Promise.resolve({ok:status<300,status,json:async()=>body});
beforeEach(()=>{global.fetch=jest.fn(()=>response({invitation:null,canSend:false}));});
test('preparing a preview never sends; only the explicit reviewed action dispatches',async()=>{
 const actions=[];global.fetch.mockImplementation((_url,options={})=>{if(!options.method||options.method==='GET')return response({invitation:null,canSend:false});const body=JSON.parse(options.body);actions.push(body);return response({invitation:row(body.action==='send'?'sent':'prepared'),canSend:true,canReconcile:true});});
 render(<PresentationInvitationPanel requestId={requestId} requestNumber="1001"/>);
 fireEvent.click(await screen.findByRole('button',{name:'Review recipients and message'}));
 await screen.findByText('Reviewed subject');expect(actions).toHaveLength(1);expect(actions[0].action).toBe('prepare');expect(screen.getByText('consultant@example.org')).toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:'Send reviewed invitation'}));
 expect(await screen.findByRole('status')).toHaveTextContent('Sent for delivery.');expect(actions[1]).toEqual({action:'send',invitationId:id,expectedVersion:1});
});
test('unknown transport offers read-only status checks, never another Send',async()=>{
 const actions=[];global.fetch.mockImplementation((_url,options={})=>{if(!options.method||options.method==='GET')return response({invitation:row('unknown',{version:5}),canSend:true,canReconcile:true});actions.push(JSON.parse(options.body));return response({invitation:row('unknown',{version:6}),canSend:true,canReconcile:true});});
 render(<PresentationInvitationPanel requestId={requestId}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Check email status'}));await waitFor(()=>expect(actions).toHaveLength(1));
 expect(actions[0]).toEqual({action:'reconcile',invitationId:id,expectedVersion:5});expect(screen.queryByRole('button',{name:'Send reviewed invitation'})).toBeNull();expect(screen.queryByRole('button',{name:'Edit and prepare a fresh preview'})).toBeNull();
});
test('another sender can read but cannot dispatch the frozen preview',async()=>{
 global.fetch.mockImplementation(()=>response({invitation:row(),canSend:false}));render(<PresentationInvitationPanel requestId={requestId}/>);
 expect(await screen.findByRole('button',{name:'Send reviewed invitation'})).toBeDisabled();expect(screen.getByText(/Only the original staff sender/)).toBeVisible();
});
test('a stale server preview refusal keeps feedback and requires a fresh preview',async()=>{
 global.fetch.mockImplementation((_url,options={})=>(!options.method||options.method==='GET')?response({invitation:row(),canSend:true,canReconcile:true}):response({error:'The meeting changed. Prepare a fresh preview.',code:'presentation_invitation_preview_stale'},409));
 render(<PresentationInvitationPanel requestId={requestId}/>);fireEvent.click(await screen.findByRole('button',{name:'Send reviewed invitation'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('meeting changed');expect(screen.getByRole('button',{name:'Send reviewed invitation'})).toBeDisabled();
 fireEvent.click(screen.getByRole('button',{name:'Refresh invitation status'}));await screen.findByText('This preview is no longer current. Edit and prepare a fresh preview before sending.');expect(screen.getByRole('button',{name:'Send reviewed invitation'})).toBeDisabled();
});
test('late previous-request reads cannot populate the new invitation',async()=>{
 let resolveOld;global.fetch.mockImplementationOnce(()=>new Promise(resolve=>{resolveOld=resolve;})).mockImplementation(()=>response({invitation:row('sent',{subject:'New request invitation'}),canSend:true,canReconcile:true}));
 const view=render(<PresentationInvitationPanel requestId={requestId}/>);await waitFor(()=>expect(global.fetch).toHaveBeenCalledTimes(1));view.rerender(<PresentationInvitationPanel requestId={other}/>);await screen.findByText('New request invitation');
 await act(async()=>resolveOld(await response({invitation:row('unknown',{subject:'Old request invitation'}),canSend:true,canReconcile:true})));expect(screen.queryByText('Old request invitation')).toBeNull();
});


test('disabled admission shows its unavailable state instead of an actionable send form',async()=>{
 global.fetch.mockImplementation(()=>response({error:'Not enabled',code:'presentation_invitation_unavailable'},503));render(<PresentationInvitationPanel requestId={requestId}/>);
 expect(await screen.findByText('Invitation emails are not enabled for this environment.')).toBeVisible();expect(screen.queryByRole('button',{name:'Review recipients and message'})).toBeNull();
});

test('a refused command reloads the current receipt version before another status check',async()=>{
 let version=1;const actions=[];global.fetch.mockImplementation((_url,options={})=>{if(!options.method||options.method==='GET')return response({invitation:row('unknown',{version}),canSend:true,canReconcile:true});actions.push(JSON.parse(options.body));if(actions.length===1){version=8;return response({error:'Receipt changed',code:'presentation_invitation_conflict'},409);}return response({invitation:row('sent',{version:9}),canSend:true,canReconcile:true});});
 render(<PresentationInvitationPanel requestId={requestId}/>);fireEvent.click(await screen.findByRole('button',{name:'Check email status'}));await screen.findByRole('alert');await waitFor(()=>expect(global.fetch).toHaveBeenCalledTimes(3));fireEvent.click(screen.getByRole('button',{name:'Check email status'}));await screen.findByText('Sent for delivery.');expect(actions[1].expectedVersion).toBe(8);
});
