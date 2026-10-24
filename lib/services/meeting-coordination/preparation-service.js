/** Durable preparation entry points. No provider call or file publication runs inside the staff POST. */
import { canonicalJson } from '../../utils/canonical-json.js';
import crypto from 'node:crypto';
import { isGuid } from '../../utils/guid.js';
import { ServiceHttpError } from '../service-http-error.js';
import { requireMeetingTranscriptionEnabled, isMeetingTranscriptionRequestAllowed } from '../meeting-tracker-transcription/policy.js';
import { loadMeetingTranscriptionBinding } from '../meeting-tracker-transcription/binding.js';
import { getMeetingTranscriptionOverview, getMeetingCorrectionDraft } from '../meeting-tracker-transcription/service.js';
import { eligibleStaff } from '../board-writeups/config.js';
import { listAppKeysForUser } from '../app-access-service.js';
import * as documents from '../../dataverse/adapters/request-document.js';
import { projectPostPresentationMaterials } from '../post-presentation-materials/material-model.js';
import { pickSlidesRow } from '../post-presentation-materials/summary-slides-identity.js';
import { readPresentationVisibility } from '../post-presentation-materials/edition-store.js';
import { requireCoordinatorAccess, resolveCoordinatorAccess } from './coordinator-access.js';
import { preparationStore } from './preparation-store.js';
import { findCopiedZoomVideoCopyForDocument } from '../meeting-tracker-recordings/presentation-video-split-store.js';
const CODE='preparation_not_available';
export const failPreparation=(code,message,status=409)=>{throw new ServiceHttpError(message,{httpStatus:status,code});};
export function requirePreparationEnabled(requestId) {
 requireMeetingTranscriptionEnabled(requestId);
 if(!isMeetingTranscriptionRequestAllowed(requestId,process.env.MEETING_MATERIAL_PREPARATION_ACCESS))failPreparation(CODE,'Durable preparation is not available for this request.',503);
}
export async function authorizePreparer({profileId,actingUserSystemId}) {
 const staff=await eligibleStaff(actingUserSystemId,{app:false});
 if(staff.profileId!==profileId||(!staff.isSuperuser&&!(await listAppKeysForUser(profileId,{throwOnError:true})).includes('meeting-tracker')))failPreparation('preparation_access_required','Meeting Tracker staff access is required.',403);
 return staff;
}
export const PREPARATION_DEPENDENCIES={store:preparationStore,authorize:authorizePreparer,binding:loadMeetingTranscriptionBinding,
 overview:getMeetingTranscriptionOverview,correction:getMeetingCorrectionDraft,visibility:readPresentationVisibility,
 documents:id=>documents.findByRequest(id,{includeMeetingTranscriptBundle:true}),recordingCopy:findCopiedZoomVideoCopyForDocument,requireCoordinator:requireCoordinatorAccess};
