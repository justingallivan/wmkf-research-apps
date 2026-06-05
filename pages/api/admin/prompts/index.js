/**
 * API Route: /api/admin/prompts
 *
 * Superuser-only. GET lists every CURRENT (`wmkf_ai_iscurrent = true`) prompt row
 * in the `wmkf_ai_prompt` store with its full editable metadata, so the /admin
 * "Prompt templates" editor can list + load prompts. The versioned-publish write
 * path is `PUT /api/admin/prompts/[name]`.
 *
 * Read-only here; no mutation. Wrapped in `bypassDynamicsRestrictions` like the
 * Executor's own prompt reads.
 */
import { requireSuperuser } from '../../../../lib/utils/auth';
import { DynamicsService } from '../../../../lib/services/dynamics-service';
import { bypassDynamicsRestrictions } from '../../../../lib/services/dynamics-context';

const PROMPTS_ENTITY = 'wmkf_ai_prompts';

const LIST_SELECT = [
  'wmkf_ai_promptid', 'wmkf_ai_promptname', 'wmkf_promptversion', 'wmkf_ai_iscurrent',
  'wmkf_ai_promptstatus', 'wmkf_ai_systemprompt', 'wmkf_ai_promptbody',
  'wmkf_ai_promptvariables', 'wmkf_ai_promptoutputschema', 'wmkf_ai_model',
  'wmkf_ai_temperature', 'wmkf_ai_maxtokens',
].join(',');

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const gate = await requireSuperuser(req, res);
  if (!gate) return;

  try {
    return await bypassDynamicsRestrictions('admin-prompts-list', async () => {
      const r = await DynamicsService.queryRecords(PROMPTS_ENTITY, {
        select: LIST_SELECT,
        filter: 'wmkf_ai_iscurrent eq true',
        orderby: 'wmkf_ai_promptname asc',
        top: 200,
      });
      const prompts = (r.records || []).map((row) => ({
        id: row.wmkf_ai_promptid,
        name: row.wmkf_ai_promptname,
        version: row.wmkf_promptversion ?? null,
        status: row.wmkf_ai_promptstatus ?? null,
        systemPrompt: row.wmkf_ai_systemprompt || '',
        body: row.wmkf_ai_promptbody || '',
        variables: row.wmkf_ai_promptvariables || null,
        outputSchema: row.wmkf_ai_promptoutputschema || null,
        model: row.wmkf_ai_model || null,
        temperature: row.wmkf_ai_temperature ?? null,
        maxTokens: row.wmkf_ai_maxtokens ?? null,
      }));
      return res.json({ prompts });
    });
  } catch (err) {
    console.error('[admin/prompts] list error:', err);
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
}
