/**
 * Review Manager — PD selective decline ("no longer needed") service
 * (Route→Service Consolidation Plan, Stage 1 pilot).
 *
 * Holds ALL business logic for POST /api/review-manager/withdraw-sufficient;
 * the route is a thin shell (auth, validation, DAL context, HTTP mapping).
 *
 * Contract (plan Decision 3):
 *   - takes a plain argument object, never req/res;
 *   - returns a plain value: { ok: true, withdrawn: N, results: [{ suggestionId, status }] };
 *   - throws WithdrawSufficientError (carries httpStatus) for domain failures
 *     the shell maps to HTTP;
 *   - ASSUMES a trusted DAL context already exists — never establishes one.
 *
 * Semantics preserved exactly from the route (characterization tests are the oracle):
 *   - SETTABLE ONLY ON STILL-PENDING ROWS (invited && !accepted && !declined &&
 *     no responseType), server-guarded per row from a fresh read (DECISION #8);
 *   - state write lands BEFORE the courtesy email — a send failure can't leave
 *     a reviewer able to still respond;
 *   - If-Match on the row's _etag closes the TOCTOU window: a reviewer who
 *     accepts between the pending read and the write 412s → 'changed_skipped';
 *   - per-suggestion partial success accumulated in results[] with statuses:
 *     not_found, wrong_request, not_pending, changed_skipped, write_failed,
 *     withdrawn_emailed, withdrawn_email_failed, withdrawn_email_skipped,
 *     withdrawn_no_email, withdrawn_no_pd.
 */

import { DynamicsService } from '../dynamics-service';
import * as suggestionAdapter from '../../dataverse/adapters/reviewer-suggestion';
import { getById as getRequestById } from '../../dataverse/adapters/grant-request';
import { getById as getSystemUserById } from '../../dataverse/adapters/system-user';
import { getByIdWithSelect as getReviewerByIdWithSelect } from '../../dataverse/adapters/potential-reviewer';
import { resolveSignatureForRequest } from '../email-signature';
import { renderWithdrawSufficient } from '../../external/reviewer-withdraw-email';
import { readRequiredEmailDefaults } from '../email-defaults';

const WITHDRAW_SUBJECT_KEY = 'email.reviewer_withdraw.subject';
const WITHDRAW_BODY_KEY = 'email.reviewer_withdraw.body';

/**
 * Domain error carrying an HTTP status for the route shell to map.
 * (Pilot-finalized shape per plan Decision 3.)
 */
export class WithdrawSufficientError extends Error {
  constructor(message, httpStatus) {
    super(message);
    this.name = 'WithdrawSufficientError';
    this.httpStatus = httpStatus;
  }
}

function isStillPending(s) {
  return s
    && s.wmkf_invited === true
    && s.wmkf_accepted !== true
    && s.wmkf_declined !== true
    && (s.wmkf_responsetype == null);
}

/**
 * Withdraw still-pending reviewer suggestions ("no longer needed") and send
 * the courtesy email as the lead PD.
 *
 * @param {Object} args
 * @param {string} args.requestId - GUID (already validated by the shell)
 * @param {string[]} args.suggestionIds - GUIDs (already validated by the shell)
 * @param {string|null} args.actingUserSystemId - Dynamics systemuser of the staff actor
 * @returns {Promise<{ ok: true, withdrawn: number, results: Array<{ suggestionId: string, status: string, error?: string }> }>}
 * @throws {WithdrawSufficientError} httpStatus 404 when the request is not found
 */
export async function withdrawSufficient({ requestId, suggestionIds, actingUserSystemId }) {
  // Resolve PD sender + signature once for the request.
  let request;
  try {
    request = await getRequestById(requestId, {
      select: 'akoya_requestid,akoya_title,_wmkf_programdirector_value',
    });
  } catch {
    request = null;
  }
  if (!request?.akoya_requestid) {
    throw new WithdrawSufficientError(`No request found for ${requestId}`, 404);
  }
  let pd = null;
  if (request._wmkf_programdirector_value) {
    pd = await getSystemUserById(request._wmkf_programdirector_value).catch(() => null);
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
      const reviewer = await getReviewerByIdWithSelect(s._wmkf_potentialreviewer_value, {
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

  return { ok: true, withdrawn, results };
}
