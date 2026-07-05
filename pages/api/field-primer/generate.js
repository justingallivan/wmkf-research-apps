/**
 * API Route: POST /api/field-primer/generate
 *
 * Generates a standalone, staff-facing FIELD PRIMER for a grant proposal's
 * research field. Decoupled from reviewer-candidate origination (no
 * discovery/save/COI write path).
 *
 * Two modes:
 *   - { requestId, regenerate? } — Workbench Proposal tab. Persists to
 *     `akoya_request.wmkf_ai_fieldprimer` behind an ETag-conditional lease.
 *   - { proposalText, focus? } — standalone (CLI / ad-hoc). No persistence.
 *
 * Thin route shell (Route→Service Consolidation Plan, Stage 5): method
 * dispatch → auth guard → model-override warm (route-level per the Stage 4
 * gate contract) → input validation → withDalContext (Mode A ONLY — Mode B
 * touches no Dataverse and historically ran unwrapped; scope preserved) →
 * one service call per mode → result/error→HTTP mapping. Business logic
 * lives in lib/services/field-primer/generate-service.js.
 *
 * Untrusted-content hardening + model resolution + audit logging live in the
 * Executor (executePrompt → field-primer.generate). See docs/EXECUTOR_CONTRACT.md.
 */

import { requireAppAccess } from '../../../lib/utils/auth';
import { loadModelOverrides } from '../../../lib/services/model-override-loader';
import { withDalContext } from '../../../lib/dataverse/core/context';
import { ServiceHttpError } from '../../../lib/services/service-http-error';
import { generateForRequest, generateStandalone } from '../../../lib/services/field-primer/generate-service';

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const config = {
  api: { bodyParser: { sizeLimit: '2mb' } },
  maxDuration: 800,
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Accept the standalone reviewer-finder app AND the merged Workbench `reviewers`
  // grant (the Proposal tab calls this).
  const access = await requireAppAccess(req, res, 'reviewer-finder', 'reviewers');
  if (!access) return;

  await loadModelOverrides();

  const { proposalText, focus, requestId, regenerate } = req.body || {};
  const focusArg = typeof focus === 'string' ? focus : undefined;

  // ---- Mode A: requestId (Workbench) — persisted, single-flight -------------
  if (requestId !== undefined && requestId !== null && requestId !== '') {
    if (!GUID_RE.test(String(requestId))) {
      return res.status(400).json({ error: 'requestId is not a valid GUID' });
    }
    return withDalContext('field-primer-generate', async () => {
      try {
        const result = await generateForRequest({ requestId, focus: focusArg, regenerate });
        return res.status(200).json(result);
      } catch (error) {
        if (error instanceof ServiceHttpError) {
          return res.status(error.httpStatus).json(error.body ?? { error: error.message });
        }
        throw error;
      }
    });
  }

  // ---- Mode B: proposalText (standalone) — NOT persisted ----------------------
  if (!proposalText || typeof proposalText !== 'string' || proposalText.trim().length < 50) {
    return res.status(400).json({ error: 'proposalText is required (min ~50 chars), or pass a requestId.' });
  }
  try {
    const result = await generateStandalone({ proposalText, focus: focusArg });
    return res.status(200).json(result);
  } catch (error) {
    if (error instanceof ServiceHttpError) {
      return res.status(error.httpStatus).json(error.body ?? { error: error.message });
    }
    throw error;
  }
}
