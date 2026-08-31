import * as systemUserAdapter from '../../dataverse/adapters/system-user.js';
import { isGuid } from '../../utils/guid.js';
import {
  FINAL_WRITEUP_PERSONA,
  FINAL_WRITEUP_PERSONA_LENSES_ENABLED,
  FINAL_WRITEUP_PERSONA_TEAMS,
} from '../../../shared/config/finalWriteupPersonas.js';

const DEFAULT_DEPENDENCIES = Object.freeze({
  enabled: FINAL_WRITEUP_PERSONA_LENSES_ENABLED,
  teamSpecs: FINAL_WRITEUP_PERSONA_TEAMS,
  getUserWithTeams: (id) => systemUserAdapter.getByIdWithTeams(id),
});

function normalizedGuid(value) {
  return isGuid(value) ? String(value).toLowerCase() : null;
}

/**
 * Resolve multi-valued Final Writeup personas from pinned Dataverse team IDs.
 * Disabled rollout performs no Dataverse read. Enabled rollout fails closed if
 * any configured team lacks a stable GUID or if the viewer is unavailable.
 */
export async function resolveFinalWriteupPersonas(
  actingUserSystemId,
  dependencies = DEFAULT_DEPENDENCIES,
) {
  if (!dependencies.enabled) {
    return { enabled: false, personas: [] };
  }
  if (!isGuid(actingUserSystemId)) {
    throw new Error('Final Writeup persona resolution requires a staff system-user GUID.');
  }

  const specs = Array.isArray(dependencies.teamSpecs) ? dependencies.teamSpecs : [];
  const pinned = specs.map((spec) => ({ ...spec, teamId: normalizedGuid(spec?.teamId) }));
  const requiredPersonas = Object.values(FINAL_WRITEUP_PERSONA);
  const configuredPersonas = pinned.map((spec) => spec?.persona);
  if (pinned.length !== requiredPersonas.length
    || pinned.some((spec) => !spec.persona || !spec.teamId)
    || new Set(configuredPersonas).size !== requiredPersonas.length
    || requiredPersonas.some((persona) => !configuredPersonas.includes(persona))) {
    throw new Error('Final Writeup persona rollout requires the exact persona team set with every Dataverse team GUID pinned.');
  }
  if (new Set(pinned.map((spec) => spec.teamId)).size !== pinned.length) {
    throw new Error('Final Writeup persona team GUIDs must be unique.');
  }

  const user = await dependencies.getUserWithTeams(actingUserSystemId);
  if (!user
    || normalizedGuid(user.systemuserid) !== normalizedGuid(actingUserSystemId)
    || user.isdisabled !== false) {
    throw new Error('Final Writeup persona viewer is not an enabled Dataverse user.');
  }
  const memberships = Array.isArray(user.teammembership_association)
    ? user.teammembership_association
    : [];
  const membershipIds = new Set(memberships.map((team) => normalizedGuid(team?.teamid)).filter(Boolean));
  return {
    enabled: true,
    personas: pinned
      .filter((spec) => membershipIds.has(spec.teamId))
      .map((spec) => spec.persona),
  };
}
