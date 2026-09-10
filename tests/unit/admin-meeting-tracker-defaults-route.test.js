/**
 * /api/admin/meeting-tracker-defaults — superuser gate, GET shape, PUT body rule.
 * @jest-environment node
 */
jest.mock('../../lib/utils/auth', () => ({ requireSuperuser: jest.fn() }));
jest.mock('../../lib/dataverse/core/context', () => ({ withDalContext: jest.fn((_label, fn) => fn()) }));
jest.mock('../../lib/services/meeting-tracker/attendee-service', () => ({
  getDefaultMeetingAttendees: jest.fn(),
  getMeetingTrackerRecipientDirectory: jest.fn(),
  writeDefaultMeetingAttendees: jest.fn(),
}));

import { requireSuperuser } from '../../lib/utils/auth';
import {
  getDefaultMeetingAttendees,
  getMeetingTrackerRecipientDirectory,
  writeDefaultMeetingAttendees,
} from '../../lib/services/meeting-tracker/attendee-service';
import handler from '../../pages/api/admin/meeting-tracker-defaults';

function mockRes() {
  const res = { statusCode: 200, headers: {}, body: null };
  res.status = jest.fn((code) => { res.statusCode = code; return res; });
  res.json = jest.fn((body) => { res.body = body; return res; });
  res.setHeader = jest.fn((key, value) => { res.headers[key] = value; });
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
  requireSuperuser.mockResolvedValue({ profileId: 3 });
  getMeetingTrackerRecipientDirectory.mockResolvedValue({ staff: [{ ref: { kind: 'staff', profileId: 7 }, name: 'Alex', email: 'a@x' }], board: [] });
  getDefaultMeetingAttendees.mockResolvedValue({ refs: { version: 1, attendees: [{ kind: 'staff', profileId: 7 }] }, attendees: [{ name: 'Alex', email: 'a@x' }], notice: null });
  writeDefaultMeetingAttendees.mockResolvedValue({ refs: { version: 1, attendees: [{ kind: 'staff', profileId: 7 }] }, attendees: [{ name: 'Alex', email: 'a@x' }] });
});

test('non-superusers stop at the gate', async () => {
  requireSuperuser.mockResolvedValueOnce(null);
  await handler({ method: 'GET', query: {} }, mockRes());
  expect(getDefaultMeetingAttendees).not.toHaveBeenCalled();
});

test('GET returns staff, current default refs, and resolved names', async () => {
  const res = mockRes();
  await handler({ method: 'GET', query: {} }, res);
  expect(res.statusCode).toBe(200);
  expect(res.body.defaultAttendeeRefs).toEqual([{ kind: 'staff', profileId: 7 }]);
  expect(res.body.staff).toHaveLength(1);
});

test('PUT accepts only an attendees array and writes with the admin profile', async () => {
  let res = mockRes();
  await handler({ method: 'PUT', body: { attendees: [{ kind: 'staff', profileId: 7 }], extra: 1 } }, res);
  expect(res.statusCode).toBe(400);
  res = mockRes();
  await handler({ method: 'PUT', body: { attendees: [{ kind: 'staff', profileId: 7 }] } }, res);
  expect(res.statusCode).toBe(200);
  expect(writeDefaultMeetingAttendees).toHaveBeenCalledWith({ attendees: [{ kind: 'staff', profileId: 7 }] }, { updatedBy: 3 });
});
