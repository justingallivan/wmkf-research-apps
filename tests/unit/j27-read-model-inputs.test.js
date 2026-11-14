/**
 * @jest-environment node
 *
 * lib/services/workbench/j27-read-model-inputs — tier 1 assembly for the J27
 * read model (plan C7): projection widening, memo presence, batch facts and
 * their failure paths, calendar key, and the dashboard DTO.
 */
const existsAnySuggestionForRequests = jest.fn();
jest.mock('../../lib/dataverse/adapters/reviewer-suggestion', () => ({
  existsAnySuggestionForRequests: (...a) => existsAnySuggestionForRequests(...a),
}));
const readLatestIntegrityStates = jest.fn();
jest.mock('../../lib/services/workbench/j27-integrity-jobs', () => ({
  readLatestIntegrityStates: (...a) => readLatestIntegrityStates(...a),
}));
// Field readiness (sandbox rule or the Production switch) is covered in workbench-field-readiness.test.js.
jest.mock('../../lib/utils/workbench-field-readiness', () => ({
  reviewSummaryFieldsReady: () => process.env.TEST_SUMMARY_WAVE === 'on',
  rationaleFieldReady: () => process.env.TEST_RATIONALE_WAVE === 'on',
  rosterFieldReady: () => process.env.TEST_ROSTER_WAVE === 'on',
}));
jest.mock('../../lib/utils/j27-integrity-readiness', () => ({
  j27IntegrityTarget: () => process.env.TEST_INTEGRITY_TARGET || null,
  j27ChairsRecommendationEnabled: () => process.env.TEST_SEMI === 'on',
}));

import {
  withJ27ReadModelSelect, j27MemoAvailability, j27MemoInputs, j27RequestInput, loadJ27Facts,
  j27CalendarInput, composeJ27Tier1, deriveJ27ForRow, j27DashboardDto, j27ListStanding, isoDate, J27_MEMO_COLUMNS,
} from '../../lib/services/workbench/j27-read-model-inputs';

const REQ = '11111111-1111-4111-8111-111111111111';
const row = (over = {}) => ({
  akoya_requestid: REQ, akoya_requeststatus: 'Phase I Pending', wmkf_GrantCycle: { wmkf_cyclecode: 'J27' },
  wmkf_readyforreview: true, _wmkf_grantprogram_value: 'C247B11A-A7CB-EE11-9078-000D3A341E8F', ...over,
});
const facts = (over = {}) => ({ anySuggestion: new Set(), integrity: new Map(), ...over });
const calendar = { status: 'present', offrampMeetingDate: '2027-03-15', reviewsDueDate: '2027-03-01', today: '2026-11-09' };

beforeEach(() => {
  jest.clearAllMocks();
  for (const key of ['TEST_SUMMARY_WAVE', 'TEST_RATIONALE_WAVE', 'TEST_ROSTER_WAVE', 'TEST_INTEGRITY_TARGET', 'TEST_SEMI']) delete process.env[key];
  delete process.env.VERCEL_ENV;
});

describe('projection', () => {
  test('adds the request fields and only the provisioned memo columns', () => {
    expect(withJ27ReadModelSelect('akoya_requestid').split(',')).toEqual([
      'akoya_requestid', 'akoya_requeststatus', 'wmkf_phaseistatus', 'wmkf_phaseiistatus', 'wmkf_readyforreview', 'wmkf_triagestatus', '_wmkf_grantprogram_value',
      '_wmkf_currentpresitevisit_value', '_wmkf_currentfinalwriteup_value',
    ]);
    process.env.TEST_RATIONALE_WAVE = 'on';
    process.env.TEST_SUMMARY_WAVE = 'on';
    const select = withJ27ReadModelSelect('akoya_requestid,wmkf_phaseistatus');
    expect(select.split(',').filter((f) => f === 'wmkf_phaseistatus')).toHaveLength(1);
    expect(select).toContain(J27_MEMO_COLUMNS.rationale);
    expect(select).toContain(J27_MEMO_COLUMNS.reviewSummary);
    expect(select).toContain(J27_MEMO_COLUMNS.visitAssessment);
    expect(select).not.toContain(J27_MEMO_COLUMNS.rosterMemo);
  });
  test('the visit assessment column shares the review-summary gate', () => {
    process.env.TEST_SUMMARY_WAVE = 'on';
    expect(j27MemoAvailability()).toEqual({ rationale: false, reviewSummary: true, visitAssessment: true, rosterMemo: false });
  });
  test('never adds the test-request marker', () => {
    expect(withJ27ReadModelSelect('akoya_requestid')).not.toContain('wmkf_istestrequest');
  });
});

