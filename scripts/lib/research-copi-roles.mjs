/**
 * Pure decision rules for scripts/verify-research-copi-roles.mjs (Stage B of
 * docs/plans/RESEARCH_INSTITUTION_AT_AWARD_BACKFILL_PLAN_2026-10-20.md).
 * The model reports what the documents say; these rules decide, so a model
 * claim without a quote that is really in the documents never counts.
 * Tested by tests/unit/research-copi-roles.test.js.
 */

// 'pi' = the documents call this person a PI or project leader on THIS proposal
// although they are not the lead PI (multi-PI and multi-project proposals).
export const CO_PI_ROLES = new Set(['pi', 'co-pi', 'co-investigator']);

/** Normalize text for quote matching: case, whitespace, punctuation and ligature noise from PDF extraction. */
export function normalizeForQuote(s) {
  return String(s || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[‐‑‒–—―]/g, '-')
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[^a-z0-9%.\-' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * True when the quote (at least 4 words) appears in the named document's text
 * after normalization. A quote attributed to a document we did not send fails.
 * @param {string} quote
 * @param {string} source document label the model cited
 * @param {Map<string, string>} docTexts label → normalized text
 */
export function quoteVerified(quote, source, docTexts) {
  const q = normalizeForQuote(quote);
  if (q.split(' ').filter(Boolean).length < 4) return false;
  const text = docTexts.get(source);
  return Boolean(text && text.includes(q));
}

// Post-award paperwork (reallocations, no-cost extensions = "NCE", supplements,
// reports, revised-budget approvals) does not describe the proposed team.
// `(?:^|[^a-z])nce(?:[^a-z]|$)` rather than \bnce\b: "WMKF_NCE Request" has an underscore, a word character.
const POST_AWARD = /realloc|(?:^|[^a-z])nce(?:[^a-z]|$)|no[\s-]*cost|extension|supplement|spending\s*plan|report|amendment|rebudget|revised|approval/i;

/** Proposal-stage budget, budget-justification and personnel files, by name. */
export const isBudgetFile = (name) => /budget|justification|personnel/i.test(name || '')
  && !POST_AWARD.test(name || '')
  && /\.(pdf|docx?|xlsx?)$/i.test(name || '');

const HONORIFIC = /^(dr|prof|professor|mr|mrs|ms|mx)$/;
const SUFFIX = /^(phd|md|mph|msc|ms|ma|mba|dphil|dvm|pharmd|jr|sr|ii|iii|iv|facs|frcp)$/;

/** Name tokens without honorifics, degrees and punctuation. */
export function nameTokens(name) {
  return String(name || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/\./g, '') // "Ph.D." → "phd", "Q." → "q"
    .replace(/[^a-z\s-]/g, ' ').split(/\s+/).filter(Boolean)
    .filter((t) => !HONORIFIC.test(t) && !SUFFIX.test(t));
}

/** Last name: final token after honorifics and degrees are removed. */
export const lastName = (name) => nameTokens(name).at(-1) || '';

/**
 * Match the model's entries to the listed people: exact token match first,
 * then last name + first initial when exactly one entry fits.
 * @returns {Map<string, object>} listed name → model entry
 */
export function matchPeople(listedNames, entries) {
  const out = new Map();
  const key = (n) => nameTokens(n).join(' ');
  const byKey = new Map(entries.map((e) => [key(e.name), e]));
  for (const name of listedNames) {
    const exact = byKey.get(key(name));
    if (exact) { out.set(name, exact); continue; }
    const t = nameTokens(name);
    const hits = entries.filter((e) => { const u = nameTokens(e.name); return u.at(-1) === t.at(-1) && u[0]?.[0] === t[0]?.[0]; });
    if (hits.length === 1) out.set(name, hits[0]);
  }
  return out;
}

/**
 * True when evidence is about this person: the quote contains their last name,
 * or the cited file is theirs alone (its name contains their last name).
 */
export function quoteNamesPerson(quote, source, personName) {
  const ln = lastName(personName);
  if (ln.length < 2) return false;
  const words = (s) => ` ${String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z]+/g, ' ')} `;
  return words(quote).includes(` ${ln} `) || words(source).includes(` ${ln} `);
}

/**
 * Decide one person's status from the model's report.
 * @param {{role_stated?: string, role_quote?: string, role_source?: string,
 *          in_budget?: boolean, budget_effort?: string, budget_quote?: string, budget_source?: string}} p
 * @param {boolean} facultyLevel from the first extraction
 * @param {Map<string, string>} docTexts
 * @param {string} personName the listed name; role and budget quotes must name this person
 * @returns {{decision: 'co-PI'|'budget-only'|'not co-PI', basis: string}}
 */
export function decideRole(p, facultyLevel, docTexts, personName) {
  const role = String(p.role_stated || '').trim().toLowerCase();
  const roleOk = quoteVerified(p.role_quote, p.role_source, docTexts);
  if (CO_PI_ROLES.has(role)) {
    if (!roleOk) return { decision: 'not co-PI', basis: `stated role ${role}, quote not found in documents` };
    if (!quoteNamesPerson(p.role_quote, p.role_source, personName)) return { decision: 'not co-PI', basis: `stated role ${role}, quote does not name this person` };
    return { decision: 'co-PI', basis: `stated role: ${role}` };
  }
  if (role && role !== 'none' && roleOk) return { decision: 'not co-PI', basis: `stated role: ${role}` };
  const budgetOk = Boolean(p.in_budget) && quoteVerified(p.budget_quote, p.budget_source, docTexts)
    && quoteNamesPerson(p.budget_quote, p.budget_source, personName);
  if (budgetOk && facultyLevel && String(p.budget_effort || '').trim()) {
    return { decision: 'budget-only', basis: `budgeted effort ${String(p.budget_effort).trim()}, no stated role` };
  }
  return { decision: 'not co-PI', basis: budgetOk ? 'in budget without effort or not faculty-level' : 'no verified role or budget evidence' };
}
