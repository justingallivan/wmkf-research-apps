/**
 * Request (proposal) institution for display and body-input contracts.
 *
 * Reads only the formatted Applicant account lookup. The request's
 * `wmkf_organizationname` text field is a Bill.com integration field, not a
 * proposal-institution field (it holds placeholders such as "N/A"), so it is
 * excluded here on purpose. Reviewer-affiliation readers use a different
 * field on wmkf_potentialreviewers and are not covered by this helper.
 */
export function requestInstitution(request) {
  return String(request?._akoya_applicantid_value_formatted || '').trim() || null;
}
