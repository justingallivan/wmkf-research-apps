/**
 * Reviewer record merge (S289, v1) — collapse a DUPLICATE wmkf_potentialreviewers
 * row into a keeper. Scoped to a PRE-ENGAGEMENT loser only; any engagement on the
 * loser blocks the merge (fail-closed). Design + rationale: docs/REVIEWER_MERGE_DESIGN.md.
 *
 * planMerge()   — read-only: diff keeper vs loser, evaluate the block predicate,
 *                 list which loser suggestions repoint vs collide. Mutates nothing.
 * executeMerge()— re-validates the plan, then applies the ordered steps with all
 *                 chosen literals resolved up front (no live-state re-derivation
 *                 mid-flight). Throws a blocked/validation error rather than a
 *                 partial mutation when the loser isn't eligible.
 *
 * Adapters are injectable (deps) for unit testing, mirroring the honorarium
 * orchestrator. Defaults are the real adapters.
 */

import * as potentialReviewerAdapter from '../dataverse/adapters/potential-reviewer.js';
import * as suggestionAdapter from '../dataverse/adapters/reviewer-suggestion.js';
import * as researcherAdapter from '../dataverse/adapters/researcher.js';
import * as grantRequestAdapter from '../dataverse/adapters/grant-request.js';
import { isGuid } from '../utils/guid.js';
import { translateDuplicateKeyError } from '../dataverse/duplicate-key.js';

// Fields the staff picker reconciles (human-facing only — identity/ORCID/biblio
// verdict fields are NOT pickable; they follow a non-downgrade rule, see design).
export const MERGE_PICKER_FIELDS = ['name', 'affiliation', 'email', 'website', 'hIndex'];

// Any of these populated on a loser suggestion row ⇒ the loser is NOT
// pre-engagement ⇒ block. Positive-blacklist of KNOWN signals; the rule is "any
// outreach/response/intake/token/honorarium signal blocks" (excluded disposition
// is handled separately via isExcluded). Kept broad on purpose (design FINAL-1).
const ENGAGEMENT_SIGNAL_FIELDS = [
  'wmkf_invited', 'wmkf_accepted', 'wmkf_declined', 'wmkf_responsetype',
  'wmkf_emailsentat', 'wmkf_materialssentat', 'wmkf_remindersentat',
  'wmkf_reviewduedateoverride',
  'wmkf_respondremindersentat', 'wmkf_responsereceivedat', 'wmkf_reviewreceivedat',
  'wmkf_thankyousentat', 'wmkf_proposalfirstaccessed', 'wmkf_reviewfilename',
  'wmkf_reviewsharepointfolder', 'wmkf_externaltokenissued', '_wmkf_honorariumrequest_value',
  'wmkf_declinereason', 'wmkf_honorariumoptout',
  // Phase D: the 3 rating columns (wmkf_reviewer{impact,risk,overallrating}) were
  // dropped from this engagement signal — they are redundant with
  // wmkf_reviewreceivedat (above), which EVERY rating writer co-sets
  // (build-review-submission / mark-received-no-file / review-upload), so a rated
  // review is still detected as engaged. They are also retiring (Phase E).
  // Codex S289 IND-A additions — PD close-out, acknowledgements, selective-decline,
  // revoked token, and any reviewer-SUPPLIED stage-2a identity/contact field.
  'wmkf_completedat', 'wmkf_coiackedat', 'wmkf_aiuseackedat',
  'wmkf_withdrawnsufficientat', 'wmkf_externaltokenrevoked',
  'wmkf_reviewerfirstname', 'wmkf_reviewerlastname', 'wmkf_reviewernickname',
  'wmkf_reviewertitle', 'wmkf_revieweremail', 'wmkf_reviewerorcid',
];

function norm(v) {
  return v === null || v === undefined ? '' : String(v).trim().toLowerCase();
}

