import { classifyDeployment, classifyTarget } from '../dataverse/core/interlock.js';

export function meetingRosterSchemaEnabled() {
  return process.env.MEETING_ROSTER_SCHEMA_READY === 'on'
    && classifyDeployment() !== 'production'
    && classifyTarget(process.env.DYNAMICS_URL) === 'sandbox';
}
