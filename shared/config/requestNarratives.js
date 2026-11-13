/** Existing Request storage and API names stay stable; Executive Summary is the staff-facing name. */
export const REQUEST_NARRATIVE_MAX_LENGTH = 100000;
export const EXECUTIVE_SUMMARY_FIELD = 'wmkf_layabstract';
export const REQUEST_NARRATIVE_DEFINITIONS = Object.freeze({
  lay_abstract: Object.freeze({ label: 'Executive Summary', column: EXECUTIVE_SUMMARY_FIELD }),
  initial_assessment: Object.freeze({ label: 'Initial Assessment', column: 'wmkf_initialassessment' }),
});
// This integration exposes only Executive Summary. Initial Assessment remains
// defined for the original narrative branch, but is not selected or writable here.
export const REQUEST_NARRATIVE_FIELDS = Object.freeze({
  lay_abstract: REQUEST_NARRATIVE_DEFINITIONS.lay_abstract,
});
