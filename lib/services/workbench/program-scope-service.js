/**
 * Resolve the Workbench's broad Grant Program scope from live Dataverse data.
 *
 * The client may request a GUID, but never supplies a trusted program name or
 * a static id. The active catalog is authoritative; the default is the one
 * unambiguous active program assigned to the caller's visible requests, with
 * the live row named Research as the bounded fallback.
 */

import * as grantProgramAdapter from '../../dataverse/adapters/grant-program.js';
import * as grantRequestAdapter from '../../dataverse/adapters/grant-request.js';
import * as odata from '../../dataverse/core/odata.js';
import { isGuid } from '../../utils/guid.js';
import { meetingDateToCycleCode } from '../../utils/cycle-code.js';
import { ServiceHttpError } from '../service-http-error.js';
import { buildVisibilityFilter } from '../../../shared/config/workbenchVisibility.js';

export const WORKBENCH_DEFAULT_PROGRAM_NAME = 'Research';
export const WORKBENCH_PROGRAM_MAX = 100;

function normalizeProgram(row) {
  const id = String(row?.wmkf_grantprogramid || '').trim().toLowerCase();
  const name = String(row?.wmkf_name || '').trim();
  if (!isGuid(id) || !name) return null;
  return { programId: id, name };
}

function normalizePrograms(rows) {
  return [...new Map((rows || [])
    .map(normalizeProgram)
    .filter(Boolean)
    .map((program) => [program.programId, program])).values()];
}

function invalid(message, httpStatus = 400) {
  return new ServiceHttpError(message, { httpStatus });
}

function assignmentFilter(callerSystemId) {
  return odata.and([
    odata.eqGuid('_wmkf_programdirector_value', callerSystemId),
    buildVisibilityFilter(false),
  ]);
}

/**
 * Resolve active options and the selected program. Dependencies are injectable
 * so unit tests can prove the fallback and selection contract without live I/O.
 */
export async function resolveWorkbenchProgramScope({
  callerSystemId,
  programId,
  dependencies = {},
} = {}) {
  const listPrograms = dependencies.listPrograms
    || (() => grantProgramAdapter.listActive({ top: WORKBENCH_PROGRAM_MAX }));
  const queryAssignedRequests = dependencies.queryAssignedRequests
    || ((filter) => grantRequestAdapter.queryAllRequests({
      select: '_wmkf_grantprogram_value,wmkf_meetingdate',
      filter,
      orderby: '_wmkf_grantprogram_value asc',
    }));

  const programsResult = await listPrograms();
  const programs = normalizePrograms(programsResult?.records || programsResult);
  if (!programs.length) {
    throw invalid('No active Grant Programs are available.', 503);
  }
  const byId = new Map(programs.map((program) => [program.programId, program]));

  let assignedIds = [];
  let assignmentsCapped = false;
  if (callerSystemId) {
    if (!isGuid(callerSystemId)) {
      throw invalid('The signed-in program director identity is invalid.', 500);
    }
    const assigned = await queryAssignedRequests(assignmentFilter(callerSystemId));
    assignmentsCapped = Boolean(assigned?.capped);
    const records = assigned?.records || [];
    // Defaults come from the newest visible Workbench cycle, rather than
    // historical assignments. A caller with no current visible rows uses the
    // live Research fallback below.
    const latestCycle = records
      .map((row) => meetingDateToCycleCode(row?.wmkf_meetingdate))
      .filter(Boolean)
      .sort((a, b) => b.localeCompare(a))[0] || null;
    assignedIds = [...new Set(records
      .filter((row) => !latestCycle || meetingDateToCycleCode(row?.wmkf_meetingdate) === latestCycle)
      .map((row) => String(row?._wmkf_grantprogram_value || '').toLowerCase())
      .filter((id) => byId.has(id)))];
  }

  // A capped scan cannot prove that the caller has one program, so it is not
  // eligible to drive a default. The live Research row remains the fallback.
  const defaultProgram = !assignmentsCapped && assignedIds.length === 1
    ? byId.get(assignedIds[0])
    : programs.filter((program) => program.name.toLowerCase() === WORKBENCH_DEFAULT_PROGRAM_NAME.toLowerCase()).length === 1
      ? programs.find((program) => program.name.toLowerCase() === WORKBENCH_DEFAULT_PROGRAM_NAME.toLowerCase())
      : null;
  if (!defaultProgram) {
    throw invalid('The default Research Grant Program is unavailable or ambiguous.', 503);
  }

  let selected = defaultProgram;
  if (programId !== undefined && programId !== null && String(programId).trim()) {
    const requestedId = String(programId).trim().toLowerCase();
    if (!isGuid(requestedId)) throw invalid('programId must be a GUID.');
    selected = byId.get(requestedId);
    if (!selected) throw invalid('The selected Grant Program is not active.');
  }

  return {
    programs,
    defaultProgramId: defaultProgram.programId,
    programId: selected.programId,
    programName: selected.name,
  };
}

export function buildProgramScopeFilter(programId) {
  if (!isGuid(programId)) throw invalid('programId must be a GUID.');
  return odata.eqGuid('_wmkf_grantprogram_value', String(programId).trim().toLowerCase());
}
