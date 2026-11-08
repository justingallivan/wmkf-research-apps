/** J27 intake P2. The Executor wraps the applicant inputs and saves only the paragraph. */

export const PROMPT_NAME = 'j27.executive-summary.generate';

export const SYSTEM_PROMPT = `Draft the page-one Executive Summary for a W. M. Keck Foundation research proposal. Write one editable paragraph of at most 200 words for an educated reader without scientific training.

Use the applicant's lay abstract, application Summary answers, and proposal. Write a fresh paragraph. When the inputs disagree, follow the proposal. Explain five things in a natural order:
1. What is known and the gap that makes the project worth doing.
2. The scientific question.
3. What the team will do, in one sentence without method details.
4. What knowledge, measurement, or capability the work would establish.
5. What success would change about our understanding.

If the inputs cannot support an element, omit it and add a missing_element open question. Omit unsupported claims of priority or novelty and add an unsupported_claim open question. Attribute hypotheses to the team and describe outcomes conditionally. Never invent a claim, number, comparison, or citation.

Describe the actual near-term goal. When it is fundamental research, mention a practical application only as a long-term implication. When the near-term goal is a treatment, device, diagnostic, or other application, describe it faithfully and raise too_applied_hint with a verbatim quote from the proposal. The hint is evidence for the separate fit screen.

Use third-person Foundation voice, plain words, and short sentences. Define unfamiliar terms or replace them with plain language. Use <i> for italics where scientifically appropriate. Omit investigator names, budget, other-funder arguments, hype, verdicts, em dashes, and semicolons. Avoid bare pronoun openers such as "This demonstrates".

Return only the JSON object. Keep open_questions and too_applied_hint separate from executive_summary. For review signals, give the proposal page and section when available. Use null for an unknown page and an empty string for an unknown section. If the hint is clear, set raised to false, evidence and section to empty strings, and page to null. Return empty arrays when there are no open questions or defined terms.`;

export const USER_PROMPT_TEMPLATE = `<proposal>
{{proposal_text}}
</proposal>

<lay_abstract>
{{lay_abstract}}
</lay_abstract>

<summary_fields>
{{summary_fields}}
</summary_fields>`;

export const PROMPT_VARIABLES = {
  variables: [
    {
      name: 'proposal_text', source: { kind: 'override' }, required: true, placement: 'user',
      dataClass: 'proposal_text', maxChars: 100000, untrusted: true,
    },
    {
      name: 'lay_abstract', source: { kind: 'override' }, required: true, placement: 'user',
      dataClass: 'abstract', maxChars: 1800, untrusted: true,
    },
    {
      name: 'summary_fields', source: { kind: 'override' }, required: true, placement: 'user',
      dataClass: 'applicant_material', maxChars: 25000, untrusted: true,
    },
  ],
};

const questionTypes = ['unsupported_claim', 'missing_element'];
const pageSchema = { type: ['integer', 'null'] };
const pageValidation = { type: 'integer', min: 1, nullable: true };
const sectionValidation = { type: 'string', maxLength: 200 };

export const PROMPT_OUTPUT_SCHEMA = {
  parseMode: 'json',
  generationMode: 'native-json-schema',
  outputs: [
    {
      name: 'executive_summary',
      type: 'string',
      target: { kind: 'akoya_request', field: 'wmkf_ai_summary' },
      guard: 'skip-if-populated',
    },
    { name: 'open_questions', type: 'array', target: { kind: 'none' } },
    { name: 'too_applied_hint', type: 'object', target: { kind: 'none' } },
    { name: 'terms_defined', type: 'array', target: { kind: 'none' } },
  ],
  jsonSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['executive_summary', 'open_questions', 'too_applied_hint', 'terms_defined'],
    properties: {
      executive_summary: { type: 'string' },
      open_questions: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['type', 'detail', 'page', 'section'],
          properties: {
            type: { type: 'string', enum: questionTypes },
            detail: { type: 'string' },
            page: pageSchema,
            section: { type: 'string' },
          },
        },
      },
      too_applied_hint: {
        type: 'object',
        additionalProperties: false,
        required: ['raised', 'evidence', 'page', 'section'],
        properties: {
          raised: { type: 'boolean' },
          evidence: { type: 'string' },
          page: pageSchema,
          section: { type: 'string' },
        },
      },
      terms_defined: { type: 'array', items: { type: 'string' } },
    },
  },
  validationSchema: {
    type: 'object',
    fields: {
      executive_summary: { type: 'string', maxLength: 5000, forbidPattern: '^\\s*$|(?:\\S+\\s+){200}\\S' },
      open_questions: {
        type: 'array',
        maxItems: 20,
        of: {
          type: 'object',
          fields: {
            type: { type: 'string', enum: questionTypes },
            detail: { type: 'string', maxLength: 1000 },
            page: pageValidation,
            section: sectionValidation,
          },
        },
      },
      too_applied_hint: {
        type: 'object',
        fields: {
          raised: { type: 'boolean' },
          evidence: { type: 'string', maxLength: 1000 },
          page: pageValidation,
          section: sectionValidation,
        },
      },
      terms_defined: { type: 'array', maxItems: 30, of: { type: 'string', maxLength: 250 } },
    },
  },
  // The caller owns review signals. The audit row retains run metadata and a hash.
  rawOutputRetention: 'hash',
};
