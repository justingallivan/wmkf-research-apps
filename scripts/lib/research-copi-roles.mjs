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

// Post-award paperwork (reallocations, no-cost extensions, supplements, reports)
// does not describe the proposed team.
const POST_AWARD = /realloc|\bnce\b|no[\s-]*cost|extension|supplement|spending\s*plan|report|amendment|rebudget/i;

/** Proposal-stage budget, budget-justification and personnel files, by name. */
export const isBudgetFile = (name) => /budget|justification|personnel/i.test(name || '')
  && !POST_AWARD.test(name || '')
  && /\.(pdf|docx?|xlsx?)$/i.test(name || '');

/**
 * Decide one person's status from the model's report.
 * @param {{role_stated?: string, role_quote?: string, role_source?: string,
 *          in_budget?: boolean, budget_effort?: string, budget_quote?: string, budget_source?: string}} p
 * @param {boolean} facultyLevel from the first extraction
 * @param {Map<string, string>} docTexts
 * @returns {{decision: 'co-PI'|'budget-only'|'not co-PI', basis: string}}
 */
export function decideRole(p, facultyLevel, docTexts) {
  const role = String(p.role_stated || '').trim().toLowerCase();
  const roleOk = quoteVerified(p.role_quote, p.role_source, docTexts);
  if (CO_PI_ROLES.has(role)) {
    if (roleOk) return { decision: 'co-PI', basis: `stated role: ${role}` };
    return { decision: 'not co-PI', basis: `stated role ${role}, quote not found in documents` };
  }
  if (role && role !== 'none' && roleOk) return { decision: 'not co-PI', basis: `stated role: ${role}` };
  const budgetOk = Boolean(p.in_budget) && quoteVerified(p.budget_quote, p.budget_source, docTexts);
  if (budgetOk && facultyLevel && String(p.budget_effort || '').trim()) {
    return { decision: 'budget-only', basis: `budgeted effort ${String(p.budget_effort).trim()}, no stated role` };
  }
  return { decision: 'not co-PI', basis: budgetOk ? 'in budget without effort or not faculty-level' : 'no verified role or budget evidence' };
}
