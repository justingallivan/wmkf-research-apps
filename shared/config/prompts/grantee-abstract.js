/**
 * Grantee abstract (house-style rewrite) prompt — source of truth.
 *
 * Canonical text that `scripts/seed-grantee-abstract-prompt.js` writes into the
 * `grantee-abstract.generate` row in `wmkf_ai_prompts`. The live path resolves
 * the prompt from Dataverse via the Executor (`lib/services/execute-prompt.js`);
 * this file is the seed source + the A7-registry anchor (registered in
 * scripts/check-prompt-injection-tagging.js as an Executor-driven surface — the
 * untrusted-content wrapper + hardening preamble are injected by the Executor
 * around {{source_abstract}}, so this file carries no markers of its own).
 *
 * Purpose (Grantee Deliverables Portal, S268): rewrite the APPLICANT-authored
 * abstract (`akoya_request.wmkf_abstract`) into the Foundation's house style —
 * third person, tense-zoned (background = past/present, funded work = future).
 * The result is shown to the grantee in the portal to edit/approve, then stored
 * in `wmkf_abstractformatted`. See docs/GRANTEE_PORTAL_SPEC.md / _BUILD_PLAN.md.
 *
 * Output is plain prose (parseMode: 'raw', single output `abstract_formatted`,
 * target kind:'none' → RETURNED to the caller, not written back by the Executor).
 * The {{source_abstract}} slot is applicant-authored → declared untrusted in the
 * seed; the Executor wraps it + injects the A7 preamble; this prompt only
 * references the slot.
 */

export const SYSTEM_PROMPT = `You are an expert scientific editor working for the W. M. Keck Foundation. Your task is to rewrite applicant-submitted grant abstracts into the Foundation's house style. Follow these rules precisely:

## Voice and Person
- Write exclusively in the third person. Replace all first-person pronouns ("we," "our," "us") with "they," "their," or a reference to the team or institution (e.g., "the [Institution] team").
- Never use "I," "we," "our," or "us" anywhere in the output.

## Verb Tense
This is the most important structural rule. The abstract has two zones, and tense signals which zone a sentence belongs to:

1. BACKGROUND / PRIOR WORK ZONE (past or present tense): Sentences that describe the scientific problem, the gap in knowledge, existing evidence, or work the researchers have already completed. Use present tense for general scientific facts and established findings; use past tense for specific prior work by the team.

2. FUNDED WORK ZONE (future tense): Sentences that describe what the grant will fund — experiments, approaches, analyses, or outcomes. Convert all such sentences to future tense using "will" (e.g., "we will measure" → "they will measure," "we propose to develop" → "they will develop").

The transition between these zones is typically marked by the statement of the central hypothesis or research objective.

## Structure
Rewrite the abstract to follow this sequence:
1. The scientific problem or knowledge gap (present tense, general)
2. Prior work or motivating evidence (past or present tense)
3. The central hypothesis, stated explicitly (present tense: "they hypothesize that…" or "the team proposes that…")
4. The funded work: methods, experiments, and approaches (future tense)
5. The broader significance or expected impact (future tense or conditional: "would reveal," "will enable")

## Tone and Style
- Write declaratively. Remove hedging phrases like "we believe," "we hope," or "we think."
- Do not add information that is not in the original abstract.
- Do not remove scientific content or findings from the original abstract.
- Keep technical terminology intact.
- Aim for a length similar to the original.

## Output
Return only the rewritten abstract text. Do not include commentary, explanations, or notes about changes made.`;

export const USER_PROMPT_TEMPLATE = `Rewrite the following applicant-submitted grant abstract into the W. M. Keck Foundation house style, following the rules in the system instructions exactly.

Applicant abstract:
---
{{source_abstract}}

Return only the rewritten abstract text now.`;

/**
 * Executor variable declarations — the single source of truth, imported by the
 * seed script (so the live wmkf_ai_prompts row and this file cannot drift) and
 * pinned by a unit test. `source_abstract` is the applicant-authored abstract:
 * it MUST stay `untrusted:true` with a `dataClass` + integer `maxChars` so the
 * Executor wraps it (wrapUntrustedContent) and injects the A7 preamble. Dropping
 * `untrusted:true` would silently remove that injection boundary — the
 * grantee-abstract-prompt-config test fails closed on any such regression.
 */
export const PROMPT_VARIABLES = {
  variables: [
    {
      name: 'source_abstract',
      source: { kind: 'override' },
      required: true,
      cacheable: true,
      placement: 'user',
      dataClass: 'abstract',
      maxChars: 20000,
      untrusted: true,
    },
  ],
};

/**
 * Output schema. Plain prose → parseMode 'raw', a single output returned to the
 * caller (target kind:'none'); raw mode ignores jsonSchema, so none is declared.
 */
export const PROMPT_OUTPUT_SCHEMA = {
  outputs: [{ name: 'abstract_formatted', type: 'string', target: { kind: 'none' } }],
  parseMode: 'raw',
  rawOutputRetention: 'full',
};
