import {
  deriveJ27Stage, deriveRecorded, deriveOutcome, isJ27ScopeCycle,
  J27_TASKS, J27_TASK_KEYS, J27_BLOCKERS, J27_RECORDING_TASK_KEYS, J27_PRESENTATION_OPERATIONS,
  J27_PHASES, J27_OUTCOMES, PHASE_I_CHAIRS, PHASE_II_OFFRAMPED,
} from '../../lib/services/workbench/j27-read-model';
import { SCORING_STATUS, CHAIRS_RECOMMENDATION_STATUS } from '../../shared/config/j27Scoring';

// Plan: docs/plans/J27_READ_MODEL_AND_DISCOVERY_PLAN_2026-11-08.md §C8.
// Expected rows are hand-derived from C2 to C6, not from the implementation.

const RESEARCH = 'c247b11a-a7cb-ee11-9078-000d3a341e8f';
const P1 = 'Phase I Pending';
const P2 = 'Phase II Pending';
const NL = { status: 'not-loaded' };
const ABSENT = { status: 'absent' };
const PRESENT = { status: 'present' };
const UNAVAILABLE = { status: 'unavailable' };
const counts = (over = {}) => ({ status: 'present', candidates: 0, invited: 0, accepted: 0, received: 0, completed: 0, ...over });
const ALWAYS = []; // D7 closed: no always-on blocker

/**
 * Tier 1 present, reviewer counts and tier 2 not loaded: the request page
 * before the Overview's reviewer rollup lands. The dashboard has counts from
 * the per-page rollup (plan C1); see `dashboard()`.
 */
function tier1(request = {}, over = {}) {
  return {
    request: {
      status: 'present', requestStatus: P1, statusClass: 'IN_FLIGHT', phaseIStatus: null, phaseIStatusLabel: null,
      phaseIIStatus: null, readyForReview: true, cycleCode: 'J27', grantProgramId: RESEARCH, triageStatus: null,
      isTestRequest: false, ...request,
    },
    rationale: ABSENT, reviewSummary: ABSENT, visitAssessment: ABSENT, rosterMemo: ABSENT,
    reviewers: { status: 'present', anySuggestion: false, counts: NL },
    integrity: { status: 'present', latest: null },
    calendar: { status: 'present', offrampMeetingDate: '2027-03-15', reviewsDueDate: '2027-03-01', today: '2026-11-09' },
    capabilities: { status: 'present', readOnly: false },
    features: { status: 'present', chairsRecommendationEnabled: true },
    presentation: NL, roster: NL, boardDraft: NL, transition: NL,
    ...over,
  };
}
/** The dashboard's view: tier 1 plus reviewer counts, tier 2 not loaded. */
function dashboard(request = {}, over = {}) {
  return tier1(request, { reviewers: { status: 'present', anySuggestion: false, counts: counts() }, ...over });
}
/** Everything the request page can load, with no presentation yet. */
function page(request = {}, over = {}) {
  return tier1(request, {
    reviewers: { status: 'present', anySuggestion: false, counts: counts() },
    presentation: { status: 'present', exists: false, id: null, ended: null, legacyException: false },
    roster: ABSENT, boardDraft: { status: 'present', exists: false }, transition: { status: 'present', phase: null },
    ...over,
  });
}
const keys = (result) => ({ phase: result.phase, basis: result.basis, outcome: result.outcome, tasks: result.taskKeys, primary: result.primaryTask, blockers: result.blockerKeys });

describe('scope guard', () => {
  test.each([['J27', true], ['D27', true], ['J30', true], ['D26', false], ['J26', false], ['j27', false], [' J27 ', false], ['J27 ', false], [null, false], [undefined, false], ['', false], ['J2027', false]])(
    'cycle %p in scope: %p', (code, expected) => { expect(isJ27ScopeCycle(code)).toBe(expected); },
  );
  test('D26 decided row is unclassified with no tasks or blockers', () => {
    const r = deriveJ27Stage(tier1({ cycleCode: 'D26', requestStatus: 'Approved', statusClass: 'DECIDED_AWARD' }));
    expect(keys(r)).toEqual({ phase: 'unclassified', basis: 'out-of-scope', outcome: 'decided-award', tasks: [], primary: null, blockers: [] });
    expect(r.tasksBasis).toBe('out-of-scope');
  });
  test('D26 intake row is unclassified even when ready', () => {
    const r = deriveJ27Stage(tier1({ cycleCode: 'D26' }));
    expect(keys(r).phase).toBe('unclassified');
    expect(r.recorded.scoring).toBe('unset');
  });
  test('lowercase or padded cycle code is out of scope', () => {
    expect(deriveJ27Stage(tier1({ cycleCode: 'j27' })).basis).toBe('out-of-scope');
    expect(deriveJ27Stage(tier1({ cycleCode: ' J27' })).basis).toBe('out-of-scope');
  });
  test('a missing request key throws', () => {
    expect(() => deriveJ27Stage({})).toThrow('present request');
    expect(() => deriveJ27Stage({ request: UNAVAILABLE })).toThrow('present request');
  });
});