describe('memo presence', () => {
  test('unprovisioned waves are not-provisioned, never unavailable; provisioned read presence from the row, sparse rows read absent', () => {
    process.env.TEST_RATIONALE_WAVE = 'on';
    process.env.TEST_ROSTER_WAVE = 'on';
    const memo = j27MemoInputs(row({ wmkf_initialassessmentrationale: 'Saved', wmkf_confirmedmeetingroster: '   ' }));
    expect(memo).toEqual({
      rationale: { status: 'present' }, reviewSummary: { status: 'not-provisioned' },
      visitAssessment: { status: 'not-provisioned' }, rosterMemo: { status: 'absent' },
    });
    expect(j27MemoInputs(row()).rationale).toEqual({ status: 'absent' });
  });
});

describe('request input', () => {
  test('maps status class, lower-cases the program, and reads sparse fields as null or false', () => {
    const input = j27RequestInput(row({ akoya_requeststatus: 'Approved', wmkf_phaseistatus: 100000004, wmkf_phaseistatus_formatted: 'Scored' }));
    expect(input).toMatchObject({
      status: 'present', requestStatus: 'Approved', statusClass: 'DECIDED_AWARD', phaseIStatus: 100000004, phaseIStatusLabel: 'Scored',
      phaseIIStatus: null, readyForReview: true, cycleCode: 'J27', grantProgramId: 'c247b11a-a7cb-ee11-9078-000d3a341e8f', triageStatus: null, isTestRequest: false,
    });
    expect(j27RequestInput(row({ akoya_requeststatus: null })).statusClass).toBeNull();
    expect(j27RequestInput(row({ akoya_requeststatus: 'Mystery' })).statusClass).toBe('UNCLASSIFIED');
  });
});

describe('batch facts', () => {
  test('one suggestion read and one integrity read for the id list, integrity keyed by the configured target', async () => {
    process.env.TEST_INTEGRITY_TARGET = 'orgd9e66399.crm.dynamics.com';
    existsAnySuggestionForRequests.mockResolvedValue(new Set([REQ]));
    readLatestIntegrityStates.mockResolvedValue(new Map());
    const loaded = await loadJ27Facts([REQ, 'other']);
    expect(existsAnySuggestionForRequests).toHaveBeenCalledTimes(1);
    expect(existsAnySuggestionForRequests).toHaveBeenCalledWith([REQ, 'other'], { concurrency: 4 });
    expect(readLatestIntegrityStates).toHaveBeenCalledWith('orgd9e66399.crm.dynamics.com', [REQ, 'other']);
    expect(loaded.anySuggestion.has(REQ)).toBe(true);
  });
  test('each failed read yields null independently', async () => {
    existsAnySuggestionForRequests.mockRejectedValue(new Error('dataverse down'));
    readLatestIntegrityStates.mockResolvedValue(new Map([[REQ, { status: 'present', latest: null }]]));
    const loaded = await loadJ27Facts([REQ]);
    expect(loaded.anySuggestion).toBeNull();
    expect(loaded.integrity.get(REQ)).toEqual({ status: 'present', latest: null });
    existsAnySuggestionForRequests.mockResolvedValue(new Set());
    readLatestIntegrityStates.mockRejectedValue(new Error('no POSTGRES_URL'));
    const again = await loadJ27Facts([REQ]);
    expect(again.anySuggestion).toEqual(new Set());
    expect(again.integrity).toBeNull();
  });
});

