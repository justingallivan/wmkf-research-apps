/** Separate, default-off, exact-Request Sandbox Summary enrollment; never changes the Short Title pilot. */
import { readMachinePilotPolicy, machinePilotError } from './machine-pilot-policy.js';
export function readMachineSummaryPolicy(env = process.env, deployment) {
  if (!env.PROMPT_JOB_SUMMARY_PILOT) return null;
  const policy = readMachinePilotPolicy({...env, PROMPT_JOB_MACHINE_PILOT:env.PROMPT_JOB_SUMMARY_PILOT}, deployment);
  if (policy.destinationGrant) throw machinePilotError('machine_pilot_configuration');
  return Object.freeze({...policy, authorizationScope:`pa-executive-summary:${policy.pilotId}`});
}
