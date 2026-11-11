/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { composeJ27PageInput, deriveJ27PageStage, j27CountsInput, j27OverviewInputs, j27FinalWriteupInputs } from '../../shared/utils/j27PageStage';
import J27StageStrip, { J27_PHASE_LABEL, J27_TASK_LABEL, J27_BLOCKER_LABEL, J27_OUTCOME_LABEL, visibleBlockerKeys } from '../../shared/components/workbench/J27StageStrip';
import { composeJ27Tier1 } from '../../lib/services/workbench/j27-read-model-inputs';
import { J27_PHASES, deriveJ27Stage, J27_TASK_KEYS, J27_BLOCKER_KEYS, J27_OUTCOMES, PHASE_I_CHAIRS } from '../../lib/services/workbench/j27-read-model';
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
    // A draft not yet shared for review is "no Board draft", as the server's documentFacts says
    // (later-phase lists plan, step 1). Step E had mapped it to unavailable; list and page now agree.
    expect(j27FinalWriteupInputs({ error: true, code: 'final_writeup_source_ineligible' }, null)).toEqual({ boardDraft: { status: 'present', exists: false }, transition: { status: 'present', phase: null } });
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
  test('an earlier phase\'s open task is a note, not the next step (owner, 2026-11-11)', () => {
    // As seen on #1000370: in Peer Review with the staff rationale still unrecorded.
    render(<J27StageStrip stage={{ phase: 'peer-review', basis: 'full', outcome: 'none', recorded: {}, primaryTask: 'record-rationale', taskKeys: ['record-rationale', 'identify-reviewers'], blockerKeys: [] }} />);
    const strip = screen.getByLabelText('Where this request stands');
    expect(strip).toHaveTextContent('Next: Identify reviewers');
    expect(strip).not.toHaveTextContent(`Next: ${J27_TASK_LABEL['record-rationale']}`);
    expect(strip).toHaveTextContent(`Still open from an earlier phase: ${J27_TASK_LABEL['record-rationale']}`);
  });
  test('with only an earlier phase\'s task open the strip names it and does not call the request idle', () => {
    render(<J27StageStrip stage={{ phase: 'peer-review', basis: 'full', outcome: 'none', recorded: {}, primaryTask: 'record-rationale', taskKeys: ['record-rationale'], blockerKeys: [] }} />);
    const strip = screen.getByLabelText('Where this request stands');
    expect(strip).not.toHaveTextContent('Next:');
    expect(strip).not.toHaveTextContent('Nothing is waiting');
    expect(strip).toHaveTextContent(`Still open from an earlier phase: ${J27_TASK_LABEL['record-rationale']}`);
  });
  test('a decided row shows the phase alone', () => {
    render(<J27StageStrip stage={{ phase: 'decided', basis: 'full', primaryTask: null, taskKeys: [], blockerKeys: [] }} />);
    const strip = screen.getByLabelText('Where this request stands');
    expect(strip).toHaveTextContent('Decided');
    expect(strip).not.toHaveTextContent('Nothing is waiting');
  });
});

