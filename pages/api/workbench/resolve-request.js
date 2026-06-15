/**
 * API: /api/workbench/resolve-request
 *
 * GET ?requestNumber=1002836 → { requestId, requestNumber, cycleCode, ... }
 *
 * Resolves a human-typed/linked request NUMBER (akoya_requestnum, a STRING
 * field) to the GUID the Workbench page is keyed on, plus light context for the
 * header. Read-only; org-open like the other reviewer surfaces.
 */

import { requireAppAccess } from '../../../lib/utils/auth';
import { DynamicsService } from '../../../lib/services/dynamics-service';
import { bypassDynamicsRestrictions } from '../../../lib/services/dynamics-context';
import { meetingDateToCycleCode, cycleCodeToLabel } from '../../../lib/utils/cycle-code';
import { fetchCoPIs } from '../../../lib/services/proposal-participants';

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const access = await requireAppAccess(req, res, 'reviewers');
  if (!access) return;

  // Resolve by GUID (the Workbench route always has it) OR by human request
  // number (dashboard links / typed). GUID is preferred so the per-request shell
  // can always load context — header, empty-states, and the soft canManage gate
  // must not depend on the optional ?n= number being present (Codex S209 catch).
  const requestId = req.query.requestId ? String(req.query.requestId).trim() : '';
  const requestNumber = req.query.requestNumber ? String(req.query.requestNumber).trim() : '';
  if (!requestId && !requestNumber) {
    return res.status(400).json({ error: 'requestId or requestNumber is required' });
  }
  // GUID-validate requestId before it becomes a Dataverse record-id selector
  // (parity with the other workbench routes). requestNumber is a string lookup,
  // escaped at its filter below.
  if (requestId && !GUID_RE.test(requestId)) {
    return res.status(400).json({ error: 'requestId is not a valid GUID' });
  }

  return bypassDynamicsRestrictions('workbench-resolve-request', async () => {
    try {
      let r = null;
      if (requestId) {
        try {
          r = await DynamicsService.getRecord('akoya_requests', requestId, { select: SELECT });
        } catch (e) {
          r = null; // fall through to 404
        }
      } else {
        const safe = requestNumber.replace(/'/g, "''");
        const { records } = await DynamicsService.queryRecords('akoya_requests', {
          select: SELECT,
          filter: `akoya_requestnum eq '${safe}'`,
          top: 1,
        });
        r = records[0];
      }
      if (!r) {
        return res.status(404).json({ error: `No request found for ${requestId || `number ${requestNumber}`}` });
      }

      const cycleCode = r.wmkf_meetingdate ? meetingDateToCycleCode(r.wmkf_meetingdate) : null;
      // Co-PIs from the junction (names only). Non-critical — a failure must not
      // 500 the header/context load, so degrade to an empty list.
      const coPIs = await fetchCoPIs(r.akoya_requestid).catch(() => []);
      return res.status(200).json({
        success: true,
        requestId: r.akoya_requestid,
        requestNumber: r.akoya_requestnum,
        title: r.akoya_title || null,
        cycleCode,
        cycleLabel: cycleCode ? cycleCodeToLabel(cycleCode) : null,
        meetingDate: r.wmkf_meetingdate || null,
        requestStatus: r.akoya_requeststatus || null,
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
      });
    } catch (err) {
      console.error('workbench resolve-request error:', err);
      return res.status(500).json({
        error: 'Failed to resolve request',
        details: process.env.NODE_ENV === 'development' ? err.message : undefined,
      });
    }
  });
}
