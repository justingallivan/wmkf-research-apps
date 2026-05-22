/**
 * Output schema for `createStructuredDataExtractionPrompt` (A7 Part 5).
 *
 * Phase I Writeup, Batch Phase I, Phase II, and the legacy batch route all
 * `JSON.parse` the raw model output of this extraction prompt. A
 * prompt-injected model can add keys or smuggle bad values; this schema is
 * validated AFTER the parse (via `validateAiJson`) so undeclared keys are
 * dropped and types are enforced before the result reaches a UI or a sink.
 *
 * Every field is `required: false` with a `default` — a thin proposal
 * legitimately yields missing fields, and the goal is structural safety, not
 * forcing the model to invent content. String caps are generous but finite.
 */

const optionalString = (maxLength) => ({
  type: 'string',
  required: false,
  default: '',
  maxLength,
});

const optionalStringArray = (maxItems, itemMax) => ({
  type: 'array',
  required: false,
  default: [],
  maxItems,
  of: { type: 'string', maxLength: itemMax },
});

/** Schema for `createStructuredDataExtractionPrompt` output. */
export const PROPOSAL_EXTRACTION_SCHEMA = {
  type: 'object',
  fields: {
    filename: optionalString(500),
    institution: optionalString(500),
    city_state: optionalString(200),
    project_title: optionalString(1_000),
    principal_investigator: optionalString(500),
    investigators: optionalStringArray(50, 500),
    research_area: optionalString(500),
    methods: optionalStringArray(100, 500),
    funding_amount: optionalString(200),
    invited_amount: optionalString(200),
    total_project_cost: optionalString(200),
    meeting_date: optionalString(200),
    duration: optionalString(200),
    keywords: optionalStringArray(100, 200),
  },
};
