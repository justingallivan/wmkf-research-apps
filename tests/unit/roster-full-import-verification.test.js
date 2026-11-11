/** @jest-environment node */
const {verify}=require('../../scripts/verify-roster-full-import.cjs');
const {planImport}=require('../../scripts/lib/expertise-roster-import-plan.cjs');
function fixture(){
 const source=structuredClone(require('../fixtures/expertise-roster/source.json'));source.sequenceHighWater=2;
 source.rows.push({...source.rows[0],id:2,name:'Synthetic excluded'});
 const mapping=structuredClone(require('../fixtures/expertise-roster/mapping.json'));
 mapping.rows.push({...mapping.rows[0],legacyId:2,active:false,exclude:true});
 const row={...source.rows[0],name:'Synthetic addition'};delete row.id;
 mapping.newProfiles=[{mutationId:'22222222-2222-4222-8222-222222222222',row,decision:{confirmed:true,active:true,leadPdEligible:false,staffUserGuid:null,contactGuid:null}}];
 const before=structuredClone(require('../fixtures/expertise-roster/target.json'));
 const reviewed=planImport(source,before,mapping,[before.targetHost]);
 const included=reviewed.rows.filter(r=>r.action!=='exclude');
 const target={...before,profiles:included.map((r,i)=>({profileGuid:`33333333-3333-4333-8333-33333333333${i}`,values:{...r.values,'@odata.etag':'W/"1"'}}))};
 const receipt={success:true,bridgeCommitted:true,sourceHash:reviewed.sourceHash,mappingHash:reviewed.mappingHash,rows:reviewed.rows.map(r=>({creationKey:r.creationKey,rosterId:r.legacyId??3,status:r.action==='exclude'?'identity-only':'bound',profileGuid:target.profiles.find(p=>p.values.wmkf_creationkey===r.creationKey)?.profileGuid}))};
 const evidence={feedback:[{id:'8',consultant_roster_id:2}]};
 const sql={identities:[{id:1},{id:2},{id:3}],bindings:receipt.rows.filter(r=>r.profileGuid).map(r=>({roster_id:r.rosterId,target_host:before.targetHost,dataverse_profile_guid:r.profileGuid})),roster:structuredClone(source.rows),feedback:[{...evidence.feedback[0],body_html:'Synthetic'}],sequence:{last_value:'3',is_called:true},feedbackSequence:{last_value:'8',is_called:true}};
 return {source,mapping,reviewed,receipt,before,evidence,target,sql};
}
test('verifies excluded identity, new allocation and stable replay',()=>{const input=fixture();const result=verify(input);expect(result.counts).toMatchObject({profiles:2,identities:3,bindings:2,feedback:1});expect(verify({...input,previous:result}).replayStable).toBe(true);});
test.each(['field','binding','identity','source','feedback','sequence','receipt','etag','extra'])('rejects %s corruption',kind=>{const x=fixture();
 if(kind==='field')x.target.profiles[0].values.wmkf_role='Changed';
 if(kind==='binding')x.sql.bindings[0].roster_id=2;
 if(kind==='identity')x.sql.identities.pop();
 if(kind==='source')x.sql.roster[0].name='Changed';
 if(kind==='feedback')x.sql.feedback[0].consultant_roster_id=1;
 if(kind==='sequence')x.sql.sequence.last_value='4';
 if(kind==='receipt')x.receipt.rows[2].rosterId=4;
 if(kind==='etag')delete x.target.profiles[0].values['@odata.etag'];
 if(kind==='extra')x.target.profiles.push({...x.target.profiles[0]});
 expect(()=>verify(x)).toThrow();
});
test('rejects replay ETag or feedback-body changes even with valid fields',()=>{const x=fixture(),previous=verify(x);x.target.profiles[0].values['@odata.etag']='W/"2"';expect(()=>verify({...x,previous})).toThrow('Replay');x.target.profiles[0].values['@odata.etag']='W/"1"';x.sql.feedback[0].body_html='Changed';expect(()=>verify({...x,previous})).toThrow('Replay');});
test('checks preexisting target values and etag',()=>{const x=fixture();const prior={profileGuid:'44444444-4444-4444-8444-444444444444',values:{...x.target.profiles[0].values,wmkf_name:'Prior synthetic',wmkf_creationkey:'app_44444444-4444-4444-8444-444444444444'}};x.before.profiles.push(structuredClone(prior));x.target.profiles.push(prior);expect(verify(x).success).toBe(true);prior.values['@odata.etag']='W/"2"';expect(()=>verify(x)).toThrow('Preexisting');});
