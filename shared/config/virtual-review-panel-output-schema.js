/**
 * Output schemas for the Virtual Review Panel LLM calls (A7 follow-up, step 2c).
 *
 * `lib/services/panel-review-service.js` `JSON.parse`s raw model output (via
 * `parseJSONResponse`) at seven stages:
 *
 *   Stage 0a  claim extraction        → CLAIM_EXTRACTION_SCHEMA
 *   Stage 0c  search-result collation → SEARCH_COLLATION_SCHEMA
 *   Stage 0d  intelligence synthesis  → INTELLIGENCE_SYNTHESIS_SCHEMA
 *   Stage 1   claim verification      → CLAIM_VERIFICATION_SCHEMA
 *   Stage 2   structured review       → STRUCTURED_REVIEW_SCHEMA
 *   Devil's advocate                  → DEVILS_ADVOCATE_SCHEMA
 *   Synthesis (panel summary)         → PANEL_SYNTHESIS_SCHEMA
 *
 * Each stage's output is re-fed into a later stage's prompt, so a clean parsed
 * object meaningfully limits injection propagation. These schemas are validated
 * AFTER the parse via `validateAiJson` — undeclared keys are dropped, types and
 * lengths are bounded — before the value is persisted, re-fed, or surfaced.
 *
 * Most fields are `required: false` with a default so a truncation-repaired
 * (`parseJSONResponse` `_truncated`) object still validates. The claim-
 * extraction schema deliberately omits defaults: the service tests
 * `claimData.noveltySearchStrings` to decide whether to skip the intelligence
 * pass, and that check must keep seeing `undefined` (not `[]`) when the model
 * omitted the field.
 *
 * The synthesis `ratingMatrix` and `disagreements[].positions` are dynamic
 * reviewer-name-keyed maps — they use the `record` node type.
 */

const optStr = (maxLength) => ({ type: 'string', required: false, default: '', maxLength });
const optStrNullable = (maxLength) => ({
  type: 'string', required: false, default: null, nullable: true, maxLength,
});
const optStrArray = (maxItems, itemMax) => ({
  type: 'array', required: false, default: [], maxItems,
  of: { type: 'string', maxLength: itemMax },
});

// Bare variants — `required: false` with NO default, so an absent field is
// omitted from the validated output rather than filled in. Used by the
// claim-extraction schema (see file header).
const bareStr = (maxLength) => ({ type: 'string', required: false, maxLength });
const bareStrArray = (maxItems, itemMax) => ({
  type: 'array', required: false, maxItems,
  of: { type: 'string', maxLength: itemMax },
});

// ============================================
// Stage 0a — claim extraction (Haiku)
// ============================================
export const CLAIM_EXTRACTION_SCHEMA = {
  type: 'object',
  fields: {
    noveltySearchStrings: bareStrArray(60, 300),
    techniqueSearchStrings: bareStrArray(60, 300),
    piNames: bareStrArray(40, 300),
    piDetails: {
      type: 'array', required: false, maxItems: 40,
      of: {
        type: 'object',
        fields: {
          name: optStr(300),
          institution: optStr(500),
          department: optStr(500),
        },
      },
    },
    field: bareStr(300),
  },
};

// ============================================
// Stage 0c — search-result collation (Haiku)
// ============================================
export const SEARCH_COLLATION_SCHEMA = {
  type: 'object',
  fields: {
    mostRelevantPapers: {
      type: 'array', required: false, default: [], maxItems: 100,
      of: {
        type: 'object',
        fields: {
          citation: optStr(1_000),
          source: optStr(100),
          relevanceToProposal: optStr(2_000),
          comparability: optStr(100),
          matchedClaim: optStr(1_000),
        },
      },
    },
    piPublicationSummary: {
      type: 'array', required: false, default: [], maxItems: 40,
      of: {
        type: 'object',
        fields: {
          piName: optStr(300),
          recentTopics: optStrArray(40, 300),
          apparentExpertise: optStrArray(40, 300),
          notableGaps: optStr(2_000),
        },
      },
    },
    recentPreprints: {
      type: 'array', required: false, default: [], maxItems: 100,
      of: {
        type: 'object',
        fields: {
          citation: optStr(1_000),
          significance: optStr(100),
          explanation: optStr(2_000),
        },
      },
    },
    landscapeSummary: optStr(5_000),
    searchGaps: optStr(5_000),
  },
};

// ============================================
// Stage 0d — intelligence synthesis (Perplexity)
// ============================================
export const INTELLIGENCE_SYNTHESIS_SCHEMA = {
  type: 'object',
  fields: {
    activeGroups: {
      type: 'array', required: false, default: [], maxItems: 40,
      of: {
        type: 'object',
        fields: {
          pi: optStr(300),
          institution: optStr(500),
          focus: optStr(2_000),
          recentActivity: optStr(2_000),
        },
      },
    },
    competingApproaches: optStrArray(40, 2_000),
    openProblems: optStrArray(40, 2_000),
    additionalContext: optStr(5_000),
    piContext: {
      type: 'array', required: false, default: [], maxItems: 40,
      of: {
        type: 'object',
        fields: {
          name: optStr(300),
          labUrl: optStrNullable(2_000),
          recentActivity: optStr(2_000),
        },
      },
    },
    gapResolution: optStr(5_000),
  },
};

