import { requireAppAccess } from '../../lib/utils/auth';

// Retired 2026-11-19. Original implementation is preserved in _archived/pages/api/process-phase-i.js.
// Retained grants authorize only this notice; no model, document, or data operations run.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const access = await requireAppAccess(req, res, 'batch-phase-i-summaries');
  if (!access) return;
  res.setHeader('Cache-Control', 'no-store');
  return res.status(410).json({
    error: 'This standalone application has been retired.',
    code: 'APP_RETIRED',
  });
}
