/**
 * API Route: /api/admin/prompts
 *
 * Superuser-only. GET lists EVERY prompt in the `wmkf_ai_prompt` store — one
 * entry per distinct prompt name — so the /admin "Prompt templates" editor can
 * show the full inventory, including prompts that have no published current
 * version (drafts/orphans, `hasCurrent=false`). The versioned-publish write path
 * is `PUT /api/admin/prompts/[name]`.
 *
 * Thin route shell (Route→Service Consolidation Plan, Stage 5): method
 * dispatch → superuser gate → withDalContext → one service call →
 * result/error→HTTP mapping. Business logic lives in
 * lib/services/admin/prompts-list-service.js.
 */
import { requireSuperuser } from '../../../../lib/utils/auth';
import { withDalContext } from '../../../../lib/dataverse/core/context';
import { listPrompts } from '../../../../lib/services/admin/prompts-list-service';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const gate = await requireSuperuser(req, res);
  if (!gate) return;

  try {
    return await withDalContext('admin-prompts-list', async () => {
      const result = await listPrompts();
      return res.json(result);
    });
  } catch (err) {
    console.error('[admin/prompts] list error:', err);
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
}