describe('C2 recorded decisions', () => {
  test.each([
    [null, 'unset', 'unset', 'pending', null, false],
    [100000000, 'unset', 'unset', 'pending', null, false],
    [SCORING_STATUS.yes, 'scored', 'unset', 'pending', 'Scored', false],
    [SCORING_STATUS.no, 'not-scored', 'unset', 'pending', 'Not Scored', false],
    [CHAIRS_RECOMMENDATION_STATUS.no, 'inferred-scored', 'no', 'pending', 'Not Recommended', false],
    [CHAIRS_RECOMMENDATION_STATUS.yes, 'inferred-scored', 'yes', 'pending', 'Recommended to Chairs', false],
    [PHASE_I_CHAIRS.invited, 'inferred-scored', 'inferred-yes', 'invited', 'Invited', false],
    [PHASE_I_CHAIRS.notInvited, 'inferred-scored', 'inferred-yes', 'not-invited', 'Not Invited', false],
    [100000001, 'unset', 'unset', 'pending', 'Raw label', true],
  ])('phase I %p', (value, scoring, chairsRecommendation, chairsOutcome, label, unmapped) => {
    expect(deriveRecorded(value, 'Raw label')).toEqual({ scoring, chairsRecommendation, chairsOutcome, label, unmapped });
  });
  test('unmapped without a formatted label yields null label', () => {
    expect(deriveRecorded(100000001).label).toBeNull();
  });
});

describe('C4 outcome', () => {
  test.each([
    ['DECIDED_AWARD', null, 'decided-award'],
    ['DECIDED_NO_AWARD', null, 'decided-no-award'],
    ['WITHDRAWN', CHAIRS_RECOMMENDATION_STATUS.yes, 'withdrawn'],
    ['IN_FLIGHT', SCORING_STATUS.no, 'not-scored'],
    ['IN_FLIGHT', CHAIRS_RECOMMENDATION_STATUS.no, 'not-recommended'],
    ['IN_FLIGHT', PHASE_I_CHAIRS.notInvited, 'not-invited'],
    ['IN_FLIGHT', PHASE_I_CHAIRS.invited, 'none'],
    ['UNCLASSIFIED', null, 'none'],
  ])('class %s, phase I %p → %s', (statusClass, phaseI, outcome) => {
    expect(deriveOutcome(statusClass, deriveRecorded(phaseI))).toBe(outcome);
    expect(J27_OUTCOMES).toContain(outcome);
  });
});

