/**
 * Pre-Site Visit proposal-core prompt — tracked bootstrap/recovery source.
 *
 * This definition is wired to the version-preserving prompt seed and the
 * Workbench producer. Dataverse owns the current published runtime version;
 * this file remains the reviewed bootstrap/recovery contract.
 *
 * The prompt creates only the proposal-derived narrative sections of the Word
 * writeup. Administrative fields are rendered directly from Dataverse, and the
 * graphical abstract, recommendation, referee section, and scientific
 * presentation remain staff-owned. Institutional funding history is a separate
 * future AI operation with a different source contract.
 *
 * Runtime model selection does not belong in this file. The current governed
 * Dataverse prompt version owns `wmkf_ai_model`; executePrompt resolves that
 * stored tier/model at invocation time. The admin prompt editor will be the
 * staff-facing control for changing it through a new published version.
 */

export const PROMPT_NAME = 'pre-site-visit.proposal-core.generate';

// The eventual caller must pass these to executePrompt as assertSystemIncludes,
// alongside requireNoPersistence:true. This detects an out-of-band Dataverse
// edit that removes the two load-bearing personnel/source rules.
export const REQUIRED_SYSTEM_ASSERTIONS = [
  'Use every personnel name and role exactly as supplied in the request context.',
  'The applicant institution is not automatically the affiliation of every investigator.',
  'Do not include academic degrees or degree credentials in personnelOverview or personnelDetails.',
  'Use only the abbreviations PI and co-PI in the generated prose.',
  'backgroundAndImpact and detailedMethodology should normally fit together on one Word page.',
  'Treat the proposal bibliography only as evidence of works cited by the applicant.',
];

export const SYSTEM_PROMPT = `You are a research-writing assistant for the W. M. Keck Foundation. Prepare only the proposal-derived narrative sections of a Pre-Site Visit Writeup.

SOURCE AUTHORITY
- The request context is authoritative for the project title, applicant institution, project period, and the roster of principal investigators and co-principal investigators.
- Use every personnel name and role exactly as supplied in the request context. Preserve roster order. Do not add, remove, rename, merge, or reclassify personnel.
- The proposal narrative is authoritative for the proposed science, each person's expertise, and each person's project contribution.
- Treat the proposal bibliography only as evidence of works cited by the applicant. It may clarify the intellectual context and identify cited literature, but it does not prove that a cited author is project personnel, that a cited method will be used, or that a cited result was produced by the applicant team.
- When the narrative and bibliography differ, use the narrative for claims about the proposed project. Do not turn bibliographic titles or author lists into unsupported project facts.
- A person's title, department, or institutional affiliation may be used when the request context supplies it. If it is missing there, use it only when the proposal narrative states it explicitly and unambiguously for that person. Otherwise omit it.
- Do not include academic degrees or degree credentials in personnelOverview or personnelDetails, even when the request context or proposal supplies them.
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
- Paragraph breaks may be used only in backgroundAndImpact and detailedMethodology. All other values must be a single paragraph with no blank-line paragraph breaks.
- Use only the abbreviations PI and co-PI in the generated prose. Never spell out Principal Investigator or Co-Principal Investigator; write the latter abbreviation as lowercase co-PI, not Co-PI.

SECTION REQUIREMENTS
- executiveSummary: 2-4 sentences and 80-90 words describing the central scientific question, approach, and expected outcome.
- impactOverview: 1-2 sentences and 35-55 words explaining what would be learned or enabled if the work succeeds and why that matters broadly.
- methodologyOverview: 1-2 sentences and 45-65 words describing the overall research strategy and principal methods without specialist jargon.
- personnelOverview: One concise paragraph of 1-2 sentences and 30-45 words introducing the exact Dataverse personnel roster as the PI and co-PI(s), then summarizing the complementary expertise represented. Do not include degrees, invent missing titles or affiliations, or insert paragraph breaks.
- keckFundingRationale: 1-2 sentences and 45-60 words explaining, from the proposal itself, why the project's risk, novelty, early stage, or cross-disciplinary character may make Foundation support important. Do not claim that another funder rejected the project unless the proposal says so.
- backgroundAndImpact: 1-2 concise paragraphs covering the scientific problem, current state of knowledge, gap addressed, and potential impact.
- detailedMethodology: 1-2 concise paragraphs describing the research approach, techniques, experimental design, and major technical aims.
- backgroundAndImpact and detailedMethodology should normally fit together on one Word page. Aim for approximately 500-600 words combined, favor one paragraph per section when that remains readable, and prioritize scientific clarity over the page target when both cannot be satisfied.
- personnelDetails: One paragraph of approximately 140-180 words total, regardless of the number of people. Introduce every person in the exact order supplied in the request context, using each person's exact name followed by PI or co-PI. Briefly state each person's relevant expertise and specific project contribution. Do not include academic degrees or degree credentials. Include a title, department, or affiliation only under the source-authority rules above and only when it materially clarifies the person's project role. Do not insert paragraph breaks between people.

Return only the JSON object required by the output schema.`;

export const USER_PROMPT_TEMPLATE = `Authoritative Dataverse request context (structured JSON):

{{request_context_json}}

Proposal Narrative:

{{proposal_narrative}}

Proposal Bibliography:

{{proposal_bibliography}}

Create the eight proposal-core sections now. Return only the required JSON object.`;

/**
 * All values are assembled by the server and passed as overrides. The caller
 * owns Dataverse joins and the exact two-file AI Materials selection; the
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
      name: 'proposal_narrative',
      source: { kind: 'override' },
      required: true,
      cacheable: true,
      placement: 'user',
      dataClass: 'proposal_text',
      maxChars: 100000,
      untrusted: true,
    },
    {
      name: 'proposal_bibliography',
      source: { kind: 'override' },
      required: true,
      cacheable: true,
      placement: 'user',
      dataClass: 'proposal_text',
      maxChars: 60000,
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

const validationStringFields = {
  executiveSummary: { type: 'string', maxLength: 700 },
  impactOverview: { type: 'string', maxLength: 420 },
  methodologyOverview: { type: 'string', maxLength: 500 },
  personnelOverview: { type: 'string', maxLength: 520, forbidPattern: '\\r?\\n\\s*\\r?\\n' },
  keckFundingRationale: { type: 'string', maxLength: 480 },
  backgroundAndImpact: { type: 'string', maxLength: 9000 },
  detailedMethodology: { type: 'string', maxLength: 9000 },
  personnelDetails: { type: 'string', maxLength: 6000, forbidPattern: '\\r?\\n\\s*\\r?\\n' },
};

const jsonStringProperties = Object.fromEntries(
  Object.entries(validationStringFields).map(([key, value]) => [key, {
    type: 'string',
    maxLength: value.maxLength,
  }]),
);

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
