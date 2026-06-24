/**
 * Reviewer-form schema. Single source of truth for what structured fields
 * the external review-upload form collects, how they validate, and how they
 * map to Dataverse columns on `wmkf_appreviewersuggestion`.
 *
 * Used by:
 *   - the public landing page (renders the form fields by walking this config)
 *   - the external upload endpoint (validates posted values before SharePoint+Dataverse writes)
 *   - the staff upload endpoint (renders the same form when uploading on behalf)
 *
 * The PDF review template has 11 questions, of which only Q1, Q3, and Q10
 * are single-select multiple-choice. Reviewers regularly violate those
 * constraints in the PDF (forget to check, choose two). Capturing them here
 * with HTML radio inputs + server-side validation removes that failure mode.
 *
 * Free-text questions (Q2, Q4-Q9, Q11) live in the uploaded PDF — no value
 * in re-typing paragraphs of substantive analysis into a browser form.
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
      label: 'Q1 — If the proposed project is successful in its entirety, how will it impact the field?',
      type: 'picklist',
      required: true,
      options: [
        { value: 1, label: 'Little to no impact' },
        { value: 2, label: 'Will result in publications of disciplinary interest' },
        { value: 3, label: 'Will result in publications of broad interest' },
        { value: 4, label: 'Will rewrite textbooks' },
        { value: 99, label: 'Unable to answer' },
      ],
    },
    {
      key: 'risk',
      dataverseField: 'wmkf_reviewerrisk',
      label: 'Q3 — How risky is the project overall?',
      hint: 'The Keck Foundation is comfortable funding risky projects.',
      type: 'picklist',
      required: true,
      options: [
        { value: 1, label: 'Low risk (will likely work in its entirety)' },
        { value: 2, label: 'Medium risk (parts may succeed, others may fail)' },
        { value: 3, label: 'High risk (significant risk of failure)' },
        { value: 4, label: 'Impossible (fatal flaw)' },
        { value: 99, label: 'Unable to answer' },
      ],
    },
    {
      key: 'overallRating',
      dataverseField: 'wmkf_revieweroverallrating',
      label: 'Q10 — Please assign an overall rating to the proposal.',
      type: 'picklist',
      required: true,
      options: [
        { value: 1, label: 'Poor' },
        { value: 2, label: 'Fair' },
        { value: 3, label: 'Good' },
        { value: 4, label: 'Very Good' },
        { value: 5, label: 'Excellent' },
        { value: 99, label: 'Unable to answer' },
      ],
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

const PICKLIST_FIELDS_BY_KEY = Object.fromEntries(
  reviewFormSchema.fields.filter((f) => f.type === 'picklist').map((f) => [f.key, f]),
);

/**
 * Decode a stored picklist value for a review rating into its human label.
 * Single source of truth for read-back display (the Reviews tab), mirroring the
 * options the form wrote. Returns null when the value is absent (never
 * submitted) so callers can distinguish "not provided" from a real
 * "Unable to answer" (value 99, which decodes to its own label).
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
 * @param {Object} input - Raw form values keyed by `field.key`
 * @param {Object} [options]
 * @param {boolean} [options.partial=false] - When true, missing values do
 *   not fail validation regardless of `field.required`. Used by the staff
 *   "mark-received-no-file" path, where structured data is optional (a
 *   reviewer's informal feedback that shouldn't be averaged into scores).
 *   Type and range checks still run on whatever values are present.
 * @returns {{ ok: true, dataverseValues: Object } | { ok: false, errors: string[] }}
 */
export function validateReviewForm(input, { partial = false } = {}) {
  const errors = [];
  const dataverseValues = {};

  if (!input || typeof input !== 'object') {
    if (partial) return { ok: true, dataverseValues };
    return { ok: false, errors: ['Form data missing or invalid.'] };
  }

  for (const field of reviewFormSchema.fields) {
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
      dataverseValues[field.dataverseField] = trimmed;
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
      dataverseValues[field.dataverseField] = numeric;
    } else {
      errors.push(`${field.label}: unsupported field type "${field.type}".`);
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, dataverseValues };
}
