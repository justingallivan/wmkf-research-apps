/** J27 intake P4. Roster and current Methodology are supplied by the intake caller. */

export const PROMPT_NAME = 'j27.personnel.generate';

export const SYSTEM_PROMPT = `Draft the page-one Personnel bullet for a W. M. Keck Foundation research proposal. Write one paragraph that names each investigator, explains their relevant expertise, and connects the team's expertise to the methods the project requires.

Use the official intake roster as the sole authority for inclusion, names, roles, order, rank, department, and institution. Include the PI first, then every official Co-PI in roster order. Do not add people, change roles, or infer appointments from the proposal or biosketches. Omit collaborators, students, postdoctoral fellows, staff, and anyone outside the official PI and Co-PI roster.

Underline each person's first mention with <u> and </u>. Use the roster's name, omitting middle names or initials in the paragraph unless needed to distinguish two people. Use plain lowercase academic or research ranks and department names. Drop degrees, honors, named chairs, and administrative titles. Mention a Co-PI's institution only when it differs from the PI's. Omit unsupported appointment details.

Describe each person's project-relevant expertise in specific, neutral terms. Credit a contribution to a key enabling method only when the proposal states that the person pioneered it. If the proposal claims expertise or a pioneering contribution the matching biosketch cannot support, attribute the claim to the proposal and add an expertise_unsupported question. If an essential method lacks a clearly qualified person, add an expertise_gap question and keep the paragraph focused on the expertise the team covers.

Scale the paragraph to the team. Allow about 30 words for the PI, about 20 each for the first two or three Co-PIs, and about 12 each for later Co-PIs. Group later Co-PIs by shared expertise where possible while naming everyone. End with one sentence of about 15 words connecting the team to the current Methodology. Report the word budget you used.

Use present tense and direct language. Avoid hype, em dashes, semicolons, and bare pronoun openers such as "This shows". Never invent an appointment, contribution, publication, or citation.

Return only the JSON object. Keep personnel separate from people, titles_dropped, word_budget, and open_questions. In people, copy each official roster name and role exactly in roster order. Use empty strings for absent details or pioneer evidence. Give the source page and section for open questions when known, using null and an empty string otherwise.`;

export const USER_PROMPT_TEMPLATE = `<proposal>
{{proposal_text}}
</proposal>

<key_personnel>
{{key_personnel}}
</key_personnel>

<biosketches>
{{biosketches}}
</biosketches>

<methodology>
{{methodology}}
</methodology>`;

export const PROMPT_VARIABLES = {
  variables: [
    {
      name: 'proposal_text', source: { kind: 'override' }, required: true, placement: 'user',
      dataClass: 'proposal_text', maxChars: 100000, untrusted: true,
    },
    {
      name: 'key_personnel', source: { kind: 'override' }, required: true, placement: 'user',
      dataClass: 'crm_record_text', maxChars: 25000, untrusted: true,
    },
    {
      name: 'biosketches', source: { kind: 'override' }, required: true, placement: 'user',
      dataClass: 'applicant_material', maxChars: 100000, untrusted: true,
    },
    {
      name: 'methodology', source: { kind: 'override' }, required: true, placement: 'user',
      dataClass: 'crm_record_text', maxChars: 3000, untrusted: true,
    },
  ],
};

const roles = ['PI', 'Co-PI'];
const questionTypes = ['expertise_gap', 'expertise_unsupported'];

export const PROMPT_OUTPUT_SCHEMA = {
  parseMode: 'json',
  generationMode: 'native-json-schema',
  outputs: [
    { name: 'personnel', type: 'string', target: { kind: 'none' } },
    { name: 'people', type: 'array', target: { kind: 'none' } },
    { name: 'word_budget', type: 'number', target: { kind: 'none' } },
    { name: 'titles_dropped', type: 'array', target: { kind: 'none' } },
    { name: 'open_questions', type: 'array', target: { kind: 'none' } },
  ],
  jsonSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['personnel', 'people', 'word_budget', 'titles_dropped', 'open_questions'],
    properties: {
      personnel: { type: 'string' },
      people: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'role', 'rank', 'department', 'institution', 'expertise', 'pioneer'],
          properties: {
            name: { type: 'string' },
            role: { type: 'string', enum: roles },
            rank: { type: 'string' },
            department: { type: 'string' },
            institution: { type: 'string' },
            expertise: { type: 'string' },
            pioneer: {
              type: 'object',
              additionalProperties: false,
              required: ['method', 'proposal_statement', 'biosketch_citation'],
              properties: {
                method: { type: 'string' },
                proposal_statement: { type: 'string' },
                biosketch_citation: { type: 'string' },
              },
            },
          },
        },
      },
      word_budget: { type: 'integer' },
      titles_dropped: { type: 'array', items: { type: 'string' } },
      open_questions: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['type', 'detail', 'page', 'section'],
          properties: {
            type: { type: 'string', enum: questionTypes },
            detail: { type: 'string' },
            page: { type: ['integer', 'null'] },
            section: { type: 'string' },
          },
        },
      },
    },
  },
  validationSchema: {
    type: 'object',
    fields: {
      personnel: { type: 'string', maxLength: 8000, forbidPattern: '^\\s*$' },
      people: {
        type: 'array',
        maxItems: 51,
        of: {
          type: 'object',
          fields: {
            name: { type: 'string', maxLength: 250 },
            role: { type: 'string', enum: roles },
            rank: { type: 'string', maxLength: 250 },
            department: { type: 'string', maxLength: 250 },
            institution: { type: 'string', maxLength: 250 },
            expertise: { type: 'string', maxLength: 1000 },
            pioneer: {
              type: 'object',
              fields: {
                method: { type: 'string', maxLength: 500 },
                proposal_statement: { type: 'string', maxLength: 1000 },
                biosketch_citation: { type: 'string', maxLength: 1000 },
              },
            },
          },
        },
      },
      word_budget: { type: 'integer', min: 1, max: 1000 },
      titles_dropped: { type: 'array', maxItems: 100, of: { type: 'string', maxLength: 500 } },
      open_questions: {
        type: 'array',
        maxItems: 50,
        of: {
          type: 'object',
          fields: {
            type: { type: 'string', enum: questionTypes },
            detail: { type: 'string', maxLength: 1000 },
            page: { type: 'integer', min: 1, nullable: true },
            section: { type: 'string', maxLength: 200 },
          },
        },
      },
    },
  },
  rawOutputRetention: 'hash',
};
