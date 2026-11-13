/** Default-off, single-Request machine admission/status. Provider work belongs to the bounded worker. */
import { authorizedTitleDestination, policyDestinationField } from './machine-destination.js';
import { checkMachineDestinationMetadata } from './machine-destination-metadata.js';
import { createPool } from '@vercel/postgres';
import { getById } from '../../dataverse/adapters/grant-request.js';
import { isGuid } from '../../utils/guid.js';
import { fetchCurrentPrompt } from '../prompt-store.js';
import { getPromptProfiles } from '../admin/prompt-profiles-service.js';
import { createPromptJobStore } from './store.js';
import { createMachineAuthenticator } from './machine-auth.js';
import { createMachineTitleSource } from './machine-title-source.js';
import { projectMachineJob } from './machine-status.js';
import { canonical, hashProfile, parseExecutionSpec } from './profile.js';
import { MACHINE_TITLE_TASK, validateMachineTitleProfile } from './machine-title-contract.js';
import { activeMachinePilot, machineAuthPolicy, machineDatabaseEndpoint, machinePilotError, machinePilotScope, readMachinePilotPolicy } from './machine-pilot-policy.js';

const authenticate = createMachineAuthenticator({readPolicy:()=>machineAuthPolicy(readMachinePilotPolicy())});
let runtime;
/** A pool is bound to the checked URL, never the ambient/default database client. */
export function machineRuntime() {
  const policy = readMachinePilotPolicy();
  if (!policy) throw machinePilotError('machine_pilot_disabled');
  const connectionString = process.env.POSTGRES_URL;
  const endpoint = machineDatabaseEndpoint(connectionString);
  if (endpoint !== policy.databaseEndpoint) throw machinePilotError('machine_pilot_configuration');
  if (runtime && runtime.connectionString !== connectionString) throw machinePilotError('machine_pilot_restart_required');
  if (!runtime) {
    const pool = createPool({connectionString,max:2,connectionTimeoutMillis:5000});
    runtime = {connectionString,store:createPromptJobStore(pool,{readMachinePolicy:readMachinePilotPolicy,machineDatabaseEndpoint:endpoint})};
  }
  const readRequest = (id,options)=>getById(id,{...options,strictRead:true,expectedOrigin:`https://${policy.targetHost}`});
  return {store:runtime.store,expectedOrigin:`https://${policy.targetHost}`,policy:readMachinePilotPolicy,source:createMachineTitleSource({readRequest}),readRequest,
    checkDestination:checkMachineDestinationMetadata,prompt:fetchCurrentPrompt,profiles:getPromptProfiles,now:()=>Date.now(),nonceSecret:()=>process.env.PROMPT_JOB_NONCE_SECRET};
}
export async function requireMachinePromptAccess(req) {
  const policy = readMachinePilotPolicy();
  if (!activeMachinePilot(policy)) throw machinePilotError('machine_pilot_disabled');
  const identity = await authenticate(req.headers.authorization);
  const assertCurrent = ()=>{
    identity.assertCurrent();
    if (!activeMachinePilot(readMachinePilotPolicy()) || canonical(readMachinePilotPolicy()) !== canonical(policy)
      || identity.principalKey !== policy.principalKey) throw machinePilotError('machine_pilot_changed');
  };
  assertCurrent();
  return Object.freeze({policy,scope:machinePilotScope(policy),assertCurrent});
}
function uuid(value) {
  if (typeof value !== 'string' || value !== value.trim() || !isGuid(value)) throw machinePilotError('invalid_machine_request',400);
  return value.toLowerCase();
}
function current(access,deps) {
  access.assertCurrent();
  if (!activeMachinePilot(deps.policy(),deps.now()) || canonical(access.policy) !== canonical(deps.policy())) throw machinePilotError('machine_pilot_changed');
}
function projection(view,access,deps) {
  current(access,deps);
  const {scope} = access;
  if (!view || view.job.environment !== scope.environment || view.job.principal_key !== scope.principalKey
    || view.job.authorization_scope !== scope.authorizationScope || view.job.request_id !== scope.requestId
    || view.job.operation !== 'initialize' || view.tasks.length !== 1 || view.tasks[0].task_key !== MACHINE_TITLE_TASK) throw machinePilotError('machine_job_not_found',404);
  return {job:projectMachineJob(view,deps.now(),{destinationField:policyDestinationField(access.policy)})};
}
export async function admitMachineJob({body,idempotencyKey,access},deps = machineRuntime()) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).sort().join(',') !== 'operation,requestId,sourceEventId,taskKeys'
    || body.operation !== 'initialize' || canonical(body.taskKeys) !== canonical([MACHINE_TITLE_TASK])) throw machinePilotError('invalid_machine_request',400);
  const requestId = uuid(body.requestId), sourceEventId = uuid(body.sourceEventId), key = uuid(idempotencyKey);
  current(access,deps);
  if (requestId !== access.policy.requestId || sourceEventId !== access.policy.sourceEventId) throw machinePilotError('machine_request_denied',403);
  const view = await deps.store.admitMachineTitle({...access.scope,operation:'initialize',sourceEventId,idempotencyKey:key,tasks:[{taskKey:MACHINE_TITLE_TASK}]},{
    assertCurrent:()=>current(access,deps),
    loadConfiguration:async ()=>{
      const manifest = await deps.source.inspect({requestId}); current(access,deps);
      const promptRow = await deps.prompt(MACHINE_TITLE_TASK); current(access,deps);
      const catalog = await deps.profiles(); current(access,deps);
      const spec = parseExecutionSpec(promptRow);
      const matches = catalog.profiles.filter(row=>row.profile.key === spec?.profile.key && row.profile.revision === spec.profile.revision
        && row.sha256 === spec.profile.sha256 && hashProfile(row.profile) === row.sha256);
      if (matches.length !== 1) throw machinePilotError('machine_profile_unavailable');
      const profile = matches[0].profile;
      validateMachineTitleProfile(profile);
      authorizedTitleDestination(promptRow, access.policy);
      if (access.policy.destinationGrant) {
        if (typeof deps.checkDestination !== 'function') throw machinePilotError('machine_pilot_configuration');
        await deps.checkDestination(access.policy); current(access,deps);
      }
      return {promptRow,profile,manifest};
    },
  });
  return projection(view,access,deps);
}
export async function readMachineJob({jobId,access},deps = machineRuntime()) {
  const id = uuid(jobId); current(access,deps);
  await deps.store.verifyMachineTitleDatabase(); current(access,deps);
  const views = await deps.store.listJobs({...access.scope,limit:1});
  return projection(views.find(view=>view.job.id === id),access,deps);
}
