/**
 * Final Writeup staffing and program-audience configuration.
 *
 * Persistence is one versioned JSON value in Dataverse app settings. Version 1
 * remains readable for the Production-proved program matrix. Version 2 adds
 * explicit, multi-valued persona assignments while keeping one optimistic
 * full-replacement publication contract. Names always resolve live.
 */

import * as grantProgramAdapter from '../../dataverse/adapters/grant-program.js';
import * as systemUserAdapter from '../../dataverse/adapters/system-user.js';
import { isGuid } from '../../utils/guid.js';
import { getSettingStrict, setSettingIfUnchanged } from '../settings-service.js';
import { ServiceHttpError } from '../service-http-error.js';
import {
  FINAL_WRITEUP_PERSONA_ORDER,
  FINAL_WRITEUP_REVIEWER_ROLE_NAME,
} from '../../../shared/config/finalWriteupPersonas.js';
import { FINAL_WRITEUP_PERSONA_SUGGESTIONS } from './persona-suggestions.js';

export const FINAL_WRITEUP_MATRIX_AUDIENCE_SETTING_KEY = 'final_writeup.matrix_audiences';
export const FINAL_WRITEUP_MATRIX_AUDIENCE_LEGACY_VERSION = 1;
export const FINAL_WRITEUP_MATRIX_AUDIENCE_VERSION = 2;
export const FINAL_WRITEUP_MATRIX_MAX_PROGRAMS = 25;
export const FINAL_WRITEUP_MATRIX_MAX_REVIEWERS = 50;
export const FINAL_WRITEUP_MATRIX_MAX_SERIALIZED_CHARS = 90000;

const V1_CONFIG_KEYS = new Set(['version', 'programs']);
const V2_CONFIG_KEYS = new Set(['version', 'personas', 'programs']);
const PROGRAM_KEYS = new Set(['grantProgramId', 'reviewerIds']);
const PERSONA_KEYS = new Set(['reviewerId', 'roles']);
const PERSONA_ROLE_SET = new Set(FINAL_WRITEUP_PERSONA_ORDER);

const DEFAULT_DEPENDENCIES = Object.freeze({
  getSettingStrict,
  setSettingIfUnchanged,
  listGrantPrograms: () => grantProgramAdapter.listActive({
    top: FINAL_WRITEUP_MATRIX_MAX_PROGRAMS + 1,
  }),
  listReviewers: () => systemUserAdapter.listEnabledBySecurityRoleName(
    FINAL_WRITEUP_REVIEWER_ROLE_NAME,
    { top: FINAL_WRITEUP_MATRIX_MAX_REVIEWERS + 1 },
  ),
});

function audienceError(message, code, httpStatus = 400, extra = {}) {
  return new ServiceHttpError(message, {
    code,
    httpStatus,
    body: { error: message, code, ...extra },
  });
}

function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).every((key) => keys.has(key));
}

function resultRows(result) {
  return Array.isArray(result?.records) ? result.records : [];
}

function initials(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  return `${words[0][0] || ''}${words.length > 1 ? words[words.length - 1][0] || '' : ''}`
    .toUpperCase() || null;
}

function validateRevision(expectedRevision) {
  if (expectedRevision !== null
    && (typeof expectedRevision !== 'string' || !expectedRevision || expectedRevision.length > 256)) {
    throw audienceError(
      'The Final Writeup staffing revision must be a Dataverse ETag or null.',
      'final_writeup_staffing_revision_rejected',
      400,
    );
  }
}

