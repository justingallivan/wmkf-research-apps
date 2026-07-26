/**
 * Reviewer-form schema. Single source of truth for what fields the external
 * review form collects, how they validate, their stable snapshot keys/order,
 * and (for the structured ratings + affiliation) how they map to Dataverse
 * columns on `wmkf_appreviewersuggestion`.
 *
 * Used by:
 *   - the public landing page (renders the form fields by walking this config)
 *   - the external upload endpoint (validates posted values before SharePoint+Dataverse writes)
 *   - the staff upload endpoint (renders the same form when uploading on behalf)
 *   - the in-browser authoring surface (reviewer review-form build): the draft
 *     autosave route whitelists/sanitizes by these keys, and Phase 3's submit
 *     maps each question into the `wmkf_appreviewanswer` snapshot child rows.
 *
 * Field types:
 *   - `string`   — single-line text (affiliation), maps to a parent column.
 *   - `picklist` — single-select rating (Q4/Q10), stored in the snapshot.
 *   - `multiselect` — check-all-that-apply categorical answer (Q3), stored as
 *     canonical JSON pairs in the snapshot.
 *   - `richtext` — narrative answer authored in-browser. Stored
 *     as server-sanitized HTML in the snapshot child table, NOT on a parent
 *     column (no `dataverseField`). Q2/Q4–Q9/Q11 previously lived only in the
 *     uploaded review PDF; they now move into the page.
 *
 * `order` is the question's display/snapshot position (1–11); affiliation is the
 * "Title & Organization" identity field, not one of the 11 questions, so it has
 * no `order` and is never written to the snapshot. The snapshot questions are
 * exactly the picklist + multiselect + richtext fields.
 */

import { canonicalizeMultiselectSelection } from './review-multiselect.js';

export const reviewFormSchema = {
  fields: [
    {
      key: 'affiliation',
      dataverseField: 'wmkf_revieweraffiliation',
      label: 'Title & Organization',
      hint: 'Pre-filled from CRM if known. Edit if your affiliation has changed.',
      type: 'string',
      maxLength: 300,
      required: true,
      prefillFromCrm: true,
    },
    {
      key: 'priorWork',
      order: 1,
      label: 'Q1 — Are there existing publications, technologies, or prior work that address part of the proposed work? What distinguishes this proposal?',
      type: 'richtext',
      required: true,
      maxLength: 50000,
    },
    {
      key: 'foreseenImpacts',
      order: 2,
      label: 'Q2 — What specific significant impacts do you foresee? Which outcomes may be useful to your work?',
      type: 'richtext',
      required: true,
      maxLength: 50000,
    },
    {
      key: 'impactAreas',
      order: 3,
      label: 'Q3 — If the proposed project is successful in its entirety, it will (check all that apply)',
      type: 'multiselect',
      required: true,
      options: [
        { value: 1, label: 'Provide enabling tools to the community' },
        { value: 2, label: 'Result in publications of disciplinary interest' },
        { value: 3, label: 'Result in publications of broad interest' },
        { value: 4, label: 'Revise textbooks' },
      ],
    },
    {
      key: 'riskLevel',
      order: 4,
      label: 'Q4 — How risky is the project overall?',
      hint: 'The Keck Foundation is comfortable funding risky projects.',
      type: 'picklist',
      required: true,
      options: [
        { value: 1, label: 'Low risk (will likely work in its entirety)' },
        { value: 2, label: 'Medium risk (parts may succeed, others may fail)' },
        { value: 3, label: 'High risk (significant risk of failure)' },
        { value: 4, label: 'Impossible (fatal flaw)' },
      ],
    },
    {
      key: 'riskDetail',
      order: 5,
      label: 'Q5 — What are the risks (technical, hypothesis, or scope)?',
      type: 'richtext',
      required: true,
      maxLength: 50000,
    },
    {
      key: 'methodsAppropriate',
      order: 6,
      label: 'Q6 — Are the proposed methods, data gathering, and analysis appropriate?',
      type: 'richtext',
      required: true,
      maxLength: 50000,
    },
    {
      key: 'teamCapacity',
      order: 7,
      label: 'Q7 — Do you have concerns about the team’s capacity, including personnel, infrastructure, or budget?',
      type: 'richtext',
      required: true,
      maxLength: 50000,
    },
    {
      key: 'questionsForPi',
      order: 8,
      label: 'Q8 — What questions should the Foundation raise with the principal investigator?',
      type: 'richtext',
      required: true,
      maxLength: 50000,
    },
    {
      key: 'traditionalFunding',
      order: 9,
      label: 'Q9 — Would this proposal be competitive in peer review at a traditional funding agency?',
      type: 'richtext',
      required: true,
      maxLength: 50000,
    },
    {
      key: 'overallAssessment',
      order: 10,
      label: 'Q10 — Please assign an overall rating to the proposal.',
      type: 'picklist',
      required: true,
      options: [
        { value: 5, label: 'Excellent' },
        { value: 4, label: 'Very Good' },
        { value: 3, label: 'Good' },
        { value: 2, label: 'Fair' },
        { value: 1, label: 'Poor' },
      ],
    },
    {
      key: 'additionalComments',
      order: 11,
      label: 'Q11 — Is there anything else you would like to share with the Foundation about the proposal or this review process?',
      type: 'richtext',
      required: false,
      maxLength: 50000,
    },
  ],
};

