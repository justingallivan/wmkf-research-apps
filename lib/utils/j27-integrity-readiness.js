import { testRequestIsolationEnabled } from '../services/test-requests/isolation';
import { initialAssessmentRationaleEnabled } from './initial-assessment-rationale-readiness';

export function j27SemiFinalistEnabled() {
  return process.env.J27_SEMI_FINALIST_ENABLED === 'on' && initialAssessmentRationaleEnabled() && testRequestIsolationEnabled();
}

export function j27IntegrityTarget() {
  if (process.env.J27_AUTOMATIC_INTEGRITY !== 'on' || !j27SemiFinalistEnabled()) return null;
  return new URL(process.env.DYNAMICS_URL).hostname;
}
