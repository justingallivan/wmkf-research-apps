/**
 * DynamicsService decomposition — Stage 0 leaf module.
 *
 * Pure constants extracted verbatim from lib/services/dynamics-service.js
 * (:18-49, :63-67). No imports; no mutable state (tokenCache/schemaCache
 * stay in the facade per Q3/C4 until their owner-module stages land).
 */

// Hardcoded entity set mapping for known tables — avoids the expensive
// EntityDefinitions API call for every first query in a session.
export const KNOWN_ENTITY_SETS = {
  akoya_request: 'akoya_requests',
  akoya_concept: 'akoya_concepts',
  akoya_requestpayment: 'akoya_requestpayments',
  contact: 'contacts',
  account: 'accounts',
  email: 'emails',
  annotation: 'annotations',
  akoya_program: 'akoya_programs',
  akoya_phase: 'akoya_phases',
  akoya_goapplystatustracking: 'akoya_goapplystatustrackings',
  activitypointer: 'activitypointers',
  wmkf_potentialreviewers: 'wmkf_potentialreviewerses',
  wmkf_donors: 'wmkf_donorses',
  wmkf_bbstatus: 'wmkf_bbstatuses',
  wmkf_grantprogram: 'wmkf_grantprograms',
  wmkf_type: 'wmkf_types',
  wmkf_supporttype: 'wmkf_supporttypes',
  wmkf_programlevel2: 'wmkf_programlevel2s',
  wmkf_granteedeliverable: 'wmkf_granteedeliverables',
  systemuser: 'systemusers',
  sharepointdocumentlocation: 'sharepointdocumentlocations',
};

// Reverse map: entity set name → logical name
export const ENTITY_SET_TO_LOGICAL = {};
for (const [logical, entitySet] of Object.entries(KNOWN_ENTITY_SETS)) {
  ENTITY_SET_TO_LOGICAL[entitySet] = logical;
}

// Reverse map: entity set name → itself (so passing "accounts" also works)
export const KNOWN_ENTITY_SET_VALUES = new Set(Object.values(KNOWN_ENTITY_SETS));

export const TABLE_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
export const FIELD_CACHE_TTL = 6 * 60 * 60 * 1000;  // 6 hours
export const API_TIMEOUT = 30_000; // 30 seconds
export const MAX_EXPORT_RECORDS = 5000;
export const EXPORT_PAGE_SIZE = 500;
