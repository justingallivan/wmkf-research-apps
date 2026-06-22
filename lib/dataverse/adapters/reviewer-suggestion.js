/**
 * Adapter: wmkf_appreviewersuggestion (lifecycle ledger).
 *
 * One row per (potential reviewer, request). Holds relevance score, match
 * reason, sources, picklists, and the full outreach lifecycle timestamps
 * (invited, accepted, declined, materials sent, reminders, review received,
 * thank-you). Alt-key on (potentialreviewer, request).
 */

import { DynamicsService } from '../../services/dynamics-service.js';
import { isGuid } from '../../utils/guid.js';

const ENTITY_SET = 'wmkf_appreviewersuggestions';

const FIELD_SELECT = [
  'wmkf_appreviewersuggestionid',
  'wmkf_suggestionlabel',
  'wmkf_grantcyclecode',
  'wmkf_programarea',
  'wmkf_relevancescore',
  'wmkf_matchreason',
  'wmkf_sources',
  'wmkf_selected',
  'wmkf_invited',
  'wmkf_accepted',
  'wmkf_declined',
  'wmkf_emailsentat',
  'wmkf_responsereceivedat',
  'wmkf_materialssentat',
  'wmkf_remindersentat',
  'wmkf_remindercount',
  // Reviewer-engagement Phase 3: fire-once marker for the respond-by reminder,
  // SEPARATE from wmkf_remindersentat (the review-due/follow-up marker). Cleared on
  // Re-invite so a fresh offer window can remind again.
  'wmkf_respondremindersentat',
  'wmkf_reviewreceivedat',
  'wmkf_thankyousentat',
  'wmkf_reviewfilename',
  'wmkf_notes',
  'wmkf_reviewstatus',
  'wmkf_responsetype',
  // Hold step: timestamp the reviewer placed a hold (agreed in principle).
  'wmkf_heldat',
  // External-reviewer intake (Phase 1+ schema additions). Surfaced so the
  // Review Manager UI can show token state and link to the magic-link
  // lifecycle actions without a second round trip.
  'wmkf_externaltokenhash',
  'wmkf_externaltokenissued',
  'wmkf_externaltokenexpires',
  'wmkf_externaltokenrevoked',
  'wmkf_proposalfirstaccessed',
  'wmkf_reviewsharepointfolder',
  'wmkf_reviewuploadedbystaff',
  'wmkf_revieweraffiliation',
  'wmkf_reviewerimpact',
  'wmkf_reviewerrisk',
  'wmkf_revieweroverallrating',
  // Stage 2a slice 1 additions (S143).
  'wmkf_reviewerfirstname',
  'wmkf_reviewerlastname',
  'wmkf_reviewernickname',
  'wmkf_reviewertitle',
  'wmkf_revieweremail',
  'wmkf_reviewerorcid',
  'wmkf_declinereason',
  'wmkf_declinereasonpicklist',
  'wmkf_declinereferral',
  'wmkf_honorariumoptout',
  // W5 step 3: per-candidate proposal summary blob URL. Migrated from
  // Postgres `reviewer_suggestions.summary_blob_url` 2026-05-12; read by
  // generate-emails.js for multi-proposal email batches.
  'wmkf_summarybloburl',
  'wmkf_withdrawnsufficientat',
  'wmkf_coiackedat',
  'wmkf_aiuseackedat',
  '_wmkf_coipolicyversion_value',
  '_wmkf_aiusepolicyversion_value',
  '_wmkf_potentialreviewer_value',
  '_wmkf_request_value',
  // BILL chunk-1 lookup (Connor, deployed 2026-05-28): the honorarium
  // akoya_request this engagement's payout maps to. Set by the portal accept
  // path (chunk 4) after creating the honorarium row. Provenance to the grant
  // request is one hop away via _wmkf_request_value.
  '_wmkf_honorariumrequest_value',
  // Request Workbench (S208). `wmkf_completedat` paired with reviewstatus=
  // complete (deployed wave5, S196). `wmkf_applicantdisposition` (deployed
  // wave6, S208) tags applicant-sourced rows: null = staff/Claude-discovered
  // (normal case), recommended / excluded otherwise. See APPLICANT_DISPOSITION_MAP.
  'wmkf_completedat',
  'wmkf_applicantdisposition',
];

// Picklist optionset values in Dataverse. Callers pass the legacy Postgres
// string values; we translate to the numeric optionset on write.
export const RESPONSE_TYPE_MAP = {
  accepted: 100000000,
  declined: 100000001,
  no_response: 100000002,
  withdrawn_sufficient: 100000003,
  held: 100000004,
};

// Inverse of RESPONSE_TYPE_MAP (numeric optionset value → string code). DERIVED from
// the write map so the read direction can never drift from it (audit #7 symmetric
// coverage). The canonical read map — consumers that surface responsetype as a string
// (Review-Manager API, reviewer-finder candidate DTO) import this instead of hand-rolling
// a partial copy.
export const RESPONSE_TYPE_BY_VALUE = Object.fromEntries(
  Object.entries(RESPONSE_TYPE_MAP).map(([k, v]) => [v, k]),
);

// Stage 2a structured decline-reason picklist (S143).
const DECLINE_REASON_MAP = {
  'too-busy': 100000000,
  'conflict-of-interest': 100000001,
  'outside-expertise': 100000002,
  'bad-timing': 100000003,
  'other': 100000004,
};

const REVIEW_STATUS_MAP = {
  accepted: 100000000,
  materials_sent: 100000001,
  under_review: 100000002,
  review_received: 100000003,
  complete: 100000004,
};

// Applicant-disposition picklist (wmkf_applicantdisposition, deployed wave6
// S208). Tags an applicant-sourced engagement row. null (the normal case) =
// staff/Claude-discovered candidate. Per-request scoped — lives ONLY on the
// junction row, never on the global wmkf_potentialreviewer person.
export const APPLICANT_DISPOSITION_MAP = {
  recommended: 100000000,
  excluded: 100000001,
};
export const APPLICANT_DISPOSITION_EXCLUDED = APPLICANT_DISPOSITION_MAP.excluded;

