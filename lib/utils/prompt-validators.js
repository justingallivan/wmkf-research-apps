/**
 * Prompt-body validators (S222).
 *
 * BROWSER-SAFE — no server-only imports — so both the `/admin` editor and the
 * per-user `ReviewerSearchSection` panel can pre-validate a body before save.
 * Two layers:
 *   1. `validateGenericPromptBody` — structural/safety checks for ANY
 *      `wmkf_ai_prompt` row (declared vars vs placeholders, size cap, and no A7
 *      boundary/sentinel markers, which are composed in code — never in the body).
 *   2. `validateReviewerPromptBody` — per-prompt PARSE-CONTRACT checks so an edit
 *      can't silently break `parseAnalysisResponse` /
 *      `parseDiscoveredReasoningResponse` (the labels/placeholders the parser
 *      depends on must survive).
 *
 * The A7 sentinel keyword is duplicated here as a literal (mirror of
 * `UNTRUSTED_SENTINEL` in `lib/utils/ai-payload-boundary.js`) to keep this
 * module browser-safe — the boundary module pulls in `node:crypto`.
 */

const A7_FORBIDDEN_PATTERNS = [
  /WMKF-UNTRUSTED-CONTENT/i,        // the sentinel keyword
  /UNTRUSTED CONTENT RULES:/i,      // the preamble heading
  /\[\[\s*\/?\s*WMKF-/i,            // a sentinel-shaped marker
];

const DEFAULT_MAX_BODY_LENGTH = 60000;

/**
 * @param {string} body
 * @param {{ declaredVars?: string[], maxLength?: number }} [opts]
 * @returns {{ valid: boolean, issues: string[] }}
 */
export function validateGenericPromptBody(body, { declaredVars = [], maxLength = DEFAULT_MAX_BODY_LENGTH } = {}) {
  if (typeof body !== 'string' || body.trim().length === 0) {
    return { valid: false, issues: ['Prompt body is empty.'] };
  }
  const issues = [];
  if (body.length > maxLength) issues.push(`Body is ${body.length} characters; the maximum is ${maxLength}.`);

  const usedVars = new Set([...body.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]));
  const declared = new Set(declaredVars);
  if (declared.size > 0) {
    for (const u of usedVars) if (!declared.has(u)) issues.push(`Body uses an undeclared variable {{${u}}}.`);
    for (const d of declared) if (!usedVars.has(d)) issues.push(`Declared variable {{${d}}} is missing from the body.`);
  }

  for (const re of A7_FORBIDDEN_PATTERNS) {
    if (re.test(body)) {
      issues.push('Body must not contain A7 boundary/sentinel markers — the untrusted-content wrapping is composed in code, not in the editable body.');
      break;
    }
  }
  return { valid: issues.length === 0, issues };
}

/**
 * Parse contracts: the output labels + placeholders each reviewer prompt's parser
 * depends on. Derived from `parseAnalysisResponse` / `parseDiscoveredReasoningResponse`
 * in `shared/config/prompts/reviewer-finder.js`.
 */
export const REVIEWER_PARSE_CONTRACTS = {
  'reviewer-finder.analyze': {
    requiredPlaceholders: ['proposal_text'],
    requiredLabels: [
      // PART 1 metadata (parseAnalysisResponse metadataFields)
      'TITLE:', 'PROGRAM_AREA:', 'PRINCIPAL_INVESTIGATOR:', 'CO_INVESTIGATORS:',
      'CO_INVESTIGATOR_COUNT:', 'AUTHOR_INSTITUTION:', 'PRIMARY_RESEARCH_AREA:',
      'SECONDARY_AREAS:', 'KEY_METHODOLOGIES:', 'KEYWORDS:', 'ABSTRACT:',
      // PART 2 reviewer block fields
      'REVIEWER:', 'NAME:', 'INSTITUTION:', 'EXPERTISE:', 'SENIORITY:',
      'REASONING:', 'POTENTIAL_CONCERNS:', 'SOURCE:',
      // PART 3 database-search-query labels were removed S253 — the parser no
      // longer extracts them (Track-B-only consumer, archived off S248).
    ],
  },
  'reviewer-finder.score-candidates': {
    requiredPlaceholders: ['proposal_summary', 'candidates_list'],
    requiredLabels: ['RELEVANT:', 'REASONING:', 'SENIORITY:'],
  },
};

/**
 * Per-prompt parse-contract check. Returns `{ valid: true }` for any prompt name
 * not in REVIEWER_PARSE_CONTRACTS (generic validation still applies separately).
 *
 * @param {string} promptName
 * @param {string} body
 * @returns {{ valid: boolean, issues: string[] }}
 */
export function validateReviewerPromptBody(promptName, body) {
  const contract = REVIEWER_PARSE_CONTRACTS[promptName];
  if (!contract) return { valid: true, issues: [] };
  if (typeof body !== 'string') return { valid: false, issues: ['Prompt body is empty.'] };
  const issues = [];
  for (const ph of contract.requiredPlaceholders) {
    if (!new RegExp(`\\{\\{\\s*${ph}\\s*\\}\\}`).test(body)) {
      issues.push(`Missing required placeholder {{${ph}}} — the proposal/candidate data is injected there.`);
    }
  }
  for (const label of contract.requiredLabels) {
    if (!body.includes(label)) {
      issues.push(`Missing required output label "${label}" — removing it breaks result parsing.`);
    }
  }
  return { valid: issues.length === 0, issues };
}

/**
 * Run both layers for a reviewer prompt (the common save-time check).
 * @returns {{ valid: boolean, issues: string[] }}
 */
export function validatePromptForSave(promptName, body, { declaredVars = [], maxLength = DEFAULT_MAX_BODY_LENGTH } = {}) {
  const generic = validateGenericPromptBody(body, { declaredVars, maxLength });
  const specific = validateReviewerPromptBody(promptName, body);
  return { valid: generic.valid && specific.valid, issues: [...generic.issues, ...specific.issues] };
}
