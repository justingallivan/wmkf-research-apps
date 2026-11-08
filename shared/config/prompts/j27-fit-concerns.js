import { J27_FIT_CONCERNS, J27_FIT_LEVELS } from '../j27FitComparison.js';

export const PROMPT_NAME = 'j27.fit-concerns.generate';
const flagIds = Object.keys(J27_FIT_CONCERNS);
const levels = Object.keys(J27_FIT_LEVELS);
const evidenceSources = ['proposal', 'summary_fields', 'biosketches', 'other_support', 'external_awards', 'keck_abstracts'];

export const SYSTEM_PROMPT = `Screen a W. M. Keck Foundation Research Program proposal at Intake. Return one staff-only finding for each concern in the order below. Do not score, rank, recommend, or issue an overall fit verdict.

Use red for clear evidence, yellow for borderline evidence, green when there is no evidence of the concern, and gray when necessary evidence is missing. Consider each concern independently. Use only the supplied sources. Do not use institution, prestige, investigator career stage, funding levels, other funders' decisions, or high risk alone as evidence.

1. too_applied: Yellow if a basic question is present but the aims mostly pursue an application, a disease-specific question dominates, or tool optimization has a weak scientific rationale. Red if the near-term goal is a treatment, diagnostic, device, or product, or if the work develops or optimizes a tool without a named new scientific question. A disease model testing a general mechanism is not inherently a concern.
2. limited_impact: Yellow for signs of incremental extension, a missing or contradicted comparison, or a narrow payoff. Red for a predictable main aim or a payoff that only refines an existing answer without changing a model or opening new work. Preliminary data alone do not imply incremental work.
3. unclear_question: Yellow if a basic science question is vague, buried in the narrative, or success is measured only by technical milestones. Red if there is no basic science question anywhere in the proposal.
4. feasibility: Identify independent, undemonstrated steps essential to the aim. Zero or one is green. One plus another with unclear status is yellow. Two or more independent, undemonstrated steps are red. Name the steps.
5. funding_overlap: Compare the proposed aims with current and pending awards. Yellow for partial overlap or a shared system with a distinct question. Red for substantially the same aim. If Other Support is missing, use gray.
6. keck_overlap: Use only the supplied published Keck award abstracts from the last five years. Yellow for a close scientific question or a shared enabling approach to a close question. Green if the supplied evidence shows no close match. Use gray when the abstracts are unavailable. This flag is never red.

The P2 fit hint can direct attention to a quotation. Verify it against the proposal and make an independent judgment. Never cite the hint itself.

For red, yellow, or gray, give a neutral reason of at most 25 words. Green has an empty reason. Red and yellow require one or two verbatim quotes of fewer than 30 words each. Green and gray have no quotes. Identify the source for each quote. For proposal evidence use its page and section. For other evidence use the source's section or record label and null for page. Each Keck record starts with a title/year heading, followed by the abstract, with a blank line separating records. Quote the abstract and copy its heading exactly as the section.

Return only the JSON object, with all six flags exactly once.`;

export const USER_PROMPT_TEMPLATE = `<proposal>{{proposal_text}}</proposal>
<summary_fields>{{summary_fields}}</summary_fields>
<biosketches>{{biosketches}}</biosketches>
<other_support>{{other_support}}</other_support>
<external_awards>{{external_awards}}</external_awards>
<keck_abstracts>{{keck_abstracts}}</keck_abstracts>
<p2_fit_hint>{{p2_fit_hint}}</p2_fit_hint>`;

export const PROMPT_VARIABLES = {
  variables: [
    { name: 'proposal_text', dataClass: 'proposal_text', maxChars: 100000, required: true },
    { name: 'summary_fields', dataClass: 'applicant_material', maxChars: 25000, required: true },
    { name: 'biosketches', dataClass: 'applicant_material', maxChars: 100000, required: false },
    { name: 'other_support', dataClass: 'applicant_material', maxChars: 100000, required: false },
    { name: 'external_awards', dataClass: 'crm_record_text', maxChars: 50000, required: false },
    { name: 'keck_abstracts', dataClass: 'crm_record_text', maxChars: 100000, required: false },
    { name: 'p2_fit_hint', dataClass: 'crm_record_text', maxChars: 2000, required: false },
  ].map((variable) => ({ ...variable, source: { kind: 'override' }, placement: 'user', untrusted: true })),
};

export const FIT_FLAGS_VALIDATION = {
  type: 'array',
  maxItems: 6,
  of: {
    type: 'object',
    fields: {
      id: { type: 'string', enum: flagIds },
      level: { type: 'string', enum: levels },
      reason: { type: 'string', maxLength: 500 },
      evidence: {
        type: 'array',
        maxItems: 2,
        of: {
          type: 'object',
          fields: {
            source: { type: 'string', enum: evidenceSources },
            quote: { type: 'string', maxLength: 500 },
            page: { type: 'integer', min: 1, nullable: true },
            section: { type: 'string', maxLength: 500 },
          },
        },
      },
    },
  },
};

export const PROMPT_OUTPUT_SCHEMA = {
  parseMode: 'json',
  generationMode: 'native-json-schema',
  outputs: [{ name: 'flags', type: 'array', target: { kind: 'none' } }],
  jsonSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['flags'],
    properties: {
      flags: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'level', 'reason', 'evidence'],
          properties: {
            id: { type: 'string', enum: flagIds },
            level: { type: 'string', enum: levels },
            reason: { type: 'string' },
            evidence: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['source', 'quote', 'page', 'section'],
                properties: {
                  source: { type: 'string', enum: evidenceSources },
                  quote: { type: 'string' },
                  page: { type: ['integer', 'null'] },
                  section: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
  },
  validationSchema: { type: 'object', fields: { flags: FIT_FLAGS_VALIDATION } },
  rawOutputRetention: 'hash',
};
