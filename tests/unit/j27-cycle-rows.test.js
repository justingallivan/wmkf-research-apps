import { deriveJ27Stage, J27_TASKS, J27_OUTCOMES } from '../../lib/services/workbench/j27-read-model';
import { j27DashboardDto } from '../../lib/services/workbench/j27-read-model-inputs';
import { SCORING_STATUS, CHAIRS_RECOMMENDATION_STATUS } from '../../shared/config/j27Scoring';
import {
  J27_REVIEWER_STAGE_LABEL, J27_STANDING_LABEL, J27_WAIT_LABEL, J27_IDLE_LABEL, J27_DEGRADED_NOTE,
  J27_TIMING_LABEL, J27_REVIEW_STANDING_LABEL, J27_TASK_LABEL,
} from '../../shared/config/j27Labels';
import {
  isClosedRow, standingKey, rowChip, rowLine, rowNotes, outstandingReviews, matchesPhaseFilters, matchesSearch, matchesShowing, rowsForTab,
  standingCounts, tabCounts, degradedEverywhere, J27_SHOWING_KEYS, J27_SHOWING_LABEL,
} from '../../shared/utils/j27CycleRows';

const INVITED = 100000003;
const NOT_INVITED = 100000002;
const NL = { status: 'not-loaded' };
const counts = (over = {}) => ({ status: 'present', candidates: 0, invited: 0, accepted: 0, received: 0, completed: 0, ...over });

/** A dashboard row as the list receives it: the model's stage through the server's slim DTO. */
function row(request = {}, over = {}, extra = {}) {
  const input = {
    request: {
      status: 'present', requestStatus: 'Phase I Pending', statusClass: 'IN_FLIGHT', phaseIStatus: 100000000,
      phaseIStatusLabel: null, phaseIIStatus: null, readyForReview: true, cycleCode: 'J27', ...request,
    },
    rationale: { status: 'present' }, reviewSummary: { status: 'absent' }, visitAssessment: { status: 'absent' },
    rosterMemo: { status: 'absent' },
    reviewers: { status: 'present', anySuggestion: false, counts: counts() },
    integrity: { status: 'present', latest: null },
    calendar: { status: 'present', today: '2027-01-15', offrampMeetingDate: null },
    capabilities: { status: 'present', readOnly: false },
    features: { status: 'present', chairsRecommendationEnabled: true },
    presentation: NL, roster: NL, boardDraft: NL, transition: NL,
    ...over,
  };
  return {
    requestId: 'r1', requestNumber: '1009001', title: 'Mapping signalling lipids', institution: 'Northfield University',
    projectLeader: 'Alex Sample', programDirector: 'Jordan Example', workRemaining: 'find',
    j27: j27DashboardDto(deriveJ27Stage(input)), ...extra,
  };
}

const notScored = () => row();
const scored = () => row({ phaseIStatus: SCORING_STATUS.yes });
const recommended = (over) => row({ phaseIStatus: CHAIRS_RECOMMENDATION_STATUS.yes }, over);
const invited = (request = {}, over, extra) => row({ phaseIStatus: INVITED, ...request }, over, extra);

describe('label coverage', () => {
  test('the Showing menu lists open, everything and every ending', () => {
    expect(J27_SHOWING_KEYS.slice(2).sort()).toEqual(J27_OUTCOMES.filter((key) => key !== 'none').sort());
    for (const key of J27_SHOWING_KEYS) expect(typeof J27_SHOWING_LABEL[key]).toBe('string');
  });
  test('the optional tasks are exactly the two the model marks secondary', () => {
    expect(J27_TASKS.filter((task) => task.secondary).map((task) => task.key)).toEqual(['identify-reviewers', 'record-offramp']);
  });
});

describe('the four January samples (build plan finding 1)', () => {
  test('not yet scored: chip and the scoring task', () => {
    const r = notScored();
    expect(rowChip(r)).toMatchObject({ kind: 'standing', key: 'not-yet-scored', label: J27_STANDING_LABEL['not-yet-scored'] });
    expect(rowLine(r)).toMatchObject({ kind: 'next', key: 'record-scoring' });
  });
  test('scored: the recommendation task', () => {
    const r = scored();
    expect(rowChip(r).key).toBe('scored');
    expect(rowLine(r)).toMatchObject({ kind: 'next', key: 'record-chairs-recommendation' });
  });
  test('recommended: the model says Identify reviewers; the row says it is waiting on the Chairs', () => {
    const r = recommended();
    expect(r.j27.primaryTask).toBe('identify-reviewers');
    expect(rowChip(r).key).toBe('recommended');
    expect(rowLine(r)).toEqual({ kind: 'wait', key: 'chairs-outcome-pending', text: J27_WAIT_LABEL['chairs-outcome-pending'] });
  });
  test('invited without the Phase II status: Identify reviewers leads in Peer Review', () => {
    const r = invited();
    expect(r.j27.phase).toBe('peer-review');
    expect(r.j27.blockerKeys).toContain('phase-two-status-pending');
    expect(rowChip(r)).toMatchObject({ kind: 'reviewer-stage', label: J27_REVIEWER_STAGE_LABEL.find });
    expect(rowLine(r)).toMatchObject({ kind: 'next', key: 'identify-reviewers' });
  });
});