/**
 * OData filter fragment that drops applicant-"excluded" rows while KEEPING
 * null-disposition rows (the normal staff/Claude-discovered case).
 *
 * Load-bearing nuance: Dataverse omits any row whose $filter expression
 * evaluates to null (MS Web API "Filter rows" doc), and `field ne X` is null
 * when `field` itself is null. So a bare `wmkf_applicantdisposition ne <excluded>`
 * would silently hide EVERY normal candidate (the common case). The explicit
 * `eq null or` restores them. Same workaround the codebase already uses for
 * nullable booleans in reviewer-suggestion-sweep.js.
 */
export function notExcludedFilter(field = 'wmkf_applicantdisposition') {
  return `(${field} eq null or ${field} ne ${APPLICANT_DISPOSITION_EXCLUDED})`;
}

/** True if a fetched suggestion row carries the applicant-"excluded" disposition. */
export function isExcluded(row) {
  return row?.wmkf_applicantdisposition === APPLICANT_DISPOSITION_EXCLUDED;
}

/**
 * Atomically set ONLY `wmkf_matchreason` on a suggestion row — no `wmkf_selected`,
 * no lifecycle fields, no payload replay (so it can't resurrect a staff-removed
 * row, the way `upsert` would). Used to persist COI tags onto an applicant-
 * recommended row.
 *
 * Fail-closed on an applicant-"excluded" disposition. ETag-conditional (If-Match)
 * so a concurrent disposition change can't be silently clobbered: on a 412 we
 * re-read, re-check excluded, and retry the PATCH exactly once (a second 412
 * throws rather than looping).
 *
 * @returns {Promise<{updated: boolean, skippedExcluded?: boolean}>}
 */
export async function setMatchReason(suggestionId, matchReason, { actingUserSystemId } = {}) {
  if (!suggestionId) throw new Error('reviewer-suggestion.setMatchReason: suggestionId required');

  // getRecord surfaces the ETag as `record._etag` (via processAnnotations) — do
  // NOT put `@odata.etag` in $select (invalid OData).
  const readAndPatch = async () => {
    const row = await DynamicsService.getRecord(ENTITY_SET, suggestionId, {
      select: 'wmkf_applicantdisposition',
    });
    if (isExcluded(row)) return { updated: false, skippedExcluded: true };
    await DynamicsService.updateRecord(
      ENTITY_SET,
      suggestionId,
      { wmkf_matchreason: matchReason },
      { ifMatch: row._etag, actingUserSystemId },
    );
    return { updated: true };
  };

  try {
    return await readAndPatch();
  } catch (err) {
    if (err?.status !== 412) throw err;
    // Concurrent edit between read and PATCH — re-read + retry once. A second
    // 412 propagates (no loop).
    return await readAndPatch();
  }
}

function mapPicklist(map, value, fieldName) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return value;
  const key = String(value).toLowerCase();
  if (key in map) return map[key];
  throw new Error(`reviewer-suggestion: unknown ${fieldName} value '${value}'`);
}

function pruneEmpty(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) continue;
    if (typeof v === 'string' && v.trim() === '') continue;
    out[k] = v;
  }
  return out;
}

export function coerceRelevanceScore(value) {
  if (value === null || value === undefined || value === '') return 0.5;
  const score = Number(value);
  if (!Number.isFinite(score)) return 0.5;
  if (score < 0) return 0;
  if (score > 100) return 100;
  return score;
}

export async function findByPotentialReviewerAndRequest(potentialReviewerId, requestId) {
  if (!potentialReviewerId || !requestId) return null;
  const { records } = await DynamicsService.queryRecords(ENTITY_SET, {
    select: FIELD_SELECT.join(','),
    filter: `_wmkf_potentialreviewer_value eq ${potentialReviewerId} and _wmkf_request_value eq ${requestId}`,
    top: 1,
  });
  return records[0] || null;
}

/**
 * Upsert the suggestion row for a (potentialReviewer, request) pair.
 * Used by save-candidates: writes scoring/source/programArea/grantCycleCode/
 * matchReason/suggestionLabel + sets selected=true.
 *
 * Lifecycle transitions (markInvited, markMaterialsSent, etc.) are separate
 * methods to be added as they're wired.
 *
 * Returns { id, created }.
 */
export async function upsert({
  potentialReviewerId,
  requestId,
  suggestionLabel,
  grantCycleCode,
  programArea,
  relevanceScore,
  matchReason,
  sources,
  selected = true,
  summaryBlobUrl,
  applicantDisposition,
}, { actingUserSystemId } = {}) {
  if (!potentialReviewerId || !requestId) {
    throw new Error('reviewer-suggestion adapter: potentialReviewerId and requestId are required');
  }

  const incoming = pruneEmpty({
    wmkf_suggestionlabel: suggestionLabel,
    wmkf_grantcyclecode: grantCycleCode,
    wmkf_programarea: programArea,
    wmkf_relevancescore: coerceRelevanceScore(relevanceScore),
    wmkf_matchreason: matchReason,
    wmkf_sources: sources,
    wmkf_summarybloburl: summaryBlobUrl,
  });
  incoming.wmkf_selected = !!selected;
  if (applicantDisposition !== undefined && applicantDisposition !== null) {
    incoming.wmkf_applicantdisposition = mapPicklist(APPLICANT_DISPOSITION_MAP, applicantDisposition, 'applicantDisposition');
  }

  const existing = await findByPotentialReviewerAndRequest(potentialReviewerId, requestId);
  if (existing) {
    // Disposition-aware (Phase 0.7): never silently convert an applicant-
    // "excluded" row into a selected candidate. "Excluded wins" — preserve the
    // marker and let the caller surface the collision. (Full recommended+
    // excluded resolution lands in Phase 3; this is the foundational guard so
    // a later candidate/Claude upsert can't clobber an excluded row.)
    if (isExcluded(existing) && incoming.wmkf_applicantdisposition !== APPLICANT_DISPOSITION_EXCLUDED) {
      return { id: existing.wmkf_appreviewersuggestionid, created: false, skippedExcluded: true };
    }
    await DynamicsService.updateRecord(ENTITY_SET, existing.wmkf_appreviewersuggestionid, incoming, { actingUserSystemId });
    return { id: existing.wmkf_appreviewersuggestionid, created: false };
  }

  if (!incoming.wmkf_suggestionlabel) {
    incoming.wmkf_suggestionlabel = `Suggestion ${new Date().toISOString().slice(0, 10)}`;
  }
  incoming['wmkf_PotentialReviewer@odata.bind'] = `/wmkf_potentialreviewerses(${potentialReviewerId})`;
  incoming['wmkf_Request@odata.bind'] = `/akoya_requests(${requestId})`;

  const created = await DynamicsService.createRecord(ENTITY_SET, incoming, { actingUserSystemId });
  return { id: created.wmkf_appreviewersuggestionid, created: true };
}

