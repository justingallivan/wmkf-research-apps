/**
 * Proposal list snapshot — actor-independent cycle membership, test-request
 * separation, and refusal of incomplete reads
 * (docs/plans/J27_PROPOSAL_LIST_EMAILS_PLAN_2026-11-18.md).
 *
 * @jest-environment node
 */
const RESEARCH = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const RUN = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

jest.mock('../../lib/services/workbench/program-scope-service.js', () => ({
  resolveDiscoveryScope: jest.fn(async () => ({ readinessOnlyProgramIds: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'] })),
}));

import {
  loadCycleProposalSnapshot,
  PROPOSAL_LIST_MAX_PROPOSALS,
  UNASSIGNED_SECTION,
} from '../../lib/services/proposal-lists/list-snapshot-service';
import { DynamicsService } from '../../lib/services/dynamics-service.js';

function guid(n) {
  return `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`;
}

function request(n, overrides = {}) {
  return {
    akoya_requestid: guid(n),
    akoya_requestnum: String(1000 + n),
    akoya_title: `Proposal ${n}`,
    _akoya_applicantid_value_formatted: `University ${n}`,
    _wmkf_projectleader_value_formatted: `Leader ${n}`,
    _wmkf_programareaserved_value_formatted: 'Physics',
    _wmkf_grantprogram_value: RESEARCH,
    wmkf_readyforreview: true,
    wmkf_GrantCycle: { wmkf_cyclecode: 'J27' },
    wmkf_istestrequest: null,
    wmkf_testcreationrunid: null,
    ...overrides,
  };
}

function deps(records, { capped = false, isolation = true } = {}) {
  return {
    queryRequests: jest.fn(async () => ({ records, capped, hasMore: false })),
    listPrograms: jest.fn(),
    isolationEnabled: () => isolation,
  };
}

let originalIsolation;
beforeAll(() => {
  originalIsolation = process.env.TEST_REQUEST_ISOLATION;
  process.env.TEST_REQUEST_ISOLATION = 'on';
});
beforeEach(() => {
  // The link helpers check the wmkf_grantcycle restriction (covered in grant-cycle-link.test.js).
  jest.spyOn(DynamicsService, 'checkRestriction').mockImplementation(() => {});
});
afterAll(() => {
  if (originalIsolation === undefined) delete process.env.TEST_REQUEST_ISOLATION;
  else process.env.TEST_REQUEST_ISOLATION = originalIsolation;
});

describe('loadCycleProposalSnapshot', () => {
  test('lists every ready proposal in the cycle with title, institution, PI, and section', async () => {
    const d = deps([request(1), request(2, { _wmkf_programareaserved_value_formatted: '' })]);
    const rows = await loadCycleProposalSnapshot({ cycleCode: 'j27', listKind: 'ordinary' }, d);
    expect(rows).toEqual([
      { requestId: guid(1), requestNumber: '1001', title: 'Proposal 1', institution: 'University 1', projectLeader: 'Leader 1', section: 'Physics' },
      { requestId: guid(2), requestNumber: '1002', title: 'Proposal 2', institution: 'University 2', projectLeader: 'Leader 2', section: UNASSIGNED_SECTION },
    ]);
  });

  test('the query carries no Program Director or caller scope', async () => {
    const d = deps([request(1)]);
    await loadCycleProposalSnapshot({ cycleCode: 'J27', listKind: 'ordinary' }, d);
    const { filter } = d.queryRequests.mock.calls[0][0];
    expect(filter).not.toMatch(/programdirector/i);
    expect(filter).toContain('wmkf_readyforreview eq true');
  });

  test('a proposal that is not ready is left out', async () => {
    const d = deps([request(1), request(2, { wmkf_readyforreview: false })]);
    const rows = await loadCycleProposalSnapshot({ cycleCode: 'J27', listKind: 'ordinary' }, d);
    expect(rows.map((r) => r.requestNumber)).toEqual(['1001']);
  });

  test('an ordinary list leaves test requests out; a test list holds only them', async () => {
    const records = [request(1), request(2, { wmkf_istestrequest: true, wmkf_testcreationrunid: RUN })];
    const ordinary = await loadCycleProposalSnapshot({ cycleCode: 'J27', listKind: 'ordinary' }, deps(records));
    const test = await loadCycleProposalSnapshot({ cycleCode: 'J27', listKind: 'test' }, deps(records));
    expect(ordinary.map((r) => r.requestNumber)).toEqual(['1001']);
    expect(test.map((r) => r.requestNumber)).toEqual(['1002']);
  });

  test('a marked row with no run id belongs to neither list', async () => {
    const records = [request(1, { wmkf_istestrequest: true, wmkf_testcreationrunid: null })];
    expect(await loadCycleProposalSnapshot({ cycleCode: 'J27', listKind: 'ordinary' }, deps(records))).toEqual([]);
    expect(await loadCycleProposalSnapshot({ cycleCode: 'J27', listKind: 'test' }, deps(records))).toEqual([]);
  });

  test('a test list is refused when test-request isolation is off', async () => {
    const d = deps([request(1)], { isolation: false });
    await expect(loadCycleProposalSnapshot({ cycleCode: 'J27', listKind: 'test' }, d))
      .rejects.toMatchObject({ httpStatus: 409, code: 'proposal_list_test_unavailable' });
    expect(d.queryRequests).not.toHaveBeenCalled();
  });

  test('a capped read fails the whole snapshot instead of truncating', async () => {
    await expect(loadCycleProposalSnapshot({ cycleCode: 'J27', listKind: 'ordinary' }, deps([request(1)], { capped: true })))
      .rejects.toMatchObject({ httpStatus: 503, code: 'proposal_list_membership_incomplete' });
  });

  test('a row from another cycle fails verification', async () => {
    const d = deps([request(1), request(2, { wmkf_GrantCycle: { wmkf_cyclecode: 'D26' } })]);
    await expect(loadCycleProposalSnapshot({ cycleCode: 'J27', listKind: 'ordinary' }, d))
      .rejects.toMatchObject({ code: 'proposal_list_membership_invalid' });
  });

  test('more proposals than one list supports is refused', async () => {
    const records = Array.from({ length: PROPOSAL_LIST_MAX_PROPOSALS + 1 }, (_, i) => request(i + 1));
    await expect(loadCycleProposalSnapshot({ cycleCode: 'J27', listKind: 'ordinary' }, deps(records)))
      .rejects.toMatchObject({ httpStatus: 413 });
  });

  test.each(['', 'J2027', 'X27'])('rejects the cycle code %p', async (code) => {
    await expect(loadCycleProposalSnapshot({ cycleCode: code, listKind: 'ordinary' }, deps([])))
      .rejects.toMatchObject({ httpStatus: 400 });
  });
});
