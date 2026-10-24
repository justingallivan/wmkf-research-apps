/** @jest-environment node */
import { REQUEST_DOCUMENT_ARTIFACT_TYPE as TYPE, REQUEST_DOCUMENT_OPERATION_STATUS as STATUS, REQUEST_DOCUMENT_LIFECYCLE_STATE as LIFE } from '../../shared/config/requestDocument.js';
import { freezeEditionMember, approvedEditionRows, editionMemberBytesMatch, validateEditionMembers } from '../../lib/services/post-presentation-materials/edition-model.js';
import { externalPresentationRows, requireUnchangedPresentationPolicy } from '../../lib/services/post-presentation-materials/edition-reader.js';
import { resolveCoordinatorAccess } from '../../lib/services/meeting-coordination/coordinator-access.js';
import { resolvePresentationMember } from '../../lib/services/post-presentation-materials/presentation-page-service.js';
import { resolveBriefingMediaMember } from '../../lib/services/deliberation-briefing/briefing-page-service.js';
import { mutatePresentationApproval, getPresentationApproval } from '../../lib/services/post-presentation-materials/edition-service.js';
const requestId='11111111-1111-4111-8111-111111111111', actor='22222222-2222-4222-8222-222222222222', editionId='33333333-3333-4333-8333-333333333333';
const types=[TYPE.PRESENTATION_TRANSCRIPT,TYPE.TRANSCRIPT_SUMMARY,TYPE.PRESENTATION_VIDEO];
const rows=types.map((type,i)=>({wmkf_requestdocumentid:`aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa${i}`,_wmkf_request_value:requestId,wmkf_artifacttype:type,wmkf_producer:'meeting-tracker-post-presentation',wmkf_operationstatus:STATUS.READY,wmkf_lifecyclestate:LIFE.SUPERSEDED,wmkf_sharepointdriveid:'drive',wmkf_sharepointitemid:`item${i}`,wmkf_sharepointetag:'e1',wmkf_filename:type===TYPE.PRESENTATION_VIDEO?'cut.mp4':'file.txt',wmkf_contenttype:type===TYPE.PRESENTATION_VIDEO?'video/mp4':'text/plain',wmkf_filesize:10,wmkf_contenthash:'a'.repeat(64)}));
const cut={id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',request_document_id:rows[2].wmkf_requestdocumentid,output_drive_id:'drive',output_item_id:'item2',output_size:10,output_quickxor_hash:'video-hash'};
const members=rows.map((r,i)=>freezeEditionMember(r,i===2?cut:null));
const visibility={request_id:requestId,version:3,active_edition_id:editionId,edition_id:editionId,edition_request_id:requestId,members};
const actorArgs={requestId,profileId:7,actingUserSystemId:actor};

test('an explicit edition retains its superseded members and excludes present internal material and newer unapproved files',()=>{
 const internal={...rows[0],wmkf_requestdocumentid:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',wmkf_artifacttype:TYPE.STAFF_DISCUSSION_TRANSCRIPT};
 const newer={...rows[2],wmkf_requestdocumentid:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',wmkf_lifecyclestate:LIFE.DRAFT,wmkf_sharepointitemid:'new-video'};
 const selected=approvedEditionRows([...rows,internal,newer],requestId,visibility);
 expect(selected.map(r=>r.wmkf_requestdocumentid)).toEqual(rows.map(r=>r.wmkf_requestdocumentid));
 expect(approvedEditionRows(rows,requestId,{...visibility,active_edition_id:null})).toEqual([]);
 expect(()=>validateEditionMembers([...members.slice(0,2),{...members[2],type:TYPE.RECORDING}])).toThrow();
 expect(()=>approvedEditionRows(rows,actor,visibility)).toThrow();
});
test('video metadata-only edits retain access but actual bytes, request/drive/item and text changes fail closed',()=>{
 const video=members[2];const media={driveId:'drive',itemId:'item2',size:10,quickXorHash:'video-hash',eTag:'new-metadata'};
 expect(editionMemberBytesMatch(video,media)).toBe(true);
 for(const patch of [{quickXorHash:'different'},{size:11},{driveId:'other'},{itemId:'other'},{malware:{}}])expect(editionMemberBytesMatch(video,{...media,...patch})).toBe(false);
 expect(editionMemberBytesMatch(members[0],{...media,itemId:'item0'})).toBe(false);
 expect(approvedEditionRows(rows.map((r,i)=>i===0?{...r,wmkf_contenthash:'b'.repeat(64)}:r),requestId,visibility)).toHaveLength(2);
});
test('enrollment never falls back to legacy selection, and visibility outages cannot look like unenrolled',async()=>{
 const legacy=jest.fn(()=>rows);const d={readPresentationVisibility:jest.fn(async()=>({...visibility,active_edition_id:null}))};
 expect(await externalPresentationRows(rows,requestId,legacy,d)).toEqual([]);expect(legacy).not.toHaveBeenCalled();
 d.readPresentationVisibility.mockRejectedValueOnce(new Error('unavailable'));
 await expect(externalPresentationRows(rows,requestId,legacy,d)).rejects.toMatchObject({httpStatus:503});expect(legacy).not.toHaveBeenCalled();
 d.readPresentationVisibility.mockResolvedValue(null);
 expect(await externalPresentationRows(rows,requestId,legacy,d)).toHaveLength(3);expect(legacy).toHaveBeenCalledTimes(1);
});
test('withdrawal/enrollment during a Graph read blocks a late redirect',async()=>{
 const d={readPresentationVisibility:jest.fn(async()=>visibility)};
 const [row]=await externalPresentationRows(rows,requestId,()=>[],d);
 d.readPresentationVisibility.mockResolvedValue({...visibility,version:4,active_edition_id:null});
 await expect(requireUnchangedPresentationPolicy(row,requestId,d)).rejects.toMatchObject({httpStatus:404});
 d.readPresentationVisibility.mockResolvedValue(null);const [legacy]=await externalPresentationRows(rows,requestId,()=>rows,d);
 d.readPresentationVisibility.mockResolvedValue(visibility);await expect(requireUnchangedPresentationPolicy(legacy,requestId,d)).rejects.toMatchObject({httpStatus:404});
});
test('only the shared assigned coordinator with matching active linked profile is authorized',async()=>{
 const d={getRole:jest.fn(async()=>({value:{systemUserId:actor}})),eligibleStaff:jest.fn(async()=>({profileId:7}))};
 expect(await resolveCoordinatorAccess(actorArgs,d)).toBe(true);expect(d.eligibleStaff).toHaveBeenCalledWith(actor,{app:false});
 expect(await resolveCoordinatorAccess({...actorArgs,profileId:8},d)).toBe(false);
 expect(await resolveCoordinatorAccess({...actorArgs,actingUserSystemId:editionId},d)).toBe(false);
 d.getRole.mockResolvedValue({value:null});expect(await resolveCoordinatorAccess(actorArgs,d)).toBe(false);
 d.getRole.mockRejectedValue(new Error('configuration unavailable'));await expect(resolveCoordinatorAccess(actorArgs,d)).rejects.toThrow();
});
test('withdrawal does not need a currently preparable draft, but needs the coordinator and exact prior edition/version',async()=>{
 const d={schemaReady:()=>true,requestAllowed:()=>true,getRequest:async()=>({akoya_requestid:requestId}),requireCoordinator:jest.fn(async()=>{}),read:async()=>visibility,withdraw:jest.fn(async()=>({version:4,activeEditionId:null})),findDocuments:jest.fn()};
 await mutatePresentationApproval({...actorArgs,body:{action:'withdraw',expectedVersion:3,expectedEditionId:editionId}},d);
 expect(d.withdraw).toHaveBeenCalledWith({requestId,profileId:7,expectedVersion:3,expectedEditionId:editionId});expect(d.findDocuments).not.toHaveBeenCalled();
 await expect(mutatePresentationApproval({...actorArgs,body:{action:'withdraw',expectedVersion:2,expectedEditionId:editionId}},d)).rejects.toMatchObject({httpStatus:409});
 d.requireCoordinator.mockRejectedValue(Object.assign(new Error('coordinator required'),{httpStatus:403}));
 await expect(mutatePresentationApproval({...actorArgs,body:{action:'withdraw',expectedVersion:3,expectedEditionId:editionId}},d)).rejects.toMatchObject({httpStatus:403});
});
test('GET keeps withdrawal status available when candidate sources cannot be loaded',async()=>{
 const d={schemaReady:()=>true,requestAllowed:()=>true,getRequest:async()=>({akoya_requestid:requestId}),read:async()=>visibility,canCoordinate:async()=>true,findDocuments:async()=>{throw new Error('source unavailable');}};
 const result=await getPresentationApproval(actorArgs,d);expect(result.activeEditionId).toBe(editionId);expect(result.canApprove).toBe(true);expect(result.candidate.ready).toBe(false);
});

test('both Board readers serve the retained approved video after a replacement supersedes its split and source',async()=>{
 const newer={...rows[2],wmkf_requestdocumentid:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',wmkf_sharepointitemid:'unapproved-replacement',wmkf_lifecyclestate:LIFE.DRAFT};
 const internal={...rows[0],wmkf_requestdocumentid:'ffffffff-ffff-4fff-8fff-ffffffffffff',wmkf_artifacttype:TYPE.STAFF_DISCUSSION_SUMMARY};
 const d={getRequest:async()=>({akoya_requestid:requestId,akoya_requestnum:'123456'}),findDocuments:async()=>({records:[...rows,newer,internal]}),readPresentationVisibility:async()=>visibility,presentationSchemaReady:()=>true,presentationRequestAllowed:()=>true,resolveMediaDownloadUrl:async(driveId,itemId)=>({driveId,itemId,size:10,quickXorHash:'video-hash',eTag:'metadata-changed',mimeType:'video/mp4',filename:'cut.mp4',downloadUrl:'https://example.org/verified-download'}),getApprovedVideoCut:jest.fn(()=>{throw new Error('mutable split lookup must not run');})};
 for(const resolver of [resolvePresentationMember,resolveBriefingMediaMember]){
   await expect(resolver({requestId,member:`material:${rows[2].wmkf_requestdocumentid}`,mode:'watch'},d)).resolves.toMatchObject({redirectUrl:'https://example.org/verified-download'});
   await expect(resolver({requestId,member:`material:${newer.wmkf_requestdocumentid}`,mode:'watch'},d)).rejects.toMatchObject({httpStatus:404});
   await expect(resolver({requestId,member:`material:${internal.wmkf_requestdocumentid}`,mode:'open'},d)).rejects.toMatchObject({httpStatus:404});
   await expect(resolver({requestId,member:`material:${rows[2].wmkf_requestdocumentid}`,mode:'watch'},{...d,readPresentationVisibility:async()=>({...visibility,active_edition_id:null})})).rejects.toMatchObject({httpStatus:404});
 }
 expect(d.getApprovedVideoCut).not.toHaveBeenCalled();
});
