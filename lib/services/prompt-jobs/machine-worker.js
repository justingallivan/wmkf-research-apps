/** One server-selected Short Title stage; unscheduled and disabled without the pinned sandbox grant. */
import { policyDestinationField } from './machine-destination.js';
import { executePrompt } from '../execute-prompt.js';
import * as aiRun from '../../dataverse/adapters/ai-run.js';
import { updateById } from '../../dataverse/adapters/grant-request.js';
import { advanceJob } from './worker.js';
import { machineRuntime } from './machine-service.js';
import { createRequestFieldDelivery } from './request-field-delivery.js';
import { canonical, sha256 } from './profile.js';
import { projectMachineJob } from './machine-status.js';
import { MACHINE_TITLE_TASK } from './machine-title-contract.js';
import { activeMachinePilot, machinePilotScope, readMachinePilotPolicy } from './machine-pilot-policy.js';

export async function runMachineJobTick(deps) {
  if (!deps && !readMachinePilotPolicy()) return {stage:'disabled'};
  if (!deps) {
    const runtime = machineRuntime();
    deps = {...runtime,executePrompt,
      patchRequest:(id,fields,options)=>updateById(id,fields,{...options,expectedOrigin:runtime.expectedOrigin}),
      audit:({runId,payload})=>aiRun.create({...payload,wmkf_ai_runid:runId},{noFallback:true,expectedOrigin:runtime.expectedOrigin}),
    };
  }
  const policy = deps.policy();
  if (!policy) return {stage:'disabled'};
  const scope = machinePilotScope(policy);
  const destinationField = policyDestinationField(policy);
  await deps.store.verifyMachineTitleDatabase({allowInactive:true});
  if (canonical(deps.policy()) !== canonical(policy)) throw new Error('Machine pilot changed');
  await deps.store.expireContent({scope});
  const current = ()=>activeMachinePilot(deps.policy(),deps.now()) && canonical(deps.policy()) === canonical(policy);
  if (!current()) return {stage:'disabled'};
  const owns = job=>job.environment === scope.environment && job.principal_key === scope.principalKey
    && job.authorization_scope === scope.authorizationScope && job.request_id === scope.requestId && job.operation === 'initialize';
  const authorize = async ({job,configuration})=>{
    if (!current() || !owns(job) || (configuration && configuration.policyHash !== sha256(canonical(policy)))) return false;
    await deps.store.verifyMachineTitleDatabase();
    return current();
  };
  const [view] = await deps.store.listJobs({...scope,limit:1});
  if (!view) return {stage:'idle'};
  if (!owns(view.job) || view.tasks.length !== 1 || view.tasks[0].task_key !== MACHINE_TITLE_TASK) throw new Error('Invalid machine pilot job');
  const projected = projectMachineJob(view,deps.now(),{destinationField});
  if (projected.pollAfterSeconds === null) return {stage:projected.state};
  const delivery = createRequestFieldDelivery({readRequest:deps.readRequest,patchRequest:deps.patchRequest,destinationField,
    authorize:async (phase,command)=>{
      if (phase === 'prePATCH' && policy.destinationGrant) {
        if (typeof deps.checkDestination !== 'function') return false;
        await deps.checkDestination(policy);
      }
      return command.fields.length === 1 && command.fields[0] === destinationField && command.jobId === view.job.id && command.requestId === scope.requestId
      && command.environment === scope.environment && command.principalKey === scope.principalKey
      && command.authorizationScope === scope.authorizationScope && await authorize({job:view.job});
    },
  });
  return advanceJob({jobId:view.job.id,store:deps.store,executePrompt:deps.executePrompt,authorize,
    prepareSnapshot:async ({job,configuration})=>{
      if (!await authorize({job,configuration})) throw new Error('Machine pilot changed');
      try {
        const snapshot = await deps.source.prepare({manifest:configuration.manifest,scope:configuration.scope,
          profile:configuration.profile,nonceSecret:deps.nonceSecret()});
        if (!await authorize({job,configuration})) throw new Error('Machine pilot changed');
        return snapshot;
      } catch(error) {
        if (error.httpStatus === 422) throw Object.assign(new Error('Source changed'),{code:'proposal_source_changed'});
        throw error;
      }
    },
    checkFreshness:async ({job,configuration,stage})=>{
      // Publication uses the captured ETag, so any later row mutation becomes
      // a durable 412 conflict instead of a silent ETag refresh or retry loop.
      if (stage === 'publish') {
        if (!await authorize({job})) return false;
        if (policy.destinationGrant) {
          if (typeof deps.checkDestination !== 'function') return false;
          await deps.checkDestination(policy);
        }
        return authorize({job});
      }
      if (!configuration || !await authorize({job,configuration})) return false;
      if (policy.destinationGrant) {
        if (typeof deps.checkDestination !== 'function') return false;
        await deps.checkDestination(policy);
        if (!await authorize({job,configuration})) return false;
      }
      const fresh = await deps.source.isCurrent({manifest:configuration.manifest,expectedEtag:job.target_etag});
      return fresh && await authorize({job,configuration});
    },
    readTarget:delivery.readTarget,writer:delivery.writer,
    audit:async args=>{
      if (!await authorize({job:args.job})) throw new Error('Machine pilot changed');
      await deps.audit(args);
    },nonceSecret:deps.nonceSecret(),leaseMs:240000,
  });
}
