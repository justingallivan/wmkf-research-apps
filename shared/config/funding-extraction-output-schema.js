/**
 * Output schema for the Funding Gap Analyzer extraction LLM call (A7 Part 6).
 *
 * /api/analyze-funding-gap `JSON.parse`s raw model output and uses the fields
 * to drive federal-API queries. This schema is validated AFTER the parse (via
 * `validateAiJson`) so undeclared keys an injected model added are dropped and
 * types are enforced before the values reach the query layer.
 */

/** Schema for `createFundingExtractionPrompt` output. */
export const FUNDING_EXTRACTION_SCHEMA = {
  type: 'object',
  fields: {
    pi: { type: 'string', required: false, default: '', maxLength: 500 },
    institution: { type: 'string', required: false, default: '', maxLength: 500 },
    state: { type: 'string', required: false, default: '', maxLength: 100 },
    keywords: {
      type: 'array',
      required: false,
      default: [],
      maxItems: 50,
      of: { type: 'string', maxLength: 200 },
    },
  },
};
