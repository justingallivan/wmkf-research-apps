/**
 * Workbench — applicant-reviewer ingestion service
 * (Route→Service Consolidation Plan, Stage 4 wave — first workbench service).
 *
 * Holds ALL business logic for GET /api/workbench/applicant-reviewers; the
 * route is a thin shell (method dispatch, auth, GUID validation, DAL context,
 * HTTP mapping).
 *
 * Idempotently materializes the applicant-supplied reviewer inputs for one
 * request into the Reviewer Finder model (Request Workbench Phase 3, run lazily
 * when a PD opens the Find tab):
 *
 *   - RECOMMENDED — the legacy `wmkf_potentialreviewer1..5` lookup slots
 *     (person GUIDs already exist) become `disposition=recommended`,
 *     `selected=false` `wmkf_appreviewersuggestion` junction rows, `applicant`
 *     unioned into their sources. They appear in Find for PD review and enter
 *     the candidate pool only through explicit promotion. Race-safe + idempotent
 *     (`ensureApplicantRecommended`).
 *
 *   - EXCLUDED — the free-text `wmkf_excludedreviewers` is parsed into clean
 *     names (hardened Claude extraction) and returned for the search soft-block
 *     ONLY. Per the S210 option-B decision, NO structured `disposition=excluded`
 *     junction rows are written this round and NOTHING global is touched, so an
 *     applicant's per-request exclusion never affects the person's eligibility
 *     on any other request. See `docs/REQUEST_WORKBENCH_BUILD_PLAN.md` §Phase 3
 *     and `[[project-excluded-reviewers-often-in-pool]]`.
 *
 * Contract (plan Decision 3):
 *   - takes a plain argument object, never req/res;
 *   - returns the plain 200 response body;
 *   - throws ServiceHttpError 404 when the request GUID does not resolve
 *     (default `{ error: message }` envelope — this route speaks `{ error }`);
 *   - ASSUMES a trusted DAL context already exists — never establishes one.
 */

import { meetingDateToCycleCode } from '../../utils/cycle-code';
import * as reviewerSuggestionAdapter from '../../dataverse/adapters/reviewer-suggestion';
import * as grantRequestAdapter from '../../dataverse/adapters/grant-request.js';
import { extractExcludedReviewers } from '../reviewer-exclusion-parser';
import { ServiceHttpError } from '../service-http-error';

const REQUEST_SELECT = [
  'akoya_requestid',
  'akoya_requestnum',
  'akoya_title',
  'wmkf_meetingdate',
  'wmkf_excludedreviewers',
  '_wmkf_programareaserved_value',
  '_wmkf_potentialreviewer1_value',
  '_wmkf_potentialreviewer2_value',
  '_wmkf_potentialreviewer3_value',
  '_wmkf_potentialreviewer4_value',
  '_wmkf_potentialreviewer5_value',
].join(',');

const ZERO_GUID = '00000000-0000-0000-0000-000000000000';

/**
 * Materialize the applicant-recommended slots + parse the excluded free text.
 *
 * @param {Object} args
 * @param {string} args.requestId - GUID (already validated by the shell)
 * @param {string|null} args.actingUserSystemId
 * @param {string|number|null} args.userProfileId
 * @returns {Promise<Object>} the 200 response body
 * @throws {ServiceHttpError} 404 when the request does not resolve; other
 *   errors propagate untyped for the shell's 500 mapping
 */