function validatePrograms(programsInput, fail) {
  if (!Array.isArray(programsInput)) {
    fail('Final Writeup staffing configuration must contain a programs array.');
  }
  if (programsInput.length > FINAL_WRITEUP_MATRIX_MAX_PROGRAMS) {
    fail(`Final Writeup staffing configuration supports at most ${FINAL_WRITEUP_MATRIX_MAX_PROGRAMS} Grant Programs.`);
  }
  if (programsInput.length === 0) {
    fail('Final Writeup staffing configuration must contain at least one Grant Program audience.');
  }

  const seenPrograms = new Set();
  return programsInput.map((program) => {
    const grantProgramId = String(program?.grantProgramId || '').toLowerCase();
    if (!exactKeys(program, PROGRAM_KEYS) || !isGuid(grantProgramId)
      || !Array.isArray(program.reviewerIds) || program.reviewerIds.length === 0) {
      fail('Every configured Grant Program must contain only a Grant Program GUID and at least one reviewer GUID.');
    }
    if (program.reviewerIds.length > FINAL_WRITEUP_MATRIX_MAX_REVIEWERS) {
      fail(`Each Grant Program supports at most ${FINAL_WRITEUP_MATRIX_MAX_REVIEWERS} reviewers.`);
    }
    if (seenPrograms.has(grantProgramId)) fail(`Duplicate Grant Program configuration: ${grantProgramId}.`);
    seenPrograms.add(grantProgramId);

    const seenReviewers = new Set();
    const reviewerIds = program.reviewerIds.map((value) => {
      const reviewerId = String(value || '').toLowerCase();
      if (!isGuid(reviewerId)) fail('Every configured reviewer must be a systemuser GUID.');
      if (seenReviewers.has(reviewerId)) {
        fail(`Duplicate reviewer in Grant Program ${grantProgramId}: ${reviewerId}.`);
      }
      seenReviewers.add(reviewerId);
      return reviewerId;
    }).sort();
    return { grantProgramId, reviewerIds };
  }).sort((left, right) => left.grantProgramId.localeCompare(right.grantProgramId));
}

function validatePersonas(personasInput, fail) {
  if (!Array.isArray(personasInput)) {
    fail('Version 2 Final Writeup staffing configuration must contain a personas array.');
  }
  if (personasInput.length > FINAL_WRITEUP_MATRIX_MAX_REVIEWERS) {
    fail(`Final Writeup staffing configuration supports at most ${FINAL_WRITEUP_MATRIX_MAX_REVIEWERS} staff assignments.`);
  }
  const seenReviewers = new Set();
  return personasInput.map((assignment) => {
    const reviewerId = String(assignment?.reviewerId || '').toLowerCase();
    if (!exactKeys(assignment, PERSONA_KEYS) || !isGuid(reviewerId)
      || !Array.isArray(assignment.roles)) {
      fail('Every staff assignment must contain only a reviewer GUID and roles array.');
    }
    if (seenReviewers.has(reviewerId)) fail(`Duplicate staff assignment: ${reviewerId}.`);
    seenReviewers.add(reviewerId);
    const seenRoles = new Set();
    for (const role of assignment.roles) {
      if (!PERSONA_ROLE_SET.has(role)) fail(`Unknown Final Writeup responsibility: ${role}.`);
      if (seenRoles.has(role)) fail(`Duplicate responsibility for ${reviewerId}: ${role}.`);
      seenRoles.add(role);
    }
    return {
      reviewerId,
      roles: FINAL_WRITEUP_PERSONA_ORDER.filter((role) => seenRoles.has(role)),
    };
  }).sort((left, right) => left.reviewerId.localeCompare(right.reviewerId));
}

export function validateFinalWriteupMatrixAudienceConfig(
  input,
  { persisted = false, writableOnly = false } = {},
) {
  const fail = (message) => {
    throw audienceError(
      message,
      persisted
        ? 'final_writeup_staffing_config_invalid'
        : 'final_writeup_staffing_config_rejected',
      persisted ? 503 : 400,
    );
  };
  const version = input?.version;
  if (version !== FINAL_WRITEUP_MATRIX_AUDIENCE_LEGACY_VERSION
    && version !== FINAL_WRITEUP_MATRIX_AUDIENCE_VERSION) {
    fail(`Final Writeup staffing configuration must use version ${FINAL_WRITEUP_MATRIX_AUDIENCE_LEGACY_VERSION} or ${FINAL_WRITEUP_MATRIX_AUDIENCE_VERSION}.`);
  }
  if (writableOnly && version !== FINAL_WRITEUP_MATRIX_AUDIENCE_VERSION) {
    fail(`Only version ${FINAL_WRITEUP_MATRIX_AUDIENCE_VERSION} Final Writeup staffing configuration can be published.`);
  }
  const expectedKeys = version === FINAL_WRITEUP_MATRIX_AUDIENCE_VERSION
    ? V2_CONFIG_KEYS
    : V1_CONFIG_KEYS;
  if (!exactKeys(input, expectedKeys)
    || Object.keys(input).length !== expectedKeys.size) {
    fail(`Final Writeup staffing version ${version} contains missing or unknown fields.`);
  }

  const programs = validatePrograms(input.programs, fail);
  const config = version === FINAL_WRITEUP_MATRIX_AUDIENCE_VERSION
    ? { version, personas: validatePersonas(input.personas, fail), programs }
    : { version, programs };
  if (JSON.stringify(config).length > FINAL_WRITEUP_MATRIX_MAX_SERIALIZED_CHARS) {
    fail(`Final Writeup staffing configuration exceeds ${FINAL_WRITEUP_MATRIX_MAX_SERIALIZED_CHARS} serialized characters.`);
  }
  return config;
}

