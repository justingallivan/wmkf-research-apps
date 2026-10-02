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
 *
 * Changes that can create a payment or a GoApply status-tracking row are
 * allowed only from the starting states listed in EFFECT_EDGES (Codex round 1,
 * slice C): a lifecycle regression such as Approved back to Recommended is
 * refused rather than allowed to create a second payment. Every other change
 * (draft emails at most) is allowed from any state, since these are test
 * Requests the owner moves freely.
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

/**
 * The only starting pairs from which a payment- or tracking-producing change
 * is allowed. `phase1`/`phase2` list the permitted current values (null = unset).
 */
export const EFFECT_EDGES = Object.freeze([
  {
    field: STATUS_FIELDS.phase1, after: PHASE_I.INVITED, effect: 'tracking',
    phase1: [null, PHASE_I.PENDING_COMMITTEE_REVIEW, PHASE_I.SCORED, PHASE_I.NOT_SCORED, PHASE_I.RECOMMENDED_INVITE],
    phase2: [null],
  },
  {
    field: STATUS_FIELDS.phase2, after: PHASE_II.RECOMMENDED, effect: 'payments',
    phase1: [PHASE_I.INVITED],
    phase2: [null, PHASE_II.PENDING_COMMITTEE_REVIEW],
  },
]);

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
 * @param {{ resume?: boolean }} [options] `resume`: the change is already journaled, so the edge refusal
 *   (which gates planning a payment- or tracking-producing change) does not apply; the effect classes still do.
 */
export function planTransition({ field, pair, after }, { resume = false } = {}) {
  if (!Object.values(STATUS_FIELDS).includes(field)) throw refusal(`${field} is not a status field this setter changes.`);
  if (!KNOWN[field].has(after)) throw refusal(`Option ${after} for ${field} is not in the transition table.`);
  const before = field === STATUS_FIELDS.phase1 ? pair.phase1 : pair.phase2;
  if (before === after) throw refusal(`${field} already holds option ${after}.`, 'status_change_noop');
  const allowed = field === STATUS_FIELDS.phase1 ? phaseIEffects(after) : phaseIIEffects(after, pair.phase1);
  if (!resume && (allowed.includes('payments') || allowed.includes('tracking'))) {
    const edge = EFFECT_EDGES.find((e) => e.field === field && e.after === after);
    if (!edge || !edge.phase1.includes(pair.phase1 ?? null) || !edge.phase2.includes(pair.phase2 ?? null)) {
      throw refusal(`${field} → ${after} can create a ${allowed.includes('payments') ? 'payment' : 'status-tracking row'} and is not allowed from Phase I ${pair.phase1 ?? 'unset'} / Phase II ${pair.phase2 ?? 'unset'}.`, 'status_change_edge');
    }
  }
  return { field, before: before ?? null, after, allowed };
}

/**
 * A later change that repeats one whose recorded effects created a payment
 * or a status-tracking row is refused unless the owner re-runs it.
 */
export function assertNotDuplicateProducing(priorChanges, { field, after, allowed = [] }, { rerun = false } = {}) {
  if (rerun) return;
  const producing = allowed.includes('payments') || allowed.includes('tracking');
  // Any earlier change to the same target that recorded a payment or tracking
  // row, whatever its status; and, for a change that can create one, any
  // earlier dispatched change whose census never ran (its effects are unknown).
  const prior = priorChanges.find((c) => c.field === field && c.optionAfter === after && (
    (c.effects?.paymentIds?.length ?? 0) > 0 || (c.effects?.trackingIds?.length ?? 0) > 0
    || (producing && c.dispatchedAt && !c.effects)));
  if (prior) {
    throw refusal(`Change ${prior.sequence} already set ${field} to ${after} and created, or may have created, a payment or status-tracking row; pass --rerun to repeat it.`, 'status_change_replay');
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
 * Resume rule for an open change, read from the Request alone (mirrors
 * create_request) and status-agnostic: the field already at the target means
 * the write landed (`recovered`); the field at the before-value with the same
 * row version means it has not landed *yet* (`dispatch`, which a `dispatched`
 * change must NOT act on: its sender may still be in flight, so the runner
 * waits for the owner instead of re-sending); anything else is `mismatch`.
 * The runner decides what each answer means for the change's status.
 * @param {{ optionBefore: number|null, optionAfter: number, etagBefore: string }} change
 * @param {{ value: number|null, etag: string }} current
 */
export function decideResume(change, current) {
  if (current.value === change.optionAfter) return 'recovered';
  if ((current.value ?? null) === change.optionBefore && current.etag === change.etagBefore) return 'dispatch';
  return 'mismatch';
}
