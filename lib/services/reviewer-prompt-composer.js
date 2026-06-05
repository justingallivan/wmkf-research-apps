/**
 * Reviewer-finder prompt composer (S222, Path A seam).
 *
 * Assembles the FINAL Claude prompt from a resolved editable body:
 *   [ code-owned A7 preamble(nonces) ]  +  [ interpolated body ]
 *
 * The A7 boundary (preamble + the wrapping of proposal/candidate/summary text)
 * is ALWAYS code-owned and lives here / in the service — never in the editable
 * body. The body carries only `{{placeholders}}`; the service fills them with
 * already-wrapped, nonce-bearing text and passes the nonce(s) in.
 *
 * Server-side only (imports the Dynamics-backed prompt-store for `interpolate`).
 * The `composeAnalyzePrompt` output is byte-identical to the legacy
 * `createAnalysisPrompt` for the same inputs (a parity test guards this).
 */
import { buildUntrustedContentPreamble } from '../utils/ai-payload-boundary.js';
import { interpolate } from './prompt-store.js';

/**
 * Build the caller-formatted conditional blocks for the analyze prompt, matching
 * the legacy `createAnalysisPrompt` inline conditionals exactly.
 */
export function buildAnalyzeBlockVars({ additionalNotes = '', excludedNames = [], reviewerCount = 12 } = {}) {
  return {
    additional_notes_block: additionalNotes
      ? `**ADDITIONAL CONTEXT FROM USER:**\n${additionalNotes}\n`
      : '',
    excluded_names_block: (excludedNames && excludedNames.length > 0)
      ? `\n**EXCLUDED NAMES (conflicts of interest - do NOT suggest these):**\n${excludedNames.join(', ')}\n`
      : '',
    reviewer_count: String(reviewerCount),
  };
}

/**
 * @param {{ body: string, proposalText: string, nonces?: string[],
 *   additionalNotes?: string, excludedNames?: string[], reviewerCount?: number }} args
 *   `proposalText` is the ALREADY-WRAPPED (nonce-bearing) proposal text.
 * @returns {string} the final prompt
 */
export function composeAnalyzePrompt({ body, proposalText, nonces = [], additionalNotes = '', excludedNames = [], reviewerCount = 12 }) {
  const vars = {
    proposal_text: proposalText,
    ...buildAnalyzeBlockVars({ additionalNotes, excludedNames, reviewerCount }),
  };
  return `${buildUntrustedContentPreamble(nonces)}\n\n${interpolate(body, vars)}`;
}

/**
 * @param {{ body: string, proposalSummaryText: string, candidatesText: string, nonces?: string[] }} args
 *   Both `proposalSummaryText` and `candidatesText` are ALREADY-WRAPPED text;
 *   `nonces` must include both wrapping nonces (summary + candidates).
 * @returns {string} the final prompt
 */
export function composeScorePrompt({ body, proposalSummaryText, candidatesText, nonces = [] }) {
  const vars = {
    proposal_summary: proposalSummaryText,
    candidates_list: candidatesText,
  };
  return `${buildUntrustedContentPreamble(nonces)}\n\n${interpolate(body, vars)}`;
}