describe('server-supplied later-phase facts (stageFacts)', () => {
  const PRES_ENDED = { status: 'present', exists: true, id: 'v', ended: true, legacyException: false };
  const PRES_UPCOMING = { ...PRES_ENDED, ended: false };
  const FINAL_STATUS = { available: true, phase: 'ready', sourceArtifactId: 'a', presentationSchedule: 'not_checked' };

  test('j27FinalWriteupInputs with stageFacts returns exactly those three keys and ignores presentationSchedule', () => {
    const stageFacts = {
      presentation: PRES_UPCOMING, boardDraft: { status: 'present', exists: true }, transition: { status: 'present', phase: 'group-review' },
    };
    // The schedule says 'ended' and the status says no draft; the whole keys must win over both.
    const out = j27FinalWriteupInputs({ ...FINAL_STATUS, presentationSchedule: 'ended', sourceArtifactId: null, phase: 'ready', stageFacts }, PRES_ENDED);
    expect(out).toEqual(stageFacts);
    expect(Object.keys(out).sort()).toEqual(['boardDraft', 'presentation', 'transition']);
  });

  test('serverLoaded with no stageFacts never changes the server presentation; the legacy path still changes it', () => {
    const base = { ...serverInput({ requestStatus: 'Phase II Pending', phaseIStatus: PHASE_I_CHAIRS.invited, phaseIIStatus: 100000002 }) };
    const serverPresentation = { status: 'present', exists: true, id: 'v', ended: true, legacyException: false };
    const finalWriteup = { ...FINAL_STATUS, phase: 'group-review' };
    const loaded = composeJ27PageInput({ ...base, presentation: serverPresentation, boardDraft: { status: 'present', exists: true }, transition: { status: 'present', phase: null } }, { finalWriteup });
    expect(loaded.presentation).toEqual(serverPresentation);
    expect(loaded.presentation.ended).toBe(true);
    // The status still speaks for the keys it owns.
    expect(loaded.transition).toEqual({ status: 'present', phase: 'group-review' });
    // Legacy: the server keys are 'not-loaded' (boardDraft too), so the schedule check overwrites the presentation with ended null.
    const legacy = composeJ27PageInput({ ...base, presentation: serverPresentation, boardDraft: NL, transition: NL }, { finalWriteup });
    expect(legacy.presentation.ended).toBeNull();
  });

  test('serverLoaded with a failed status report leaves the server boardDraft and transition alone', () => {
    const server = { ...serverInput(), presentation: PRES_ENDED, boardDraft: { status: 'present', exists: true }, transition: { status: 'present', phase: 'group-review' } };
    const out = composeJ27PageInput(server, { finalWriteup: { error: true, code: 'whatever' } });
    expect(out.boardDraft).toEqual(server.boardDraft);
    expect(out.transition).toEqual(server.transition);
    expect(out.presentation).toEqual(PRES_ENDED);
    // Control: without server keys, the same failed report does make them unavailable.
    expect(composeJ27PageInput(serverInput(), { finalWriteup: { error: true, code: 'whatever' } }).boardDraft).toEqual({ status: 'unavailable' });
  });

  test('j27OverviewInputs: meeting.stageFacts replaces presentation and roster; without it the legacy mapping applies', () => {
    const stageFacts = { presentation: PRES_ENDED, roster: { status: 'present', stale: false } };
    // The legacy fields disagree on purpose (no presentation, no roster): the whole keys must win.
    expect(j27OverviewInputs({ meeting: { presentation: false, roster: false, stageFacts } })).toEqual(stageFacts);
    expect(j27OverviewInputs({ meeting: { presentation: false, roster: false } })).toEqual({
      presentation: { status: 'present', exists: false, id: null, ended: null, legacyException: false }, roster: ABSENT,
    });
  });

  // List and page must agree on phase, tasks, primary task and blockers. Review-summary freshness
  // (`summaryStale`) is deliberately not in the page facts: the owner accepted that one difference.
  describe('parity: list stage from the server input equals page stage from page facts', () => {
    const calendar = { status: 'present', offrampMeetingDate: '2027-03-15', reviewsDueDate: '2027-03-01', today: '2027-03-20' };
    const counts = { candidates: 3, invited: 3, accepted: 3, received: 3, completed: 3 };
    const row = {
      akoya_requestid: '11111111-1111-4111-8111-111111111111', akoya_requeststatus: 'Phase II Pending',
      wmkf_phaseistatus: PHASE_I_CHAIRS.invited, wmkf_phaseiistatus: 100000002, wmkf_readyforreview: true,
      _wmkf_grantprogram_value: RESEARCH, wmkf_GrantCycle: { wmkf_cyclecode: 'J27' },
    };
    const facts = { anySuggestion: new Set([row.akoya_requestid]), integrity: new Map() };
    const none = { status: 'present', exists: false };
    const cases = [
      ['presentation scheduled but not ended',
        { presentation: PRES_UPCOMING, roster: ABSENT, boardDraft: none, transition: { status: 'present', phase: null } }],
      ['presentation ended with no roster',
        { presentation: PRES_ENDED, roster: ABSENT, boardDraft: none, transition: { status: 'present', phase: null } }],
      ['Board draft shared with an ended presentation',
        { presentation: PRES_ENDED, roster: { status: 'present', stale: false }, boardDraft: { status: 'present', exists: true }, transition: { status: 'present', phase: 'group-review' } }],
    ];
    test.each(cases)('%s', (_name, later) => {
      const base = composeJ27Tier1(row, facts, { calendar, counts, later, availability: { rationale: false, reviewSummary: false, visitAssessment: false, rosterMemo: false } });
      const server = { ...base, rationale: PRESENT, reviewSummary: PRESENT, visitAssessment: PRESENT };
      const list = deriveJ27Stage(server);
      const pageFacts = {
        progress: { status: 'ready', data: { counts } },
        overview: { meeting: { presentation: later.presentation.exists, presentationId: 'v', stageFacts: { presentation: later.presentation, roster: later.roster } } },
        finalWriteup: { ...FINAL_STATUS, phase: later.transition.phase || 'ready', stageFacts: { presentation: later.presentation, boardDraft: later.boardDraft, transition: later.transition } },
      };
      const pick = (stage) => ({ phase: stage.phase, taskKeys: stage.taskKeys, primaryTask: stage.primaryTask, blockerKeys: stage.blockerKeys });
      // The page's own server input has none of the later keys, so the page facts alone must supply them.
      const noLater = { ...server, presentation: NL, roster: NL, boardDraft: NL, transition: NL, reviewers: { ...server.reviewers, counts: NL } };
      expect(pick(deriveJ27PageStage(noLater, pageFacts))).toEqual(pick(list));
      // And with the server keys supplied (the real page), the same facts leave the stage unchanged.
      expect(pick(deriveJ27PageStage(server, pageFacts))).toEqual(pick(list));
      expect(list.phase).not.toBe('initial-assessment');
    });
  });
});

