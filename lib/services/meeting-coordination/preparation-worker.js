/** One bounded durable child step per tick. Browser lifetime never owns the job; unknown summaries never auto-repeat. */
import { canonicalJson } from '../../utils/canonical-json.js';
import { preparationStore } from './preparation-store.js';
import { PREPARATION_DEPENDENCIES, requirePreparationEnabled, preparationInputFiles, failPreparation } from './preparation-service.js';
import { parseMeetingTranscriptionAccess } from '../meeting-tracker-transcription/policy.js';
import { publishMeetingCorrection, reconcileMeetingTranscriptPublication, resolveCurrentMeetingTranscriptSource } from '../meeting-tracker-transcription/service.js';
import { generatePresentationTranscript } from '../post-presentation-materials/presentation-transcript-service.js';
import { createSummaryDraft } from '../post-presentation-materials/transcript-summary-service.js';
import { getMeetingTranscriptPublication } from '../transcription-pilot/store.js';
import { startPresentationVideoSplit } from '../meeting-tracker-recordings/presentation-video-split-service.js';
import { listPresentationVideoSplitSnapshotsForRequest, getPresentationVideoSplitForApproval } from '../meeting-tracker-recordings/presentation-video-split-store.js';
const DEFAULTS={...PREPARATION_DEPENDENCIES,store:preparationStore,publish:publishMeetingCorrection,reconcile:reconcileMeetingTranscriptPublication,
 publication:getMeetingTranscriptPublication,generate:generatePresentationTranscript,summary:createSummaryDraft,startVideo:startPresentationVideoSplit,
 resolveSource:resolveCurrentMeetingTranscriptSource,listVideos:listPresentationVideoSplitSnapshotsForRequest,video:getPresentationVideoSplitForApproval};
