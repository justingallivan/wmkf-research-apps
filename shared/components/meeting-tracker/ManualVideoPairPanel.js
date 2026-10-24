import {useEffect,useRef,useState} from 'react';
import {put} from '@vercel/blob/client';
import {useProfile} from '../../context/ProfileContext';
import {Button} from '../Layout';
import {requestJson} from '../../utils/api-request';

/** Explicit original-audio pairing; processing continues in the existing video queue after admission. */
export default function ManualVideoPairPanel(props){
 const profile=useProfile();const profileId=profile?.currentProfile?.id??profile?.profileId??'';
 return <ManualVideoPairPanelForContext key={`${props.path}:${profileId}`} {...props}/>;
}
function ManualVideoPairPanelForContext({path,expectedReviewId,onQueued}){
 const [opened,setOpened]=useState(false),[pair,setPair]=useState(null),[file,setFile]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(null);
 const alive=useRef(true),pending=useRef(false);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 const run=async fn=>{if(pending.current)return;pending.current=true;setBusy(true);setError(null);try{await fn();}catch(e){if(alive.current)setError(e.message||'The pairing could not be confirmed. Refresh the video status before retrying.');}finally{pending.current=false;if(alive.current)setBusy(false);}};
 const status=()=>run(async()=>{const result=await requestJson(path,{method:'POST',body:{action:'manual-status'}});if(alive.current){setPair(result.pairing);setOpened(true);}});
 const queue=async id=>{const result=await requestJson(path,{method:'POST',body:{action:'manual-start',pairingId:id,expectedReviewId}});if(!result.split?.id)throw new Error('The video queue receipt was incomplete. Refresh video status before retrying.');if(alive.current){setPair(null);setFile(null);await onQueued();if(alive.current)setOpened(false);}};
 const prepare=()=>run(async()=>{
  if(!file)throw new Error('Choose the original MP3 or M4A used for this transcript.');
  const contentType=/\.mp3$/i.test(file.name)?'audio/mpeg':/\.m4a$/i.test(file.name)?'audio/mp4':null;
  if(!contentType)throw new Error('Choose an MP3 or M4A original audio file.');
  const result=await requestJson(path,{method:'POST',body:{action:'manual-upload',bytes:file.size,contentType}});
  const capability=result.upload;
  if(!result.pairing?.id||!capability?.pathname||!capability.token)throw new Error('The upload receipt was incomplete.');
  if(alive.current)setPair(result.pairing);
  await put(capability.pathname,file,{access:'private',token:capability.token,contentType:capability.contentType,multipart:true});
  // A navigation never authorizes starting a cut on a different mounted request.
  if(!alive.current)return;
  await queue(result.pairing.id);
 });
 return <div className="mt-3 border-t border-gray-200 pt-3 text-sm">
  {!opened?<Button type="button" size="sm" variant="link" disabled={busy} onClick={status}>{busy?'Checking…':'Pair a manually uploaded recording'}</Button>:<>
   <p className="font-medium text-gray-900">Match the original audio to the uploaded MP4</p>
   <p className="mt-1 leading-6 text-gray-600">Zoom import is preferred. For a manual recording, supply the exact original audio used for this transcript. We verify that it matches the MP4 before cutting. Converted audio or shifted timelines may not match.</p>
   {expectedReviewId&&<p className="mt-2 text-amber-900">Starting this cut replaces the video currently awaiting review. Approved Board materials stay available.</p>}
   {pair?.state==='verified'?<p className="mt-2">This source pair has already been verified.</p>:<label className="mt-3 block font-medium">Original audio<input type="file" accept=".mp3,.m4a,audio/mpeg,audio/mp4" disabled={busy} onChange={event=>setFile(event.target.files?.[0]||null)} className="mt-1 block w-full max-w-full text-sm"/></label>}
   <div className="mt-3 flex flex-wrap gap-2">
    {pair&&((pair.state==='ready'&&pair.canResume!==false)||pair.state==='verified'||pair.state==='awaiting_audio')&&<Button type="button" size="sm" disabled={busy} onClick={()=>void run(()=>queue(pair.id))}>{busy?'Working…':pair.state==='verified'?'Create video from verified pair':'Resume uploaded audio and create video'}</Button>}
    {pair?.state!=='verified'&&<Button type="button" size="sm" disabled={busy||!file} onClick={prepare}>{busy?'Uploading and queuing…':'Upload original audio and create video'}</Button>}
    <Button type="button" size="sm" variant="outline" disabled={busy} onClick={()=>setOpened(false)}>Close</Button>
   </div>
  </>}
  {error&&<p role="alert" className="mt-2 text-red-800">{error}</p>}
 </div>;
}
