/** @jest-environment jsdom */
import {render,screen,act,fireEvent,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
jest.mock('../../shared/components/FileUploaderSimple',()=>function FileUploaderSimple(){return null;});
jest.mock('../../shared/utils/api-request',()=>({requestEnvelope:jest.fn()}));
import {requestEnvelope} from '../../shared/utils/api-request';
import {RosterTab} from '../../pages/expertise-finder';
const member={id:'11111111-1111-4111-8111-111111111111',name:'Test Person',role_type:'Board',is_active:true,etag:'W/"1"'};
const list={ok:true,data:{members:[member],backend:'dataverse-rehearsal',users:[]}};
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
let pending;
beforeEach(()=>{Object.defineProperty(global.crypto,'randomUUID',{configurable:true,value:()=> '22222222-2222-4222-8222-222222222222'});jest.clearAllMocks();pending=deferred();requestEnvelope.mockImplementation((_url,options)=>options?pending.promise:Promise.resolve(list));window.confirm=jest.fn(()=>true);});
async function openEdit(){await userEvent.click(await screen.findByText('Test Person'));await userEvent.click(screen.getByRole('button',{name:'Edit'}));}
async function start(kind){
 if(kind==='add'){
  await screen.findByText('Test Person'); await userEvent.click(screen.getByRole('button',{name:'+ Add Member'}));
  // The current form's labels are not associated with their inputs.
  const form=screen.getByRole('button',{name:'Add Member'}).closest('form');
  fireEvent.change(form.querySelector('input[required]'),{target:{value:'New Person'}});
  await userEvent.click(screen.getByRole('button',{name:'Add Member'}));
 }else{
  await userEvent.click(await screen.findByText('Test Person'));
  if(kind==='status')await userEvent.click(screen.getByRole('button',{name:'Deactivate'}));
  else {await userEvent.click(screen.getByRole('button',{name:'Edit'}));await userEvent.click(screen.getByRole('button',{name:'Save Changes'}));}
 }
 await waitFor(()=>expect(requestEnvelope.mock.calls.some(c=>c[1])).toBe(true));
}
test.each(['edit','status','add'])('%s locks filter/editor controls until save and refresh finish',async kind=>{
 render(<RosterTab/>);await start(kind);
 expect(screen.getByPlaceholderText('Search by name, affiliation, or expertise...')).toBeDisabled();
 expect(screen.getByLabelText('Include inactive')).toBeDisabled();
 for(const button of screen.getAllByRole('button',{name:/Cancel|Add Member/}))expect(button).toBeDisabled();
 const refresh=deferred();requestEnvelope.mockImplementation((_url,options)=>options?pending.promise:refresh.promise);
 await act(async()=>pending.resolve({ok:true,data:{member}}));
 expect(screen.getByLabelText('Include inactive')).toBeDisabled();
 await act(async()=>refresh.resolve(list));
 await waitFor(()=>expect(screen.getByLabelText('Include inactive')).not.toBeDisabled());
});
test.each(['edit','status','add'])('%s completion after unmount cannot start a stale reload',async kind=>{
 const view=render(<RosterTab/>);await start(kind);const calls=requestEnvelope.mock.calls.length;
 view.unmount();await act(async()=>pending.resolve({ok:true,data:{member}}));
 expect(requestEnvelope).toHaveBeenCalledTimes(calls);
});
test('failed save preserves draft and unlocks controls',async()=>{
 render(<RosterTab/>);await openEdit();
 const form=screen.getByRole('button',{name:'Save Changes'}).closest('form');
 fireEvent.change(form.querySelector('input[required]'),{target:{value:'Unsaved name'}});
 await userEvent.click(screen.getByRole('button',{name:'Save Changes'}));
 await act(async()=>pending.resolve({ok:false,data:{error:'Conflict: reload first'}}));
 expect(form.querySelector('input[required]')).toHaveValue('Unsaved name');
 expect(screen.getByRole('button',{name:'Save Changes'})).not.toBeDisabled();
});
test('post-save warning survives list reload',async()=>{
 render(<RosterTab/>);await start('edit');
 await act(async()=>pending.resolve({ok:true,data:{member,warning:'Saved. Reload to fetch the latest profile before editing again.'}}));
 await waitFor(()=>expect(screen.getByLabelText('Include inactive')).not.toBeDisabled());
 expect(screen.getByRole('status')).toHaveTextContent('Saved. Reload');
});
