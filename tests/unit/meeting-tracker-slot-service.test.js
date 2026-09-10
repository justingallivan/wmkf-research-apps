/** @jest-environment node */

import {
  addDeliberationSlot,
  moveDeliberationSlot,
} from '../../lib/services/meeting-tracker/slot-service';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const SLOT_ID = '22222222-2222-4222-8222-222222222222';
const SESSION_ID = '33333333-3333-4333-8333-333333333333';
const ACTOR_ID = '44444444-4444-4444-8444-444444444444';

function session() {
  return {
    wmkf_deliberationsessionid: SESSION_ID,
    wmkf_scheduledstart: '2026-09-15T16:00:00.000Z',
    wmkf_scheduledend: '2026-09-15T17:00:00.000Z',
  };
}

function dependencies(overrides = {}) {
  return {
    schemaReady: jest.fn(() => true),
    getSession: jest.fn(async () => session()),
    getSlot: jest.fn(async () => ({
      wmkf_deliberationslotid: SLOT_ID,
      _wmkf_session_value: SESSION_ID,
      wmkf_minutes: 20,
      _etag: 'W/"10"',
    })),
    findSlotsBySession: jest.fn(async () => ({ records: [] })),
    createSlot: jest.fn(async (payload) => ({ wmkf_deliberationslotid: SLOT_ID, ...payload })),
    updateSlot: jest.fn(async () => undefined),
    removeSlot: jest.fn(async () => undefined),
    updateOrders: jest.fn(async () => ({ ok: true })),
    ...overrides,
  };
}

test('move is one PATCH containing target session, order, actor, and If-Match', async () => {
  const deps = dependencies();
  const result = await moveDeliberationSlot({
    slotId: SLOT_ID,
    targetSessionId: SESSION_ID,
    order: 3,
    etag: 'W/"10"',
  }, { actingUserSystemId: ACTOR_ID }, deps);

  expect(deps.updateSlot).toHaveBeenCalledTimes(1);
  expect(deps.updateSlot).toHaveBeenCalledWith(SLOT_ID, 'W/"10"', {
    'wmkf_Session@odata.bind': `/wmkf_deliberationsessions(${SESSION_ID})`,
    wmkf_order: 3,
    'wmkf_UpdatedBy@odata.bind': `/systemusers(${ACTOR_ID})`,
  }, { actingUserSystemId: ACTOR_ID });
  expect(result).toMatchObject({ slotId: SLOT_ID, sessionId: SESSION_ID, order: 3 });
});

test('an over-full session returns a warning after still writing the slot', async () => {
  const deps = dependencies({
    findSlotsBySession: jest.fn(async () => ({ records: [
      { wmkf_deliberationslotid: SLOT_ID, wmkf_minutes: 50 },
    ] })),
  });
  const result = await addDeliberationSlot({
    sessionId: SESSION_ID,
    requestId: REQUEST_ID,
    minutes: 20,
  }, { actingUserSystemId: ACTOR_ID }, deps);

  expect(deps.createSlot).toHaveBeenCalledTimes(1);
  expect(result.warning).toEqual(expect.objectContaining({
    code: 'meeting_tracker_session_over_full',
    totalMinutes: 70,
    sessionMinutes: 60,
  }));
});

test('a Dataverse stale ETag becomes an HTTP 409 service error', async () => {
  const deps = dependencies({
    updateSlot: jest.fn(async () => { const error = new Error('stale'); error.status = 412; throw error; }),
  });
  await expect(moveDeliberationSlot({
    slotId: SLOT_ID,
    targetSessionId: SESSION_ID,
    order: 1,
    etag: 'W/"9"',
  }, { actingUserSystemId: ACTOR_ID }, deps)).rejects.toMatchObject({
    httpStatus: 409,
    code: 'meeting_tracker_slot_write_conflict',
  });
});