/** Split a comma-joined wmkf_sources string into a deduped, trimmed list. */
function splitSources(sources) {
  if (!sources) return [];
  return String(sources)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Idempotently materialize the applicant-RECOMMENDED junction row for a
 * (person, request) pair (Workbench Phase 3 ingestion of the legacy
 * `wmkf_potentialreviewer1..5` slots). The person already exists — the slot is
 * a lookup → GUID — so this only ensures the engagement row carries
 * `disposition=recommended` and `applicant` in its sources. Applicant CREATEs
 * land UNSELECTED; promotion into the candidate pool is an explicit Program
 * Director action that flips `wmkf_selected=true` on this existing row.
 *
 * Behavior:
 *  - **Source-merging:** unions `applicant` into any existing `wmkf_sources`
 *    rather than clobbering (a person can be both Claude-discovered AND
 *    applicant-recommended for the same request).
 *  - **Excluded wins:** if a row already exists carrying `disposition=excluded`,
 *    it is NOT flipped to recommended — returns `{ skippedExcluded: true }`
 *    (Phase 0.7 collision rule; cannot occur in the option-B pilot, which writes
 *    no excluded rows, but kept defensive for the intake-portal path).
 *    NB: the excluded check and the recommended PATCH are NOT atomic — a
 *    concurrent writer flipping the row to excluded between the read and the
 *    PATCH could be clobbered back to recommended. This window is DORMANT today:
 *    no code path writes `disposition=excluded` (grep-verified S210; only future
 *    intake-portal direct writes will). When an excluded-writer lands, this
 *    needs an ETag-conditional PATCH — tracked as a deferred Phase-3 acceptance
 *    criterion in `docs/REQUEST_WORKBENCH_BUILD_PLAN.md`. (The same non-atomic
 *    shape exists in the sibling `upsert()`.)
 *  - **Non-clobbering fill:** label / cycle / programArea / matchReason are only
 *    written when creating or when the existing value is empty, so a later run
 *    (or staff edit) is preserved — this makes re-running fully idempotent.
 *  - **Starts outside the candidate pool:** `wmkf_selected=false` is set on
 *    CREATE. On an existing row the update LEAVES `wmkf_selected` untouched, so
 *    lazy ingestion never promotes or resurrects a row. Staff/PD curation wins.
 *  - **Race-safe:** lazy-on-Find-open ingestion can run concurrently for the
 *    same request; a create that loses the (person,request) alternate-key race
 *    is caught, re-fetched, and converted to an update.
 *
 * @returns {Promise<{ id: string, created: boolean, selected: boolean, skippedExcluded?: boolean }>}
 *   `selected` reflects the row's live curation state (false ⇒ not yet promoted
 *   or staff removed).
 */
