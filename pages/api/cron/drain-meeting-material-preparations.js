/** One durable meeting preparation child per invocation; no request identifiers or content returned. */
import {verifyCronSecret} from '../../../lib/utils/cron-auth.js';
import {withDalContext} from '../../../lib/dataverse/core/context.js';
import {runPreparationTick} from '../../../lib/services/meeting-coordination/preparation-worker.js';
export const config={maxDuration:300};
export default async function handler(req,res){
 if(!['GET','POST'].includes(req.method)){res.setHeader('Allow','GET, POST');return res.status(405).json({ok:false,error:'Method not allowed'});}
 if(!verifyCronSecret(req,res))return;
 try{return res.status(200).json({ok:true,...await withDalContext('cron-meeting-material-preparations',()=>runPreparationTick())});}
 catch(error){console.error('[meeting preparation worker] failed:',error?.code||error?.name||'error');return res.status(500).json({ok:false,error:'Preparation worker failed.'});}
}
