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
import { ContactParser } from '../utils/contact-parser.js';
import { expertProfileLinks, expertMetrics } from '../../shared/utils/field-primer-display.js';

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
 * @returns {Promise<{ primer: Object, runId: string, model: string|null, promptName: string|null, promptVersion: (string|number|null), usage: Object|null }>}
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
    promptName: result.meta?.promptName ?? null,
    promptVersion: result.meta?.promptVersion ?? null,
    usage: result.usage ?? null,
  };
}

const GROUND_MIN_WORKS = 5;   // floor to treat an OpenAlex author cluster as real
const CORRECT_MIN_WORKS = 10; // higher floor to RENAME (suggest a correction) than to confirm
const CONSENSUS_MIN = 2;      // a topic must appear in >=N confirmations to anchor the field
// Bound how many OpenAlex grounding lookups run at once. Each pass (exact-name,
// then surname) fans out across experts concurrently, but is capped to protect
// the API-key request budget. searchAuthors retries 429/5xx with rate-aware
// backoff, so brief overlap remains fail-soft.
const GROUND_CONCURRENCY = 5;

// Map `items` through async `fn` with at most `limit` in flight, preserving input
// order in the result. `fn` is expected to be fail-soft (never throw) — the
// grounding tasks already catch their own OpenAlex errors — so one slow/failed
// lookup can't reject the whole batch.
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const i = cursor;
      cursor += 1;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
const NAME_SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', '2nd', '3rd']);
const surnameOf = (name) => {
  const toks = String(name || '').trim().toLowerCase().replace(/[.,]/g, '').split(/\s+/).filter(Boolean);
  while (toks.length > 1 && NAME_SUFFIXES.has(toks[toks.length - 1])) toks.pop(); // strip Jr/III/…
  return toks.length ? toks[toks.length - 1] : '';
};
const firstInitialOf = (name) => {
  // Strip a leading honorific first ("Dr. Oksana …" must yield "o", not "d") via the
  // canonical stripper that searchAuthors also uses (Codex S248).
  const m = ContactParser.stripHonorifics(String(name || '')).toLowerCase().match(/[a-z]/);
  return m ? m[0] : '';
};
const topicsOverlap = (topics, profile) =>
  profile instanceof Set && profile.size > 0 && Array.isArray(topics)
    && topics.some((t) => profile.has(String(t).toLowerCase()));
// Cheap institution corroboration: does the model's claimed affiliation share a
// meaningful token with the resolved author's OpenAlex last-known institution?
// (Both must be present; search results often carry no institution, so this is a
// bonus signal, not a requirement.) NOTE: reliable affiliation matching would need a
// per-candidate full-author fetch — that is the genuinely-deeper next increment.
const AFF_STOPWORDS = new Set(['the', 'of', 'for', 'and', 'university', 'univ', 'college',
  'institute', 'institution', 'school', 'department', 'dept', 'center', 'centre', 'lab',
  'laboratory', 'national', 'research', 'science', 'sciences', 'technology', 'state',
  // Generic institution words that would otherwise false-match unrelated orgs (Codex S248):
  'medical', 'medicine', 'health', 'hospital', 'clinic', 'clinical', 'general', 'children',
  'community', 'regional', 'system', 'systems', 'services', 'academy', 'foundation']);
const affiliationMatches = (modelAff, institution) => {
  if (!modelAff || !institution) return false;
  const toks = (s) => new Set(String(s).toLowerCase().replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/).filter((t) => t.length > 2 && !AFF_STOPWORDS.has(t)));
  const b = toks(institution);
  for (const t of toks(modelAff)) if (b.has(t)) return true;
  return false;
};

