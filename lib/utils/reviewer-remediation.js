/**
 * Total server-owned reviewer decision → remediation mapping.
 *
 * Callers may override the message with more specific server evidence, but
 * they must not invent action identifiers. Unknown codes fail closed and still
 * expose retry + durable repair, so a new backend reason cannot become a dead UI
 * badge while the client catches up.
 */

const ACTIONS = Object.freeze({
  verify_person_and_address: 'Verify person and address',
  replace_address: 'Use a different address',
  choose_identity: 'Choose the correct person',
  create_distinct_person: 'These are different people',
  resolve_address_conflict: 'Review both addresses',
  open_merge: 'Open reviewer merge',
  open_record_repair: 'Open record repair',
  correct_affiliation: 'Correct affiliation and recheck',
  view_evidence: 'View evidence',
  report_incorrect_evidence: 'Report incorrect evidence',
  retry_check: 'Retry check',
  create_repair_request: 'Create repair request',
  set_aside: 'Set reviewer aside',
});

const CONTRACT = Object.freeze({
  missing_email: ['verify_person_and_address', 'replace_address', 'set_aside'],
  missing_verified_email: ['verify_person_and_address', 'replace_address', 'set_aside'],
  research_only: ['verify_person_and_address', 'replace_address', 'set_aside'],
  quick_check: ['verify_person_and_address', 'replace_address', 'set_aside'],
  address_verification_required: ['verify_person_and_address', 'replace_address', 'set_aside'],
  identity_confirmation_required: ['verify_person_and_address', 'choose_identity', 'set_aside'],
  identity_verification_required: ['retry_check', 'verify_person_and_address', 'set_aside'],
  identity_attestation_required: ['retry_check', 'verify_person_and_address', 'set_aside'],
  provisional_orcid_match: ['verify_person_and_address', 'choose_identity', 'set_aside'],
  ambiguous_or_name_mismatch: ['choose_identity', 'create_distinct_person', 'set_aside'],
  email_mismatch: ['resolve_address_conflict', 'set_aside'],
  contact_claim_mismatch: ['resolve_address_conflict', 'set_aside'],
  address_conflict_pending: ['resolve_address_conflict', 'create_repair_request', 'set_aside'],
  orcid_email_split: ['choose_identity', 'verify_person_and_address', 'create_repair_request', 'set_aside'],
  contact_linked_elsewhere: ['verify_person_and_address', 'create_repair_request', 'set_aside'],
  email_conflict: ['create_repair_request', 'replace_address', 'set_aside'],
  ambiguous_email_owner: ['create_repair_request', 'replace_address', 'set_aside'],
  person_inactive: ['create_repair_request', 'set_aside'],
  inactive_email_owner: ['create_repair_request', 'replace_address', 'set_aside'],
  conflict_record_unavailable: ['retry_check', 'create_repair_request', 'set_aside'],
  identity_unavailable: ['retry_check', 'create_repair_request', 'set_aside'],
  eligibility_unavailable: ['retry_check', 'create_repair_request', 'set_aside'],
  contact_verification_unavailable: ['retry_check', 'create_repair_request', 'set_aside'],
  candidate_stale: ['retry_check', 'create_repair_request'],
  lease_repair_required: ['create_repair_request'],
  invalid_address_attestation: ['verify_person_and_address', 'create_repair_request', 'set_aside'],
  address_trust_action_failed: ['retry_check', 'create_repair_request', 'set_aside'],
  anti_scrape_email: ['replace_address', 'set_aside'],
  contact_write_failed: ['retry_check', 'create_repair_request', 'set_aside'],
  candidate_save_failed: ['retry_check', 'create_repair_request', 'set_aside'],
  applicant_hydration_required: ['retry_check', 'create_repair_request', 'set_aside'],
  applicant_excluded: ['report_incorrect_evidence', 'set_aside'],
  institution_coi: ['correct_affiliation', 'report_incorrect_evidence', 'set_aside'],
  candidate_ineligible: ['view_evidence', 'report_incorrect_evidence', 'set_aside'],
  deceased: ['view_evidence', 'report_incorrect_evidence', 'set_aside'],
});

function remediationFor(code, { allowedActions = null } = {}) {
  const normalizedCode = typeof code === 'string' && code.trim() ? code.trim() : 'unknown';
  const configured = CONTRACT[normalizedCode] || ['retry_check', 'create_repair_request'];
  const allowed = allowedActions instanceof Set ? allowedActions : null;
  const usable = configured.filter((action) => !allowed || allowed.has(action));
  const fallback = usable.length > 0
    ? usable
    : ['create_repair_request'].filter((action) => !allowed || allowed.has(action));
  return {
    code: normalizedCode,
    remediation: fallback.map((action) => ({ action, label: ACTIONS[action] })),
    unknown: !Object.prototype.hasOwnProperty.call(CONTRACT, normalizedCode),
  };
}

function withRemediation(decision, options) {
  const base = decision && typeof decision === 'object' ? decision : {};
  const mapped = remediationFor(base.code, options);
  return {
    ...base,
    code: mapped.code,
    remediation: Array.isArray(base.remediation) && base.remediation.length > 0
      ? base.remediation
      : mapped.remediation,
  };
}

module.exports = {
  ACTIONS,
  REMEDIATION_CONTRACT: CONTRACT,
  remediationFor,
  withRemediation,
};
