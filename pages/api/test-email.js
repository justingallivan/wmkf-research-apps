/**
 * API Route: /api/test-email
 *
 * Skinny test endpoint for Dynamics email sending.
 * Superuser-only. Not a production feature — exists to verify
 * that the Dynamics email privileges are working.
 */

import { requireAppAccess } from '../../lib/utils/auth';
import { DynamicsService } from '../../lib/services/dynamics-service';
import { bypassDynamicsRestrictions } from '../../lib/services/dynamics-context';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const access = await requireAppAccess(req, res, 'dynamics-explorer');
  if (!access) return;

  const { to, subject, body, sendMode, from: bodyFrom } = req.body;

  if (!to || !subject || !body) {
    return res.status(400).json({ error: 'Missing required fields: to, subject, body' });
  }

  // Sender: authenticated user's email, or body param in dev mode
  const from = access.session?.user?.azureEmail || bodyFrom;
  if (!from) {
    return res.status(400).json({ error: 'Could not determine sender email from session' });
  }

  const actingUserSystemId = access.session?.user?.dynamicsSystemuserId || null;

  try {
    if (sendMode === 'send') {
      const { emailId } = await bypassDynamicsRestrictions('test-email-send', () =>
        DynamicsService.createAndSendEmail({
          subject,
          body,
          from,
          to,
          actingUserSystemId,
        })
      );

      return res.json({
        success: true,
        emailId,
        status: 'sent',
        message: `Email sent successfully from ${from} to ${to}`,
      });
    } else {
      // Draft only
      const emailId = await bypassDynamicsRestrictions('test-email-draft', () =>
        DynamicsService.createEmailActivity({
          subject,
          body,
          from,
          to,
          actingUserSystemId,
        })
      );

      return res.json({
        success: true,
        emailId,
        status: 'draft',
        message: `Draft email created (not sent). Activity ID: ${emailId}`,
      });
    }
  } catch (error) {
    console.error('Test email error:', error);
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}
