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
 *   - `picklist` — single-select rating (Q1/Q3/Q10), maps to a parent column.
 *   - `richtext` — narrative answer authored in-browser (Q2/Q4–Q9/Q11). Stored
 *     as server-sanitized HTML in the snapshot child table, NOT on a parent
 *     column (no `dataverseField`). Q2/Q4–Q9/Q11 previously lived only in the
 *     uploaded review PDF; they now move into the page.
 *
 * `order` is the question's display/snapshot position (1–11); affiliation is the
 * "Title & Organization" identity field, not one of the 11 questions, so it has
 * no `order` and is never written to the snapshot. The snapshot questions are
 * exactly the picklist + richtext fields.
 */

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
      key: 'impact',
      dataverseField: 'wmkf_reviewerimpact',
      order: 1,
      label: 'Q1 — If the proposed project is successful in its entirety, how will it impact the field?',
      type: 'picklist',
      required: true,
      options: [
        { value: 1, label: 'Little to no impact' },
        { value: 2, label: 'Will result in publications of disciplinary interest' },
        { value: 3, label: 'Will result in publications of broad interest' },
        { value: 4, label: 'Will rewrite textbooks' },
      ],
    },
    {
      key: 'q2',
      order: 2,
      label: 'Q2 — What specific significant impacts do you foresee?',
      type: 'richtext',
      required: true,
      maxLength: 50000,
    },
    {
      key: 'risk',
      dataverseField: 'wmkf_reviewerrisk',
      order: 3,
      label: 'Q3 — How risky is the project overall?',
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
      key: 'q4',
      order: 4,
      label: 'Q4 — What are the risks associated with the project? Are the risks technical (such as the ability to make a molecule, build an instrument, or make a measurement)? Are the risks related to a hypothesis (i.e., the idea could be wrong)? Is the team trying to do too much?',
      type: 'richtext',
      required: true,
      maxLength: 50000,
    },
    {
      key: 'q5',
      order: 5,
      label: 'Q5 — Are the methods, data gathering, and/or analysis appropriate for the project to be successful?',
      type: 'richtext',
      required: true,
      maxLength: 50000,
    },
    {
      key: 'q6',
      order: 6,
      label: 'Q6 — Are there questions or issues that the Foundation should raise with the PI before making an award?',
      type: 'richtext',
      required: true,
      maxLength: 50000,
    },
    {
      key: 'q7',
      order: 7,
      label: 'Q7 — Do you believe the team has the necessary personnel and infrastructure to perform the work?',
      type: 'richtext',
      required: true,
      maxLength: 50000,
    },
    {
      key: 'q8',
      order: 8,
      label: 'Q8 — The Foundation strives to support projects that would not likely be funded elsewhere. Do you think this project in its current form could likely be supported by a traditional funding agency?',
      type: 'richtext',
      required: true,
      maxLength: 50000,
    },
    {
      key: 'q9',
      order: 9,
      label: 'Q9 — Are there any issues with the budget?',
      type: 'richtext',
      required: true,
      maxLength: 50000,
    },
    {
      key: 'overallRating',
      dataverseField: 'wmkf_revieweroverallrating',
      order: 10,
      label: 'Q10 — Please assign an overall rating to the proposal.',
      type: 'picklist',
      required: true,
      options: [
        { value: 1, label: 'Poor' },
        { value: 2, label: 'Fair' },
        { value: 3, label: 'Good' },
        { value: 4, label: 'Very Good' },
        { value: 5, label: 'Excellent' },
      ],
    },
    {
      key: 'q11',
      order: 11,
      label: "Q11 — Is there anything else you'd like to share with the Foundation about the proposal or this review process?",
      type: 'richtext',
      required: false,
      maxLength: 50000,
    },
  ],
};

// Short, column-friendly labels for the three structured ratings (the schema
// `label` fields hold the full question text). Keyed by `field.key`.
export const reviewRatingShortLabels = {
  impact: 'Impact',
  risk: 'Risk',
  overallRating: 'Overall',
};