// ============================================
// Stage 1 — claim verification
// (one schema for both the general and Perplexity variants; `sources` is
// only emitted by the Perplexity prompt, so it is optional.)
// ============================================
export const CLAIM_VERIFICATION_SCHEMA = {
  type: 'object',
  fields: {
    proposalClassification: optStr(2_000),
    scrutinyLensesApplied: optStrArray(20, 2_000),
    claims: {
      type: 'array', required: false, default: [], maxItems: 80,
      of: {
        type: 'object',
        fields: {
          claim: optStr(3_000),
          category: optStr(100),
          assessment: optStr(100),
          reasoning: optStr(10_000),
          sources: optStrArray(40, 2_000),
          confidence: optStr(100),
        },
      },
    },
    overallNoveltyAssessment: optStr(5_000),
    redFlags: optStrArray(40, 3_000),
    backgroundContext: optStr(10_000),
  },
};

// ============================================
// Stage 2 — structured review (WMKF reviewer form)
// ============================================
export const STRUCTURED_REVIEW_SCHEMA = {
  type: 'object',
  fields: {
    impactRating: optStr(200),
    impactNarrative: optStr(12_000),
    riskRating: optStr(200),
    riskNarrative: optStr(12_000),
    keyUncertaintyResolution: optStr(12_000),
    methodsAssessment: optStr(12_000),
    questionsForPI: optStr(12_000),
    teamAssessment: optStr(12_000),
    fundingAlternatives: optStr(12_000),
    budgetIssues: optStr(12_000),
    overallRating: optStr(200),
    additionalComments: optStr(12_000),
  },
};

// ============================================
// Devil's advocate
// ============================================
export const DEVILS_ADVOCATE_SCHEMA = {
  type: 'object',
  fields: {
    primaryConcern: optStr(5_000),
    failureScenario: optStr(5_000),
    challengedAssumptions: optStrArray(20, 3_000),
    competitiveWeaknesses: optStr(5_000),
    budgetAndTimeline: optStr(5_000),
    bestCounterargument: optStr(5_000),
    verdictIfSkeptical: optStr(5_000),
  },
};

// ============================================
// Synthesis — panel summary
// ============================================

// Dynamic reviewer-name-keyed map: reviewer name -> rating string.
const ratingRecord = {
  type: 'record', required: false, default: {},
  maxEntries: 20, keys: { maxLength: 200 },
  of: { type: 'string', maxLength: 200 },
};

export const PANEL_SYNTHESIS_SCHEMA = {
  type: 'object',
  fields: {
    ratingMatrix: {
      type: 'object', required: false, default: {},
      fields: {
        impactRating: ratingRecord,
        riskRating: ratingRecord,
        overallRating: ratingRecord,
      },
    },
    consensus: optStrArray(20, 3_000),
    disagreements: {
      type: 'array', required: false, default: [], maxItems: 20,
      of: {
        type: 'object',
        fields: {
          topic: optStr(1_000),
          // Dynamic reviewer-name-keyed map: reviewer name -> position text.
          positions: {
            type: 'record', required: false, default: {},
            maxEntries: 20, keys: { maxLength: 200 },
            of: { type: 'string', maxLength: 3_000 },
          },
          significance: optStr(3_000),
        },
      },
    },
    keyStrengths: optStrArray(20, 3_000),
    keyConcerns: optStrArray(20, 3_000),
    questionsForPI: optStrArray(40, 3_000),
    resolvableVsFundamental: optStrArray(20, 3_000),
    claimVerificationHighlights: optStrArray(20, 3_000),
    devilsAdvocateSummary: optStrNullable(5_000),
    panelRecommendation: optStr(5_000),
    confidenceNote: optStr(3_000),
  },
};

/** Stage key → schema, for the service's `_validateStageOutput` dispatch. */
export const VRP_OUTPUT_SCHEMAS = {
  claimExtraction: CLAIM_EXTRACTION_SCHEMA,
  searchCollation: SEARCH_COLLATION_SCHEMA,
  intelligenceSynthesis: INTELLIGENCE_SYNTHESIS_SCHEMA,
  claimVerification: CLAIM_VERIFICATION_SCHEMA,
  structuredReview: STRUCTURED_REVIEW_SCHEMA,
  devilsAdvocate: DEVILS_ADVOCATE_SCHEMA,
  synthesis: PANEL_SYNTHESIS_SCHEMA,
};
