/** @jest-environment node */
jest.mock('../../lib/services/prompt-jobs/machine-summary-service',()=>({requireSummaryPromptAccess:jest.fn(),admitSummaryJob:jest.fn(),readSummaryJob:jest.fn()}));
jest.mock('../../lib/services/prompt-jobs/machine-summary-worker',()=>({runSummaryJobTick:jest.fn()}),{virtual:true});
import submit from '../../pages/api/automation/summary-jobs/index';
import status from '../../pages/api/automation/summary-jobs/[jobId]';
import cron from '../../pages/api/cron/drain-summary-prompt-jobs';
import {requireSummaryPromptAccess,admitSummaryJob,readSummaryJob} from '../../lib/services/prompt-jobs/machine-summary-service';
import {runSummaryJobTick} from '../../lib/services/prompt-jobs/machine-summary-worker';
import {hasTrustedDalContext} from '../../lib/dataverse/core/context';
import {ServiceHttpError} from '../../lib/services/service-http-error';
const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',access={policy:{},scope:{},assertCurrent:jest.fn()},old=process.env;
function res(){return {headers:{},statusCode:0,setHeader(k,v){this.headers[k]=v;},status(n){this.statusCode=n;return this;},json(body){this.body=body;return this;}};}
beforeEach(()=>{jest.clearAllMocks();process.env={...old,CRON_SECRET:'synthetic-secret',NODE_ENV:'test'};requireSummaryPromptAccess.mockImplementation(async()=>{expect(hasTrustedDalContext()).toBe(false);return access;});});
afterAll(()=>{process.env=old;});
test('POST authenticates before DAL, returns private pending projection and relative location',async()=>{
 const body={requestId:id,taskKeys:['proposal.executive-summary'],operation:'initialize',sourceEventId:id};
 admitSummaryJob.mockImplementation(async args=>{expect(hasTrustedDalContext()).toBe(true);expect(args).toEqual({body,idempotencyKey:id,access});return {job:{jobId:id,state:'running',pollAfterSeconds:5}};});
 const r=res();await submit({method:'POST',headers:{'idempotency-key':id},body},r);
 expect(r.statusCode).toBe(202);expect(r.headers).toMatchObject({'Cache-Control':'private, no-store',Location:`/api/automation/summary-jobs/${id}`,'Retry-After':'5'});expect(r.body.job.jobId).toBe(id);
});
test('terminal replay returns 200 without Retry-After',async()=>{admitSummaryJob.mockResolvedValue({job:{jobId:id,state:'complete',pollAfterSeconds:null}});const r=res();await submit({method:'POST',headers:{},body:{}},r);expect(r.statusCode).toBe(200);expect(r.headers['Retry-After']).toBeUndefined();});
test('GET passes only authenticated scope and route job identity',async()=>{
 readSummaryJob.mockImplementation(async args=>{expect(hasTrustedDalContext()).toBe(true);expect(args).toEqual({jobId:id,access});return {job:{jobId:id,state:'running',pollAfterSeconds:5}};});
 const r=res();await status({method:'GET',query:{jobId:id},headers:{}},r);expect(r.statusCode).toBe(200);expect(r.headers).toMatchObject({'Cache-Control':'private, no-store','Retry-After':'5'});
});
test.each([401,403,404,409,429,503])('service auth and admission error %s is preserved',async code=>{
 requireSummaryPromptAccess.mockRejectedValue(new ServiceHttpError('safe',{httpStatus:code,body:{error:'safe'}}));const r=res();await submit({method:'POST',headers:{},body:{}},r);expect(r.statusCode).toBe(code);expect(r.body).toEqual({error:'safe'});expect(admitSummaryJob).not.toHaveBeenCalled();
});
test('unknown failure is private and does not expose internals',async()=>{requireSummaryPromptAccess.mockRejectedValue(Error('secret'));const r=res();await status({method:'GET',query:{jobId:id},headers:{}},r);expect(r.statusCode).toBe(503);expect(r.body).toEqual({error:'prompt_job_unavailable'});});
test.each([[submit,'GET','POST'],[status,'POST','GET'],[cron,'GET','POST']])('wrong method rejects before authentication',async(handler,method,allowed)=>{const r=res();await handler({method,headers:{},query:{}},r);expect(r.statusCode).toBe(405);expect(r.headers.Allow).toBe(allowed);expect(requireSummaryPromptAccess).not.toHaveBeenCalled();expect(runSummaryJobTick).not.toHaveBeenCalled();});
test('cron has no development bypass and passes no request data to worker',async()=>{
 process.env.NODE_ENV='development';let r=res();await cron({method:'POST',headers:{},body:{jobId:id}},r);expect(r.statusCode).toBe(401);expect(runSummaryJobTick).not.toHaveBeenCalled();
 runSummaryJobTick.mockImplementation(async(...args)=>{expect(args).toEqual([]);expect(hasTrustedDalContext()).toBe(true);return {status:'idle'};});r=res();await cron({method:'POST',headers:{authorization:'Bearer synthetic-secret'},body:{jobId:id}},r);expect(r.statusCode).toBe(200);expect(r.body).toEqual({status:'idle'});
});
