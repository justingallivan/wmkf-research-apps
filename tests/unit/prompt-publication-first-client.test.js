/** @jest-environment node */
const {prepare,state,attempt,verifyReadback}=require('../../lib/prompt-publication/first-publication-client');
const {publicationFingerprint}=require('../../lib/prompt-publication/fingerprint');
const proposal=require('../../dataverse/prompt-publication/rehearsal/first-publication-proposal.json');
const clone=v=>JSON.parse(JSON.stringify(v));
const id='10000000-0000-4000-8000-000000000011',uuid='10000000-0000-4000-8000-000000000012';
const actor={organizationId:proposal.organizationId,initiatingUserId:'10000000-0000-4000-8000-000000000013',effectiveUserId:'10000000-0000-4000-8000-000000000013'};
function setup(){
 const row={id,name:proposal.snapshot.definition.name,status:682090000,version:null,isCurrent:false,etag:'W/"12"'};
 const observation={organizationId:proposal.organizationId,complete:true,head:null,rows:[row],draft:{...row,snapshot:clone(proposal.snapshot),metadataBaseline:{schemaVersion:1,current:null,catalog:{title:null,description:null,groupKey:null,sectionKey:null,usedBy:null,usageCategory:null},headRevision:'0'}}};
 const prepared=prepare(observation,actor,uuid);
 const receipt={receiptVersion:1,fingerprintVersion:1,request:clone(prepared.request),actor:clone(actor),requestFingerprint:publicationFingerprint(prepared.request,actor).hash,published:{id,version:1,etag:'W/"13"'},headRevision:'1',publishedAt:'2026-10-30T12:00:00.000Z'};
 const readback={organizationId:proposal.organizationId,promptKey:proposal.snapshot.definition.name,complete:true,rows:[{...row,status:682090001,version:1,isCurrent:true,etag:'W/"13"',snapshot:clone(proposal.snapshot)}],head:{promptId:id,version:1,revision:'1'}};
 let stored=null;
 const port={authorize:jest.fn(async()=>actor),readReceipt:jest.fn(async()=>stored),publish:jest.fn(async()=>{stored=receipt;}),readPublicationState:jest.fn(async()=>readback)};
 return{observation,prepared,receipt,readback,port,setStored:r=>{stored=r;}};
}
test('first publication and independent readback match the saved request',async()=>{
 const s=setup();const result=await attempt(s.prepared,s.port);
 expect(result.status).toBe('publication-and-readback-verified');expect(s.port.publish).toHaveBeenCalledTimes(1);expect(s.port.publish).toHaveBeenCalledWith(s.prepared.request);
 expect(s.prepared.request.snapshotHash).toBe(proposal.snapshotHash);
 const again=await attempt(s.prepared,s.port);expect(again.receipt).toEqual(result.receipt);expect(s.port.publish).toHaveBeenCalledTimes(1);
});
test('lost response recovers the committed receipt without a second POST',async()=>{
 const s=setup();s.port.publish.mockImplementation(async()=>{s.setStored(s.receipt);throw Error('timeout');});
 expect((await attempt(s.prepared,s.port)).status).toBe('publication-and-readback-verified');expect(s.port.publish).toHaveBeenCalledTimes(1);
});
test('unavailable receipt before POST preserves state and makes no write',async()=>{
 const s=setup();s.port.readReceipt.mockRejectedValue(Error('outage'));const r=await attempt(s.prepared,s.port);
 expect(r.status).toBe('unknown');expect(r.state).toEqual(s.prepared);expect(s.port.publish).not.toHaveBeenCalled();
});
test('unknown POST never replaces UUID or automatically retries',async()=>{
 const s=setup();s.port.publish.mockRejectedValue(Error('unknown'));const r=await attempt(s.prepared,s.port);
 expect(r.status).toBe('unknown');expect(r.state.request.requestId).toBe(uuid);expect(s.port.publish).toHaveBeenCalledTimes(1);
 const recover=await attempt(r.state,s.port,{recoverOnly:true});expect(recover.status).toBe('unknown');expect(s.port.publish).toHaveBeenCalledTimes(1);
});
test('changed actor denies before receipt reads or POST',async()=>{
 const s=setup();s.port.authorize.mockResolvedValue({...actor,effectiveUserId:'10000000-0000-4000-8000-000000000099'});
 await expect(attempt(s.prepared,s.port)).rejects.toThrow('actor_changed');expect(s.port.readReceipt).not.toHaveBeenCalled();expect(s.port.publish).not.toHaveBeenCalled();
});
test('successful historical receipt replay does not run fresh installed-policy validation',async()=>{
 const s=setup(),old=clone(s.prepared);old.request.policyRevision=1;old.request.policyArtifactHash='a'.repeat(64);
 const receipt={...s.receipt,request:old.request,requestFingerprint:publicationFingerprint(old.request,actor).hash};s.setStored(receipt);
 expect((await attempt(old,s.port)).status).toBe('publication-and-readback-verified');expect(s.port.publish).not.toHaveBeenCalled();
});
test('receipt UUID collision rejects instead of accepting unrelated success',async()=>{
 const s=setup(),wrong=clone(s.receipt);wrong.request.snapshotHash='0'.repeat(64);s.setStored(wrong);
 await expect(attempt(s.prepared,s.port)).rejects.toThrow('receipt_binding_mismatch');expect(s.port.publish).not.toHaveBeenCalled();
});
test.each(['duplicate','head','content','current','paging','organization'])('receipt stays confirmed but bad readback is not success: %s',async kind=>{
 const s=setup();s.setStored(s.receipt);
 if(kind==='duplicate')s.readback.rows.push(clone(s.readback.rows[0]));
 if(kind==='head')s.readback.head.version=2;
 if(kind==='content')s.readback.rows[0].snapshot.definition.body='changed';
 if(kind==='current')s.readback.rows[0].isCurrent=false;
 if(kind==='paging')s.readback.complete=false;
 if(kind==='organization')s.readback.organizationId='different';
 const r=await attempt(s.prepared,s.port);expect(r.status).toBe('receipt-confirmed-readback-unverified');expect(r.receipt).toEqual(s.receipt);expect(s.port.publish).not.toHaveBeenCalled();
});
test('actual draft identity, empty baseline and current-null observation required',()=>{
 const s=setup();s.observation.draft.id='invented';expect(()=>prepare(s.observation,actor,uuid)).toThrow('draft_required');
 const b=setup();b.observation.draft.metadataBaseline.catalog.title='stale';expect(()=>prepare(b.observation,actor,uuid)).toThrow('baseline_mismatch');
 const c=setup();c.observation.draft.snapshot.catalog.title=null;expect(()=>prepare(c.observation,actor,uuid)).toThrow('invalid_fresh');
});
test('prepared state is detached/frozen; readback verifier rejects another key',()=>{
 const s=setup();expect(Object.isFrozen(state(s.prepared).request)).toBe(true);s.observation.draft.snapshot.definition.body='later edit';expect(s.prepared.request.snapshotHash).toBe(proposal.snapshotHash);
 const wrong=clone(s.receipt);wrong.request.promptKey='other.key';expect(()=>verifyReadback(wrong,s.readback)).toThrow();
});


