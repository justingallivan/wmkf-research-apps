/**
 * Field Primer service.
 *
 * Generates a standalone, staff-facing overview of a grant proposal's RESEARCH
 * FIELD (what it is, subareas, methods, frontiers, communities, venues, named
 * experts, where the proposal sits). It is NOT an evaluation and is NEVER a
 * reviewer-candidate source — it has no write path into discovery/save/COI,
 * which is why it may name experts (see shared/config/prompts/field-primer.js).
 *
 * Thin wrapper over the shared Executor (docs/EXECUTOR_CONTRACT.md): an
 * all-override prompt (`field-primer.generate`), so it can be called from a
 * route now or an earlier-in-process step later with proposal text alone — no
 * requestId, no Dataverse writeback (output target kind:'none' → returned).
 *
 * Knowledge-only v1. A web-grounded literature-search increment is a next-cycle
 * follow-up.
 */

import { executePrompt } from './execute-prompt.js';

export const FIELD_PRIMER_PROMPT_NAME = 'field-primer.generate';

export const PRIMER_SECTIONS = [
  'field_overview',
  'subareas',
  'key_methods',
  'frontiers',
  'communities',
  'venues',
  'experts',
  'proposal_placement',
  'caveats',
];

/**
 * Generate a field primer from proposal text.
 *
 * @param {Object} args
 * @param {string} args.proposalText - The proposal text (grantee-authored; the
 *   Executor wraps it as untrusted). Required.
 * @param {string} [args.focus] - Optional staff steer (plain phrase), woven into
 *   the prompt as a focus hint.
 * @param {string} [args.runSource='Vercel User'] - wmkf_ai_runsource picklist value.
 * @returns {Promise<{ primer: Object, runId: string, model: string|null, usage: Object|null }>}
 */
export async function generateFieldPrimer({ proposalText, focus, runSource = 'Vercel User' } = {}) {
  if (!proposalText || typeof proposalText !== 'string' || proposalText.trim().length < 50) {
    throw new Error('generateFieldPrimer: proposalText is required (min ~50 chars).');
  }

  const focus_hint = focus && String(focus).trim()
    ? ` Focus especially on: ${String(focus).trim()}.`
    : '';

  const result = await executePrompt({
    promptName: FIELD_PRIMER_PROMPT_NAME,
    overrideVariables: { proposal_text: proposalText, focus_hint },
    runSource,
    // No guarded writeback targets (output kind:'none'), so this is a no-op for
    // blocking — set true so a future targeted output never silently blocks.
    forceOverwrite: true,
  });

  if (result.blocked) {
    // Should not happen with kind:'none' outputs, but fail loud if the schema changes.
    throw new Error('Field primer run blocked unexpectedly (a guarded target was populated).');
  }

  return {
    primer: result.parsed,
    runId: result.runId,
    model: result.meta?.modelUsed ?? null,
    usage: result.usage ?? null,
  };
}

/**
 * Render a structured primer object as staff-readable markdown.
 * Tolerant of missing/extra fields so a prompt revision can't break rendering.
 *
 * @param {Object} primer - The parsed primer object.
 * @param {Object} [meta] - Optional { title } header context.
 * @returns {string} markdown
 */
export function renderPrimerMarkdown(primer = {}, meta = {}) {
  const lines = [];
  const h = (t) => lines.push(`## ${t}`);
  const p = (t) => { if (t) { lines.push(String(t)); lines.push(''); } };

  lines.push(`# Field Primer${meta.title ? `: ${meta.title}` : ''}`);
  lines.push('');
  lines.push('> Orienting field review — **not** an evaluation of the proposal and **not** vetted reviewer suggestions.');
  lines.push('');

  if (primer.field_overview) { h('Overview'); p(primer.field_overview); }

  const objList = (key, heading, fmt) => {
    const arr = Array.isArray(primer[key]) ? primer[key] : [];
    if (!arr.length) return;
    h(heading);
    for (const item of arr) lines.push(`- ${fmt(item)}`);
    lines.push('');
  };

  objList('subareas', 'Sub-areas', (i) => `**${i.name ?? ''}** — ${i.description ?? ''}`);
  objList('key_methods', 'Key methods', (i) => `**${i.name ?? ''}** — ${i.description ?? ''}`);
  objList('frontiers', 'Frontiers & why now', (i) => `**${i.frontier ?? ''}** — ${i.why_now ?? ''}`);
  objList('communities', 'Active communities', (i) => `**${i.name ?? ''}** — ${i.description ?? ''}`);

  if (Array.isArray(primer.venues) && primer.venues.length) {
    h('Notable venues');
    p(primer.venues.join(' · '));
  }

  objList('experts', 'Field experts (orienting, not vetted)', (i) =>
    `**${i.name ?? ''}**${i.affiliation ? ` (${i.affiliation})` : ''} — ${i.why_relevant ?? ''}`);

  if (primer.proposal_placement) { h('Where this proposal sits'); p(primer.proposal_placement); }
  if (primer.caveats) { h('Caveats'); p(primer.caveats); }

  return lines.join('\n');
}