export async function ensureApplicantRecommended({
  potentialReviewerId,
  requestId,
  suggestionLabel,
  grantCycleCode,
  programArea,
  matchReason,
}, { actingUserSystemId } = {}) {
  if (!potentialReviewerId || !requestId) {
    throw new Error('ensureApplicantRecommended: potentialReviewerId and requestId are required');
  }

  const existing = await findByPotentialReviewerAndRequest(potentialReviewerId, requestId);

  if (existing && isExcluded(existing)) {
    // Excluded wins — never flip an applicant-excluded row to a candidate.
    return { id: existing.wmkf_appreviewersuggestionid, created: false, selected: false, skippedExcluded: true };
  }

  const mergedSources = Array.from(new Set([...splitSources(existing?.wmkf_sources), 'applicant'])).join(',');

  if (existing) {
    // NB: deliberately NO `wmkf_selected` here — leave the row's curation state
    // exactly as it is so a staff soft-delete (selected=false) is never
    // resurrected by re-ingestion. Source/disposition tagging is a harmless
    // no-op on an already-removed row.
    const payload = {
      wmkf_sources: mergedSources,
      wmkf_applicantdisposition: APPLICANT_DISPOSITION_MAP.recommended,
    };
    // Fill descriptive fields only when currently empty (preserve staff edits /
    // a prior enrichment run).
    if (!existing.wmkf_suggestionlabel && suggestionLabel) payload.wmkf_suggestionlabel = suggestionLabel;
    if (!existing.wmkf_grantcyclecode && grantCycleCode) payload.wmkf_grantcyclecode = grantCycleCode;
    if (!existing.wmkf_programarea && programArea) payload.wmkf_programarea = programArea;
    if (!existing.wmkf_matchreason && matchReason) payload.wmkf_matchreason = matchReason;
    await DynamicsService.updateRecord(ENTITY_SET, existing.wmkf_appreviewersuggestionid, payload, { actingUserSystemId });
    return { id: existing.wmkf_appreviewersuggestionid, created: false, selected: existing.wmkf_selected !== false };
  }

  const incoming = pruneEmpty({
    wmkf_suggestionlabel: suggestionLabel || `Applicant recommendation ${new Date().toISOString().slice(0, 10)}`,
    wmkf_grantcyclecode: grantCycleCode,
    wmkf_programarea: programArea,
    wmkf_matchreason: matchReason,
    wmkf_sources: mergedSources,
  });
  incoming.wmkf_selected = false;
  incoming.wmkf_applicantdisposition = APPLICANT_DISPOSITION_MAP.recommended;
  incoming['wmkf_PotentialReviewer@odata.bind'] = `/wmkf_potentialreviewerses(${potentialReviewerId})`;
  incoming['wmkf_Request@odata.bind'] = `/akoya_requests(${requestId})`;

  try {
    const created = await DynamicsService.createRecord(ENTITY_SET, incoming, { actingUserSystemId });
    return { id: created.wmkf_appreviewersuggestionid, created: true, selected: false };
  } catch (err) {
    // Only a duplicate (person,request) alternate-key collision on CREATE means
    // a concurrent ingestion run won the race — converge to an update so the
    // call stays idempotent. Dataverse returns 412 Precondition Failed with
    // "A record with matching key values already exists" for a duplicate
    // alternate key on POST (MS Learn, conditional-operations). `createRecord`
    // sends NO If-Match, so a 412 here can ONLY be that precondition — never an
    // ETag/optimistic-concurrency mismatch, which requires an If-Match the
    // create path doesn't set (Codex S210 verification: the general "412 could
    // be an ETag mismatch" concern doesn't reach this no-If-Match call site).
    // Any OTHER failure (validation 400, privilege 403, throttle 429, transient
    // 5xx) is a real error and must surface, not be masked as success.
    const isConflict = err?.status === 412 || err?.status === 409
      || /duplicate|already exists|matching key values|alternate key/i.test(err?.message || '');
    if (!isConflict) throw err;
    const now = await findByPotentialReviewerAndRequest(potentialReviewerId, requestId);
    if (!now) throw err; // conflict-shaped but no row surfaced — re-throw
    if (isExcluded(now)) {
      return { id: now.wmkf_appreviewersuggestionid, created: false, selected: false, skippedExcluded: true };
    }
    const reMerged = Array.from(new Set([...splitSources(now.wmkf_sources), 'applicant'])).join(',');
    // Same as the update path above: no `wmkf_selected` — preserve curation state.
    await DynamicsService.updateRecord(ENTITY_SET, now.wmkf_appreviewersuggestionid, {
      wmkf_sources: reMerged,
      wmkf_applicantdisposition: APPLICANT_DISPOSITION_MAP.recommended,
    }, { actingUserSystemId });
    return { id: now.wmkf_appreviewersuggestionid, created: false, selected: now.wmkf_selected !== false };
  }
}

/**
 * Idempotently materialize an explicitly staff-added reviewer for one request.
 *
 * This is a direct staff action, unlike lazy applicant-slot ingestion, so an
 * existing non-excluded row is re-selected if staff adds it again. Existing
 * sources are unioned with the caller's `sources` tokens (default `['staff_manual']`);
 * a referral (S249) passes `['staff_manual', 'referred']` so the `referred`
 * provenance kind survives reload (without it, my-candidates would rebuild the row
 * with only `staff_manual` and the referral would silently degrade). Applicant
 * recommendation state is preserved when present so a row can carry both origins.
 *
 * @returns {Promise<{ id: string, created: boolean, selected: boolean, skippedExcluded?: boolean }>}
 */
export async function ensureStaffManualCandidate({
  potentialReviewerId,
  requestId,
  suggestionLabel,
  grantCycleCode,
  programArea,
  matchReason,
  sources,
}, { actingUserSystemId } = {}) {
  if (!potentialReviewerId || !requestId) {
    throw new Error('ensureStaffManualCandidate: potentialReviewerId and requestId are required');
  }

  const existing = await findByPotentialReviewerAndRequest(potentialReviewerId, requestId);

  if (existing && isExcluded(existing)) {
    return { id: existing.wmkf_appreviewersuggestionid, created: false, selected: false, skippedExcluded: true };
  }

  const tokens = Array.isArray(sources) && sources.length ? sources : ['staff_manual'];
  const mergedSources = Array.from(new Set([...splitSources(existing?.wmkf_sources), ...tokens])).join(',');

  if (existing) {
    const payload = {
      wmkf_sources: mergedSources,
      wmkf_selected: true,
    };
    if (!existing.wmkf_suggestionlabel && suggestionLabel) payload.wmkf_suggestionlabel = suggestionLabel;
    if (!existing.wmkf_grantcyclecode && grantCycleCode) payload.wmkf_grantcyclecode = grantCycleCode;
    if (!existing.wmkf_programarea && programArea) payload.wmkf_programarea = programArea;
    if (!existing.wmkf_matchreason && matchReason) payload.wmkf_matchreason = matchReason;
    await DynamicsService.updateRecord(ENTITY_SET, existing.wmkf_appreviewersuggestionid, payload, { actingUserSystemId });
    return { id: existing.wmkf_appreviewersuggestionid, created: false, selected: true };
  }

  const incoming = pruneEmpty({
    wmkf_suggestionlabel: suggestionLabel || `Manual reviewer ${new Date().toISOString().slice(0, 10)}`,
    wmkf_grantcyclecode: grantCycleCode,
    wmkf_programarea: programArea,
    wmkf_matchreason: matchReason || 'Manually added by staff.',
    wmkf_sources: mergedSources,
  });
  incoming.wmkf_selected = true;
  incoming['wmkf_PotentialReviewer@odata.bind'] = `/wmkf_potentialreviewerses(${potentialReviewerId})`;
  incoming['wmkf_Request@odata.bind'] = `/akoya_requests(${requestId})`;

  try {
    const created = await DynamicsService.createRecord(ENTITY_SET, incoming, { actingUserSystemId });
    return { id: created.wmkf_appreviewersuggestionid, created: true, selected: true };
  } catch (err) {
    const isConflict = err?.status === 412 || err?.status === 409
      || /duplicate|already exists|matching key values|alternate key/i.test(err?.message || '');
    if (!isConflict) throw err;
    const now = await findByPotentialReviewerAndRequest(potentialReviewerId, requestId);
    if (!now) throw err;
    if (isExcluded(now)) {
      return { id: now.wmkf_appreviewersuggestionid, created: false, selected: false, skippedExcluded: true };
    }
    const reMerged = Array.from(new Set([...splitSources(now.wmkf_sources), 'staff_manual'])).join(',');
    await DynamicsService.updateRecord(ENTITY_SET, now.wmkf_appreviewersuggestionid, {
      wmkf_sources: reMerged,
      wmkf_selected: true,
    }, { actingUserSystemId });
    return { id: now.wmkf_appreviewersuggestionid, created: false, selected: true };
  }
}

