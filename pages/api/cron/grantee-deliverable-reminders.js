/**
 * Cron: queue newly invited grantee reminders for day 12 and process the due ledger.
 *
 * Each run reads Invited deliverables with invite dates and creates or repairs
 * `scheduled_email_messages` ledger rows. New reminders are scheduled for
 * invite date + 12 days; Postgres enforces send time, leases, and approval.
 * The cron does not move the Dataverse row before sending.
 * Successful delivery is finalized back to Dataverse after the ledger records
 * the send. Sent-but-unfinalized rows can be repaired without another send.
 *
 * Thin route shell (Route→Service Consolidation Plan, Stage 5): method
 * dispatch → verifyCronSecret (byte-untouched) → withDalContext (historical
 * label kept, same scope — the email-defaults read ran inside the historical
 * bypass and still runs inside this context via the service) → one service
 * call → result/error→HTTP mapping. Queue creation, per-row fail-soft,
 * recipient/PD resolution, and scheduled-email dispatch/finalization live in
 * lib/services/cron/grantee-deliverable-reminders-service.js.
 */

import { verifyCronSecret } from '../../../lib/utils/cron-auth';
import { withDalContext } from '../../../lib/dataverse/core/context';
import { ServiceHttpError } from '../../../lib/services/service-http-error';
import { runGranteeDeliverableReminders } from '../../../lib/services/cron/grantee-deliverable-reminders-service';

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!verifyCronSecret(req, res)) return;

  return withDalContext('grantee-deliverable-reminders-cron', async () => {
    try {
      const summary = await runGranteeDeliverableReminders();
      return res.status(200).json(summary);
    } catch (err) {
      if (err instanceof ServiceHttpError) {
        return res.status(err.httpStatus).json(err.body ?? { error: err.message });
      }
      throw err;
    }
  });
}
