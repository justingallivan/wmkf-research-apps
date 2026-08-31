/**
 * Program-specific Final Writeup coordinator-matrix audience configuration.
 *
 * Persistence is one versioned JSON value in Dataverse app settings. The value
 * contains stable broad Grant Program GUIDs and enabled Final Writeup reviewer
 * systemuser GUIDs only; names always resolve live. When the setting is absent,
 * the dashboard retains the legacy all-role audience until an administrator
 * publishes the first explicit program configuration.
 */

import * as grantProgramAdapter from '../../dataverse/adapters/grant-program.js';
import * as systemUserAdapter from '../../dataverse/adapters/system-user.js';
import { isGuid } from '../../utils/guid.js';
import { getSettingStrict, setSettingIfUnchanged } from '../settings-service.js';
import { ServiceHttpError } from '../service-http-error.js';
import { FINAL_WRITEUP_REVIEWER_ROLE_NAME } from '../../../shared/config/finalWriteupPersonas.js';

export const FINAL_WRITEUP_MATRIX_AUDIENCE_SETTING_KEY = 'final_writeup.matrix_audiences';
export const FINAL_WRITEUP_MATRIX_AUDIENCE_VERSION = 1;
export const FINAL_WRITEUP_MATRIX_MAX_PROGRAMS = 25;
export const FINAL_WRITEUP_MATRIX_MAX_REVIEWERS = 50;

const CONFIG_KEYS = new Set(['version', 'programs']);
const PROGRAM_KEYS = new Set(['grantProgramId', 'reviewerIds']);

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

export function validateFinalWriteupMatrixAudienceConfig(input, { persisted = false } = {}) {
  const fail = (message) => {
    throw audienceError(
      message,
      persisted
        ? 'final_writeup_matrix_audience_config_invalid'
        : 'final_writeup_matrix_audience_config_rejected',
      persisted ? 503 : 400,
    );
  };
  if (!exactKeys(input, CONFIG_KEYS)
    || input.version !== FINAL_WRITEUP_MATRIX_AUDIENCE_VERSION
    || !Array.isArray(input.programs)) {
    fail(`Matrix audience configuration must contain only version ${FINAL_WRITEUP_MATRIX_AUDIENCE_VERSION} and a programs array.`);
  }
  if (input.programs.length > FINAL_WRITEUP_MATRIX_MAX_PROGRAMS) {
    fail(`Matrix audience configuration supports at most ${FINAL_WRITEUP_MATRIX_MAX_PROGRAMS} grant programs.`);
  }
  if (input.programs.length === 0) {
    fail('Matrix audience configuration must contain at least one Grant Program audience.');
  }

  const seenPrograms = new Set();
  const programs = input.programs.map((program) => {
    const grantProgramId = String(program?.grantProgramId || '').toLowerCase();
    if (!exactKeys(program, PROGRAM_KEYS) || !isGuid(grantProgramId)
      || !Array.isArray(program.reviewerIds) || program.reviewerIds.length === 0) {
      fail('Every configured grant program must contain only a Grant Program GUID and at least one reviewer GUID.');
    }
    if (program.reviewerIds.length > FINAL_WRITEUP_MATRIX_MAX_REVIEWERS) {
      fail(`Each grant program supports at most ${FINAL_WRITEUP_MATRIX_MAX_REVIEWERS} reviewers.`);
    }
    if (seenPrograms.has(grantProgramId)) fail(`Duplicate Grant Program configuration: ${grantProgramId}.`);
    seenPrograms.add(grantProgramId);

    const seenReviewers = new Set();
    const reviewerIds = program.reviewerIds.map((value) => {
      const reviewerId = String(value || '').toLowerCase();
      if (!isGuid(reviewerId)) fail('Every configured reviewer must be a systemuser GUID.');
      if (seenReviewers.has(reviewerId)) fail(`Duplicate reviewer in Grant Program ${grantProgramId}: ${reviewerId}.`);
      seenReviewers.add(reviewerId);
      return reviewerId;
    });
    return { grantProgramId, reviewerIds };
  });

  return {
    version: FINAL_WRITEUP_MATRIX_AUDIENCE_VERSION,
    programs: programs.sort((left, right) => left.grantProgramId.localeCompare(right.grantProgramId)),
  };
}

