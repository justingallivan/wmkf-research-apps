import { classifyDeployment } from '../dataverse/core/interlock';
import { isGuid } from './guid';
import { testRequestIsolationEnabled } from '../services/test-requests/isolation';
import { initialAssessmentRationaleEnabled } from './initial-assessment-rationale-readiness';

export function j27ChairsRecommendationEnabled() {
  return process.env.J27_CHAIRS_RECOMMENDATION_ENABLED === 'on' && initialAssessmentRationaleEnabled() && testRequestIsolationEnabled();
}

export function j27ChairsRecommendationRehearsalRequestId() {
  const id = process.env.J27_CHAIRS_RECOMMENDATION_REHEARSAL_REQUEST_ID;
  return classifyDeployment() === 'preview' && process.env.J27_AUTOMATIC_INTEGRITY === 'off'
    && j27ChairsRecommendationEnabled() && isGuid(id) ? id.trim().toLowerCase() : null;
}

export function j27IntegritySimulationRequestIds() {
  if (classifyDeployment() !== 'preview' || process.env.J27_AUTOMATIC_INTEGRITY !== 'simulate'
    || !j27ChairsRecommendationEnabled()) return [];
  const ids = (process.env.J27_INTEGRITY_SIMULATION_REQUEST_IDS || '').split(',').map(id => id.trim().toLowerCase());
  return ids.length === 2 && ids.every(isGuid) && ids[0] !== ids[1] ? ids : [];
}

export function isJ27IntegritySimulationRequest(requestId) {
  return isGuid(requestId) && j27IntegritySimulationRequestIds().includes(requestId.trim().toLowerCase());
}

export function j27IntegrityTarget() {
  if (!j27ChairsRecommendationEnabled() || (process.env.J27_AUTOMATIC_INTEGRITY !== 'on'
    && !j27IntegritySimulationRequestIds().length)) return null;
  return new URL(process.env.DYNAMICS_URL).hostname;
}
