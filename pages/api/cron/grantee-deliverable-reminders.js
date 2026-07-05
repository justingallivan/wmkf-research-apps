/**
 * Cron: automatic grantee deliverable day-12 reminders.
 *
 * Selects package rows still Invited at least 12 days after first invite. Each
 * row is claimed before email send by moving it out of Invited, so a post-send
 * failure cannot double-send on the next run.
 *
 * Thin route shell (Route→Service Consolidation Plan, Stage 5): method
 * dispatch → verifyCronSecret (byte-untouched) → withDalContext (historical
 * label kept, same scope — the email-defaults read ran inside the historical
 * bypass and still runs inside this context via the service) → one service
 * call → result/error→HTTP mapping. Batch orchestration (claim-before-send
 * idempotency, per-row fail-soft, recipient/PD resolution) lives in
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
