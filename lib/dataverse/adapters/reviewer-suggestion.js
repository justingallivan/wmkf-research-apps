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
import * as odata from '../core/odata.js';
import { entitySet, selectFields } from '../core/entity-registry.js';
import { chunk as chunked } from '../../utils/chunk.js';
import { TERMINAL_REVIEW_STATUS_VALUES } from '../../../shared/config/reviewerStatus.js';
import {
  APPLICANT_DISPOSITION_EXCLUDED,
  APPLICANT_DISPOSITION_MAP,
  RESPONSE_TYPE_MAP,
  REVIEW_STATUS_MAP,
} from '../../../shared/config/reviewerLifecycle.js';
import { runChangeset } from '../core/changeset.js';
import { adapterError } from '../core/errors.js';
import { reviewerEngagementProjection } from '../../../shared/utils/reviewer-engagement.js';
import { resolveLegacyDeclineReferral } from '../../../shared/utils/decline-referrals.js';

export {
  APPLICANT_DISPOSITION_EXCLUDED,
  APPLICANT_DISPOSITION_MAP,
  RESPONSE_TYPE_MAP,
  REVIEW_STATUS_MAP,
};

const ENTITY_SET = entitySet('wmkf_appreviewersuggestions');

const FIELD_SELECT = selectFields(ENTITY_SET);

// Picklist optionset values in Dataverse. Callers pass the legacy Postgres
// string values; we translate to the numeric optionset on write.
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

// Numeric terminal values, for source-state checks against a row read back from
// Dataverse (which carries the option integer, not the string code).
const TERMINAL_REVIEW_STATUS_VALUE_SET = new Set(Object.values(TERMINAL_REVIEW_STATUS_VALUES));

// Applicant-disposition picklist (wmkf_applicantdisposition, deployed wave6
// S208). Tags an applicant-sourced engagement row. null (the normal case) =
// staff/Claude-discovered candidate. Per-request scoped — lives ONLY on the
// junction row, never on the global wmkf_potentialreviewer person.
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
 * True if a fetched suggestion row carries applicant-RECOMMENDED provenance —
 * either the `recommended` disposition or an `applicant` token in wmkf_sources.
 * Used by the merge planner to decide whether a colliding loser row's applicant
 * intent must be unioned onto the keeper's surviving row before the loser row is
 * deleted (else the applicant recommendation would be silently dropped). Requires
 * wmkf_sources + wmkf_applicantdisposition in the row select (MERGE_PREDICATE_SELECT).
 */
export function hasApplicantProvenance(row) {
  if (!row) return false;
  if (row.wmkf_applicantdisposition === APPLICANT_DISPOSITION_MAP.recommended) return true;
  return splitSources(row.wmkf_sources).includes('applicant');
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

// `wmkf_programarea` is capped at 100 chars in Dataverse. Request-derived labels
// should already be short, but legacy LLM extraction sometimes produced long
// descriptive prose (req 1002916). Do not persist truncated garbage: preserve
// short labels, map the old prompt's two long labels to canonical Dataverse
// labels, and drop overlong/placeholder values.
export const PROGRAM_AREA_MAX_LENGTH = 100;
export function normalizeSuggestionProgramArea(value) {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^(?:not specified|unknown|none|n\/?a|n\.a\.?)$/i.test(trimmed)) return null;

  const compact = trimmed
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
  if (compact === 'science and engineering research program') return 'Science and Engineering Research';
  if (compact === 'medical research program') return 'Medical Research';

  return trimmed.length > PROGRAM_AREA_MAX_LENGTH ? null : trimmed;
}

// ───────── External token lifecycle (mirrors lib/external/token-lifecycle.js) ─────────
// Plain reads/writes only — no bypassDynamicsRestrictions here, that wrapper
// stays with the caller (Stage 7 removes it later). Callers keep their own
// fail-closed / excluded-disposition checks; these methods just forward the
// exact entity/select/payload shape token-lifecycle.js used inline.

/** Fields ensureToken() needs to decide whether a re-mint is required. */
export async function getForTokenStatus(suggestionId) {
  return DynamicsService.getRecord(ENTITY_SET, suggestionId, {
    select: 'wmkf_appreviewersuggestionid,wmkf_externaltokenhash,wmkf_externaltokenrevoked,wmkf_externaltokenexpires,_wmkf_request_value,wmkf_applicantdisposition',
  });
}

/** Persist a freshly-minted token's hash + issued/expires, clearing any prior revocation. */
export async function setExternalToken(suggestionId, { hash, expiresAt }, { actingUserSystemId } = {}) {
  return DynamicsService.updateRecord(ENTITY_SET, suggestionId, {
    wmkf_externaltokenhash: hash,
    wmkf_externaltokenissued: new Date().toISOString(),
    wmkf_externaltokenexpires: expiresAt.toISOString(),
    wmkf_externaltokenrevoked: false,
  }, { actingUserSystemId });
}

/** Mark a suggestion's token revoked (hash is left in place for audit). */
export async function revokeExternalToken(suggestionId, { actingUserSystemId } = {}) {
  return DynamicsService.updateRecord(ENTITY_SET, suggestionId, {
    wmkf_externaltokenrevoked: true,
  }, { actingUserSystemId });
}

/** Tighten a token's expiry to a short post-submission window. ONLY this field. */
export async function extendExternalTokenExpiry(suggestionId, expiresAt, { actingUserSystemId } = {}) {
  return DynamicsService.updateRecord(ENTITY_SET, suggestionId, {
    wmkf_externaltokenexpires: expiresAt.toISOString(),
  }, { actingUserSystemId });
}

export async function findByPotentialReviewerAndRequest(potentialReviewerId, requestId) {
  if (!potentialReviewerId || !requestId) return null;
  const { records } = await DynamicsService.queryRecords(ENTITY_SET, {
    select: odata.select(FIELD_SELECT),
    filter: `_wmkf_potentialreviewer_value eq ${potentialReviewerId} and _wmkf_request_value eq ${requestId}`,
    top: 1,
  });
  return records[0] || null;
}

// ───────── Merge support (S289) ─────────
// Lifecycle/outreach/intake fields the merge BLOCK PREDICATE inspects on the
// loser's rows. MUST be read for EVERY loser suggestion incl. removed
// (wmkf_selected=false) rows — softDelete does NOT null these or the FKs, so a
// removed row still occupies the (person,request) key and can still be engaged.
const MERGE_PREDICATE_SELECT = [
  'wmkf_appreviewersuggestionid',
  '_wmkf_potentialreviewer_value',
  '_wmkf_request_value',
  '_wmkf_honorariumrequest_value',
  // Applicant provenance for the collision-union gate (hasApplicantProvenance):
  // a colliding loser row that is applicant-recommended must transplant that
  // intent onto the keeper's surviving row before the loser row is deleted.
  'wmkf_sources',
  'wmkf_selected',
  'wmkf_invited',
  'wmkf_accepted',
  'wmkf_declined',
  'wmkf_responsetype',
  'wmkf_emailsentat',
  'wmkf_materialssentat',
  'wmkf_remindersentat',
  'wmkf_respondremindersentat',
  'wmkf_responsereceivedat',
  'wmkf_reviewreceivedat',
  'wmkf_thankyousentat',
  'wmkf_proposalfirstaccessed',
  'wmkf_reviewfilename',
  'wmkf_reviewsharepointfolder',
  // Phase D: the 3 rating columns were dropped from this merge-predicate select —
  // the engagement signal no longer reads them (covered by wmkf_reviewreceivedat).
  'wmkf_externaltokenissued',
  'wmkf_externaltokenrevoked',
  'wmkf_applicantdisposition',
  'wmkf_declinereason',
  'wmkf_honorariumoptout',
  // Codex S289 IND-A: these are engagement signals that the first predicate cut
  // missed — a PD close-out, COI/AI acknowledgements, a selective-decline, and any
  // reviewer-SUPPLIED stage-2a identity/contact field (the reviewer themselves
  // entered data ⇒ engaged). Read here so the block predicate can fail closed on them.
  'wmkf_completedat',
  'wmkf_coiackedat',
  'wmkf_aiuseackedat',
  'wmkf_withdrawnsufficientat',
  'wmkf_externaltokenrevoked',
  'wmkf_reviewerfirstname',
  'wmkf_reviewerlastname',
  'wmkf_reviewernickname',
  'wmkf_reviewertitle',
  'wmkf_revieweremail',
  'wmkf_reviewerorcid',
];

