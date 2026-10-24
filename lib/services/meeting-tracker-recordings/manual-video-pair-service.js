/** Exact original-audio upload admission; no media processing or publication runs in the browser request. */
import crypto from 'node:crypto';
import {generateClientTokenFromReadWriteToken} from '@vercel/blob/client';
import {head} from '@vercel/blob';
import {ServiceHttpError} from '../service-http-error.js';
import {isGuid} from '../../utils/guid.js';
import {authorizePreparer} from '../meeting-coordination/preparation-service.js';
import {resolveCurrentMeetingTranscriptSource} from '../meeting-tracker-transcription/service.js';
import {POST_PRESENTATION_MATERIALS_DEPENDENCIES as materials,loadBoundContext} from '../post-presentation-materials/material-service.js';
import {projectPostPresentationMaterials} from '../post-presentation-materials/material-model.js';
import {REQUEST_DOCUMENT_ARTIFACT_TYPE} from '../../../shared/config/requestDocument.js';
import {GraphService} from '../graph-service.js';
import {isPresentationVideoSplitRequestAllowed} from '../../utils/presentation-video-split-access.js';
import {manualVideoPairEnabled} from './manual-video-pair-policy.js';
import {manualVideoPairStore} from './manual-video-pair-store.js';
const fail=(code,message,status=409)=>{throw new ServiceHttpError(message,{code,httpStatus:status});};
const same=(a,b)=>String(a||'').toLowerCase()===String(b||'').toLowerCase();
const token=()=>{if(!process.env.UPLOADS_BLOB_RW_TOKEN)fail('manual_video_upload_unavailable','Private recording uploads are not configured.',503);return process.env.UPLOADS_BLOB_RW_TOKEN;};
const privatePath=path=>typeof path==='string'&&/^manual-video-pairs\/[1-9][0-9]*\/[a-f0-9-]{36}\/audio\.(mp3|m4a)$/.test(path);
export const MANUAL_PAIR_DEPENDENCIES={store:manualVideoPairStore,authorize:authorizePreparer,resolve:resolveCurrentMeetingTranscriptSource,documents:materials.findDocuments,metadata:(...args)=>GraphService.getFileMetadataById(...args),binding:id=>loadBoundContext(id,materials),
 head:path=>head(path,{token:token()}),mint:input=>generateClientTokenFromReadWriteToken({token:token(),...input}),now:()=>Date.now()};
