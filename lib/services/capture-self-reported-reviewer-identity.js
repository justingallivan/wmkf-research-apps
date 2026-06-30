/**
 * Capture a reviewer's SELF-REPORTED board-writeup identity (academic rank,
 * primary department, main institution) onto the person record at Stage 2a accept.
 *
 * The reviewer confirms/enters these on the authenticated magic-link accept form
 * (`Stage2aView` → `respond.js`). Like the ORCID self-report twin
 * (`capture-self-reported-orcid.js`), this is the highest-trust source we have —
 * the person themselves attested it — so it writes to the dedicated person columns
 * (`wmkf_academicrank` / `wmkf_primarydepartment` / `wmkf_maininstitution`), which
 * are kept DISTINCT from the enrichment-sourced affiliation/department guesses.
 *
 * Storage is person-level (one canonical current value, surfaced + editable in the
 * workbench, read by board write-ups), NOT a per-request snapshot — the write-up is
 * the moment-in-time artifact (S308 owner decision).
 *
 * Caller treats any throw as NON-FATAL — the accept already committed. UNLIKE the
 * ORCID twin, these fields have NO suggestion-row fallback, so the caller MUST alert
 * on failure (NotificationService) and the workbench edit ships alongside so staff
 * can repair. The route validates presence BEFORE accept, so a value is always
 * provided by the time this runs.
 */

import * as potentialReviewerAdapter from '../dataverse/adapters/potential-reviewer.js';

/**
 * @param {object}  args
 * @param {string} [args.potentialReviewerId] - the person row id
 * @param {string} [args.academicRank]
 * @param {string} [args.primaryDepartment]
 * @param {string} [args.mainInstitution]
 * @param {string} [args.actingUserSystemId]
 * @param {object} [deps] - { reviewers } for tests
 * @returns {Promise<{skipped:string}|{persisted:true, fields:string[]}>}
 */
export async function captureSelfReportedReviewerIdentity(
  { potentialReviewerId, academicRank, primaryDepartment, mainInstitution, actingUserSystemId } = {},
  deps = {},
) {
  const { reviewers = potentialReviewerAdapter } = deps;

  if (!potentialReviewerId) return { skipped: 'no_person' };

  // Only write fields that were actually supplied (trimmed, non-empty). The accept
  // route already required + trimmed these; this is the defensive last gate.
  const updates = {};
  const consider = { academicRank, primaryDepartment, mainInstitution };
  for (const [key, value] of Object.entries(consider)) {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    if (trimmed) updates[key] = trimmed;
  }
  if (Object.keys(updates).length === 0) return { skipped: 'nothing_to_write' };

  await reviewers.update(potentialReviewerId, updates, { actingUserSystemId });
  return { persisted: true, fields: Object.keys(updates) };
}