/**
 * Fetch a single suggestion by id. This is the shared chokepoint for the
 * email / token / complete-stamp action paths (render-emails, send-emails,
 * generate-emails, reviewers complete-stamp, my-candidates token mint), so it
 * FAILS CLOSED on an applicant-"excluded" row rather than letting a caller act
 * on a reviewer the applicant asked us not to use. Returning null instead would
 * be unsafe — e.g. the reviewers.js complete-stamp treats a null read as "no
 * prior row" and would proceed to mark the engagement complete. The list/count
 * readers already filter excluded rows out, so this only fires if an excluded
 * id leaks through upstream — but these paths send email / mint tokens, so we
 * throw. (Pure-read callers that legitimately need excluded rows must query
 * directly, not via findById.)
 */
export async function findById(id) {
  const row = await DynamicsService.getRecord(ENTITY_SET, id, { select: FIELD_SELECT.join(',') });
  if (isExcluded(row)) {
    throw new Error(`reviewer-suggestion.findById: refusing to act on an applicant-excluded suggestion (${id})`);
  }
  return row;
}

export async function findByRequest(requestId, { selectedOnly = true } = {}) {
  if (!requestId) return [];
  // Defense-in-depth: requestId is interpolated raw into the OData `$filter`
  // below (`_wmkf_request_value eq ${requestId}`), so a non-GUID value would be
  // an injection vector. Routes already GUID-validate at the edge
  // (lib/utils/guid.js); this fails loud if a bad id ever reaches the shared
  // filter-building chokepoint anyway.
  if (!isGuid(requestId)) {
    throw new Error('reviewer-suggestion.findByRequest: requestId must be a GUID');
  }
  const filter = selectedOnly
    ? `_wmkf_request_value eq ${requestId} and wmkf_selected eq true and ${notExcludedFilter()}`
    : `_wmkf_request_value eq ${requestId} and ${notExcludedFilter()}`;
  const { records } = await DynamicsService.queryRecords(ENTITY_SET, {
    select: FIELD_SELECT.join(','),
    filter,
    orderby: 'createdon desc',
    top: 200,
  });
  return records;
}

/**
 * Count ACCEPTED reviewers for a request (reviewer-engagement Phase 4 quota).
 * Mirrors the accepted-reader filter shape (`wmkf_accepted eq true`) used by
 * findAcceptedByPD; scoped to one request and excluding applicant-excluded rows.
 * Called AFTER the accept PATCH commits, so a freshly-accepted row is included.
 */
export async function countAcceptedForRequest(requestId) {
  if (!isGuid(requestId)) {
    throw new Error('reviewer-suggestion.countAcceptedForRequest: requestId must be a GUID');
  }
  const { records } = await DynamicsService.queryRecords(ENTITY_SET, {
    select: 'wmkf_appreviewersuggestionid',
    filter: `_wmkf_request_value eq ${requestId} and wmkf_accepted eq true and ${notExcludedFilter()}`,
    top: 500,
  });
  return records.length;
}

export async function findApplicantRecommendedByRequest(requestId) {
  if (!requestId) return [];
  if (!isGuid(requestId)) {
    throw new Error('reviewer-suggestion.findApplicantRecommendedByRequest: requestId must be a GUID');
  }
  const { records } = await DynamicsService.queryRecords(ENTITY_SET, {
    select: FIELD_SELECT.join(','),
    filter: `_wmkf_request_value eq ${requestId} and wmkf_applicantdisposition eq ${APPLICANT_DISPOSITION_MAP.recommended} and ${notExcludedFilter()}`,
    orderby: 'createdon desc',
    top: 200,
  });
  return records;
}

/**
 * All selected suggestions on requests where the given systemuser is the lead PD.
 * Two-step: query akoya_request to get matching request IDs, then fetch suggestions.
 *
 * @param {string} systemuserid - lead PD's systemuserid
 * @param {object} opts
 * @param {string} [opts.cycleCode] - 'Jxx'/'Dxx' to narrow by cycle
 * @param {boolean} [opts.selectedOnly=true]
 * @returns {Promise<{ suggestions: Array, requestById: Object }>}
 *   requestById is keyed by akoya_requestid with the projected request fields.
 */
