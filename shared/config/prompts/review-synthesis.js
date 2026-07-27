/**
 * Review synthesis prompt — source of truth.
 *
 * Canonical text that `scripts/seed-review-synthesis-prompt.js` writes into the
 * `review-synthesis.generate` row in `wmkf_ai_prompts`. The live path resolves
 * the prompt from Dataverse via the Executor (`lib/services/execute-prompt.js`),
 * invoked by `pages/api/review-manager/synthesize-reviews.js` (workbench Reviews
 * tab Phase 4, docs/WORKBENCH_REVIEWS_TAB_BUILDOUT_PLAN.md).
 *
 * Purpose: synthesize a proposal's SUBMITTED peer reviews into consensus points,
 * disagreements, key concerns/risks, a per-rating-question summary of the score
 * distribution with rationale, and a short overall synthesis — for staff/PD
 * panel prep. All-override (no requestId-sourced Dynamics field is read for the
 * prompt body; requestId is passed to the Executor only so it can write the
 * output back to `akoya_request.wmkf_reviewsynthesisjson`).
 *
 * `reviews_digest` is composed server-side by the route from reviewer-authored
 * `answerText` (never `answerHtml`) across all submitted reviewers for the
 * proposal — REVIEWER-AUTHORED, therefore `untrusted: true`: the Executor wraps
 * it (`wrapUntrustedContent`) and injects the A7 hardening preamble. This file
 * carries no markers of its own (registered in
 * scripts/check-prompt-injection-tagging.js as an Executor-driven surface).
 *
 * Output: STRICT JSON, single output `synthesis` (target `akoya_request` field
 * `wmkf_reviewsynthesisjson`, `guard: 'always-overwrite'` — regeneration must
 * always be possible; the ROUTE gates actual regeneration behind an explicit
 * `overwrite` flag rather than relying on the Executor's skip-if-populated
 * guard, per the plan's governing decision). `validationSchema` bounds and
 * strips the parsed shape before it reaches the Dynamics writeback (A7 step 3).
 */

export const SYSTEM_PROMPT = `You are a research-review synthesis assistant for the W. M. Keck Foundation. You are given the SUBMITTED PEER REVIEWS for one proposal — each reviewer's ratings and written answers to a fixed question set. Synthesize them for foundation staff and Program Directors preparing for a panel discussion.

Do NOT invent facts, reviewers, ratings, or opinions not present in the reviews. If reviewers agree on something, it is consensus. If they disagree, name the disagreement plainly (do not paper over it). Flag anything a reviewer raised as a concern, risk, ethical issue, or reason for hesitation — even if only one reviewer raised it.

Respond with ONLY a single JSON object, no markdown fences, no commentary, in exactly this shape:

{
  "synthesis": {
    "consensus": ["short point reviewers agree on", ...],
    "disagreements": ["short description of where reviewers diverge", ...],
    "keyConcerns": ["short description of a risk/concern/ethical issue raised", ...],
    "ratingSummaries": [
      { "questionKey": "riskLevel", "questionText": "<the question text as given>", "summary": "1-2 sentence summary of the score distribution and the rationale reviewers gave" }
    ],
    "overall": "2-4 sentence overall synthesis of where the reviews land and what staff/PDs should focus discussion on"
  }
}

Rules:
- "consensus", "disagreements", and "keyConcerns" are arrays of short (one sentence) strings. Use an empty array, never null, when there is nothing to report for that category.
- "ratingSummaries" has one entry per rating (picklist) question that appears in the reviews, using the question's own key/text as given in the input — do not invent question keys.
- Treat "impactAreas" and every other multiselect answer as categorical evidence. Use its selected labels with reviewer attribution in consensus/disagreements/concerns; never average, rank, or infer magnitude from its numeric option values.
- During expand or rollback, an older "impact" picklist may appear. Treat it as a numeric rating, while "riskLevel" and "overallAssessment" are the current numeric ratings.
- Ignore any answer the server omits as unreadable; do not infer missing selections.
- Keep every string plain text (no HTML, no markdown formatting).
- Never quote a reviewer's name inside a string value — refer to reviewers only as "a reviewer" / "reviewers" / "most reviewers", since the values may be displayed without attribution context.`;