describe('C8.1 Factory scenario end states (sandbox batch owner-j27-2026-11-09)', () => {
  // Request status as observed on the created rows (2026-11-09 UTC): Not Scored
  // and Scored read Phase I Pending; Intake, Rationale saved and both
  // Recommendation rows read blank. Scenario 7 (1000386) completed 2026-11-09
  // with Phase I Invited, Phase II Pending Committee Review, ready, two selected
  // uninvited suggestions, and request status `Proposal Invited`: the sandbox's
  // 2024 status rules never derive `Phase II Pending`, which production's rule
  // derives from the Phase II option alone. `s7` is the production-shaped row
  // D2's gate needs; `s7Observed` is the sandbox row as it exists.
  const s7 = { requestStatus: P2, phaseIStatus: PHASE_I_CHAIRS.invited, phaseIIStatus: 100000002 };
  const s7Observed = { requestStatus: 'Proposal Invited', phaseIStatus: PHASE_I_CHAIRS.invited, phaseIIStatus: 100000002, readyForReview: true };
  test('S1 intake: nothing recorded', () => {
    expect(keys(deriveJ27Stage(tier1({ requestStatus: null })))).toEqual({ phase: 'initial-assessment', basis: 'partial', outcome: 'none', tasks: ['record-rationale', 'record-scoring'], primary: 'record-rationale', blockers: ALWAYS });
    expect(keys(deriveJ27Stage(dashboard({ requestStatus: null })))).toEqual({ phase: 'initial-assessment', basis: 'partial', outcome: 'none', tasks: ['record-rationale', 'record-scoring', 'identify-reviewers'], primary: 'record-rationale', blockers: ALWAYS });
  });
  test('S2 rationale saved', () => {
    expect(keys(deriveJ27Stage(tier1({}, { rationale: PRESENT })))).toEqual({ phase: 'initial-assessment', basis: 'partial', outcome: 'none', tasks: ['record-scoring'], primary: 'record-scoring', blockers: ALWAYS });
  });
  test('S3 Not Scored is terminal', () => {
    const r = deriveJ27Stage(tier1({ phaseIStatus: SCORING_STATUS.no }, { rationale: PRESENT }));
    expect(keys(r)).toEqual({ phase: 'initial-assessment', basis: 'partial', outcome: 'not-scored', tasks: [], primary: null, blockers: ALWAYS });
    expect(r.recorded.label).toBe('Not Scored');
  });
  test('S4 Scored, recommendation unset', () => {
    expect(keys(deriveJ27Stage(tier1({ phaseIStatus: SCORING_STATUS.yes }, { rationale: PRESENT })))).toEqual({ phase: 'initial-assessment', basis: 'partial', outcome: 'none', tasks: ['record-chairs-recommendation'], primary: 'record-chairs-recommendation', blockers: ALWAYS });
  });
  test('S4 with the recommendation feature off shows no recording task', () => {
    const r = deriveJ27Stage(tier1({ phaseIStatus: SCORING_STATUS.yes }, { rationale: PRESENT, features: { status: 'present', chairsRecommendationEnabled: false } }));
    expect(r.taskKeys).toEqual([]);
  });
  test('S5 Recommended Do Not Invite is terminal', () => {
    expect(keys(deriveJ27Stage(tier1({ phaseIStatus: CHAIRS_RECOMMENDATION_STATUS.no }, { rationale: PRESENT })))).toEqual({ phase: 'initial-assessment', basis: 'partial', outcome: 'not-recommended', tasks: [], primary: null, blockers: ALWAYS });
  });
  test('S6 Recommended Invite: awaiting Chairs, offramp available, no reviewers', () => {
    const r = deriveJ27Stage(tier1({ requestStatus: null, phaseIStatus: CHAIRS_RECOMMENDATION_STATUS.yes }, { rationale: PRESENT }));
    expect(keys(r)).toEqual({ phase: 'initial-assessment', basis: 'partial', outcome: 'none', tasks: ['record-offramp'], primary: 'record-offramp', blockers: ['chairs-outcome-pending', ...ALWAYS] });
    expect(r.tasks[0].detail).toEqual({ received: null, pastOfframpDate: false });
    const dash = deriveJ27Stage(dashboard({ requestStatus: null, phaseIStatus: CHAIRS_RECOMMENDATION_STATUS.yes }, { rationale: PRESENT }));
    expect(dash.taskKeys).toEqual(['identify-reviewers', 'record-offramp']);
    expect(dash.tasks.find((t) => t.key === 'record-offramp').detail.received).toBe(0);
  });
  test('S7 Invited + Phase II Pending with two selected uninvited suggestions', () => {
    const beforeRollup = deriveJ27Stage(tier1(s7, { rationale: PRESENT, reviewers: { status: 'present', anySuggestion: true, counts: NL } }));
    expect(keys(beforeRollup)).toEqual({ phase: 'peer-review', basis: 'partial', outcome: 'none', tasks: ['record-offramp'], primary: 'record-offramp', blockers: ALWAYS });
    const dash = deriveJ27Stage(dashboard(s7, { rationale: PRESENT, reviewers: { status: 'present', anySuggestion: true, counts: counts({ candidates: 2 }) } }));
    expect(keys(dash)).toEqual({ phase: 'peer-review', basis: 'partial', outcome: 'none', tasks: ['identify-reviewers', 'send-invitations', 'record-offramp'], primary: 'send-invitations', blockers: ALWAYS });
    const onPage = deriveJ27Stage(page(s7, { rationale: PRESENT, reviewers: { status: 'present', anySuggestion: true, counts: counts({ candidates: 2 }) } }));
    expect(keys(onPage)).toEqual({ phase: 'peer-review', basis: 'full', outcome: 'none', tasks: ['identify-reviewers', 'send-invitations', 'record-offramp'], primary: 'send-invitations', blockers: [...ALWAYS, 'presentation-end-unverified'] });
  });
  test('S7 in the sandbox (1000386): Invited, Proposal Invited, ready, two selected → Phase II status blocker withholds invitations', () => {
    const r = deriveJ27Stage(dashboard(s7Observed, { rationale: PRESENT, reviewers: { status: 'present', anySuggestion: true, counts: counts({ candidates: 2 }) } }));
    expect(keys(r)).toEqual({ phase: 'peer-review', basis: 'partial', outcome: 'none', tasks: ['identify-reviewers', 'record-offramp'], primary: 'identify-reviewers', blockers: ['phase-two-status-pending', ...ALWAYS] });
    expect(r.recorded).toMatchObject({ chairsOutcome: 'invited', chairsRecommendation: 'inferred-yes' });
    expect(r.taskKeys).not.toContain('send-invitations');
  });
  test('S8 unready row still derives initial-assessment when resolved directly', () => {
    expect(keys(deriveJ27Stage(tier1({ readyForReview: false })))).toEqual({ phase: 'initial-assessment', basis: 'partial', outcome: 'none', tasks: ['record-rationale', 'record-scoring'], primary: 'record-rationale', blockers: ALWAYS });
  });
});