export async function ingestApplicantReviewers({ requestId, actingUserSystemId, userProfileId }) {
  // Model-override warming happens at the ROUTE level: the shell awaits
  // loadModelOverrides() before calling this service (the
  // check:model-override-warming contract, and the once-only historical
  // behavior pinned by the endpoint test). Do not warm again here.

  let request;
  try {
    request = await grantRequestAdapter.getById(requestId, { select: REQUEST_SELECT });
  } catch {
    request = null;
  }
  if (!request) {
    throw new ServiceHttpError(`No request found for ${requestId}`, { httpStatus: 404 });
  }

  const cycleCode = request.wmkf_meetingdate ? meetingDateToCycleCode(request.wmkf_meetingdate) : null;
  const programArea = request._wmkf_programareaserved_value_formatted || null;
  const title = request.akoya_title || null;

  // ── Recommended: materialize the 5 legacy slots ────────────────────────
  const recommended = [];
  const errors = [];
  let recommendedCreated = 0;
  // Dedupe by person across slots: the same reviewer can appear in two slots.
  // The adapter's alternate key already prevents a duplicate Dataverse row,
  // but we must not emit a duplicate response entry (inflated count + a
  // duplicate React key in the panel) — Codex post-impl review, S210.
  const seenPersonIds = new Set();
  const recommendedFailed = [];
  for (const n of ['1', '2', '3', '4', '5']) {
    const personId = request[`_wmkf_potentialreviewer${n}_value`];
    if (!personId || personId === ZERO_GUID) continue;
    if (seenPersonIds.has(personId)) continue;
    seenPersonIds.add(personId);
    const name = request[`_wmkf_potentialreviewer${n}_value_formatted`] || null;
    try {
      const result = await reviewerSuggestionAdapter.ensureApplicantRecommended({
        potentialReviewerId: personId,
        requestId,
        suggestionLabel: title ? `${title} — ${name || 'Applicant recommendation'}` : null,
        grantCycleCode: cycleCode,
        programArea,
        matchReason: 'Recommended by applicant (legacy reviewer slot).',
      }, { actingUserSystemId });
      recommended.push({
        slot: Number(n),
        potentialReviewerId: personId,
        name,
        suggestionId: result.id,
        created: result.created,
        skippedExcluded: result.skippedExcluded || false,
      });
      if (result.created) recommendedCreated += 1;
    } catch (err) {
      console.error(`applicant-reviewers: failed to materialize slot ${n} (${personId}):`, err.message);
      const failure = { slot: Number(n), potentialReviewerId: personId, name, error: err.message };
      errors.push(failure);
      recommendedFailed.push(failure);
    }
  }
  // Count of distinct populated slots actually attempted — independent of
  // materialization success. The UI needs this to tell a genuine "applicant
  // listed no reviewers" (slotsPopulated === 0) apart from "the applicant DID
  // list reviewers but ingestion failed" (slotsPopulated > 0, recommended
  // empty). Without it the panel would render a FALSE empty state when every
  // slot write fails (Codex stop-time review, S210).
  const slotsPopulated = seenPersonIds.size;

  // ── Excluded: parse free-text → names for the soft-block (no rows) ──────
  let excluded = [];
  let excludedSubstantive = false;
  let excludedParseFailed = false;
  try {
    const parsed = await extractExcludedReviewers(request.wmkf_excludedreviewers, { userProfileId });
    excluded = parsed.names;
    excludedSubstantive = parsed.substantive;
    excludedParseFailed = parsed.parseFailed;
  } catch (err) {
    // Exclusion parsing must never block recommended ingestion. Surface the
    // raw text so staff can still eyeball it; flag the failure.
    console.error('applicant-reviewers: excluded-reviewer extraction failed:', err.message);
    excludedParseFailed = true;
    errors.push({ stage: 'excluded-extraction', error: err.message });
  }

  return {
    success: true,
    requestId,
    requestNumber: request.akoya_requestnum || null,
    cycleCode,
    recommended,
    recommendedCount: recommended.length,
    recommendedCreated,
    // How many distinct slots were populated vs. how many materialized — the
    // panel uses these to never report a false "applicant listed none."
    slotsPopulated,
    recommendedFailed: recommendedFailed.length > 0 ? recommendedFailed : undefined,
    // True only when every populated slot materialized. False ⇒ some/all
    // applicant recommendations failed to ingest; the panel must warn + offer
    // a retry instead of showing an empty state.
    recommendedComplete: recommendedFailed.length === 0,
    // Soft-block input + staff-visible list. Structured excluded rows are
    // intentionally NOT written (option B); the raw text is echoed so staff
    // can see exactly what the applicant typed.
    excluded,
    excludedNames: excluded.map((e) => e.name),
    excludedRaw: request.wmkf_excludedreviewers || null,
    excludedSubstantive,
    excludedParseFailed,
    errors: errors.length > 0 ? errors : undefined,
  };
}
