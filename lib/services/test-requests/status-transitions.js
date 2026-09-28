/**
 * Status setter rules (docs/plans/TEST_REQUEST_FACTORY_CAST_AND_STATUS_PLAN_2026-09-28.md,
 * slice C). Pure: option resolution, the transition table, the effect check
 * and the resume decision. No I/O.
 *
 * The table lists every current Phase I and Phase II option by its value
 * (values are stable; labels may change at single-phase submission and are
 * resolved from live metadata). Each entry names the effect classes a
 * Research test Request may show after the change, from the workflow
 * definitions read by probe section 11 (2026-09-28):
 *   - WMKF_Research Phase II Invite: Phase I in {Invited, Recommended Invite} → draft email
 *   - WMKF_Research Advance to Phase II: Phase I = Invited → GoApply status-tracking row
 *   - WMKF_Research Phase II Not Invited Draft Email: Phase I in {Not Invited, Recommended Do Not Invite} → draft email
 *   - WMKF_Create Payment: Phase II = Recommended with Phase I = Invited → payment row
 * A value not in the table is refused; adding one is a reviewed commit.
 */

export const STATUS_FIELDS = Object.freeze({ phase1: 'wmkf_phaseistatus', phase2: 'wmkf_phaseiistatus' });

export const PHASE_I = Object.freeze({
  PENDING_COMMITTEE_REVIEW: 100000000, INELIGIBLE: 100000001, NOT_INVITED: 100000002, INVITED: 100000003,
  SCORED: 100000004, NOT_SCORED: 100000005, DEFERRED: 682090001, PROPOSAL_LATE: 707510001, RESCINDED_GRANT: 707510002,
  REQUEST_WITHDRAWN: 707510003, INCOMPLETE: 707510004, RECOMMENDED_INVITE: 707510005, RECOMMENDED_DO_NOT_INVITE: 707510006,
});

export const PHASE_II = Object.freeze({
  DEFERRED: 100000000, DECLINED: 100000001, PENDING_COMMITTEE_REVIEW: 100000002, APPROVED: 100000003,
  RECOMMENDED: 100000004, NOT_RECOMMENDED: 100000005, BELOW_MINIMUM: 707510001, WITHDRAWN: 707510002,
});

export const EFFECT_CLASSES = Object.freeze(['emails', 'tracking', 'payments']);

/** Effect classes a change to `after` may produce, given the resulting pair. */
function phaseIEffects(after) {
  if (after === PHASE_I.INVITED) return ['emails', 'tracking'];
  if ([PHASE_I.RECOMMENDED_INVITE, PHASE_I.NOT_INVITED, PHASE_I.RECOMMENDED_DO_NOT_INVITE].includes(after)) return ['emails'];
  return [];
}

function phaseIIEffects(after, phaseI) {
  return after === PHASE_II.RECOMMENDED && phaseI === PHASE_I.INVITED ? ['payments'] : [];
}

const KNOWN = {
  [STATUS_FIELDS.phase1]: new Set(Object.values(PHASE_I)),
  [STATUS_FIELDS.phase2]: new Set(Object.values(PHASE_II)),
};

function refusal(message, code = 'status_change_refused') {
  return Object.assign(new Error(message), { code });
}

/**
 * The option whose label matches, trimmed and case-insensitive; exactly one
 * must match (live labels carry stray spaces, e.g. " Ineligible").
 * @param {{ value: number, label: string|null }[]} options live metadata
 */
export function resolveOption(options, label) {
  const wanted = String(label ?? '').trim().toLowerCase();
  if (!wanted) throw refusal('An option label is required.');
  const matches = options.filter((o) => String(o.label ?? '').trim().toLowerCase() === wanted);
  if (matches.length !== 1) throw refusal(`"${String(label).trim()}" matches ${matches.length} live options; expected exactly one.`);
  return matches[0].value;
}

/**
 * Decide whether a change is allowed and which effect classes it may show.
 * @param {{ field: string, pair: { phase1: number|null, phase2: number|null }, after: number }} change
 */
export function planTransition({ field, pair, after }) {
  if (!Object.values(STATUS_FIELDS).includes(field)) throw refusal(`${field} is not a status field this setter changes.`);
  if (!KNOWN[field].has(after)) throw refusal(`Option ${after} for ${field} is not in the transition table.`);
  const before = field === STATUS_FIELDS.phase1 ? pair.phase1 : pair.phase2;
  if (before === after) throw refusal(`${field} already holds option ${after}.`, 'status_change_noop');
  const allowed = field === STATUS_FIELDS.phase1 ? phaseIEffects(after) : phaseIIEffects(after, pair.phase1);
  return { field, before: before ?? null, after, allowed };
}

/**
 * A later change that repeats one whose recorded effects created a payment
 * or a status-tracking row is refused unless the owner re-runs it.
 */
export function assertNotDuplicateProducing(priorChanges, { field, after }, { rerun = false } = {}) {
  if (rerun) return;
  const prior = priorChanges.find((c) => c.status === 'complete' && c.field === field && c.optionAfter === after
    && ((c.effects?.paymentIds?.length ?? 0) > 0 || (c.effects?.trackingIds?.length ?? 0) > 0));
  if (prior) {
    throw refusal(`Change ${prior.sequence} already set ${field} to ${after} and created a payment or status-tracking row; pass --rerun to repeat it.`, 'status_change_replay');
  }
}

/**
 * Effects observed after the change against the classes it may show. An
 * effect of a class not allowed is a failure; an allowed effect that did not
 * appear is recorded, not failed (its workflow has conditions this table does
 * not model, such as Phase I Decision Sent).
 * @param {string[]} allowed
 * @param {{ emails: string[], tracking: string[], payments: string[] }} census new IDs since the write
 */
export function evaluateEffects(allowed, census) {
  const failures = EFFECT_CLASSES
    .filter((cls) => (census[cls]?.length ?? 0) > 0 && !allowed.includes(cls))
    .map((cls) => `unexpected ${cls}: ${census[cls].length} new row(s) this change should not create`);
  const absent = allowed.filter((cls) => (census[cls]?.length ?? 0) === 0);
  return { failures, absent };
}

/**
 * Resume rule for a change left `dispatched` (mirrors create_request): the
 * field already at the target means the write landed; the field at the
 * before-value with the same row version means it never did, so one
 * re-dispatch is safe; anything else needs a person.
 * @param {{ optionBefore: number|null, optionAfter: number, etagBefore: string }} change
 * @param {{ value: number|null, etag: string }} current
 */
export function decideResume(change, current) {
  if (current.value === change.optionAfter) return 'recovered';
  if ((current.value ?? null) === change.optionBefore && current.etag === change.etagBefore) return 'redispatch';
  return 'needs_attention';
}
