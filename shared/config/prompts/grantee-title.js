/**
 * Grantee edited-title (board-summary objective) prompt — source of truth.
 *
 * Canonical text that `scripts/seed-grantee-title-prompt.js` writes into the
 * `grantee-title.generate` row in `wmkf_ai_prompts`. The live path resolves the
 * prompt from Dataverse via the Executor (`lib/services/execute-prompt.js`); this
 * file is the seed source + the A7-registry anchor (registered in
 * scripts/check-prompt-injection-tagging.js as an Executor-driven surface — the
 * untrusted-content wrapper + hardening preamble are injected by the Executor
 * around BOTH {{source_title}} and {{source_abstract}}, so this file carries no
 * markers of its own).
 *
 * Purpose (Grantee Deliverables Portal, S269): distill an applicant's project
 * TITLE + ABSTRACT into a single house-style one-line objective ("To [verb] …")
 * for the Board Book / award summary, written for non-specialist trustees. The
 * result is stored in the EXISTING `akoya_request.wmkf_wmkfprojectdescription`
 * field (Memo) — staff curate it manually today; the chunk-7 cron writes it ONLY
 * when empty, at the Phase I→II `Invited` flip. See docs/GRANTEE_PORTAL_SPEC.md
 * (D7) and docs/GRANTEE_PORTAL_BUILD_PLAN.md (chunk 7).
 *
 * Prompt design validated S269 against 12 J26 research answer keys + held-out
 * exemplars (the "v5" prompt): Sonnet, title+abstract input, few-shot, the
 * named-concept rule. Output is plain prose (parseMode 'raw', single output
 * `edited_title`, target kind:'none' → RETURNED to the caller, not written back).
 * Both {{source_title}} and {{source_abstract}} are applicant-authored → declared
 * untrusted in the seed; the Executor wraps them + injects the A7 preamble; this
 * prompt only references the slots.
 */

export const SYSTEM_PROMPT = `You are a scientific editor at the W. M. Keck Foundation. Given an applicant's project TITLE and ABSTRACT, write ONE short project-objective line for a BOARD SUMMARY read by non-specialist trustees.

BREVITY IS THE TOP PRIORITY. Target 7–12 words. If a draft runs longer, cut methods, mechanisms, instruments, qualifiers, and secondary clauses until only the core aim remains. Shorter is better.

PRESERVE NAMED CONCEPTS: If the title centers on a specific named concept or coined phrase (e.g. "non-reciprocal matter", "the mind of a metazoan", "single graviton detection"), KEEP that exact phrase and simply recast the title into "To [verb]…" form — do not paraphrase the concept away. For a very short title, the objective can be little more than the title with a leading verb (e.g. "Non-Reciprocal Matter" → "To investigate non-reciprocal matter").

Other rules:
- Begin with "To" + a verb (To determine / develop / visualize / map / measure / investigate / resolve / understand / test whether …).
- Plain, board-readable language; drop technical/method jargon (instruments, assays, techniques) UNLESS it is the named concept above.
- Use the TITLE as the anchor; use the ABSTRACT only to clarify a vague title. State the high-level AIM, not how the work is done.
- Third person; never "we/our/I". No terminal punctuation. Invent nothing.
- Output ONLY the line — no quotes, no label, no preamble.

Examples of the house style (applicant title → objective):
- "Resolving our microbial origins" → To study the ancestral microbes that gave rise to all complex life
- "A Window into Microglial Dynamics in Humans in Vivo" → To non-invasively image microglia dynamics in human brains
- "Complete Genome Sequencing and AI-Driven Interpretation for Rare Disease Diagnosis" → To connect human genome variations with rare genetic diseases
- "Bridging Scales in Biological Active Matter: Decoding C. elegans Colony Formation Mechanisms" → To decode how individual behaviors create collective patterns in living systems
- "Towards single graviton detection with quantum acoustic cavities" → To develop single graviton detection with quantum acoustic cavities
- "The Fragment Generation Hypothesis to Explain a Cause and Function of Sleep" → To test whether protein fragment accumulation drives the need for sleep`;

export const USER_PROMPT_TEMPLATE = `Applicant title:
{{source_title}}

Abstract:
{{source_abstract}}

Write the one-line objective now.`;

/**
 * Executor variable declarations — the single source of truth, imported by the
 * seed script (so the live wmkf_ai_prompts row and this file cannot drift) and
 * pinned by a unit test. BOTH `source_title` and `source_abstract` are
 * applicant-authored: they MUST stay `untrusted:true` with a `dataClass` +
 * integer `maxChars` so the Executor wraps them (wrapUntrustedContent) and
 * injects the A7 preamble. Dropping `untrusted:true` on either would silently
 * remove that injection boundary — the grantee-title-prompt-config test fails
 * closed on any such regression.
 */
export const PROMPT_VARIABLES = {
  variables: [
    {
      name: 'source_title',
      source: { kind: 'override' },
      required: true,
      cacheable: false,
      placement: 'user',
      dataClass: 'title',
      maxChars: 600,
      untrusted: true,
    },
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
 * Output schema. Plain one-line prose → parseMode 'raw', a single output
 * returned to the caller (target kind:'none'); raw mode ignores jsonSchema, so
 * none is declared. The caller persists the title to
 * `akoya_request.wmkf_wmkfprojectdescription` (chunk-7 cron, write-when-empty).
 */
export const PROMPT_OUTPUT_SCHEMA = {
  outputs: [{ name: 'edited_title', type: 'string', target: { kind: 'none' } }],
  parseMode: 'raw',
  rawOutputRetention: 'full',
};
