/** @jest-environment node */
let mockTrackerReady = true;
let mockMaterialsReady = true;
jest.mock('../../shared/config/meetingTracker', () => ({ isMeetingTrackerSchemaReady: jest.fn(() => mockTrackerReady) }));
jest.mock('../../lib/utils/site-visit-materials-readiness', () => ({ isSiteVisitMaterialsSchemaReady: jest.fn(() => mockMaterialsReady) }));
jest.mock('../../lib/utils/auth', () => ({ requireAppAccess: jest.fn() }));
jest.mock('../../lib/dataverse/core/context', () => ({ withDalContext: jest.fn((_label, fn) => fn()) }));
jest.mock('../../lib/services/site-visit-materials/collection-service', () => ({
  confirmMaterialsReady: jest.fn(), createMaterialsCollection: jest.fn(), getMaterialsCollection: jest.fn(),
  inviteMaterialsContributors: jest.fn(), remindMaterialsContributors: jest.fn(), waiveMaterialsItem: jest.fn(),
}));

import { requireAppAccess } from '../../lib/utils/auth';
import * as service from '../../lib/services/site-visit-materials/collection-service';
import handler from '../../pages/api/meeting-tracker/visits/[requestId]/materials';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const ACTOR = '22222222-2222-4222-8222-222222222222';
function mockRes() { const res = { statusCode: 200, headers: {}, body: null }; res.status = (c) => { res.statusCode = c; return res; }; res.json = (b) => { res.body = b; return res; }; res.setHeader = (k, v) => { res.headers[k] = v; }; return res; }
const req = (method, body, requestId = REQUEST_ID) => ({ method, body, query: { requestId } });

beforeEach(() => {
  jest.clearAllMocks();
  mockTrackerReady = true; mockMaterialsReady = true;
  requireAppAccess.mockResolvedValue({ profileId: 7, session: { user: { dynamicsSystemuserId: ACTOR, azureEmail: 'PC@wmkeck.org' } } });
  service.getMaterialsCollection.mockResolvedValue({ collection: null });
  service.createMaterialsCollection.mockResolvedValue({ collection: { id: 'c' }, invitationSent: true });
});

test('id validated before auth; both readiness flags checked after auth; GET returns the collection', async () => {
  const bad = mockRes(); await handler(req('GET', undefined, 'x'), bad);
  expect(bad.statusCode).toBe(400); expect(requireAppAccess).not.toHaveBeenCalled();
  mockMaterialsReady = false;
  const off = mockRes(); await handler(req('GET'), off);
  expect(off.statusCode).toBe(503); expect(off.body.code).toBe('site_visit_materials_schema_not_ready'); expect(service.getMaterialsCollection).not.toHaveBeenCalled();
  mockMaterialsReady = true;
  const ok = mockRes(); await handler(req('GET'), ok);
  expect(service.getMaterialsCollection).toHaveBeenCalledWith({ requestId: REQUEST_ID });
  expect(ok.body).toEqual({ success: true, collection: null });
});

test('POST dispatches by action with the session actor and lowercased sender; unknown actions and extra keys are 400', async () => {
  const create = mockRes(); await handler(req('POST', { action: 'create' }), create);
  expect(service.createMaterialsCollection).toHaveBeenCalledWith({ requestId: REQUEST_ID, actorId: ACTOR, fromEmail: 'pc@wmkeck.org' });
  expect(create.body).toEqual({ success: true, collection: { id: 'c' }, invitationSent: true });
  service.waiveMaterialsItem.mockResolvedValueOnce({ collection: { id: 'c' } });
  await handler(req('POST', { action: 'waive', key: 'participant_bios', waived: true }), mockRes());
  expect(service.waiveMaterialsItem).toHaveBeenCalledWith({ requestId: REQUEST_ID, key: 'participant_bios', waived: true });
  const bad = mockRes(); await handler(req('POST', { action: 'create', requestId: 'other' }), bad); expect(bad.statusCode).toBe(400);
  const unknown = mockRes(); await handler(req('POST', { action: 'delete' }), unknown); expect(unknown.statusCode).toBe(400);
  requireAppAccess.mockResolvedValueOnce({ profileId: 7, session: { user: { dynamicsSystemuserId: ACTOR, azureEmail: '' } } });
  const noSender = mockRes(); await handler(req('POST', { action: 'remind' }), noSender);
  expect(noSender.statusCode).toBe(400); expect(service.remindMaterialsContributors).not.toHaveBeenCalled();
});
