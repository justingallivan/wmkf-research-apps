/**
 * Output schema for the Expertise Finder matching LLM call (A7 Part 5).
 *
 * /api/expertise-finder/match and /batch-match `JSON.parse` raw model output
 * and persist it to the `expertise_matches.match_results` Postgres column. A
 * prompt-injected model can add keys or smuggle bad values; this schema is
 * validated AFTER the parse (via `validateAiJson`) so undeclared keys are
 * dropped and types/enums are enforced before the result is stored.
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

const namedRationale = (rationaleKey) => ({
  type: 'object',
  required: false,
  default: {},
  fields: {
    name: optionalString(300),
    [rationaleKey]: optionalString(4_000),
  },
});

/** Schema for `buildCacheableSystemPrompt`/`buildUserPrompt` match output. */
export const EXPERTISE_MATCH_SCHEMA = {
  type: 'object',
  fields: {
    proposal_summary: {
      type: 'object',
      required: false,
      default: {},
      fields: {
        title: optionalString(1_000),
        program: optionalString(200),
        institution: optionalString(500),
        pi_name: optionalString(300),
        core_question: optionalString(2_000),
        key_methods: optionalStringArray(50, 500),
        disciplinary_areas: optionalStringArray(50, 500),
      },
    },
    staff_assignment: {
      type: 'object',
      required: false,
      default: {},
      fields: {
        primary: namedRationale('rationale'),
        secondary: namedRationale('rationale'),
      },
    },
    consultant_overlap: {
      type: 'array',
      required: false,
      default: [],
      maxItems: 50,
      of: {
        type: 'object',
        fields: {
          name: optionalString(300),
          relevance: {
            type: 'string',
            required: false,
            default: 'partial',
            enum: ['strong', 'partial'],
            coerceEnum: true,
          },
          rationale: optionalString(4_000),
        },
      },
    },
    board_interest: {
      type: 'array',
      required: false,
      default: [],
      maxItems: 50,
      of: {
        type: 'object',
        fields: {
          name: optionalString(300),
          rationale: optionalString(4_000),
          note: optionalString(1_000),
        },
      },
    },
    expertise_gaps: {
      type: 'object',
      required: false,
      default: { has_gaps: false, description: null },
      fields: {
        has_gaps: { type: 'boolean', required: false, default: false },
        description: { type: 'string', required: false, default: null, nullable: true, maxLength: 5_000 },
      },
    },
    conflicts: {
      type: 'array',
      required: false,
      default: [],
      maxItems: 50,
      of: {
        type: 'object',
        fields: {
          name: optionalString(300),
          reason: optionalString(2_000),
        },
      },
    },
  },
};
