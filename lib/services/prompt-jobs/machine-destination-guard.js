/** Configured machine destinations cannot be written through generic Executor prompts in this deployment. */
import { readMachinePilotPolicy } from './machine-pilot-policy.js';
export function assertNoGenericMachineDestination(outputs) {
  const policy = readMachinePilotPolicy();
  const field = policy?.destinationGrant?.field;
  if (!field) return;
  if (!Array.isArray(outputs)) throw new Error('Prompt outputs must be an array');
  if (outputs.some(output => output?.target?.kind !== 'none' && typeof output?.target?.field === 'string'
    && output.target.field.trim().toLowerCase().split(/[./]/).pop() === field)) {
    throw new Error('Configured machine destinations require durable job initialization');
  }
}