const same=(a,b)=>String(a||'').toLowerCase()===String(b||'').toLowerCase();
async function currentInputs(row,d,{needsSource=true}={}) {
 requirePreparationEnabled(row.request_id);
 await d.authorize({profileId:row.actor_profile_id,actingUserSystemId:row.acting_user_system_id});
 await d.binding(row.request_id,row.site_visit_id);
 if(!await d.visibility(row.request_id))failPreparation('preparation_enrollment_required','Presentation approval enrollment is required.');
 const files=await preparationInputFiles(row.request_id,d);
 if(canonicalJson(files)!==canonicalJson(row.input.files))failPreparation('preparation_inputs_changed','Recording or slides changed. Start preparation from the new inputs.');
 if(needsSource){
  const {currentArtifact}=await d.overview({requestId:row.request_id,ownerProfileId:row.actor_profile_id});
  if(!same(currentArtifact?.id,row.source_artifact_id)||currentArtifact?.fingerprint!==row.source_fingerprint)failPreparation('preparation_source_changed','The transcript changed. Start preparation from the new review.');
  return currentArtifact;
 }
 return null;
}
async function sourceStep(row,d,args) {
 const source=row.input.source;
 if(source.kind==='published'){
  const {currentArtifact}=await d.overview({requestId:row.request_id,ownerProfileId:row.actor_profile_id});
  if(!same(currentArtifact?.id,source.artifactId)||currentArtifact?.fingerprint!==source.fingerprint||!currentArtifact.presentationEnd)failPreparation('preparation_source_changed','The reviewed transcript changed.');
  return {state:'succeeded',source:{id:source.artifactId,fingerprint:source.fingerprint},output:{artifactId:source.artifactId}};
 }
 const receipt=await d.publication({operationId:source.operationId,requestId:row.request_id,siteVisitActivityId:row.site_visit_id});
 let result;
 if(receipt?.state==='published'){
  const overview=await d.overview({requestId:row.request_id,ownerProfileId:row.actor_profile_id});
  if(!same(overview.currentArtifact?.id,receipt.resulting_document_id))failPreparation('preparation_source_changed','A newer transcript replaced this review.');
  result={publication:{state:'published'},currentArtifact:overview.currentArtifact};
 }else if(receipt?.state==='draft') result=await d.publish({...args,operationId:source.operationId,body:{expectedVersion:source.expectedVersion}});
 else result=await d.reconcile({requestId:row.request_id,operationId:source.operationId,actorProfileId:row.actor_profile_id,actingUserSystemId:row.acting_user_system_id});
 if(result?.publication?.state!=='published'||result.requiresAttention||!result.currentArtifact?.id)failPreparation('preparation_publication_needs_attention','The saved transcript publication needs reconciliation before preparation continues.');
 return {state:'succeeded',source:{id:result.currentArtifact.id,fingerprint:result.currentArtifact.fingerprint},output:{operationId:source.operationId,artifactId:result.currentArtifact.id}};
}
async function videoStep(row,d) {
 if(Date.now()-new Date(row.attempt_created_at).getTime()>24*60*60*1000)failPreparation('preparation_video_wait_expired','Video preparation has waited more than a day. Check the existing cut before resuming.');
 const resolved=await d.resolveSource({requestId:row.request_id,actorProfileId:row.actor_profile_id});
 let split=row.output?.splitId?await d.video({id:row.output.splitId,requestId:row.request_id}):null;
 if(!split){
  const snapshots=await d.listVideos({requestId:row.request_id,limit:10});
  for(const item of snapshots){
   const candidate=await d.video({id:item.id,requestId:row.request_id});
   if(candidate&&same(candidate.transcript_revision_id,resolved.revisionId)&&Number(candidate.presentation_end_ms)===resolved.presentationEnd?.endMs
    &&same(candidate.source_document_id,row.input.files.recordingId)&&!['failed','cancelled','superseded'].includes(candidate.state)){split=candidate;break;}
  }
 }
 if(!split){const started=await d.startVideo({requestId:row.request_id,actorProfileId:row.actor_profile_id,actingUserSystemId:row.acting_user_system_id});
  const splitId=started?.body?.split?.id;if(!splitId)failPreparation('preparation_video_unconfirmed','The video operation could not be confirmed.');
  return {state:'pending',output:{splitId}};
 }
 if(!same(split.transcript_revision_id,resolved.revisionId)||Number(split.presentation_end_ms)!==resolved.presentationEnd?.endMs
  ||!same(split.source_document_id,row.input.files.recordingId))failPreparation('preparation_video_source_changed','The video source changed.');
 if(['review','approved'].includes(split.state))return {state:'succeeded',output:{splitId:split.id}};
 if(['queued','cutting','uploading','registering'].includes(split.state))return {state:'pending',output:{splitId:split.id}};
 failPreparation('preparation_video_failed','The video needs attention. Retry after checking its source.');
}
export async function runPreparationTick(overrides={}) {
 const d={...DEFAULTS,...overrides};const access=parseMeetingTranscriptionAccess(process.env.MEETING_MATERIAL_PREPARATION_ACCESS);
 if(access.mode==='off')return {outcome:'disabled',worked:0};
 await d.store.recoverExpired();
 const row=await d.store.claim({requestId:access.mode==='test'?access.requestId:null});
 if(!row)return {outcome:'idle',worked:0};
 const fence={id:row.id,leaseToken:row.lease_token};
 const args={requestId:row.request_id,ownerProfileId:row.actor_profile_id,actingUserSystemId:row.acting_user_system_id};
 let result;
 try {
  await currentInputs(row,d,{needsSource:row.kind!=='source'});
  const assertCurrent=async()=>{if(!await d.store.renew(fence))failPreparation('preparation_lease_lost','The preparation attempt changed.');await currentInputs(row,d);};
  if(row.kind==='source') result=await sourceStep(row,d,args);
  else if(row.kind==='transcripts'){
   const generated=await d.generate({...args,body:{expectedCurrentArtifactId:row.source_artifact_id,expectedCurrentFingerprint:row.source_fingerprint}});
   result={state:'succeeded',output:{presentationArtifactId:generated.presentationTranscript.artifactId,discussionArtifactId:generated.staffDiscussionTranscript.artifactId}};
  }else if(row.kind==='video')result=await videoStep(row,d);
  else if(['presentation_summary','discussion_summary'].includes(row.kind)){
   const summary=await d.summary({...args,body:{kind:row.kind==='presentation_summary'?'presentation':'discussion',expectedCurrentArtifactId:row.source_artifact_id,
    expectedCurrentFingerprint:row.source_fingerprint,...(row.options?.replaceDraft?{replaceDraft:row.options.replaceDraft}:{})},preparation:{id:row.preparation_id,attemptId:row.attempt_id,assertCurrent}});
   result={state:'succeeded',output:{draftId:summary.draft.id}};
  }else failPreparation('preparation_step_invalid','Unknown preparation step.');
 }catch(error){
  if(row.kind==='discussion_summary'&&error?.code==='staff_discussion_not_recorded')result={state:'succeeded',output:{discussionNotRecorded:true}};
  else if(error?.code==='summary_outcome_unknown')result={state:'unknown',failureCode:error.code};
  else {const sourceChanged=['meeting_transcript_correction_changed','meeting_attendance_confirmation_required','correction_draft_not_found'].includes(error?.code);
   const retryable=['post_presentation_slot_busy','presentation_video_split_active'].includes(error?.code)&&row.attempts<3;
   result={state:error?.code==='meeting_transcript_publication_busy'?'pending':retryable?'pending':'blocked',failureCode:error?.code==='meeting_transcript_publication_busy'?null:sourceChanged?'preparation_source_changed':error?.code||'preparation_failed',
    output:error?.code==='summary_draft_exists'?{draftId:error.body?.draftId,version:error.body?.version}:row.output||null};}
 }
 const saved=await d.store.finish({...fence,...result});
 return {outcome:saved?result.state:'lease_lost',worked:1};
}
