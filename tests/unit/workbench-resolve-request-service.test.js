/**
 * @jest-environment node
 *
 * lib/services/workbench/resolve-request-service — logic-level tests
 * (adapter mocked), Stage 4 series A extraction. The route characterization
 * pins the full DTO; this suite pins the service branches: GUID vs number
 * resolution, 404 message variants, CoPI degradation, statusClass mapping.
 */

const getById = jest.fn();
const findByRequestNumber = jest.fn();
// The admission policy itself is covered in workbench-phase-admission.test.js; here, only that the
// context asks it with the fresh cycle and returns its answer.
const resolvePhaseAdmission = jest.fn(async () => false);
jest.mock('../../lib/services/workbench/phase-admission', () => ({
  resolvePhaseAdmission: (...a) => resolvePhaseAdmission(...a),
}));
jest.mock('../../lib/dataverse/adapters/grant-request', () => ({
  getById: (...a) => getById(...a),
  findByRequestNumber: (...a) => findByRequestNumber(...a),
}));

const fetchCoPIs = jest.fn(async () => []);
jest.mock('../../lib/services/proposal-participants', () => ({
  fetchCoPIs: (...a) => fetchCoPIs(...a),
}));

const getCycleDatesById = jest.fn();
jest.mock('../../lib/dataverse/adapters/operations-grant-cycle', () => ({
  ...jest.requireActual('../../lib/dataverse/adapters/operations-grant-cycle'),
  getCycleDatesById: (...a) => getCycleDatesById(...a),
}));

const existsAnySuggestionForRequests = jest.fn(async () => new Set());
jest.mock('../../lib/dataverse/adapters/reviewer-suggestion', () => ({
  existsAnySuggestionForRequests: (...a) => existsAnySuggestionForRequests(...a),
}));
const readLatestIntegrityStates = jest.fn(async () => new Map());
jest.mock('../../lib/services/workbench/program-scope-service', () => ({
  resolveDiscoveryScope: jest.fn(async () => ({ readinessOnlyProgramIds: ['94cab30b-958f-ee11-8179-000d3a341e8f'] })),
}));
jest.mock('../../lib/services/workbench/j27-integrity-jobs', () => ({
  readLatestIntegrityStates: (...a) => readLatestIntegrityStates(...a),
}));

// The later-phase facts are mocked as one call (three batched Dataverse reads inside it:
// draft documents, Final documents, presentations; covered in j27-later-facts.test.js).
const loadJ27LaterFacts = jest.fn();
jest.mock('../../lib/services/workbench/j27-later-facts', () => ({
  ...jest.requireActual('../../lib/services/workbench/j27-later-facts'),
  loadJ27LaterFacts: (...a) => loadJ27LaterFacts(...a),
}));
const NO_PRESENTATION_FACTS = {
  presentation: { status: 'present', exists: false, id: null, ended: null, legacyException: false },
  roster: { status: 'absent' },
  boardDraft: { status: 'present', exists: false },
  transition: { status: 'present', phase: null },
};

import { resolveWorkbenchRequest } from '../../lib/services/workbench/resolve-request-service';
import { ServiceHttpError } from '../../lib/services/service-http-error';
import { STATUS_CLASS } from '../../lib/services/dataverse-export/constants';
import { processAnnotations } from '../../lib/services/dynamics/annotations';
import { DynamicsService } from '../../lib/services/dynamics-service';

const EXPAND = 'wmkf_GrantCycle($select=wmkf_cyclecode)';

const REQ = '11111111-1111-1111-1111-111111111111';
const CYCLE_ID = '22222222-2222-4222-8222-222222222222';
const RECORD = {
  akoya_requestid: REQ,
  akoya_requestnum: '1002794',
  akoya_title: 'A Study',
  _wmkf_grantcycle_value: CYCLE_ID,
  wmkf_GrantCycle: { wmkf_cyclecode: 'J26' },
  akoya_requeststatus: 'Some Unmapped Status',
};

