import { createMachineTitleSource } from '../../lib/services/prompt-jobs/machine-title-source.js';
import { buildMachineTitleDefinition } from '../../lib/services/prompt-jobs/machine-title-contract.js';
jest.mock('../../lib/dataverse/adapters/grant-request.js',()=>({getById:jest.fn()}));
const requestId = '10000000-0000-4000-8000-000000000001';
const scope = {requestId,environment:'test-sandbox',authorizationScope:`pa-short-title:${requestId}`};
const row = ()=>({akoya_title:'  A source title  ',wmkf_abstract:'A sufficiently long original abstract with meaningful source material.',wmkf_phaseistatus:null,_etag:'W/"1"'});
function setup() { const value = row(); const readRequest = jest.fn(async()=>value); return {value,readRequest,source:createMachineTitleSource({readRequest})}; }
it('preserves original text in sealed records and retains only source hashes in manifest',async()=>{
  const {source,value,readRequest} = setup(); const manifest = await source.inspect({requestId});
  expect(Object.keys(manifest).sort()).toEqual(['hash','requestId','version']);
  expect(JSON.stringify(manifest)).not.toContain(value.akoya_title);
  const snapshot = await source.prepare({manifest,scope,profile:buildMachineTitleDefinition().profile,nonceSecret:'test-only-nonce-secret-32-characters'});
  expect(snapshot.documents).toEqual([]); expect(snapshot.records[0].value).toBe(value.akoya_title);
  expect(readRequest).toHaveBeenCalledWith(requestId,{select:'akoya_title,wmkf_abstract,wmkf_phaseistatus'});
});
it.each([
  {akoya_title:null},{akoya_title:'  '},{akoya_title:'x'.repeat(601)},
  {wmkf_abstract:null},{wmkf_abstract:'short'},{wmkf_abstract:'x'.repeat(20001)},
  {wmkf_abstract:'\u0000'.repeat(20000)},{wmkf_phaseistatus:100000003},{wmkf_phaseistatus:undefined},
  {_etag:'*'},{_etag:undefined},
])('rejects invalid/invited source before admission: %j',async change=>{
  const {source,value} = setup(); Object.assign(value,change);
  await expect(source.inspect({requestId})).rejects.toMatchObject({httpStatus:422});
});
it('checks exact text and original ETag, and rejects changed preparation',async()=>{
  const {source,value} = setup(); const manifest = await source.inspect({requestId});
  expect(await source.isCurrent({manifest,expectedEtag:'W/"1"'})).toBe(true);
  value._etag='W/"2"'; expect(await source.isCurrent({manifest,expectedEtag:'W/"1"'})).toBe(false);
  expect(await source.isCurrent({manifest})).toBe(true);
  value.akoya_title+=' changed'; expect(await source.isCurrent({manifest})).toBe(false);
  await expect(source.prepare({manifest,scope,profile:buildMachineTitleDefinition().profile,nonceSecret:'test-only-nonce-secret-32-characters'})).rejects.toMatchObject({code:'proposal_source_changed'});
});
it('distinguishes unavailable reads from invalid source',async()=>{
  const source=createMachineTitleSource({readRequest:async()=>{throw new Error('private');}});
  await expect(source.inspect({requestId})).rejects.toMatchObject({httpStatus:503,message:'machine_source_unavailable'});
});
