/**
 * Research suite program scope, keyed by the canonical akoya_programid lookup.
 * Program names and the legacy wmkf_grantprogram lookup are not identity keys.
 * Status/PI eligibility belongs to each workflow, not this shared program set.
 */
export const RESEARCH_PROGRAM_IDS = Object.freeze([
  '8dcab30b-958f-ee11-8179-000d3a341e8f', // Science and Engineering Research
  '94cab30b-958f-ee11-8179-000d3a341e8f', // Medical Research
]);
