/**
 * Admin — prompt-store inventory service (Route→Service Consolidation Plan,
 * Stage 5).
 *
 * Holds the business logic for GET /api/admin/prompts; the route is a thin
 * shell (method dispatch, superuser gate, DAL context, HTTP mapping).
 *
 * Read-only. Two filtered queries (current + non-current) avoid the
 * unfiltered-query record cap and the `ne null` filter gotcha; they're merged
 * so a name with a current row is represented by it, and a name with only
 * non-current rows surfaces its latest version flagged as a draft.
 *
 * Contract (plan Decision 3):
 *   - no req/res; returns the exact `{ prompts }` envelope the route sends;
 *   - Dataverse errors propagate raw; the shell maps them to the historical
 *     500 `{ error: err.message }` envelope;
 *   - ASSUMES a trusted DAL context already exists — never establishes one.
 */

import * as aiPrompt from '../../dataverse/adapters/ai-prompt';

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
    // Timestamps. createdOn/publishedAt mark when THIS version came to be;
    // modifiedOn is "last touched" (a version-flip rewrites it — label accordingly).
    createdOn: r.createdon ?? null,
    publishedAt: r.wmkf_ai_publisheddatetime ?? null,
    modifiedOn: r.modifiedon ?? null,
    modifiedById: r._modifiedby_value ?? null,
    modifiedByName: r._modifiedby_value_formatted ?? null,
  };
}

/**
 * List EVERY prompt in the `wmkf_ai_prompt` store — one entry per distinct
 * prompt name, including drafts/orphans with no published current version
 * (`hasCurrent=false`).
 *
 * @returns {Promise<{ prompts: Array }>}
 */
export async function listPrompts() {
  const [currentRes, nonCurrentRes] = await Promise.all([
    aiPrompt.listCurrent(),
    aiPrompt.listNonCurrent(),
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
  return { prompts };
}
