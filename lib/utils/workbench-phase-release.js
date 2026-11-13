import { classifyDeployment } from '../dataverse/core/interlock.js';

/**
 * Merge-dark gate for the J27 Workbench release on the shared screens: the
 * cycle page's phase lists, the request page's stage strip and its J27 reads,
 * readiness-only discovery (D1) and the dashboard's J27 fact reads.
 *
 * Off in a Production deployment unless `WORKBENCH_PHASE_RELEASE` is the
 * literal `on`; admitted everywhere else (Preview, local, test), as before.
 * This is not the release switch by itself: the request page's phase layout
 * and its new fields stay sandbox-only (`pages/workbench/[requestId].js`),
 * and the integrity join needs migration 096 (rollout plan).
 */
export function workbenchPhaseReleaseAdmitted() {
  return classifyDeployment() !== 'production' || process.env.WORKBENCH_PHASE_RELEASE === 'on';
}
