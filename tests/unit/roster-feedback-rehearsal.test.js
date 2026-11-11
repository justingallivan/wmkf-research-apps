/** @jest-environment node */
jest.mock('../../lib/services/expertise-finder/roster-sql.cjs',()=>({sql:{query:jest.fn()},db:{connect:jest.fn()}}));
jest.mock('../../lib/services/expertise-finder/roster-rehearsal-target.cjs',()=>({enabled:()=>true,assertTarget:jest.fn()}));
jest.mock('../../lib/services/expertise-finder/roster-consumer-service.js',()=>({eligibleRoster:jest.fn(),assertEligibleConsultant:jest.fn(),hydrateFeedbackAuthors:jest.fn()}));
import {sql,db} from '../../lib/services/expertise-finder/roster-sql.cjs';
import {assertEligibleConsultant,hydrateFeedbackAuthors} from '../../lib/services/expertise-finder/roster-consumer-service';
import {writeFeedbackEntry,updateFeedbackEntry} from '../../lib/services/consultant-feedback-service';
const requestId='11111111-1111-4111-8111-111111111111',mutationId='22222222-2222-4222-8222-222222222222';
const args={requestId,mutationId,actorProfileId:1,consultantRosterId:5,bodyHtml:'<p>Feedback</p>',receivedOn:'2026-11-10'};
let client,row;
beforeEach(()=>{jest.clearAllMocks();row={id:1,status:'active',consultant_roster_id:5,one_off_name:null,one_off_affiliation:null,body_html:'<p>Feedback</p>',received_on:'2026-11-10',shared:true,requestdocument_id:null,updated_at:'now'};sql.query.mockResolvedValue({rows:[]});client={query:jest.fn(async q=>({rows:q.includes('SELECT cf.id')||q.includes('FOR UPDATE')||q.startsWith('UPDATE consultant_feedback')?[row]:[]})),release:jest.fn()};db.connect.mockResolvedValue(client);assertEligibleConsultant.mockResolvedValue();hydrateFeedbackAuthors.mockImplementation(async rows=>rows.map(r=>({...r,roster_name:'Unavailable consultant',roster_identity_unavailable:true})));});
test('retired-author create replay returns before eligibility or new transaction',async()=>{sql.query.mockResolvedValue({rows:[row]});assertEligibleConsultant.mockRejectedValue(Error('retired'));const r=await writeFeedbackEntry(args);expect(r.consultant.name).toBe('Unavailable consultant');expect(assertEligibleConsultant).not.toHaveBeenCalled();expect(db.connect).not.toHaveBeenCalled();});
test('remote eligibility occurs before BEGIN and post-commit hydration is successful with warning',async()=>{assertEligibleConsultant.mockImplementation(async()=>expect(db.connect).not.toHaveBeenCalled());const r=await writeFeedbackEntry(args);expect(r.warning).toBeTruthy();expect(client.query).toHaveBeenCalledWith('COMMIT');expect(client.query).not.toHaveBeenCalledWith('ROLLBACK');expect(client.query.mock.calls.some(([q])=>q.includes('JOIN expertise_roster'))).toBe(false);});
test('winner arriving during eligibility failure is returned',async()=>{sql.query.mockResolvedValueOnce({rows:[]}).mockResolvedValueOnce({rows:[row]});assertEligibleConsultant.mockRejectedValue(Error('retired'));expect((await writeFeedbackEntry(args)).id).toBe('1');expect(db.connect).not.toHaveBeenCalled();});
test('attachment replay refuses a different bound document',async()=>{sql.query.mockResolvedValue({rows:[{...row,requestdocument_id:mutationId}]});await expect(writeFeedbackEntry({...args,requestdocumentId:requestId})).rejects.toMatchObject({httpStatus:409});expect(db.connect).not.toHaveBeenCalled();});
test('unchanged retired author edit skips eligibility',async()=>{sql.query.mockResolvedValue({rows:[row]});await updateFeedbackEntry({id:1,requestId,actorProfileId:1,patch:{consultantRosterId:5,bodyHtml:'<p>Edit</p>'}});expect(assertEligibleConsultant).not.toHaveBeenCalled();expect(client.query).toHaveBeenCalledWith('COMMIT');});
test('changed author is validated outside lock, concurrent author change refuses',async()=>{sql.query.mockResolvedValue({rows:[row]});client.query.mockImplementation(async q=>({rows:q.includes('FOR UPDATE')?[{...row,consultant_roster_id:7}]:[]}));assertEligibleConsultant.mockImplementation(async()=>expect(db.connect).not.toHaveBeenCalled());await expect(updateFeedbackEntry({id:1,requestId,actorProfileId:1,patch:{consultantRosterId:6}})).rejects.toMatchObject({httpStatus:409,body:{reason:'feedback_author_changed_retry'}});expect(client.query).toHaveBeenCalledWith('ROLLBACK');expect(client.query.mock.calls.some(([q])=>q.startsWith('UPDATE consultant_feedback'))).toBe(false);});
test('concurrent mutation winner with different attachment rolls back',async()=>{client.query.mockImplementation(async q=>({rows:q.includes('SELECT cf.id')?[{...row,requestdocument_id:mutationId}]:[]}));await expect(writeFeedbackEntry({...args,requestdocumentId:requestId})).rejects.toMatchObject({httpStatus:409,body:{reason:'attachment_conflict'}});expect(client.query).toHaveBeenCalledWith('ROLLBACK');expect(client.query).not.toHaveBeenCalledWith('COMMIT');});
test('same attachment UUID in different case is a replay',async()=>{const doc='abcdefab-abcd-4abc-8abc-abcdefabcdef';sql.query.mockResolvedValue({rows:[{...row,requestdocument_id:doc}]});expect((await writeFeedbackEntry({...args,requestdocumentId:doc.toUpperCase()})).id).toBe('1');expect(assertEligibleConsultant).not.toHaveBeenCalled();});

test('three concurrent commits release pool slots before author hydration',async()=>{
 let held=0,committed=0,openBarrier;
 const barrier=new Promise(resolve=>{openBarrier=resolve;});
 const clients=[];
 db.connect.mockImplementation(async()=>{
  held++;
  const c={query:jest.fn(async q=>{
   if(q==='COMMIT'){if(++committed===3)openBarrier();await barrier;}
   return {rows:q.includes('SELECT cf.id')?[row]:[]};
  }),release:jest.fn(()=>{held--;})};clients.push(c);return c;
 });
 hydrateFeedbackAuthors.mockImplementation(async rows=>{
  if(held>=3)throw Error('No pool slot available for hydration');
  return rows.map(r=>({...r,roster_name:'Canonical author'}));
 });
 const results=await Promise.all([1,2,3].map(()=>writeFeedbackEntry(args)));
 expect(results.map(r=>r.consultant.name)).toEqual(['Canonical author','Canonical author','Canonical author']);
 expect(held).toBe(0);for(const c of clients)expect(c.release).toHaveBeenCalledTimes(1);
});
test('update releases its transaction connection before hydration',async()=>{
 hydrateFeedbackAuthors.mockImplementation(async rows=>{expect(client.release).toHaveBeenCalledTimes(1);return rows;});
 await updateFeedbackEntry({id:1,requestId,actorProfileId:1,patch:{bodyHtml:'<p>Updated</p>'}});
 expect(client.release).toHaveBeenCalledTimes(1);
});