describe('C8.2 fixtures as read 2026-11-08', () => {
  test('#1000372: Phase I Pending, Advancing, ready, nothing saved', () => {
    expect(keys(deriveJ27Stage(page({ requestStatus: P1, triageStatus: 100000000 })))).toEqual({ phase: 'initial-assessment', basis: 'full', outcome: 'none', tasks: ['record-rationale', 'record-scoring', 'identify-reviewers'], primary: 'record-rationale', blockers: [...ALWAYS, 'presentation-end-unverified'] });
  });
  test('#1000370: request status null, two received reports, interpretation saved, scoring unset', () => {
    const r = deriveJ27Stage(page({ requestStatus: null, triageStatus: 100000000 }, {
      reviewSummary: PRESENT, reviewers: { status: 'present', anySuggestion: true, counts: counts({ candidates: 3, invited: 3, accepted: 3, received: 2 }) },
    }));
    expect(keys(r)).toEqual({ phase: 'peer-review', basis: 'full', outcome: 'none', tasks: ['record-rationale', 'record-scoring', 'identify-reviewers'], primary: 'record-rationale', blockers: [...ALWAYS, 'presentation-end-unverified'] });
  });
  test('#1000369: Scored, one report, interpretation, visit assessment, roster, board draft, timing unverifiable', () => {
    const r = deriveJ27Stage(page({ requestStatus: P1, triageStatus: 100000000, phaseIStatus: SCORING_STATUS.yes }, {
      rationale: PRESENT, reviewSummary: PRESENT, visitAssessment: PRESENT, rosterMemo: PRESENT,
      reviewers: { status: 'present', anySuggestion: true, counts: counts({ candidates: 3, invited: 3, accepted: 3, received: 1 }) },
      presentation: { status: 'present', exists: true, id: 'visit-1', ended: null, legacyException: false },
      roster: { status: 'present', stale: false }, boardDraft: { status: 'present', exists: true },
    }));
    expect(keys(r)).toEqual({ phase: 'final-assessment', basis: 'full', outcome: 'none', tasks: ['record-chairs-recommendation', 'identify-reviewers'], primary: 'record-chairs-recommendation', blockers: [...ALWAYS, 'presentation-end-unverified'] });
    expect(r.taskKeys).not.toContain('start-group-review');
  });
  test('#1000376: Recommended Invite, unready, flagged unreviewed screen, no reviewers', () => {
    const r = deriveJ27Stage(page({ requestStatus: P1, readyForReview: false, phaseIStatus: CHAIRS_RECOMMENDATION_STATUS.yes }, {
      integrity: { status: 'present', latest: { flagged: true, reviewed: false, provenance: 'automated' } },
    }));
    expect(keys(r)).toEqual({ phase: 'initial-assessment', basis: 'full', outcome: 'none', tasks: ['record-rationale', 'review-integrity', 'identify-reviewers', 'record-offramp'], primary: 'record-rationale', blockers: ['chairs-outcome-pending', 'integrity-unreviewed', ...ALWAYS, 'presentation-end-unverified'] });
    expect(r.blockers.find((b) => b.key === 'integrity-unreviewed').blocks).toEqual(['send-invitations', 'schedule-presentation']);
  });
});

