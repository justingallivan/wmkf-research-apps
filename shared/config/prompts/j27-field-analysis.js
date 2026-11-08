/** J27 First Cut P8. The caller retrieves evidence and owns any saved brief. */

export const PROMPT_NAME = 'j27.field-analysis.generate';

export const SYSTEM_PROMPT = `Write a staff-only First Cut Field Analysis for a scientist outside this proposal's discipline. Explain the field, compare the proposal with other work, and qualify claims where the evidence warrants it. Leave judgments about merit, fit, and funding to staff.

Use the proposal and bibliography to identify applicant claims. Use only checked_sources for citations and literature findings. Treat search_notes as coverage information, and put search gaps or unavailable sources in pd_notes. Use a source only for what the checked passage supports. An abstract may support a broad description. It cannot verify a number, method, or priority claim absent from the passage. Never invent a citation, posting date, author, or result.

Write at most 600 words across three sections:
- state_of_play: Start with the field, define specialist terms, and explain what is established and what gap remains.
- novelty: Compare equivalent tools and the same scientific endpoint. Compare applicant-named and other relevant peer groups by lead author and institution when supported. Use verified first-public dates to distinguish uncited prior work from work that appeared after submission. Work appearing later may change the context. Avoid faulting the applicants for it. If dates or search coverage do not support a priority conclusion, qualify the conclusion and record the gap.
- claims_checked: Include only claims that fail or need qualification, including unresolved intake priority claims. State the applicant's claim and what the checked source shows. If verified claims agree, say so. If there was insufficient evidence to verify them, leave this section empty and record the gap in pd_notes.

Use bracketed citation numbers [1], [2] in first-use order, with at most 15 references. In reference_source_ids, list the checked source IDs in that same order, exactly once each. The caller will fill the bibliographic details. Use open_questions for unsupported claims, comparisons of applicant numbers with published values, uncited prior work, and consequential later work. Use pd_notes for unconfirmed findings, unavailable sources, or budget notes. Include the proposal page and section where known, using null and an empty string when unknown. Keep both lists separate from the brief.

Write in plain, direct language. Define specialist terms at first use. Use <i> for scientific italics. Omit hype, absolute novelty assertions, and em dashes. Return only the JSON object.`;

export const USER_PROMPT_TEMPLATE = `<proposal>{{proposal_text}}</proposal>
<bibliography>{{bibliography}}</bibliography>
<summary_fields>{{summary_fields}}</summary_fields>
<submission_date>{{submission_date}}</submission_date>
<intake_open_questions>{{intake_open_questions}}</intake_open_questions>
<checked_sources>{{checked_sources}}</checked_sources>
<search_notes>{{search_notes}}</search_notes>`;

export const PROMPT_VARIABLES = {
  variables: [
    ['proposal_text', 'proposal_text', 100000, true],
    ['bibliography', 'applicant_material', 40000, true],
    ['summary_fields', 'applicant_material', 25000, true],
    ['submission_date', 'crm_record_text', 10, true],
    ['intake_open_questions', 'crm_record_text', 25000, true],
    ['checked_sources', 'crm_record_text', 60000, true],
    ['search_notes', 'crm_record_text', 8000, false],
  ].map(([name, dataClass, maxChars, required]) => ({
    name, dataClass, maxChars, required, source: { kind: 'override' }, placement: 'user', untrusted: true,
    ...(required ? {} : { default: '' }),
  })),
};

const questionTypes = ['unsupported_claim', 'numbers_check', 'uncited_prior_work', 'later_work'];
const noteTypes = ['unconfirmed', 'source_unavailable', 'budget'];

function nativeItems(types) {
  return {
    type: 'array',
    items: {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'detail', 'page', 'section'],
      properties: {
        type: { type: 'string', enum: types },
        detail: { type: 'string' },
        page: { type: ['integer', 'null'] },
        section: { type: 'string' },
      },
    },
  };
}

function validationItems(types) {
  return {
    type: 'array',
    maxItems: 30,
    of: {
      type: 'object',
      fields: {
        type: { type: 'string', enum: types },
        detail: { type: 'string', maxLength: 1000, forbidPattern: '^\\s*$' },
        page: { type: 'integer', min: 1, nullable: true },
        section: { type: 'string', maxLength: 250 },
      },
    },
  };
}

export const PROMPT_OUTPUT_SCHEMA = {
  parseMode: 'json',
  generationMode: 'native-json-schema',
  outputs: [
    { name: 'state_of_play', type: 'string', target: { kind: 'none' } },
    { name: 'novelty', type: 'string', target: { kind: 'none' } },
    { name: 'claims_checked', type: 'string', target: { kind: 'none' } },
    { name: 'reference_source_ids', type: 'array', target: { kind: 'none' } },
    { name: 'open_questions', type: 'array', target: { kind: 'none' } },
    { name: 'pd_notes', type: 'array', target: { kind: 'none' } },
  ],
  jsonSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['state_of_play', 'novelty', 'claims_checked', 'reference_source_ids', 'open_questions', 'pd_notes'],
    properties: {
      state_of_play: { type: 'string' },
      novelty: { type: 'string' },
      claims_checked: { type: 'string' },
      reference_source_ids: { type: 'array', items: { type: 'string' } },
      open_questions: nativeItems(questionTypes),
      pd_notes: nativeItems(noteTypes),
    },
  },
  validationSchema: {
    type: 'object',
    fields: {
      state_of_play: { type: 'string', maxLength: 6000, forbidPattern: '^\\s*$' },
      novelty: { type: 'string', maxLength: 6000, forbidPattern: '^\\s*$' },
      claims_checked: { type: 'string', maxLength: 6000 },
      reference_source_ids: { type: 'array', maxItems: 15, of: { type: 'string', maxLength: 150 } },
      open_questions: validationItems(questionTypes),
      pd_notes: validationItems(noteTypes),
    },
  },
  rawOutputRetention: 'hash',
};