async function readStoredConfig(dependencies) {
  let result;
  try {
    result = await dependencies.getSettingStrict(FINAL_WRITEUP_MATRIX_AUDIENCE_SETTING_KEY);
  } catch {
    throw audienceError(
      'The Final Writeup staffing configuration could not be loaded.',
      'final_writeup_staffing_config_unavailable',
      503,
    );
  }
  if (!result?.found) {
    return { configured: false, config: null, revision: null };
  }
  if (typeof result.revision !== 'string' || !result.revision) {
    throw audienceError(
      'The saved Final Writeup staffing revision is unavailable.',
      'final_writeup_staffing_revision_unavailable',
      503,
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(String(result.value || ''));
  } catch {
    throw audienceError(
      'The saved Final Writeup staffing configuration is not valid JSON. Use the ETag-guarded repair command.',
      'final_writeup_staffing_config_invalid',
      503,
    );
  }
  return {
    configured: true,
    config: validateFinalWriteupMatrixAudienceConfig(parsed, { persisted: true }),
    revision: result.revision,
  };
}

async function loadReviewerRoster(dependencies) {
  const result = await dependencies.listReviewers();
  const rows = resultRows(result);
  if (result?.hasMore || (result?.totalCount || 0) > FINAL_WRITEUP_MATRIX_MAX_REVIEWERS
    || rows.length > FINAL_WRITEUP_MATRIX_MAX_REVIEWERS) {
    throw audienceError(
      `The Final Writeup reviewer role supports at most ${FINAL_WRITEUP_MATRIX_MAX_REVIEWERS} configured reviewers.`,
      'final_writeup_staffing_reviewer_scope_exceeded',
      503,
    );
  }
  const reviewers = rows.map((row) => ({
    reviewerId: String(row?.systemuserid || '').toLowerCase(),
    name: typeof row?.fullname === 'string' ? row.fullname.trim() : '',
    isEnabled: row?.isdisabled === false,
  }));
  if (!reviewers.length || reviewers.some((reviewer) => (
    !isGuid(reviewer.reviewerId) || !reviewer.name || !reviewer.isEnabled
  )) || new Set(reviewers.map((reviewer) => reviewer.reviewerId)).size !== reviewers.length) {
    throw audienceError(
      'The Final Writeup reviewer role requires reconciliation before staffing can be configured.',
      'final_writeup_staffing_reviewer_roster_invalid',
      503,
    );
  }
  return reviewers
    .sort((left, right) => left.name.localeCompare(right.name))
    .map(({ reviewerId, name }) => ({ reviewerId, name, initials: initials(name) }));
}

async function loadGrantPrograms(dependencies) {
  const result = await dependencies.listGrantPrograms();
  const rows = resultRows(result);
  if (result?.hasMore || (result?.totalCount || 0) > FINAL_WRITEUP_MATRIX_MAX_PROGRAMS
    || rows.length > FINAL_WRITEUP_MATRIX_MAX_PROGRAMS) {
    throw audienceError(
      `Final Writeup staffing supports at most ${FINAL_WRITEUP_MATRIX_MAX_PROGRAMS} active Grant Programs.`,
      'final_writeup_staffing_program_scope_exceeded',
      503,
    );
  }
  const programs = rows.map((row) => ({
    grantProgramId: String(row?.wmkf_grantprogramid || '').toLowerCase(),
    name: typeof row?.wmkf_name === 'string' ? row.wmkf_name.trim() : '',
    isActive: row?.statecode === 0,
  }));
  if (!programs.length || programs.some((program) => (
    !isGuid(program.grantProgramId) || !program.name || !program.isActive
  )) || new Set(programs.map((program) => program.grantProgramId)).size !== programs.length) {
    throw audienceError(
      'The active Dataverse Grant Program directory requires reconciliation.',
      'final_writeup_staffing_program_directory_invalid',
      503,
    );
  }
  return programs.sort((left, right) => left.name.localeCompare(right.name));
}

function suggestedPersonas(reviewers) {
  const reviewerIds = new Set(reviewers.map((reviewer) => reviewer.reviewerId));
  return FINAL_WRITEUP_PERSONA_SUGGESTIONS
    .filter((assignment) => reviewerIds.has(assignment.reviewerId))
    .map((assignment) => ({ reviewerId: assignment.reviewerId, roles: [...assignment.roles] }))
    .sort((left, right) => left.reviewerId.localeCompare(right.reviewerId));
}

function draftConfig(stored, reviewers) {
  if (stored.config?.version === FINAL_WRITEUP_MATRIX_AUDIENCE_VERSION) return stored.config;
  return {
    version: FINAL_WRITEUP_MATRIX_AUDIENCE_VERSION,
    personas: suggestedPersonas(reviewers),
    programs: stored.config?.programs || [],
  };
}

function staleReferences(config, programs, reviewers) {
  const programIds = new Set(programs.map((program) => program.grantProgramId));
  const reviewerIds = new Set(reviewers.map((reviewer) => reviewer.reviewerId));
  const programReviewerIds = config.programs.flatMap((program) => program.reviewerIds);
  const personaReviewerIds = config.version === FINAL_WRITEUP_MATRIX_AUDIENCE_VERSION
    ? config.personas.map((assignment) => assignment.reviewerId)
    : [];
  return {
    grantProgramIds: config.programs
      .map((program) => program.grantProgramId)
      .filter((id) => !programIds.has(id)),
    reviewerIds: [...new Set([...programReviewerIds, ...personaReviewerIds])]
      .filter((id) => !reviewerIds.has(id)),
  };
}

function unassignedReviewerIds(config, reviewers) {
  const assigned = new Set(config.personas.map((assignment) => assignment.reviewerId));
  return reviewers.map((reviewer) => reviewer.reviewerId).filter((id) => !assigned.has(id));
}

export async function getFinalWriteupMatrixAudienceAdminState(dependencies = DEFAULT_DEPENDENCIES) {
  const [stored, programs, reviewers] = await Promise.all([
    readStoredConfig(dependencies),
    loadGrantPrograms(dependencies),
    loadReviewerRoster(dependencies),
  ]);
  const config = draftConfig(stored, reviewers);
  return {
    configured: stored.configured,
    storedVersion: stored.config?.version || null,
    migrationRequired: stored.config?.version === FINAL_WRITEUP_MATRIX_AUDIENCE_LEGACY_VERSION,
    config,
    revision: stored.revision,
    programs,
    reviewers,
    staleReferences: staleReferences(config, programs, reviewers),
    unassignedReviewerIds: unassignedReviewerIds(config, reviewers),
  };
}

export async function resolveFinalWriteupMatrixAudiences(dependencies = DEFAULT_DEPENDENCIES) {
  const [stored, reviewers] = await Promise.all([
    readStoredConfig(dependencies),
    loadReviewerRoster(dependencies),
  ]);
  if (!stored.configured) {
    return { mode: 'role-default', fallbackReviewers: reviewers, programs: [] };
  }
  const programs = await loadGrantPrograms(dependencies);
  const activeProgramIds = new Set(programs.map((program) => program.grantProgramId));
  const reviewersById = new Map(reviewers.map((reviewer) => [reviewer.reviewerId, reviewer]));
  const stale = staleReferences(stored.config, programs, reviewers);
  return {
    mode: 'configured',
    fallbackReviewers: null,
    programs: stored.config.programs
      .filter((program) => activeProgramIds.has(program.grantProgramId))
      .map((program) => ({
        grantProgramId: program.grantProgramId,
        reviewers: program.reviewerIds
          .filter((id) => reviewersById.has(id))
          .map((id) => reviewersById.get(id)),
      })),
    warnings: stale.grantProgramIds.length || stale.reviewerIds.length
      ? { staleReferences: stale }
      : null,
  };
}

export async function getFinalWriteupPersonaRuntimeState(dependencies = DEFAULT_DEPENDENCIES) {
  const [stored, reviewers] = await Promise.all([
    readStoredConfig(dependencies),
    loadReviewerRoster(dependencies),
  ]);
  if (!stored.configured || stored.config.version !== FINAL_WRITEUP_MATRIX_AUDIENCE_VERSION) {
    return {
      version: stored.config?.version || null,
      assignments: [],
      reviewerIds: reviewers.map((reviewer) => reviewer.reviewerId),
      warnings: ['final_writeup_persona_configuration_not_v2'],
    };
  }
  const reviewerIds = new Set(reviewers.map((reviewer) => reviewer.reviewerId));
  const staleReviewerIds = stored.config.personas
    .map((assignment) => assignment.reviewerId)
    .filter((id) => !reviewerIds.has(id));
  return {
    version: stored.config.version,
    assignments: stored.config.personas.filter((assignment) => reviewerIds.has(assignment.reviewerId)),
    reviewerIds: [...reviewerIds],
    warnings: staleReviewerIds.length ? ['final_writeup_persona_stale_assignments_pruned'] : [],
  };
}

async function persistConfig(config, expectedRevision, updatedByProfileId, dependencies) {
  validateRevision(expectedRevision);
  try {
    await dependencies.setSettingIfUnchanged(
      FINAL_WRITEUP_MATRIX_AUDIENCE_SETTING_KEY,
      JSON.stringify(config),
      expectedRevision,
      updatedByProfileId,
    );
  } catch (error) {
    if (error?.code === 'setting_conflict' || error?.status === 409 || error?.status === 412) {
      throw audienceError(
        'Another administrator published Final Writeup staffing changes after this state was loaded. Reload and review before publishing again.',
        'final_writeup_staffing_revision_conflict',
        409,
      );
    }
    throw audienceError(
      'The Final Writeup staffing configuration could not be saved.',
      'final_writeup_staffing_save_failed',
      502,
    );
  }
}

export async function writeFinalWriteupMatrixAudienceConfig(
  input,
  expectedRevision,
  updatedByProfileId,
  dependencies = DEFAULT_DEPENDENCIES,
) {
  const config = validateFinalWriteupMatrixAudienceConfig(input, { writableOnly: true });
  const [programs, reviewers] = await Promise.all([
    loadGrantPrograms(dependencies),
    loadReviewerRoster(dependencies),
  ]);
  const stale = staleReferences(config, programs, reviewers);
  if (stale.grantProgramIds.length || stale.reviewerIds.length) {
    throw audienceError(
      'Every saved Final Writeup reference must use an active Grant Program and enabled direct member of the reviewer role.',
      'final_writeup_staffing_reference_invalid',
      409,
      { staleReferences: stale },
    );
  }
  const unassigned = unassignedReviewerIds(config, reviewers);
  if (unassigned.length) {
    throw audienceError(
      'Every current Final Writeup reviewer-role member needs responsibilities or an explicit No persona lens choice.',
      'final_writeup_staffing_roster_incomplete',
      409,
      { unassignedReviewerIds: unassigned },
    );
  }
  await persistConfig(config, expectedRevision, updatedByProfileId, dependencies);
  return getFinalWriteupMatrixAudienceAdminState(dependencies);
}

/**
 * Out-of-band optimistic replacement for upgrades, emergency downgrade, and
 * malformed-value repair. It validates the replacement but deliberately does
 * not parse the existing value before writing it by exact row ETag.
 */
export async function replaceFinalWriteupMatrixAudienceConfigByRevision(
  input,
  expectedRevision,
  updatedByProfileId = null,
  dependencies = DEFAULT_DEPENDENCIES,
) {
  const config = validateFinalWriteupMatrixAudienceConfig(input);
  await persistConfig(config, expectedRevision, updatedByProfileId, dependencies);
  const readback = await dependencies.getSettingStrict(FINAL_WRITEUP_MATRIX_AUDIENCE_SETTING_KEY);
  if (!readback?.found || typeof readback.revision !== 'string' || !readback.revision) {
    throw audienceError(
      'The repaired Final Writeup staffing configuration could not be read back.',
      'final_writeup_staffing_repair_readback_failed',
      502,
    );
  }
  let parsed;
  try {
    parsed = validateFinalWriteupMatrixAudienceConfig(JSON.parse(String(readback.value || '')), {
      persisted: true,
    });
  } catch {
    throw audienceError(
      'The repaired Final Writeup staffing configuration failed exact readback validation.',
      'final_writeup_staffing_repair_readback_failed',
      502,
    );
  }
  if (JSON.stringify(parsed) !== JSON.stringify(config)) {
    throw audienceError(
      'The repaired Final Writeup staffing configuration did not match the requested replacement.',
      'final_writeup_staffing_repair_readback_mismatch',
      502,
    );
  }
  return { config: parsed, revision: readback.revision };
}

export const FINAL_WRITEUP_MATRIX_AUDIENCE_DEPENDENCIES = DEFAULT_DEPENDENCIES;
