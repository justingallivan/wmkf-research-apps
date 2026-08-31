/** @jest-environment node */

jest.mock('../../lib/services/dynamics-service.js', () => ({
  DynamicsService: {
    createRecord: jest.fn(),
    updateRecord: jest.fn(),
    getRecord: jest.fn(),
  },
}));
jest.mock('../../lib/services/operational-event-service.js', () => ({
  __esModule: true,
  default: { recordEvent: jest.fn(async () => ({ id: 1, folded: false })) },
}));

import {
  create,
  EXPLICIT_ACTOR_SELECT_FIELDS,
  requestDocumentSelect,
  update,
} from '../../lib/dataverse/adapters/request-document.js';
import { DynamicsService } from '../../lib/services/dynamics-service.js';
import OperationalEventService from '../../lib/services/operational-event-service.js';
import { REQUEST_DOCUMENT_ACTOR_POLICY } from '../../lib/services/request-document-actor-service.js';

const ACTOR_ID = '44444444-4444-4444-8444-444444444444';
const ORIGINAL_ENV = process.env.REQUEST_DOCUMENT_EXPLICIT_ACTOR_SCHEMA_READY;

beforeEach(() => {
  jest.clearAllMocks();
  process.env.REQUEST_DOCUMENT_EXPLICIT_ACTOR_SCHEMA_READY = 'on';
  DynamicsService.getRecord.mockResolvedValue({ systemuserid: ACTOR_ID, isdisabled: false });
  DynamicsService.createRecord.mockResolvedValue({
    wmkf_requestdocumentid: '22222222-2222-4222-8222-222222222222',
  });
});

afterAll(() => {
  if (ORIGINAL_ENV === undefined) delete process.env.REQUEST_DOCUMENT_EXPLICIT_ACTOR_SCHEMA_READY;
  else process.env.REQUEST_DOCUMENT_EXPLICIT_ACTOR_SCHEMA_READY = ORIGINAL_ENV;
});

test('stamps a freshly validated actor/time and strips adapter-only options', async () => {
  await create({
    'wmkf_Request@odata.bind': '/akoya_requests(11111111-1111-4111-8111-111111111111)',
    wmkf_generationkey: 'generation-key',
  }, {
    actingUserSystemId: ACTOR_ID,
    actorPolicy: REQUEST_DOCUMENT_ACTOR_POLICY.REQUIRED,
    actorContext: { operation: 'test' },
  });
  expect(DynamicsService.createRecord).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({
      'wmkf_InitiatedBy@odata.bind': `/systemusers(${ACTOR_ID})`,
      wmkf_initiatedat: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    }),
    { actingUserSystemId: ACTOR_ID },
  );
  expect(OperationalEventService.recordEvent).not.toHaveBeenCalled();
});

test('availability-first create writes no invented actor and emits durable evidence', async () => {
  await create({
    'wmkf_Request@odata.bind': '/akoya_requests(11111111-1111-4111-8111-111111111111)',
    wmkf_generationkey: 'generation-key',
    wmkf_producer: 'test-producer',
  }, {
    actingUserSystemId: null,
    actorPolicy: REQUEST_DOCUMENT_ACTOR_POLICY.ALLOW_UNATTRIBUTED,
    actorContext: { operation: 'test', requestNumber: '1000001' },
  });
  const payload = DynamicsService.createRecord.mock.calls[0][1];
  expect(payload).not.toHaveProperty('wmkf_InitiatedBy@odata.bind');
  expect(payload).not.toHaveProperty('wmkf_initiatedat');
  expect(OperationalEventService.recordEvent).toHaveBeenCalledWith(expect.objectContaining({
    eventType: 'request_document_actor_not_captured',
    requestNumber: '1000001',
  }));
});

test('readiness off writes the legacy payload and skips actor resolution requirements', async () => {
  process.env.REQUEST_DOCUMENT_EXPLICIT_ACTOR_SCHEMA_READY = 'off';
  await create({ wmkf_generationkey: 'generation-key' });
  expect(DynamicsService.getRecord).not.toHaveBeenCalled();
  expect(DynamicsService.createRecord).toHaveBeenCalledWith(
    expect.any(String),
    { wmkf_generationkey: 'generation-key' },
    {},
  );
});

test('update rejects immutable explicit origin fields before transport', async () => {
  await expect(update('id', { wmkf_initiatedat: '2026-08-31T20:00:00Z' }))
    .rejects.toThrow(/immutable/);
  await expect(update('id', { 'wmkf_InitiatedBy@odata.bind': `/systemusers(${ACTOR_ID})` }))
    .rejects.toThrow(/immutable/);
  expect(DynamicsService.updateRecord).not.toHaveBeenCalled();
});

test('projection includes Wave 24 fields only when explicitly enabled', () => {
  const off = requestDocumentSelect({ includeExplicitActor: false }).split(',');
  const on = requestDocumentSelect({ includeExplicitActor: true }).split(',');
  for (const field of EXPLICIT_ACTOR_SELECT_FIELDS) {
    expect(off).not.toContain(field);
    expect(on).toContain(field);
  }
});
