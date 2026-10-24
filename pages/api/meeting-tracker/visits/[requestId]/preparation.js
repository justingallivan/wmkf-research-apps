/** Staff preparation commands persist work; the cron owns execution. */
import {requireAppAccess} from '../../../../../lib/utils/auth.js';
import {actorRefFromSession} from '../../../../../lib/utils/actor-ref.js';
import {withDalContext} from '../../../../../lib/dataverse/core/context.js';
import {isGuid} from '../../../../../lib/utils/guid.js';
import {ServiceHttpError} from '../../../../../lib/services/service-http-error.js';
import {startPreparation,getPreparation,retryPreparation,validPreparationBody} from '../../../../../lib/services/meeting-coordination/preparation-service.js';
export const config={api:{bodyParser:{sizeLimit:'8kb'}},maxDuration:60};
export default async function handler(req,res){
 res.setHeader('Cache-Control','private, no-store');
 if(!['GET','POST'].includes(req.method)){res.setHeader('Allow','GET, POST');return res.status(405).json({error:'Method not allowed'});}
 const {requestId}=req.query;
 if(!isGuid(requestId)||Object.keys(req.query).some(k=>k!=='requestId'))return res.status(400).json({error:'A valid request is required.'});
 const access=await requireAppAccess(req,res,'meeting-tracker');if(!access)return;
 if(!Number.isSafeInteger(access.profileId)||access.profileId<1)return res.status(401).json({error:'An active staff profile is required.'});
 if(req.method==='POST'&&!validPreparationBody(req.body))return res.status(400).json({error:'The preparation request is invalid.'});
 return withDalContext('meeting-material-preparation',async()=>{
  try{const args={requestId,profileId:access.profileId,actingUserSystemId:actorRefFromSession(access.session),body:req.body};
   const result=req.method==='GET'?await getPreparation(args):req.body.action==='start'?await startPreparation(args):await retryPreparation(args);
   return res.status(req.method==='GET'?200:202).json(result);
  }catch(error){if(error instanceof ServiceHttpError)return res.status(error.httpStatus).json({error:error.message,code:error.code});
   console.error('[meeting preparation] unavailable:',error?.code||error?.name||'error');return res.status(503).json({error:'Preparation is unavailable. Try again.',code:'preparation_unavailable'});}
 });
}
