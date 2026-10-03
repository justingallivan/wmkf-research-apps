/**
 * Status setter rules (cast-and-status plan, slice C):
 * lib/services/test-requests/status-transitions.js.
 */
import {
  PHASE_I, PHASE_II, STATUS_FIELDS, assertNotDuplicateProducing, decideResume, evaluateEffects, planTransition, resolveOption,
} from '../../lib/services/test-requests/status-transitions.js';

// Live Phase I options as probe section 11 printed them (2026-09-28), including the stray space.
const PHASE_I_OPTIONS = [
  { value: 100000000, label: 'Pending Committee Review' }, { value: 100000004, label: 'Scored' },
  { value: 100000005, label: 'Not Scored' }, { value: 707510005, label: 'Recommended Invite' },
  { value: 707510006, label: 'Recommended Do Not Invite' }, { value: 100000003, label: 'Invited' },
  { value: 100000002, label: 'Not Invited' }, { value: 707510004, label: 'Incomplete' },
  { value: 100000001, label: ' Ineligible' }, { value: 707510001, label: 'Proposal Late' },
  { value: 707510002, label: 'Rescinded Grant' }, { value: 707510003, label: 'Request Withdrawn' },
  { value: 682090001, label: 'Deferred' },
];
const EMPTY = { phase1: null, phase2: null };

describe('resolveOption', () => {
  test('matches a label trimmed and case-insensitively, including a live label with a leading space', () => {
    expect(resolveOption(PHASE_I_OPTIONS, 'invited')).toBe(100000003);
    expect(resolveOption(PHASE_I_OPTIONS, 'Ineligible')).toBe(100000001);
    expect(resolveOption(PHASE_I_OPTIONS, '  Not Invited ')).toBe(100000002);
  });

  test('refuses no match, more than one match, and an empty label', () => {
    expect(() => resolveOption(PHASE_I_OPTIONS, 'Invite')).toThrow(/matches 0 live options/);
    expect(() => resolveOption([...PHASE_I_OPTIONS, { value: 1, label: 'Invited' }], 'Invited')).toThrow(/matches 2 live options/);
    expect(() => resolveOption(PHASE_I_OPTIONS, ' ')).toThrow(/label is required/);
  });

  test('every live Phase I option is in the transition table', () => {
    for (const option of PHASE_I_OPTIONS) {
      expect(() => planTransition({ field: STATUS_FIELDS.phase1, pair: { phase1: null, phase2: null }, after: option.value })).not.toThrow();
    }
  });
});

describe('planTransition', () => {
  test('the characterization change (Phase II = Pending Committee Review) may show no effects', () => {
    expect(planTransition({ field: STATUS_FIELDS.phase2, pair: EMPTY, after: PHASE_II.PENDING_COMMITTEE_REVIEW }))
      .toEqual({ field: 'wmkf_phaseiistatus', before: null, after: 100000002, allowed: [] });
  });

  test.each([
    [STATUS_FIELDS.phase1, EMPTY, PHASE_I.INVITED, ['emails', 'tracking']],
    [STATUS_FIELDS.phase1, EMPTY, PHASE_I.RECOMMENDED_INVITE, ['emails']],
    [STATUS_FIELDS.phase1, EMPTY, PHASE_I.NOT_INVITED, ['emails']],
    [STATUS_FIELDS.phase1, EMPTY, PHASE_I.RECOMMENDED_DO_NOT_INVITE, ['emails']],
    [STATUS_FIELDS.phase1, EMPTY, PHASE_I.SCORED, []],
    [STATUS_FIELDS.phase2, { phase1: PHASE_I.INVITED, phase2: null }, PHASE_II.RECOMMENDED, ['payments']],
    [STATUS_FIELDS.phase2, { phase1: PHASE_I.SCORED, phase2: null }, PHASE_II.RECOMMENDED, []],
    [STATUS_FIELDS.phase2, { phase1: PHASE_I.INVITED, phase2: null }, PHASE_II.APPROVED, []],
  ])('%s to %s from %j may show %j', (field, pair, after, allowed) => {
    expect(planTransition({ field, pair, after }).allowed).toEqual(allowed);
  });

  test('refuses a no-op, an unlisted option and a non-status field', () => {
    expect(() => planTransition({ field: STATUS_FIELDS.phase1, pair: { phase1: PHASE_I.INVITED, phase2: null }, after: PHASE_I.INVITED }))
      .toThrow(expect.objectContaining({ code: 'status_change_noop' }));
    expect(() => planTransition({ field: STATUS_FIELDS.phase2, pair: EMPTY, after: 999 })).toThrow(/not in the transition table/);
    expect(() => planTransition({ field: STATUS_FIELDS.phase2, pair: EMPTY, after: PHASE_I.RECOMMENDED_INVITE })).toThrow(/not in the transition table/);
    expect(() => planTransition({ field: 'akoya_requeststatus', pair: EMPTY, after: 1 })).toThrow(/not a status field/);
  });
});

