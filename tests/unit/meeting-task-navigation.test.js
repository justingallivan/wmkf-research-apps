/** @jest-environment jsdom */
import {useState} from 'react';
import {fireEvent,render,screen} from '@testing-library/react';
import Navigation from '../../shared/components/meeting-tracker/MeetingTaskNavigation';
const tabs=[{id:'setup',label:'Meeting setup',group:'Before the meeting'},{id:'invitations',label:'Invitations',group:'Before the meeting'},{id:'materials',label:'Materials collection',group:'Before the meeting',disabled:true},{id:'recordings',label:'Transcript preparation',group:'After the meeting'}];
function Example(){const[selected,setSelected]=useState('setup');return <Navigation idPrefix="example" tabs={tabs} selected={selected} onChange={setSelected}/>;}
test('keyboard navigation skips unavailable tasks and moves selection and focus together',()=>{
 render(<Example/>);const setup=screen.getByRole('tab',{name:/Meeting setup/});setup.focus();fireEvent.keyDown(setup,{key:'ArrowRight'});
 const invite=screen.getByRole('tab',{name:/Invitations/});expect(invite).toHaveFocus();expect(invite).toHaveAttribute('aria-selected','true');fireEvent.keyDown(invite,{key:'ArrowRight'});
 const after=screen.getByRole('tab',{name:/Transcript preparation/});expect(after).toHaveFocus();expect(after).toHaveAttribute('aria-controls','example-panel-recordings');fireEvent.keyDown(after,{key:'Home'});expect(setup).toHaveFocus();expect(setup).toHaveAttribute('aria-selected','true');
});
test('a rejected task change leaves the current setup selected',()=>{const change=jest.fn(()=>false);render(<Navigation idPrefix="example" tabs={tabs} selected="setup" onChange={change}/>);const setup=screen.getByRole('tab',{name:/Meeting setup/});setup.focus();fireEvent.keyDown(setup,{key:'End'});expect(change).toHaveBeenCalledWith('recordings');expect(setup).toHaveFocus();expect(setup).toHaveAttribute('aria-selected','true');});
