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
 *     (`ensureApplicantRecommended`). Existing `disposition=recommended` rows
 *     (J27+ intake writes them directly and leaves the slots empty) are then
 *     listed read-only, deduped against the recommendations already emitted.
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

import * as reviewerSuggestionAdapter from '../../dataverse/adapters/reviewer-suggestion';
import * as grantRequestAdapter from '../../dataverse/adapters/grant-request.js';
import { linkedCycleCode, linkedCycleExpand } from '../../dataverse/adapters/operations-grant-cycle.js';
import { extractExcludedReviewers } from '../reviewer-exclusion-parser';
import { ServiceHttpError } from '../service-http-error';
import { loadApplicantKnownReviewerContext } from './applicant-known-reviewer-service';
import { resolveReviewerBindCapability } from '../test-requests/synthetic-reviewer-capability.js';
import { reviewerEngagementProjection } from '../../../shared/utils/reviewer-engagement';

const REQUEST_SELECT = [
  'akoya_requestid',
  'akoya_requestnum',
  'akoya_title',
  'wmkf_excludedreviewers',
  '_wmkf_programareaserved_value',
  '_wmkf_potentialreviewer1_value',
  '_wmkf_potentialreviewer2_value',
  '_wmkf_potentialreviewer3_value',
  '_wmkf_potentialreviewer4_value',
  '_wmkf_potentialreviewer5_value',
].join(',');

const ZERO_GUID = '00000000-0000-0000-0000-000000000000';
const APPLICANT_LISTED_MAX_LENGTH = 300;
// Rows a reviewer has not acted on. Once a reviewer responds, the stage-2a
// accept form and the review form can overwrite the denormalized email and
// affiliation with the reviewer's own values, so they are no longer what the
// applicant listed.
const APPLICANT_LISTED_STAGES = new Set([null, 'selected', 'invited']);

function cleanListedValue(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, APPLICANT_LISTED_MAX_LENGTH) : null;
}

/**
 * The applicant's own entries for one suggested reviewer, copied by the
 * intake flow onto the suggestion row (`wmkf_revieweremail`,
 * `wmkf_revieweraffiliation`; docs/POWER_AUTOMATE_RESEARCH_INTAKE_FLOWS.md,
 * "Suggested reviewers"). Display only: it changes no status, selection or
 * evidence rule. `wmkf_notes` is deliberately excluded because staff lifecycle
 * updates also write it. Returns null when the row is engaged or carries
 * neither value (legacy slot rows created by the app have none).
 */