/**
 * Ground the primer's named experts against OpenAlex, to catch the knowledge-only
 * hallucination class (right surname/field, WRONG forename — e.g. "Oksana" for Olga
 * Zhaxybayeva). Uses OpenAlexService + `forenamesContradict` (the identity-evidence
 * forename comparator). Hardened against the namesake-correction hazard a Codex
 * review flagged (S248):
 *
 *  - Pass 1: exact-name search → PROVISIONAL matches (same surname, NO forename
 *    contradiction, ≥MIN works). Nothing is trusted from a single match.
 *  - FIELD ANCHOR = topics shared by ≥CONSENSUS_MIN provisional matches. A lone
 *    wrong same-name author in another field CANNOT anchor the field, so it cannot
 *    drive a downstream correction (closes the profile-poisoning hole).
 *  - Finalize:
 *      * exact match whose topics overlap the anchor (or no anchor exists) → `confirmed`;
 *        an exact match resolving OFF the anchored field → `unverified` (likely namesake).
 *      * no exact match + an anchor exists → surname search, keep same-surname authors
 *        overlapping the anchor; one must DOMINATE (only one, or ≥3× runner-up). Then:
 *        forename agrees → `confirmed`; forename contradicts AND clears CORRECT_MIN_WORKS
 *        AND is CORROBORATED (shared first initial — the hallucination class preserves the
 *        initial — OR matching affiliation) → `corrected` (SUGGESTED, `needsVerification`);
 *        forename contradicts but NO corroboration → `unverified` (likely a different person,
 *        do NOT suggest a rename); otherwise → `unverified`.
 *      * no exact match + no anchor → `unverified` (nothing to disambiguate against).
 *  We NEVER silently bind a namesake; a correction is always surfaced as "verify". Grounding
 *  is a name-PLAUSIBILITY check (real author of that name in the field), NOT identity proof;
 *  affiliation is a bonus corroborator when present (search results often omit institution —
 *  reliable affiliation/ORCID matching would need a per-candidate full-author fetch, deferred).
 *
 * Both passes fan out across experts with bounded concurrency (GROUND_CONCURRENCY)
 * rather than one-at-a-time; the anchor barrier between pass 1 and finalize is
 * preserved, so results are identical to a sequential run — only the OpenAlex I/O
 * overlaps.
 *
 * Returns a NEW experts array with a `grounding` field on each entry. Fail-soft per
 * expert (an OpenAlex error leaves that expert `unverified`, never throws).
 *
 * @param {Array} experts - primer.experts ([{ name, affiliation, why_relevant }])
 * @param {Object} [opts]
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<Array>} experts with `.grounding = { status, resolvedName?, openAlexId?, orcid?, worksCount?, needsVerification?, note? }`
 */
