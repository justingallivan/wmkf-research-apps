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
import { OpenAlexService } from './openalex-service.js';
import { forenamesContradict } from './reviewer-identity-evidence.js';

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

const GROUND_MIN_WORKS = 5; // ignore tiny 1-2 work author clusters (fragments/noise)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const surnameOf = (name) => {
  const toks = String(name || '').trim().toLowerCase().replace(/[.,]/g, '').split(/\s+/).filter(Boolean);
  return toks.length ? toks[toks.length - 1] : '';
};
const topicsOverlap = (topics, profile) =>
  Array.isArray(topics) && topics.some((t) => profile.has(String(t).toLowerCase()));

/**
 * Ground the primer's named experts against OpenAlex (the existing identity spine),
 * to catch the knowledge-only hallucination class (right surname/field, WRONG
 * forename — e.g. "Oksana" for Olga Zhaxybayeva). Two-pass, abstain-don't-namesake:
 *
 *  - Pass 1: exact-name search. A record with the same surname, NO forename
 *    contradiction, and ≥MIN works → `confirmed`. Confirmed experts' OpenAlex
 *    topics seed a FIELD PROFILE used to disambiguate the rest.
 *  - Pass 2 (for the unconfirmed): surname search, keep only same-surname authors
 *    whose topics overlap the field profile and clear the works floor. If one
 *    dominates (only one, or ≥3× the runner-up's works):
 *      - forename contradicts the model's name → `corrected` (forename from record),
 *      - else → `confirmed`.
 *    Otherwise → `unverified` (multiple in-field namesakes, or no field match) — we
 *    NEVER auto-bind a namesake (the Christina lesson). If no expert confirmed in
 *    pass 1 the field profile is empty and corrections are disabled (fail-safe).
 *
 * Returns a NEW experts array with a `grounding` field on each entry. Fail-soft per
 * expert (an OpenAlex error leaves that expert `unverified`, never throws).
 *
 * @param {Array} experts - primer.experts ([{ name, affiliation, why_relevant }])
 * @param {Object} [opts]
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<Array>} experts with `.grounding = { status, resolvedName?, openAlexId?, orcid?, worksCount?, note? }`
 */
export async function groundPrimerExperts(experts, { signal } = {}) {
  const list = Array.isArray(experts) ? experts : [];
  const fieldProfile = new Set();
  const interim = [];

  // Pass 1: exact-name resolution + field-profile collection.
  for (const e of list) {
    const name = String(e?.name || '').trim();
    if (!name) { interim.push({ e, grounding: { status: 'unverified', note: 'no name' } }); continue; }
    const surname = surnameOf(name);
    let records = [];
    try { ({ records } = await OpenAlexService.searchAuthors(name, { signal, limit: 5 })); } catch { records = null; }
    const match = (records || []).find((r) =>
      surnameOf(r.displayName) === surname
      && !forenamesContradict(name, r.displayName)
      && Number(r.worksCount) >= GROUND_MIN_WORKS);
    if (match) {
      for (const t of match.topics || []) fieldProfile.add(String(t).toLowerCase());
      interim.push({ e, grounding: { status: 'confirmed', resolvedName: match.displayName, openAlexId: match.openAlexId, orcid: match.orcid, worksCount: match.worksCount } });
    } else {
      interim.push({ e, name, surname, openAlexDown: records === null });
    }
    await sleep(120);
  }

  // Pass 2: surname + field-profile disambiguation for the unconfirmed.
  const out = [];
  for (const item of interim) {
    if (item.grounding) { out.push({ ...item.e, grounding: item.grounding }); continue; }
    const { e, name, surname, openAlexDown } = item;
    let records = [];
    try { ({ records } = await OpenAlexService.searchAuthors(surname, { signal, limit: 10 })); } catch { records = null; }
    if (records === null || openAlexDown) {
      out.push({ ...e, grounding: { status: 'unverified', note: 'OpenAlex lookup failed — verify manually' } });
      await sleep(120);
      continue;
    }
    const inField = records
      .filter((r) => surnameOf(r.displayName) === surname
        && Number(r.worksCount) >= GROUND_MIN_WORKS
        && fieldProfile.size > 0 && topicsOverlap(r.topics, fieldProfile))
      .sort((a, b) => Number(b.worksCount) - Number(a.worksCount));
    if (inField.length === 0) {
      out.push({ ...e, grounding: { status: 'unverified', note: 'no in-field author with this surname resolved' } });
    } else {
      const top = inField[0];
      const dominant = inField.length === 1 || Number(top.worksCount) >= 3 * Number(inField[1].worksCount || 1);
      if (!dominant) {
        out.push({ ...e, grounding: { status: 'unverified', note: `multiple in-field "${surname}" namesakes — verify manually` } });
      } else if (forenamesContradict(name, top.displayName)) {
        out.push({ ...e, grounding: { status: 'corrected', resolvedName: top.displayName, openAlexId: top.openAlexId, orcid: top.orcid, worksCount: top.worksCount, note: `forename corrected from OpenAlex (model named "${name}")` } });
      } else {
        out.push({ ...e, grounding: { status: 'confirmed', resolvedName: top.displayName, openAlexId: top.openAlexId, orcid: top.orcid, worksCount: top.worksCount } });
      }
    }
    await sleep(120);
  }
  return out;
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

  if (Array.isArray(primer.experts) && primer.experts.length) {
    const grounded = primer.experts.some((i) => i && i.grounding);
    h('Field experts (orienting, not vetted)');
    if (grounded) lines.push('_Names grounded against OpenAlex: ✓ confirmed · ✎ forename corrected · ⚠ unverified (verify manually)._\n');
    for (const i of primer.experts) {
      const g = i.grounding;
      let name = i.name ?? '';
      let mark = '';
      if (g?.status === 'confirmed') mark = ' ✓';
      else if (g?.status === 'corrected') { name = g.resolvedName || name; mark = ` ✎ _(model named "${i.name}")_`; }
      else if (g?.status === 'unverified') mark = ' ⚠ _unverified_';
      lines.push(`- **${name}**${mark}${i.affiliation ? ` (${i.affiliation})` : ''} — ${i.why_relevant ?? ''}`);
    }
    lines.push('');
  }

  if (primer.proposal_placement) { h('Where this proposal sits'); p(primer.proposal_placement); }
  if (primer.caveats) { h('Caveats'); p(primer.caveats); }

  return lines.join('\n');
}
