/**
 * API Route: /api/admin/prompts/[name]
 *
 * Superuser-only. Versioned publish for a `wmkf_ai_prompt` row, adapting the
 * `pages/api/admin/policies.js` protocol to the prompt store's "same-name rows
 * discriminated by `wmkf_ai_iscurrent` + integer `wmkf_promptversion`" model
 * (no parent/child, no activeVersion pointer).
 *
 * GET  — current row (full editable metadata) + recent version history.
 * PUT  — publish a new version. Body:
 *        { body, systemPrompt?, variables?, model?, expectedVersion?, requestId? }.
 *
 * Thin route shell (Route→Service Consolidation Plan, Stage 5): multi-verb
 * dispatch inside ONE withDalContext (the historical route had a single shared
 * auth/trust boundary for both verbs — P1m base case; existing label kept) →
 * one service call per verb → per-verb result/error→HTTP mapping. Business
 * logic (publish protocol, torn-state resume, audit) lives in
 * lib/services/admin/prompts-publish-service.js.
 */
import { requireSuperuser } from '../../../../lib/utils/auth';
import { withDalContext } from '../../../../lib/dataverse/core/context';
import { ServiceHttpError } from '../../../../lib/services/service-http-error';
import { getPrompt, publishPrompt } from '../../../../lib/services/admin/prompts-publish-service';

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'PUT') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const gate = await requireSuperuser(req, res);
  if (!gate) return;

  const name = String(req.query.name || '');
  if (!name) return res.status(400).json({ error: 'prompt name required' });

  try {
    return await withDalContext('admin-prompts-publish', async () => {
      if (req.method === 'GET') {
        try {
          return res.json(await getPrompt(name));
        } catch (err) {
          if (err instanceof ServiceHttpError) {
            return res.status(err.httpStatus).json(err.body ?? { error: err.message });
          }
          throw err;
        }
      }
      // PUT (publish)
      const { body, systemPrompt, variables, model, expectedVersion } = req.body || {};
      const requestId = (req.body && req.body.requestId) || undefined;
      try {
        const outcome = await publishPrompt({
          name,
          body,
          systemPrompt,
          variables,
          model,
          expectedVersion,
          requestId,
          profileId: gate.profileId,
        });
        return res.status(200).json(outcome);
      } catch (err) {
        if (err instanceof ServiceHttpError) {
          return res.status(err.httpStatus).json(err.body ?? { error: err.message });
        }
        throw err;
      }
    });
  } catch (err) {
    console.error('[admin/prompts/[name]] unexpected error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
}
