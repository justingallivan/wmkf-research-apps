/** Read-only, actor/Request-scoped validated draft results. */
import { requireAppAccess } from '../../../../../lib/utils/auth';
import { withDalContext } from '../../../../../lib/dataverse/core/context';
import { readStaffResults } from '../../../../../lib/services/prompt-jobs/staff-service';
import { ServiceHttpError } from '../../../../../lib/services/service-http-error';
export default async function handler(req,res) {
  res.setHeader('Cache-Control','private, no-store');
  if (req.method!=='GET') {res.setHeader('Allow','GET');return res.status(405).json({error:'Method not allowed'});}
  const access=await requireAppAccess(req,res,'reviewers');if(!access)return;
  try {
    const value=await withDalContext('workbench-prompt-job-results',()=>readStaffResults({requestId:req.query.requestId,jobId:req.query.jobId,
      actor:{profileId:access.profileId,systemUserId:access.session?.user?.dynamicsSystemuserId}}));
    return res.status(200).json(value);
  }catch(error){
    if(error instanceof ServiceHttpError)return res.status(error.httpStatus).json(error.body||{error:error.code});
    return res.status(500).json({error:'prompt_job_unavailable'});
  }
}