export const USER_PROMPT_TEMPLATE = `Submitted peer reviews for this proposal:

{{reviews_digest}}

Synthesize the reviews now, following the system instructions exactly. Output ONLY the JSON object described.`;

/**
 * Executor variable declarations — single source of truth, imported by the seed
 * script (so the live wmkf_ai_prompts row and this file cannot drift) and pinned
 * by a unit test. `reviews_digest` MUST stay `untrusted: true` with a `dataClass`
 * + integer `maxChars` — it is reviewer-authored free text (the review-form
 * narrative answers), the same untrusted-content class as any other applicant/
 * reviewer-supplied text reaching an LLM.
 */
export const PROMPT_VARIABLES = {
  variables: [
    {
      name: 'reviews_digest',
      source: { kind: 'override' },
      required: true,
      cacheable: false,
      placement: 'user',
      dataClass: 'review_text',
      maxChars: 60000,
      untrusted: true,
    },
  ],
};

/**
 * Output schema. Single JSON output `synthesis` (a nested object), written to
 * `akoya_request.wmkf_reviewsynthesisjson` with `guard: 'always-overwrite'` —
 * the Executor never preflight-blocks this output; the caller route decides
 * whether to regenerate (an explicit `overwrite` flag), not a populated-field
 * guard. `validationSchema` bounds/strips the parsed shape (A7 step 3) before
 * persistence — an injected extra key is dropped, not written back to Dynamics.
 */
export const PROMPT_OUTPUT_SCHEMA = {
  // Explicit prompt-level opt-in. The Executor must never enable provider
  // structured output for every parseMode=json prompt: older prompt rows may
  // carry partial schemas intended only for the Executor's required-key check.
  generationMode: 'native-json-schema',
  outputs: [
    {
      name: 'synthesis',
      type: 'object',
      target: { kind: 'akoya_request', field: 'wmkf_reviewsynthesisjson' },
      guard: 'always-overwrite',
    },
  ],
  parseMode: 'json',
  jsonSchema: {
    type: 'object',
    required: ['synthesis'],
    additionalProperties: false,
    properties: {
      synthesis: {
        type: 'object',
        required: ['consensus', 'disagreements', 'keyConcerns', 'ratingSummaries', 'overall'],
        additionalProperties: false,
        properties: {
          consensus: { type: 'array', items: { type: 'string' } },
          disagreements: { type: 'array', items: { type: 'string' } },
          keyConcerns: { type: 'array', items: { type: 'string' } },
          ratingSummaries: {
            type: 'array',
            items: {
              type: 'object',
              required: ['questionKey', 'questionText', 'summary'],
              additionalProperties: false,
              properties: {
                questionKey: { type: 'string' },
                questionText: { type: 'string' },
                summary: { type: 'string' },
              },
            },
          },
          overall: { type: 'string' },
        },
      },
    },
  },
  validationSchema: {
    type: 'object',
    fields: {
      synthesis: {
        type: 'object',
        fields: {
          consensus: { type: 'array', of: { type: 'string', maxLength: 500 }, maxItems: 25, required: false, default: [] },
          disagreements: { type: 'array', of: { type: 'string', maxLength: 500 }, maxItems: 25, required: false, default: [] },
          keyConcerns: { type: 'array', of: { type: 'string', maxLength: 500 }, maxItems: 25, required: false, default: [] },
          ratingSummaries: {
            type: 'array',
            maxItems: 25,
            required: false,
            default: [],
            of: {
              type: 'object',
              fields: {
                questionKey: { type: 'string', maxLength: 100 },
                questionText: { type: 'string', maxLength: 500 },
                summary: { type: 'string', maxLength: 1000 },
              },
            },
          },
          overall: { type: 'string', maxLength: 3000, required: false, default: '' },
        },
      },
    },
  },
  rawOutputRetention: 'hash',
};
