import { isGuid } from '../../utils/guid.js';
import {
  FINAL_WRITEUP_MATRIX_AUDIENCE_VERSION,
  getFinalWriteupPersonaRuntimeState,
} from './matrix-audience-service.js';
import { FINAL_WRITEUP_PERSONA_LENSES_ENABLED } from '../../../shared/config/finalWriteupPersonas.js';

const DEFAULT_DEPENDENCIES = Object.freeze({
  enabled: FINAL_WRITEUP_PERSONA_LENSES_ENABLED,
  getRuntimeState: () => getFinalWriteupPersonaRuntimeState(),
});

function normalizedGuid(value) {
  return isGuid(value) ? String(value).toLowerCase() : null;
}

/**
 * Resolve multi-valued Final Writeup personas from the published v2 staffing
 * configuration and the current direct reviewer-role roster. Rollout-off
 * performs no setting or roster read. A v1/missing setting, ineligible viewer,
 * or missing assignment narrows to no personas without widening access.
 */
export async function resolveFinalWriteupPersonas(
  actingUserSystemId,
  dependencies = DEFAULT_DEPENDENCIES,
) {
  if (!dependencies.enabled) {
    return { enabled: false, personas: [] };
  }
  const viewerId = normalizedGuid(actingUserSystemId);
  if (!viewerId) {
    throw new Error('Final Writeup persona resolution requires a staff system-user GUID.');
  }

  const state = await dependencies.getRuntimeState();
  const warnings = Array.isArray(state?.warnings) ? [...state.warnings] : [];
  if (state?.version !== FINAL_WRITEUP_MATRIX_AUDIENCE_VERSION) {
    return { enabled: true, personas: [], warnings };
  }
  const reviewerIds = new Set(
    Array.isArray(state.reviewerIds)
      ? state.reviewerIds.map((id) => normalizedGuid(id)).filter(Boolean)
      : [],
  );
  if (!reviewerIds.has(viewerId)) {
    return {
      enabled: true,
      personas: [],
      warnings: [...warnings, 'final_writeup_persona_viewer_ineligible'],
    };
  }
  const assignment = Array.isArray(state.assignments)
    ? state.assignments.find((item) => normalizedGuid(item?.reviewerId) === viewerId)
    : null;
  if (!assignment) {
    return {
      enabled: true,
      personas: [],
      warnings: [...warnings, 'final_writeup_persona_viewer_unassigned'],
    };
  }
  return {
    enabled: true,
    personas: Array.isArray(assignment.roles) ? [...assignment.roles] : [],
    warnings,
  };
}