export async function findByPD(systemuserid, { cycleCode, selectedOnly = true } = {}) {
  if (!systemuserid) return { suggestions: [], requestById: {} };

  const { meetingDateToCycleCode, cycleCodeToOdataFilter } = await import('../../utils/cycle-code.js');

  const requestFilters = [`_wmkf_programdirector_value eq ${systemuserid}`];
  if (cycleCode) {
    requestFilters.push(cycleCodeToOdataFilter(cycleCode, 'wmkf_meetingdate'));
  }

  // queryAllRecords paginates internally — without it, the unfiltered PD scope
  // can exceed 500 rows for active PDs and silently drop requests.
  const { records: requests } = await DynamicsService.queryAllRecords('akoya_requests', {
    select: [
      'akoya_requestid',
      'akoya_requestnum',
      'akoya_title',
      'wmkf_meetingdate',
      'wmkf_abstract',
      '_akoya_applicantid_value',
      '_wmkf_projectleader_value',
      '_wmkf_grantprogram_value',
      '_wmkf_programareaserved_value',
    ].join(','),
    filter: requestFilters.join(' and '),
  });

  const requestById = {};
  for (const r of requests) {
    requestById[r.akoya_requestid] = {
      requestId: r.akoya_requestid,
      requestNumber: r.akoya_requestnum,
      title: r.akoya_title || null,
      abstract: r.wmkf_abstract || null,
      meetingDate: r.wmkf_meetingdate || null,
      meetingCycleCode: r.wmkf_meetingdate ? meetingDateToCycleCode(r.wmkf_meetingdate) : null,
      applicantId: r._akoya_applicantid_value || null,
      applicant: r._akoya_applicantid_value_formatted || null,
      projectLeader: r._wmkf_projectleader_value_formatted || null,
      grantProgram: r._wmkf_grantprogram_value_formatted || null,
      programArea: r._wmkf_programareaserved_value_formatted || null,
    };
  }

  if (Object.keys(requestById).length === 0) {
    return { suggestions: [], requestById: {} };
  }

  // Dataverse OData doesn't support `in` for guid lists efficiently; use OR chain.
  // Chunk to keep URL length manageable.
  const reqIds = Object.keys(requestById);
  const all = [];
  const CHUNK = 25;
  for (let i = 0; i < reqIds.length; i += CHUNK) {
    const chunk = reqIds.slice(i, i + CHUNK);
    const orChain = chunk.map((id) => `_wmkf_request_value eq ${id}`).join(' or ');
    const baseFilter = selectedOnly
      ? `(${orChain}) and wmkf_selected eq true and ${notExcludedFilter()}`
      : `(${orChain}) and ${notExcludedFilter()}`;
    const { records } = await DynamicsService.queryRecords(ENTITY_SET, {
      select: FIELD_SELECT.join(','),
      filter: baseFilter,
      orderby: 'createdon desc',
      top: 500,
    });
    all.push(...records);
  }
  return { suggestions: all, requestById };
}

/**
 * Same shape as findByPD but limited to suggestions where the reviewer has
 * accepted (`wmkf_accepted eq true`). Used by Review Manager.
 */
export async function findAcceptedByPD(systemuserid, { cycleCode } = {}) {
  if (!systemuserid) return { suggestions: [], requestById: {} };

  const { meetingDateToCycleCode, cycleCodeToOdataFilter } = await import('../../utils/cycle-code.js');

  const requestFilters = [`_wmkf_programdirector_value eq ${systemuserid}`];
  if (cycleCode) {
    requestFilters.push(cycleCodeToOdataFilter(cycleCode, 'wmkf_meetingdate'));
  }

  const { records: requests } = await DynamicsService.queryAllRecords('akoya_requests', {
    select: [
      'akoya_requestid',
      'akoya_requestnum',
      'akoya_title',
      'wmkf_meetingdate',
      'wmkf_abstract',
      'wmkf_organizationname',
      '_akoya_applicantid_value',
      '_wmkf_projectleader_value',
      '_wmkf_grantprogram_value',
      '_wmkf_programareaserved_value',
    ].join(','),
    filter: requestFilters.join(' and '),
  });

  const requestById = {};
  for (const r of requests) {
    requestById[r.akoya_requestid] = {
      requestId: r.akoya_requestid,
      requestNumber: r.akoya_requestnum,
      title: r.akoya_title || null,
      abstract: r.wmkf_abstract || null,
      meetingDate: r.wmkf_meetingdate || null,
      meetingCycleCode: r.wmkf_meetingdate ? meetingDateToCycleCode(r.wmkf_meetingdate) : null,
      applicant: r._akoya_applicantid_value_formatted || null,
      projectLeader: r._wmkf_projectleader_value_formatted || null,
      grantProgram: r._wmkf_grantprogram_value_formatted || null,
      programArea: r._wmkf_programareaserved_value_formatted || null,
      organizationName: r.wmkf_organizationname || null,
    };
  }

  if (Object.keys(requestById).length === 0) {
    return { suggestions: [], requestById: {} };
  }

  const reqIds = Object.keys(requestById);
  const all = [];
  const CHUNK = 25;
  for (let i = 0; i < reqIds.length; i += CHUNK) {
    const chunk = reqIds.slice(i, i + CHUNK);
    const orChain = chunk.map((id) => `_wmkf_request_value eq ${id}`).join(' or ');
    const { records } = await DynamicsService.queryRecords(ENTITY_SET, {
      select: FIELD_SELECT.join(','),
      filter: `(${orChain}) and wmkf_selected eq true and wmkf_accepted eq true and ${notExcludedFilter()}`,
      orderby: 'createdon desc',
      top: 500,
    });
    all.push(...records);
  }
  return { suggestions: all, requestById };
}

/**
 * Update lifecycle/notes/email-tracking fields on a single suggestion. Only fields
 * present in `updates` are written; null is permitted to clear a value.
 */
