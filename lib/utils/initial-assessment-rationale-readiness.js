import { classifyDeployment, classifyTarget } from '../dataverse/core/interlock.js';

export function initialAssessmentRationaleEnabled() {
  return process.env.INITIAL_RATIONALE_SCHEMA_READY === 'on'
    && classifyDeployment() !== 'production'
    && classifyTarget(process.env.DYNAMICS_URL) === 'sandbox';
}