/**
 * ALL suggestion rows for one person across every request — incl. removed
 * (wmkf_selected=false) rows (NO selected filter). Paginated via queryAllRecords
 * because queryRecords caps $top at 100. Used by the merge planner to evaluate the
 * block predicate and plan repoints/collisions.
 */
export async function findAllByPotentialReviewer(potentialReviewerId) {
  if (!potentialReviewerId) return [];
  if (!isGuid(potentialReviewerId)) {
    throw new Error('reviewer-suggestion.findAllByPotentialReviewer: potentialReviewerId must be a GUID');
  }
  const { records } = await DynamicsService.queryAllRecords(ENTITY_SET, {
    select: odata.select(MERGE_PREDICATE_SELECT),
    filter: `_wmkf_potentialreviewer_value eq ${potentialReviewerId}`,
  });
  return records || [];
}

// Lightweight rollup select — reviewer-rollup.js's per-request stage-count
// path (dashboard + Overview tab), NOT the full FIELD_SELECT.
const ROLLUP_SELECT = '_wmkf_request_value,wmkf_selected,wmkf_invited,wmkf_accepted,wmkf_declined,wmkf_emailsentat,wmkf_responsetype,wmkf_reviewstatus';

/**
 * Active or declined, not-excluded suggestion rows across a chunk of request
 * GUIDs, for the lightweight reviewer-count rollup (no person/researcher fan-out).
 * Declines are included because every decline workflow archives the row by setting
 * `wmkf_selected=false`; other inactive rows remain excluded. The
 * caller builds and chunks the OR-chain (25 ids/call — queryAllRecords
 * paginates within a call but the filter itself has a practical URL-length
 * ceiling); this just runs one query for one already-built OR-chain.
 * @param {string} orChain - e.g. "_wmkf_request_value eq <id> or _wmkf_request_value eq <id>"
 */
export async function findForRollup(orChain) {
  const { records } = await DynamicsService.queryAllRecords(ENTITY_SET, {
    select: ROLLUP_SELECT,
    filter: `(${orChain}) and (wmkf_selected eq true or wmkf_declined eq true or wmkf_responsetype eq ${RESPONSE_TYPE_MAP.declined}) and ${notExcludedFilter()}`,
  });
  return records;
}

/**
 * Cross-request review history for a SET of people, batched.
 *
 * Returns, per potential-reviewer id, how many reviews that person has SUBMITTED
 * and the most recent submission date. "Completed a review" here = the reviewer's
 * review was RECEIVED (`wmkf_reviewreceivedat` is set) — NOT the PD's closeout
 * stamp (`wmkf_completedat`), which lags and is staff-side; received-at is the
 * reviewer's own act and the right signal for "how often / last reviewed for us"
 * (S308 review-history). Filtered to received-only rows to keep the payload slim;
 * paginated via queryAllRecords so a prolific reviewer's history isn't capped at 100.
 *
 * @param {string[]} potentialReviewerIds
 * @returns {Promise<Object<string,{reviewCount:number,lastReviewAt:string|null}>>}
 */
export async function aggregateReviewHistory(potentialReviewerIds) {
  const ids = [...new Set((potentialReviewerIds || []).filter(isGuid))];
  if (!ids.length) return {};
  const out = {};
  const CHUNK = 25;
  for (const chunk of chunked(ids, CHUNK)) {
    const orChain = chunk.map((id) => `_wmkf_potentialreviewer_value eq ${id}`).join(' or ');
    const { records } = await DynamicsService.queryAllRecords(ENTITY_SET, {
      select: '_wmkf_potentialreviewer_value,wmkf_reviewreceivedat',
      filter: `wmkf_reviewreceivedat ne null and (${orChain})`,
    });
    for (const r of records || []) {
      const pid = r._wmkf_potentialreviewer_value;
      if (!pid) continue;
      const at = r.wmkf_reviewreceivedat || null;
      const cur = out[pid] || { reviewCount: 0, lastReviewAt: null };
      cur.reviewCount += 1;
      if (at && (!cur.lastReviewAt || at > cur.lastReviewAt)) cur.lastReviewAt = at;
      out[pid] = cur;
    }
  }
  return out;
}

/**
 * Re-parent a suggestion row from the loser person to the keeper (merge step 4,
 * non-colliding rows). `ifMatch` (the row's ETag) fails the PATCH closed with 412
 * if the row changed since planning — so a concurrent accept isn't clobbered.
 */
export async function repointToPotentialReviewer(suggestionId, keeperId, { actingUserSystemId, ifMatch } = {}) {
  if (!isGuid(suggestionId)) throw new Error('reviewer-suggestion.repointToPotentialReviewer: suggestionId must be a GUID');
  if (!isGuid(keeperId)) throw new Error('reviewer-suggestion.repointToPotentialReviewer: keeperId must be a GUID');
  await DynamicsService.updateRecord(
    ENTITY_SET,
    suggestionId,
    { 'wmkf_PotentialReviewer@odata.bind': `/wmkf_potentialreviewerses(${keeperId})` },
    { actingUserSystemId, ifMatch },
  );
}

/**
 * Hard-delete an UN-ENGAGED colliding loser row (merge step 4) to free the
 * (person,request) key — softDelete won't, it leaves the FKs in place. `ifMatch`
 * fails closed with 412 if the row became engaged after the plan-phase read.
 */