/**
 * The parent-column dual-write binding (the former `dataverseField` per field),
 * kept in CODE rather than in the staff-editable `wmkf_reviewquestion` entity:
 * these columns on `wmkf_appreviewersuggestion` are a deliberate denormalization
 * that retires in the staff-editable epic's Phase E. Only these canonical keys
 * map to a parent column; any future staff-added rating is snapshot-only.
 *
 * Keyed by `field.key`. Used by the submit producer so a question set loaded
 * from Dataverse (which carries no `dataverseField`) still dual-writes the
 * canonical affiliation + 3 ratings exactly as the static schema did.
 *
 * INVARIANT: every key here that is a picklist is a "parent-bound rating" the
 * submit producer asserts present + equal across parent and child snapshot.
 */
export const reviewParentColumnByKey = Object.freeze({
  affiliation: 'wmkf_revieweraffiliation',
  impact: 'wmkf_reviewerimpact',
  risk: 'wmkf_reviewerrisk',
  overallRating: 'wmkf_revieweroverallrating',
});

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
 * @param {string} fieldKey - 'impact' | 'risk' | 'overallRating'
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
 * Validate posted form data against the schema. Returns either a normalized
 * object (keys = Dataverse field names, values = picklist ints / trimmed
 * strings) or a list of human-readable errors.
 *
 * SCOPE: this validates the PARENT-mapped fields only — affiliation + the three
 * ratings (each has a `dataverseField`). It is the contract for the legacy
 * file-upload path (`review-upload.js`, `mark-received-no-file.js`), which
 * PATCHes those columns. Rich-text answers (`type: 'richtext'`, no
 * `dataverseField`) are NOT validated here — they map to `wmkf_appreviewanswer`
 * snapshot child rows and are validated by the Phase 3 submit path
 * (emptiness-after-strip + maxLength + the parent/child rating invariant). They
 * are skipped so adding the new questions can't break the live upload path.
 *
 * @param {Object} input - Raw form values keyed by `field.key`
 * @param {Object} [options]
 * @param {boolean} [options.partial=false] - When true, missing values do
 *   not fail validation regardless of `field.required`. Used by the staff
 *   "mark-received-no-file" path, where structured data is optional (a
 *   reviewer's informal feedback that shouldn't be averaged into scores).
 *   Type and range checks still run on whatever values are present.
 * @param {Array} [options.fields] - The question set to validate against.
 *   Defaults to the static `reviewFormSchema.fields`; the routes pass the
 *   Dataverse-loaded set (`ReviewQuestionFetcher`). A runtime field carries no
 *   `dataverseField`, so the parent column is resolved via
 *   `reviewParentColumnByKey[field.key]`; a field with no parent column (a
 *   future snapshot-only rating) is skipped by this parent-path validator.
 * @returns {{ ok: true, dataverseValues: Object } | { ok: false, errors: string[] }}
 */
export function validateReviewForm(input, { partial = false, fields = reviewFormSchema.fields } = {}) {
  const errors = [];
  const dataverseValues = {};

  if (!input || typeof input !== 'object') {
    if (partial) return { ok: true, dataverseValues };
    return { ok: false, errors: ['Form data missing or invalid.'] };
  }

  for (const field of fields) {
    // Rich-text answers are snapshot-child content, not parent columns —
    // validated by the Phase 3 submit path, never by this parent-field validator.
    if (field.type === 'richtext') continue;

    // Resolve the parent column: static fields carry `dataverseField`; a
    // runtime field resolves via the code-side binding map. No column → this
    // field has no parent representation, so the legacy parent path skips it.
    const column = field.dataverseField || reviewParentColumnByKey[field.key];
    if (!column) continue;

    const raw = input[field.key];
    const isMissing = raw === undefined || raw === null || raw === '';

    if (isMissing) {
      if (field.required && !partial) {
        errors.push(`${field.label}: required.`);
      }
      continue;
    }

    if (field.type === 'string') {
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
      const numeric = typeof raw === 'string' ? parseInt(raw, 10) : raw;
      if (!Number.isFinite(numeric)) {
        errors.push(`${field.label}: must be a number.`);
        continue;
      }
      if (!field.options.some(o => o.value === numeric)) {
        errors.push(`${field.label}: invalid choice.`);
        continue;
      }
      dataverseValues[column] = numeric;
    } else {
      errors.push(`${field.label}: unsupported field type "${field.type}".`);
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, dataverseValues };
}