describe('C8.3 combinations', () => {
  const invited = { requestStatus: P2, phaseIStatus: PHASE_I_CHAIRS.invited };
  test('presentation scheduled while reports still arrive', () => {
    const r = deriveJ27Stage(page(invited, {
      rationale: PRESENT, reviewers: { status: 'present', anySuggestion: true, counts: counts({ candidates: 3, invited: 3, accepted: 3, received: 1 }) },
      presentation: { status: 'present', exists: true, id: 'v', ended: false, legacyException: false },
    }));
    expect(keys(r)).toEqual({ phase: 'deliberations', basis: 'full', outcome: 'none', tasks: ['identify-reviewers', 'read-reports', 'record-offramp'], primary: 'read-reports', blockers: [...ALWAYS, 'presentation-not-ended'] });
  });
  test('Site Visit read fails on a row with a draft: degraded, roster and group review blocked', () => {
    const r = deriveJ27Stage(page(invited, {
      rationale: PRESENT, visitAssessment: PRESENT, presentation: UNAVAILABLE, roster: ABSENT, boardDraft: { status: 'present', exists: true },
    }));
    expect(keys(r)).toEqual({ phase: 'final-assessment', basis: 'degraded', outcome: 'none', tasks: ['identify-reviewers', 'record-offramp'], primary: 'identify-reviewers', blockers: [...ALWAYS, 'presentation-schedule-unavailable'] });
    expect(r.blockers.find((b) => b.key === 'presentation-schedule-unavailable').blocks).toEqual(['confirm-roster', 'start-group-review']);
  });
  test('Site Visit read fails on a row without a draft: degraded basis', () => {
    const r = deriveJ27Stage(page(invited, { rationale: PRESENT, presentation: UNAVAILABLE }));
    expect(r.phase).toBe('peer-review');
    expect(r.basis).toBe('degraded');
  });
  test('decided award with roster never confirmed has no tasks', () => {
    const r = deriveJ27Stage(page({ requestStatus: 'Approved', statusClass: 'DECIDED_AWARD', phaseIStatus: PHASE_I_CHAIRS.invited }, {
      presentation: { status: 'present', exists: true, id: 'v', ended: true, legacyException: false }, roster: ABSENT,
    }));
    // C6 is literal: Invited without Phase II Pending raises the Phase II status blocker even on a closed row; it blocks nothing here.
    expect(keys(r)).toEqual({ phase: 'decided', basis: 'full', outcome: 'decided-award', tasks: [], primary: null, blockers: ['phase-two-status-pending', ...ALWAYS] });
  });
  test.each([
    ['Phase I Declined', 'DECIDED_NO_AWARD', 'decided-no-award'],
    ['Withdrawn', 'WITHDRAWN', 'withdrawn'],
  ])('terminal class %s', (requestStatus, statusClass, outcome) => {
    const r = deriveJ27Stage(tier1({ requestStatus, statusClass }));
    expect(keys(r)).toEqual({ phase: 'decided', basis: 'full', outcome, tasks: [], primary: null, blockers: ALWAYS });
  });
  test('Invited reached without Recommended Invite still infers the recommendation', () => {
    const r = deriveJ27Stage(tier1(invited));
    expect(r.recorded).toEqual({ scoring: 'inferred-scored', chairsRecommendation: 'inferred-yes', chairsOutcome: 'invited', label: 'Invited', unmapped: false });
    expect(r.phase).toBe('peer-review');
  });
  test('Not Invited is terminal with no forward tasks', () => {
    const r = deriveJ27Stage(tier1({ phaseIStatus: PHASE_I_CHAIRS.notInvited }));
    expect(keys(r)).toEqual({ phase: 'initial-assessment', basis: 'partial', outcome: 'not-invited', tasks: [], primary: null, blockers: ALWAYS });
  });
  test('unmapped Phase I keeps the raw label and records nothing', () => {
    const r = deriveJ27Stage(tier1({ phaseIStatus: 100000001, phaseIStatusLabel: 'Something Else' }));
    expect(r.recorded).toEqual({ scoring: 'unset', chairsRecommendation: 'unset', chairsOutcome: 'pending', label: 'Something Else', unmapped: true });
    expect(r.taskKeys).toEqual(['record-rationale', 'record-scoring']);
  });
  test('Invited without Phase II Pending raises the Phase II status blocker and withholds invitations', () => {
    const r = deriveJ27Stage(page({ requestStatus: P1, phaseIStatus: PHASE_I_CHAIRS.invited }, {
      rationale: PRESENT, reviewers: { status: 'present', anySuggestion: true, counts: counts({ candidates: 2 }) },
    }));
    expect(r.blockerKeys).toEqual(['phase-two-status-pending', ...ALWAYS, 'presentation-end-unverified']);
    expect(r.taskKeys).toEqual(['identify-reviewers', 'record-offramp']);
  });
  test('unselected-only suggestions place the row in peer review', () => {
    const r = deriveJ27Stage(page({}, { reviewers: { status: 'present', anySuggestion: true, counts: counts({ candidates: 0 }) } }));
    expect(r.phase).toBe('peer-review');
  });
  test('obsolete roster memo places the dashboard row at deliberations; the page corrects it', () => {
    const dash = deriveJ27Stage(tier1(invited, { rosterMemo: PRESENT }));
    expect(dash.phase).toBe('deliberations');
    const onPage = deriveJ27Stage(page(invited, { rosterMemo: PRESENT, roster: ABSENT }));
    expect(onPage.phase).toBe('peer-review');
  });
  test('ended presentation raises roster and visit assessment tasks', () => {
    const r = deriveJ27Stage(page(invited, {
      rationale: PRESENT, presentation: { status: 'present', exists: true, id: 'v', ended: true, legacyException: false },
    }));
    expect(r.taskKeys).toEqual(['identify-reviewers', 'record-offramp', 'confirm-roster', 'write-visit-assessment']);
    expect(r.primaryTask).toBe('confirm-roster');
  });
  test('stale roster and stale summary re-raise their tasks with blockers', () => {
    const r = deriveJ27Stage(page(invited, {
      rationale: PRESENT, reviewSummary: { status: 'present', stale: true },
      reviewers: { status: 'present', anySuggestion: true, counts: counts({ candidates: 3, invited: 3, received: 3, completed: 3 }) },
      presentation: { status: 'present', exists: true, id: 'v', ended: true, legacyException: false },
      roster: { status: 'present', stale: true },
    }));
    expect(r.taskKeys).toEqual(['read-reports', 'record-offramp', 'confirm-roster', 'write-visit-assessment']);
    expect(r.blockerKeys).toEqual([...ALWAYS, 'evidence-stale', 'roster-stale']);
  });
  test('board draft written: write-board-draft gone, group review waits for the presentation', () => {
    const base = { rationale: PRESENT, visitAssessment: PRESENT, roster: { status: 'present', stale: false } };
    const noDraft = deriveJ27Stage(page(invited, { ...base, presentation: { status: 'present', exists: true, id: 'v', ended: true, legacyException: false } }));
    expect(noDraft.taskKeys).toContain('write-board-draft');
    const drafted = deriveJ27Stage(page(invited, { ...base, boardDraft: { status: 'present', exists: true }, presentation: { status: 'present', exists: true, id: 'v', ended: true, legacyException: false } }));
    expect(keys(drafted)).toEqual({ phase: 'final-assessment', basis: 'full', outcome: 'none', tasks: ['identify-reviewers', 'record-offramp', 'start-group-review'], primary: 'start-group-review', blockers: ALWAYS });
    const future = deriveJ27Stage(page(invited, { ...base, boardDraft: { status: 'present', exists: true }, presentation: { status: 'present', exists: true, id: 'v', ended: false, legacyException: false } }));
    expect(future.taskKeys).not.toContain('start-group-review');
    expect(future.blockerKeys).toContain('presentation-not-ended');
  });
  test.each(['legacy_complete_review_without_schedule', 'legacy_review_schedule_unverified'])('legacy exception %s allows group review with unknown timing', () => {
    const r = deriveJ27Stage(page(invited, {
      rationale: PRESENT, visitAssessment: PRESENT, roster: { status: 'present', stale: false },
      boardDraft: { status: 'present', exists: true }, presentation: { status: 'present', exists: false, id: null, ended: null, legacyException: true },
    }));
    expect(r.taskKeys).toContain('start-group-review');
    expect(r.blockerKeys).not.toContain('presentation-end-unverified');
  });
  test('missing presentation with no legacy exception blocks group review', () => {
    const r = deriveJ27Stage(page(invited, {
      visitAssessment: PRESENT, boardDraft: { status: 'present', exists: true }, presentation: { status: 'present', exists: false, id: null, ended: null, legacyException: false },
    }));
    expect(r.taskKeys).not.toContain('start-group-review');
    expect(r.blockerKeys).toContain('presentation-end-unverified');
  });
  test('group review in progress places the row at final assessment with no start task', () => {
    const r = deriveJ27Stage(page(invited, { visitAssessment: PRESENT, boardDraft: { status: 'present', exists: true }, transition: { status: 'present', phase: 'group-review' } }));
    expect(r.phase).toBe('final-assessment');
    expect(r.taskKeys).not.toContain('start-group-review');
  });
});