// Truthy "has a real value". Strings are TRIMMED so a whitespace-only value
// counts as empty (Codex S289 ITEM-3): otherwise a "loser" pick on a blank-but-
// not-null field would still overwrite the keeper. Numbers (incl. hIndex 0) and
// other non-null/non-false/non-string values are real.
function isSet(v) {
  if (v === null || v === undefined || v === false) return false;
  if (typeof v === 'string') return v.trim() !== '';
  return true;
}

function personFieldValue(row, field) {
  switch (field) {
    case 'name': return row?.wmkf_name ?? null;
    case 'affiliation': return row?.wmkf_primaryaffiliation ?? row?.wmkf_organizationname ?? null;
    case 'email': return row?.wmkf_emailaddress ?? null;
    case 'website': return row?.wmkf_website ?? null;
    case 'hIndex': return row?.wmkf_hindex ?? null;
    default: return null;
  }
}

/** True if a loser suggestion row carries ANY engagement/outreach/intake signal,
 *  or the applicant-excluded disposition (fail-closed safety-significant). */
function suggestionIsEngaged(row, sug) {
  if (sug.isExcluded(row)) return true;
  return ENGAGEMENT_SIGNAL_FIELDS.some((f) => isSet(row?.[f]));
}

function validationError(message) {
  const e = new Error(message);
  e.code = 'merge_validation';
  e.status = 400;
  return e;
}

function blockedError(reasons) {
  const e = new Error('Merge blocked: the loser record is not pre-engagement.');
  e.code = 'merge_blocked';
  e.status = 409;
  e.reasons = reasons;
  return e;
}

function classifyDataverseMergeConflict(err) {
  if (translateDuplicateKeyError(err)) return 'duplicate_key';
  if (err.status === 412) return 'precondition_failed';
  if (err.status === 409) {
    const msg = (err.message || '').toLowerCase();
    if (msg.includes('duplicate') || msg.includes('alternate key') || msg.includes('matching key')) return 'duplicate_key';
    return 'dataverse_conflict';
  }
  return null;
}

function retryableReplanError(cause, { step, operation, reason }) {
  const e = new Error(`Merge concurrency conflict at step ${step}: ${reason}`);
  e.code = 'merge_retryable_replan';
  e.status = 409;
  e.retryable = true;
  e.action = 'replan';
  e.step = step;
  e.operation = operation;
  e.reason = reason;
  e.cause = cause;
  return e;
}

function emailMoveError(cause) {
  const e = new Error('Merge failed during email transfer');
  e.code = 'merge_email_move_failed';
  e.status = 500;
  e.retryable = false;
  e.phase = 'email_move';
  e.cause = cause;
  return e;
}

function applicantProvenanceConflictError(requestId) {
  const e = new Error('Merge blocked: the kept record is applicant-EXCLUDED on a request where the discarded record was applicant-recommended.');
  e.code = 'merge_applicant_provenance_conflict';
  e.status = 409;
  e.requestId = requestId;
  return e;
}

function requiredEtag(value, label) {
  if (typeof value === 'string' && value) return value;
  throw retryableReplanError(new Error(`${label} ETag missing`), {
    step: 0,
    operation: 'preflight',
    reason: 'etag_missing',
  });
}

const SLOT_NUMBERS = [1, 2, 3, 4, 5];

/**
 * Find every akoya_request whose applicant-suggested reviewer slots
 * (wmkf_potentialreviewer1..5) hold the loser, and resolve the ordered slot
 * operations needed to repoint the applicant's recommendation onto the keeper.
 *
 * Returns one entry per request: { requestId, etag, ops: [{ slot, action }] }
 * where action is:
 *   - 'repoint' — PATCH the slot nav prop to the keeper (applicant recommended
 *     this person; the keeper is the surviving record for that person).
 *   - 'clear'   — disassociate the slot ($ref delete). Used when the keeper would
 *     otherwise occupy two slots: either the keeper is ALREADY in a slot on this
 *     request, or the loser sits in MORE THAN ONE slot (we repoint the first and
 *     clear the rest). The applicant's recommendation is still represented by the
 *     one keeper slot, matching the by-person dedup the ingestion route already
 *     applies on read (applicant-reviewers.js seenPersonIds).
 *
 * Paginated (queryAllRecords) and fail-closed on a capped result so a merge can
 * never silently leave some slots still pointing at the loser before deactivate.
 */