beforeEach(() => {
  delete process.env.TEST_REQUEST_ISOLATION;
  jest.clearAllMocks();
  getById.mockResolvedValue(RECORD);
  findByRequestNumber.mockResolvedValue({ records: [RECORD] });
  fetchCoPIs.mockResolvedValue([]);
  getCycleDatesById.mockResolvedValue({ wmkf_grantcycleid: CYCLE_ID, wmkf_cyclecode: 'J26', wmkf_meetingdate: '2026-06-04' });
  existsAnySuggestionForRequests.mockResolvedValue(new Set());
  readLatestIntegrityStates.mockResolvedValue(new Map());
  loadJ27LaterFacts.mockImplementation(async (rows) => new Map(rows.map(r => [String(r.akoya_requestid).toLowerCase(), NO_PRESENTATION_FACTS])));
  // The link helpers check the wmkf_grantcycle restriction (covered in grant-cycle-link.test.js).
  jest.spyOn(DynamicsService, 'checkRestriction').mockImplementation(() => {});
});

afterEach(() => { delete process.env.TEST_REQUEST_ISOLATION; });

test('GUID path: adapter getById, DTO projected', async () => {
  const body = await resolveWorkbenchRequest({ requestId: REQ, requestNumber: '' });
  expect(getById).toHaveBeenCalledWith(REQ, expect.objectContaining({
    select: expect.stringContaining('wmkf_ai_fieldprimer'), expand: EXPAND,
  }));
  expect(getById.mock.calls[0][1].select).toContain('_wmkf_grantcycle_value');
  expect(getById.mock.calls[0][1].select).not.toContain('wmkf_meetingdate');
  expect(findByRequestNumber).not.toHaveBeenCalled();
  expect(body.requestId).toBe(REQ);
  // meetingDate is the linked cycle's calendar Board date, not the request's own date.
  expect(getCycleDatesById).toHaveBeenCalledWith(CYCLE_ID);
  expect(body).toMatchObject({ cycleCode: 'J26', cycleLabel: 'June 2026', meetingDate: '2026-06-04' });
});

test.each([['GUID', 'J27'], ['number', 'J27'], ['GUID', 'D27']])('%s path: exposes the normalized row version and Phase I status for %s', async (path, cycle) => {
  const row = processAnnotations({
    ...RECORD,
    wmkf_GrantCycle: { wmkf_cyclecode: cycle },
    wmkf_phaseistatus: 100000004,
    'wmkf_phaseistatus@OData.Community.Display.V1.FormattedValue': 'Scored',
    '@odata.etag': 'W/"123"',
  });
  getById.mockResolvedValue(row);
  findByRequestNumber.mockResolvedValue({ records: [row] });

  const body = await resolveWorkbenchRequest(path === 'GUID'
    ? { requestId: REQ, requestNumber: '' }
    : { requestId: '', requestNumber: RECORD.akoya_requestnum });

  expect(body).toMatchObject({
    requestVersion: 'W/"123"',
    phaseIStatus: 100000004,
    phaseIStatusLabel: 'Scored',
  });
});

test('a June meeting date with no Grant Cycle link has no cycle and no Board date', async () => {
  getById.mockResolvedValue({ ...RECORD, wmkf_meetingdate: '2026-06-01', _wmkf_grantcycle_value: null, wmkf_GrantCycle: null });
  const body = await resolveWorkbenchRequest({ requestId: REQ, requestNumber: '' });
  expect(body).toMatchObject({ cycleCode: null, cycleLabel: null, meetingDate: null });
  expect(getCycleDatesById).not.toHaveBeenCalled();
});

test('a historical (non-J/D) link has no cycle and no Board date', async () => {
  getById.mockResolvedValue({ ...RECORD, wmkf_GrantCycle: { wmkf_cyclecode: '2014-1' } });
  const body = await resolveWorkbenchRequest({ requestId: REQ, requestNumber: '' });
  expect(body).toMatchObject({ cycleCode: null, meetingDate: null });
  expect(getCycleDatesById).not.toHaveBeenCalled();
});