export async function hardDeleteById(suggestionId, { actingUserSystemId, ifMatch } = {}) {
  if (!isGuid(suggestionId)) throw new Error('reviewer-suggestion.hardDeleteById: suggestionId must be a GUID');
  await DynamicsService.deleteRecord(ENTITY_SET, suggestionId, { actingUserSystemId, ifMatch });
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
    wmkf_programarea: normalizeSuggestionProgramArea(programArea),
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
    await patchUpsertWinner(existing, incoming, { actingUserSystemId });
    return { id: existing.wmkf_appreviewersuggestionid, created: false };
  }

  if (!incoming.wmkf_suggestionlabel) {
    incoming.wmkf_suggestionlabel = `Suggestion ${new Date().toISOString().slice(0, 10)}`;
  }
  incoming['wmkf_PotentialReviewer@odata.bind'] = `/wmkf_potentialreviewerses(${potentialReviewerId})`;
  incoming['wmkf_Request@odata.bind'] = `/akoya_requests(${requestId})`;

  try {
    const created = await DynamicsService.createRecord(ENTITY_SET, incoming, { actingUserSystemId });
    return { id: created.wmkf_appreviewersuggestionid, created: true };
  } catch (err) {
    const isConflict = (err?.status === 412 || err?.status === 409)
      && /duplicate|already exists|matching key values|alternate key|Entity Key|0x80060892/i.test(err?.message || '');
    if (!isConflict) throw err;

    const winner = await findByPotentialReviewerAndRequest(potentialReviewerId, requestId);
    if (!winner) throw err;
    if (isExcluded(winner) && incoming.wmkf_applicantdisposition !== APPLICANT_DISPOSITION_EXCLUDED) {
      return { id: winner.wmkf_appreviewersuggestionid, created: false, skippedExcluded: true };
    }
    await patchUpsertWinner(winner, incoming, { actingUserSystemId });
    return { id: winner.wmkf_appreviewersuggestionid, created: false };
  }
}

/**
 * Existing-row half of upsert. Any write that would select the row is bound to
 * the exact engagement read that authorised it, so save-candidates cannot race
 * an invite/decline or reselect a row that is already in the lifecycle. Restore
 * remains the only API allowed to reset and reselect handled engagement.
 */
async function patchUpsertWinner(existing, incoming, { actingUserSystemId } = {}) {
  const id = existing?.wmkf_appreviewersuggestionid;
  if (incoming.wmkf_selected === true) {
    const engagement = reviewerEngagementProjection(existing);
    if (engagement.handled) {
      throw adapterError('Reviewer engagement already exists for this request.', {
        code: 'reviewer_engagement_changed',
        status: 409,
        details: { stage: engagement.stage },
      });
    }
    if (!existing?._etag) {
      throw adapterError('Reviewer selection requires a current suggestion ETag.', {
        code: 'suggestion_etag_missing',
        status: 409,
      });
    }
    try {
      await DynamicsService.updateRecord(
        ENTITY_SET,
        id,
        incoming,
        { actingUserSystemId, ifMatch: existing._etag },
      );
      return;
    } catch (err) {
      if (err?.status !== 412) throw err;
      throw adapterError('Reviewer engagement changed before selection completed.', {
        code: 'reviewer_engagement_changed',
        status: 409,
      });
    }
  }

  await DynamicsService.updateRecord(ENTITY_SET, id, incoming, { actingUserSystemId });
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
 * Dismiss one already-resolved legacy prose referral. Current structured
 * referrals are deliberately rejected: their completion is derived from the
 * durable referred-candidate row created by the normal manual-add path.
 *
 * The legacy text remains inside the referral memo after a compact version
 * marker. This avoids polluting `wmkf_sources`, whose consumers treat every
 * token as sourcing/provenance data.
 */
export async function dismissLegacyDeclineReferral({
  suggestionId,
  requestId,
}, { actingUserSystemId } = {}) {
  if (!isGuid(suggestionId) || !isGuid(requestId)) {
    throw adapterError('Legacy decline referral dismissal requires valid suggestion and request ids.', {
      code: 'invalid_decline_referral_target',
      status: 400,
    });
  }

  const readAndPatch = async () => {
    const row = await DynamicsService.getRecord(ENTITY_SET, suggestionId, {
      select: '_wmkf_request_value,wmkf_declined,wmkf_declinereferral',
    }).catch((error) => {
      if (error?.status === 404) {
        throw adapterError('Decline referral no longer exists.', {
          code: 'decline_referral_not_found',
          status: 404,
        });
      }
      throw error;
    });

    if (String(row?._wmkf_request_value || '').toLowerCase() !== requestId.toLowerCase()) {
      throw adapterError('Decline referral does not belong to this request.', {
        code: 'decline_referral_request_mismatch',
        status: 409,
      });
    }
    if (row.wmkf_declined !== true) {
      throw adapterError('Decline referral is no longer actionable.', {
        code: 'decline_referral_not_actionable',
        status: 409,
      });
    }

    const resolved = resolveLegacyDeclineReferral(row.wmkf_declinereferral);
    if (!resolved.ok) {
      throw adapterError('Only a legacy prose referral can be dismissed.', {
        code: resolved.reason,
        status: 409,
      });
    }
    if (resolved.alreadyResolved) {
      return { dismissed: true, alreadyDismissed: true };
    }
    if (!row._etag) {
      throw adapterError('Legacy decline referral dismissal requires a current ETag.', {
        code: 'decline_referral_etag_missing',
        status: 409,
      });
    }
    await DynamicsService.updateRecord(
      ENTITY_SET,
      suggestionId,
      { wmkf_declinereferral: resolved.storedValue },
      { actingUserSystemId, ifMatch: row._etag },
    );
    return { dismissed: true, alreadyDismissed: false };
  };

  try {
    return await readAndPatch();
  } catch (error) {
    if (error?.status !== 412) throw error;
    return readAndPatch();
  }
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
}, { actingUserSystemId, requireEtag = false } = {}) {
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
    if (!existing.wmkf_programarea && programArea) payload.wmkf_programarea = normalizeSuggestionProgramArea(programArea);
    if (!existing.wmkf_matchreason && matchReason) payload.wmkf_matchreason = matchReason;
    if (requireEtag && !existing._etag) {
      throw adapterError('Applicant provenance update requires a current suggestion ETag.', {
        code: 'suggestion_etag_missing',
        status: 409,
      });
    }
    await DynamicsService.updateRecord(
      ENTITY_SET,
      existing.wmkf_appreviewersuggestionid,
      payload,
      { actingUserSystemId, ...(existing._etag ? { ifMatch: existing._etag } : {}) },
    );
    return {
      id: existing.wmkf_appreviewersuggestionid,
      created: false,
      selected: existing.wmkf_selected !== false,
      engagement: reviewerEngagementProjection(existing),
    };
  }

  const incoming = pruneEmpty({
    wmkf_suggestionlabel: suggestionLabel || `Applicant recommendation ${new Date().toISOString().slice(0, 10)}`,
    wmkf_grantcyclecode: grantCycleCode,
    wmkf_programarea: normalizeSuggestionProgramArea(programArea),
    wmkf_matchreason: matchReason,
    wmkf_sources: mergedSources,
  });
  incoming.wmkf_selected = false;
  incoming.wmkf_applicantdisposition = APPLICANT_DISPOSITION_MAP.recommended;
  incoming['wmkf_PotentialReviewer@odata.bind'] = `/wmkf_potentialreviewerses(${potentialReviewerId})`;
  incoming['wmkf_Request@odata.bind'] = `/akoya_requests(${requestId})`;

  try {
    const created = await DynamicsService.createRecord(ENTITY_SET, incoming, { actingUserSystemId });
    return {
      id: created.wmkf_appreviewersuggestionid,
      created: true,
      selected: false,
      engagement: reviewerEngagementProjection({ selected: false }),
    };
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
    if (requireEtag && !now._etag) {
      throw adapterError('Applicant provenance update requires a current suggestion ETag.', {
        code: 'suggestion_etag_missing',
        status: 409,
      });
    }
    await DynamicsService.updateRecord(ENTITY_SET, now.wmkf_appreviewersuggestionid, {
      wmkf_sources: reMerged,
      wmkf_applicantdisposition: APPLICANT_DISPOSITION_MAP.recommended,
    }, { actingUserSystemId, ...(now._etag ? { ifMatch: now._etag } : {}) });
    return {
      id: now.wmkf_appreviewersuggestionid,
      created: false,
      selected: now.wmkf_selected !== false,
      engagement: reviewerEngagementProjection(now),
    };
  }
}