async function findApplicantSlotRefs(requests, loserId, keeperId, { cappedAction = 'validate' } = {}) {
  const filter = SLOT_NUMBERS
    .map((n) => `_wmkf_potentialreviewer${n}_value eq ${loserId}`)
    .join(' or ');
  const select = ['akoya_requestid', ...SLOT_NUMBERS.map((n) => `_wmkf_potentialreviewer${n}_value`)].join(',');
  const { records, capped } = await requests.queryAllRequests({ select, filter });
  if (capped) {
    // At plan time a cap is a terminal "resolve manually" 400: nothing has been
    // written, and the merge genuinely cannot be done safely. At the Step 7
    // re-check it is NOT terminal — Steps 3-6 have already written, and the
    // modal treats 400 as non-retryable (`staleValidation`), which would strand
    // a half-merged record with no path forward. Fail to a replan instead: the
    // retry re-plans, hits the cap again at plan time, and lands on the honest
    // terminal 400 BEFORE any further writes. (Reaching this at Step 7 but not
    // at plan time needs the loser's slot count to cross 5000 mid-merge, so this
    // is correctness-by-construction rather than an observed failure.)
    if (cappedAction === 'replan') {
      throw retryableReplanError(new Error('applicant-slot re-read capped'), {
        step: 7,
        operation: 'predeactivate_reference_recheck',
        reason: 'slot_query_capped',
      });
    }
    throw validationError('Too many applicant-slot references to merge safely; resolve manually.');
  }

  return (records || []).map((rec) => {
    const loserSlots = [];
    let keeperInSlot = false;
    for (const n of SLOT_NUMBERS) {
      const v = rec[`_wmkf_potentialreviewer${n}_value`];
      if (norm(v) === norm(loserId)) loserSlots.push(n);
      if (norm(v) === norm(keeperId)) keeperInSlot = true;
    }
    // If the keeper is already represented in a slot (its own slot, or because we
    // repoint the loser's first slot), every remaining loser slot must be cleared
    // so the keeper never occupies two slots.
    const ops = loserSlots.map((slot, i) => ({
      slot,
      action: !keeperInSlot && i === 0 ? 'repoint' : 'clear',
    }));
    return { requestId: rec.akoya_requestid, etag: rec._etag || null, ops };
  });
}

/**
 * Read-only merge plan. Returns:
 *   { blocked, reasons[], keeper, loser, fields[], repoint[], collisions[] }
 * `fields` is the picker diff; `repoint`/`collisions` are loser suggestion rows
 * (with their ETag) keyed by request. Mutates nothing.
 */