// Short, column-friendly labels for the two structured ratings (the schema
// `label` fields hold the full question text). Keyed by `field.key`.
export const reviewRatingShortLabels = {
  riskLevel: 'Risk',
  overallAssessment: 'Overall',
};

/**
 * The parent-column write binding, keyed by `field.key`. Maps a form field to a
 * scalar column on `wmkf_appreviewersuggestion`.
 *
 * **Phase E (S305): affiliation only.** Ratings retired their parent
 * columns — ratings now live solely in the `wmkf_appreviewanswer` snapshot
 * (`wmkf_answervalue`), read by every consumer since Phase D. Affiliation is the
 * reviewer-identity field and stays a parent column (still read for the review-
 * context prefill). A picklist field has no parent column anymore; it is always
 * snapshot-only.
 */
export const reviewParentColumnByKey = Object.freeze({
  affiliation: 'wmkf_revieweraffiliation',
});

/**
 * The canonical core ratings, by `field.key`. These are NOT parent-bound (Phase
 * E retired the columns) but remain the required, non-deletable ratings of every
 * review: the submit producer asserts they are present + in-domain, and the admin
 * editor blocks their deletion. Kept independent of `reviewParentColumnByKey` so
 * the parent-column retirement didn't silently drop either guard.
 */
export const CORE_RATING_KEYS = Object.freeze(['riskLevel', 'overallAssessment']);

/**
 * Decode a picklist value into its label using a SUPPLIED field's own options
 * (set-aware; works for a question set loaded at runtime, not just the static
 * schema). Returns null when the value is absent or out of the field's domain.
 *
 * @param {{ options?: Array<{value:number,label:string}> }} field
 * @param {number|string|null|undefined} value
 * @returns {string|null}
 */
export function labelForOption(field, value) {
  if (!field || !Array.isArray(field.options)) return null;
  if (value === null || value === undefined || value === '') return null;
  const numeric = typeof value === 'string' ? parseInt(value, 10) : value;
  if (!Number.isFinite(numeric)) return null;
  const opt = field.options.find((o) => o.value === numeric);
  return opt ? opt.label : null;
}

const PICKLIST_FIELDS_BY_KEY = Object.fromEntries(
  reviewFormSchema.fields.filter((f) => f.type === 'picklist').map((f) => [f.key, f]),
);

/**
 * Decode a stored picklist value for a review rating into its human label.
 * Single source of truth for read-back display (the Reviews tab), mirroring the
 * options the form wrote. Returns null when the value is absent (never
 * submitted) or out of range, so callers can render "not provided" rather than
 * a raw number.
 *
 * @param {string} fieldKey - 'riskLevel' | 'overallAssessment'
 * @param {number|string|null|undefined} value - the stored picklist value
 * @returns {string|null}
 */
export function labelForReviewRating(fieldKey, value) {
  if (value === null || value === undefined || value === '') return null;
  const field = PICKLIST_FIELDS_BY_KEY[fieldKey];
  if (!field) return null;
  const numeric = typeof value === 'string' ? parseInt(value, 10) : value;
  if (!Number.isFinite(numeric)) return null;
  const opt = field.options.find((o) => o.value === numeric);
  return opt ? opt.label : null;
}

