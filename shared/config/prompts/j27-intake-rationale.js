/** J27 intake P5. Regeneration returns a draft and never replaces a saved stage rationale. */

export const PROMPT_NAME = 'j27.intake-rationale.generate';

export const SYSTEM_PROMPT = `Draft the Intake Rationale for page one of a W. M. Keck Foundation research write-up. Write one neutral paragraph of at least three sentences and at most 100 words. Give impact, innovation, and key risks comparable weight. Leave the decision to staff.

Explain what the field would understand or be able to do if the project succeeds. Lead with fundamental knowledge and mention a practical application only as a long-term implication. Use the proposal to decide which of the applicant's Potential Impact claims to include. Describe the new question, measurement, capability, or combination of methods. Name what has to go right, including unproven enabling methods or results later work depends on. Use the applicant's Risks answer and the proposal as evidence.

Use only the proposal and application materials for facts. Read the current Executive Summary and Methodology for context. Use the supplied enabling-method statuses to distinguish work already demonstrated from work still to be built. Do not treat an unclear status as a failure or a demonstrated result. Avoid repeating a phrase of six or more words from the Executive Summary or Methodology. Define unfamiliar terms they have not already defined.

Use conditional language for the payoff. Tie any judgment word to a specific reason in the same sentence. Do not grade risks, assess personnel, discuss the budget, or give a fit or funding verdict. Attribute other-funder claims to the applicant and use them only as a secondary point. Vary the opening and avoid "Keck support would" and "Foundation support would". When openings_in_use is supplied, avoid those openings too. End on a fact, risk, or condition. Use direct language and scientific italics where appropriate. Omit em dashes and semicolons. Invent nothing.

Return only the JSON object. Keep rationale separate from opening_used, impact_basis, risks, and judgment_words. Return the first four words in opening_used. Explain which impact claims you used or omitted in impact_basis. In risks, give the source, proposal page, and section where known. Use null for an unknown page and an empty string for an unknown section. Return an empty array when there are no items.`;

export const USER_PROMPT_TEMPLATE = `<proposal>
{{proposal_text}}
</proposal>

<summary_fields>
{{summary_fields}}
</summary_fields>

<executive_summary>
{{executive_summary}}
</executive_summary>

<methodology>
{{methodology}}
</methodology>

<enabling_methods>
{{enabling_methods}}
</enabling_methods>

<openings_in_use>
{{openings_in_use}}
</openings_in_use>`;

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
    {
      name: 'methodology', source: { kind: 'override' }, required: true, placement: 'user',
      dataClass: 'crm_record_text', maxChars: 3000, untrusted: true,
    },
    {
      name: 'enabling_methods', source: { kind: 'override' }, required: true, placement: 'user',
      dataClass: 'crm_record_text', maxChars: 20000, untrusted: true,
    },
    {
      name: 'openings_in_use', source: { kind: 'override', default: '' }, required: false, placement: 'user',
      dataClass: 'crm_record_text', maxChars: 25000, untrusted: true,
    },
  ],
};

const riskSources = ['applicant Risks field', 'proposal reading'];

export const PROMPT_OUTPUT_SCHEMA = {
  parseMode: 'json',
  generationMode: 'native-json-schema',
  outputs: [
    { name: 'rationale', type: 'string', target: { kind: 'none' } },
    { name: 'opening_used', type: 'string', target: { kind: 'none' } },
    { name: 'impact_basis', type: 'string', target: { kind: 'none' } },
    { name: 'risks', type: 'array', target: { kind: 'none' } },
    { name: 'judgment_words', type: 'array', target: { kind: 'none' } },
  ],
  jsonSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['rationale', 'opening_used', 'impact_basis', 'risks', 'judgment_words'],
    properties: {
      rationale: { type: 'string' },
      opening_used: { type: 'string' },
      impact_basis: { type: 'string' },
      risks: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['risk', 'source', 'page', 'section'],
          properties: {
            risk: { type: 'string' },
            source: { type: 'string', enum: riskSources },
            page: { type: ['integer', 'null'] },
            section: { type: 'string' },
          },
        },
      },
      judgment_words: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['word', 'reason'],
          properties: { word: { type: 'string' }, reason: { type: 'string' } },
        },
      },
    },
  },
  validationSchema: {
    type: 'object',
    fields: {
      rationale: { type: 'string', maxLength: 3000, forbidPattern: '^\\s*$|(?:\\S+\\s+){100}\\S' },
      opening_used: { type: 'string', maxLength: 200 },
      impact_basis: { type: 'string', maxLength: 1000 },
      risks: {
        type: 'array',
        maxItems: 20,
        of: {
          type: 'object',
          fields: {
            risk: { type: 'string', maxLength: 1000 },
            source: { type: 'string', enum: riskSources },
            page: { type: 'integer', min: 1, nullable: true },
            section: { type: 'string', maxLength: 200 },
          },
        },
      },
      judgment_words: {
        type: 'array',
        maxItems: 20,
        of: {
          type: 'object',
          fields: {
            word: { type: 'string', maxLength: 100 },
            reason: { type: 'string', maxLength: 1000 },
          },
        },
      },
    },
  },
  rawOutputRetention: 'hash',
};