export async function planMerge({ keeperId, loserId }, deps = {}) {
  const pr = deps.potentialReviewer || potentialReviewerAdapter;
  const sug = deps.suggestions || suggestionAdapter;
  const requests = deps.requests || grantRequestAdapter;

  if (!isGuid(keeperId)) throw validationError('keeperId must be a GUID');
  if (!isGuid(loserId)) throw validationError('loserId must be a GUID');
  if (norm(keeperId) === norm(loserId)) throw validationError('keeperId and loserId must differ');

  const [keeper, loser] = await Promise.all([pr.getByIdForMerge(keeperId), pr.getByIdForMerge(loserId)]);
  if (!keeper) throw validationError('keeper record not found');
  if (!loser) throw validationError('loser record not found');

  const [loserSug, keeperSug, slotRepoints] = await Promise.all([
    sug.findAllByPotentialReviewer(loserId),
    sug.findAllByPotentialReviewer(keeperId),
    findApplicantSlotRefs(requests, loserId, keeperId),
  ]);

  // ── Block predicate (fail-closed) ──
  const reasons = [];
  if (isSet(loser._wmkf_contact_value)) {
    reasons.push({ code: 'loser_has_contact', detail: 'Loser is promoted to a CRM contact; merge a non-promoted record or have Connor merge the contacts first.' });
  }
  const engagedRows = loserSug.filter((r) => suggestionIsEngaged(r, sug));
  if (engagedRows.length) {
    reasons.push({
      code: 'loser_engaged',
      detail: 'Loser has been invited/has responded/has review or honorarium activity on at least one request.',
      requestIds: engagedRows.map((r) => r._wmkf_request_value).filter(Boolean),
    });
  }
  // NOTE: a loser sitting in an applicant-suggested slot is NO LONGER blocked
  // (the v1 `loser_in_applicant_slot` block was lifted). executeMerge repoints
  // the slot onto the keeper (Step 5), preserving the applicant's recommendation.
  // Identity non-downgrade (Codex S289 ITEM-5): new automated writes cannot
  // persist `confirmed`, but legacy rows do not encode attestation provenance.
  // Treat every stored `confirmed` as protected: block and tell staff to make
  // that record the keeper rather than risk discarding an attestation.
  if (norm(loser.wmkf_identitystatus) === 'confirmed' && norm(keeper.wmkf_identitystatus) !== 'confirmed') {
    reasons.push({ code: 'loser_confirmed_identity', detail: 'The record being discarded has a protected confirmed identity. Re-run with it as the keeper so the protected identity is preserved.' });
  }
  const blocked = reasons.length > 0;

  // ── Picker diff ──
  const fields = MERGE_PICKER_FIELDS.map((f) => ({
    field: f,
    keeper: personFieldValue(keeper, f),
    loser: personFieldValue(loser, f),
    differs: norm(personFieldValue(keeper, f)) !== norm(personFieldValue(loser, f)),
  }));

  // ── Suggestion repoint vs collision (per request) ──
  const keeperRequestIds = new Set(keeperSug.map((r) => norm(r._wmkf_request_value)));
  const repoint = [];
  const collisions = [];
  for (const r of loserSug) {
    const entry = {
      suggestionId: r.wmkf_appreviewersuggestionid,
      requestId: r._wmkf_request_value || null,
      etag: r._etag || null,
    };
    if (keeperRequestIds.has(norm(r._wmkf_request_value))) {
      // Carry whether the COLLIDING loser row is applicant-recommended: if so,
      // executeMerge transplants that intent onto the keeper's surviving row
      // before deleting this one, so the applicant recommendation isn't lost.
      entry.applicantProvenance = sug.hasApplicantProvenance(r);
      collisions.push(entry);
    } else {
      repoint.push(entry);
    }
  }

  return {
    blocked,
    reasons,
    keeper: { id: keeperId, name: keeper.wmkf_name, email: keeper.wmkf_emailaddress, identityStatus: keeper.wmkf_identitystatus ?? null, etag: keeper._etag || null },
    loser: { id: loserId, name: loser.wmkf_name, email: loser.wmkf_emailaddress, identityStatus: loser.wmkf_identitystatus ?? null, statecode: loser.statecode ?? null, etag: loser._etag || null },
    fields,
    repoint,
    collisions,
    slotRepoints,
  };
}

export function projectMergePlanForClient(plan) {
  return {
    blocked: plan.blocked,
    keeper: plan.keeper,
    loser: plan.loser,
    fields: plan.fields,
    reasons: (plan.reasons || []).map((r) => ({ code: r.code, detail: r.detail })),
    repointCount: (plan.repoint || []).length,
    collisionCount: (plan.collisions || []).length,
    slotRepointCount: (plan.slotRepoints || []).reduce((n, r) => n + (r.ops || []).length, 0),
  };
}

