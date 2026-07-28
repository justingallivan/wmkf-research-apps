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
import { renderWithdrawSufficient, buildWithdrawSufficientBodyText } from '../../external/reviewer-withdraw-email';
import { renderPlainTextEmailHtml } from '../../external/plain-text-email-html';
import { readRequiredEmailDefaults } from '../email-defaults';
import { ServiceHttpError } from '../service-http-error';

const WITHDRAW_SUBJECT_KEY = 'email.reviewer_withdraw.subject';
const WITHDRAW_BODY_KEY = 'email.reviewer_withdraw.body';

/**
 * Domain error carrying an HTTP status for the route shell to map.
 * Extends the campaign-wide ServiceHttpError (P1 retrospective); keeps the
 * pilot's (message, httpStatus) constructor signature. No `body` — this
 * route's shell defaults to `{ error: message }`.
 */
export class WithdrawSufficientError extends ServiceHttpError {
  constructor(message, httpStatus) {
    super(message, { httpStatus });
    this.name = 'WithdrawSufficientError';
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
 * @param {Object<string, {subject?: string, bodyText?: string}>|null} [args.overrides]
 *   Per-suggestion staff edits from the review-before-send modal. Subject/body
 *   only; recipients are always re-derived server-side. A blank or absent entry
 *   falls back to the rendered template, so an untouched draft is byte-identical
 *   to the pre-modal behavior.
 * @returns {Promise<{ ok: true, withdrawn: number, results: Array<{ suggestionId: string, status: string, error?: string }> }>}
 * @throws {WithdrawSufficientError} httpStatus 404 when the request is not found
 */
async function resolveRequestContext(requestId) {
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
  return { request, pd, canEmail, signatureBlock };
}

/**
 * Render the courtesy emails WITHOUT withdrawing anyone or sending anything.
 *
 * Backs the staff review-before-send step: staff sees the exact rendered text,
 * edits it, then calls `withdrawSufficient` with the edits. Pure read — no
 * lifecycle write, no email, no token minting.
 *
 * Applies the SAME per-row guards as the send (belongs-to-request, still-pending)
 * so the modal cannot offer an editable draft for a row the send would refuse.
 * A row that fails a guard is returned with its status and no draft, rather than
 * omitted, so the caller can show why it dropped out.
 *
 * Rows are reported, never silently dropped:
 *   not_found, wrong_request, not_pending, no_email, no_pd, defaults_unavailable, ok
 *
 * @param {Object} args
 * @param {string} args.requestId - GUID (already validated by the shell)
 * @param {string[]} args.suggestionIds - GUIDs (already validated by the shell)
 * @returns {Promise<{ ok: true, drafts: Array<{ suggestionId: string, status: string,
 *   name?: string, to?: string, subject?: string, bodyText?: string }> }>}
 */
export async function renderWithdrawPreviews({ requestId, suggestionIds }) {
  const { request, canEmail, signatureBlock } = await resolveRequestContext(requestId);

  const emailDefaults = await readRequiredEmailDefaults([WITHDRAW_SUBJECT_KEY, WITHDRAW_BODY_KEY], {
    source: 'review-manager/withdraw-sufficient:preview',
  });

  const drafts = [];
  for (const id of suggestionIds) {
    const s = await suggestionAdapter.findById(id).catch(() => null);
    if (!s) { drafts.push({ suggestionId: id, status: 'not_found' }); continue; }
    if (s._wmkf_request_value && String(s._wmkf_request_value).toLowerCase() !== requestId.toLowerCase()) {
      drafts.push({ suggestionId: id, status: 'wrong_request' }); continue;
    }
    if (!isStillPending(s)) { drafts.push({ suggestionId: id, status: 'not_pending' }); continue; }
    if (!canEmail) { drafts.push({ suggestionId: id, status: 'no_pd' }); continue; }
    if (!emailDefaults.ok) { drafts.push({ suggestionId: id, status: 'defaults_unavailable' }); continue; }

    const reviewer = await getReviewerByIdWithSelect(s._wmkf_potentialreviewer_value, {
      select: 'wmkf_name,wmkf_emailaddress',
    }).catch(() => null);
    if (!reviewer?.wmkf_emailaddress) {
      drafts.push({ suggestionId: id, status: 'no_email', name: reviewer?.wmkf_name || null });
      continue;
    }

    drafts.push({
      suggestionId: id,
      status: 'ok',
      name: reviewer.wmkf_name || null,
      // Recipient is shown for confirmation only; the send re-derives it and
      // never accepts an address from the client.
      to: reviewer.wmkf_emailaddress,
      subject: emailDefaults.values[WITHDRAW_SUBJECT_KEY],
      bodyText: buildWithdrawSufficientBodyText({
        bodyTemplate: emailDefaults.values[WITHDRAW_BODY_KEY],
        reviewerName: reviewer.wmkf_name || null,
        title: request.akoya_title || null,
        signatureBlock,
      }),
    });
  }

  return { ok: true, drafts };
}

export async function withdrawSufficient({ requestId, suggestionIds, actingUserSystemId, overrides = null }) {
  // Resolve PD sender + signature once for the request.
  const { request, pd, canEmail, signatureBlock } = await resolveRequestContext(requestId);

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
          // A staff edit from the review-before-send modal replaces the rendered
          // text for THIS reviewer only. The override is already-substituted
          // final text, so it is wrapped as-is and never re-run through
          // placeholder substitution — re-substituting staff prose would let a
          // literal "{{...}}" they typed expand unexpectedly.
          //
          // Only subject/body are honoured. The recipient is re-derived from the
          // reviewer record above and never taken from the client, so an edited
          // draft cannot redirect the email.
          const override = overrides?.[id] || null;
          const rendered = renderWithdrawSufficient({
            subjectTemplate: emailDefaults.values[WITHDRAW_SUBJECT_KEY],
            bodyTemplate: emailDefaults.values[WITHDRAW_BODY_KEY],
            reviewerName: reviewer.wmkf_name || null,
            title: request.akoya_title || null,
            signatureBlock,
          });
          const overrideBody = typeof override?.bodyText === 'string' && override.bodyText.trim()
            ? override.bodyText
            : null;
          const overrideSubject = typeof override?.subject === 'string' && override.subject.trim()
            ? override.subject
            : null;
          const subject = overrideSubject || rendered.subject;
          const html = overrideBody ? renderPlainTextEmailHtml(overrideBody) : rendered.html;
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
