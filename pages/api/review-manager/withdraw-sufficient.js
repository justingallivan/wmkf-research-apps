/**
 * Review Manager — PD selective decline ("no longer needed") (reviewer-engagement Phase 4)
 *
 * POST /api/review-manager/withdraw-sufficient
 *   body: { requestId: <GUID>, suggestionIds: <GUID[]> }
 *   → { ok: true, withdrawn: N, results: [{ suggestionId, status }] }
 *
 * When enough reviewers have accepted, the PD selects STILL-PENDING invitees and releases
 * them politely. For each: writes `wmkf_responsetype = withdrawn_sufficient` (the missing
 * writer for §2.9) + `wmkf_withdrawnsufficientat`, clears `wmkf_respondremindersentat` so no
 * reminder fires, then emails the "no longer needed" note as the lead PD.
 *
 * SETTABLE ONLY ON STILL-PENDING ROWS (invited && !accepted && !declined && no responseType),
 * server-guarded per row from a fresh read (DECISION #8) — it never touches an accepted or
 * honorarium-bearing row. State write lands BEFORE the courtesy email, so a send failure can't
 * leave a reviewer able to still respond.
 *
 * Auth: review-manager 'reviewers' (same staff-shared boundary as the rest of the surface) +
 * bypassDynamicsRestrictions. requestId + every suggestionId are GUID-validated before use.
 */

import { requireAppAccess } from '../../../lib/utils/auth';
import { isGuid, allGuids } from '../../../lib/utils/guid';
import { DynamicsService } from '../../../lib/services/dynamics-service';
import { bypassDynamicsRestrictions } from '../../../lib/services/dynamics-context';
import * as suggestionAdapter from '../../../lib/dataverse/adapters/reviewer-suggestion';
import { resolveSignatureForRequest } from '../../../lib/services/email-signature';
import { renderWithdrawSufficient } from '../../../lib/external/reviewer-withdraw-email';
import { readRequiredEmailDefaults } from '../../../lib/services/email-defaults';

const MAX_BATCH = 100;
const WITHDRAW_SUBJECT_KEY = 'email.reviewer_withdraw.subject';
const WITHDRAW_BODY_KEY = 'email.reviewer_withdraw.body';

