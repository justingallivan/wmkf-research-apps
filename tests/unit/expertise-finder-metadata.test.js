/** @jest-environment jsdom */
import {fireEvent,render,screen} from '@testing-library/react';
jest.mock('../../shared/components/landing-cycle/useLandingCycleDefault',()=>({useLandingCycleDefault:()=>({settled:true,code:null})}));
jest.mock('../../shared/components/Layout',()=>({__esModule:true,default:({children})=><div>{children}</div>,PageHeader:({title})=><h1>{title}</h1>,Card:({children})=><section>{children}</section>,Button:({children,loading,...props})=><button {...props}>{children}</button>}));
jest.mock('../../shared/components/RequireAppAccess',()=>({__esModule:true,default:({children})=>children}));
jest.mock('../../shared/components/FileUploaderSimple',()=>({__esModule:true,default:({onFilesUploaded})=><button onClick={()=>onFilesUploaded([{url:'https://example.invalid/a.pdf',filename:'a.pdf'}])}>fake-upload</button>}));
jest.mock('../../shared/utils/api-request',()=>({requestEnvelope:jest.fn()}));
import {requestEnvelope} from '../../shared/utils/api-request';
import Page from '../../pages/expertise-finder';
const results={proposal_summary:{title:'Synthetic proposal'},consultant_overlap:[]};
beforeEach(()=>jest.resetAllMocks());
test.each([[null,false],[0,true]])('history cost %s renders only when valid',async(cost,visible)=>{
 requestEnvelope.mockResolvedValue({ok:true,data:{matches:[{id:1,proposal_title:'History item',created_at:'2026-01-01',model_used:'synthetic',input_tokens:0,output_tokens:0,estimated_cost_cents:cost,match_results:results}]}});
 render(<Page/>);fireEvent.click(screen.getByText('History'));fireEvent.click(await screen.findByText('History item'));
 expect(screen.queryByText(/Latency:/)).not.toBeInTheDocument();expect(screen.queryByText(/Roster:/)).not.toBeInTheDocument();expect(document.body).not.toHaveTextContent('NaN');
 if(visible)expect(screen.getByText('Cost: $0.0000')).toBeInTheDocument();else expect(screen.queryByText(/Cost:/)).not.toBeInTheDocument();
});
test('live match metadata retains cost, latency and roster values',async()=>{
 requestEnvelope.mockResolvedValue({ok:true,data:{results,metadata:{model:'synthetic',inputTokens:1,outputTokens:2,estimatedCostCents:5,latencyMs:1234,rosterSize:3}}});
 render(<Page/>);fireEvent.click(screen.getByText('fake-upload'));fireEvent.click(screen.getByRole('button',{name:'Find Matches'}));
 expect(await screen.findByText('Cost: $0.0500')).toBeInTheDocument();expect(screen.getByText('Latency: 1.2s')).toBeInTheDocument();expect(screen.getByText('Roster: 3 members')).toBeInTheDocument();
});
