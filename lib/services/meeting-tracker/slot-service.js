/** Deliberation-slot writes with ETag fences and non-blocking capacity warnings. */

import * as slotAdapter from '../../dataverse/adapters/deliberation-slot.js';
import * as sessionAdapter from '../../dataverse/adapters/deliberation-session.js';
import {
  MEETING_TRACKER_DEFAULTS,
  MEETING_TRACKER_LIMITS,
  isMeetingTrackerSchemaReady,
} from '../../../shared/config/meetingTracker.js';
import { isGuid } from '../../utils/guid.js';
import { ServiceHttpError } from '../service-http-error.js';

const DEFAULT_DEPENDENCIES = Object.freeze({
  schemaReady: isMeetingTrackerSchemaReady,
  getSession: sessionAdapter.getById,
  getSlot: slotAdapter.getById,
  findSlotsBySession: slotAdapter.findBySession,
  createSlot: slotAdapter.create,
  updateSlot: slotAdapter.update,
  removeSlot: slotAdapter.remove,
  updateOrders: slotAdapter.updateOrders,
});

function slotError(message, code, httpStatus = 400, extras = {}) {
  return new ServiceHttpError(message, {
    httpStatus,
    code,
    body: { error: message, code, ...extras },
  });
}

function assertReady(dependencies) {
  if (!dependencies.schemaReady()) {
    throw slotError('Meeting Tracker is not enabled for this environment.', 'meeting_tracker_schema_not_ready', 503);
  }
}

function requireGuid(value, field) {
  if (!isGuid(value || '')) throw slotError(`A valid ${field} is required.`, `invalid_${field.replace(/Id$/, '_id')}`);
  return value;
}

function requireActor(value) {
  if (!isGuid(value || '')) {
    throw slotError('A mapped Dataverse staff identity is required to change a slot.', 'meeting_tracker_actor_required', 403);
  }
}

function positiveInteger(value, field, max) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > max) {
    throw slotError(`${field} must be a whole number from 1 to ${max}.`, 'meeting_tracker_slot_value_invalid', 400, { field });
  }
  return number;
}

function optionalNotes(value) {
  const notes = String(value || '').trim();
  if (notes.length > MEETING_TRACKER_LIMITS.notes) {
    throw slotError(
      `notes must be at most ${MEETING_TRACKER_LIMITS.notes} characters.`,
      'meeting_tracker_slot_value_invalid',
      400,
      { field: 'notes' },
    );
  }
  return notes || null;
}

function minutesBetween(session) {
  const start = new Date(session?.wmkf_scheduledstart).getTime();
  const end = new Date(session?.wmkf_scheduledend).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    throw slotError('The target session has an invalid scheduled range.', 'meeting_tracker_session_time_invalid', 409);
  }
  return Math.round((end - start) / 60000);
}

function capacityWarning(session, rows, { replacingSlotId = null, addedMinutes = 0 } = {}) {
  const used = (rows || []).reduce((sum, row) => (
    replacingSlotId && String(row.wmkf_deliberationslotid).toLowerCase() === String(replacingSlotId).toLowerCase()
      ? sum
      : sum + Number(row.wmkf_minutes || 0)
  ), 0) + addedMinutes;
  const available = minutesBetween(session);
  if (used <= available) return null;
  return {
    code: 'meeting_tracker_session_over_full',
    message: `Scheduled discussion time is ${used - available} minutes longer than this session.`,
    totalMinutes: used,
    sessionMinutes: available,
  };
}

async function readSessionAndSlots(sessionId, dependencies) {
  const [session, result] = await Promise.all([
    dependencies.getSession(sessionId),
    dependencies.findSlotsBySession(sessionId),
  ]);
  if (!session?.wmkf_deliberationsessionid) {
    throw slotError('Session not found.', 'meeting_tracker_session_not_found', 404);
  }
  return { session, slots: result?.records || [] };
}

function mapConflict(error) {
  if (error?.status === 412) {
    throw slotError(
      'The slot changed while it was being saved. Reload before trying again.',
      'meeting_tracker_slot_write_conflict',
      409,
    );
  }
  throw error;
}