describe('composition', () => {
  test('a null fact marks its key unavailable on the row; counts default to not-loaded', () => {
    const input = composeJ27Tier1(row(), { anySuggestion: null, integrity: null }, { calendar });
    expect(input.reviewers).toEqual({ status: 'unavailable', counts: { status: 'not-loaded' } });
    expect(input.integrity).toEqual({ status: 'unavailable' });
    expect(input.presentation).toEqual({ status: 'not-loaded' });
  });
  test('loaded facts, counts and capability flow through', () => {
    process.env.TEST_SEMI = 'on';
    const input = composeJ27Tier1(row(), facts({ anySuggestion: new Set([REQ]), integrity: new Map([[REQ, { status: 'present', latest: { flagged: true, reviewed: false, provenance: 'automated' } }]]) }), {
      calendar, counts: { candidates: 1, invited: 0, accepted: 0, received: 0, completed: 0 }, env: { VERCEL_ENV: 'preview', DYNAMICS_URL: 'https://wmkf.crm.dynamics.com' },
    });
    expect(input.reviewers).toEqual({ status: 'present', anySuggestion: true, counts: { status: 'present', candidates: 1, invited: 0, accepted: 0, received: 0, completed: 0 } });
    expect(input.integrity.latest.flagged).toBe(true);
    expect(input.capabilities).toEqual({ status: 'present', readOnly: true });
    expect(input.features).toEqual({ status: 'present', chairsRecommendationEnabled: true });
  });
  test('a per-partition read failure reaches the row as unavailable', () => {
    const input = composeJ27Tier1(row(), facts({ integrity: new Map([[REQ, { status: 'unavailable', detail: 'read-failed' }]]) }), { calendar });
    expect(input.integrity).toEqual({ status: 'unavailable', detail: 'read-failed' });
  });
  test('a request with no screening reads integrity present with latest null', () => {
    expect(composeJ27Tier1(row(), facts(), { calendar }).integrity).toEqual({ status: 'present', latest: null });
  });
  test('calendar key from the cycle row, unavailable when the read failed', () => {
    expect(j27CalendarInput({ wmkf_researchofframpmeetingdate: '2027-03-15', wmkf_researchreviewsduedate: null }, '2026-11-09'))
      .toEqual({ status: 'present', offrampMeetingDate: '2027-03-15', reviewsDueDate: null, today: '2026-11-09' });
    expect(j27CalendarInput(null, '2026-11-09')).toEqual({ status: 'unavailable' });
    expect(isoDate(new Date('2026-11-09T23:59:00Z'))).toBe('2026-11-09');
  });
  test('deriveJ27ForRow returns null off scope and a stage with its input in scope', () => {
    const scope = { readinessOnlyProgramIds: ['c247b11a-a7cb-ee11-9078-000d3a341e8f'] };
    expect(deriveJ27ForRow(row({ wmkf_GrantCycle: { wmkf_cyclecode: 'D26' } }), facts(), { calendar, scope })).toBeNull();
    expect(deriveJ27ForRow(row({ wmkf_GrantCycle: null }), facts(), { calendar, scope })).toBeNull();
    // Program gate: a J27 row outside the readiness-only (Research) scope, or an empty scope, carries no stage.
    expect(deriveJ27ForRow(row({ _wmkf_grantprogram_value: '8dcab30b-958f-ee11-8179-000d3a341e8f' }), facts(), { calendar, scope })).toBeNull();
    expect(deriveJ27ForRow(row(), facts(), { calendar, scope: { readinessOnlyProgramIds: [] } })).toBeNull();
    expect(deriveJ27ForRow(row(), facts(), { calendar })).toBeNull();
    const stage = deriveJ27ForRow(row(), facts(), { calendar, scope });
    expect(stage.phase).toBe('initial-assessment');
    expect(stage.input.request.cycleCode).toBe('J27');
    expect(j27DashboardDto(stage)).toEqual({
      phase: 'initial-assessment', basis: 'partial', primaryTask: 'record-scoring', taskKeys: ['record-scoring'],
      blockerKeys: [], recorded: stage.recorded, outcome: 'none', timing: null, review: null,
    });
  });
});

