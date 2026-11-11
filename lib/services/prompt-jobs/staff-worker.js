/** One server-selected trial stage. No caller-selected job IDs, source paths, prompts or destinations. */
import { advanceJob } from './worker.js';
import { executePrompt } from '../execute-prompt.js';
import * as aiRun from '../../dataverse/adapters/ai-run.js';
import { canonical } from './profile.js';
import { STAFF_JOB_DEPENDENCIES, projectStaffJob } from './staff-service.js';
import { matchesTrialActor, scopeForTrial, trialError } from './trial-policy.js';

export const STAFF_WORKER_DEPENDENCIES = {...STAFF_JOB_DEPENDENCIES, executePrompt,
  nonceSecret:()=>process.env.PROMPT_JOB_NONCE_SECRET,
  audit:async ({runId,payload,actor})=>{
    if (process.env.DYNAMICS_IMPERSONATION_ENABLED!=='true') throw trialError('prompt_job_impersonation_required',503);
    await aiRun.create({...payload,wmkf_ai_runid:runId},{actingUserSystemId:actor.systemUserId,noFallback:true});
  },
};
export async function runStaffJobTick(deps = STAFF_WORKER_DEPENDENCIES) {
  const policy = deps.policy();
  if (!policy) return {stage:'disabled'};
  const actor = {profileId:policy.profileId,systemUserId:policy.systemUserId};
  const scope = scopeForTrial(policy);
  // Retention belongs to the configured cohort, even after the actor loses access.
  // This deletes only expired content; durable job/attempt receipts remain.
  await deps.store.expireContent({scope});
  const authorize = async ({job,configuration})=> {
    const current = deps.policy();
    return canonical(current)===canonical(policy) && matchesTrialActor(current,actor,job.request_id)
      && job.environment===scope.environment && job.principal_key===scope.principalKey && job.authorization_scope===scope.authorizationScope
      && (!configuration || canonical(configuration.actor)===canonical(actor)) && await deps.authorize(actor)===true;
  };
  if (await deps.authorize(actor)!==true) throw trialError('prompt_job_access_denied',403);
  const candidate = await deps.store.findRunnableJob(scope);
  if (!candidate) {
    const [view] = await deps.store.listJobs({...scope,limit:1});
    if (!view) return {stage:'idle'};
    const state = projectStaffJob(view,null,deps.now()).status;
    return {stage:['complete','needs_attention','expired'].includes(state) ? state : 'unavailable'};
  }
  return advanceJob({jobId:candidate.id,store:deps.store,executePrompt:deps.executePrompt,authorize,
    checkFreshness:async ({configuration})=>Boolean(configuration?.manifest) && deps.source.isCurrent({manifest:configuration.manifest}),
    prepareSnapshot:async ({configuration})=>{
      if (canonical(configuration.actor)!==canonical(actor)) throw trialError('proposal_source_unavailable');
      return deps.source.prepare({manifest:configuration.manifest,scope:configuration.scope,profile:configuration.profile,nonceSecret:deps.nonceSecret()});
    },
    audit:args=>deps.audit({...args,actor}),nonceSecret:deps.nonceSecret(),leaseMs:240000,
  });
}