export async function addDeliberationSlot(
  input,
  { actingUserSystemId = null } = {},
  dependencies = DEFAULT_DEPENDENCIES,
) {
  assertReady(dependencies);
  requireActor(actingUserSystemId);
  const sessionId = requireGuid(input?.sessionId, 'sessionId');
  const requestId = requireGuid(input?.requestId, 'requestId');
  const { session, slots } = await readSessionAndSlots(sessionId, dependencies);
  const order = positiveInteger(input.order ?? slots.length + 1, 'order', MEETING_TRACKER_LIMITS.slotOrder);
  const minutes = positiveInteger(input.minutes ?? MEETING_TRACKER_DEFAULTS.slotMinutes, 'minutes', MEETING_TRACKER_LIMITS.slotMinutes);
  const leadPdId = input.leadPdId ? requireGuid(input.leadPdId, 'leadPdId') : null;
  const warning = capacityWarning(session, slots, { addedMinutes: minutes });
  const created = await dependencies.createSlot({
    wmkf_name: `Deliberation slot · ${requestId}`.slice(0, MEETING_TRACKER_LIMITS.name),
    wmkf_order: order,
    wmkf_minutes: minutes,
    wmkf_notes: optionalNotes(input.notes),
    'wmkf_Session@odata.bind': `/wmkf_deliberationsessions(${sessionId})`,
    'wmkf_Request@odata.bind': `/akoya_requests(${requestId})`,
    ...(leadPdId ? { 'wmkf_LeadPd@odata.bind': `/systemusers(${leadPdId})` } : {}),
    'wmkf_UpdatedBy@odata.bind': `/systemusers(${actingUserSystemId})`,
  }, { actingUserSystemId });
  return { slot: created, warning };
}

export async function moveDeliberationSlot(
  input,
  { actingUserSystemId = null } = {},
  dependencies = DEFAULT_DEPENDENCIES,
) {
  assertReady(dependencies);
  requireActor(actingUserSystemId);
  const slotId = requireGuid(input?.slotId, 'slotId');
  const targetSessionId = requireGuid(input?.targetSessionId, 'sessionId');
  const etag = String(input?.etag || '').trim();
  if (!etag) throw slotError('The slot write fence is required.', 'meeting_tracker_slot_etag_required');
  const [slot, target] = await Promise.all([
    dependencies.getSlot(slotId),
    readSessionAndSlots(targetSessionId, dependencies),
  ]);
  if (!slot?.wmkf_deliberationslotid) {
    throw slotError('Slot not found.', 'meeting_tracker_slot_not_found', 404);
  }
  // Default to the end of the target session so a move never creates a
  // duplicate order (review finding 9); an explicit order is still honored.
  const order = positiveInteger(input?.order ?? target.slots.length + 1, 'order', MEETING_TRACKER_LIMITS.slotOrder);
  const warning = capacityWarning(target.session, target.slots, {
    replacingSlotId: slotId,
    addedMinutes: Number(slot.wmkf_minutes || MEETING_TRACKER_DEFAULTS.slotMinutes),
  });
  try {
    await dependencies.updateSlot(slotId, etag, {
      'wmkf_Session@odata.bind': `/wmkf_deliberationsessions(${targetSessionId})`,
      wmkf_order: order,
      'wmkf_UpdatedBy@odata.bind': `/systemusers(${actingUserSystemId})`,
    }, { actingUserSystemId });
  } catch (error) {
    mapConflict(error);
  }
  return { slotId, sessionId: targetSessionId, order, warning };
}