describe('j27ListStanding', () => {
  const pres = (over) => ({ presentation: { status: 'present', exists: true, id: 'p1', ended: true, legacyException: false, ...over } });
  test('presentation not loaded or unavailable: timing null', () => {
    expect(j27ListStanding({ presentation: { status: 'not-loaded' } }).timing).toBeNull();
    expect(j27ListStanding({ presentation: { status: 'unavailable' } }).timing).toBeNull();
    expect(j27ListStanding({}).timing).toBeNull();
  });
  test('no presentation row: not-scheduled', () => {
    expect(j27ListStanding(pres({ exists: false, id: null, ended: null })).timing).toBe('not-scheduled');
  });
  test('an existing presentation: after, before or unconfirmed by its ended flag', () => {
    expect(j27ListStanding(pres({ ended: true })).timing).toBe('after');
    expect(j27ListStanding(pres({ ended: false })).timing).toBe('before');
    expect(j27ListStanding(pres({ ended: null })).timing).toBe('unconfirmed');
  });
  test('a transition phase wins over an existing Board draft', () => {
    const input = { boardDraft: { status: 'present', exists: true }, transition: { status: 'present', phase: 'group-review' } };
    expect(input.boardDraft.exists).toBe(true);
    expect(j27ListStanding(input).review).toBe('group-review');
  });
  test('a Board draft with no transition phase: board-draft', () => {
    expect(j27ListStanding({ boardDraft: { status: 'present', exists: true }, transition: { status: 'present', phase: null } }).review).toBe('board-draft');
  });
  test('Board draft unavailable: review null', () => {
    expect(j27ListStanding({ boardDraft: { status: 'unavailable' }, transition: { status: 'present', phase: null } }).review).toBeNull();
    expect(j27ListStanding({ boardDraft: { status: 'unavailable' }, transition: { status: 'unavailable' } }).review).toBeNull();
  });
});

describe('deriveJ27ForRow with later-phase facts', () => {
  const scope = { readinessOnlyProgramIds: ['c247b11a-a7cb-ee11-9078-000d3a341e8f'] };
  const neutral = {
    presentation: { status: 'present', exists: false, id: null, ended: null, legacyException: false },
    roster: { status: 'absent' },
    boardDraft: { status: 'present', exists: false },
    transition: { status: 'present', phase: null },
  };
  test('a Map keyed by the lower-cased request id places Deliberations and Final Assessment rows', () => {
    const key = REQ.toLowerCase();
    const withPresentation = { ...neutral, presentation: { ...neutral.presentation, exists: true, id: 'p1', ended: true } };
    const d = deriveJ27ForRow(row(), facts(), { calendar, scope, later: new Map([[key, withPresentation]]) });
    expect(d.phase).toBe('deliberations');
    const f = deriveJ27ForRow(row(), facts(), { calendar, scope, later: new Map([[key, { ...neutral, boardDraft: { status: 'present', exists: true } }]]) });
    expect(f.phase).toBe('final-assessment');
  });
  test('a row whose id is not in the Map keeps all four keys not-loaded', () => {
    const later = new Map([['22222222-2222-4222-8222-222222222222', neutral]]);
    const stage = deriveJ27ForRow(row(), facts(), { calendar, scope, later });
    for (const k of ['presentation', 'roster', 'boardDraft', 'transition']) expect(stage.input[k]).toEqual({ status: 'not-loaded' });
    expect(stage.basis).toBe('partial');
  });
});
