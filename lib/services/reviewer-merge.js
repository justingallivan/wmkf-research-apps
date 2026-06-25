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
import { DynamicsService } from './dynamics-service.js';
import { isGuid } from '../utils/guid.js';

const REQUEST_ENTITY = 'akoya_requests';

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
  'wmkf_respondremindersentat', 'wmkf_responsereceivedat', 'wmkf_reviewreceivedat',
  'wmkf_thankyousentat', 'wmkf_proposalfirstaccessed', 'wmkf_reviewfilename',
  'wmkf_reviewsharepointfolder', 'wmkf_revieweroverallrating', 'wmkf_reviewerimpact',
  'wmkf_reviewerrisk', 'wmkf_externaltokenissued', '_wmkf_honorariumrequest_value',
  'wmkf_declinereason', 'wmkf_honorariumoptout',
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

async function findApplicantSlotRefs(dyn, loserId) {
  const filter = [1, 2, 3, 4, 5]
    .map((n) => `_wmkf_potentialreviewer${n}_value eq ${loserId}`)
    .join(' or ');
  const { records } = await dyn.queryRecords(REQUEST_ENTITY, {
    select: 'akoya_requestid',
    filter,
    top: 50,
  });
  return records || [];
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
  const dyn = deps.dynamics || DynamicsService;

  if (!isGuid(keeperId)) throw validationError('keeperId must be a GUID');
  if (!isGuid(loserId)) throw validationError('loserId must be a GUID');
  if (norm(keeperId) === norm(loserId)) throw validationError('keeperId and loserId must differ');

  const [keeper, loser] = await Promise.all([pr.getByIdForMerge(keeperId), pr.getByIdForMerge(loserId)]);
  if (!keeper) throw validationError('keeper record not found');
  if (!loser) throw validationError('loser record not found');

  const [loserSug, keeperSug, slotRefs] = await Promise.all([
    sug.findAllByPotentialReviewer(loserId),
    sug.findAllByPotentialReviewer(keeperId),
    findApplicantSlotRefs(dyn, loserId),
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
  if (slotRefs.length) {
    reasons.push({ code: 'loser_in_applicant_slot', detail: 'Loser is referenced as an applicant-suggested reviewer; not supported in v1.' });
  }
  // Identity non-downgrade (Codex S289 ITEM-5): 'confirmed' is a sticky human
  // attestation the resolver never emits (researcher.js writeIdentityDecision).
  // Rather than transplant the loser's identity bundle, block and tell staff to
  // make the verified record the keeper — fail-closed, no attestation discarded.
  if (norm(loser.wmkf_identitystatus) === 'confirmed' && norm(keeper.wmkf_identitystatus) !== 'confirmed') {
    reasons.push({ code: 'loser_confirmed_identity', detail: 'The record being discarded has a human-verified identity. Re-run with it as the keeper so the verification is preserved.' });
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
    if (keeperRequestIds.has(norm(r._wmkf_request_value))) collisions.push(entry);
    else repoint.push(entry);
  }

  return {
    blocked,
    reasons,
    keeper: { id: keeperId, name: keeper.wmkf_name, email: keeper.wmkf_emailaddress, identityStatus: keeper.wmkf_identitystatus ?? null },
    loser: { id: loserId, name: loser.wmkf_name, email: loser.wmkf_emailaddress, identityStatus: loser.wmkf_identitystatus ?? null, statecode: loser.statecode ?? null },
    fields,
    repoint,
    collisions,
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

  const summary = { keeperId, loserId, repointed: 0, deleted: 0, emailMoved: false, fieldsWritten: [] };

  // ── Step 3: reconcile non-email person fields onto the keeper ──
  // name/affiliation → person identity adapter; website/hIndex → researcher adapter.
  const identityUpdates = {};
  if (updates.name !== undefined) identityUpdates.name = updates.name;
  if (updates.affiliation !== undefined) identityUpdates.affiliation = updates.affiliation;
  if (Object.keys(identityUpdates).length) {
    await pr.update(keeperId, identityUpdates, { actingUserSystemId });
    summary.fieldsWritten.push(...Object.keys(identityUpdates));
  }
  const researcherUpdates = {};
  if (updates.affiliation !== undefined) researcherUpdates.affiliation = updates.affiliation;
  if (updates.website !== undefined) researcherUpdates.website = updates.website;
  if (updates.hIndex !== undefined) researcherUpdates.hIndex = updates.hIndex;
  if (Object.keys(researcherUpdates).length) {
    await researcher.updateById(keeperId, researcherUpdates, { actingUserSystemId });
  }

  // ── Step 4: loser suggestions — repoint non-colliding, conditional-delete collisions ──
  for (const r of plan.repoint) {
    await sug.repointToPotentialReviewer(r.suggestionId, keeperId, { actingUserSystemId, ifMatch: r.etag || undefined });
    summary.repointed += 1;
  }
  for (const r of plan.collisions) {
    // Loser row is un-engaged by predicate; delete it to free the (person,request)
    // key. ifMatch fails closed if it became engaged after the re-plan read.
    await sug.hardDeleteById(r.suggestionId, { actingUserSystemId, ifMatch: r.etag || undefined });
    summary.deleted += 1;
  }

  // ── Step 6: email move (only if the surviving email differs from keeper's) ──
  if (emailMoves) {
    await pr.clearEmail(loserId, { actingUserSystemId });
    await pr.update(keeperId, { email: updates.email }, { actingUserSystemId });
    // Stamp provenance so the invite-confidence gate doesn't read stale source.
    await researcher.updateById(keeperId, { emailSource: 'manual' }, { actingUserSystemId });
    summary.emailMoved = true;
    summary.fieldsWritten.push('email');
  }

  // ── Step 7: deactivate the loser (it's now dereferenced) ──
  await pr.deactivate(loserId, { actingUserSystemId });

  return summary;
}