async function readStoredConfig(dependencies) {
  let result;
  try {
    result = await dependencies.getSettingStrict(FINAL_WRITEUP_MATRIX_AUDIENCE_SETTING_KEY);
  } catch (error) {
    throw audienceError(
      'The Final Writeup matrix audience configuration could not be loaded.',
      'final_writeup_matrix_audience_config_unavailable',
      503,
    );
  }
  if (!result?.found) {
    return {
      configured: false,
      config: { version: FINAL_WRITEUP_MATRIX_AUDIENCE_VERSION, programs: [] },
      revision: null,
    };
  }
  if (typeof result.revision !== 'string' || !result.revision) {
    throw audienceError(
      'The saved Final Writeup matrix audience revision is unavailable.',
      'final_writeup_matrix_audience_revision_unavailable',
      503,
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(String(result.value || ''));
  } catch {
    throw audienceError(
      'The saved Final Writeup matrix audience configuration is not valid JSON.',
      'final_writeup_matrix_audience_config_invalid',
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
      'final_writeup_matrix_audience_reviewer_scope_exceeded',
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
      'The Final Writeup reviewer role requires reconciliation before matrix audiences can be configured.',
      'final_writeup_matrix_audience_reviewer_roster_invalid',
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
      `Matrix audience configuration supports at most ${FINAL_WRITEUP_MATRIX_MAX_PROGRAMS} active Grant Programs.`,
      'final_writeup_matrix_audience_program_scope_exceeded',
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
      'final_writeup_matrix_audience_program_directory_invalid',
      503,
    );
  }
  return programs.sort((left, right) => left.name.localeCompare(right.name));
}

function staleReferences(config, programs, reviewers) {
  const programIds = new Set(programs.map((program) => program.grantProgramId));
  const reviewerIds = new Set(reviewers.map((reviewer) => reviewer.reviewerId));
  return {
    grantProgramIds: config.programs
      .map((program) => program.grantProgramId)
      .filter((id) => !programIds.has(id)),
    reviewerIds: [...new Set(config.programs.flatMap((program) => program.reviewerIds))]
      .filter((id) => !reviewerIds.has(id)),
  };
}

export async function getFinalWriteupMatrixAudienceAdminState(dependencies = DEFAULT_DEPENDENCIES) {
  const [stored, programs, reviewers] = await Promise.all([
    readStoredConfig(dependencies),
    loadGrantPrograms(dependencies),
    loadReviewerRoster(dependencies),
  ]);
  return {
    configured: stored.configured,
    config: stored.config,
    revision: stored.revision,
    programs,
    reviewers,
    staleReferences: staleReferences(stored.config, programs, reviewers),
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
  const staleGrantProgramIds = stored.config.programs
    .map((program) => program.grantProgramId)
    .filter((id) => !activeProgramIds.has(id));
  if (staleGrantProgramIds.length) {
    throw audienceError(
      'The saved Final Writeup matrix audience includes a Grant Program that is no longer active.',
      'final_writeup_matrix_audience_program_stale',
      503,
      { staleGrantProgramIds },
    );
  }
  const reviewersById = new Map(reviewers.map((reviewer) => [reviewer.reviewerId, reviewer]));
  const staleReviewerIds = [...new Set(stored.config.programs.flatMap((program) => program.reviewerIds))]
    .filter((id) => !reviewersById.has(id));
  if (staleReviewerIds.length) {
    throw audienceError(
      'The saved Final Writeup matrix audience includes staff who are no longer enabled members of the reviewer role.',
      'final_writeup_matrix_audience_reviewer_stale',
      503,
      { staleReviewerIds },
    );
  }
  return {
    mode: 'configured',
    fallbackReviewers: null,
    programs: stored.config.programs.map((program) => ({
      grantProgramId: program.grantProgramId,
      reviewers: program.reviewerIds.map((id) => reviewersById.get(id)),
    })),
  };
}

export async function writeFinalWriteupMatrixAudienceConfig(
  input,
  expectedRevision,
  updatedByProfileId,
  dependencies = DEFAULT_DEPENDENCIES,
) {
  if (expectedRevision !== null
    && (typeof expectedRevision !== 'string' || !expectedRevision || expectedRevision.length > 256)) {
    throw audienceError(
      'The matrix audience revision must be a Dataverse ETag or null.',
      'final_writeup_matrix_audience_revision_rejected',
      400,
    );
  }
  const config = validateFinalWriteupMatrixAudienceConfig(input);
  const [programs, reviewers] = await Promise.all([
    loadGrantPrograms(dependencies),
    loadReviewerRoster(dependencies),
  ]);
  const stale = staleReferences(config, programs, reviewers);
  if (stale.grantProgramIds.length || stale.reviewerIds.length) {
    throw audienceError(
      'Every saved matrix audience must use an active Grant Program and enabled member of the Final Writeup reviewer role.',
      'final_writeup_matrix_audience_reference_invalid',
      409,
      { staleReferences: stale },
    );
  }
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
        'Another administrator published matrix audience changes after this page loaded. Reload and review the current configuration before publishing again.',
        'final_writeup_matrix_audience_revision_conflict',
        409,
      );
    }
    throw audienceError(
      'The Final Writeup matrix audience configuration could not be saved.',
      'final_writeup_matrix_audience_save_failed',
      502,
    );
  }
  return getFinalWriteupMatrixAudienceAdminState(dependencies);
}

export const FINAL_WRITEUP_MATRIX_AUDIENCE_DEPENDENCIES = DEFAULT_DEPENDENCIES;
