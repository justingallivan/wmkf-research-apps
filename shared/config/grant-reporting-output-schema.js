/**
 * Output schemas for the Grant Reporting LLM calls (A7 Part 1).
 *
 * The extract route `JSON.parse`s raw model output. A prompt-injected model
 * can add keys or smuggle bad values; these schemas are validated AFTER the
 * parse (via `validateAiJson`) so undeclared keys are dropped and types/enums
 * are enforced before the result reaches staff.
 *
 * Design notes:
 *  - Nearly every field is `required: false` with a `default`: a thin or
 *    partial report legitimately yields missing fields, and the goal here is
 *    structural safety, not forcing the model to invent content.
 *  - Enum fields use `coerceEnum: true` — an out-of-enum status is coerced to
 *    a safe default rather than failing the whole extraction.
 *  - String `maxLength` caps are generous (narrative paragraphs are long) but
 *    finite, so a runaway/echoed payload cannot ride through unbounded.
 */

const optionalString = (maxLength) => ({
  type: 'string',
  required: false,
  default: '',
  maxLength,
});

const optionalCount = () => ({
  type: 'integer',
  required: false,
  default: null,
  nullable: true,
  min: 0,
  max: 1_000_000,
});

const publicationNode = () => ({
  type: 'object',
  required: false,
  default: { citation: '', abstract: '', source: 'verbatim' },
  fields: {
    citation: optionalString(4_000),
    abstract: optionalString(20_000),
    source: {
      type: 'string',
      required: false,
      default: 'verbatim',
      enum: ['verbatim', 'summarized'],
      coerceEnum: true,
    },
  },
});

/** Schema for `createGrantReportExtractionPrompt` output. */
export const GRANT_REPORT_EXTRACTION_SCHEMA = {
  type: 'object',
  fields: {
    header: {
      type: 'object',
      required: false,
      default: {},
      fields: {
        title: optionalString(1_000),
        pis: {
          type: 'array',
          required: false,
          default: [],
          maxItems: 50,
          of: { type: 'string', maxLength: 500 },
        },
        award_amount: optionalString(100),
        project_period: optionalString(200),
        subject_area: optionalString(200),
        purpose: optionalString(2_000),
        abstract: optionalString(20_000),
      },
    },
    counts: {
      type: 'object',
      required: false,
      default: {},
      fields: {
        postdocs: optionalCount(),
        grad_students: optionalCount(),
        undergrads: optionalCount(),
        total_publications: optionalCount(),
        peer_reviewed_publications: optionalCount(),
        non_peer_reviewed_publications: optionalCount(),
        patents_awarded: optionalCount(),
        patents_submitted: optionalCount(),
        additional_funding_secured: optionalString(2_000),
      },
    },
    narratives: {
      type: 'object',
      required: false,
      default: {},
      fields: {
        project_impacts: optionalString(50_000),
        awards_and_honors: optionalString(20_000),
        publication_1: publicationNode(),
        publication_2: publicationNode(),
        implications_for_future_grantmaking: optionalString(20_000),
      },
    },
  },
};

/** Schema for the `goalsAssessment` object from `createGoalsAssessmentPrompt`. */
export const GOALS_ASSESSMENT_SCHEMA = {
  type: 'object',
  fields: {
    goals: {
      type: 'array',
      required: false,
      default: [],
      maxItems: 50,
      of: {
        type: 'object',
        fields: {
          goal_number: optionalString(50),
          goal_text: optionalString(5_000),
          evidence_from_report: optionalString(10_000),
          status: {
            type: 'string',
            required: false,
            default: 'not_addressed',
            enum: ['achieved', 'partial', 'not_addressed', 'pivoted'],
            coerceEnum: true,
          },
          confidence: {
            type: 'string',
            required: false,
            default: 'low',
            enum: ['high', 'medium', 'low'],
            coerceEnum: true,
          },
        },
      },
    },
    outcome_summary: optionalString(5_000),
    overall_rating: {
      type: 'string',
      required: false,
      default: 'mixed',
      enum: ['successful', 'mixed', 'unsuccessful'],
      coerceEnum: true,
    },
    notes_for_staff: optionalString(10_000),
  },
};

/**
 * Schema for `createFieldRegenerationPrompt` output: `{ value: ... }` where
 * `value` is either a narrative string or a publication object. The route
 * passes the matching node depending on `fieldKey`.
 */
export const FIELD_REGEN_SCHEMA = {
  string: {
    type: 'object',
    fields: { value: optionalString(50_000) },
  },
  publication: {
    type: 'object',
    fields: { value: publicationNode() },
  },
};