/**
 * Engagement state that must be cleared when an inactive candidate is re-selected
 * (manual re-add or Removed-list Restore). Applied ONLY to rows with
 * wmkf_selected===false; re-adding an already-active candidate must NOT wipe a
 * legitimate live invitation or submitted-review state. Revoking the old token
 * closes the gap between restore and the next invitation; minting the new token
 * clears that flag.
 */
const ENGAGEMENT_STAMP_RESET_ENTRIES = Object.freeze([
  ['wmkf_accepted', 'accepted', false],
  ['wmkf_declined', 'declined', false],
  ['wmkf_responsetype', 'responseType', null],
  ['wmkf_reviewstatus', 'reviewStatus', null],
  ['wmkf_externaltokenrevoked', 'externalTokenRevoked', true],
  ['wmkf_invited', 'invited', false],
  ['wmkf_emailsentat', 'emailSentAt', null],
  ['wmkf_respondremindersentat', 'respondReminderSentAt', null],
  ['wmkf_remindersentat', 'reminderSentAt', null],
  ['wmkf_remindercount', 'reminderCount', null],
  ['wmkf_materialssentat', 'materialsSentAt', null],
  ['wmkf_reviewreceivedat', 'reviewReceivedAt', null],
  ['wmkf_responsereceivedat', 'responseReceivedAt', null],
  ['wmkf_thankyousentat', 'thankYouSentAt', null],
  ['wmkf_completedat', 'completedAt', null],
  ['wmkf_withdrawnsufficientat', 'withdrawnSufficientAt', null],
  ['wmkf_proposalfirstaccessed', 'proposalFirstAccessed', null],
]);

const ENGAGEMENT_STAMP_RESET = Object.freeze(Object.fromEntries(
  ENGAGEMENT_STAMP_RESET_ENTRIES.map(([rawField, , value]) => [rawField, value]),
));

function buildStaffManualReselectPayload(row, {
  tokens,
  suggestionLabel,
  grantCycleCode,
  programArea,
  matchReason,
  includeFillIfEmpty,
  resetEngagementStamps,
}) {
  const mergedSources = Array.from(new Set([...splitSources(row?.wmkf_sources), ...tokens])).join(',');
  const payload = {
    wmkf_sources: mergedSources,
    wmkf_selected: true,
    ...(resetEngagementStamps ? ENGAGEMENT_STAMP_RESET : {}),
  };
  if (includeFillIfEmpty) {
    if (!row.wmkf_suggestionlabel && suggestionLabel) payload.wmkf_suggestionlabel = suggestionLabel;
    if (!row.wmkf_grantcyclecode && grantCycleCode) payload.wmkf_grantcyclecode = grantCycleCode;
    if (!row.wmkf_programarea && programArea) payload.wmkf_programarea = normalizeSuggestionProgramArea(programArea);
    if (!row.wmkf_matchreason && matchReason) payload.wmkf_matchreason = matchReason;
  }
  return payload;
}

async function patchStaffManualReselect(row, {
  potentialReviewerId,
  requestId,
  tokens,
  suggestionLabel,
  grantCycleCode,
  programArea,
  matchReason,
  includeFillIfEmpty,
  actingUserSystemId,
}) {
  const applyPatch = async (current) => {
    const engagement = reviewerEngagementProjection(current);
    if (engagement.handled) {
      const mergedSources = Array.from(new Set([
        ...splitSources(current?.wmkf_sources),
        ...tokens,
      ])).join(',');
      await DynamicsService.updateRecord(
        ENTITY_SET,
        current.wmkf_appreviewersuggestionid,
        { wmkf_sources: mergedSources },
        { actingUserSystemId, ifMatch: current._etag },
      );
      const outcome = engagement.declined && current.wmkf_selected === false
        ? 'restore_required'
        : 'already_handled';
      return {
        id: current.wmkf_appreviewersuggestionid,
        created: false,
        selected: current.wmkf_selected === true,
        outcome,
        stage: engagement.stage,
      };
    }

    await DynamicsService.updateRecord(
      ENTITY_SET,
      current.wmkf_appreviewersuggestionid,
      buildStaffManualReselectPayload(current, {
        tokens,
        suggestionLabel,
        grantCycleCode,
        programArea,
        matchReason,
        includeFillIfEmpty,
        resetEngagementStamps: current.wmkf_selected === false,
      }),
      { actingUserSystemId, ifMatch: current._etag },
    );
    return { id: current.wmkf_appreviewersuggestionid, created: false, selected: true };
  };

  try {
    return await applyPatch(row);
  } catch (err) {
    if (err?.status !== 412) throw err;
    const latest = await findByPotentialReviewerAndRequest(potentialReviewerId, requestId);
    if (!latest) throw err;
    if (isExcluded(latest)) {
      return { id: latest.wmkf_appreviewersuggestionid, created: false, selected: false, skippedExcluded: true };
    }
    if (hasApplicantProvenance(latest)) {
      return patchApplicantProvenanceOnly(latest, {
        potentialReviewerId,
        requestId,
        tokens,
        actingUserSystemId,
      });
    }
    return await applyPatch(latest);
  }
}

async function patchApplicantProvenanceOnly(row, {
  potentialReviewerId,
  requestId,
  tokens,
  actingUserSystemId,
}) {
  const applyPatch = async (current) => {
    const mergedSources = Array.from(new Set([
      ...splitSources(current?.wmkf_sources),
      ...tokens,
    ])).join(',');
    await DynamicsService.updateRecord(
      ENTITY_SET,
      current.wmkf_appreviewersuggestionid,
      { wmkf_sources: mergedSources },
      { actingUserSystemId, ifMatch: current._etag },
    );
    const engagement = reviewerEngagementProjection(current);
    const outcome = engagement.declined && current.wmkf_selected === false
      ? 'restore_required'
      : engagement.handled
        ? 'already_handled'
        : 'promotion_required';
    return {
      id: current.wmkf_appreviewersuggestionid,
      created: false,
      selected: false,
      outcome,
      stage: engagement.stage || 'recommended',
    };
  };

  try {
    return await applyPatch(row);
  } catch (err) {
    if (err?.status !== 412) throw err;
    const latest = await findByPotentialReviewerAndRequest(potentialReviewerId, requestId);
    if (!latest) throw err;
    if (isExcluded(latest)) {
      return { id: latest.wmkf_appreviewersuggestionid, created: false, selected: false, skippedExcluded: true };
    }
    return applyPatch(latest);
  }
}