export async function updateDeliberationSlot(
  input,
  { actingUserSystemId = null } = {},
  dependencies = DEFAULT_DEPENDENCIES,
) {
  assertReady(dependencies);
  requireActor(actingUserSystemId);
  const slotId = requireGuid(input?.slotId, 'slotId');
  const etag = String(input?.etag || '').trim();
  if (!etag) throw slotError('The slot write fence is required.', 'meeting_tracker_slot_etag_required');
  const slot = await dependencies.getSlot(slotId);
  if (!slot?.wmkf_deliberationslotid) {
    throw slotError('Slot not found.', 'meeting_tracker_slot_not_found', 404);
  }
  const sessionId = requireGuid(slot._wmkf_session_value, 'sessionId');
  const { session, slots } = await readSessionAndSlots(sessionId, dependencies);
  const patch = { 'wmkf_UpdatedBy@odata.bind': `/systemusers(${actingUserSystemId})` };
  let nextMinutes = Number(slot.wmkf_minutes || MEETING_TRACKER_DEFAULTS.slotMinutes);
  if (input.order !== undefined) {
    patch.wmkf_order = positiveInteger(input.order, 'order', MEETING_TRACKER_LIMITS.slotOrder);
  }
  if (input.minutes !== undefined) {
    nextMinutes = positiveInteger(input.minutes, 'minutes', MEETING_TRACKER_LIMITS.slotMinutes);
    patch.wmkf_minutes = nextMinutes;
  }
  if (input.notes !== undefined) patch.wmkf_notes = optionalNotes(input.notes);
  if (input.leadPdId !== undefined) {
    patch['wmkf_LeadPd@odata.bind'] = input.leadPdId === null || input.leadPdId === ''
      ? null
      : `/systemusers(${requireGuid(input.leadPdId, 'leadPdId')})`;
  }
  if (Object.keys(patch).length === 1) {
    throw slotError('At least one slot field is required.', 'meeting_tracker_slot_patch_empty');
  }
  const warning = capacityWarning(session, slots, {
    replacingSlotId: slotId,
    addedMinutes: nextMinutes,
  });
  try {
    await dependencies.updateSlot(slotId, etag, patch, { actingUserSystemId });
  } catch (error) {
    mapConflict(error);
  }
  return { slotId, warning };
}

export async function reorderDeliberationSlots(
  { sessionId, slots },
  { actingUserSystemId = null } = {},
  dependencies = DEFAULT_DEPENDENCIES,
) {
  assertReady(dependencies);
  requireActor(actingUserSystemId);
  requireGuid(sessionId, 'sessionId');
  const current = await readSessionAndSlots(sessionId, dependencies);
  if (!Array.isArray(slots) || slots.length === 0) {
    throw slotError('The complete slot order is required.', 'meeting_tracker_slot_order_invalid');
  }
  const rows = slots.map((row, index) => ({
    slotId: requireGuid(row.slotId, 'slotId'),
    etag: String(row.etag || '').trim(),
    order: positiveInteger(row.order ?? index + 1, 'order', MEETING_TRACKER_LIMITS.slotOrder),
  }));
  if (rows.some((row) => !row.etag)) {
    throw slotError('Every reordered slot needs its write fence.', 'meeting_tracker_slot_etag_required');
  }
  const expected = new Set(
    current.slots.map((row) => String(row.wmkf_deliberationslotid).toLowerCase()),
  );
  const supplied = new Set(rows.map((row) => String(row.slotId).toLowerCase()));
  const orderSet = new Set(rows.map((row) => row.order));
  const orderIsComplete = rows.every((row) => row.order <= rows.length)
    && orderSet.size === rows.length;
  if (rows.length !== expected.size || expected.size !== supplied.size
    || [...expected].some((id) => !supplied.has(id)) || !orderIsComplete) {
    throw slotError(
      'The complete current slot order is required.',
      'meeting_tracker_slot_order_stale',
      409,
    );
  }
  try {
    await dependencies.updateOrders(rows, { actingUserSystemId });
  } catch (error) {
    mapConflict(error);
  }
  return { slots: rows };
}

export async function removeDeliberationSlot(
  { slotId, etag },
  { actingUserSystemId = null } = {},
  dependencies = DEFAULT_DEPENDENCIES,
) {
  assertReady(dependencies);
  requireActor(actingUserSystemId);
  requireGuid(slotId, 'slotId');
  if (!String(etag || '').trim()) {
    throw slotError('The slot write fence is required.', 'meeting_tracker_slot_etag_required');
  }
  const slot = await dependencies.getSlot(slotId);
  if (!slot?.wmkf_deliberationslotid) throw slotError('Slot not found.', 'meeting_tracker_slot_not_found', 404);
  try {
    await dependencies.removeSlot(slotId, etag, { actingUserSystemId });
  } catch (error) {
    mapConflict(error);
  }
  return { removed: true, slotId };
}

export const MEETING_TRACKER_SLOT_DEPENDENCIES = DEFAULT_DEPENDENCIES;
export const _internal = { capacityWarning, minutesBetween };
