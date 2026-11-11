/**
 * API Route: /api/admin/prompts
 *
 * Superuser-only. GET lists EVERY prompt in the `wmkf_ai_prompt` store — one
 * entry per distinct prompt name — so the /admin "Prompt templates" editor can
 * show the full inventory, including prompts that have no published current
 * version (drafts/orphans, `hasCurrent=false`). The versioned-publish write path
 * is `PUT /api/admin/prompts/[name]`.
 *
 * POST creates a brand-new prompt and publishes it as v1. Body:
 *   { name, catalog: { title, description?, group?, section?, usedBy?, usage? },
 *     body, systemPrompt?, outputSchema?, model?, maxTokens?, requestId? }
 * See createPrompt in lib/services/admin/prompts-publish-service.js.
 *
 * GET also returns the effective prompt group list (`groups`, pinned groups
 * included), the editable part, its settings revision and any storage warning
 * (lib/services/admin/prompt-groups-service.js). Groups are saved through
 * PUT /api/admin/prompt-groups.
 *
 * Thin route shell (Route→Service Consolidation Plan, Stage 5): method
 * dispatch → superuser gate → withDalContext → one service call →
 * result/error→HTTP mapping. Business logic lives in
 * lib/services/admin/prompts-list-service.js.
 */
import { requireSuperuser } from '../../../../lib/utils/auth';
import { withDalContext } from '../../../../lib/dataverse/core/context';
import { listPrompts } from '../../../../lib/services/admin/prompts-list-service';
import { createPrompt } from '../../../../lib/services/admin/prompts-publish-service';
import { getPromptGroups } from '../../../../lib/services/admin/prompt-groups-service';
import { ServiceHttpError } from '../../../../lib/services/service-http-error';

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const gate = await requireSuperuser(req, res);
  if (!gate) return;

  if (req.method === 'POST') {
    const { name, catalog, body, systemPrompt, variables, outputSchema, model, maxTokens, requestId } = req.body || {};
    try {
      return await withDalContext('admin-prompts-create', async () => {
        try {
          return res.status(200).json(await createPrompt({
            name, catalog, body, systemPrompt, variables, outputSchema, model, maxTokens,
            requestId: requestId || undefined,
            profileId: gate.profileId,
          }));
        } catch (err) {
          if (err instanceof ServiceHttpError) {
            return res.status(err.httpStatus).json(err.body ?? { error: err.message });
          }
          throw err;
        }
      });
    } catch (err) {
      console.error('[admin/prompts] create error:', err);
      return res.status(500).json({ error: 'Internal error' });
    }
  }

  try {
    return await withDalContext('admin-prompts-list', async () => {
      const [result, groups] = await Promise.all([listPrompts(), getPromptGroups()]);
      return res.json({
        ...result,
        groups: groups.groups,
        groupsEditable: groups.editable,
        groupsRevision: groups.revision,
        groupsWarning: groups.storageWarning,
      });
    });
  } catch (err) {
    console.error('[admin/prompts] list error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
}