export async function preparationInputFiles(requestId,d) {
 const result=await d.documents(requestId);
 if(result?.capped)failPreparation('preparation_documents_incomplete','The complete material set could not be checked.',503);
 const winners=projectPostPresentationMaterials(result?.records||[],requestId).winners;
 const recording=winners.find(row=>Number(row.wmkf_artifacttype)===100000005);
 const slides=pickSlidesRow(result?.records||[],requestId);
 const copy=recording?await d.recordingCopy({requestId,requestDocumentId:recording.wmkf_requestdocumentid}):null;
 return {recordingId:recording?.wmkf_requestdocumentid||null,recordingIdentity:recording?{driveId:recording.wmkf_sharepointdriveid||null,itemId:recording.wmkf_sharepointitemid||null,
  size:Number(recording.wmkf_filesize)||null,copyId:copy?.id||null,quickXorHash:copy?.sharepoint_quickxor_hash||null}:null,
  slidesId:slides?.wmkf_requestdocumentid||null,slidesHash:slides?.wmkf_contenthash||null};
}
export function preparationDto(row) {
 if(!row)return null;
 return {id:row.id,version:Number(row.version),createdAt:row.created_at,updatedAt:row.updated_at,
  sourceArtifactId:row.source_artifact_id,steps:row.steps.map(s=>({id:s.id,kind:s.kind,state:s.state,version:Number(s.version),
   output:s.output,failureCode:s.failure_code||null,updatedAt:s.updated_at}))};
}
export async function startPreparation({requestId,profileId,actingUserSystemId,body},d=PREPARATION_DEPENDENCIES) {
 requirePreparationEnabled(requestId);await d.authorize({profileId,actingUserSystemId});
 const binding=await d.binding(requestId);
 if(!await d.visibility(requestId))failPreparation('preparation_enrollment_required','Set up presentation approval before preparing new materials.');
 const source=body.source;
 if(source.kind==='correction'){
  const draft=await d.correction({requestId,operationId:source.operationId,ownerProfileId:profileId});
  if(Number(draft.correction?.version)!==source.expectedVersion)failPreparation('preparation_source_changed','The saved review changed. Refresh before preparing.');
 }else{
  const overview=await d.overview({requestId,ownerProfileId:profileId});const current=overview.currentArtifact;
  if(current?.id!==source.artifactId||current?.fingerprint!==source.fingerprint||!current?.presentationEnd)failPreparation('preparation_source_changed','Save and confirm the presentation ending before preparing.');
 }
 const files=await preparationInputFiles(requestId,d);
 const input={source,files};const fingerprint=crypto.createHash('sha256').update(canonicalJson(input)).digest('hex');
 return {preparation:preparationDto(await d.store.create({requestId,siteVisitId:binding.siteVisitActivityId,fingerprint,input,profileId,actingUserSystemId}))};
}
export async function getPreparation({requestId,profileId,actingUserSystemId},d=PREPARATION_DEPENDENCIES) {
 requirePreparationEnabled(requestId);await d.binding(requestId);
 return {preparation:preparationDto(await d.store.latest(requestId)),canRecoverUnknown:await resolveCoordinatorAccess({profileId,actingUserSystemId}).catch(()=>false)};
}
export async function retryPreparation({requestId,profileId,actingUserSystemId,body},d=PREPARATION_DEPENDENCIES) {
 requirePreparationEnabled(requestId);await d.authorize({profileId,actingUserSystemId});
 const parent=await d.store.read(body.preparationId,requestId);
 if(!parent)failPreparation('preparation_not_found','Preparation not found.',404);
 const step=parent.steps.find(s=>s.id===body.stepId);
 if(!step)failPreparation('preparation_not_found','Preparation step not found.',404);
 const unknown=step.state==='unknown'||body.acknowledgePotentialDuplicateCharge===true;
 if(unknown)await d.requireCoordinator({profileId,actingUserSystemId});
 const binding=await d.binding(requestId,unknown?null:parent.site_visit_id);
 // Retire uncertainty even if the visit changed, but never run the old visit's inputs again.
 const resume=!unknown||binding.siteVisitActivityId.toLowerCase()===parent.site_visit_id.toLowerCase();
 await d.store.retry({requestId,preparationId:parent.id,stepId:step.id,expectedVersion:body.expectedVersion,profileId,actingUserSystemId,resume,
  acknowledgePotentialDuplicateCharge:body.acknowledgePotentialDuplicateCharge,replaceDraft:body.replaceDraft||null});
 return {preparation:preparationDto(await d.store.read(parent.id,requestId))};
}
export function validPreparationBody(body) {
 if(!body||typeof body!=='object'||Array.isArray(body))return false;
 const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...keys].sort().join(',');
 const version=v=>Number.isSafeInteger(v)&&v>0;
 if(body.action==='start')return exact(body,['action','source'])&&(body.source?.kind==='published'
  ?exact(body.source,['kind','artifactId','fingerprint'])&&isGuid(body.source.artifactId)&&typeof body.source.fingerprint==='string'&&/^[a-f0-9]{64}$/.test(body.source.fingerprint)
  :body.source?.kind==='correction'&&exact(body.source,['kind','operationId','expectedVersion'])&&isGuid(body.source.operationId)&&version(body.source.expectedVersion));
 if(body.action!=='retry'||Object.keys(body).some(k=>!['action','preparationId','stepId','expectedVersion','acknowledgePotentialDuplicateCharge','replaceDraft'].includes(k)))return false;
 return isGuid(body.preparationId)&&isGuid(body.stepId)&&version(body.expectedVersion)
  &&(body.acknowledgePotentialDuplicateCharge===undefined||body.acknowledgePotentialDuplicateCharge===true)
  &&(body.replaceDraft===undefined||exact(body.replaceDraft,['draftId','expectedVersion'])&&isGuid(body.replaceDraft.draftId)&&version(body.replaceDraft.expectedVersion));
}
