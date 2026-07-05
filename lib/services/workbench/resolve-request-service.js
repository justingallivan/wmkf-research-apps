/**
 * Workbench — request resolution + header/Proposal-tab context service
 * (Route→Service Consolidation Plan, Stage 4 wave).
 *
 * Holds ALL business logic for GET /api/workbench/resolve-request; the route
 * is a thin shell (method dispatch, auth, input validation, DAL context, HTTP
 * mapping). Resolves a human-typed/linked request NUMBER (akoya_requestnum, a
 * STRING field) or GUID to the record the Workbench page is keyed on, plus
 * light context for the header, the Status tab, and the Proposal tab.
 *
 * Contract (plan Decision 3): plain args, plain 200 body, ServiceHttpError
 * 404 (default `{ error }` envelope) when nothing resolves; ASSUMES a trusted
 * DAL context already exists.
 */

import * as grantRequestAdapter from '../../dataverse/adapters/grant-request';
import { meetingDateToCycleCode, cycleCodeToLabel } from '../../utils/cycle-code';
import { fetchCoPIs } from '../proposal-participants';
import { classifyStatus, STATUS_CLASS } from '../dataverse-export/constants';
import { ServiceHttpError } from '../service-http-error';

const SELECT = [
  'akoya_requestid',
  'akoya_requestnum',
  'akoya_title',
  'wmkf_meetingdate',
  'akoya_requeststatus',
  'wmkf_organizationname',
  '_akoya_applicantid_value',
  '_wmkf_projectleader_value',
  '_wmkf_grantprogram_value',
  '_wmkf_programdirector_value',
  // Proposal-tab top section (S258). akoya_request = Requested Amount,
  // akoya_expenses = Total Project Budget (verified live on 1002836). Use the
  // non-_base fields; _base are the transaction-currency shadows.
  'wmkf_abstract',
  'akoya_request',
  'akoya_expenses',
  // Proposal-tab AI section.
  'wmkf_ai_fitrationale',
  'wmkf_ai_summary',
  'wmkf_ai_dataextract',
  // Persisted Field Primer JSON envelope (PD-triggered generate writes it via
  // /api/field-primer/generate; null until generated).
  'wmkf_ai_fieldprimer',
].join(',');

/**
 * Resolve by GUID (the Workbench route always has it) OR by human request
 * number (dashboard links / typed). GUID is preferred so the per-request shell
 * can always load context (Codex S209 catch). Exactly one of the two is
 * required (the shell enforces presence + GUID validity).
 *
 * @param {Object} args
 * @param {string} args.requestId - GUID or '' (already validated by the shell)
 * @param {string} args.requestNumber - human number or ''
 * @returns {Promise<Object>} the 200 response body
 * @throws {ServiceHttpError} 404 when nothing resolves
 */
export async function resolveWorkbenchRequest({ requestId, requestNumber }) {
  let r = null;
  if (requestId) {
    try {
      r = await grantRequestAdapter.getById(requestId, { select: SELECT });
    } catch (e) {
      r = null; // fall through to 404
    }
  } else {
    const { records } = await grantRequestAdapter.findByRequestNumber(requestNumber, { select: SELECT, top: 1 });
    r = records[0];
  }
  if (!r) {
    throw new ServiceHttpError(`No request found for ${requestId || `number ${requestNumber}`}`, { httpStatus: 404 });
  }

  const cycleCode = r.wmkf_meetingdate ? meetingDateToCycleCode(r.wmkf_meetingdate) : null;
  // Co-PIs from the junction (names only). Non-critical — a failure must not
  // 500 the header/context load, so degrade to an empty list.
  const coPIs = await fetchCoPIs(r.akoya_requestid).catch(() => []);
  return {
    success: true,
    requestId: r.akoya_requestid,
    requestNumber: r.akoya_requestnum,
    title: r.akoya_title || null,
    cycleCode,
    cycleLabel: cycleCode ? cycleCodeToLabel(cycleCode) : null,
    meetingDate: r.wmkf_meetingdate || null,
    requestStatus: r.akoya_requeststatus || null,
    // Status tab (S260): canonical class for the read-only Status display,
    // via the shared akoya_requeststatus value→class map. A status present
    // but absent from the authoritative map ⇒ UNCLASSIFIED (shown raw, never
    // coerced); null status ⇒ null. The board decides; the Workbench only
    // reflects this string. See lib/services/dataverse-export/constants.js.
    statusClass: r.akoya_requeststatus
      ? (classifyStatus(r.akoya_requeststatus)?.class || STATUS_CLASS.UNCLASSIFIED)
      : null,
    institution: r.wmkf_organizationname || r._akoya_applicantid_value_formatted || null,
    applicant: r._akoya_applicantid_value_formatted || null,
    projectLeader: r._wmkf_projectleader_value_formatted || null,
    grantProgram: r._wmkf_grantprogram_value_formatted || null,
    programDirector: r._wmkf_programdirector_value_formatted || null,
    // Raw lead-PD systemuser GUID — feeds the Workbench's soft `canManage`
    // UI gate (compare against the session's dynamicsSystemuserId). Server
    // stays org-open; this is cosmetic. See REQUEST_WORKBENCH_BUILD_PLAN §Phase 2.
    programDirectorId: r._wmkf_programdirector_value || null,
    // Proposal tab — top section (S258). PI mirrors projectLeader (the
    // wmkf_projectleader lookup); amounts are Money numbers (or null).
    proposalInfo: {
      pi: r._wmkf_projectleader_value_formatted || null,
      coPIs,
      abstract: r.wmkf_abstract || null,
      requestedAmount: r.akoya_request ?? null,
      totalProjectBudget: r.akoya_expenses ?? null,
    },
    // Proposal tab — AI section (existing live fields; dataExtract is a JSON
    // string the client parses).
    aiContent: {
      fitRationale: r.wmkf_ai_fitrationale || null,
      summary: r.wmkf_ai_summary || null,
      dataExtract: r.wmkf_ai_dataextract || null,
      fieldPrimer: r.wmkf_ai_fieldprimer || null, // JSON envelope string (or null)
    },
  };
}