export function applicantListedFromSuggestionRow(row) {
  if (!row || typeof row !== 'object') return null;
  if (!APPLICANT_LISTED_STAGES.has(reviewerEngagementProjection(row).stage)) return null;
  const email = cleanListedValue(row.wmkf_revieweremail);
  const institution = cleanListedValue(row.wmkf_revieweraffiliation);
  if (!email && !institution) return null;
  return { email, institution };
}

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
  // Built outside the catch so a restriction refusal is not reported as a missing request.
  const expand = linkedCycleExpand();
  try {
    request = await grantRequestAdapter.getById(requestId, { select: REQUEST_SELECT, expand });
  } catch {
    request = null;
  }
  if (!request) {
    throw new ServiceHttpError(`No request found for ${requestId}`, { httpStatus: 404 });
  }

  const cycleCode = linkedCycleCode(request);
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
  // Build the deduped worklist synchronously (S210: seenPersonIds must be
  // complete before any await so two slots naming the same person can never
  // both dispatch), then materialize all slots CONCURRENTLY. Each call targets
  // a distinct (person,request) pair, so the parallel writes cannot collide
  // with each other; the adapter's alternate-key convergence still covers a
  // concurrent ingestion run. allSettled preserves the sequential loop's
  // per-slot error isolation, and iterating jobs in slot order below keeps the
  // response ordering identical (increment D, S399 — the sequential loop was
  // ~2s of the N=5 handler total).
  const slotJobs = [];
  for (const n of ['1', '2', '3', '4', '5']) {
    const personId = request[`_wmkf_potentialreviewer${n}_value`];
    if (!personId || personId === ZERO_GUID) continue;
    if (seenPersonIds.has(personId)) continue;
    seenPersonIds.add(personId);
    const name = request[`_wmkf_potentialreviewer${n}_value_formatted`] || null;
    slotJobs.push({ slot: Number(n), personId, name });
  }
  const slotOutcomes = await Promise.allSettled(slotJobs.map(async ({ personId, name }) => {
    // The server-read legacy slot may reference a deactivated ordinary person.
    // Preserve that recommendation for the inactive repair card, never a cast.
    await resolveReviewerBindCapability({ personId, requestId, allowInactiveOrdinary: true });
    return reviewerSuggestionAdapter.ensureApplicantRecommended({
      potentialReviewerId: personId,
      requestId,
      suggestionLabel: title ? `${title} — ${name || 'Applicant recommendation'}` : null,
      grantCycleCode: cycleCode,
      programArea,
      matchReason: 'Recommended by applicant.',
    }, { actingUserSystemId, allowInactiveOrdinary: true });
  }));
  slotJobs.forEach(({ slot, personId, name }, i) => {
    const outcome = slotOutcomes[i];
    if (outcome.status === 'fulfilled') {
      const result = outcome.value;
      recommended.push({
        slot,
        potentialReviewerId: personId,
        name,
        suggestionId: result.id,
        created: result.created,
        skippedExcluded: result.skippedExcluded || false,
        ...(result.engagement || {}),
      });
      if (result.created) recommendedCreated += 1;
    } else {
      const message = outcome.reason?.message ?? String(outcome.reason);
      console.error(`applicant-reviewers: failed to materialize slot ${slot} (${personId}):`, message);
      const failure = { slot, potentialReviewerId: personId, name, error: message };
      errors.push(failure);
      recommendedFailed.push(failure);
    }
  });
  // ── Recommended: existing applicant rows (J27+ intake) ─────────────────
  // J27 intake writes the applicant's suggested reviewers directly as
  // disposition=recommended junction rows and leaves the legacy slots empty
  // (docs/POWER_AUTOMATE_RESEARCH_INTAKE_FLOWS.md section 9 item 7). List them
  // READ-ONLY: no repair PATCH here, so a write failure can never hide a row
  // that already exists. Dedupe only against recommendations already emitted
  // successfully above, so a slot whose ensure-PATCH failed is still recovered
  // from its persisted row.
  let applicantRowsReadFailed = false;
  let applicantRows = [];
  try {
    applicantRows = await reviewerSuggestionAdapter.findApplicantRecommendedByRequest(requestId);
  } catch (err) {
    console.error('applicant-reviewers: applicant-recommended row read failed:', err.message);
    applicantRowsReadFailed = true;
    errors.push({ stage: 'applicant-rows', error: err.message });
  }
  const emittedPersonIds = new Set(recommended.map((r) => r.potentialReviewerId));
  const emittedSuggestionIds = new Set(recommended.map((r) => r.suggestionId).filter(Boolean));
  const rowsWithoutPerson = [];
  for (const row of Array.isArray(applicantRows) ? applicantRows : []) {
    const suggestionId = row.wmkf_appreviewersuggestionid || null;
    const personId = row._wmkf_potentialreviewer_value || null;
    if (suggestionId && emittedSuggestionIds.has(suggestionId)) continue;
    if (!personId || personId === ZERO_GUID) {
      rowsWithoutPerson.push({ slot: null, potentialReviewerId: null, suggestionId, code: 'person_unavailable' });
      continue;
    }
    if (emittedPersonIds.has(personId)) continue;
    emittedPersonIds.add(personId);
    if (suggestionId) emittedSuggestionIds.add(suggestionId);
    recommended.push({
      slot: null,
      potentialReviewerId: personId,
      name: row._wmkf_potentialreviewer_value_formatted || null,
      suggestionId,
      created: false,
      skippedExcluded: false,
      ...reviewerEngagementProjection(row),
    });
  }
  // The applicant's own listed details, joined by suggestion id onto every
  // recommendation (slot-materialized entries included; their rows are skipped
  // by the loop above but still read here).
  const applicantListedBySuggestion = new Map();
  for (const row of Array.isArray(applicantRows) ? applicantRows : []) {
    const listed = applicantListedFromSuggestionRow(row);
    if (row?.wmkf_appreviewersuggestionid && listed) {
      applicantListedBySuggestion.set(row.wmkf_appreviewersuggestionid, listed);
    }
  }
  for (const recommendation of recommended) {
    const listed = recommendation.suggestionId
      ? applicantListedBySuggestion.get(recommendation.suggestionId)
      : null;
    if (listed) recommendation.applicantListed = listed;
  }

  // A slot whose ensure call failed but whose row was recovered above is shown;
  // keep its failure in `errors` only, so the panel does not claim it is missing.
  const unrecoveredFailed = recommendedFailed.filter((f) => !emittedPersonIds.has(f.potentialReviewerId));

  // Count of distinct populated slots actually attempted — independent of
  // materialization success. The UI needs this to tell a genuine "applicant
  // listed no reviewers" (slotsPopulated === 0) apart from "the applicant DID
  // list reviewers but ingestion failed" (slotsPopulated > 0, recommended
  // empty). Without it the panel would render a FALSE empty state when every
  // slot write fails (Codex stop-time review, S210).
  const slotsPopulated = seenPersonIds.size;

  // Hydrate the exact linked person only AFTER suggestion materialization. A
  // person read failure must not recast a successful junction write as a
  // materialization failure or erase the applicant's recommendation.
  const knownLookupFailed = [];
  const hydratedRecommended = await Promise.all(recommended.map(async (recommendation) => {
    const context = await loadApplicantKnownReviewerContext(recommendation.potentialReviewerId, requestId);
    const { applicantKnownReviewer } = context;
    recommendation.applicantKnownReviewer = applicantKnownReviewer;
    if (context.factoryTestReviewer === true) recommendation.factoryTestReviewer = true;
    if (applicantKnownReviewer.status !== 'known') {
      knownLookupFailed.push({
        slot: recommendation.slot,
        potentialReviewerId: recommendation.potentialReviewerId,
        suggestionId: recommendation.suggestionId,
        code: applicantKnownReviewer.code || 'person_unavailable',
      });
    }
    return recommendation;
  }));
  knownLookupFailed.push(...rowsWithoutPerson);

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
    recommended: hydratedRecommended,
    recommendedCount: recommended.length,
    recommendedCreated,
    // How many distinct slots were populated vs. how many materialized — the
    // panel uses these to never report a false "applicant listed none."
    slotsPopulated,
    recommendedFailed: unrecoveredFailed.length > 0 ? unrecoveredFailed : undefined,
    // True only when every populated slot materialized. False ⇒ some/all
    // applicant recommendations failed to ingest; the panel must warn + offer
    // a retry instead of showing an empty state.
    recommendedComplete: unrecoveredFailed.length === 0 && !applicantRowsReadFailed,
    // True when the existing applicant-recommended rows could not be read; the
    // panel must offer a retry instead of an empty state.
    applicantRowsReadFailed,
    knownLookupComplete: knownLookupFailed.length === 0,
    knownLookupFailed: knownLookupFailed.length > 0 ? knownLookupFailed : undefined,
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
