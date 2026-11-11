/** Staff draft admission/discovery. The authenticated actor and trial policy own all execution inputs. */
import { requireAppAccess } from '../../../../lib/utils/auth';
import { withDalContext } from '../../../../lib/dataverse/core/context';
import { admitStaffJob, listStaffJobs } from '../../../../lib/services/prompt-jobs/staff-service';
import { ServiceHttpError } from '../../../../lib/services/service-http-error';
export default async function handler(req,res) {
  res.setHeader('Cache-Control','private, no-store');
  if (!['GET','POST'].includes(req.method)) { res.setHeader('Allow','GET, POST'); return res.status(405).json({error:'Method not allowed'}); }
  const access = await requireAppAccess(req,res,'reviewers');
  if (!access) return;
  if (req.method==='POST' && (!req.body || typeof req.body!=='object' || Array.isArray(req.body)
    || Object.keys(req.body).some(key=>key!=='requestId'))) return res.status(400).json({error:'Only requestId is accepted'});
  const actor = {profileId:access.profileId,systemUserId:access.session?.user?.dynamicsSystemuserId};
  try {
    const result = await withDalContext('workbench-prompt-jobs',()=>req.method==='GET'
      ? listStaffJobs({requestId:req.query.requestId,actor})
      : admitStaffJob({requestId:req.body.requestId,idempotencyKey:req.headers['idempotency-key'],actor}));
    return res.status(req.method==='POST'?202:200).json(result);
  } catch(error) {
    if (error instanceof ServiceHttpError) return res.status(error.httpStatus).json(error.body || {error:error.code});
    return res.status(500).json({error:'prompt_job_unavailable'});
  }
}
