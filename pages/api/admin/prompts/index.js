/**
 * API Route: /api/admin/prompts
 *
 * Superuser-only. GET lists EVERY prompt in the `wmkf_ai_prompt` store — one
 * entry per distinct prompt name — so the /admin "Prompt templates" editor can
 * show the full inventory, including prompts that have no published current
 * version (drafts/orphans, `hasCurrent=false`). The versioned-publish write path
 * is `PUT /api/admin/prompts/[name]`.
 *
 * Read-only here. Two filtered queries (current + non-current) avoid the
 * unfiltered-query record cap and the `ne null` filter gotcha; they're merged so
 * a name with a current row is represented by it, and a name with only
 * non-current rows surfaces its latest version flagged as a draft.
 */
import { requireSuperuser } from '../../../../lib/utils/auth';
import { DynamicsService } from '../../../../lib/services/dynamics-service';
import { bypassDynamicsRestrictions } from '../../../../lib/services/dynamics-context';

const PROMPTS_ENTITY = 'wmkf_ai_prompts';
const SELECT = [
  'wmkf_ai_promptid', 'wmkf_ai_promptname', 'wmkf_promptversion', 'wmkf_ai_iscurrent',
  'wmkf_ai_promptstatus', 'wmkf_ai_systemprompt', 'wmkf_ai_promptbody',
  'wmkf_ai_promptvariables', 'wmkf_ai_promptoutputschema', 'wmkf_ai_model',
  'wmkf_ai_temperature', 'wmkf_ai_maxtokens',
].join(',');

function mapRow(r, { hasCurrent }) {
  return {
    id: r.wmkf_ai_promptid,
    name: r.wmkf_ai_promptname,
    version: r.wmkf_promptversion ?? null,
    isCurrent: !!r.wmkf_ai_iscurrent,
    hasCurrent,
    status: r.wmkf_ai_promptstatus ?? null,
    systemPrompt: r.wmkf_ai_systemprompt || '',
    body: r.wmkf_ai_promptbody || '',
    variables: r.wmkf_ai_promptvariables || null,
    outputSchema: r.wmkf_ai_promptoutputschema || null,
    model: r.wmkf_ai_model || null,
    temperature: r.wmkf_ai_temperature ?? null,
    maxTokens: r.wmkf_ai_maxtokens ?? null,
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const gate = await requireSuperuser(req, res);
  if (!gate) return;

  try {
    return await bypassDynamicsRestrictions('admin-prompts-list', async () => {
      const [currentRes, nonCurrentRes] = await Promise.all([
        DynamicsService.queryRecords(PROMPTS_ENTITY, {
          select: SELECT, filter: 'wmkf_ai_iscurrent eq true', orderby: 'wmkf_ai_promptname asc', top: 200,
        }),
        DynamicsService.queryRecords(PROMPTS_ENTITY, {
          select: SELECT, filter: 'wmkf_ai_iscurrent eq false', orderby: 'wmkf_promptversion desc', top: 200,
        }),
      ]);

      const byName = new Map();
      for (const r of currentRes.records || []) byName.set(r.wmkf_ai_promptname, mapRow(r, { hasCurrent: true }));

      // Surface names that have ONLY non-current rows (drafts/orphans, no current
      // version). For names that already have a current row, their non-current
      // rows are version history, not separate inventory entries.
      for (const r of nonCurrentRes.records || []) {
        const name = r.wmkf_ai_promptname;
        if (byName.has(name)) continue;
        const existing = byName.get(`__draft__${name}`);
        if (!existing || (r.wmkf_promptversion ?? 0) > (existing.version ?? 0)) {
          byName.set(`__draft__${name}`, mapRow(r, { hasCurrent: false }));
        }
      }

      const prompts = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
      return res.json({ prompts });
    });
  } catch (err) {
    console.error('[admin/prompts] list error:', err);
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
}
