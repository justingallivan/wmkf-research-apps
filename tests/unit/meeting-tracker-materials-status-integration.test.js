/** @jest-environment node */
import { loadMeetingTrackerDashboard } from '../../lib/services/meeting-tracker/dashboard-service';
import { getMaterialsSummaryByRequests, getMaterialsSummaryByRequestsWithAvailability } from '../../lib/services/site-visit-materials/summary-reader';
import { classifySiteVisitMaterialsStatus } from '../../shared/utils/site-visit-materials-status';

const A='11111111-1111-4111-8111-111111111111';
const B='22222222-2222-4222-8222-222222222222';
const NOW=new Date('2026-09-21T12:00:00Z');
function row(requestId=A,extra={}) { return {id:requestId,request_id:requestId,status:'open',due_at:'2026-09-20T12:00:00Z',closes_at:'2026-10-10T12:00:00Z',created_at:'2026-09-01T12:00:00Z',invited_at:'2026-09-01T12:00:00Z',checklist:[{key:'presentation_pdf',label:'Presentation',required:true,waived:false}],contacts:{pi:{email:'private@example.test'}},token_ciphertext:'must-not-leak',...extra}; }
function reads(extra={}) { return {schemaReady:()=>true,listLatestCollections:async()=>[row()],findDocumentsByCycle:async()=>[],findDocumentsByRequest:async()=>[],now:()=>NOW,...extra}; }
async function dashboard(summaryDeps, readerOverride) { return loadMeetingTrackerDashboard({cycleCode:'D26'}, {
 schemaReady:()=>true,
 loadWorkbenchDashboard:async()=>({proposals:[{requestId:A,requestNumber:'1'},{requestId:B,requestNumber:'2'}]}),
 findRequestsByIds:async()=>({records:[{akoya_requestid:A},{akoya_requestid:B}]}),
 findDocumentsByIds:async()=>({records:[]}),findActiveSiteVisits:async()=>[],getSiteVisitById:async()=>null,getSchedules:async()=>new Map(),
 getMaterialsSummariesWithAvailability:readerOverride || ((args)=>getMaterialsSummaryByRequestsWithAvailability(args,summaryDeps)),
 }); }
function classifications(result) {return result.proposals.map(p=>classifySiteVisitMaterialsStatus(p.materials,{availability:p.materialsAvailability,hasSiteVisit:Boolean(p.siteVisit)}).key);}
afterEach(()=>jest.restoreAllMocks());

test('real summary producer carries a late collection even without a visit, and distinguishes known absence',async()=>{
 const result=await dashboard(reads());
 expect(classifications(result)).toEqual(['late','no_visit']);
 expect(result.proposals.map(p=>p.materialsAvailability)).toEqual(['available','available']);
 expect(JSON.stringify(result)).not.toMatch(/must-not-leak|private@example|contacts|contributorUrl/);
});
test.each(['readiness','database','registry'])('%s failure stays unavailable through the actual reader, dashboard and classifier',async(kind)=>{
 jest.spyOn(console,'error').mockImplementation(()=>{});
 const fail=async()=>{throw Error('synthetic read failure')};
 const extra=kind==='readiness'?{schemaReady:()=>false}:kind==='database'?{listLatestCollections:fail}:{findDocumentsByCycle:fail};
 const result=await dashboard(reads(extra));
 expect(classifications(result)).toEqual(['unavailable','unavailable']);
 expect(result.proposals.every(p=>p.materials===null)).toBe(true);
});
test('a later malformed row resets partial results for legacy consumers and marks every dashboard row unavailable',async()=>{
 jest.spyOn(console,'error').mockImplementation(()=>{});
 const deps=reads({listLatestCollections:async()=>[row(),row(B,{due_at:'invalid'})]});
 const legacy=await getMaterialsSummaryByRequests({requestIds:[A,B],requestNumbers:new Map(),cycleCode:'D26'},deps);
 expect([...legacy.values()]).toEqual([null,null]);
 expect(classifications(await dashboard(deps))).toEqual(['unavailable','unavailable']);
});
test('waiving the only required item produces Check files, not Ready, without fictitious received files',async()=>{
 const result=await dashboard(reads({listLatestCollections:async()=>[row(A,{checklist:[{key:'presentation_pdf',required:true,waived:true}]})]}));
 expect(result.proposals[0].materials).toMatchObject({state:'received',requiredCount:0,receivedCount:0});
 expect(classifications(result)[0]).toBe('check_files');
});

 test.each([null, {}, {summaries:new Map(),availability:new Map()}])('malformed or incomplete reader result stays unavailable: %p',async(value)=>{
 const result=await dashboard(reads(),async()=>value);
 expect(classifications(result)).toEqual(['unavailable','unavailable']);
});