/**
 * Idempotently materialize an explicitly staff-added reviewer for one request.
 *
 * This is a direct staff action, unlike lazy applicant-slot ingestion, so an
 * existing non-excluded, unengaged row is re-selected if staff adds it again.
 * A handled row only unions provenance and returns a typed remedy; explicit
 * Restore remains the sole authority for clearing lifecycle stamps. Existing
 * sources are unioned with the caller's `sources` tokens (default `['staff_manual']`);
 * a referral (S249) passes `['staff_manual', 'referred']` so the `referred`
 * provenance kind survives reload (without it, my-candidates would rebuild the row
 * with only `staff_manual` and the referral would silently degrade). Applicant
 * recommendation state is preserved when present so a row can carry both origins.
 *
 * @returns {Promise<{ id: string, created: boolean, selected: boolean, skippedExcluded?: boolean, outcome?: string, stage?: string }>}
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
    if (hasApplicantProvenance(existing)) {
      return patchApplicantProvenanceOnly(existing, {
        potentialReviewerId,
        requestId,
        tokens,
        actingUserSystemId,
      });
    }
    return await patchStaffManualReselect(existing, {
      potentialReviewerId,
      requestId,
      tokens,
      suggestionLabel,
      grantCycleCode,
      programArea,
      matchReason,
      includeFillIfEmpty: true,
      actingUserSystemId,
    });
  }

  const incoming = pruneEmpty({
    wmkf_suggestionlabel: suggestionLabel || `Manual reviewer ${new Date().toISOString().slice(0, 10)}`,
    wmkf_grantcyclecode: grantCycleCode,
    wmkf_programarea: normalizeSuggestionProgramArea(programArea),
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
    if (hasApplicantProvenance(now)) {
      return patchApplicantProvenanceOnly(now, {
        potentialReviewerId,
        requestId,
        tokens,
        actingUserSystemId,
      });
    }
    return await patchStaffManualReselect(now, {
      potentialReviewerId,
      requestId,
      tokens,
      includeFillIfEmpty: false,
      actingUserSystemId,
    });
  }
}

/**
 * Final applicant-promotion compare-and-set. A fresh engagement read is checked
 * immediately before the ETag-bound PATCH so a concurrent decline/invite wins.
 * Restore deliberately does not use this function; it owns the explicit reset.
 */
export async function selectIfUnengaged(id, { actingUserSystemId } = {}) {
  const current = await findById(id);
  const engagement = reviewerEngagementProjection(current);
  if (engagement.handled) {
    throw adapterError('Reviewer engagement changed before promotion completed.', {
      code: 'reviewer_engagement_changed',
      status: 409,
      details: { stage: engagement.stage },
    });
  }
  if (!current?._etag) {
    throw adapterError('Reviewer promotion requires a current suggestion ETag.', {
      code: 'suggestion_etag_missing',
      status: 409,
    });
  }
  try {
    await DynamicsService.updateRecord(
      ENTITY_SET,
      id,
      { wmkf_selected: true },
      { actingUserSystemId, ifMatch: current._etag },
    );
  } catch (err) {
    if (err?.status !== 412) throw err;
    throw adapterError('Reviewer engagement changed before promotion completed.', {
      code: 'reviewer_engagement_changed',
      status: 409,
    });
  }
  return { selected: true };
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
  const row = await DynamicsService.getRecord(ENTITY_SET, id, { select: odata.select(FIELD_SELECT) });
  if (isExcluded(row)) {
    throw new Error(`reviewer-suggestion.findById: refusing to act on an applicant-excluded suggestion (${id})`);
  }
  return row;
}

/**
 * Minimal row for the staff download-review route: just enough to locate the
 * SharePoint file (folder + primary filename). Deliberately NOT findById —
 * no excluded-row throw, so staff can still retrieve a file even if the
 * engagement row was later marked applicant-excluded. Byte-mirrors
 * download-review.js's inline getRecord call; no bypassDynamicsRestrictions
 * here, that wrapper stays at the route (Stage 7 removes it later).
 */
export async function getForDownload(suggestionId) {
  return DynamicsService.getRecord(ENTITY_SET, suggestionId, {
    select: 'wmkf_appreviewersuggestionid,wmkf_reviewsharepointfolder,wmkf_reviewfilename',
  });
}

/**
 * Minimal row for the staff regenerate-token route: just enough to resolve
 * the linked request and check the applicant-excluded chokepoint before a
 * direct mintAndStore call. Byte-mirrors regenerate-token.js's inline
 * getRecord call; no bypassDynamicsRestrictions here, that wrapper stays at
 * the route (Stage 7 removes it later).
 */
export async function getForTokenRegeneration(suggestionId) {
  return DynamicsService.getRecord(ENTITY_SET, suggestionId, {
    select: 'wmkf_appreviewersuggestionid,_wmkf_request_value,wmkf_applicantdisposition',
  });
}

// Fields the reviewer-acceptance drain worker (lib/services/reviewer-acceptance-drain.js)
// re-reads to confirm the accept committed before running the post-accept pipeline
// (honorarium onboarding, identity capture, confirmation email, quota).
const ACCEPTANCE_DRAIN_SELECT = [
  'wmkf_appreviewersuggestionid',
  'wmkf_accepted',
  'wmkf_declined',
  'wmkf_responsetype',
  'wmkf_reviewstatus',
  'wmkf_reviewreceivedat',
  'wmkf_responsereceivedat',
  'wmkf_honorariumoptout',
  'wmkf_reviewerfirstname',
  'wmkf_reviewerlastname',
  'wmkf_reviewernickname',
  'wmkf_reviewertitle',
  'wmkf_revieweraffiliation',
  'wmkf_revieweremail',
  'wmkf_reviewerorcid',
  '_wmkf_honorariumrequest_value',
  '_wmkf_request_value',
  '_wmkf_potentialreviewer_value',
].join(',');

/** Byte-mirrors reviewer-acceptance-drain.js's readCurrentSuggestion inline getRecord call. */
export async function getForAcceptanceDrain(suggestionId) {
  return DynamicsService.getRecord(ENTITY_SET, suggestionId, {
    select: ACCEPTANCE_DRAIN_SELECT,
  });
}

/**
 * Suggestion row + expanded request + expanded reviewer, for the external
 * (token-authenticated) verification chokepoint in
 * lib/external/verify-suggestion-token.js. `select`/`expand` are supplied by
 * the caller (its SUGGESTION_SELECT/REQUEST_SELECT/REVIEWER_SELECT constants)
 * since that flow's field needs are specific to the reviewer landing page,
 * not a general suggestion-row concern. Byte-mirrors the caller's inline
 * getRecord call; errors (incl. 404) propagate unchanged for the caller's
 * own try/catch. No bypassDynamicsRestrictions here — that wrapper stays at
 * the call site (Stage 7 removes it later).
 */
export async function getForExternalVerification(suggestionId, { select, expand } = {}) {
  return DynamicsService.getRecord(ENTITY_SET, suggestionId, { select, expand });
}

/**
 * Minimal row read whose only purpose is to pick up a FRESH etag for a
 * suggestion whose caller doesn't already have one (e.g. after a same-request
 * write bumped the row-version). Byte-mirrors the external context route's
 * post-first-access-stamp re-read; no bypassDynamicsRestrictions here — that
 * wrapper stays at the call site (Stage 7 removes it later).
 */
export async function getForEtagRefresh(suggestionId) {
  return DynamicsService.getRecord(ENTITY_SET, suggestionId, {
    select: 'wmkf_appreviewersuggestionid',
  });
}

/**
 * Generic single-record fetch with a caller-supplied `$select` — a raw
 * passthrough (byte-mirror) for callers whose field list is genuinely
 * bespoke and does not recur elsewhere. Byte-mirror of
 * reviewer-manual-reminder.js's inline
 * `DynamicsService.getRecord('wmkf_appreviewersuggestions', suggestionId, { select })`.
 */