describe('C8.4 basis', () => {
  const invitedPage = () => page({ requestStatus: P2, phaseIStatus: PHASE_I_CHAIRS.invited }, { rationale: PRESENT });
  test('rosterMemo unavailable degrades only while the roster itself is not loaded', () => {
    expect(deriveJ27Stage(tier1({}, { rosterMemo: UNAVAILABLE })).basis).toBe('degraded');
    expect(deriveJ27Stage(page({}, { rosterMemo: UNAVAILABLE })).basis).toBe('full');
  });
  test.each(['rationale', 'reviewSummary', 'visitAssessment', 'reviewers', 'integrity', 'calendar', 'features', 'presentation', 'roster', 'boardDraft', 'transition'])(
    'key %s unavailable alone degrades a live page row', (key) => {
      const r = deriveJ27Stage(page({}, { [key]: UNAVAILABLE }));
      expect(r.basis).toBe('degraded');
      expect(r.tasksBasis).toBe('degraded');
      expect(deriveJ27Stage(page()).basis).toBe('full');
    },
  );
  test('memo keys whose wave is not provisioned withhold their tasks and phase rows without degrading', () => {
    const OFF = { status: 'not-provisioned' };
    const off = { rationale: OFF, reviewSummary: OFF, visitAssessment: OFF, rosterMemo: OFF };
    const onPage = deriveJ27Stage(page({}, off));
    expect(onPage.basis).toBe('full');
    expect(onPage.taskKeys).not.toContain('record-rationale');
    const onList = deriveJ27Stage(tier1({}, off));
    expect(onList.basis).toBe('partial');
    expect(onList.phase).toBe(deriveJ27Stage(tier1({}, { rosterMemo: { status: 'absent' }, visitAssessment: { status: 'absent' } })).phase);
    // A real failed read still degrades alongside unprovisioned memos.
    expect(deriveJ27Stage(page({}, { ...off, integrity: UNAVAILABLE })).basis).toBe('degraded');
  });
  test('rationale unavailable withholds the task and degrades the basis', () => {
    const r = deriveJ27Stage(invitedPage());
    const degraded = deriveJ27Stage(page({ requestStatus: P2, phaseIStatus: PHASE_I_CHAIRS.invited }, { rationale: UNAVAILABLE }));
    expect(r.taskKeys).not.toContain('record-rationale');
    expect(degraded.taskKeys).not.toContain('record-rationale');
    expect(degraded.basis).toBe('degraded');
  });
  test('roster not loaded falls back to the roster memo for phase and leaves the basis partial', () => {
    const r = deriveJ27Stage(page({ requestStatus: P2, phaseIStatus: PHASE_I_CHAIRS.invited }, { roster: NL, rosterMemo: PRESENT }));
    expect(r.phase).toBe('deliberations');
    expect(r.basis).toBe('partial');
    const absentMemo = deriveJ27Stage(page({ requestStatus: P2, phaseIStatus: PHASE_I_CHAIRS.invited }, { roster: NL, rosterMemo: ABSENT }));
    expect(absentMemo.phase).toBe('peer-review');
    expect(absentMemo.basis).toBe('partial');
  });
  test.each(['presentation', 'boardDraft', 'transition'])('tier 2 key %s not loaded on a peer-review row → partial', (key) => {
    const r = deriveJ27Stage(page({ requestStatus: P2, phaseIStatus: PHASE_I_CHAIRS.invited }, { [key]: NL }));
    expect(r.phase).toBe('peer-review');
    expect(r.basis).toBe('partial');
  });
  test('degraded wins over partial', () => {
    const r = deriveJ27Stage(tier1({}, { integrity: UNAVAILABLE }));
    expect(r.basis).toBe('degraded');
  });
  test('a decided row is full regardless of lower inputs', () => {
    expect(deriveJ27Stage(tier1({ statusClass: 'DECIDED_AWARD' }, { integrity: UNAVAILABLE })).basis).toBe('full');
  });
  test('board draft unavailable never yields write-board-draft or start-group-review', () => {
    const r = deriveJ27Stage(page({ requestStatus: P2, phaseIStatus: PHASE_I_CHAIRS.invited }, {
      visitAssessment: PRESENT, roster: { status: 'present', stale: false }, boardDraft: UNAVAILABLE,
      presentation: { status: 'present', exists: true, id: 'v', ended: true, legacyException: false },
    }));
    expect(r.taskKeys).not.toContain('write-board-draft');
    expect(r.taskKeys).not.toContain('start-group-review');
    expect(r.basis).toBe('degraded');
  });
  test('stale never changes basis', () => {
    expect(deriveJ27Stage(page({}, { reviewSummary: { status: 'stale', stale: true } })).basis).toBe('full');
  });
});

