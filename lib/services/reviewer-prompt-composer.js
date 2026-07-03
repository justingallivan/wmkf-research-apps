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
import { DEFAULT_REVIEWER_COUNT } from '../../shared/config/reviewerFinderPreferences.js';
import { ANALYZE_INTEGRITY_BLOCK } from '../../shared/config/prompts/reviewer-finder.js';
import { formatTrustedRequestMetadata } from './reviewer-request-context.js';

/**
 * Build the caller-formatted conditional blocks for the analyze prompt, matching
 * the legacy `createAnalysisPrompt` inline conditionals exactly.
 */
export function buildAnalyzeBlockVars({ additionalNotes = '', excludedNames = [], reviewerCount = DEFAULT_REVIEWER_COUNT } = {}) {
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

function slimAnalyzeBodyForTrustedMetadata(body) {
  const scientificSection = `## PART 1: SCIENTIFIC ANALYSIS

Dataverse has already supplied the administrative request metadata. Do not infer or rewrite TITLE, PRINCIPAL_INVESTIGATOR, CO_INVESTIGATORS, CO_INVESTIGATOR_COUNT, AUTHOR_INSTITUTION, or ABSTRACT from the proposal text.

Extract only the scientific search context needed for reviewer discovery:

PRIMARY_RESEARCH_AREA: [Main scientific discipline]
SECONDARY_AREAS: [Comma-separated list of related fields]
KEY_METHODOLOGIES: [Main techniques/approaches used]
KEYWORDS: [5-8 specific technical terms for database searching]`;

  return String(body || '').replace(
    /##\s*PART\s*1:\s*PROPOSAL METADATA[\s\S]*?(?=\n---\n\n##\s*PART\s*2:\s*REVIEWER SUGGESTIONS)/i,
    scientificSection,
  );
}

/**
 * @param {{ body: string, proposalText: string, nonces?: string[],
 *   additionalNotes?: string, excludedNames?: string[], reviewerCount?: number,
 *   repairInstructions?: string, requestContext?: Object|null }} args
 *   `proposalText` is the ALREADY-WRAPPED (nonce-bearing) proposal text.
 * @returns {string} the final prompt
 */
export function composeAnalyzePrompt({ body, proposalText, nonces = [], additionalNotes = '', excludedNames = [], reviewerCount = DEFAULT_REVIEWER_COUNT, repairInstructions = '', requestContext = null }) {
  const vars = {
    proposal_text: proposalText,
    ...buildAnalyzeBlockVars({ additionalNotes, excludedNames, reviewerCount }),
  };
  const trustedMetadata = formatTrustedRequestMetadata(requestContext);
  const effectiveBody = trustedMetadata ? slimAnalyzeBodyForTrustedMetadata(body) : body;
  const trustedMetadataBlock = trustedMetadata ? `${trustedMetadata}\n\n` : '';
  const repairBlock = repairInstructions
    ? `\n\n**REPAIR INSTRUCTIONS (TRUSTED SYSTEM-OWNED BLOCK):**\n${repairInstructions.trim()}`
    : '';
  // ANALYZE_INTEGRITY_BLOCK is appended for every body (incl. Dataverse
  // overrides) so the anti-fabrication guardrail can't be edited away. Mirrors
  // the legacy createAnalysisPrompt tail, preserving byte-parity.
  return `${buildUntrustedContentPreamble(nonces)}\n\n${trustedMetadataBlock}${interpolate(effectiveBody, vars)}${ANALYZE_INTEGRITY_BLOCK}${repairBlock}`;
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
