/** Request/visit-scoped frozen research-presentation email; no calendar-event mutation. */
import { requireAppAccess } from '../../../../../lib/utils/auth';
import { actorRefFromSession } from '../../../../../lib/utils/actor-ref';
import { withDalContext } from '../../../../../lib/dataverse/core/context';
import { isGuid } from '../../../../../lib/utils/guid';
import { ServiceHttpError } from '../../../../../lib/services/service-http-error';
import { isMeetingTrackerSchemaReady } from '../../../../../shared/config/meetingTracker';
import { getInvitation, prepareInvitation, actOnInvitation } from '../../../../../lib/services/meeting-coordination/invitation-service';
export const config={api:{bodyParser:{sizeLimit:'36kb'}},maxDuration:300};
function validBody(body){
 if(!body||typeof body!=='object'||Array.isArray(body))return false;
 const keys=body.action==='prepare'?['action','subject','message']:['send','reconcile'].includes(body.action)?['action','invitationId','expectedVersion']:null;
 if(!keys||Object.keys(body).some(key=>!keys.includes(key)))return false;
 return body.action==='prepare'?typeof body.subject==='string'&&typeof body.message==='string':isGuid(body.invitationId||'')&&Number.isSafeInteger(body.expectedVersion)&&body.expectedVersion>0;
}
export default async function handler(req,res){
 if(!['GET','POST'].includes(req.method)){res.setHeader('Allow','GET, POST');return res.status(405).json({error:'Method not allowed'});}
 const requestId=typeof req.query.requestId==='string'?req.query.requestId:'';
 if(!isGuid(requestId))return res.status(400).json({error:'A valid request id is required.'});
 const access=await requireAppAccess(req,res,'meeting-tracker');if(!access)return;
 res.setHeader('Cache-Control','private, no-store');
 if(!isMeetingTrackerSchemaReady())return res.status(503).json({error:'Meeting Tracker is not enabled.',code:'meeting_tracker_schema_not_ready'});
 if(req.method==='POST'&&!validBody(req.body))return res.status(400).json({error:'Unsupported invitation request fields.'});
 const args={requestId,profileId:access.profileId,actingUserSystemId:actorRefFromSession(access.session),fromEmail:String(access.session?.user?.azureEmail||'').trim().toLowerCase(),body:req.body};
 return withDalContext('meeting-tracker-presentation-invitation',async()=>{
  try{const result=req.method==='GET'?await getInvitation(args):req.body.action==='prepare'?await prepareInvitation(args):await actOnInvitation(args);return res.status(200).json({success:true,...result});}
  catch(error){if(error instanceof ServiceHttpError)return res.status(error.httpStatus).json(error.body??{error:error.message,code:error.code});console.error('[presentation-invitation] request failed:',error?.code||'unavailable');return res.status(500).json({error:'The invitation result could not be confirmed. Refresh its status before trying again.'});}
 });
}
