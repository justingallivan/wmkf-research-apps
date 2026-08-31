/** @jest-environment node */

import {
  explicitActorCreateFields,
  recordRequestDocumentActorNotCaptured,
  REQUEST_DOCUMENT_ACTOR_POLICY,
  resolveRequestDocumentActor,
} from '../../lib/services/request-document-actor-service.js';

const ACTOR_ID = '44444444-4444-4444-8444-444444444444';
const OTHER_ID = '55555555-5555-4555-8555-555555555555';

function dependencies(overrides = {}) {
  return {
    schemaReady: jest.fn(() => true),
    getSystemUser: jest.fn(async () => ({
      systemuserid: ACTOR_ID,
      isdisabled: false,
    })),
    recordEvent: jest.fn(async () => ({ id: 1, folded: false })),
    now: jest.fn(() => new Date('2026-08-31T20:00:00Z')),
    ...overrides,
  };
}

test('freshly validates and returns the exact enabled session actor', async () => {
  const deps = dependencies();
  await expect(resolveRequestDocumentActor({
    actingUserSystemId: ACTOR_ID,
    policy: REQUEST_DOCUMENT_ACTOR_POLICY.REQUIRED,
  }, deps)).resolves.toEqual({ schemaReady: true, actorId: ACTOR_ID, reason: null });
  expect(deps.getSystemUser).toHaveBeenCalledWith(ACTOR_ID);
});

test.each([
  ['missing', null, null],
  ['disabled', ACTOR_ID, { systemuserid: ACTOR_ID, isdisabled: true }],
  ['stale', ACTOR_ID, { systemuserid: OTHER_ID, isdisabled: false }],
])('availability-first policy returns an explicit %s resolution', async (reason, actorId, user) => {
  const deps = dependencies({
    getSystemUser: jest.fn(async () => user),
  });
  await expect(resolveRequestDocumentActor({
    actingUserSystemId: actorId,
    policy: REQUEST_DOCUMENT_ACTOR_POLICY.ALLOW_UNATTRIBUTED,
  }, deps)).resolves.toEqual({ schemaReady: true, actorId: null, reason });
});

test('required policy rejects a disabled mapping with an actionable 403', async () => {
  const deps = dependencies({
    getSystemUser: jest.fn(async () => ({ systemuserid: ACTOR_ID, isdisabled: true })),
  });
  await expect(resolveRequestDocumentActor({
    actingUserSystemId: ACTOR_ID,
    policy: REQUEST_DOCUMENT_ACTOR_POLICY.REQUIRED,
  }, deps)).rejects.toMatchObject({
    httpStatus: 403,
    code: 'request_document_actor_unavailable',
  });
});

test('readiness off preserves the existing path without touching systemuser', async () => {
  const deps = dependencies({ schemaReady: jest.fn(() => false) });
  await expect(resolveRequestDocumentActor({
    actingUserSystemId: ACTOR_ID,
    policy: REQUEST_DOCUMENT_ACTOR_POLICY.ALLOW_UNATTRIBUTED,
  }, deps)).resolves.toEqual({
    schemaReady: false,
    actorId: null,
    reason: 'schema-not-ready',
  });
  expect(deps.getSystemUser).not.toHaveBeenCalled();
});

test('unknown policy fails closed before any identity read', async () => {
  const deps = dependencies();
  await expect(resolveRequestDocumentActor({
    actingUserSystemId: ACTOR_ID,
    policy: 'anything-else',
  }, deps)).rejects.toMatchObject({
    httpStatus: 500,
    code: 'request_document_actor_policy_missing',
  });
  expect(deps.getSystemUser).not.toHaveBeenCalled();
});

test('builds immutable create fields from server time only', () => {
  expect(explicitActorCreateFields(ACTOR_ID, dependencies())).toEqual({
    'wmkf_InitiatedBy@odata.bind': `/systemusers(${ACTOR_ID})`,
    wmkf_initiatedat: '2026-08-31T20:00:00.000Z',
  });
});

test('records bounded reconciliation identity for an unattributed create', async () => {
  const deps = dependencies();
  await recordRequestDocumentActorNotCaptured({
    payload: {
      'wmkf_Request@odata.bind': '/akoya_requests(11111111-1111-4111-8111-111111111111)',
      wmkf_generationkey: 'generation-key',
      wmkf_producer: 'producer',
    },
    created: { wmkf_requestdocumentid: '22222222-2222-4222-8222-222222222222' },
    context: {
      operation: 'initial-assessment-generation',
      requestNumber: '1000001',
    },
    reason: 'missing',
  }, deps);
  expect(deps.recordEvent).toHaveBeenCalledWith(expect.objectContaining({
    eventType: 'request_document_actor_not_captured',
    severity: 'warning',
    requestNumber: '1000001',
    entityRefs: expect.objectContaining({
      requestId: '11111111-1111-4111-8111-111111111111',
      requestDocumentId: '22222222-2222-4222-8222-222222222222',
      generationKey: 'generation-key',
    }),
  }));
});
