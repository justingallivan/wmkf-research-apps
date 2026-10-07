/**
 * @jest-environment node
 */
jest.mock('../../lib/utils/auth', () => ({ requireAppAccess: jest.fn(), getUserRole: jest.fn(async () => 'staff') }));
jest.mock('../../lib/services/pre-site-visit/writeup-visibility', () => ({
  resolveWriteupViewer: jest.fn(async (input) => ({ ...input, isCoordinator: false })),
}));
jest.mock('../../lib/dataverse/core/context', () => ({
  withDalContext: jest.fn(async (_label, callback) => callback()),
}));
jest.mock('../../lib/services/pre-site-visit/cycle-list-service', () => ({
  listPreSiteVisitDrafts: jest.fn(),
}));

import { requireAppAccess } from '../../lib/utils/auth';
import { withDalContext } from '../../lib/dataverse/core/context';
import { listPreSiteVisitDrafts } from '../../lib/services/pre-site-visit/cycle-list-service';
import { ServiceHttpError } from '../../lib/services/service-http-error';
import handler from '../../pages/api/workbench/staff-deliberations';

const PROGRAM = 'bbbbbbbb-0000-4000-8000-000000000001';

function responseHarness() {
  const res = { statusCode: 200, body: null, headers: {} };
  res.setHeader = jest.fn((name, value) => { res.headers[name] = value; });
  res.status = jest.fn((code) => { res.statusCode = code; return res; });
  res.json = jest.fn((body) => { res.body = body; return res; });
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
  requireAppAccess.mockResolvedValue({ session: { user: { dynamicsSystemuserId: 'cccccccc-0000-4000-8000-000000000001' } } });
  listPreSiteVisitDrafts.mockResolvedValue({ success: true, cycleCode: 'D26', programId: PROGRAM, scope: 'my', stageLabels: {}, counts: {}, artifacts: [] });
});

it('guards with the reviewers app and returns the service body for a valid cycle', async () => {
  const res = responseHarness();
  await handler({ method: 'GET', query: { cycleCode: 'D26', programId: PROGRAM, scope: 'all' } }, res);
  expect(requireAppAccess).toHaveBeenCalledWith(expect.anything(), res, 'reviewers');
  expect(withDalContext).toHaveBeenCalledWith('workbench-staff-deliberations', expect.any(Function));
  expect(listPreSiteVisitDrafts).toHaveBeenCalledWith({
    cycleCode: 'D26',
    programId: PROGRAM,
    scope: 'all',
    callerSystemId: 'cccccccc-0000-4000-8000-000000000001',
    writeupViewer: expect.objectContaining({ isSuperuser: false }),
  });
  expect(res.statusCode).toBe(200);
  expect(res.body).toEqual({ success: true, cycleCode: 'D26', programId: PROGRAM, scope: 'my', stageLabels: {}, counts: {}, artifacts: [] });
});

it('accepts the existing Research Grant Program GUID outside RFC version/variant ranges', async () => {
  const researchProgramId = 'c247b11a-a7cb-ee11-9078-000d3a341e8f';
  const res = responseHarness();
  await handler({ method: 'GET', query: { cycleCode: 'D26', programId: researchProgramId, scope: 'my' } }, res);
  expect(res.statusCode).toBe(200);
  expect(listPreSiteVisitDrafts).toHaveBeenCalledWith(expect.objectContaining({ programId: researchProgramId }));
});

it('passes scope=my through and resolves callerSystemId from the session (actorRefFromSession)', async () => {
  const res = responseHarness();
  await handler({ method: 'GET', query: { cycleCode: 'D26', programId: PROGRAM, scope: 'my' } }, res);
  expect(listPreSiteVisitDrafts).toHaveBeenCalledWith({
    cycleCode: 'D26',
    programId: PROGRAM,
    scope: 'my',
    callerSystemId: 'cccccccc-0000-4000-8000-000000000001',
    writeupViewer: expect.objectContaining({ isSuperuser: false }),
  });
});

it('rejects an unrecognized scope value', async () => {
  const res = responseHarness();
  await handler({ method: 'GET', query: { cycleCode: 'D26', programId: PROGRAM, scope: 'bogus' } }, res);
  expect(res.statusCode).toBe(400);
  expect(listPreSiteVisitDrafts).not.toHaveBeenCalled();
});

it('defaults a missing scope query param to my', async () => {
  const res = responseHarness();
  await handler({ method: 'GET', query: { cycleCode: 'D26', programId: PROGRAM } }, res);
  expect(listPreSiteVisitDrafts).toHaveBeenCalledWith(expect.objectContaining({ scope: 'my', programId: PROGRAM }));
});

it('resolves callerSystemId to null when the session has no linked systemuser', async () => {
  requireAppAccess.mockResolvedValue({ session: { user: {} } });
  const res = responseHarness();
  await handler({ method: 'GET', query: { cycleCode: 'D26', programId: PROGRAM } }, res);
  expect(listPreSiteVisitDrafts).toHaveBeenCalledWith(expect.objectContaining({ callerSystemId: null }));
});

it('rejects a missing or malformed cycle code before the service runs', async () => {
  for (const query of [{}, { cycleCode: 'D2026' }, { cycleCode: "D26' or 1 eq 1" }]) {
    const res = responseHarness();
    await handler({ method: 'GET', query }, res);
    expect(res.statusCode).toBe(400);
  }
  expect(listPreSiteVisitDrafts).not.toHaveBeenCalled();
});

it('stops when the app guard denies', async () => {
  requireAppAccess.mockResolvedValue(null);
  const res = responseHarness();
  await handler({ method: 'GET', query: { cycleCode: 'D26', programId: PROGRAM } }, res);
  expect(listPreSiteVisitDrafts).not.toHaveBeenCalled();
  expect(res.json).not.toHaveBeenCalled();
});

it('maps ServiceHttpError to its status and hides unexpected errors behind a 500', async () => {
  listPreSiteVisitDrafts.mockRejectedValueOnce(new ServiceHttpError('registry fault', { httpStatus: 500 }));
  let res = responseHarness();
  await handler({ method: 'GET', query: { cycleCode: 'D26', programId: PROGRAM } }, res);
  expect(res.statusCode).toBe(500);
  expect(res.body).toMatchObject({ error: 'registry fault' });

  listPreSiteVisitDrafts.mockRejectedValueOnce(new Error('boom'));
  jest.spyOn(console, 'error').mockImplementation(() => {});
  res = responseHarness();
  await handler({ method: 'GET', query: { cycleCode: 'D26', programId: PROGRAM } }, res);
  expect(res.statusCode).toBe(500);
  expect(res.body.error).toBe('Staff Deliberations list failed.');
});

it('allows only GET', async () => {
  const res = responseHarness();
  await handler({ method: 'POST', query: {} }, res);
  expect(res.statusCode).toBe(405);
  expect(res.headers.Allow).toBe('GET');
});