test('trusted explicit server rejection is reported after same-UUID receipt lookup',async()=>{
 const s=setup();s.port.publish.mockRejectedValue(Object.assign(Error('sensitive-error-text'),{definitiveRejection:true,code:'publication_disabled'}));
 const result=await attempt(s.prepared,s.port);expect(result.status).toBe('rejected');expect(result.reason).toBe('publication_disabled');expect(result.postAttempted).toBe(true);expect(JSON.stringify(result)).not.toContain('sensitive-error-text');expect(s.port.publish).toHaveBeenCalledTimes(1);
});
test('unrecognized rejection code stays unknown; raw errors are not returned',async()=>{
 const s=setup();s.port.publish.mockRejectedValue(Object.assign(Error('sensitive-error-text'),{definitiveRejection:true,code:'unclassified_code'}));
 const result=await attempt(s.prepared,s.port);expect(result.status).toBe('unknown');expect(result.postAttempted).toBe(true);expect(JSON.stringify(result)).not.toContain('sensitive-error-text');
});
test('receipt wins over rejection classification when an identical request already committed',async()=>{
 const s=setup();s.port.publish.mockImplementation(async()=>{s.setStored(s.receipt);throw Object.assign(Error('race'),{definitiveRejection:true,code:'publication_conflict'});});
 expect((await attempt(s.prepared,s.port)).status).toBe('publication-and-readback-verified');
});