describe('effect edges (payment- and tracking-producing changes)', () => {
  test('Phase I → Invited only before Phase II and from a pre-decision Phase I', () => {
    expect(planTransition({ field: STATUS_FIELDS.phase1, pair: { phase1: PHASE_I.RECOMMENDED_INVITE, phase2: null }, after: PHASE_I.INVITED }).allowed).toContain('tracking');
    expect(() => planTransition({ field: STATUS_FIELDS.phase1, pair: { phase1: PHASE_I.NOT_INVITED, phase2: null }, after: PHASE_I.INVITED }))
      .toThrow(expect.objectContaining({ code: 'status_change_edge' }));
    expect(() => planTransition({ field: STATUS_FIELDS.phase1, pair: { phase1: null, phase2: PHASE_II.APPROVED }, after: PHASE_I.INVITED }))
      .toThrow(expect.objectContaining({ code: 'status_change_edge' }));
  });

  test('Phase II → Recommended with Phase I Invited only from unset or Pending Committee Review', () => {
    const invited = (phase2) => ({ phase1: PHASE_I.INVITED, phase2 });
    expect(planTransition({ field: STATUS_FIELDS.phase2, pair: invited(PHASE_II.PENDING_COMMITTEE_REVIEW), after: PHASE_II.RECOMMENDED }).allowed).toEqual(['payments']);
    expect(() => planTransition({ field: STATUS_FIELDS.phase2, pair: invited(PHASE_II.APPROVED), after: PHASE_II.RECOMMENDED }))
      .toThrow(expect.objectContaining({ code: 'status_change_edge' }));
  });

  test('non-producing changes stay allowed from any state', () => {
    expect(planTransition({ field: STATUS_FIELDS.phase2, pair: { phase1: PHASE_I.NOT_INVITED, phase2: PHASE_II.APPROVED }, after: PHASE_II.DECLINED }).allowed).toEqual([]);
  });
});

describe('assertNotDuplicateProducing', () => {
  const prior = (effects, overrides = {}) => [{ status: 'complete', sequence: 1, field: STATUS_FIELDS.phase1, optionAfter: PHASE_I.INVITED, effects, ...overrides }];
  const change = { field: STATUS_FIELDS.phase1, after: PHASE_I.INVITED };

  test('refuses repeating a change that created a tracking row or a payment, unless re-run', () => {
    expect(() => assertNotDuplicateProducing(prior({ trackingIds: ['t'] }), change)).toThrow(expect.objectContaining({ code: 'status_change_replay' }));
    expect(() => assertNotDuplicateProducing(prior({ paymentIds: ['p'] }), change)).toThrow(/--rerun/);
    expect(() => assertNotDuplicateProducing(prior({ trackingIds: ['t'] }), change, { rerun: true })).not.toThrow();
  });

  test('an earlier change that recorded a tracking row blocks whatever its status', () => {
    expect(() => assertNotDuplicateProducing(prior({ trackingIds: ['t'] }, { status: 'needs_attention' }), change)).toThrow(/--rerun/);
  });

  test('an earlier dispatched change with no census blocks a producing repeat, not a non-producing one', () => {
    const unknown = prior(null, { status: 'needs_attention', dispatchedAt: '2026-09-28T22:00:00Z' });
    expect(() => assertNotDuplicateProducing(unknown, { ...change, allowed: ['emails', 'tracking'] })).toThrow(/--rerun/);
    expect(() => assertNotDuplicateProducing(unknown, { ...change, allowed: ['emails'] })).not.toThrow();
  });

  test('allows a repeat whose earlier run created neither, or that targeted another option', () => {
    expect(() => assertNotDuplicateProducing(prior({ emailIds: ['e'] }), change)).not.toThrow();
    expect(() => assertNotDuplicateProducing(prior({ trackingIds: ['t'] }, { optionAfter: PHASE_I.NOT_INVITED }), change)).not.toThrow();
  });
});

describe('evaluateEffects', () => {
  test('an effect of a class the change may not create fails; an absent allowed effect is only recorded', () => {
    expect(evaluateEffects([], { emails: [], tracking: [], payments: ['p1'] }).failures)
      .toEqual(['unexpected payments: 1 new row(s) this change should not create']);
    expect(evaluateEffects(['emails', 'tracking'], { emails: ['e1'], tracking: [], payments: [] }))
      .toEqual({ failures: [], absent: ['tracking'] });
  });
});

describe('decideResume', () => {
  const change = { optionBefore: null, optionAfter: PHASE_II.PENDING_COMMITTEE_REVIEW, etagBefore: 'W/"10"' };

  test('the target already written is recovered, never re-sent', () => {
    expect(decideResume(change, { value: PHASE_II.PENDING_COMMITTEE_REVIEW, etag: 'W/"11"' })).toBe('recovered');
  });

  test('the before-value at the same row version is dispatch (the journal status decides whether anyone may send)', () => {
    expect(decideResume(change, { value: null, etag: 'W/"10"' })).toBe('dispatch');
  });

  test('anything else is a mismatch', () => {
    expect(decideResume(change, { value: null, etag: 'W/"12"' })).toBe('mismatch');
    expect(decideResume(change, { value: PHASE_II.DECLINED, etag: 'W/"12"' })).toBe('mismatch');
  });
});