describe('report order and reopened drafts (Codex build review 3)', () => {
  const server = (over = {}) => ({
    request: { status: 'present', cycleCode: 'J27', phaseIStatus: 100000003, requestStatus: 'Phase II Pending', statusClass: 'IN_FLIGHT' },
    visitAssessment: { status: 'present' },
    roster: { status: 'present', stale: false },
    presentation: { status: 'present', exists: true, id: 'v1', ended: true, legacyException: false },
    boardDraft: { status: 'present', exists: true },
    transition: { status: 'present', phase: null },
    ...over,
  });

  test('a reopened draft reported after resolution replaces the server\'s "draft exists"', () => {
    const facts = { finalWriteup: { error: true, code: 'final_writeup_source_ineligible' }, order: { finalWriteup: 1 } };
    const input = composeJ27PageInput(server(), facts);
    expect(input.boardDraft).toEqual({ status: 'present', exists: false });
    const stage = deriveJ27PageStage(server(), facts);
    expect(stage.taskKeys).toContain('write-board-draft');
    expect(stage.taskKeys).not.toContain('start-group-review');
    // Any other failed status read leaves the server's facts alone.
    expect(composeJ27PageInput(server(), { finalWriteup: { error: true, code: 'something_else' } }).boardDraft)
      .toEqual({ status: 'present', exists: true });
  });

  const fwBefore = { stageFacts: {
    presentation: { status: 'present', exists: true, id: 'v1', ended: false, legacyException: false },
    boardDraft: { status: 'present', exists: true }, transition: { status: 'present', phase: null },
  }, available: true };
  const overviewAfter = { meeting: { presentation: true, stageFacts: {
    presentation: { status: 'present', exists: true, id: 'v1', ended: true, legacyException: false },
    roster: { status: 'present', stale: false },
  } } };

  test('a newer Overview read wins over an older Final Writeup read of the presentation', () => {
    const facts = { finalWriteup: fwBefore, overview: overviewAfter, order: { finalWriteup: 1, overview: 2 } };
    expect(composeJ27PageInput(server(), facts).presentation.ended).toBe(true);
    expect(deriveJ27PageStage(server(), facts).blockerKeys).not.toContain('presentation-not-ended');
  });

  test('a newer Final Writeup read wins over an older Overview read', () => {
    const facts = { finalWriteup: fwBefore, overview: overviewAfter, order: { overview: 1, finalWriteup: 2 } };
    expect(composeJ27PageInput(server(), facts).presentation.ended).toBe(false);
  });

  test('with server facts loaded, a failed or older-shaped Overview meeting read leaves them alone', () => {
    const failed = { overview: { meeting: null }, order: { overview: 1 } };
    expect(composeJ27PageInput(server(), failed).presentation.ended).toBe(true);
    const legacyShape = { overview: { meeting: { presentation: true, presentationId: 'v1', roster: true } }, order: { overview: 1 } };
    expect(composeJ27PageInput(server(), legacyShape).presentation.ended).toBe(true);
  });
});

describe('the strip\'s next step in Deliberations (Codex build review 3, round 2)', () => {
  const server = {
    request: { status: 'present', cycleCode: 'J27', phaseIStatus: 100000003, requestStatus: 'Phase II Pending', statusClass: 'IN_FLIGHT' },
    rationale: { status: 'present' }, reviewSummary: { status: 'present' }, visitAssessment: { status: 'present' },
    roster: { status: 'present', stale: false },
    presentation: { status: 'present', exists: true, id: 'v1', ended: true, legacyException: false },
    boardDraft: { status: 'present', exists: true },
    transition: { status: 'present', phase: null },
  };

  test('a reopened draft after an ended presentation reads "Write the Draft Writeup" on the strip', () => {
    const facts = { finalWriteup: { error: true, code: 'final_writeup_source_ineligible' }, order: { finalWriteup: 1 } };
    const stage = deriveJ27PageStage(server, facts);
    expect(stage.phase).toBe('deliberations');
    expect(stage.timing).toBe('after');
    render(<J27StageStrip stage={stage} />);
    expect(screen.getByText(new RegExp(J27_TASK_LABEL['write-board-draft']))).toBeInTheDocument();
    expect(screen.queryByText(new RegExp(J27_TASK_LABEL['start-group-review']))).toBeNull();
  });

  test('before the presentation ends the strip, like the list, shows no next step', () => {
    const before = { ...server, visitAssessment: { status: 'absent' }, roster: { status: 'absent' }, boardDraft: { status: 'present', exists: false },
      presentation: { ...server.presentation, ended: false } };
    const stage = deriveJ27PageStage(before, {});
    expect(stage.phase).toBe('deliberations');
    expect(stage.timing).toBe('before');
    render(<J27StageStrip stage={stage} />);
    expect(screen.queryByText(/^Next:/)).toBeNull();
  });
});
