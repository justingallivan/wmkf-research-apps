/**
 * API Route: POST /api/field-primer/generate
 *
 * Generates a standalone, staff-facing FIELD PRIMER for a grant proposal's
 * research field. Decoupled from reviewer-candidate origination (no
 * discovery/save/COI write path) — gated under the reviewer-finder app.
 *
 * Body: { proposalText: string, focus?: string }
 * Returns: { primer, runId, model }
 *
 * Untrusted-content hardening + model resolution + audit logging all live in
 * the Executor (executePrompt → field-primer.generate). See docs/EXECUTOR_CONTRACT.md.
 */

import { requireAppAccess } from '../../../lib/utils/auth';
import { loadModelOverrides } from '../../../lib/services/model-override-loader';
import { generateFieldPrimer } from '../../../lib/services/field-primer-service';

const APP_KEY = 'reviewer-finder';

export const config = {
  api: { bodyParser: { sizeLimit: '2mb' } },
  maxDuration: 800,
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const access = await requireAppAccess(req, res, APP_KEY);
  if (!access) return;

  // Warm the model-override cache before the Executor resolves the prompt's model.
  await loadModelOverrides();

  const { proposalText, focus } = req.body || {};
  if (!proposalText || typeof proposalText !== 'string' || proposalText.trim().length < 50) {
    return res.status(400).json({ error: 'proposalText is required (min ~50 chars).' });
  }

  try {
    const { primer, runId, model } = await generateFieldPrimer({
      proposalText,
      focus: typeof focus === 'string' ? focus : undefined,
      runSource: 'Vercel Interactive',
    });
    return res.status(200).json({ primer, runId, model });
  } catch (err) {
    console.error('[field-primer/generate] failed:', err.message);
    return res.status(500).json({ error: 'Field primer generation failed.' });
  }
}