describe('C8.6 invariants', () => {
  test('recording keys are never blocked', () => {
    const blocked = new Set(Object.values(J27_BLOCKERS).flat());
    for (const key of J27_RECORDING_TASK_KEYS) expect(blocked.has(key)).toBe(false);
  });
  test('every blocked key is a task key or a presentation operation', () => {
    for (const key of Object.values(J27_BLOCKERS).flat()) {
      expect(J27_TASK_KEYS.includes(key) || J27_PRESENTATION_OPERATIONS.includes(key)).toBe(true);
    }
  });
  test('task phases are model phases and keys are unique', () => {
    for (const task of J27_TASKS) expect(J27_PHASES).toContain(task.phase);
    expect(new Set(J27_TASK_KEYS).size).toBe(J27_TASK_KEYS.length);
  });
  test('an Offramped row (D7) is terminal: no tasks, the offramped blocker, no presentation-only blocker', () => {
    const r = deriveJ27Stage(page({ requestStatus: P2, phaseIStatus: PHASE_I_CHAIRS.invited, phaseIIStatus: PHASE_II_OFFRAMPED }, {
      rationale: PRESENT, reviewSummary: PRESENT, reviewers: { status: 'present', anySuggestion: true, counts: counts({ candidates: 3, invited: 3, received: 3, completed: 3 }) },
    }));
    expect(keys(r)).toEqual({ phase: 'peer-review', basis: 'full', outcome: 'offramped', tasks: [], primary: null, blockers: ['offramped', 'presentation-end-unverified'] });
    expect(r.blockers.find((b) => b.key === 'offramped').blocks).toEqual([...J27_PRESENTATION_OPERATIONS, 'send-invitations']);
    // With a presentation record it stays in deliberations, still with no tasks.
    const d = deriveJ27Stage(page({ requestStatus: P2, phaseIStatus: PHASE_I_CHAIRS.invited, phaseIIStatus: PHASE_II_OFFRAMPED }, {
      rationale: PRESENT, presentation: { status: 'present', exists: true, id: 'v', ended: true, legacyException: false },
    }));
    expect(keys(d).phase).toBe('deliberations');
    expect(d.taskKeys).toEqual([]);
    // A decided award wins over the offramp value.
    expect(deriveOutcome('DECIDED_AWARD', { scoring: 'unset', chairsRecommendation: 'unset', chairsOutcome: 'pending' }, PHASE_II_OFFRAMPED)).toBe('decided-award');
    // Intake rows carry no offramp blocker.
    expect(deriveJ27Stage(tier1()).blockerKeys).not.toContain('offramped');
  });
  test.each([
    ['2027-03-15', '2027-03-14', false], ['2027-03-15', '2027-03-15', false], ['2027-03-15', '2027-03-16', true],
    ['2027-03-15T00:00:00Z', '2027-03-16', true], [null, '2027-03-16', null], ['2027-03-15', null, null],
  ])('pastOfframpDate for offramp %p on %p is %p', (offrampMeetingDate, today, expected) => {
    const r = deriveJ27Stage(tier1({ phaseIStatus: CHAIRS_RECOMMENDATION_STATUS.yes }, { calendar: { status: 'present', offrampMeetingDate, reviewsDueDate: null, today } }));
    expect(r.tasks.find((t) => t.key === 'record-offramp').detail.pastOfframpDate).toBe(expected);
  });
  test('calendar unavailable leaves pastOfframpDate null and degrades the basis', () => {
    const r = deriveJ27Stage(tier1({ phaseIStatus: CHAIRS_RECOMMENDATION_STATUS.yes }, { calendar: UNAVAILABLE }));
    expect(r.tasks.find((t) => t.key === 'record-offramp').detail.pastOfframpDate).toBeNull();
    expect(r.basis).toBe('degraded');
  });
  test('read-only capability is echoed, never a blocker', () => {
    const r = deriveJ27Stage(tier1({}, { capabilities: { status: 'present', readOnly: true } }));
    expect(r.readOnly).toBe(true);
    expect(r.blockerKeys).toEqual(ALWAYS);
    expect(r.taskKeys).toEqual(['record-rationale', 'record-scoring']);
  });
  test('reviewer counts arriving later keep anySuggestion', () => {
    const before = deriveJ27Stage(tier1({}, { reviewers: { status: 'present', anySuggestion: true, counts: NL } }));
    const after = deriveJ27Stage(tier1({}, { reviewers: { status: 'present', anySuggestion: true, counts: counts({ candidates: 0, completed: 0 }) } }));
    expect(before.phase).toBe('peer-review');
    expect(after.phase).toBe('peer-review');
    expect(after.taskKeys).toContain('identify-reviewers');
  });
  test('integrity with equal flagged match semantics: concerns without matches still flags', () => {
    const r = deriveJ27Stage(tier1({}, { integrity: { status: 'present', latest: { flagged: true, reviewed: false, provenance: 'manual-unverified-target' } } }));
    expect(r.taskKeys).toContain('review-integrity');
    const reviewed = deriveJ27Stage(tier1({}, { integrity: { status: 'present', latest: { flagged: true, reviewed: true, provenance: 'automated' } } }));
    expect(reviewed.taskKeys).not.toContain('review-integrity');
    expect(reviewed.blockerKeys).not.toContain('integrity-unreviewed');
  });
  test('identify-reviewers is secondary and never primary while another peer-review task qualifies', () => {
    const r = deriveJ27Stage(page({ requestStatus: P2, phaseIStatus: PHASE_I_CHAIRS.invited }, {
      rationale: PRESENT, reviewers: { status: 'present', anySuggestion: true, counts: counts({ candidates: 3, invited: 3, received: 1 }) },
    }));
    expect(r.taskKeys).toEqual(['identify-reviewers', 'read-reports', 'record-offramp']);
    expect(r.primaryTask).toBe('read-reports');
  });
});
