/**
 * Admin — Dynamics test-email service (Route→Service Consolidation Plan, Stage 5).
 *
 * Holds the business logic for POST /api/test-email; the route is a thin shell
 * (method dispatch, superuser gate, input validation, DAL context, HTTP mapping).
 *
 * Placement note (Stage 5 batch 1, owner-ratified): test-email.js is a
 * root-level route with no domain dir; superuser diagnostic tooling is an
 * admin concern class, so its service lives under lib/services/admin/.
 *
 * Contract (plan Decision 3):
 *   - plain argument object, never req/res;
 *   - returns the exact 200 envelope the route historically sent;
 *   - provider errors propagate raw; the shell maps them to the historical
 *     500 { success:false, error } envelope;
 *   - ASSUMES a trusted DAL context already exists — never establishes one.
 */

import { DynamicsService } from '../dynamics-service';

/**
 * Send (or draft) a Dynamics test email from the authenticated superuser.
 *
 * @param {Object} args
 * @param {string} args.to
 * @param {string} args.subject
 * @param {string} args.body
 * @param {string} args.from - sender email (already resolved by the shell)
 * @param {'send'|string|undefined} args.sendMode - 'send' sends; anything else drafts
 * @param {string|null} args.actingUserSystemId
 * @returns {Promise<{ success: true, emailId: string, status: 'sent'|'draft', message: string }>}
 */
export async function sendTestEmail({ to, subject, body, from, sendMode, actingUserSystemId }) {
  if (sendMode === 'send') {
    const { emailId } = await DynamicsService.createAndSendEmail({
      subject,
      body,
      from,
      to,
      actingUserSystemId,
    });
    return {
      success: true,
      emailId,
      status: 'sent',
      message: `Email sent successfully from ${from} to ${to}`,
    };
  }

  // Draft only
  const emailId = await DynamicsService.createEmailActivity({
    subject,
    body,
    from,
    to,
    actingUserSystemId,
  });
  return {
    success: true,
    emailId,
    status: 'draft',
    message: `Draft email created (not sent). Activity ID: ${emailId}`,
  };
}