export async function loadManualVideoPairContext(args,d=MANUAL_PAIR_DEPENDENCIES){
 if(!isGuid(args.requestId||'')||!isPresentationVideoSplitRequestAllowed(args.requestId)||!manualVideoPairEnabled(args.requestId))fail('manual_video_unavailable','Manual video pairing is not available.',404);
 await d.authorize({profileId:args.actorProfileId,actingUserSystemId:args.actingUserSystemId});await d.binding(args.requestId);
 const resolved=await d.resolve({requestId:args.requestId,actorProfileId:args.actorProfileId});
 const p=resolved?.provenance;if(resolved?.status!=='upload'||p?.kind!=='upload'||!p.audioSha256||!p.sourceId)fail('manual_video_original_audio_required','Use a transcript prepared from uploaded audio. A plain text transcript cannot establish the video timeline.',422);
 const result=await d.documents(args.requestId);if(result?.capped)fail('manual_video_source_unavailable','The recording list could not be fully verified.',503);
 const recording=projectPostPresentationMaterials(result?.records||[],args.requestId).winners.find(r=>Number(r.wmkf_artifacttype)===REQUEST_DOCUMENT_ARTIFACT_TYPE.RECORDING);
 if(!recording?.wmkf_sharepointdriveid||!recording?.wmkf_sharepointitemid)fail('manual_video_recording_required','Upload the matching MP4 recording first.',422);
 const item=await d.metadata(recording.wmkf_sharepointdriveid,recording.wmkf_sharepointitemid);
 if(!Number.isSafeInteger(Number(item?.size))||Number(item.size)<1||typeof item.quickXorHash!=='string'||!item.quickXorHash)fail('manual_video_source_unavailable','The video content identity could not be verified.',503);
 return {resolved,recording,sourceId:p.sourceId,audioSha256:p.audioSha256,audioBytes:p.audioBytes,audioDurationMs:p.audioDurationMs,recordingId:recording.wmkf_requestdocumentid,driveId:recording.wmkf_sharepointdriveid,itemId:recording.wmkf_sharepointitemid,videoSize:Number(item.size),videoQuickXorHash:item.quickXorHash};
}
export function manualVideoPairMatches(row,c){return row&&same(row.source_id,c.sourceId)&&row.audio_sha256===c.audioSha256&&Number(row.audio_bytes)===c.audioBytes&&Number(row.audio_duration_ms)===c.audioDurationMs&&same(row.recording_id,c.recordingId)&&row.drive_id===c.driveId&&row.item_id===c.itemId&&Number(row.video_size)===c.videoSize&&row.video_quickxor_hash===c.videoQuickXorHash;}
export const manualVideoPairDto=row=>row?{id:row.id,state:row.state,expiresAt:row.upload_expires_at,canResume:row.state==='ready'&&new Date(row.expires_at).getTime()>Date.now()}:null;
export async function getManualVideoPair(args,d=MANUAL_PAIR_DEPENDENCIES){const c=await loadManualVideoPairContext(args,d);const latest=await d.store.latest(args.requestId,args.actorProfileId);const row=manualVideoPairMatches(latest,c)?latest:await d.store.findVerified(args.requestId,c.sourceId,c.recordingId);return {pairing:manualVideoPairMatches(row,c)?manualVideoPairDto(row):null};}
export async function mintManualVideoAudio(args,d=MANUAL_PAIR_DEPENDENCIES){
 const c=await loadManualVideoPairContext(args,d),{bytes,contentType}=args;
 if(!Number.isSafeInteger(bytes)||bytes!==c.audioBytes||bytes<1||bytes>209715200||!['audio/mpeg','audio/mp4','audio/x-m4a'].includes(contentType))fail('manual_video_audio_shape','Choose the exact original MP3 or M4A used for this transcript (up to 200 MiB).',400);
 const id=crypto.randomUUID(),pathname=`manual-video-pairs/${args.actorProfileId}/${id}/audio.${contentType==='audio/mpeg'?'mp3':'m4a'}`;
 const row=await d.store.create({id,requestId:args.requestId,profileId:args.actorProfileId,...c,pathname,contentType});if(!row)fail('manual_video_upload_capacity','Two audio uploads are already retained for this request. Resume the existing upload or wait for cleanup.',409);
 const uploadToken=await d.mint({pathname,maximumSizeInBytes:bytes,allowedContentTypes:[contentType],validUntil:new Date(row.upload_expires_at).getTime(),addRandomSuffix:false,allowOverwrite:false});
 return {pairing:manualVideoPairDto(row),upload:{pathname,token:uploadToken,access:'private',contentType,maximumSizeInBytes:bytes}};
}
export async function finalizeManualVideoAudio(args,d=MANUAL_PAIR_DEPENDENCIES){
 const c=await loadManualVideoPairContext(args,d);if(!isGuid(args.pairingId||''))fail('manual_video_pair_required','A saved upload receipt is required.',400);
 let row=await d.store.get(args.pairingId,args.requestId);if(!row||row.actor_profile_id!==args.actorProfileId||!manualVideoPairMatches(row,c)||!privatePath(row.audio_pathname)||new Date(row.expires_at).getTime()<=d.now())fail('manual_video_pair_changed','The upload or current source changed. Start a fresh pairing.');
 if(row.state==='ready')return row;if(row.state!=='awaiting_audio')fail('manual_video_upload_expired','This upload window ended. Start a fresh pairing.');
 let blob;try{blob=await d.head(row.audio_pathname);}catch(error){if(error?.name==='BlobNotFoundError'||error?.constructor?.name==='BlobNotFoundError')fail('manual_video_audio_missing','The audio upload has not completed. Select and upload the original file before resuming.');throw error;}if(Number(blob?.size)!==Number(row.audio_bytes)||blob.contentType!==row.content_type)fail('manual_video_audio_shape','The uploaded audio does not match the saved original size or file type.');
 row=await d.store.ready(row.id,args.requestId,args.actorProfileId);if(!row)fail('manual_video_pair_changed','The upload changed before it could be queued.');return row;
}
