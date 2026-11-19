/**
 * PD discovery also requires Power Automate readiness for linked J27+ requests;
 * see shared/config/requestReadiness.js. Earlier linked cycles are unchanged.
 *
 * Resolve the Workbench's broad Grant Program scope from live Dataverse data.
 *
 * The client may request a GUID, but never supplies a trusted program name or
 * a static id. The active catalog is authoritative; the default is the one
 * unambiguous active program assigned to the caller's visible requests, with
 * the live row named Research as the bounded fallback.
 */

import { workbenchPhaseReleaseAdmitted } from '../../utils/workbench-phase-release.js';
import { measureWorkbenchLoad } from './load-timing.js';

import * as grantProgramAdapter from '../../dataverse/adapters/grant-program.js';
import * as grantRequestAdapter from '../../dataverse/adapters/grant-request.js';
import * as odata from '../../dataverse/core/odata.js';
import { isGuid } from '../../utils/guid.js';
import { parseCycleCode } from '../../utils/cycle-code.js';
import { linkedCycleCode, linkedCycleExpand } from '../../dataverse/adapters/operations-grant-cycle.js';
import { ServiceHttpError } from '../service-http-error.js';
import { withRequestReadinessSelect } from '../../../shared/config/requestReadiness.js';
import { buildDiscoveryFilter, isDiscoverableRequestRow, withDiscoverySelect } from '../../../shared/config/workbenchVisibility.js';

export const WORKBENCH_DEFAULT_PROGRAM_NAME = 'Research';
export const WORKBENCH_PROGRAM_MAX = 100;

/**
 * Programs whose J27+ requests are discoverable by readiness alone (plan F1,
 * owner decision D1): the one active program named Research, resolved from an
 * already-fetched catalog, never from the selected program and never a
 * literal id. Zero or several matches resolve to an empty scope, which keeps
 * today's composition everywhere (the same ambiguity rule the default-program
 * fallback below applies).
 */
export function readinessOnlyProgramIds(programs) {
  // Accepts raw catalog rows or already-normalized `{ programId, name }` entries.
  const normalized = (programs || []).map((row) => (row?.programId && row?.name ? normalizeProgram({ wmkf_grantprogramid: row.programId, wmkf_name: row.name }) : normalizeProgram(row)));
  const matches = [...new Map(normalized.filter(Boolean).map((p) => [p.programId, p])).values()]
    .filter((program) => program.name.toLowerCase() === WORKBENCH_DEFAULT_PROGRAM_NAME.toLowerCase());
  return matches.length === 1 ? [matches[0].programId] : [];
}

/** Discovery scope for callers that hold no program catalog: one bounded read. */
export async function resolveDiscoveryScope({ listPrograms } = {}) {
  // Merge-dark: no readiness-only discovery, and no catalog read, until admitted.
  if (!workbenchPhaseReleaseAdmitted()) return { readinessOnlyProgramIds: [] };
  const list = listPrograms || (() => grantProgramAdapter.listActive({ top: WORKBENCH_PROGRAM_MAX }));
  try {
    const result = await list();
    return { readinessOnlyProgramIds: readinessOnlyProgramIds(result?.records || result) };
  } catch (error) {
    // A failed catalog read falls back to today's composition (no readiness-only
    // branch) rather than failing the caller's whole list.
    console.warn('[program-scope] discovery catalog read failed:', error?.code || '', error?.message || error);
    return { readinessOnlyProgramIds: [] };
  }
}

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

function assignmentFilter(callerSystemId, discoveryScope) {
  return odata.and([
    odata.eqGuid('_wmkf_programdirector_value', callerSystemId),
    buildDiscoveryFilter(false, discoveryScope),
  ]);
}

/** The assignment discovery query as sent (exported so its projection can be asserted). */
export function assignmentQueryOptions(filter) {
  return {
    select: withDiscoverySelect(withRequestReadinessSelect('_wmkf_grantprogram_value')),
    expand: linkedCycleExpand(),
    filter,
    orderby: '_wmkf_grantprogram_value asc',
  };
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
    || ((filter) => grantRequestAdapter.queryAllRequests(assignmentQueryOptions(filter)));

  const programsResult = await measureWorkbenchLoad('program_catalog', () => listPrograms());
  const programs = normalizePrograms(programsResult?.records || programsResult);
  if (!programs.length) {
    throw invalid('No active Grant Programs are available.', 503);
  }
  const byId = new Map(programs.map((program) => [program.programId, program]));
  const discoveryScope = { readinessOnlyProgramIds: workbenchPhaseReleaseAdmitted() ? readinessOnlyProgramIds(programs) : [] };

  let assignedIds = [];
  let assignmentsCapped = false;
  if (callerSystemId) {
    if (!isGuid(callerSystemId)) {
      throw invalid('The signed-in program director identity is invalid.', 500);
    }
    const assigned = await measureWorkbenchLoad('program_assignments', () => queryAssignedRequests(assignmentFilter(callerSystemId, discoveryScope)));
    assignmentsCapped = Boolean(assigned?.capped || assigned?.hasMore);
    const records = (assigned?.records || []).filter((row) => isDiscoverableRequestRow(row, false, discoveryScope));
    // Defaults come from the newest visible Workbench cycle (the requests'
    // Grant Cycle links), rather than historical assignments. A caller with no
    // current visible rows uses the live Research fallback below.
    const latestCycle = records
      .map((row) => linkedCycleCode(row))
      .filter(Boolean)
      .map((cycle) => {
        const { year, month } = parseCycleCode(cycle);
        return { order: year * 100 + month, cycle };
      })
      .sort((a, b) => b.order - a.order)[0]?.cycle || null;
    assignedIds = [...new Set(records
      .filter((row) => !latestCycle || linkedCycleCode(row) === latestCycle)
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
    discoveryScope,
  };
}

export function buildProgramScopeFilter(programId) {
  if (!isGuid(programId)) throw invalid('programId must be a GUID.');
  return odata.eqGuid('_wmkf_grantprogram_value', String(programId).trim().toLowerCase());
}