/**
 * Validate posted form data for the legacy staff paths (`review-upload.js`,
 * `mark-received-no-file.js`). Returns two normalized buckets or a list of
 * human-readable errors:
 *   - `dataverseValues` — parent-column scalars, keyed by Dataverse column
 *     (post-Phase-E this is affiliation only).
 *   - `ratings` — picklist rating values, keyed by `field.key`. These are
 *     snapshot-only now (no parent column); the caller feeds them to
 *     `buildRatingSnapshotRows` to write `wmkf_appreviewanswer` rows.
 *   - `multiselects` — canonical multiselect selections keyed by `field.key`.
 *
 * Rich-text answers (`type: 'richtext'`) are NOT validated here — they map to
 * snapshot child rows and are validated by the Phase 3 submit path. The legacy
 * upload paths carry only affiliation + ratings (narrative lives in the PDF).
 *
 * @param {Object} input - Raw form values keyed by `field.key`
 * @param {Object} [options]
 * @param {boolean} [options.partial=false] - When true, missing values do
 *   not fail validation regardless of `field.required` (the "mark-received-no-
 *   file" informal-feedback path). Type/range checks still run on present values.
 * @param {Array} [options.fields] - The question set to validate against
 *   (static schema by default; routes pass the Dataverse-loaded set). A string
 *   field's parent column resolves via `field.dataverseField ||
 *   reviewParentColumnByKey[field.key]`; picklists are validated regardless and
 *   routed to `ratings`.
 * @returns {{ ok: true, dataverseValues: Object, ratings: Object, multiselects: Object } | { ok: false, errors: string[] }}
 */
export function validateReviewForm(input, { partial = false, fields = reviewFormSchema.fields } = {}) {
  const errors = [];
  const dataverseValues = {};
  const ratings = {};
  const multiselects = {};

  if (!input || typeof input !== 'object') {
    if (partial) return { ok: true, dataverseValues, ratings, multiselects };
    return { ok: false, errors: ['Form data missing or invalid.'] };
  }

  for (const field of fields) {
    // Rich-text answers are snapshot-child content, validated by the submit path.
    if (field.type === 'richtext') continue;

    const raw = input[field.key];
    const isMissing = raw === undefined || raw === null || raw === '';

    if (field.type === 'string') {
      // A string field maps to a parent column (affiliation). No column → skip.
      const column = field.dataverseField || reviewParentColumnByKey[field.key];
      if (!column) continue;
      if (isMissing) {
        if (field.required && !partial) errors.push(`${field.label}: required.`);
        continue;
      }
      if (typeof raw !== 'string') {
        errors.push(`${field.label}: must be a string.`);
        continue;
      }
      const trimmed = raw.trim();
      if (field.required && trimmed.length === 0) {
        errors.push(`${field.label}: required.`);
        continue;
      }
      if (field.maxLength && trimmed.length > field.maxLength) {
        errors.push(`${field.label}: max ${field.maxLength} characters.`);
        continue;
      }
      dataverseValues[column] = trimmed;
    } else if (field.type === 'picklist') {
      // Ratings are snapshot-only post-Phase-E — validated here regardless of any
      // parent column and routed to `ratings`, NOT `dataverseValues`.
      if (isMissing) {
        if (field.required && !partial) errors.push(`${field.label}: required.`);
        continue;
      }
      // Strict whole-integer parse (mirrors validateReviewSubmission): "3abc" /
      // "3.5" are rejected, not silently truncated, so only clean values reach the
      // snapshot rows.
      let numeric;
      if (typeof raw === 'number') numeric = raw;
      else if (typeof raw === 'string' && /^-?\d+$/.test(raw.trim())) numeric = Number(raw.trim());
      else numeric = NaN;
      if (!Number.isInteger(numeric)) {
        errors.push(`${field.label}: must be a whole number.`);
        continue;
      }
      if (!field.options.some(o => o.value === numeric)) {
        errors.push(`${field.label}: invalid choice.`);
        continue;
      }
      ratings[field.key] = numeric;
    } else if (field.type === 'multiselect') {
      if ((raw === undefined || raw === null) && partial) continue;
      try {
        multiselects[field.key] = canonicalizeMultiselectSelection(
          { ...field, required: field.required && !partial },
          raw ?? [],
        );
      } catch (error) {
        errors.push(error.message);
      }
    } else {
      errors.push(`${field.label}: unsupported field type "${field.type}".`);
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, dataverseValues, ratings, multiselects };
}
