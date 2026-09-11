/**
 * Automatic applicant-materials reminder (docs/APPLICANT_ADDITIONAL_MATERIALS_PLAN.md
 * §16.3, PR 3; owner M5 follow-up). Policy, fire-once and claim-before-send:
 *
 *   A collection gets ONE automatic reminder, on the first run after its due
 *   date has passed, when a required item is still missing and no reminder of
 *   any kind (PC-sent or automatic) has been recorded on or after the due
 *   date. The claim is a conditional UPDATE that stamps `last_reminder_at` and
 *   increments `reminder_count` BEFORE the email goes out, so a concurrent run
 *   or a PC reminder sent in between can never produce a second email. A send
 *   failure after the claim is logged and counted, not retried (at-most-once:
 *   the card then shows "reminded" with no email id).
 *
 * Sender: the PC who started the collection (`created_by` → systemuser
 * mailbox); a collection whose creator is disabled or has no mailbox is
 * skipped and counted. Recipients and link are the collection's own (contacts
 * snapshot, sealed contributor link), exactly as the PC's "Send reminder"
 * action. Every precondition a send needs (missing items, recipients, sender,
 * readable link) is checked BEFORE the claim, so a stamped reminder with no
 * email only ever means a transport failure.
 *
 * Designed for cron use: bounded batch, fail-soft per row, `dryRun` reports
 * eligibility without claiming or sending.
 */
import * as grantRequestAdapter from '../../dataverse/adapters/grant-request.js';
import * as requestDocumentAdapter from '../../dataverse/adapters/request-document.js';
import * as siteVisitAdapter from '../../dataverse/adapters/site-visit.js';
import * as systemUserAdapter from '../../dataverse/adapters/system-user.js';
import { decrypt } from '../../utils/encryption.js';
import { isSiteVisitMaterialsSchemaReady } from '../../utils/site-visit-materials-readiness.js';
import { selectActiveSiteVisit } from '../deliberation-briefing/site-visit-selection.js';
import {
  DEFAULT_DEPENDENCIES as COLLECTION_DEPENDENCIES,
  matchReceivedFiles,
  missingRequiredItems,
  sendReminderEmail,
} from './collection-service.js';
import * as store from './collection-store.js';

const REQUEST_SELECT = ['akoya_requestid', 'akoya_requestnum', 'akoya_title', '_akoya_applicantid_value'];

export const DEFAULT_DEPENDENCIES = Object.freeze({
  schemaReady: isSiteVisitMaterialsSchemaReady,
  listDue: store.listCollectionsDueForAutomaticReminder,
  claim: store.claimAutomaticReminder,
  attachEmailId: store.attachReminderEmailId,
  getRequest: (requestId) => grantRequestAdapter.getById(requestId, { select: REQUEST_SELECT }),
  findDocumentsByRequest: (requestId) => requestDocumentAdapter.findByRequest(requestId),
  findActiveSiteVisit: async (requestId) => {
    const { records } = await siteVisitAdapter.findActiveByRequest(requestId);
    return selectActiveSiteVisit(records);
  },
  getSender: async (systemUserId) => {
    const user = await systemUserAdapter.getById(systemUserId);
    if (!user?.internalemailaddress || user.isdisabled === true) return null;
    return { email: String(user.internalemailaddress).trim().toLowerCase(), systemUserId };
  },
  canReadLink: (row) => { try { return Boolean(decrypt(row.token_ciphertext)); } catch { return false; } },
  sendReminder: (args) => sendReminderEmail(args, COLLECTION_DEPENDENCIES),
  now: () => new Date(),
});

function emptyResult(dryRun) {
  return { dryRun, scanned: 0, eligible: 0, sent: 0, skippedNothingMissing: 0, skippedNoRecipient: 0, skippedNoSender: 0, skippedLinkUnreadable: 0, claimLost: 0, sendFailed: 0, errors: [] };
}

export async function sweepMaterialsReminders({ maxBatch = 100, dryRun = false } = {}, dependencies = DEFAULT_DEPENDENCIES) {
  const result = emptyResult(dryRun);
  if (!dependencies.schemaReady()) return { ...result, skipped: 'schema_not_ready' };
  const now = dependencies.now();
  const rows = (await dependencies.listDue(now)).slice(0, maxBatch);
  result.scanned = rows.length;

  for (const row of rows) {
    const label = row.id;
    try {
      const request = await dependencies.getRequest(row.request_id);
      if (!request?.akoya_requestid) throw new Error('request not found');
      const documents = await dependencies.findDocumentsByRequest(row.request_id);
      const { received } = matchReceivedFiles(documents?.records, row.request_id, request.akoya_requestnum);
      const missing = missingRequiredItems(row, received);
      if (missing.length === 0) { result.skippedNothingMissing += 1; continue; }
      if (!['pi', 'liaison'].some((role) => row.contacts?.[role]?.email)) { result.skippedNoRecipient += 1; result.errors.push({ id: label, error: 'collection has no contact email' }); continue; }
      if (!dependencies.canReadLink(row)) { result.skippedLinkUnreadable += 1; result.errors.push({ id: label, error: 'contributor link cannot be read' }); continue; }
      const sender = await dependencies.getSender(row.created_by);
      if (!sender?.email) { result.skippedNoSender += 1; result.errors.push({ id: label, error: 'collection creator has no mailbox' }); continue; }
      result.eligible += 1;
      if (dryRun) continue;

      const claimed = await dependencies.claim(row.id, now);
      if (!claimed) { result.claimLost += 1; continue; }
      try {
        const visit = await dependencies.findActiveSiteVisit(row.request_id);
        const emailId = await dependencies.sendReminder({
          row: claimed, request, visit, missing,
          fromEmail: sender.email, actorId: sender.systemUserId,
          sequence: Number(claimed.reminder_count || 0),
        });
        await dependencies.attachEmailId(row.id, emailId);
        result.sent += 1;
      } catch (sendError) {
        // Claimed but not delivered: at-most-once, so no retry.
        result.sendFailed += 1;
        result.errors.push({ id: label, error: sendError?.message || String(sendError) });
        console.error('[site-visit-materials] automatic reminder send failed after claim:', label, sendError?.message || sendError);
      }
    } catch (error) {
      result.errors.push({ id: label, error: error?.message || String(error) });
      console.error('[site-visit-materials] automatic reminder row failed:', label, error?.message || error);
    }
  }
  return result;
}
