/**
 * GET /api/workbench/grantee-deliverables/awardees — research-awardee list.
 *
 * @jest-environment node
 */
jest.mock('../../lib/utils/auth', () => ({ requireAppAccess: jest.fn() }));
jest.mock('../../lib/services/dynamics-service', () => ({ DynamicsService: { queryRecords: jest.fn() } }));
jest.mock('../../lib/services/dynamics-context', () => ({
  bypassDynamicsRestrictions: (l, fn) => Promise.resolve().then(() => (typeof l === 'function' ? l() : fn())),
}));

import { requireAppAccess } from '../../lib/utils/auth';
import { DynamicsService } from '../../lib/services/dynamics-service';
import { GRANTEE_RESEARCH_PROGRAM_IDS } from '../../shared/config/granteeResearchPrograms';
import { GRANTEE_DELIVERABLE_STATUS } from '../../shared/config/granteeDeliverableStatus';
import handler from '../../pages/api/workbench/grantee-deliverables/awardees';

function mockRes() {
  const res = { statusCode: 200, headers: {}, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  return res;
}

beforeEach(() => {
  requireAppAccess.mockReset().mockResolvedValue({ profileId: 'p', session: { user: {} } });
  DynamicsService.queryRecords.mockReset().mockResolvedValue({ records: [] });
});

test('non-GET → 405', async () => {
  const res = mockRes();
  await handler({ method: 'POST', query: {}, headers: {} }, res);
  expect(res.statusCode).toBe(405);
});

test('invalid cycleCode → 400, no query', async () => {
  const res = mockRes();
  await handler({ method: 'GET', query: { cycleCode: 'NOPE' }, headers: {} }, res);
  expect(res.statusCode).toBe(400);
  expect(DynamicsService.queryRecords).not.toHaveBeenCalled();
});

test('builds the eligibility filter: Active + research program GUIDs + PI present, scoped to the cycle', async () => {
  const res = mockRes();
  await handler({ method: 'GET', query: { cycleCode: 'J26' }, headers: {} }, res);
  expect(res.statusCode).toBe(200);
  const { filter, orderby } = DynamicsService.queryRecords.mock.calls[0][1];
  expect(filter).toContain("akoya_requeststatus eq 'Active'");
  expect(filter).toContain('_wmkf_projectleader_value ne null');
  expect(filter).toContain('wmkf_meetingdate ge 2026-06-01');
  for (const id of GRANTEE_RESEARCH_PROGRAM_IDS) {
    expect(filter).toContain(`_akoya_programid_value eq ${id}`);
  }
  expect(orderby).toMatch(/akoya_requestnum/);
});

test('maps records to awardees with formatted PI/liaison names + deliverable status', async () => {
  DynamicsService.queryRecords.mockResolvedValue({ records: [
    {
      akoya_requestid: 'r1', akoya_requestnum: '1002238', akoya_title: 'Fungal Networks',
      _wmkf_projectleader_value: 'pi1', _wmkf_projectleader_value_formatted: 'Erika Espinosa-Ortiz',
      _akoya_primarycontactid_value: 'li1', _akoya_primarycontactid_value_formatted: 'Dawnie Elzinga',
      _akoya_programid_value: 'prog1', _akoya_programid_value_formatted: 'Science and Engineering Research',
      wmkf_granteedeliverablestatus: GRANTEE_DELIVERABLE_STATUS.DRAFTED,
      wmkf_abstractformatted: 'already drafted',
    },
    {
      akoya_requestid: 'r2', akoya_requestnum: '1002324', akoya_title: 'Circadian clock',
      _wmkf_projectleader_value: 'pi2', _wmkf_projectleader_value_formatted: 'Margaret Stratton',
      _akoya_primarycontactid_value: null, _akoya_programid_value_formatted: 'Medical Research',
      wmkf_granteedeliverablestatus: null, wmkf_abstractformatted: null,
    },
  ] });
  const res = mockRes();
  await handler({ method: 'GET', query: { cycleCode: 'J26' }, headers: {} }, res);
  expect(res.body.count).toBe(2);
  expect(res.body.awardees[0]).toMatchObject({
    requestId: 'r1', requestNumber: '1002238', title: 'Fungal Networks',
    pi: { name: 'Erika Espinosa-Ortiz' }, liaison: { name: 'Dawnie Elzinga' },
    statusLabel: 'Drafted', abstractReady: true,
  });
  expect(res.body.awardees[1]).toMatchObject({
    pi: { name: 'Margaret Stratton' }, liaison: { name: null }, status: null, statusLabel: null, abstractReady: false,
  });
});