export async function getByIdWithSelect(suggestionId, select) {
  return DynamicsService.getRecord(ENTITY_SET, suggestionId, { select });
}

/** Best-effort first-visit stamp on the external landing page. Byte-mirrors the external context route's inline updateRecord call — no options object (no acting-user attribution on this public, token-authenticated path). */
export async function stampProposalFirstAccessed(suggestionId) {
  return DynamicsService.updateRecord(ENTITY_SET, suggestionId, {
    wmkf_proposalfirstaccessed: new Date().toISOString(),
  });
}

/**
 * Re-read used ONLY to obtain a fresh parent If-Match etag when the verified
 * suggestion didn't carry one, AND to re-check finality in the same read (a
 * racing submit that committed between verify and this re-read must not hand
 * back a fresh, non-stale etag that lets a second write through). Byte-mirrors
 * the external submit route's inline getRecord call.
 */
export async function getForSubmitFinalityCheck(suggestionId) {
  return DynamicsService.getRecord(ENTITY_SET, suggestionId, {
    select: 'wmkf_appreviewersuggestionid,wmkf_accepted,wmkf_declined,wmkf_reviewreceivedat,wmkf_reviewstatus',
  });
}

/**
 * Generic outcome PATCH for the review-received write (no rating-snapshot
 * rows to accompany it — the ratingRows.length===0 branch, or the
 * single-record write in review-upload.js). Byte-mirrors the callers' inline
 * updateRecord call: forwards whatever fields the caller built (rating-form
 * values, sharepoint folder/filename, receivedat, uploaded-by-staff flag)
 * unchanged. Not a semantic write like updateLifecycle — no excluded-row
 * guard, no field mapping — this is a passthrough for a call site the
 * changeset-conversion wave must not behaviorally alter.
 */
export async function patchReviewReceipt(suggestionId, payload, opts = {}) {
  return DynamicsService.updateRecord(ENTITY_SET, suggestionId, payload, opts);
}

/**
 * Generic PATCH passthrough for a caller-built suggestion-row field set
 * outside the review-receipt flow (patchReviewReceipt's original scope) — e.g.
 * the generate-emails mark-as-sent stamp, the reminder-sweep claim write. Same
 * underlying transport call as patchReviewReceipt (options forwarded
 * unchanged); kept as a distinctly named export so call sites read their
 * actual intent rather than borrowing a review-receipt-scoped name.
 */
export const patchFields = patchReviewReceipt;

/**
 * Business-filter paginated-scan passthrough — mirrors
 * DynamicsService.queryAllRecords arg-for-arg, exactly like grant-request.js's
 * queryAllRequests. Serves the several bespoke-filter queryAllRecords call
 * sites across the review-flow cluster (my-proposals reviewer-count rollup,
 * reviewer-reminder-sweep, reviewer-suggestion-sweep) whose filters don't
 * consolidate into a named method.
 */
export async function queryAllSuggestions(options) {
  return DynamicsService.queryAllRecords(ENTITY_SET, options);
}

/**
 * Global participating-population scan for review-synthesis automation.
 *
 * This is intentionally narrower than queryAllSuggestions: only selected,
 * non-excluded rows that have entered the invitation/acceptance lifecycle.
 * The caller must fail closed when the returned `capped` flag is true.
 */
export async function findReviewSynthesisParticipants() {
  return DynamicsService.queryAllRecords(ENTITY_SET, {
    select: odata.select(FIELD_SELECT),
    filter: `wmkf_selected eq true and (wmkf_invited eq true or wmkf_accepted eq true) and ${notExcludedFilter()}`,
    orderby: 'createdon asc',
  });
}