test('a calendar row with no Board date, a missing row, or a failed calendar read degrades to no Board date', async () => {
  getCycleDatesById.mockResolvedValueOnce({ wmkf_grantcycleid: CYCLE_ID, wmkf_cyclecode: 'J26', wmkf_meetingdate: null });
  expect((await resolveWorkbenchRequest({ requestId: REQ, requestNumber: '' })).meetingDate).toBeNull();
  getCycleDatesById.mockResolvedValueOnce(null);
  expect((await resolveWorkbenchRequest({ requestId: REQ, requestNumber: '' })).meetingDate).toBeNull();
  getCycleDatesById.mockRejectedValueOnce(new Error('calendar down'));
  const body = await resolveWorkbenchRequest({ requestId: REQ, requestNumber: '' });
  expect(body.meetingDate).toBeNull();
  expect(body.cycleCode).toBe('J26');
});

test('number path: findByRequestNumber with top 1', async () => {
  const body = await resolveWorkbenchRequest({ requestId: '', requestNumber: '1002794' });
  expect(findByRequestNumber).toHaveBeenCalledWith('1002794', expect.objectContaining({ top: 1, expand: EXPAND }));
  expect(getById).not.toHaveBeenCalled();
  expect(body.requestNumber).toBe('1002794');
});

test('Stage 1d: header DTO selects and emits only a derived badge when on', async () => {
  const off = await resolveWorkbenchRequest({ requestId: REQ, requestNumber: '' });
  expect(getById.mock.calls[0][1].select).not.toContain('wmkf_istestrequest');
  expect(off).not.toHaveProperty('isTestRequest');

  process.env.TEST_REQUEST_ISOLATION = 'on';
  getById.mockResolvedValue({
    ...RECORD,
    wmkf_istestrequest: true,
    wmkf_testcreationrunid: '22222222-2222-4222-8222-222222222222',
  });
  const on = await resolveWorkbenchRequest({ requestId: REQ, requestNumber: '' });
  expect(getById.mock.calls[1][1].select).toContain('wmkf_istestrequest,wmkf_testcreationrunid');
  expect(on.isTestRequest).toBe(true);
  expect(on).not.toHaveProperty('wmkf_istestrequest');
});

test('GUID miss → 404 with GUID in message; number miss → 404 with "number N"', async () => {
  getById.mockRejectedValue(new Error('not found'));
  const e1 = await resolveWorkbenchRequest({ requestId: REQ, requestNumber: '' }).catch((e) => e);
  expect(e1).toBeInstanceOf(ServiceHttpError);
  expect(e1.httpStatus).toBe(404);
  expect(e1.message).toBe(`No request found for ${REQ}`);

  findByRequestNumber.mockResolvedValue({ records: [] });
  const e2 = await resolveWorkbenchRequest({ requestId: '', requestNumber: '9999999' }).catch((e) => e);
  expect(e2.httpStatus).toBe(404);
  expect(e2.message).toBe('No request found for number 9999999');
});

test('CoPI failure degrades to an empty list, never throws', async () => {
  fetchCoPIs.mockRejectedValue(new Error('junction down'));
  const body = await resolveWorkbenchRequest({ requestId: REQ, requestNumber: '' });
  expect(body.proposalInfo.coPIs).toEqual([]);
});

test('statusClass: unmapped status → UNCLASSIFIED; null status → null', async () => {
  const body = await resolveWorkbenchRequest({ requestId: REQ, requestNumber: '' });
  expect(body.statusClass).toBe(STATUS_CLASS.UNCLASSIFIED);

  getById.mockResolvedValue({ ...RECORD, akoya_requeststatus: null });
  const body2 = await resolveWorkbenchRequest({ requestId: REQ, requestNumber: '' });
  expect(body2.statusClass).toBeNull();
  expect(body2.requestStatus).toBeNull();
});

