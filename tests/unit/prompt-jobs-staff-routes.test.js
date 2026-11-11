/** @jest-environment node */
jest.mock('../../lib/utils/auth',()=>({requireAppAccess:jest.fn()}));
jest.mock('../../lib/dataverse/core/context',()=>({withDalContext:jest.fn((_label,fn)=>fn())}));
jest.mock('../../lib/services/prompt-jobs/staff-service',()=>({admitStaffJob:jest.fn(),listStaffJobs:jest.fn(),readStaffJob:jest.fn(),readStaffResults:jest.fn()}));
jest.mock('../../lib/services/prompt-jobs/staff-worker',()=>({runStaffJobTick:jest.fn()}));
import { requireAppAccess } from '../../lib/utils/auth';
import { withDalContext } from '../../lib/dataverse/core/context';
import { admitStaffJob,listStaffJobs,readStaffJob,readStaffResults } from '../../lib/services/prompt-jobs/staff-service';
import { runStaffJobTick } from '../../lib/services/prompt-jobs/staff-worker';
import index from '../../pages/api/workbench/prompt-jobs/index';
import status from '../../pages/api/workbench/prompt-jobs/[jobId]/index';
import results from '../../pages/api/workbench/prompt-jobs/[jobId]/results';
import cron from '../../pages/api/cron/drain-prompt-jobs';
import { ServiceHttpError } from '../../lib/services/service-http-error';
const requestId='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',systemUserId='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const res=()=>({setHeader:jest.fn(),status:jest.fn().mockReturnThis(),json:jest.fn().mockReturnThis()});
beforeEach(()=>{jest.clearAllMocks();requireAppAccess.mockResolvedValue({profileId:7,session:{user:{dynamicsSystemuserId:systemUserId}}});listStaffJobs.mockResolvedValue({enabled:false,jobs:[]});});
it.each([index,status,results])('auth denial exits before DAL or service reads',async handler=>{
 requireAppAccess.mockResolvedValue(null);await handler({method:'GET',query:{requestId},headers:{}},res());
 expect(requireAppAccess).toHaveBeenCalledWith(expect.anything(),expect.anything(),'reviewers');expect(withDalContext).not.toHaveBeenCalled();
});
it('admission uses authenticated identity and rejects client execution inputs',async()=>{
 let response=res();await index({method:'POST',body:{requestId,profileId:8,prompt:'arbitrary'},headers:{}},response);
 expect(response.status).toHaveBeenCalledWith(400);expect(admitStaffJob).not.toHaveBeenCalled();
 response=res();admitStaffJob.mockResolvedValue({job:{id:requestId}});
 await index({method:'POST',body:{requestId},headers:{'idempotency-key':systemUserId}},response);
 expect(admitStaffJob).toHaveBeenCalledWith({requestId,idempotencyKey:systemUserId,actor:{profileId:7,systemUserId}});
 expect(response.status).toHaveBeenCalledWith(202);expect(response.setHeader).toHaveBeenCalledWith('Cache-Control','private, no-store');
});
it('read routes only read and pass the full requested identity to scoped services',async()=>{
 const req={method:'GET',query:{requestId,jobId:systemUserId},headers:{}};
 for(const handler of [index,status,results])await handler(req,res());
 expect(readStaffJob).toHaveBeenCalledWith({requestId,jobId:systemUserId,actor:{profileId:7,systemUserId}});
 expect(readStaffResults).toHaveBeenCalledWith({requestId,jobId:systemUserId,actor:{profileId:7,systemUserId}});
 expect(admitStaffJob).not.toHaveBeenCalled();expect(runStaffJobTick).not.toHaveBeenCalled();
});
it('unknown service errors never echo sensitive provider/source error text',async()=>{
 listStaffJobs.mockRejectedValue(new Error('SECRET PROPOSAL TEXT'));const response=res();
 await index({method:'GET',query:{requestId},headers:{}},response);
 expect(response.status).toHaveBeenCalledWith(500);expect(response.json).toHaveBeenCalledWith({error:'prompt_job_unavailable'});
 listStaffJobs.mockRejectedValue(new ServiceHttpError('denied',{httpStatus:403,code:'prompt_job_access_denied'}));
 await index({method:'GET',query:{requestId},headers:{}},response);expect(response.status).toHaveBeenLastCalledWith(403);
});
it('cron requires its bearer secret even in development and accepts no caller-selected job',async()=>{
 const oldNode=process.env.NODE_ENV,oldSecret=process.env.CRON_SECRET;
 try{
 process.env.NODE_ENV='development';process.env.CRON_SECRET='fabricated-test-secret';const denied=res();
 await cron({method:'POST',headers:{},body:{jobId:requestId}},denied);expect(denied.status).toHaveBeenCalledWith(401);expect(runStaffJobTick).not.toHaveBeenCalled();
 runStaffJobTick.mockResolvedValue({stage:'disabled'});const allowed=res();
 await cron({method:'POST',headers:{authorization:'Bearer fabricated-test-secret'},body:{jobId:requestId}},allowed);
 expect(runStaffJobTick).toHaveBeenCalledWith();expect(allowed.json).toHaveBeenCalledWith({stage:'disabled'});
 }finally{process.env.NODE_ENV=oldNode;if(oldSecret===undefined)delete process.env.CRON_SECRET;else process.env.CRON_SECRET=oldSecret;}
});
