/** @jest-environment jsdom */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import MeetingTrackerList from '../../shared/components/meeting-tracker/MeetingTrackerList';
const mockRouter={isReady:true,pathname:'/meeting-tracker',query:{},replace:jest.fn(async()=>true)};
jest.mock('next/router',()=>({useRouter:()=>mockRouter}));
jest.mock('next/link',()=>function Link({children,href}){return <a href={href}>{children}</a>});
jest.mock('../../shared/components/Layout',()=>({__esModule:true,default:({children})=><main>{children}</main>,PageHeader:({title})=><h1>{title}</h1>}));
const summary=(state='missing',extra={})=>({state,receivedCount:1,requiredCount:3,invited:true,overdue:false,dueAt:'2026-09-25T12:00:00Z',...extra});
function fixtures(){return Array.from({length:25},(_,i)=>({requestId:`request-${i}`,requestNumber:String(i+1),title:`Proposal ${i+1}`,siteVisit:{scheduledStartIso:'2026-10-01T12:00:00Z'},materialsAvailability:'available',materials:[null,summary(),summary('missing',{overdue:true}),summary('received',{receivedCount:3}),summary('ready',{receivedCount:3})][i%5]}));}
const response=(proposals)=>({ok:true,status:200,json:async()=>({proposals,programs:[{programId:'p1',name:'Research'},{programId:'p2',name:'Other'}],cycles:[{code:'D26'},{code:'J27'}],notices:[],sessions:[]})});
let rows;
beforeEach(()=>{rows=fixtures();mockRouter.query={programId:'p1',cycleCode:'D26'};mockRouter.replace.mockClear();global.fetch=jest.fn(async()=>response(rows));});
afterEach(()=>jest.restoreAllMocks());
const filters=()=>screen.getByRole('navigation',{name:'Materials status filters'});
const filter=(name)=>within(filters()).getByRole('button',{name});
const titles=()=>screen.getAllByRole('heading',{level:2}).map(x=>x.textContent);

test('25 rows have exclusive stable counts; every normal filter retains source order without refetching',async()=>{
 render(<MeetingTrackerList/>);await screen.findByRole('button',{name:'All (25)'});
 const calls=global.fetch.mock.calls.length;
 for(const [offset,label] of ['Not requested','Waiting','Late','Check files','Ready'].entries()){
  fireEvent.click(filter(`${label} (5)`));
  expect(titles()).toEqual(Array.from({length:5},(_,i)=>`#${offset+1+i*5}`));
  expect(filter(`${label} (5)`)).toHaveAttribute('aria-pressed','true');
  expect(within(filters()).getAllByRole('button').map(b=>b.textContent)).toEqual(['All (25)','Not requested (5)','Waiting (5)','Late (5)','Check files (5)','Ready (5)']);
 }
 expect(global.fetch).toHaveBeenCalledTimes(calls);
 fireEvent.click(filter('All (25)'));expect(titles()).toHaveLength(25);
});

test('diagnostic buckets count every row and zero-count filters show an explicit empty result',async()=>{
 rows=[{...fixtures()[0],siteVisit:null},{...fixtures()[1],materialsAvailability:'unavailable'},{...fixtures()[2],materials:summary('closed')}];
 render(<MeetingTrackerList/>);await screen.findByRole('button',{name:'All (3)'});
 for(const label of ['No visit','Status unavailable','Closed'])expect(filter(`${label} (1)`)).toBeInTheDocument();
 fireEvent.click(filter('Ready (0)'));expect(screen.getByText('No requests match this materials status')).toBeInTheDocument();
 expect(screen.queryByRole('link',{name:'Edit visit'})).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Show all requests'}));expect(titles()).toHaveLength(3);
});

test.each([{scope:'all'},{cycleCode:'J27'},{programId:'p2'}])('URL scope change resets filter and uses new scoped results: %p',async(change)=>{
 const view=render(<MeetingTrackerList/>);await screen.findByRole('button',{name:'All (25)'});
 fireEvent.click(filter('Late (5)'));
 rows=[{...fixtures()[4],requestNumber:'900',title:'New scope'}];
 mockRouter.query={...mockRouter.query,...change};view.rerender(<MeetingTrackerList/>);
 await screen.findByRole('button',{name:'All (1)'});
 expect(filter('All (1)')).toHaveAttribute('aria-pressed','true');expect(titles()).toEqual(['#900']);
});

test('scope-control click immediately hides old actions even before router navigation completes',async()=>{
 render(<MeetingTrackerList/>);await screen.findByRole('button',{name:'All (25)'});
 fireEvent.click(screen.getByRole('button',{name:'All program directors'}));
 expect(mockRouter.replace).toHaveBeenCalled();
 expect(screen.queryByRole('navigation',{name:'Materials status filters'})).not.toBeInTheDocument();
 expect(screen.queryByRole('heading',{name:'#1',exact:true})).not.toBeInTheDocument();
});

test('new-scope load failure never displays previous-scope requests or counts',async()=>{
 const view=render(<MeetingTrackerList/>);await screen.findByRole('button',{name:'All (25)'});
 global.fetch=jest.fn(async()=>({ok:false,status:503,json:async()=>({error:'Scoped load failed'})}));
 mockRouter.query={programId:'p2',cycleCode:'D26'};view.rerender(<MeetingTrackerList/>);
 await screen.findByRole('alert');expect(screen.queryByRole('navigation',{name:'Materials status filters'})).not.toBeInTheDocument();
 expect(screen.queryByRole('heading',{name:'#1',exact:true})).not.toBeInTheDocument();
});

test('a late response from the old scope cannot overwrite the new scope',async()=>{
 let resolveOld;const old=new Promise(resolve=>{resolveOld=resolve});
 global.fetch=jest.fn(url=>String(url).includes('programId=p1')?old:Promise.resolve(response([{...fixtures()[0],requestNumber:'900'}])));
 const view=render(<MeetingTrackerList/>);await waitFor(()=>expect(global.fetch).toHaveBeenCalled());
 mockRouter.query={programId:'p2',cycleCode:'D26'};view.rerender(<MeetingTrackerList/>);
 await screen.findByRole('button',{name:'All (1)'});
 await act(async()=>{resolveOld(response(fixtures()));});
 expect(titles()).toEqual(['#900']);expect(filter('All (1)')).toBeInTheDocument();
});