describe('line ordering', () => {
  test('a recommended request that already has reviewer suggestions still waits on the Chairs', () => {
    const r = recommended({ reviewers: { status: 'present', anySuggestion: true, counts: counts({ candidates: 2 }) } });
    expect(r.j27.phase).toBe('peer-review');
    expect(rowLine(r).key).toBe('chairs-outcome-pending');
  });
  test('a main task outranks a wait', () => {
    const r = recommended({ rationale: { status: 'absent' } });
    expect(rowLine(r)).toMatchObject({ kind: 'next', key: 'record-rationale' });
  });
  test('an unreviewed integrity finding is a main task', () => {
    const r = recommended({ integrity: { status: 'present', latest: { flagged: true, reviewed: false } } });
    expect(rowLine(r)).toMatchObject({ kind: 'next', key: 'review-integrity' });
  });
  test('invited, reviewers complete, Phase II status missing: the invitations line', () => {
    const r = invited({}, {
      reviewSummary: { status: 'present' },
      reviewers: { status: 'present', anySuggestion: true, counts: counts({ candidates: 3, invited: 3, accepted: 3, received: 3, completed: 3 }) },
    });
    expect(r.j27.taskKeys).toEqual(['record-offramp']);
    expect(rowLine(r)).toEqual({ kind: 'wait', key: 'phase-two-status-pending', text: J27_WAIT_LABEL['phase-two-status-pending'] });
  });
  test('the optional offramp task never leads: an invited, fully reviewed request is idle', () => {
    const r = invited({ requestStatus: 'Phase II Pending' }, {
      reviewSummary: { status: 'present' },
      reviewers: { status: 'present', anySuggestion: true, counts: counts({ candidates: 3, invited: 3, accepted: 3, received: 3, completed: 3 }) },
    });
    expect(r.j27.primaryTask).toBe('record-offramp');
    expect(rowLine(r)).toEqual({ kind: 'idle', text: J27_IDLE_LABEL });
  });
  test('an idle row says nothing when a read failed', () => {
    const r = invited({ requestStatus: 'Phase II Pending' }, {
      integrity: { status: 'unavailable' },
      reviewSummary: { status: 'present' },
      reviewers: { status: 'present', anySuggestion: true, counts: counts({ candidates: 3, invited: 3, accepted: 3, received: 3, completed: 3 }) },
    });
    expect(r.j27.basis).toBe('degraded');
    expect(rowLine(r)).toEqual({ kind: 'none', text: null });
  });
  test('a memo-placed Deliberations row: plain phase chip, no optional task leading', () => {
    const r = invited({ requestStatus: 'Phase II Pending' }, {
      reviewSummary: { status: 'present' }, visitAssessment: { status: 'present' },
      reviewers: { status: 'present', anySuggestion: true, counts: counts({ candidates: 3, invited: 3, accepted: 3, received: 3, completed: 3 }) },
    });
    expect(r.j27.phase).toBe('deliberations');
    expect(rowChip(r)).toEqual({ kind: 'phase', key: 'deliberations', label: 'Deliberations' });
    // No known presentation timing: a Deliberations row shows no line, so the optional task cannot lead.
    expect(rowLine(r)).toEqual({ kind: 'none', text: null });
    expect(rowLine(r).text).not.toBe(J27_TASK_LABEL['identify-reviewers']);
  });
});

