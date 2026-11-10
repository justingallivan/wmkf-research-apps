/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { composeJ27PageInput, deriveJ27PageStage, j27CountsInput, j27OverviewInputs, j27FinalWriteupInputs } from '../../shared/utils/j27PageStage';
import J27StageStrip, { J27_PHASE_LABEL, J27_TASK_LABEL, J27_BLOCKER_LABEL, J27_OUTCOME_LABEL, visibleBlockerKeys } from '../../shared/components/workbench/J27StageStrip';
import { J27_PHASES, J27_TASK_KEYS, J27_BLOCKER_KEYS, J27_OUTCOMES, PHASE_I_CHAIRS } from '../../lib/services/workbench/j27-read-model';
import { CHAIRS_RECOMMENDATION_STATUS } from '../../shared/config/j27Scoring';

const RESEARCH = '94cab30b-958f-ee11-8179-000d3a341e8f';
const NL = { status: 'not-loaded' };
const ABSENT = { status: 'absent' };
const PRESENT = { status: 'present' };
/** The server's tier 1 input as the resolve DTO carries it (counts and tier 2 not loaded). */
function serverInput(request = {}, over = {}) {
  return {
    request: {
      status: 'present', requestStatus: 'Phase I Pending', statusClass: 'IN_FLIGHT', phaseIStatus: null, phaseIStatusLabel: null,
      phaseIIStatus: null, readyForReview: true, cycleCode: 'J27', grantProgramId: RESEARCH, triageStatus: null, isTestRequest: false, ...request,
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

describe('label maps cover the read model vocabularies exactly', () => {
  test('phases', () => { expect(Object.keys(J27_PHASE_LABEL).sort()).toEqual([...J27_PHASES].sort()); });
  test('tasks', () => { expect(Object.keys(J27_TASK_LABEL).sort()).toEqual([...J27_TASK_KEYS].sort()); });
  test('blockers', () => { expect(Object.keys(J27_BLOCKER_LABEL).sort()).toEqual([...J27_BLOCKER_KEYS].sort()); });
  test('outcomes', () => { expect(Object.keys(J27_OUTCOME_LABEL).sort()).toEqual([...J27_OUTCOMES].sort()); });
  test('presentation-only blockers are not shown; task blockers show from their phase onward', () => {
    expect(visibleBlockerKeys(['offramped'], 'initial-assessment')).toEqual([]);
    expect(visibleBlockerKeys(['offramped', 'integrity-unreviewed', 'phase-two-status-pending'], 'peer-review')).toEqual(['offramped', 'integrity-unreviewed', 'phase-two-status-pending']);
    expect(visibleBlockerKeys(['integrity-unreviewed', 'presentation-end-unverified'], 'initial-assessment')).toEqual([]);
    expect(visibleBlockerKeys(['integrity-unreviewed', 'presentation-end-unverified'], 'peer-review')).toEqual(['integrity-unreviewed']);
    expect(visibleBlockerKeys(['integrity-unreviewed', 'presentation-end-unverified'], 'final-assessment')).toEqual(['integrity-unreviewed', 'presentation-end-unverified']);
  });
});

describe('fact mapping', () => {
  test('reviewer rollup: loading keeps the server key, error is unavailable, ready carries numbers', () => {
    expect(j27CountsInput({ status: 'loading' })).toBeNull();
    expect(j27CountsInput({ status: 'error', data: null })).toEqual({ status: 'unavailable' });
    expect(j27CountsInput({ status: 'ready', data: { counts: { candidates: 2, received: 'x' } } }))
      .toEqual({ status: 'present', candidates: 2, invited: 0, accepted: 0, received: 0, completed: 0 });
  });
  test('overview handoffs: booleans become presence, null becomes unavailable, undefined leaves the server value', () => {
    expect(j27OverviewInputs({ rationale: true, review: false, visit: null, meeting: undefined })).toEqual({
      rationale: PRESENT, reviewSummary: ABSENT, visitAssessment: { status: 'unavailable' },
    });
    expect(j27OverviewInputs({ meeting: null })).toEqual({ presentation: { status: 'unavailable' }, roster: { status: 'unavailable' } });
    expect(j27OverviewInputs({ meeting: { presentation: false } })).toEqual({
      presentation: { status: 'present', exists: false, id: null, ended: null, legacyException: false }, roster: ABSENT,
    });
    expect(j27OverviewInputs({ meeting: { presentation: true, presentationId: 'v1', roster: true, rosterStale: true } })).toEqual({
      presentation: { status: 'present', exists: true, id: 'v1', ended: null, legacyException: false }, roster: { status: 'present', stale: true },
    });
  });
  test('final writeup: ended / upcoming / missing / not_checked map to ended true / false / null / null', () => {
    const existing = { status: 'present', exists: true, id: 'v1', ended: null, legacyException: false };
    expect(j27FinalWriteupInputs({ available: true, phase: 'ready', sourceArtifactId: 'a', presentationSchedule: 'ended' }, existing).presentation)
      .toEqual({ ...existing, ended: true });
    expect(j27FinalWriteupInputs({ available: true, phase: 'ready', sourceArtifactId: 'a', presentationSchedule: 'upcoming' }, existing).presentation)
      .toEqual({ ...existing, ended: false });
    expect(j27FinalWriteupInputs({ available: true, phase: 'ready', sourceArtifactId: 'a', presentationSchedule: 'missing', startCompatibilityReason: 'legacy_complete_review_without_schedule' }, existing).presentation)
      .toEqual({ ...existing, ended: null, legacyException: true });
    expect(j27FinalWriteupInputs({ available: true, phase: 'ready', sourceArtifactId: 'a', presentationSchedule: 'not_checked' }, existing).presentation).toEqual(existing);
    // Without an Overview meeting read, the schedule check alone speaks: timing unknown, legacy exception kept.
    expect(j27FinalWriteupInputs({ available: true, phase: 'ready', sourceArtifactId: 'a', presentationSchedule: 'unverified', startCompatibilityReason: 'legacy_review_schedule_unverified' }, null).presentation)
      .toEqual({ status: 'present', exists: null, id: null, ended: null, legacyException: true });
    expect(j27FinalWriteupInputs({ available: true, phase: 'ready', sourceArtifactId: 'a', presentationSchedule: 'not_checked' }, null).presentation)
      .toEqual({ status: 'present', exists: null, id: null, ended: null, legacyException: false });
    expect(j27FinalWriteupInputs({ available: true, phase: 'group-review', sourceArtifactId: 'a' }, null)).toEqual({
      boardDraft: { status: 'present', exists: true }, transition: { status: 'present', phase: 'group-review' },
    });
    expect(j27FinalWriteupInputs({ available: true, phase: 'starting', sourceArtifactId: null }, null)).toEqual({
      boardDraft: { status: 'present', exists: false }, transition: { status: 'present', phase: null },
    });
    expect(j27FinalWriteupInputs({ error: true }, null)).toEqual({ boardDraft: { status: 'unavailable' }, transition: { status: 'unavailable' } });
    expect(j27FinalWriteupInputs({ error: true, code: 'final_writeup_source_missing' }, null)).toEqual({ boardDraft: { status: 'present', exists: false }, transition: { status: 'present', phase: null } });
    expect(j27FinalWriteupInputs({ error: true, code: 'final_writeup_source_ineligible' }, null)).toEqual({ boardDraft: { status: 'unavailable' }, transition: { status: 'unavailable' } });
    expect(j27FinalWriteupInputs({ available: false, phase: 'unavailable' }, null)).toEqual({ boardDraft: { status: 'unavailable' }, transition: { status: 'unavailable' } });
  });
});

describe('page recomputation', () => {
  test('no facts yet: the page derives exactly what the server derived', () => {
    const input = serverInput();
    expect(composeJ27PageInput(input, {})).toEqual(input);
    expect(deriveJ27PageStage(input, {}).basis).toBe('partial');
  });
  test('the rollup landing moves a Recommended Invite row from awaiting counts to the dashboard shape', () => {
    const input = serverInput({ phaseIStatus: CHAIRS_RECOMMENDATION_STATUS.yes }, { rationale: PRESENT });
    const before = deriveJ27PageStage(input, {});
    const after = deriveJ27PageStage(input, { progress: { status: 'ready', data: { counts: { candidates: 0 } } } });
    expect(before.taskKeys).toEqual(['record-offramp']);
    expect(after.taskKeys).toEqual(['identify-reviewers', 'record-offramp']);
    expect(after.blockerKeys).toContain('chairs-outcome-pending');
  });
  test('the Final Writeup state landing on an Invited row with a presentation reaches full basis', () => {
    const input = serverInput({ requestStatus: 'Phase II Pending', phaseIStatus: PHASE_I_CHAIRS.invited, phaseIIStatus: 100000002 }, { rationale: PRESENT, reviewSummary: PRESENT });
    const facts = {
      progress: { status: 'ready', data: { counts: { candidates: 3, invited: 3, accepted: 3, received: 3, completed: 3 } } },
      overview: { rationale: true, review: true, visit: true, meeting: { presentation: true, presentationId: 'v1', roster: true, rosterStale: false } },
      finalWriteup: { available: true, phase: 'ready', sourceArtifactId: 'a', presentationSchedule: 'ended' },
    };
    const stage = deriveJ27PageStage(input, facts);
    expect(stage.phase).toBe('final-assessment');
    expect(stage.basis).toBe('full');
    expect(stage.taskKeys).toContain('start-group-review');
    expect(stage.blockerKeys).not.toContain('presentation-end-unverified');
  });
  test('no Draft Writeup yet surfaces write-board-draft once the presentation assessment is saved', () => {
    const input = serverInput({ requestStatus: 'Phase II Pending', phaseIStatus: PHASE_I_CHAIRS.invited, phaseIIStatus: 100000002 }, { rationale: PRESENT, reviewSummary: PRESENT, visitAssessment: PRESENT });
    const stage = deriveJ27PageStage(input, {
      progress: { status: 'ready', data: { counts: { candidates: 3, invited: 3, accepted: 3, received: 3, completed: 3 } } },
      overview: { rationale: true, review: true, visit: true, meeting: { presentation: true, presentationId: 'v1', roster: true, rosterStale: false } },
      finalWriteup: { error: true, code: 'final_writeup_source_missing' },
    });
    expect(stage.taskKeys).toContain('write-board-draft');
    expect(stage.basis).not.toBe('degraded');
  });
  test('an explicit legacy schedule exception permits start-group-review without an Overview meeting read', () => {
    const input = serverInput({ requestStatus: 'Phase II Pending', phaseIStatus: PHASE_I_CHAIRS.invited, phaseIIStatus: 100000002 }, { rationale: PRESENT, reviewSummary: PRESENT, visitAssessment: PRESENT });
    const stage = deriveJ27PageStage(input, {
      progress: { status: 'ready', data: { counts: { candidates: 3, invited: 3, accepted: 3, received: 3, completed: 3 } } },
      finalWriteup: { available: true, phase: 'ready', sourceArtifactId: 'a', presentationSchedule: 'unverified', startCompatibilityReason: 'legacy_review_schedule_unverified' },
    });
    expect(stage.taskKeys).toContain('start-group-review');
    expect(stage.blockerKeys).not.toContain('presentation-end-unverified');
  });
  test('summary freshness reaches the model only when known, and only on a saved summary', () => {
    const input = serverInput({ requestStatus: 'Phase II Pending', phaseIStatus: PHASE_I_CHAIRS.invited, phaseIIStatus: 100000002 }, { rationale: PRESENT, reviewSummary: PRESENT });
    expect(composeJ27PageInput(input, {}).reviewSummary).toEqual(PRESENT);
    expect(composeJ27PageInput(input, { summaryStale: true }).reviewSummary).toEqual({ status: 'present', stale: true });
    expect(composeJ27PageInput(input, { summaryStale: false }).reviewSummary).toEqual({ status: 'present', stale: false });
    expect(deriveJ27PageStage(input, { summaryStale: true }).blockerKeys).toContain('evidence-stale');
    expect(composeJ27PageInput(serverInput(), { summaryStale: true }).reviewSummary).toEqual(ABSENT);
  });
  test('a failed rollup degrades the basis rather than hiding the row', () => {
    const stage = deriveJ27PageStage(serverInput(), { progress: { status: 'error', data: null } });
    expect(stage.basis).toBe('degraded');
  });
});

describe('strip', () => {
  test('shows the phase, the next task, and task blockers; hides presentation-only blockers', () => {
    render(<J27StageStrip stage={{ phase: 'peer-review', basis: 'partial', primaryTask: 'identify-reviewers', taskKeys: ['identify-reviewers'], blockerKeys: ['phase-two-status-pending', 'presentation-end-unverified'] }} />);
    const strip = screen.getByLabelText('Where this request stands');
    expect(strip).toHaveTextContent('Peer Review');
    expect(strip).toHaveTextContent('Next: Identify reviewers');
    expect(strip).toHaveTextContent('Some facts load as you open tabs.');
    expect(strip).toHaveTextContent('Pending Committee Review');
    expect(strip).not.toHaveTextContent('end has not been verified');
  });
  test('renders nothing for an unclassified or missing stage', () => {
    const { container } = render(<J27StageStrip stage={{ phase: 'unclassified', blockerKeys: [] }} />);
    expect(container).toBeEmptyDOMElement();
  });
  test('an offramped row shows the outcome badge and no next task', () => {
    render(<J27StageStrip stage={{ phase: 'peer-review', basis: 'full', outcome: 'offramped', primaryTask: null, taskKeys: [], blockerKeys: ['offramped'] }} />);
    const strip = screen.getByLabelText('Where this request stands');
    expect(strip).toHaveTextContent('Offramped');
    expect(strip).toHaveTextContent('took the offramp');
    expect(strip).not.toHaveTextContent('Nothing is waiting');
  });
  test('the idle sentence waits for a full basis', () => {
    const idle = { phase: 'peer-review', primaryTask: null, taskKeys: [], blockerKeys: [], outcome: 'none', recorded: {} };
    const view = render(<J27StageStrip stage={{ ...idle, basis: 'partial' }} />);
    expect(screen.getByLabelText('Where this request stands')).not.toHaveTextContent('Nothing is waiting');
    view.rerender(<J27StageStrip stage={{ ...idle, basis: 'full' }} />);
    expect(screen.getByLabelText('Where this request stands')).toHaveTextContent('Nothing is waiting on staff right now.');
  });
  test('a decided row shows the phase alone', () => {
    render(<J27StageStrip stage={{ phase: 'decided', basis: 'full', primaryTask: null, taskKeys: [], blockerKeys: [] }} />);
    const strip = screen.getByLabelText('Where this request stands');
    expect(strip).toHaveTextContent('Decided');
    expect(strip).not.toHaveTextContent('Nothing is waiting');
  });
});