export async function findByRequest(requestId, {
  selectedOnly = true,
  requireComplete = false,
} = {}) {
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
  const query = {
    select: odata.select(FIELD_SELECT),
    filter,
    orderby: 'createdon desc',
    top: 200,
  };
  if (requireComplete) {
    const { records, capped } = await DynamicsService.queryAllRecords(ENTITY_SET, query);
    if (capped) {
      throw new Error(
        'reviewer-suggestion.findByRequest: complete read hit the Dataverse 5000-row cap',
      );
    }
    return records;
  }
  const { records } = await DynamicsService.queryRecords(ENTITY_SET, query);
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

/**
 * Soft-deleted ("removed via the X") candidates for a request — the rows the
 * Candidates panel's "Removed" section restores from.
 *
 * Scope is deliberately `wmkf_selected=false` and either:
 *  - `wmkf_applicantdisposition=null` (staff/Claude/manual rows removed by staff), or
 *  - `wmkf_declined=true` (any previously-active reviewer who declined, including
 *    an applicant-recommended reviewer).
 *  - `selected=false` is the soft-delete marker (softDelete flips it).
 *  - `disposition=null` keeps this to staff/Claude-discovered + manually-added
 *    candidates, which are ALWAYS created `selected=true` (upsert/manual paths) —
 *    so the only way they reach `selected=false` is a softDelete. That makes this
 *    an unambiguous "was curated, then removed" set.
 *  - It excludes applicant-recommended rows (disposition=recommended), which start
 *    life `selected=false` BEFORE promotion and remain recoverable from the Find
 *    tab's applicant-recommended section — listing them here would double-surface
 *    and conflate "never promoted" with "removed". It also excludes applicant-
 *    excluded rows (the notExcluded concern) for free. A recommended row that was
 *    never promoted remains `declined=false`, so it stays solely in the Find tab.
 *
 * `modifiedon` is appended to the select so the UI can show when each was removed
 * and order most-recent-first.
 */
export async function findRemovedByRequest(requestId) {
  if (!requestId) return [];
  if (!isGuid(requestId)) {
    throw new Error('reviewer-suggestion.findRemovedByRequest: requestId must be a GUID');
  }
  const { records } = await DynamicsService.queryRecords(ENTITY_SET, {
    select: `${odata.select(FIELD_SELECT)},modifiedon`,
    filter: `_wmkf_request_value eq ${requestId} and wmkf_selected eq false and `
      + `(wmkf_applicantdisposition eq null or wmkf_declined eq true) and ${notExcludedFilter()}`,
    orderby: 'modifiedon desc',
    top: 100,
  });
  return records;
}

export async function findApplicantRecommendedByRequest(requestId) {
  if (!requestId) return [];
  if (!isGuid(requestId)) {
    throw new Error('reviewer-suggestion.findApplicantRecommendedByRequest: requestId must be a GUID');
  }
  const { records } = await DynamicsService.queryRecords(ENTITY_SET, {
    select: odata.select(FIELD_SELECT),
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
  const { records: requests } = await DynamicsService.queryAllRecords(entitySet('akoya_requests'), {
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
  for (const chunk of chunked(reqIds, CHUNK)) {
    const orChain = chunk.map((id) => `_wmkf_request_value eq ${id}`).join(' or ');
    const baseFilter = selectedOnly
      ? `(${orChain}) and wmkf_selected eq true and ${notExcludedFilter()}`
      : `(${orChain}) and ${notExcludedFilter()}`;
    const { records } = await DynamicsService.queryRecords(ENTITY_SET, {
      select: odata.select(FIELD_SELECT),
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

  const { records: requests } = await DynamicsService.queryAllRecords(entitySet('akoya_requests'), {
    select: [
      'akoya_requestid',
      'akoya_requestnum',
      'akoya_title',
      'wmkf_meetingdate',
      'wmkf_reviewduedate',
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
      reviewDeadline: r.wmkf_reviewduedate || null,
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
  for (const chunk of chunked(reqIds, CHUNK)) {
    const orChain = chunk.map((id) => `_wmkf_request_value eq ${id}`).join(' or ');
    const { records } = await DynamicsService.queryRecords(ENTITY_SET, {
      select: odata.select(FIELD_SELECT),
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
    // Lets the terminal transition revoke the magic link in the SAME atomic,
    // ETag-guarded write that ends the engagement, rather than a second call
    // that could fail independently and leave the portal open.
    externalTokenRevoked: 'wmkf_externaltokenrevoked',
    proposalFirstAccessed: 'wmkf_proposalfirstaccessed',
    applicantDisposition: 'wmkf_applicantdisposition',
  };
  const payload = {};
  for (const [k, v] of Object.entries(updates || {})) {
    if (!(k in map) || v === undefined) continue;
    if (k === 'responseType') payload[map[k]] = mapPicklist(RESPONSE_TYPE_MAP, v, 'responseType');
    else if (k === 'reviewStatus') payload[map[k]] = mapPicklist(REVIEW_STATUS_MAP, v, 'reviewStatus');
    else if (k === 'applicantDisposition') payload[map[k]] = mapPicklist(APPLICANT_DISPOSITION_MAP, v, 'applicantDisposition');
    else if (k === 'programArea') payload[map[k]] = normalizeSuggestionProgramArea(v);
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
  //
  // (3) Refuse to move a row OUT of a terminal status (withdrew/released).
  //     Terminality was a UI-only convention until S369: StatusDropdown hides
  //     itself on terminal rows, but the generic reviewers PATCH only rejected a
  //     terminal *target* and never inspected the *source*, so
  //     `{reviewStatus:'complete'}` on a withdrawn row still reached the (2)
  //     branch above and stamped wmkf_reviewreceivedat — re-creating the exact
  //     aggregateReviewHistory false positive the terminal status exists to
  //     eliminate. The batch PATCH path made this worse: it applies one status
  //     to N rows with no per-row inspection at all. Enforced HERE, not in the
  //     route, so every caller (single, batch, service, future) inherits it.
  //     Non-status writes (e.g. notes) on a terminal row remain allowed.
  const existing = await DynamicsService.getRecord(ENTITY_SET, id, {
    select: 'wmkf_applicantdisposition,wmkf_completedat,wmkf_reviewreceivedat,wmkf_reviewstatus',
  });
  if (isExcluded(existing)) {
    throw new Error(`reviewer-suggestion.updateLifecycle: refusing to mutate an applicant-excluded suggestion (${id})`);
  }
  if (TERMINAL_REVIEW_STATUS_VALUE_SET.has(existing?.wmkf_reviewstatus)
      && payload.wmkf_reviewstatus !== undefined
      && payload.wmkf_reviewstatus !== existing.wmkf_reviewstatus) {
    throw new Error(
      `reviewer-suggestion.updateLifecycle: refusing to move suggestion ${id} out of a terminal review status `
      + `(${existing.wmkf_reviewstatus} → ${payload.wmkf_reviewstatus}); terminal engagements are not reopenable`,
    );
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

  // Optimistic lock. A caller that read the row and needs the write to fail if it
  // changed underneath (e.g. the selective-decline route guarding against a reviewer
  // accepting between its pending-read and this write) passes the row's _etag, and
  // that stricter, older precondition always wins.
  //
  // S369: when the caller supplied NONE and this write changes the status, fall back
  // to the ETag from the guard read above. Without it the terminal check was a pure
  // TOCTOU — the generic single/batch reviewer PATCH supplies no ifMatch, so it could
  // read a non-terminal row, lose the race to a concurrent terminal transition, and
  // then unconditionally overwrite the freshly-terminal status (Codex adversarial
  // finding, confirmed). Binding the PATCH to the read that authorised it makes the
  // guard atomic instead of advisory.
  const statusChanging = payload.wmkf_reviewstatus !== undefined;
  const effectiveIfMatch = ifMatch || (statusChanging ? existing?._etag : undefined);

  await DynamicsService.updateRecord(ENTITY_SET, id, payload, {
    actingUserSystemId,
    ...(effectiveIfMatch ? { ifMatch: effectiveIfMatch } : {}),
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
 * @param {string} [body.responseReceivedAt] - optional server-generated timestamp
 *   shared with durable follow-up jobs; defaults to this helper's current clock.
 * @param {{reasonPicklist?: string, reasonText?: string, referral?: string}} [body.decline]
 * @param {string} [opts.ifMatch] - the suggestion row's _etag from page load,
 *   for optimistic locking. 412 on conflict.
 */
export async function applyStage2aResponse(
  id,
  body,
  { ifMatch, actingUserSystemId, deleteHonorariumRequestId = null } = {},
) {
  if (!id) throw new Error('applyStage2aResponse: id required');
  if (!body || (body.action !== 'accept' && body.action !== 'decline')) {
    throw new Error(`applyStage2aResponse: action must be 'accept' or 'decline', got '${body?.action}'`);
  }

  const payload = {};
  const now = new Date().toISOString();
  const responseReceivedAt = body.responseReceivedAt || now;

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
    // A reviewer may change a pre-materials decline back to accept using the
    // same secure link. Decline removes the row from the active proposal pool,
    // so accept must atomically restore it.
    payload.wmkf_selected = true;
    payload.wmkf_accepted = true;
    payload.wmkf_declined = false;
    payload.wmkf_responsetype = RESPONSE_TYPE_MAP.accepted;
    payload.wmkf_responsereceivedat = responseReceivedAt;
    // Clear any prior decline state if transitioning from declined → accepted.
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
    payload.wmkf_selected = false;
    payload.wmkf_responsetype = RESPONSE_TYPE_MAP.declined;
    payload.wmkf_responsereceivedat = responseReceivedAt;
  }

  if (deleteHonorariumRequestId) {
    await runChangeset([
      {
        method: 'PATCH',
        entitySet: ENTITY_SET,
        key: id,
        body: payload,
        ifMatch,
      },
      {
        method: 'DELETE',
        entitySet: 'akoya_requests',
        key: deleteHonorariumRequestId,
      },
    ], { actingUserSystemId });
    return;
  }

  await DynamicsService.updateRecord(ENTITY_SET, id, payload, { ifMatch, actingUserSystemId });
}

/**
 * Staff-recorded post-accept withdrawal.
 *
 * This deliberately combines the response-state correction, terminal audit
 * status, portal revocation, and exact linked-honorarium deletion in one
 * ETag-guarded Dataverse changeset. When no honorarium is linked, the single
 * PATCH remains atomic on its own.
 */
export async function applyStaffReviewerWithdrawal(
  id,
  {
    ifMatch,
    actingUserSystemId,
    deleteHonorariumRequestId = null,
    responseReceivedAt,
  } = {},
) {
  if (!id) throw new Error('applyStaffReviewerWithdrawal: id required');
  if (!ifMatch) throw new Error('applyStaffReviewerWithdrawal: ifMatch required');

  const payload = {
    wmkf_selected: false,
    wmkf_accepted: false,
    wmkf_declined: true,
    wmkf_responsetype: RESPONSE_TYPE_MAP.declined,
    wmkf_responsereceivedat: responseReceivedAt || new Date().toISOString(),
    wmkf_declinereasonpicklist: DECLINE_REASON_MAP.other,
    wmkf_declinereason: 'Program Director recorded that the reviewer could not complete the assignment.',
    wmkf_declinereferral: null,
    wmkf_reviewstatus: REVIEW_STATUS_MAP.withdrew,
    wmkf_externaltokenrevoked: true,
  };

  if (deleteHonorariumRequestId) {
    await runChangeset([
      {
        method: 'PATCH',
        entitySet: ENTITY_SET,
        key: id,
        body: payload,
        ifMatch,
      },
      {
        method: 'DELETE',
        entitySet: 'akoya_requests',
        key: deleteHonorariumRequestId,
      },
    ], { actingUserSystemId });
    return;
  }

  await DynamicsService.updateRecord(
    ENTITY_SET,
    id,
    payload,
    { ifMatch, actingUserSystemId },
  );
}

/**
 * Race compensation for an acceptance worker that created an honorarium after
 * the reviewer withdrawal committed. The no-op state PATCH carries the fresh
 * ETag into the same changeset as the exact linked-request DELETE, so a
 * concurrent re-accept prevents the cleanup instead of deleting a now-valid
 * honorarium.
 */
export async function deleteLinkedHonorariumForDeclinedSuggestion(
  id,
  honorariumRequestId,
  { ifMatch, actingUserSystemId } = {},
) {
  if (!id) throw new Error('deleteLinkedHonorariumForDeclinedSuggestion: id required');
  if (!honorariumRequestId) {
    throw new Error('deleteLinkedHonorariumForDeclinedSuggestion: honorariumRequestId required');
  }
  await runChangeset([
    {
      method: 'PATCH',
      entitySet: ENTITY_SET,
      key: id,
      body: {
        wmkf_selected: false,
        wmkf_accepted: false,
        wmkf_declined: true,
        wmkf_responsetype: RESPONSE_TYPE_MAP.declined,
      },
      ifMatch,
    },
    {
      method: 'DELETE',
      entitySet: 'akoya_requests',
      key: honorariumRequestId,
    },
  ], { actingUserSystemId });
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
 * wmkf_selected=false and clearing engagement flags in the SAME PATCH. Clearing
 * wmkf_accepted here is quota-relevant: countAcceptedForRequest filters
 * wmkf_accepted eq true and ignores selected. When `alsoRevokeToken` is set, the
 * external magic-link revoke (wmkf_externaltokenrevoked=true) is folded into that
 * SAME PATCH so there is no partial-failure window. Invite/first-contact stamps
 * stay intact; removal is a withdrawal, not reset-to-never-contacted.
 * Harmless on a never-tokened row: it just sets bool/null fields. updateRecord
 * 404s (throws) if the row is missing, which the caller surfaces rather than
 * silently "removing" a nonexistent row.
 */
export async function softDelete(id, { actingUserSystemId, alsoRevokeToken = false } = {}) {
  if (!id) throw new Error('reviewer-suggestion.softDelete: id required');
  // S369: this writes wmkf_reviewstatus:null through updateRecord, bypassing
  // updateLifecycle's terminal-source guard entirely — so the ordinary
  // candidate-removal endpoint could erase a terminal engagement and reopen a
  // row the transition service had closed (Codex adversarial finding,
  // confirmed). Fail closed on a fresh read, and bind the write to that read's
  // ETag so a transition landing mid-flight loses to the precondition rather
  // than being silently overwritten.
  const existing = await DynamicsService.getRecord(ENTITY_SET, id, {
    select: 'wmkf_reviewstatus',
  });
  if (TERMINAL_REVIEW_STATUS_VALUE_SET.has(existing?.wmkf_reviewstatus)) {
    throw new Error(
      `reviewer-suggestion.softDelete: refusing to remove suggestion ${id} in a terminal review status `
      + `(${existing.wmkf_reviewstatus}); a closed engagement is durable history, not a candidate to un-pick`,
    );
  }
  const payload = {
    wmkf_selected: false,
    wmkf_accepted: false,
    wmkf_declined: false,
    wmkf_responsetype: null,
    wmkf_reviewstatus: null,
    wmkf_heldat: null,
  };
  if (alsoRevokeToken) payload.wmkf_externaltokenrevoked = true;
  await DynamicsService.updateRecord(ENTITY_SET, id, payload, {
    actingUserSystemId,
    ...(existing?._etag ? { ifMatch: existing._etag } : {}),
  });
}

/**
 * Re-select an inactive candidate so it returns to the request's candidate list
 * as a FRESH start. Covers both staff-removed rows and auto-archived declines.
 * Flips `wmkf_selected` back and clears stale engagement state
 * (ENGAGEMENT_STAMP_RESET) so the row reads as a new
 * engagement and can be invited again — a subsequent invitation mints a NEW live
 * token (it does NOT directly un-revoke the old link; setExternalToken clears the
 * revoke at mint time). Does not touch disposition.
 *
 * Scope-guarded to EXACTLY the rows findRemovedByRequest surfaces. A non-null
 * applicant disposition is restorable only when the row is actually declined;
 * a never-promoted recommendation cannot bypass the explicit promotion path.
 * Applicant-excluded rows always fail closed. A row that's already selected is
 * a harmless idempotent no-op.
 */
export async function restore(id, { actingUserSystemId } = {}) {
  if (!id) throw new Error('reviewer-suggestion.restore: id required');
  const row = await DynamicsService.getRecord(ENTITY_SET, id, {
    select: 'wmkf_selected,wmkf_applicantdisposition,wmkf_declined,wmkf_responsetype,wmkf_reviewstatus',
  });
  if (row.wmkf_selected !== false) return; // already in the pool — nothing to restore
  if (isExcluded(row)) {
    throw new Error(`reviewer-suggestion.restore: refusing to restore an applicant-excluded suggestion (${id})`);
  }
  const isDeclined = row.wmkf_declined === true
    || row.wmkf_responsetype === RESPONSE_TYPE_MAP.declined;
  const hasDisposition = row.wmkf_applicantdisposition !== null
    && row.wmkf_applicantdisposition !== undefined;
  if (hasDisposition && !isDeclined) {
    throw new Error(`reviewer-suggestion.restore: refusing to restore a non-removed row (disposition=${row.wmkf_applicantdisposition}); use the proper promotion path (${id})`);
  }
  // Optimistic lock: PATCH selected=true ONLY if the row hasn't changed since the
  // scope check above. Closes the TOCTOU where a concurrent writer flips disposition
  // null→recommended between this read and the write (updateLifecycle's own guard
  // rejects only EXCLUDED, not recommended), which would otherwise silently promote
  // an applicant-recommended row. On a 412 the restore fails loudly; the PD retries.
  // Direct raw-field PATCH is deliberate: a staff-recorded withdrawal has a
  // terminal review status, and updateLifecycle correctly refuses to reopen
  // terminal rows. This narrowly-scoped restore is the explicit reset workflow.
  await DynamicsService.updateRecord(ENTITY_SET, id, {
    wmkf_selected: true,
    ...ENGAGEMENT_STAMP_RESET,
  }, { actingUserSystemId, ifMatch: row._etag });
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