export async function updateLifecycle(id, updates, { actingUserSystemId, ifMatch } = {}) {
  if (!id) throw new Error('reviewer-suggestion.updateLifecycle: id required');
  const map = {
    invited: 'wmkf_invited',
    accepted: 'wmkf_accepted',
    declined: 'wmkf_declined',
    notes: 'wmkf_notes',
    emailSentAt: 'wmkf_emailsentat',
    responseType: 'wmkf_responsetype',
    responseReceivedAt: 'wmkf_responsereceivedat',
    materialsSentAt: 'wmkf_materialssentat',
    reminderSentAt: 'wmkf_remindersentat',
    reminderCount: 'wmkf_remindercount',
    respondReminderSentAt: 'wmkf_respondremindersentat',
    withdrawnSufficientAt: 'wmkf_withdrawnsufficientat',
    reviewReceivedAt: 'wmkf_reviewreceivedat',
    thankYouSentAt: 'wmkf_thankyousentat',
    reviewFilename: 'wmkf_reviewfilename',
    reviewStatus: 'wmkf_reviewstatus',
    selected: 'wmkf_selected',
    programArea: 'wmkf_programarea',
    grantCycleCode: 'wmkf_grantcyclecode',
    completedAt: 'wmkf_completedat',
    applicantDisposition: 'wmkf_applicantdisposition',
  };
  const payload = {};
  for (const [k, v] of Object.entries(updates || {})) {
    if (!(k in map) || v === undefined) continue;
    if (k === 'responseType') payload[map[k]] = mapPicklist(RESPONSE_TYPE_MAP, v, 'responseType');
    else if (k === 'reviewStatus') payload[map[k]] = mapPicklist(REVIEW_STATUS_MAP, v, 'reviewStatus');
    else if (k === 'applicantDisposition') payload[map[k]] = mapPicklist(APPLICANT_DISPOSITION_MAP, v, 'applicantDisposition');
    else payload[map[k]] = v;
  }

  if (Object.keys(payload).length === 0) return;

  // ONE read on every lifecycle write, serving two fail-closed purposes:
  //
  // (1) Refuse to mutate an applicant-"excluded" row AT ALL — not just on a
  //     complete transition. Excluded rows are already `selected=false` and
  //     filtered out of every candidate/invite list, so they shouldn't surface
  //     in a write path; this is the belt-and-suspenders guard at the adapter
  //     so all callers (single/batch PATCH, send-emails, my-candidates,
  //     future) fail closed without per-route checks. (Costs one extra
  //     Dataverse read per lifecycle write — accepted deliberately, S208.)
  //
  // (2) On a transition to reviewStatus=complete, stamp the close-out
  //     timestamps idempotently: wmkf_completedat ("PD closed out") and
  //     wmkf_reviewreceivedat (legacy COALESCE(review_received_at, NOW())
  //     fallback) — only when currently empty, never overriding a caller value.
  //     Centralized here so EVERY complete path stamps consistently; the build
  //     plan's "single code path in reviewers.js" assumption was wrong — there
  //     are several (Codex S208 catch).
  const existing = await DynamicsService.getRecord(ENTITY_SET, id, {
    select: 'wmkf_applicantdisposition,wmkf_completedat,wmkf_reviewreceivedat',
  });
  if (isExcluded(existing)) {
    throw new Error(`reviewer-suggestion.updateLifecycle: refusing to mutate an applicant-excluded suggestion (${id})`);
  }
  if (payload.wmkf_reviewstatus === REVIEW_STATUS_MAP.complete) {
    const now = new Date().toISOString();
    if (payload.wmkf_completedat === undefined && !existing?.wmkf_completedat) {
      payload.wmkf_completedat = now;
    }
    if (payload.wmkf_reviewreceivedat === undefined && !existing?.wmkf_reviewreceivedat) {
      payload.wmkf_reviewreceivedat = now;
    }
  }

  await DynamicsService.updateRecord(ENTITY_SET, id, payload, {
    actingUserSystemId,
    // Optional optimistic lock — a caller that read the row and needs the write to fail if
    // it changed underneath (e.g. the selective-decline route guarding against a reviewer
    // accepting between its pending-read and this write) passes the row's _etag.
    ...(ifMatch ? { ifMatch } : {}),
  });
}

/**
 * Apply a Stage 2a accept/decline event to the suggestion row. Encapsulates
 * all the writes the /respond endpoint needs into one transaction-shaped
 * call so it can fail atomically (Dataverse PATCH is one HTTP call → one
 * row update → server-side atomicity). Picklist mapping is centralized here.
 *
 * @param {string} id - suggestion GUID
 * @param {Object} body
 * @param {'accept'|'decline'} body.action
 * @param {Object} [body.contactEdits] - per write rules in plan §4 (only
 *   non-null fields are written; truly empty strings are skipped)
 * @param {boolean} [body.honorariumOptOut]
 * @param {{coiVersionId: string, aiUseVersionId: string, ackedAt: string}} [body.acks]
 *   — required when action='accept'; the active-version GUIDs the server
 *   resolved at accept time (not the client) plus the now() timestamp.
 * @param {{reasonPicklist?: string, reasonText?: string, referral?: string}} [body.decline]
 * @param {string} [opts.ifMatch] - the suggestion row's _etag from page load,
 *   for optimistic locking. 412 on conflict.
 */
