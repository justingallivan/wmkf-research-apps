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

// The human form's richtext fields (lib/external/review-form-schema.js) allow
// up to 50000 characters, but a seat answers up to 11 such questions in one
// structured JSON response under an 8,000-output-token seat ceiling. 11
// answers x 2000 chars / ~4 chars-per-token ~= 5,500 output tokens, leaving
// headroom in that 8,000-token ceiling for JSON structure and picklist keys.
// A production run at the full 50000-char guidance produced an 8,000-token
// truncation with no output persisted (Request finding, 2026-09-13); this cap
// is what actually prevents that, independent of any seed-row maxtokens value.
export const SEAT_ANSWER_MAX_CHARS = 2000;

// The prompt guidance line stays at SEAT_ANSWER_MAX_CHARS (drives brevity), but
// ai-output-schema.js's maxLength is a hard, strict rejection: a model that
// slightly overruns the guidance would otherwise fail the WHOLE seat
// (claude_output_schema_invalid) and discard an already-paid-for review. The
// schema instead tolerates up to 2x the guidance — gross overruns only — so
// 11 answers x 4000 chars / ~4 chars-per-token ~= 11,000 output tokens still
// fits the 12,000-token seed ceiling with headroom for JSON structure.
export const SEAT_ANSWER_SCHEMA_MAX_CHARS = SEAT_ANSWER_MAX_CHARS * 2;

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
        // Retain {value, label} pairs (not just bare values): the model needs
        // each option's label to answer meaningfully (renderSeatQuestionsText),
        // while buildSeatValidationSchema only needs the values for its enum.
        options: Array.isArray(field.options) ? field.options.map((o) => ({ value: o.value, label: o.label ?? null })) : null,
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
    return { type: 'string', maxLength: Math.min(field.maxLength || SEAT_ANSWER_SCHEMA_MAX_CHARS, SEAT_ANSWER_SCHEMA_MAX_CHARS) };
  }
  if (field.type === 'picklist') {
    return { type: 'string', enum: (field.options || []).map((o) => String(o.value)) };
  }
  if (field.type === 'multiselect') {
    return { type: 'array', of: { type: 'string', enum: (field.options || []).map((o) => String(o.value)) }, maxItems: (field.options || []).length || 50 };
  }
  throw new Error(`buildSeatValidationSchema: unsupported projected field type "${field.type}"`);
}

/**
 * Render the projected question set as plain instruction text for the seat
 * prompt (the `{{review_questions}}` variable) — the model otherwise has no
 * way to know what keys/answer shapes to produce, since `validationSchema`
 * is applied AFTER parsing (lib/utils/ai-output-schema.js), not supplied to
 * the provider as a request-time schema. Not untrusted: rendered entirely
 * from the staff-authored question definitions, never from applicant text.
 */
export function renderSeatQuestionsText(projected) {
  const lines = (Array.isArray(projected) ? projected : []).map((field) => {
    if (field.notAssessable) {
      return `- ${field.key}: Out of scope for Phase A. Return exactly {"status":"not_assessable"} for this key. Do not attempt to answer it.`;
    }
    const label = field.label || field.key;
    if (field.type === 'richtext') {
      const maxChars = Math.min(field.maxLength || SEAT_ANSWER_MAX_CHARS, SEAT_ANSWER_MAX_CHARS);
      return `- ${field.key} ("${label}"): answer in prose, as a JSON string, up to ${maxChars} characters.`;
    }
    if (field.type === 'picklist') {
      const opts = (field.options || []).map((o) => `"${o.value}" = ${o.label ?? o.value}`).join('; ');
      return `- ${field.key} ("${label}"): return exactly ONE of these values, as a JSON string (the quoted number, not the label): ${opts}.`;
    }
    if (field.type === 'multiselect') {
      const opts = (field.options || []).map((o) => `"${o.value}" = ${o.label ?? o.value}`).join('; ');
      return `- ${field.key} ("${label}"): return a JSON array of zero or more of these values, each as a string (the quoted number, not the label): ${opts}.`;
    }
    return `- ${field.key} ("${label}"): answer as a JSON string.`;
  });
  return [
    'Be concise and specific; each answer must stay within its character limit.',
    ...lines,
  ].join('\n');
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