function isStillPending(s) {
  return s
    && s.wmkf_invited === true
    && s.wmkf_accepted !== true
    && s.wmkf_declined !== true
    && (s.wmkf_responsetype == null);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const access = await requireAppAccess(req, res, 'review-manager', 'reviewers');
  if (!access) return;
  const actingUserSystemId = access.session?.user?.dynamicsSystemuserId || null;

  const requestId = typeof req.body?.requestId === 'string' ? req.body.requestId.trim() : '';
  const suggestionIds = Array.isArray(req.body?.suggestionIds) ? req.body.suggestionIds : null;
  if (!isGuid(requestId)) {
    return res.status(400).json({ error: 'requestId must be a GUID' });
  }
  if (!suggestionIds || suggestionIds.length === 0) {
    return res.status(400).json({ error: 'suggestionIds (non-empty array) is required' });
  }
  if (suggestionIds.length > MAX_BATCH) {
    return res.status(400).json({ error: `at most ${MAX_BATCH} suggestionIds per request` });
  }
  if (!allGuids(suggestionIds)) {
    return res.status(400).json({ error: 'suggestionIds must all be valid GUIDs' });
  }

  return bypassDynamicsRestrictions('review-manager-withdraw-sufficient', async () => {
    try {
      // Resolve PD sender + signature once for the request.
      let request;
      try {
        request = await DynamicsService.getRecord('akoya_requests', requestId, {
          select: 'akoya_requestid,akoya_title,_wmkf_programdirector_value',
        });
      } catch {
        request = null;
      }
      if (!request?.akoya_requestid) {
        return res.status(404).json({ error: `No request found for ${requestId}` });
      }
      let pd = null;
      if (request._wmkf_programdirector_value) {
        pd = await DynamicsService.getRecord('systemusers', request._wmkf_programdirector_value, {
          select: 'systemuserid,internalemailaddress,isdisabled',
        }).catch(() => null);
      }
      const canEmail = pd && pd.isdisabled === false && pd.internalemailaddress && pd.systemuserid;
      const signatureBlock = await resolveSignatureForRequest(requestId).catch(() => null);

      const nowIso = new Date().toISOString();
      const results = [];
      let withdrawn = 0;

      for (const id of suggestionIds) {
        const s = await suggestionAdapter.findById(id).catch(() => null);
        if (!s) { results.push({ suggestionId: id, status: 'not_found' }); continue; }
        // Belt-and-suspenders: only act on rows actually belonging to this request.
        if (s._wmkf_request_value && requestId && String(s._wmkf_request_value).toLowerCase() !== requestId.toLowerCase()) {
          results.push({ suggestionId: id, status: 'wrong_request' }); continue;
        }
        if (!isStillPending(s)) { results.push({ suggestionId: id, status: 'not_pending' }); continue; }

        // Authoritative state change FIRST (prevents the reviewer from still responding),
        // then the courtesy email. A send failure leaves them correctly withdrawn.
        //
        // If-Match on the row's _etag closes the TOCTOU window (Codex finding #2): a
        // reviewer who ACCEPTS between the pending read above and this write changes the
        // row, so the conditional write 412s and we skip — never overwriting an accepted
        // (or otherwise-changed) row to withdrawn_sufficient.
        try {
          await suggestionAdapter.updateLifecycle(id, {
            responseType: 'withdrawn_sufficient',
            withdrawnSufficientAt: nowIso,
            respondReminderSentAt: null,
          }, { actingUserSystemId, ifMatch: s._etag });
        } catch (e) {
          const is412 = e.status === 412 || /\b412\b/.test(e.message || '');
          results.push({ suggestionId: id, status: is412 ? 'changed_skipped' : 'write_failed', error: String(e.message || e).slice(0, 200) });
          continue;
        }
        withdrawn++;

        if (canEmail) {
          const reviewer = await DynamicsService.getRecord('wmkf_potentialreviewerses', s._wmkf_potentialreviewer_value, {
            select: 'wmkf_name,wmkf_emailaddress',
          }).catch(() => null);
          if (reviewer?.wmkf_emailaddress) {
            try {
              const emailDefaults = await readRequiredEmailDefaults([WITHDRAW_SUBJECT_KEY, WITHDRAW_BODY_KEY], {
                source: 'review-manager/withdraw-sufficient',
              });
              if (!emailDefaults.ok) {
                results.push({ suggestionId: id, status: 'withdrawn_email_skipped' });
                continue;
              }
              const { subject, html } = renderWithdrawSufficient({
                subjectTemplate: emailDefaults.values[WITHDRAW_SUBJECT_KEY],
                bodyTemplate: emailDefaults.values[WITHDRAW_BODY_KEY],
                reviewerName: reviewer.wmkf_name || null,
                title: request.akoya_title || null,
                signatureBlock,
              });
              await DynamicsService.createAndSendEmail({
                subject, body: html,
                from: pd.internalemailaddress,
                to: reviewer.wmkf_emailaddress,
                regardingId: requestId,
                regardingType: 'akoya_request',
                actingUserSystemId: pd.systemuserid,
                noFallback: true,
              });
              results.push({ suggestionId: id, status: 'withdrawn_emailed' });
            } catch (e) {
              results.push({ suggestionId: id, status: 'withdrawn_email_failed', error: String(e.message || e).slice(0, 200) });
            }
          } else {
            results.push({ suggestionId: id, status: 'withdrawn_no_email' });
          }
        } else {
          results.push({ suggestionId: id, status: 'withdrawn_no_pd' });
        }
      }

      return res.status(200).json({ ok: true, withdrawn, results });
    } catch (error) {
      console.error('withdraw-sufficient error:', error);
      return res.status(500).json({ error: 'Failed to withdraw reviewers' });
    }
  });
}