export async function applyStage2aResponse(id, body, { ifMatch, actingUserSystemId } = {}) {
  if (!id) throw new Error('applyStage2aResponse: id required');
  if (!body || (body.action !== 'accept' && body.action !== 'decline' && body.action !== 'hold')) {
    throw new Error(`applyStage2aResponse: action must be 'accept', 'decline', or 'hold', got '${body?.action}'`);
  }

  const payload = {};
  const now = new Date().toISOString();

  // Engagement-scope contact corrections (always written if provided; null
  // skipped, "" skipped per pruneEmpty convention).
  const edits = body.contactEdits || {};
  const editMap = {
    firstName: 'wmkf_reviewerfirstname',
    lastName: 'wmkf_reviewerlastname',
    nickname: 'wmkf_reviewernickname',
    title: 'wmkf_reviewertitle',
    affiliation: 'wmkf_revieweraffiliation',
    email: 'wmkf_revieweremail',
    orcid: 'wmkf_reviewerorcid',
  };
  for (const [k, col] of Object.entries(editMap)) {
    const v = edits[k];
    if (v === undefined) continue;
    // Empty string clears the field (overwrite-with-null semantics); null
    // also clears. Distinguishing intent: if reviewer wipes a prefilled value
    // and submits, we honor the wipe.
    payload[col] = (v === null || v === '') ? null : v;
  }

  if (body.action === 'accept') {
    if (!body.acks || !body.acks.coiVersionId || !body.acks.aiUseVersionId) {
      throw new Error('applyStage2aResponse(accept): body.acks.{coiVersionId,aiUseVersionId} required');
    }
    payload['wmkf_CoiPolicyVersion@odata.bind'] = `/wmkf_policyversions(${body.acks.coiVersionId})`;
    payload['wmkf_AiUsePolicyVersion@odata.bind'] = `/wmkf_policyversions(${body.acks.aiUseVersionId})`;
    payload.wmkf_coiackedat = body.acks.ackedAt || now;
    payload.wmkf_aiuseackedat = body.acks.ackedAt || now;
    payload.wmkf_honorariumoptout = body.honorariumOptOut === true;
    payload.wmkf_accepted = true;
    payload.wmkf_declined = false;
    payload.wmkf_responsetype = RESPONSE_TYPE_MAP.accepted;
    payload.wmkf_responsereceivedat = now;
    // Clear any prior decline state if transitioning from declined → accepted.
    payload.wmkf_declinereason = null;
    payload.wmkf_declinereasonpicklist = null;
    payload.wmkf_declinereferral = null;
  } else if (body.action === 'hold') {
    // Pre-accept "hold" — agreed in principle. Sets the held responsetype + the
    // dedicated hold timestamp ONLY; never acks/payment/honorarium, never accepted.
    // `wmkf_heldat` is owned exclusively by this path (NOT updateLifecycle) so the
    // hold moment survives a later finalize, which overwrites wmkf_responsereceivedat.
    // Repeat-hold idempotency (don't re-stamp wmkf_heldat) is enforced at the route
    // (respond.js short-circuits before calling this when already held).
    payload.wmkf_responsetype = RESPONSE_TYPE_MAP.held;
    payload.wmkf_heldat = now;
    payload.wmkf_responsereceivedat = now;
    payload.wmkf_accepted = false;
    payload.wmkf_declined = false;
    // Clear any prior decline state if transitioning from declined → held.
    payload.wmkf_declinereason = null;
    payload.wmkf_declinereasonpicklist = null;
    payload.wmkf_declinereferral = null;
  } else {
    // decline
    const decline = body.decline || {};
    if (decline.reasonPicklist !== undefined) {
      payload.wmkf_declinereasonpicklist = decline.reasonPicklist === null
        ? null
        : mapPicklist(DECLINE_REASON_MAP, decline.reasonPicklist, 'declineReason');
    }
    if (decline.reasonText !== undefined) {
      payload.wmkf_declinereason = decline.reasonText || null;
    }
    if (decline.referral !== undefined) {
      payload.wmkf_declinereferral = decline.referral || null;
    }
    payload.wmkf_accepted = false;
    payload.wmkf_declined = true;
    payload.wmkf_responsetype = RESPONSE_TYPE_MAP.declined;
    payload.wmkf_responsereceivedat = now;
  }

  await DynamicsService.updateRecord(ENTITY_SET, id, payload, { ifMatch, actingUserSystemId });
}

/**
 * Set the honorarium-request lookup on the engagement junction (BILL chunk 4).
 * Idempotent: writing the same id again is a no-op PATCH. PascalCase nav
 * property per Dataverse @odata.bind convention.
 */
export async function setHonorariumRequest(id, honorariumRequestId, { actingUserSystemId } = {}) {
  if (!id) throw new Error('reviewer-suggestion.setHonorariumRequest: id required');
  if (!honorariumRequestId) throw new Error('reviewer-suggestion.setHonorariumRequest: honorariumRequestId required');
  await DynamicsService.updateRecord(ENTITY_SET, id, {
    'wmkf_HonorariumRequest@odata.bind': `/akoya_requests(${honorariumRequestId})`,
  }, { actingUserSystemId });
}

/**
 * Soft-delete a suggestion (drop it from the request's selected lists) by setting
 * wmkf_selected=false. When `alsoRevokeToken` is set, the external magic-link
 * revoke (wmkf_externaltokenrevoked=true) is folded into the SAME PATCH so the
 * unselect + revoke are one atomic Dataverse write — there is no two-step window
 * where the row could be revoked-but-still-selected (or unselected-but-link-live)
 * if the second write failed (Codex S213 BUG-3 fix). Harmless on a never-tokened
 * row: it just sets a bool. updateRecord 404s (throws) if the row is missing,
 * which the caller surfaces rather than silently "removing" a nonexistent row.
 */
export async function softDelete(id, { actingUserSystemId, alsoRevokeToken = false } = {}) {
  if (!id) throw new Error('reviewer-suggestion.softDelete: id required');
  const payload = { wmkf_selected: false };
  if (alsoRevokeToken) payload.wmkf_externaltokenrevoked = true;
  await DynamicsService.updateRecord(ENTITY_SET, id, payload, { actingUserSystemId });
}

/**
 * Bulk update all selected suggestions on a request. Used by the UI's
 * "assign cycle/program area to whole proposal" action.
 */
export async function bulkUpdateByRequest(requestId, updates, { actingUserSystemId } = {}) {
  if (!requestId) throw new Error('reviewer-suggestion.bulkUpdateByRequest: requestId required');
  const rows = await findByRequest(requestId, { selectedOnly: true });
  for (const row of rows) {
    await updateLifecycle(row.wmkf_appreviewersuggestionid, updates, { actingUserSystemId });
  }
  return rows.length;
}

export const ENTITY_SET_NAME = ENTITY_SET;