describe('J27 read model (plan C7)', () => {
  const j27Row = (over = {}) => processAnnotations({
    ...RECORD, wmkf_GrantCycle: { wmkf_cyclecode: 'J27' }, akoya_requeststatus: 'Phase I Pending', wmkf_readyforreview: true,
    _wmkf_grantprogram_value: '94cab30b-958f-ee11-8179-000d3a341e8f', ...over,
  });
  test('a J27 row outside the Research scope carries no read model (plan F1 program gate)', async () => {
    getById.mockResolvedValue(j27Row({ _wmkf_grantprogram_value: '8dcab30b-958f-ee11-8179-000d3a341e8f' }));
    const body = await resolveWorkbenchRequest({ requestId: REQ, requestNumber: '' });
    expect(body).not.toHaveProperty('j27');
  });
  test('a failed catalog read yields no read model rather than a wrong one', async () => {
    const { resolveDiscoveryScope } = require('../../lib/services/workbench/program-scope-service');
    resolveDiscoveryScope.mockRejectedValueOnce(new Error('catalog down'));
    getById.mockResolvedValue(j27Row());
    const body = await resolveWorkbenchRequest({ requestId: REQ, requestNumber: '' });
    expect(body.success).toBe(true);
    expect(body).not.toHaveProperty('j27');
  });
  test('merge-dark: in a Production deployment without WORKBENCH_PHASE_RELEASE=on a J27 row gets no read model and none of the new reads', async () => {
    const env = jest.replaceProperty(process, 'env', { ...process.env, VERCEL_ENV: 'production' });
    try {
      getById.mockResolvedValue(j27Row());
      const body = await resolveWorkbenchRequest({ requestId: REQ, requestNumber: '' });
      expect(body.success).toBe(true);
      expect(body).not.toHaveProperty('j27');
      expect(existsAnySuggestionForRequests).not.toHaveBeenCalled();
      expect(readLatestIntegrityStates).not.toHaveBeenCalled();
      expect(loadJ27LaterFacts).not.toHaveBeenCalled();
      expect(require('../../lib/services/workbench/program-scope-service').resolveDiscoveryScope).not.toHaveBeenCalled();
      process.env.WORKBENCH_PHASE_RELEASE = 'on';
      expect(await resolveWorkbenchRequest({ requestId: REQ, requestNumber: '' })).toHaveProperty('j27');
    } finally {
      env.restore();
    }
  });
  test('a pre-2027 row carries no read model and makes neither new read', async () => {
    const body = await resolveWorkbenchRequest({ requestId: REQ, requestNumber: '' });
    expect(body).not.toHaveProperty('j27');
    expect(existsAnySuggestionForRequests).not.toHaveBeenCalled();
    expect(readLatestIntegrityStates).not.toHaveBeenCalled();
    expect(loadJ27LaterFacts).not.toHaveBeenCalled();
  });
  test('a J27 row adds one suggestion read, one integrity read and one later-facts load, and carries the stage with its tier 1 input', async () => {
    getById.mockResolvedValue(j27Row({ wmkf_phaseistatus: 707510005 }));
    getCycleDatesById.mockResolvedValue({ wmkf_grantcycleid: CYCLE_ID, wmkf_cyclecode: 'J27', wmkf_meetingdate: '2027-06-10', wmkf_researchofframpmeetingdate: '2027-03-15', wmkf_researchreviewsduedate: '2027-03-01' });
    existsAnySuggestionForRequests.mockResolvedValue(new Set([REQ]));
    readLatestIntegrityStates.mockResolvedValue(new Map([[REQ, { status: 'present', latest: { flagged: true, reviewed: false, provenance: 'automated' } }]]));
    const body = await resolveWorkbenchRequest({ requestId: REQ, requestNumber: '', today: new Date('2027-03-16T12:00:00Z') });
    expect(existsAnySuggestionForRequests).toHaveBeenCalledTimes(1);
    expect(existsAnySuggestionForRequests).toHaveBeenCalledWith([REQ], { concurrency: 4 });
    expect(readLatestIntegrityStates).toHaveBeenCalledTimes(1);
    expect(loadJ27LaterFacts).toHaveBeenCalledTimes(1);
    // Budget: Dataverse reads = suggestions (1) + program catalog (1) + later facts (one load, 3 batched
    // reads inside: drafts, Finals, presentations) = 5, plus one Postgres read (integrity).
    // No presentation exists in this setup, so its end is unverified and the stage says so (j27-read-model.js:246).
    expect(require('../../lib/services/workbench/program-scope-service').resolveDiscoveryScope).toHaveBeenCalledTimes(1);
    expect(getById).toHaveBeenCalledTimes(1);
    expect(body.meetingDate).toBe('2027-06-10');
    // Memo waves are off in this env: their keys are not-provisioned and do not degrade; tier 2 is not loaded, so partial (plan C1, C3).
    expect(body.j27).toMatchObject({
      phase: 'peer-review', basis: 'partial', outcome: 'none',
      recorded: { chairsRecommendation: 'yes', chairsOutcome: 'pending' },
      blockerKeys: ['chairs-outcome-pending', 'integrity-unreviewed', 'presentation-end-unverified'],
    });
    expect(body.j27.taskKeys).toEqual(['review-integrity', 'record-offramp']);
    expect(body.j27.tasks[1].detail).toEqual({ received: null, pastOfframpDate: true });
    expect(body.j27.input.reviewers).toEqual({ status: 'present', anySuggestion: true, counts: { status: 'not-loaded' } });
    expect(body.j27.input.calendar).toEqual({ status: 'present', offrampMeetingDate: '2027-03-15', reviewsDueDate: '2027-03-01', today: '2027-03-16' });
  });
  test('the later facts come from the server by one load and the phase follows them', async () => {
    const facts = {
      presentation: { status: 'present', exists: true, id: '77777777-7777-4777-8777-777777777777', ended: false, legacyException: false },
      roster: { status: 'absent' },
      boardDraft: { status: 'present', exists: false },
      transition: { status: 'present', phase: null },
    };
    loadJ27LaterFacts.mockResolvedValue(new Map([[REQ, facts]]));
    getById.mockResolvedValue(j27Row({ wmkf_phaseistatus: 707510005 }));
    getCycleDatesById.mockResolvedValue({ wmkf_grantcycleid: CYCLE_ID, wmkf_cyclecode: 'J27', wmkf_meetingdate: '2027-06-10' });
    const body = await resolveWorkbenchRequest({ requestId: REQ, requestNumber: '', today: new Date('2027-03-16T12:00:00Z') });
    expect(loadJ27LaterFacts).toHaveBeenCalledTimes(1);
    expect(loadJ27LaterFacts.mock.calls[0][0]).toEqual([expect.objectContaining({ akoya_requestid: REQ })]);
    const { presentation, roster, boardDraft, transition } = body.j27.input;
    expect({ presentation, roster, boardDraft, transition }).toEqual(facts);
    expect(body.j27.phase).toBe('deliberations');
  });
  test('failed new reads degrade the stage instead of failing resolution', async () => {
    getById.mockResolvedValue(j27Row());
    getCycleDatesById.mockRejectedValue(new Error('calendar 503'));
    existsAnySuggestionForRequests.mockRejectedValue(new Error('dataverse 503'));
    readLatestIntegrityStates.mockRejectedValue(new Error('no POSTGRES_URL'));
    const body = await resolveWorkbenchRequest({ requestId: REQ, requestNumber: '' });
    expect(body.meetingDate).toBeNull();
    expect(body.j27).toMatchObject({ phase: 'initial-assessment', basis: 'degraded' });
    expect(body.j27.input.reviewers.status).toBe('unavailable');
    expect(body.j27.input.integrity.status).toBe('unavailable');
    expect(body.j27.input.calendar.status).toBe('unavailable');
  });
});

describe('phase layout (request page admission)', () => {
  test('asks the shared policy with the request id and the linked cycle from this read, and returns its answer', async () => {
    resolvePhaseAdmission.mockResolvedValueOnce(true);
    getById.mockResolvedValue({ ...RECORD, wmkf_GrantCycle: { wmkf_cyclecode: 'J27' } });
    const body = await resolveWorkbenchRequest({ requestId: REQ, requestNumber: '' });
    expect(resolvePhaseAdmission).toHaveBeenCalledWith({ requestId: REQ, cycleCode: 'J27' });
    expect(body.phaseLayout).toBe(true);
  });

  test('a refusal is phaseLayout false', async () => {
    resolvePhaseAdmission.mockResolvedValueOnce(false);
    const body = await resolveWorkbenchRequest({ requestId: REQ, requestNumber: '' });
    expect(resolvePhaseAdmission).toHaveBeenCalledWith({ requestId: REQ, cycleCode: 'J26' });
    expect(body.phaseLayout).toBe(false);
  });
});
