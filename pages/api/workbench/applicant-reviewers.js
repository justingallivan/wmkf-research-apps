/**
 * API: /api/workbench/applicant-reviewers
 *
 * GET ?requestId=<akoya_request GUID>
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
 * Read-mostly + per-request scoped; org-open like the other reviewer surfaces.
 */

import { requireAppAccess } from '../../../lib/utils/auth';
import { bypassDynamicsRestrictions } from '../../../lib/services/dynamics-context';
import { meetingDateToCycleCode } from '../../../lib/utils/cycle-code';
import * as reviewerSuggestionAdapter from '../../../lib/dataverse/adapters/reviewer-suggestion';
import * as grantRequestAdapter from '../../../lib/dataverse/adapters/grant-request.js';
import { extractExcludedReviewers } from '../../../lib/services/reviewer-exclusion-parser';
import { loadModelOverrides } from '../../../lib/services/model-override-loader';

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
const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const access = await requireAppAccess(req, res, 'reviewers');
  if (!access) return;

  const requestId = req.query.requestId ? String(req.query.requestId).trim() : '';
  if (!requestId) {
    return res.status(400).json({ error: 'requestId is required (akoya_request GUID)' });
  }
  // GUID-validate before use: requestId flows UNQUOTED into the OData filter
  // `_wmkf_request_value eq ${requestId}` (findByPotentialReviewerAndRequest), so
  // a non-GUID value would be an injection vector as well as a fail-late 404
  // (Codex post-impl review, S210).
  if (!GUID_RE.test(requestId)) {
    return res.status(400).json({ error: 'requestId must be a GUID' });
  }

  // Warm the model-override cache BEFORE the excluded-reviewer Claude extraction:
  // getModelForApp('reviewer-exclusion') resolves tier keys (e.g. 'haiku') to real
  // model ids only once overrides are loaded, otherwise Anthropic 404s on the raw
  // tier key and the extraction fails (mirrors the other reviewer LLM routes —
  // analyze/discover/enrich-contacts/generate-emails).
  await loadModelOverrides();

  const actingUserSystemId = access.session?.user?.dynamicsSystemuserId || null;
  const userProfileId = access.profileId || null;

  return bypassDynamicsRestrictions('workbench-applicant-reviewers', async () => {
    try {
      let request;
      try {
        request = await grantRequestAdapter.getById(requestId, { select: REQUEST_SELECT });
      } catch {
        request = null;
      }
      if (!request) {
        return res.status(404).json({ error: `No request found for ${requestId}` });
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

      return res.status(200).json({
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
      });
    } catch (err) {
      console.error('applicant-reviewers error:', err);
      return res.status(500).json({
        error: 'Failed to ingest applicant reviewers',
        details: process.env.NODE_ENV === 'development' ? err.message : undefined,
      });
    }
  });
}