/** Resolve the staff field choices into the literal values to WRITE onto the
 *  keeper. Only fields where the chosen source differs from the keeper's current
 *  value are returned. Choice defaults to 'keeper' (no change). */
function resolvePersonUpdates(fieldChoices, plan) {
  const choices = fieldChoices || {};
  const out = {};
  for (const f of plan.fields) {
    const pick = choices[f.field] === 'loser' ? 'loser' : 'keeper';
    // Guard isSet(f.loser) (Codex S289 ITEM-3): `differs` is true whenever the
    // values differ — INCLUDING keeper-has / loser-empty. Picking "loser" for an
    // empty loser field must NOT null out the keeper's real value.
    if (pick === 'loser' && f.differs && isSet(f.loser)) out[f.field] = f.loser;
  }
  return out;
}

/**
 * Execute the merge. Re-validates (re-plans) first and throws if the loser is no
 * longer eligible or the plan changed materially. Applies ordered, literals-first.
 * Returns a summary of what was done.
 */
export async function executeMerge({ keeperId, loserId, fieldChoices, actingUserSystemId }, deps = {}) {
  const pr = deps.potentialReviewer || potentialReviewerAdapter;
  const sug = deps.suggestions || suggestionAdapter;
  const researcher = deps.researcher || researcherAdapter;
  const requests = deps.requests || grantRequestAdapter;

  // Re-validate against live state at execute time (fail-closed).
  const plan = await planMerge({ keeperId, loserId }, deps);
  if (plan.blocked) throw blockedError(plan.reasons);

  // Already-merged guard (Codex S289 ITEM-1): a double-submit re-runs this after
  // the loser was deactivated. statecode 1 = Inactive ⇒ refuse before any mutation
  // (without this, a second confirm could re-derive an email move and null the
  // keeper's email). statecode is null only if the read omitted it — don't block then.
  if (isSet(plan.loser.statecode) && plan.loser.statecode !== 0) {
    throw validationError('Loser record is already inactive (already merged or retired); nothing to do.');
  }

  // Resolve all literals BEFORE any mutation (so a tear can't lose a chosen value).
  const updates = resolvePersonUpdates(fieldChoices, plan);
  const emailMoves = Object.prototype.hasOwnProperty.call(updates, 'email')
    && isSet(updates.email)
    && norm(updates.email) !== norm(plan.keeper.email);

  const summary = {
    keeperId, loserId,
    repointed: 0, deleted: 0, emailMoved: false, fieldsWritten: [],
    slotsRepointed: 0, slotsCleared: 0, provenanceTransferred: 0,
  };
  let keeperEtag = requiredEtag(plan.keeper.etag, 'keeper person');
  let loserEtag = requiredEtag(plan.loser.etag, 'loser person');
  for (const row of [...plan.repoint, ...plan.collisions]) {
    requiredEtag(row.etag, `suggestion ${row.suggestionId}`);
  }
  for (const ref of plan.slotRepoints) {
    requiredEtag(ref.etag, `request ${ref.requestId}`);
  }

  // ── Step 3: reconcile non-email person fields onto the keeper ──
  // name/affiliation → person identity adapter; website/hIndex → researcher adapter.
  const identityUpdates = {};
  if (updates.name !== undefined) identityUpdates.name = updates.name;
  if (updates.affiliation !== undefined) identityUpdates.affiliation = updates.affiliation;
  const researcherUpdates = {};
  if (updates.affiliation !== undefined) researcherUpdates.affiliation = updates.affiliation;
  if (updates.website !== undefined) researcherUpdates.website = updates.website;
  if (updates.hIndex !== undefined) researcherUpdates.hIndex = updates.hIndex;
  try {
    if (Object.keys(identityUpdates).length) {
      await pr.update(keeperId, identityUpdates, { actingUserSystemId, ifMatch: keeperEtag });
      summary.fieldsWritten.push(...Object.keys(identityUpdates));
      const refreshed = await pr.getByIdForMerge(keeperId);
      keeperEtag = requiredEtag(refreshed?._etag, 'keeper person');
    }
    if (Object.keys(researcherUpdates).length) {
      await researcher.updateById(keeperId, researcherUpdates, { actingUserSystemId, ifMatch: keeperEtag });
      const refreshed = await pr.getByIdForMerge(keeperId);
      keeperEtag = requiredEtag(refreshed?._etag, 'keeper person');
    }
  } catch (err) {
    const reason = classifyDataverseMergeConflict(err);
    if (reason) throw retryableReplanError(err, { step: 3, operation: 'field_update', reason });
    throw err;
  }

  // ── Step 4: loser suggestions — repoint non-colliding, conditional-delete collisions ──
  for (const r of plan.repoint) {
    try {
      await sug.repointToPotentialReviewer(r.suggestionId, keeperId, { actingUserSystemId, ifMatch: requiredEtag(r.etag, `suggestion ${r.suggestionId}`) });
    } catch (err) {
      const reason = classifyDataverseMergeConflict(err);
      if (reason) throw retryableReplanError(err, { step: 4, operation: 'suggestion_repoint', reason });
      throw err;
    }
    summary.repointed += 1;
  }
  for (const r of plan.collisions) {
    // Provenance preservation BEFORE delete: if the colliding loser row is
    // applicant-recommended, transplant that intent onto the keeper's surviving
    // row for this request first, so deleting the loser row can't drop the
    // applicant recommendation. ensureApplicantRecommended unions 'applicant'
    // into wmkf_sources and sets disposition=recommended on the keeper's existing
    // row (idempotent). Gated on the loser's own provenance so an ordinary keeper
    // row is never falsely stamped recommended.
    if (r.applicantProvenance && r.requestId) {
      let unionResult;
      try {
        unionResult = await sug.ensureApplicantRecommended(
          { potentialReviewerId: keeperId, requestId: r.requestId },
          { actingUserSystemId, requireEtag: true },
        );
      } catch (err) {
        const reason = classifyDataverseMergeConflict(err);
        if (reason) throw retryableReplanError(err, { step: 4, operation: 'applicant_provenance_union', reason });
        throw err;
      }
      // skippedExcluded ⇒ the keeper's row for this request is applicant-EXCLUDED.
      // Deleting a recommended loser row and silently leaving the keeper excluded
      // would be a real recommended/excluded conflict for one person on one
      // request — fail closed before the delete.
      if (unionResult?.skippedExcluded) throw applicantProvenanceConflictError(r.requestId);
      summary.provenanceTransferred += 1;
    }
    // Loser row is un-engaged by predicate; delete it to free the (person,request)
    // key. ifMatch fails closed if it became engaged after the re-plan read.
    try {
      await sug.hardDeleteById(r.suggestionId, { actingUserSystemId, ifMatch: requiredEtag(r.etag, `suggestion ${r.suggestionId}`) });
    } catch (err) {
      const reason = classifyDataverseMergeConflict(err);
      if (reason) throw retryableReplanError(err, { step: 4, operation: 'suggestion_repoint', reason });
      throw err;
    }
    summary.deleted += 1;
  }

  // ── Step 5: applicant slots — repoint loser→keeper, clear keeper-duplicates ──
  // After all (retryable) suggestion reference work and BEFORE the non-retryable
  // email clear/set window, so a slot conflict can still drop back to a replan and
  // guarantees the loser is dereferenced from every slot before deactivate (Step 7).
  for (const ref of plan.slotRepoints) {
    // Repoints first (they carry the request If-Match etag); clears have no
    // precondition and stay valid even after a repoint bumps the request etag.
    const repointOps = ref.ops.filter((o) => o.action === 'repoint');
    const clearOps = ref.ops.filter((o) => o.action === 'clear');
    let requestEtag = requiredEtag(ref.etag, `request ${ref.requestId}`);
    const orderedOps = [...repointOps, ...clearOps];
    for (let index = 0; index < orderedOps.length; index += 1) {
      const op = orderedOps[index];
      const navProp = `wmkf_PotentialReviewer${op.slot}`;
      try {
        if (op.action === 'repoint') {
          await requests.updateById(
            ref.requestId,
            { [`${navProp}@odata.bind`]: `/wmkf_potentialreviewerses(${keeperId})` },
            { ifMatch: requestEtag, actingUserSystemId },
          );
          summary.slotsRepointed += 1;
        } else {
          await requests.disassociate(ref.requestId, navProp, { actingUserSystemId, ifMatch: requestEtag });
          summary.slotsCleared += 1;
        }
        if (index < orderedOps.length - 1) {
          const refreshed = await requests.getById(ref.requestId, { select: 'akoya_requestid' });
          requestEtag = requiredEtag(refreshed?._etag, `request ${ref.requestId}`);
        }
      } catch (err) {
        const reason = classifyDataverseMergeConflict(err);
        if (reason) throw retryableReplanError(err, { step: 5, operation: 'slot_repoint', reason });
        throw err; // 404/400 stay hard failures
      }
    }
  }

  // ── Step 6: email move (only if the surviving email differs from keeper's) ──
  if (emailMoves) {
    try {
      await pr.clearEmail(loserId, { actingUserSystemId, ifMatch: loserEtag });
      // Stamp provenance in the SAME patch as the moved address (S387), so the
      // invite-confidence gate can never read the keeper's OLD source against the
      // newly-moved address — as two calls, a failure between them left exactly that.
      await pr.update(keeperId, { email: updates.email, emailSource: 'manual' }, { actingUserSystemId, ifMatch: keeperEtag });
      summary.emailMoved = true;
      summary.fieldsWritten.push('email');
      const [refreshedKeeper, refreshedLoser] = await Promise.all([
        pr.getByIdForMerge(keeperId),
        pr.getByIdForMerge(loserId),
      ]);
      keeperEtag = requiredEtag(refreshedKeeper?._etag, 'keeper person');
      loserEtag = requiredEtag(refreshedLoser?._etag, 'loser person');
    } catch (err) {
      throw emailMoveError(err);
    }
  }

  // ── Step 7: re-verify the loser is dereferenced, THEN deactivate ──
  // The plan's enumeration is a snapshot taken at :333, and Steps 3-6 are many
  // sequential Dataverse round-trips — a reference created in that window is not
  // in the snapshot and so is never repointed. The ifMatch below CANNOT catch it:
  // loserEtag is the loser PERSON's ETag, and creating a suggestion row (or
  // binding an applicant slot) writes a different record, leaving the person row
  // — and its ETag — untouched. Without this re-read the merge reports success
  // while a live reference points at an inactive reviewer.
  //
  // Steps 4-5 repoint or delete every row the plan enumerated, so both queries
  // must now come back empty; anything present is new. Fail closed to a replan:
  // nothing destructive is left to do at this point, and the retry re-plans with
  // the new reference included (or blocks, if it made the loser engaged).
  const [survivingSug, survivingSlots] = await Promise.all([
    sug.findAllByPotentialReviewer(loserId),
    findApplicantSlotRefs(requests, loserId, keeperId, { cappedAction: 'replan' }),
  ]);
  const survivingSlotOps = survivingSlots.reduce((n, r) => n + (r.ops || []).length, 0);
  if (survivingSug.length || survivingSlotOps) {
    throw retryableReplanError(
      new Error(`loser still referenced by ${survivingSug.length} suggestion(s) and ${survivingSlotOps} slot(s)`),
      { step: 7, operation: 'predeactivate_reference_recheck', reason: 'new_reference_created' },
    );
  }

  await pr.deactivate(loserId, { actingUserSystemId, ifMatch: loserEtag });

  return summary;
}
