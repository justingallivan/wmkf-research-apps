/** J27 intake P3. The caller saves the paragraph once the intake field is available. */

export const PROMPT_NAME = 'j27.methodology.generate';

export const SYSTEM_PROMPT = `Draft the page-one Methodology bullet for a W. M. Keck Foundation research proposal. Write one paragraph with at least two sentences and at most 100 words for a reader with general scientific training outside this field.

Lead with the new method, model, instrument, reagent, or combination of methods that enables the research. Explain what it makes possible. For each enabling method, use the proposal's evidence to distinguish what the team has already demonstrated from what it plans to build. If the status is unclear, describe the method neutrally and add a status_unclear open question. Finish with the principal supporting methods where needed.

Use the proposal as the evidence and the Enabling Advances answer for context. Read the current Executive Summary to avoid repeating its approach sentence or any phrase of six or more words. Name methods and define unfamiliar terms briefly. Keep a number only when the proposal supplies a comparison that shows why it matters. Omit routine counts, incidental reagents, investigators, risks, and Aim-by-Aim detail. Never invent evidence, methods, results, or comparisons.

Use direct, neutral language and future tense for planned work. Use present or past tense for work already shown. Use <i> for scientific italics where appropriate. Omit hype, em dashes, and semicolons. Avoid bare pronoun openers such as "This enables".

Return only the JSON object. Keep the methodology paragraph separate from enabling_methods, numbers_kept, terms_defined, and open_questions. Use in_hand or to_build only where the proposal supports the status. Put unclear statuses in open_questions. Cite the proposal page and section for methods and questions when known, using null for an unknown page and an empty string for an unknown section. Return empty arrays where there are no items.`;

export const USER_PROMPT_TEMPLATE = `<proposal>
{{proposal_text}}
</proposal>

<summary_fields>
{{summary_fields}}
</summary_fields>

<executive_summary>
{{executive_summary}}
</executive_summary>`;

export const PROMPT_VARIABLES = {
  variables: [
    {
      name: 'proposal_text', source: { kind: 'override' }, required: true, placement: 'user',
      dataClass: 'proposal_text', maxChars: 100000, untrusted: true,
    },
    {
      name: 'summary_fields', source: { kind: 'override' }, required: true, placement: 'user',
      dataClass: 'applicant_material', maxChars: 25000, untrusted: true,
    },
    {
      name: 'executive_summary', source: { kind: 'dynamics', field: 'wmkf_ai_summary' },
      required: true, placement: 'user', dataClass: 'crm_record_text', maxChars: 5000, untrusted: true,
    },
  ],
};

const methodStatuses = ['in_hand', 'to_build'];
const questionTypes = ['status_unclear'];
const pageSchema = { type: ['integer', 'null'] };
const pageValidation = { type: 'integer', min: 1, nullable: true };
const sectionValidation = { type: 'string', maxLength: 200 };

export const PROMPT_OUTPUT_SCHEMA = {
  parseMode: 'json',
  generationMode: 'native-json-schema',
  outputs: [
    { name: 'methodology', type: 'string', target: { kind: 'none' } },
    { name: 'enabling_methods', type: 'array', target: { kind: 'none' } },
    { name: 'numbers_kept', type: 'array', target: { kind: 'none' } },
    { name: 'terms_defined', type: 'array', target: { kind: 'none' } },
    { name: 'open_questions', type: 'array', target: { kind: 'none' } },
  ],
  jsonSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['methodology', 'enabling_methods', 'numbers_kept', 'terms_defined', 'open_questions'],
    properties: {
      methodology: { type: 'string' },
      enabling_methods: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['method', 'status', 'page', 'section'],
          properties: {
            method: { type: 'string' },
            status: { type: 'string', enum: methodStatuses },
            page: pageSchema,
            section: { type: 'string' },
          },
        },
      },
      numbers_kept: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['number', 'comparison'],
          properties: { number: { type: 'string' }, comparison: { type: 'string' } },
        },
      },
      terms_defined: { type: 'array', items: { type: 'string' } },
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
    },
  },
  validationSchema: {
    type: 'object',
    fields: {
      methodology: { type: 'string', maxLength: 3000, forbidPattern: '^\\s*$|(?:\\S+\\s+){100}\\S' },
      enabling_methods: {
        type: 'array',
        maxItems: 20,
        of: {
          type: 'object',
          fields: {
            method: { type: 'string', maxLength: 500 },
            status: { type: 'string', enum: methodStatuses },
            page: pageValidation,
            section: sectionValidation,
          },
        },
      },
      numbers_kept: {
        type: 'array',
        maxItems: 20,
        of: {
          type: 'object',
          fields: {
            number: { type: 'string', maxLength: 150 },
            comparison: { type: 'string', maxLength: 1000 },
          },
        },
      },
      terms_defined: { type: 'array', maxItems: 30, of: { type: 'string', maxLength: 250 } },
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
    },
  },
  rawOutputRetention: 'hash',
};
