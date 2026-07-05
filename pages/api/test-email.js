/**
 * API Route: /api/test-email
 *
 * Skinny test endpoint for Dynamics email sending.
 * Superuser-only. Not a production feature — exists to verify
 * that the Dynamics email privileges are working.
 *
 * Thin route shell (Route→Service Consolidation Plan, Stage 5): method
 * dispatch → superuser gate → input validation → withDalContext → one service
 * call → result/error→HTTP mapping. Business logic lives in
 * lib/services/admin/test-email-service.js.
 *
 * Context labels: the historical route wrapped each sendMode branch in its own
 * bypass label (test-email-send / test-email-draft). Both branches share one
 * verb and one auth boundary (P1m base case), but the labels are preserved by
 * picking the branch label at dispatch time — same scopes, same observability.
 */

import { requireSuperuser, getSession } from '../../lib/utils/auth';
import { withDalContext } from '../../lib/dataverse/core/context';
import { sendTestEmail } from '../../lib/services/admin/test-email-service';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Superuser-only (matches this file's stated intent). Previously gated by
  // requireAppAccess('dynamics-explorer'), which let any dynamics-explorer user
  // send mail from their own Dynamics identity to arbitrary recipients — wider
  // than intended for a privilege-verification test endpoint (eval #11).
  const gate = await requireSuperuser(req, res);
  if (!gate) return;

  // requireSuperuser returns only { profileId }; fetch the session for the
  // sender identity (it was already validated by the gate above).
  const session = await getSession(req, res);

  const { to, subject, body, sendMode, from: bodyFrom } = req.body;

  if (!to || !subject || !body) {
    return res.status(400).json({ error: 'Missing required fields: to, subject, body' });
  }

  // Sender: authenticated user's email, or body param in dev mode
  const from = session?.user?.azureEmail || bodyFrom;
  if (!from) {
    return res.status(400).json({ error: 'Could not determine sender email from session' });
  }

  const actingUserSystemId = session?.user?.dynamicsSystemuserId || null;
  const label = sendMode === 'send' ? 'test-email-send' : 'test-email-draft';

  return withDalContext(label, async () => {
    try {
      const result = await sendTestEmail({ to, subject, body, from, sendMode, actingUserSystemId });
      return res.json(result);
    } catch (error) {
      console.error('Test email error:', error);
      return res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });
}
