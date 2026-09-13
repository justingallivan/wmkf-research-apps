/**
 * Virtual Review Panel Phase A question-set projection.
 * docs/plans/VIRTUAL_REVIEW_PANEL_PHASE_A_BUILD_PLAN_2026-09-12.md §5 A.3, D7, D9.
 *
 * `projectSeatQuestionSet` applies the SAME predicate the human submission
 * snapshot uses (lib/external/build-review-submission.js:184-191): only
 * picklist/multiselect/richtext fields become answer questions, sorted by
 * `order`. `affiliation` is `type:'string'` (lib/external/review-form-schema.js)
 * and is excluded by type, never by key name, so a future string field is
 * excluded the same way without a code change.
 *
 * `teamCapacity` (D7) is a real richtext question in the human form, but Phase
 * A never gives the panel budget or team materials, so it cannot be honestly
 * assessed. It is projected as a fixed not-assessable marker instead of a free
 * -text question; `buildSeatValidationSchema` accepts ONLY the literal
 * `{ status: 'not_assessable' }` for that key (`allowExtra: 'error'` rejects
 * any other key, including an attempted answer, on that one field).
 *
 * `chairInput` (D9): the chair receives each seat's structured review plus the
 * narrative, but never the seat's teamCapacity marker (it is not assessable
 * information, and does not belong in the chair's synthesis input).
 */

export const REVIEW_PANEL_NOT_ASSESSABLE_REPORT_LINE =
  'Not assessed in Phase A (budget and team materials not provided)';

const PROJECTABLE_TYPES = new Set(['picklist', 'multiselect', 'richtext']);
const TEAM_CAPACITY_KEY = 'teamCapacity';

/** Filter + sort a question-set field list into the seat's answer-question projection. Same predicate/order as the human submission snapshot. */
export function projectSeatQuestionSet(fields) {
  return (Array.isArray(fields) ? fields : [])
    .filter((field) => PROJECTABLE_TYPES.has(field?.type))
    .slice()
    .sort((a, b) => Number(a.order) - Number(b.order))
    .map((field) => {
      if (field.key === TEAM_CAPACITY_KEY) return { key: field.key, notAssessable: true };
      return {
        key: field.key,
        type: field.type,
        label: field.label ?? null,
        maxLength: Number.isInteger(field.maxLength) ? field.maxLength : null,
        options: Array.isArray(field.options) ? field.options.map((o) => o.value) : null,
      };
    });
}

// ai-output-schema.js's `enum` constraint is only implemented on `type:'string'`
// nodes (integer/number nodes only support min/max bounds, not membership), so
// picklist/multiselect option values (numeric in review-form-schema.js) are
// validated as their STRING form here; the seat prompt instructs the model to
// return each choice as its numeric value encoded as a JSON string (e.g. "2").
function fieldValidationNode(field) {
  if (field.type === 'richtext') {
    return { type: 'string', maxLength: Number.isInteger(field.maxLength) ? field.maxLength : 50000 };
  }
  if (field.type === 'picklist') {
    return { type: 'string', enum: (field.options || []).map(String) };
  }
  if (field.type === 'multiselect') {
    return { type: 'array', of: { type: 'string', enum: (field.options || []).map(String) }, maxItems: (field.options || []).length || 50 };
  }
  throw new Error(`buildSeatValidationSchema: unsupported projected field type "${field.type}"`);
}

/** Build the executePrompt validationSchema (lib/utils/ai-output-schema.js node shape) for one seat's structured review, from a projected question set. */
export function buildSeatValidationSchema(projected) {
  const fields = {};
  for (const field of Array.isArray(projected) ? projected : []) {
    if (field.notAssessable) {
      // Accepts ONLY the literal not-assessable marker; any other shape
      // (including an attempted free-text answer) fails validation.
      fields[field.key] = {
        type: 'object',
        allowExtra: 'error',
        fields: { status: { type: 'string', enum: ['not_assessable'] } },
      };
      continue;
    }
    fields[field.key] = fieldValidationNode(field);
  }
  return { type: 'object', fields };
}

/** Build the chair's per-seat input from raw (already-validated) seat review objects, omitting teamCapacity (D9). */
export function chairInput(seatReviews) {
  const out = {};
  for (const [seatKey, review] of Object.entries(seatReviews || {})) {
    const { [TEAM_CAPACITY_KEY]: _omitted, ...rest } = review || {};
    out[seatKey] = rest;
  }
  return out;
}
