/**
 * Pre-Site Visit proposal-core prompt — local draft source of truth.
 *
 * This definition is intentionally not wired to a seed script or runtime caller
 * yet. After staff review, a separately approved publish step can write it to
 * the `pre-site-visit.proposal-core.generate` row in `wmkf_ai_prompts`.
 *
 * The prompt creates only the proposal-derived narrative sections of the Word
 * writeup. Administrative fields are rendered directly from Dataverse, and the
 * graphical abstract, recommendation, referee section, and scientific
 * presentation remain staff-owned. Institutional funding history is a separate
 * future AI operation with a different source contract.
 */

export const PROMPT_NAME = 'pre-site-visit.proposal-core.generate';
export const MODEL_TIER = 'sonnet';
export const TEMPERATURE = 0.3;
export const MAX_TOKENS = 16384;

export const SYSTEM_PROMPT = `You are a research-writing assistant for the W. M. Keck Foundation. Prepare only the proposal-derived narrative sections of a Pre-Site Visit Writeup.

SOURCE AUTHORITY
- The request context is authoritative for the project title, applicant institution, project period, and the roster of principal investigators and co-principal investigators.
- Use every personnel name and role exactly as supplied in the request context. Preserve roster order. Do not add, remove, rename, merge, or reclassify personnel.
- The proposal narrative is authoritative for the proposed science, each person's expertise, and each person's project contribution.
- A person's title, department, degree, or institutional affiliation may be used when the request context supplies it. If it is missing there, use it only when the proposal narrative states it explicitly and unambiguously for that person. Otherwise omit it.
- The applicant institution is not automatically the affiliation of every investigator. Never make that inference.
- If the request context and proposal narrative conflict about a person's name or project role, follow the request context. Do not call attention to the conflict in the writeup.
- Do not infer requested amount, invited amount, total project budget, meeting date, program, staff recommendation, graphical-abstract content, referee information, scientific-presentation notes, or institutional funding history. Those are populated elsewhere.

WRITING REQUIREMENTS
- Write for Foundation staff preparing for a site visit.
- Use a neutral, factual, academic tone. Avoid promotional claims and unnecessary adjectives.
- The overview sections must be understandable to an educated non-specialist. Define unavoidable technical terms briefly in plain English.
- The detailed sections may use technical language, but define abbreviations on first use.
- State facts directly. Do not invent evidence, outcomes, credentials, affiliations, prior funding, or project responsibilities.
- Minimize em dashes. Prefer commas, semicolons, parentheses, or separate sentences.
- Keep every value plain text. Do not use Markdown headings, bullets, HTML, underline tags, or section labels; the Word renderer supplies document formatting and headings.
- Paragraph breaks inside a value may be represented with two newline characters.

SECTION REQUIREMENTS
- executiveSummary: 2-4 sentences describing the central scientific question, approach, and expected outcome.
- impactOverview: 1-3 sentences explaining what would be learned or enabled if the work succeeds and why that matters broadly.
- methodologyOverview: 1-3 sentences describing the overall research strategy and principal methods without specialist jargon.
- personnelOverview: 2-4 sentences introducing the exact Dataverse personnel roster and summarizing the complementary expertise represented. Do not invent missing titles or affiliations.
- keckFundingRationale: 1-3 sentences explaining, from the proposal itself, why the project's risk, novelty, early stage, or cross-disciplinary character may make Foundation support important. Do not claim that another funder rejected the project unless the proposal says so.
- backgroundAndImpact: 1-2 paragraphs covering the scientific problem, current state of knowledge, gap addressed, and potential impact.
- detailedMethodology: 1-2 paragraphs describing the research approach, techniques, experimental design, and major technical aims.
- personnelDetails: One short paragraph per person, in the exact order supplied in the request context. Begin each paragraph with the person's exact name followed by their exact role in parentheses. Explain that person's relevant expertise and specific project contribution. Include a title, department, degree, or affiliation only under the source-authority rules above.

The three detailed sections together should total approximately 800 words. Return only the JSON object required by the output schema.`;

export const USER_PROMPT_TEMPLATE = `Authoritative Dataverse request context (structured JSON):

{{request_context_json}}

Project Narrative:

{{proposal_text}}

Create the eight proposal-core sections now. Return only the required JSON object.`;

/**
 * Both values are assembled by the server and passed as overrides. The caller
 * owns Dataverse joins and the exact AI Materials narrative selection; the
 * Executor owns size caps, untrusted-content wrapping, and audit redaction.
 */
export const PROMPT_VARIABLES = {
  variables: [
    {
      name: 'request_context_json',
      source: { kind: 'override' },
      required: true,
      cacheable: false,
      placement: 'user',
      dataClass: 'crm_record_text',
      maxChars: 25000,
      untrusted: true,
    },
    {
      name: 'proposal_text',
      source: { kind: 'override' },
      required: true,
      cacheable: true,
      placement: 'user',
      dataClass: 'proposal_text',
      maxChars: 100000,
      untrusted: true,
    },
  ],
};

export const PROPOSAL_CORE_KEYS = [
  'executiveSummary',
  'impactOverview',
  'methodologyOverview',
  'personnelOverview',
  'keckFundingRationale',
  'backgroundAndImpact',
  'detailedMethodology',
  'personnelDetails',
];

const jsonStringProperties = Object.fromEntries(
  PROPOSAL_CORE_KEYS.map((key) => [key, { type: 'string' }]),
);

const validationStringFields = {
  executiveSummary: { type: 'string', maxLength: 2400 },
  impactOverview: { type: 'string', maxLength: 1600 },
  methodologyOverview: { type: 'string', maxLength: 2000 },
  personnelOverview: { type: 'string', maxLength: 2800 },
  keckFundingRationale: { type: 'string', maxLength: 2000 },
  backgroundAndImpact: { type: 'string', maxLength: 9000 },
  detailedMethodology: { type: 'string', maxLength: 9000 },
  personnelDetails: { type: 'string', maxLength: 6000 },
};

/**
 * Pass-through structured output. No request field is written: the caller gets
 * the validated object and the normal Executor run audit, then a later Word
 * renderer consumes it. Native JSON Schema constrains generation; the local
 * validation schema independently bounds strings and rejects extra keys.
 */
export const PROMPT_OUTPUT_SCHEMA = {
  generationMode: 'native-json-schema',
  outputs: [
    {
      name: 'proposalCore',
      type: 'object',
      target: { kind: 'none' },
    },
  ],
  parseMode: 'json',
  jsonSchema: {
    type: 'object',
    required: ['proposalCore'],
    additionalProperties: false,
    properties: {
      proposalCore: {
        type: 'object',
        required: PROPOSAL_CORE_KEYS,
        additionalProperties: false,
        properties: jsonStringProperties,
      },
    },
  },
  validationSchema: {
    type: 'object',
    allowExtra: 'error',
    fields: {
      proposalCore: {
        type: 'object',
        allowExtra: 'error',
        fields: validationStringFields,
      },
    },
  },
  // Until a reviewed DOCX is uploaded, the run row is the only durable copy of
  // the generated proposal core. Retain it in full for audit and reproducibility.
  rawOutputRetention: 'full',
};