describe('closed rows', () => {
  test('each recorded ending closes the row and shows no line', () => {
    const cases = [
      [row({ phaseIStatus: SCORING_STATUS.no }), 'not-scored', 'Not Scored'],
      [row({ phaseIStatus: CHAIRS_RECOMMENDATION_STATUS.no }), 'not-recommended', 'Not Recommended'],
      [row({ phaseIStatus: NOT_INVITED }), 'not-invited', 'Not Invited'],
      [invited({ phaseIIStatus: 682090001 }), 'offramped', 'Offramped'],
      [invited({ statusClass: 'DECIDED_AWARD' }), 'decided-award', 'Awarded'],
      [invited({ statusClass: 'DECIDED_NO_AWARD' }), 'decided-no-award', 'Not awarded'],
      [row({ statusClass: 'WITHDRAWN' }), 'withdrawn', 'Withdrawn'],
    ];
    for (const [r, key, label] of cases) {
      expect(isClosedRow(r)).toBe(true);
      expect(rowChip(r)).toEqual({ kind: 'closed', key, label });
      expect(rowLine(r)).toEqual({ kind: 'none', text: null });
      expect(matchesShowing(r, 'open')).toBe(false);
      expect(matchesShowing(r, key)).toBe(true);
      expect(matchesShowing(r, 'everything')).toBe(true);
    }
  });
  test('a Phase I status the model does not map is closed under its Dataverse label (owner decision 1)', () => {
    const r = row({ phaseIStatus: 999, phaseIStatusLabel: 'Ineligible' });
    expect(r.j27.taskKeys).toContain('record-scoring');
    expect(isClosedRow(r)).toBe(true);
    expect(rowChip(r)).toEqual({ kind: 'closed', key: 'unmapped', label: 'Ineligible' });
    expect(rowLine(r).kind).toBe('none');
    expect(standingKey(r)).toBeNull();
    expect(matchesShowing(r, 'open')).toBe(false);
    expect(matchesShowing(r, 'everything')).toBe(true);
    expect(J27_SHOWING_KEYS.slice(2).some((key) => matchesShowing(r, key))).toBe(false);
  });
});

describe('notes, search, tabs and counts', () => {
  test('only a failed read earns the note; a partial row does not', () => {
    expect(notScored().j27.basis).toBe('partial');
    expect(rowNotes(notScored())).toEqual([]);
    const degraded = row({}, { integrity: { status: 'unavailable' } });
    expect(degraded.j27.basis).toBe('degraded');
    expect(rowNotes(degraded)).toEqual([{ kind: 'degraded', text: J27_DEGRADED_NOTE }]);
  });
  test('when every request is affected the list says it once, not on each row', () => {
    const degraded = () => row({}, { integrity: { status: 'unavailable' } });
    expect(degradedEverywhere([degraded(), degraded()])).toBe(true);
    expect(degradedEverywhere([degraded(), notScored()])).toBe(false);
    expect(degradedEverywhere([degraded()])).toBe(false);
    // A closed request (usually hidden) does not stop the list saying it once.
    const closed = row({ phaseIStatus: NOT_INVITED });
    expect(closed.j27.basis).not.toBe('degraded');
    expect(degradedEverywhere([degraded(), degraded(), closed])).toBe(true);
    expect(degradedEverywhere([])).toBe(false);
    expect(rowNotes(degraded(), { suppressDegraded: true })).toEqual([]);
  });
  test('a review still owed is said in words only once the request has left Peer Review', () => {
    const past = (outstanding, over = {}) => invited({ requestStatus: 'Phase II Pending' }, {
      reviewSummary: { status: 'present' }, visitAssessment: { status: 'present' }, ...over,
    }, { reviewers: { outstanding } });
    expect(past(1).j27.phase).toBe('deliberations');
    expect(rowNotes(past(1))).toEqual([{ kind: 'outstanding', text: '1 review outstanding' }]);
    expect(rowNotes(past(2))).toEqual([{ kind: 'outstanding', text: '2 reviews outstanding' }]);
    expect(rowNotes(past(0))).toEqual([]);
    expect(rowNotes(past(undefined))).toEqual([]);
    // Still in Peer Review: the reviewer bar on that tab carries it.
    expect(outstandingReviews(invited({}, {}, { reviewers: { outstanding: 2 } }))).toBe(0);
    // Closed: nothing is owed.
    expect(outstandingReviews(invited({ phaseIIStatus: 682090001 }, { visitAssessment: { status: 'present' } }, { reviewers: { outstanding: 1 } }))).toBe(0);
    // Both notes can apply.
    expect(rowNotes(past(1, { integrity: { status: 'unavailable' } })).map((note) => note.kind)).toEqual(['outstanding', 'degraded']);
  });
  test('phase filters: Show closed, and a standing lists only the open rows that stand there', () => {
    const closed = row({ phaseIStatus: SCORING_STATUS.no });
    expect(matchesPhaseFilters(closed)).toBe(false);
    expect(matchesPhaseFilters(closed, { showClosed: true })).toBe(true);
    expect(matchesPhaseFilters(closed, { showClosed: true, standing: 'scored' })).toBe(false);
    expect(matchesPhaseFilters(scored(), { standing: 'scored' })).toBe(true);
    expect(matchesPhaseFilters(notScored(), { standing: 'scored' })).toBe(false);
    expect(matchesPhaseFilters(recommended(), { standing: 'recommended' })).toBe(true);
  });
  test('search covers number, title, institution and Principal Investigator', () => {
    const r = notScored();
    for (const q of ['1009001', 'signalling', 'northfield', 'alex sample', '  ', '']) expect(matchesSearch(r, q)).toBe(true);
    expect(matchesSearch(r, 'Jordan Example')).toBe(false);
    expect(matchesSearch(r, 'no such')).toBe(false);
  });
  test('a row without a stage is neither closed nor chipped', () => {
    const bare = { requestId: 'x', requestNumber: '1' };
    expect(isClosedRow(bare)).toBe(false);
    expect(rowChip(bare)).toBeNull();
    expect(rowLine(bare)).toEqual({ kind: 'none', text: null });
    expect(matchesShowing(bare, 'open')).toBe(true);
  });
  test('phase tabs filter by the derived phase; other tabs list every row', () => {
    const rows = [notScored(), scored(), recommended(), invited(), row({ phaseIStatus: SCORING_STATUS.no })];
    expect(rowsForTab(rows, 'requests')).toHaveLength(5);
    expect(rowsForTab(rows, 'initial-assessment')).toHaveLength(4);
    expect(rowsForTab(rows, 'peer-review')).toHaveLength(1);
    expect(standingCounts(rows)).toEqual({ 'not-yet-scored': 1, scored: 1, recommended: 1 });
  });
  test('a tab count is the number of rows of that phase with a Next line', () => {
    const rows = [notScored(), scored(), recommended(), invited(), row({ phaseIStatus: SCORING_STATUS.no })];
    expect(tabCounts(rows)).toEqual({
      'initial-assessment': 2, 'peer-review': 1, deliberations: 0, 'final-assessment': 0,
    });
  });
});