export async function groundPrimerExperts(experts, { signal } = {}) {
  const list = Array.isArray(experts) ? experts : [];

  // Pass 1: provisional exact-name resolution (no single match is trusted yet).
  // The per-expert lookups are independent, so they run concurrently (bounded);
  // the anchor below is computed only AFTER all of pass 1 resolves.
  const prelim = await mapWithConcurrency(list, GROUND_CONCURRENCY, async (e) => {
    const name = String(e?.name || '').trim();
    if (!name) return { e, empty: true };
    const surname = surnameOf(name);
    let records = [];
    try { ({ records } = await OpenAlexService.searchAuthors(name, { signal, limit: 5 })); } catch { records = null; }
    const exact = (records || []).find((r) =>
      surnameOf(r.displayName) === surname
      && !forenamesContradict(name, r.displayName)
      && Number(r.worksCount) >= GROUND_MIN_WORKS) || null;
    return { e, name, surname, exact, openAlexDown: records === null };
  });

  // Field anchor = topics shared by ≥CONSENSUS_MIN provisional matches. One wrong
  // exact-match cannot anchor the field (and thus cannot drive a correction).
  const topicCounts = new Map();
  for (const p of prelim) {
    for (const t of p.exact?.topics || []) {
      const k = String(t).toLowerCase();
      topicCounts.set(k, (topicCounts.get(k) || 0) + 1);
    }
  }
  const anchor = new Set([...topicCounts].filter(([, c]) => c >= CONSENSUS_MIN).map(([t]) => t));
  const haveAnchor = anchor.size > 0;
  // Allowlist the expert fields we carry forward. The model output is only
  // {name, affiliation, why_relevant}; spreading `{...e}` would let any EXTRA key
  // the model emits (e.g. a hallucinated `email`/`phone`) ride along into the
  // persisted primer envelope, which must NEVER become a contact source. Rebuild
  // from the known display fields instead (Codex review S260).
  const base = (e) => ({ name: e?.name, affiliation: e?.affiliation, why_relevant: e?.why_relevant });
  const confirm = (e, r) => ({ ...base(e), grounding: { status: 'confirmed', resolvedName: r.displayName, openAlexId: r.openAlexId, orcid: r.orcid, worksCount: r.worksCount, institution: r.lastKnownInstitution || null, hIndex: Number.isFinite(r.hIndex) ? r.hIndex : null, citedByCount: Number.isFinite(r.citedByCount) ? r.citedByCount : null, affiliationMatch: affiliationMatches(e?.affiliation, r.lastKnownInstitution) || undefined } });
  const flag = (e, note) => ({ ...base(e), grounding: { status: 'unverified', note } });

  // Finalize: per-expert and independent given the (now-fixed) anchor, so the
  // surname-search branch fans out concurrently (bounded). Each task RETURNS its
  // grounded expert; mapWithConcurrency preserves input order, so the result is
  // identical to the sequential version — only the I/O overlaps.
  return mapWithConcurrency(prelim, GROUND_CONCURRENCY, async (p) => {
    if (p.empty) return flag(p.e, 'no name');
    const { e, name, surname, exact, openAlexDown } = p;

    if (exact) {
      return !haveAnchor || topicsOverlap(exact.topics, anchor) ? confirm(e, exact)
        : flag(e, 'name resolves but to an off-field author — possible namesake; verify');
    }
    if (openAlexDown) return flag(e, 'OpenAlex lookup failed — verify manually');
    // Without a field anchor we have nothing to disambiguate a surname against → abstain.
    if (!haveAnchor) return flag(e, 'no field anchor to disambiguate this surname — verify manually');

    let records = [];
    try { ({ records } = await OpenAlexService.searchAuthors(surname, { signal, limit: 10 })); } catch { records = null; }
    if (records === null) return flag(e, 'OpenAlex lookup failed — verify manually');
    const inField = records
      .filter((r) => surnameOf(r.displayName) === surname && Number(r.worksCount) >= GROUND_MIN_WORKS && topicsOverlap(r.topics, anchor))
      .sort((a, b) => Number(b.worksCount) - Number(a.worksCount));

    if (inField.length === 0) {
      return flag(e, 'no in-field author with this surname resolved — verify manually');
    }
    const top = inField[0];
    const dominant = inField.length === 1 || Number(top.worksCount) >= 3 * Number(inField[1].worksCount || 1);
    if (!dominant) {
      return flag(e, `multiple in-field "${surname}" namesakes — verify manually`);
    }
    if (!forenamesContradict(name, top.displayName)) {
      return confirm(e, top);
    }
    if (Number(top.worksCount) >= CORRECT_MIN_WORKS
      && (firstInitialOf(name) === firstInitialOf(top.displayName) || affiliationMatches(e?.affiliation, top.lastKnownInstitution))) {
      // SUGGESTED forename correction — only when corroborated by a shared first
      // initial (the hallucination class preserves the initial: Oksana/Olga) OR a
      // matching affiliation. surname + field + dominance alone is NOT enough to
      // suggest a rename (Codex S248). Always flagged needsVerification — never trusted.
      const affMatch = affiliationMatches(e?.affiliation, top.lastKnownInstitution);
      return { ...base(e), grounding: { status: 'corrected', resolvedName: top.displayName, openAlexId: top.openAlexId, orcid: top.orcid, worksCount: top.worksCount, institution: top.lastKnownInstitution || null, hIndex: Number.isFinite(top.hIndex) ? top.hIndex : null, citedByCount: Number.isFinite(top.citedByCount) ? top.citedByCount : null, corroboration: affMatch ? 'affiliation' : 'first-initial', needsVerification: true, note: `suggested forename correction — surname + field + ${affMatch ? 'affiliation' : 'shared first initial'} (model named "${name}"); verify it is the same person` } };
    }
    // Surname + field match a DIFFERENT forename with no initial/affiliation
    // corroboration → likely a different person; do not suggest a rename.
    return flag(e, `surname + field match a different forename ("${top.displayName}") with no initial/affiliation corroboration — likely a different person; verify`);
  });
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
    if (grounded) lines.push('_Grounded against OpenAlex — confirms a real author of that name works in the field, NOT proof of identity: ✓ confirmed · ✎ suggested forename-correction (verify same person) · ⚠ unverified (verify manually)._\n');
    for (const i of primer.experts) {
      const g = i.grounding;
      let name = i.name ?? '';
      let mark = '';
      if (g?.status === 'confirmed') mark = ` ✓${g.affiliationMatch ? ' (institution match)' : ''}`;
      else if (g?.status === 'corrected') { name = `likely ${g.resolvedName || name}`; mark = ` ✎ _(suggested via ${g.corroboration || 'field'}; model named "${i.name}"; verify same person)_`; }
      else if (g?.status === 'unverified') mark = ` ⚠ _unverified${g?.note ? ` — ${g.note}` : ''}_`;
      lines.push(`- **${name}**${mark}${i.affiliation ? ` (${i.affiliation})` : ''} — ${i.why_relevant ?? ''}`);
      // Public profile links + bibliometrics for grounded experts (orientation
      // only — never contact). Indented continuation under the expert bullet.
      const metrics = expertMetrics(g);
      const links = expertProfileLinks(g).map((l) => `[${l.label}](${l.href})`);
      const extras = [...(metrics || []), ...links];
      if (extras.length) lines.push(`  ${extras.join(' · ')}`);
    }
    lines.push('');
  }

  if (primer.proposal_placement) { h('Where this proposal sits'); p(primer.proposal_placement); }
  if (primer.caveats) { h('Caveats'); p(primer.caveats); }

  return lines.join('\n');
}
