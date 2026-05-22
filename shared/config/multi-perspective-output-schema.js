/**
 * Output schemas for the Multi-Perspective Evaluator LLM calls (A7 follow-up).
 *
 * /api/evaluate-multi-perspective `JSON.parse`s raw model output at four
 * stages (initial analysis, proposal summary, each perspective, integrator).
 * These schemas are validated AFTER the parse via `validateAiJson` so an
 * injected model cannot smuggle keys or bad enum values forward — in
 * particular, the Stage-1 output is re-fed into every later stage, so a clean
 * Stage-1 object meaningfully limits injection propagation.
 *
 * The integrator output has dynamic-keyed maps (`agreedRatings`,
 * `criteriaRatings` — keyed by model-chosen criterion names); those use the
 * `record` node type.
 */

const optStr = (maxLength) => ({ type: 'string', required: false, default: '', maxLength });
const optStrNullable = (maxLength) => ({
  type: 'string', required: false, default: null, nullable: true, maxLength,
});
const optStrArray = (maxItems, itemMax) => ({
  type: 'array', required: false, default: [], maxItems,
  of: { type: 'string', maxLength: itemMax },
});

const ratingEnum = {
  type: 'string', required: false, default: 'Moderate',
  enum: ['Strong', 'Moderate', 'Weak'], coerceEnum: true,
};
const confidenceEnum = {
  type: 'string', required: false, default: 'Medium',
  enum: ['High', 'Medium', 'Low'], coerceEnum: true,
};
const severityEnum = {
  type: 'string', required: false, default: 'Medium',
  enum: ['High', 'Medium', 'Low'], coerceEnum: true,
};

const criterionEvaluation = {
  type: 'object',
  fields: { criterion: optStr(300), rating: ratingEnum, reasoning: optStr(5_000) },
};
const criteriaEvaluations = {
  type: 'array', required: false, default: [], maxItems: 30, of: criterionEvaluation,
};

/** Stage 1 — `createInitialAnalysisPrompt`. */
export const INITIAL_ANALYSIS_SCHEMA = {
  type: 'object',
  fields: {
    eligibility: {
      type: 'object', required: false, default: {},
      fields: {
        isEligible: { type: 'boolean', required: false, default: true },
        flag: optStrNullable(200),
        flagReason: optStrNullable(5_000),
      },
    },
    title: optStr(1_000),
    piName: optStrNullable(300),
    institution: optStrNullable(500),
    summary: optStr(5_000),
    researchArea: optStr(300),
    subfields: optStrArray(20, 200),
    searchQueries: optStrArray(20, 300),
    keyMethodologies: optStrArray(50, 500),
    initialObservations: {
      type: 'object', required: false, default: {},
      fields: {
        innovativeAspects: optStr(5_000),
        technicalApproach: optStr(5_000),
        potentialChallenges: optStr(5_000),
      },
    },
  },
};

/** Stage 2.5 — `createProposalSummaryPrompt`. */
export const PROPOSAL_SUMMARY_SCHEMA = {
  type: 'object',
  fields: {
    proposalSummary: {
      type: 'object', required: false, default: {},
      fields: { whatTheyreProposing: optStr(5_000), potentialImpact: optStr(5_000) },
    },
    keyInnovation: optStr(2_000),
    fieldContext: optStr(2_000),
  },
};

/** Stage 3a — `createOptimistPrompt`. */
export const OPTIMIST_SCHEMA = {
  type: 'object',
  fields: {
    perspective: optStr(50),
    overallImpression: optStr(3_000),
    criteriaEvaluations,
    keyStrengths: optStrArray(30, 2_000),
    potentialUpsides: optStrArray(30, 2_000),
    anticipatedConcerns: {
      type: 'array', required: false, default: [], maxItems: 30,
      of: { type: 'object', fields: { concern: optStr(2_000), counterpoint: optStr(2_000) } },
    },
    overallRating: ratingEnum,
    confidenceLevel: confidenceEnum,
  },
};

/** Stage 3b — `createSkepticPrompt`. */
export const SKEPTIC_SCHEMA = {
  type: 'object',
  fields: {
    perspective: optStr(50),
    overallImpression: optStr(3_000),
    criteriaEvaluations,
    keyConcerns: {
      type: 'array', required: false, default: [], maxItems: 30,
      of: {
        type: 'object',
        fields: { concern: optStr(2_000), severity: severityEnum, reasoning: optStr(3_000) },
      },
    },
    potentialFailureModes: optStrArray(30, 2_000),
    missingInformation: optStrArray(30, 2_000),
    literatureConcerns: optStr(5_000),
    overallRating: ratingEnum,
    confidenceLevel: confidenceEnum,
  },
};

/** Stage 3c — `createNeutralPrompt`. */
export const NEUTRAL_SCHEMA = {
  type: 'object',
  fields: {
    perspective: optStr(50),
    overallImpression: optStr(3_000),
    criteriaEvaluations,
    balancedStrengths: optStrArray(30, 2_000),
    balancedConcerns: optStrArray(30, 2_000),
    mostLikelyOutcome: optStr(3_000),
    comparisonToField: optStr(3_000),
    keyUncertainties: optStrArray(30, 2_000),
    overallRating: ratingEnum,
    confidenceLevel: confidenceEnum,
  },
};

/** Perspective name → schema, for the route's `callPerspective` dispatch. */
export const PERSPECTIVE_SCHEMAS = {
  optimist: OPTIMIST_SCHEMA,
  skeptic: SKEPTIC_SCHEMA,
  neutral: NEUTRAL_SCHEMA,
};

/** Stage 4 — `createIntegratorPrompt`. */
export const INTEGRATOR_SCHEMA = {
  type: 'object',
  fields: {
    consensus: {
      type: 'object', required: false, default: {},
      fields: {
        agreedStrengths: optStrArray(30, 2_000),
        agreedConcerns: optStrArray(30, 2_000),
        // Dynamic-keyed: criterion name -> { rating, agreement }.
        agreedRatings: {
          type: 'record', required: false, default: {},
          maxEntries: 40, keys: { maxLength: 200 },
          of: {
            type: 'object',
            fields: {
              rating: ratingEnum,
              agreement: {
                type: 'string', required: false, default: 'Partial',
                enum: ['Full', 'Partial', 'Split'], coerceEnum: true,
              },
            },
          },
        },
      },
    },
    disagreements: {
      type: 'array', required: false, default: [], maxItems: 30,
      of: {
        type: 'object',
        fields: {
          topic: optStr(1_000),
          optimistView: optStr(3_000),
          skepticView: optStr(3_000),
          neutralView: optStr(3_000),
          resolution: optStr(3_000),
        },
      },
    },
    synthesis: {
      type: 'object', required: false, default: {},
      fields: {
        weightedRecommendation: {
          type: 'string', required: false, default: 'Borderline',
          enum: ['Strong Recommend', 'Recommend', 'Borderline', 'Not Recommended'],
          coerceEnum: true,
        },
        recommendationRationale: optStr(3_000),
        confidenceInRecommendation: confidenceEnum,
        confidenceRationale: optStr(2_000),
        overallNarrative: optStr(5_000),
        keyTakeaways: optStrArray(20, 2_000),
        // Dynamic-keyed: criterion name -> rating.
        criteriaRatings: {
          type: 'record', required: false, default: {},
          maxEntries: 40, keys: { maxLength: 200 },
          of: ratingEnum,
        },
      },
    },
    forDecisionMakers: {
      type: 'object', required: false, default: {},
      fields: {
        headline: optStr(1_000),
        furtherConsiderIf: optStr(2_000),
        declineIf: optStr(2_000),
      },
    },
  },
};