/** A row whose stage is overridden: the feed's j27 with the given fields. */
const withJ27 = (r, patch) => ({ ...r, j27: { ...r.j27, ...patch } });
const deliberations = (patch) => withJ27(row(), { phase: 'deliberations', basis: 'complete', ...patch });
const finalAssessment = (patch) => withJ27(row(), { phase: 'final-assessment', basis: 'complete', ...patch });

describe('later-phase lists', () => {
  test.each(['not-scheduled', 'before', 'unconfirmed'])('a Deliberations row with timing %s: timing chip, no line, even with a read-reports task', (timing) => {
    const r = deliberations({ timing, primaryTask: 'read-reports', taskKeys: ['read-reports'] });
    expect(r.j27.primaryTask).toBe('read-reports');
    expect(rowChip(r)).toEqual({ kind: 'timing', key: timing, label: J27_TIMING_LABEL[timing] });
    expect(rowLine(r)).toEqual({ kind: 'none', text: null });
  });
  test('a Deliberations row after its presentation shows its Next task', () => {
    const r = deliberations({ timing: 'after', primaryTask: 'confirm-roster', taskKeys: ['confirm-roster'] });
    expect(rowChip(r)).toEqual({ kind: 'timing', key: 'after', label: J27_TIMING_LABEL.after });
    const line = rowLine(r);
    expect(line.kind).toBe('next');
    expect(line.text).toBe(J27_TASK_LABEL['confirm-roster']);
  });
  test.each(['board-draft', 'group-review', 'leadership-review'])('a Final Assessment row at %s: review chip', (review) => {
    expect(rowChip(finalAssessment({ review }))).toEqual({ kind: 'review', key: review, label: J27_REVIEW_STANDING_LABEL[review] });
  });
  test('a Final Assessment row with no known review falls back to the phase chip', () => {
    const r = finalAssessment({ review: null });
    expect(r.j27.review).toBeNull();
    expect(rowChip(r)).toEqual({ kind: 'phase', key: 'final-assessment', label: 'Final Assessment' });
  });
  test('rowsForTab filters Deliberations and Final Assessment by phase', () => {
    const d = deliberations({ timing: 'before' });
    const f = finalAssessment({ review: 'board-draft' });
    const rows = [notScored(), d, f, invited()];
    expect(rowsForTab(rows, 'deliberations')).toEqual([d]);
    expect(rowsForTab(rows, 'final-assessment')).toEqual([f]);
  });
  test('tabCounts counts a Deliberations row after its presentation, not one before it that also has a task', () => {
    const after = deliberations({ timing: 'after', primaryTask: 'confirm-roster', taskKeys: ['confirm-roster'] });
    const before = deliberations({ timing: 'before', primaryTask: 'read-reports', taskKeys: ['read-reports'] });
    expect(rowLine(before).kind).toBe('none');
    expect(tabCounts([after, before]).deliberations).toBe(1);
  });
});
