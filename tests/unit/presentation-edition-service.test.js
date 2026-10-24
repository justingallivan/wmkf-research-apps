/** @jest-environment node */
import crypto from 'node:crypto';
import { currentEditionCandidate, mutatePresentationApproval } from '../../lib/services/post-presentation-materials/edition-service.js';
import { presentationTranscriptGenerationKey, transcriptSummaryBindingFingerprint } from '../../lib/services/post-presentation-materials/presentation-transcript-binding.js';
import { REQUEST_DOCUMENT_ARTIFACT_TYPE as TYPE } from '../../shared/config/requestDocument.js';
import { REQUEST_ID, REVISION, END_MS, transcriptRow, recordingRow, videoRow } from '../helpers/presentation-video-fixtures.js';
const bytes=Buffer.from('verified text');const hash=crypto.createHash('sha256').update(bytes).digest('hex');
const actor={requestId:REQUEST_ID,profileId:7,actingUserSystemId:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'};
function fixture() {
 const identity={requestId:REQUEST_ID,sourceRevisionId:REVISION,presentationEndMs:END_MS};
 const text={...videoRow(),wmkf_requestdocumentid:'77777777-7777-4777-8777-777777777777',wmkf_artifacttype:TYPE.PRESENTATION_TRANSCRIPT,wmkf_sharepointitemid:'text',wmkf_filename:'presentation.txt',wmkf_contenttype:'text/plain',wmkf_filesize:bytes.length,wmkf_contenthash:hash,wmkf_sharepointetag:'e1',wmkf_generationkey:presentationTranscriptGenerationKey(identity)};
 const summary={...text,wmkf_requestdocumentid:'88888888-8888-4888-8888-888888888888',wmkf_artifacttype:TYPE.TRANSCRIPT_SUMMARY,wmkf_sharepointitemid:'summary',wmkf_inputfingerprint:transcriptSummaryBindingFingerprint(identity)};
 const video=videoRow();const rows=[transcriptRow(),recordingRow(),text,summary,video];
 const cut={id:'99999999-9999-4999-8999-999999999999',request_document_id:video.wmkf_requestdocumentid,output_drive_id:'drive',output_item_id:'video-item',output_size:4000,output_quickxor_hash:'qxh'};
 const d={schemaReady:()=>true,requestAllowed:()=>true,getRequest:async()=>({akoya_requestid:REQUEST_ID}),requireCoordinator:jest.fn(async()=>{}),read:async()=>({version:1,active_edition_id:null}),findDocuments:jest.fn(async()=>({records:rows})),getCut:jest.fn(async()=>cut),
  acquire:jest.fn(async()=>({fence_version:1})),renew:jest.fn(async()=>({})),release:jest.fn(async()=>{}),
  download:jest.fn(async()=>({buffer:bytes})),media:jest.fn(async(driveId,itemId)=>({driveId,itemId,size:itemId==='video-item'?4000:bytes.length,eTag:'e1',quickXorHash:'qxh'})),approve:jest.fn(async()=>({version:2,activeEditionId:'approved'}))};
 return d;
}
async function args(d){const candidate=await currentEditionCandidate(REQUEST_ID,d);expect(candidate.ready).toBe(true);return {...actor,body:{action:'approve',expectedVersion:1,commandId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab',candidateFingerprint:candidate.fingerprint,videoReviewed:true,summaryReviewed:true}};}
test('approval holds all source/output slots and verifies both text hashes and video identity before switching visibility',async()=>{
 const d=fixture();const input=await args(d);await mutatePresentationApproval(input,d);
 expect(d.acquire).toHaveBeenCalledTimes(5);expect(d.renew).toHaveBeenCalledTimes(5);expect(d.release).toHaveBeenCalledTimes(5);
 expect(d.download).toHaveBeenCalledTimes(2);expect(d.media).toHaveBeenCalledTimes(3);expect(d.requireCoordinator).toHaveBeenCalledTimes(2);
 expect(d.approve).toHaveBeenCalledWith(expect.objectContaining({requestId:REQUEST_ID,expectedVersion:1,members:expect.any(Array),fingerprint:input.body.candidateFingerprint}));
});
test.each(['changed file','lost lease','changed coordinator','missing slot'])('%s cannot switch visibility or discard an earlier approval',async scenario=>{
 const d=fixture();const input=await args(d);
 if(scenario==='changed file')d.download.mockResolvedValue({buffer:Buffer.from('tampered')});
 if(scenario==='lost lease')d.renew.mockResolvedValue(null);
 if(scenario==='changed coordinator')d.requireCoordinator.mockResolvedValueOnce().mockRejectedValueOnce(new Error('changed coordinator'));
 if(scenario==='missing slot')d.acquire.mockResolvedValueOnce({fence_version:1}).mockResolvedValueOnce(null);
 await expect(mutatePresentationApproval(input,d)).rejects.toThrow();expect(d.approve).not.toHaveBeenCalled();expect(d.release).toHaveBeenCalled();
});
test('stale reviewed fingerprint or missing human checks cannot approve a newer presentation',async()=>{
 const d=fixture();const input=await args(d);input.body.candidateFingerprint='a'.repeat(64);
 await expect(mutatePresentationApproval(input,d)).rejects.toMatchObject({code:'presentation_candidate_changed'});expect(d.approve).not.toHaveBeenCalled();
 input.body.videoReviewed=false;await expect(mutatePresentationApproval(input,d)).rejects.toMatchObject({code:'presentation_review_required'});
});
