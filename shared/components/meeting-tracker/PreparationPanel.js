import {useCallback,useEffect,useRef,useState} from 'react';
import {requestJson} from '../../utils/api-request';
import {Button} from '../Layout';
const LABELS={source:'Save reviewed transcript',transcripts:'Presentation and staff transcripts',presentation_summary:'Presentation summary draft',discussion_summary:'Staff discussion summary draft',video:'Presentation video'};
const STATES={pending:'Waiting',running:'Preparing…',succeeded:'Prepared',blocked:'Needs attention',unknown:'Outcome unknown'};
/** Saved preparation progress is independent of this component's lifetime. */
export default function PreparationPanel({requestId,source,blockedReason=null,onUpdated,beforeStart=null,onStarted=null,startLabel='Prepare saved materials'}){
 const [data,setData]=useState(null),[available,setAvailable]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(null),[recovery,setRecovery]=useState(null);
 const readSequence=useRef(0),operationPending=useRef(false),polling=useRef(false);
 const [canRecoverUnknown,setCanRecoverUnknown]=useState(false);
 const generation=useRef(0),mounted=useRef(false),controllers=useRef(new Set()),signature=useRef(null),onUpdatedRef=useRef(onUpdated);
 const sourceKey=JSON.stringify(source||null),endpoint=`/api/meeting-tracker/visits/${encodeURIComponent(requestId)}/preparation`;
 useEffect(()=>{onUpdatedRef.current=onUpdated;},[onUpdated]);
 const load=useCallback(async({preserveError=false}={})=>{
  if(operationPending.current)return;
  const read=++readSequence.current;
  const seq=generation.current,controller=new AbortController();controllers.current.add(controller);
  try{const result=await requestJson(endpoint,{signal:controller.signal,fallbackMessage:'Preparation progress could not be checked.'});
   if(!mounted.current||seq!==generation.current||read!==readSequence.current)return;
   setAvailable(true);setData(result.preparation);setCanRecoverUnknown(result.canRecoverUnknown===true);if(!preserveError)setError(null);polling.current=Boolean(result.preparation?.steps?.some(s=>['pending','running'].includes(s.state)));
   const next=JSON.stringify(result.preparation?.steps?.map(s=>[s.id,s.state,s.version]));
   if(signature.current!==null&&signature.current!==next)void onUpdatedRef.current?.();signature.current=next;
  }catch(e){if(!mounted.current||seq!==generation.current||read!==readSequence.current||controller.signal.aborted)return;
   if((e?.payload?.code||e?.code)==='preparation_not_available'||e?.status===404){setAvailable(false);return;}setAvailable(true);setError(e.message);
  }finally{controllers.current.delete(controller);}
 },[endpoint]);
 useEffect(()=>{mounted.current=true;const seq=++generation.current;
  void Promise.resolve().then(()=>{if(mounted.current&&seq===generation.current){setData(null);setRecovery(null);setCanRecoverUnknown(false);setBusy(false);operationPending.current=false;signature.current=null;void load();}});
  const timer=setInterval(()=>{if(mounted.current&&polling.current)void load();},15000),active=controllers.current;
  return()=>{mounted.current=false;generation.current=seq+1;clearInterval(timer);for(const controller of active)controller.abort();};
 },[load]);
 const command=async body=>{
  if(operationPending.current)return;operationPending.current=true;readSequence.current++;const seq=generation.current,controller=new AbortController();controllers.current.add(controller);setBusy(true);setError(null);
  try{if(body.action==='start'&&beforeStart){const savedSource=await beforeStart();if(!mounted.current||seq!==generation.current||!savedSource)return;body={...body,source:savedSource};}
   const result=await requestJson(endpoint,{method:'POST',body,signal:controller.signal,fallbackMessage:'The preparation action could not be confirmed. Refresh its status before trying again.'});
   if(!mounted.current||seq!==generation.current)return;
   if(!result.preparation?.id)throw new Error('Preparation could not be confirmed. Refresh its status before retrying.');
   setData(result.preparation);setRecovery(null);if(body.action==='start')onStarted?.(result.preparation);void onUpdatedRef.current?.();
  }catch(e){if(mounted.current&&seq===generation.current&&!controller.signal.aborted){setError(e.message);void load();}}
  finally{controllers.current.delete(controller);if(mounted.current&&seq===generation.current){operationPending.current=false;setBusy(false);void load({preserveError:true});}}
 };
 if(!available)return null;
 const working=data?.steps?.some(s=>['pending','running'].includes(s.state));
 return <div className="mt-5 border-t border-gray-200 pt-4" data-testid="material-preparation">
  <h3 className="text-sm font-semibold text-gray-950">Prepare materials</h3>
  <p className="mt-2 max-w-prose text-sm leading-6 text-gray-700">Preparation continues if you leave this page. Successful work is kept; Board approval stays a separate step.</p>
  {source&&<Button type="button" size="sm" className="mt-3" disabled={busy||working||Boolean(blockedReason)} onClick={()=>void command({action:'start',source:JSON.parse(sourceKey)})}>{busy?'Saving…':startLabel}</Button>}
  {blockedReason&&<p className="mt-2 text-sm text-gray-600">{blockedReason}</p>}
  {data&&<ul className="mt-3 divide-y divide-gray-100">{data.steps.map(step=><li key={step.id} className="py-3 text-sm">
   <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium text-gray-900">{LABELS[step.kind]||'Preparation step'}</span><span className="text-gray-600">{step.output?.discussionNotRecorded?'No discussion recorded':STATES[step.state]||'Status unknown'}</span></div>
   {['presentation_video_source_not_zoom','presentation_video_source_not_copied','presentation_video_recording_missing'].includes(step.failureCode)&&<p className="mt-1 text-gray-600">A matching video source is required. Check the recording import before retrying this step.</p>}
   {step.failureCode==='preparation_video_wait_expired'&&<p className="mt-1 text-gray-600">The video has been waiting more than a day. Check its existing cut, then resume this step; it will reuse the matching operation.</p>}
   {step.failureCode==='preparation_publication_needs_attention'&&<p className="mt-1 text-gray-600">Check the transcript publication under Needs attention before retrying.</p>}
   {step.failureCode==='preparation_inputs_changed'&&<p className="mt-1 text-gray-600">The recording or slides changed. Start preparation from the new inputs.</p>}
   {step.failureCode==='preparation_source_changed'&&<p className="mt-1 text-gray-600">The transcript changed. Start preparation from the saved review.</p>}
   {step.failureCode==='summary_draft_unavailable'&&<p className="mt-1 text-gray-600">The prepared draft was discarded or replaced. Review the current draft before generating another.</p>}
   {step.failureCode==='summary_generation_in_progress'&&<p className="mt-1 text-gray-600">An existing summary generation or publication must be resolved first. It has been kept unchanged.</p>}
   {step.failureCode==='summary_draft_expired'&&<p className="mt-1 text-gray-600">The fourteen-day draft retention period ended. Generate a new draft explicitly to continue.</p>}
   {step.failureCode==='summary_draft_exists'&&<p className="mt-1 text-gray-600">An existing summary draft has been kept for review. Replace it only after saving any edits you want to keep.</p>}
   {['blocked','unknown'].includes(step.state)&&!['preparation_source_changed','preparation_inputs_changed'].includes(step.failureCode)&&!recovery&&<Button type="button" size="sm" variant="outline" className="mt-2" disabled={busy} onClick={()=>step.state==='unknown'||step.failureCode==='summary_draft_exists'?setRecovery(step):void command({action:'retry',preparationId:data.id,stepId:step.id,expectedVersion:step.version})}>{step.state==='unknown'?'Review recovery':step.failureCode==='summary_draft_exists'?'Review replacement':'Retry this step'}</Button>}
  </li>)}</ul>}
  {recovery&&<div className="mt-3 space-y-3 text-sm leading-6 text-gray-800"><p>{recovery.state==='unknown'?'The first summary call may already have incurred a charge. Abandoning it does not cancel or refund that call. Only the assigned Program Coordinator can start another attempt.':'Replace the exact existing draft shown by this preparation? Its saved text and any unsaved changes will be discarded.'}</p>
   <div className="flex flex-wrap gap-2"><Button type="button" size="sm" disabled={busy||(recovery.state==='unknown'&&!canRecoverUnknown)} onClick={()=>void command({action:'retry',preparationId:data.id,stepId:recovery.id,expectedVersion:recovery.version,
    ...(recovery.state==='unknown'?{acknowledgePotentialDuplicateCharge:true}:{replaceDraft:{draftId:recovery.output.draftId,expectedVersion:recovery.output.version}})})}>{recovery.state==='unknown'?'Abandon attempt and try again':'Replace existing draft'}</Button><Button type="button" size="sm" variant="outline" disabled={busy} onClick={()=>setRecovery(null)}>Keep current work</Button></div></div>}
  {error&&<p className="mt-3 text-sm text-red-700" role="alert">{error}</p>}
  <Button type="button" size="sm" variant="link" className="mt-2" disabled={busy} onClick={()=>void load()}>Refresh preparation status</Button>
 </div>;
}
