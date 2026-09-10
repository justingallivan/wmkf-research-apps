/** @jest-environment node */

import {
  getDefaultMeetingAttendees,
  normalizeMeetingAttendeeRefs,
} from '../../lib/services/meeting-tracker/attendee-service';
import { MEETING_TRACKER_DEFAULT_ATTENDEES_SETTING } from '../../shared/config/meetingTracker';

function dependencies(overrides = {}) {
  const directory = {
    staff: [{ kind: 'staff', profileId: 7, name: 'Alex Staff', email: 'alex@example.org' }],
    external: [{ kind: 'roster', rosterId: 9, name: 'Bailey Board', email: 'bailey@example.org' }],
  };
  return {
    getSetting: jest.fn(async () => null),
    getRecipientDirectory: jest.fn(async () => directory),
    resolveRecipientRefs: jest.fn(async (refs) => refs.map((ref) => (
      ref.kind === 'staff' ? directory.staff[0] : directory.external[0]
    ))),
    ...overrides,
  };
}

test('default attendees come from the admin setting and resolve through the directory', async () => {
  const refs = {
    version: 1,
    attendees: [{ kind: 'staff', profileId: 7 }],
  };
  const deps = dependencies({ getSetting: jest.fn(async () => JSON.stringify(refs)) });
  const result = await getDefaultMeetingAttendees(deps);

  expect(deps.getSetting).toHaveBeenCalledWith(MEETING_TRACKER_DEFAULT_ATTENDEES_SETTING);
  expect(deps.resolveRecipientRefs).toHaveBeenCalledWith(refs.attendees, expect.objectContaining({
    allowManual: false,
  }));
  expect(result).toEqual({
    refs,
    attendees: [
      { name: 'Alex Staff', email: 'alex@example.org' },
    ],
    notice: null,
  });
});

test('a missing default setting returns an empty list and a visible notice', async () => {
  const deps = dependencies();
  const result = await getDefaultMeetingAttendees(deps);

  expect(result.refs).toEqual({ version: 1, attendees: [] });
  expect(result.attendees).toEqual([]);
  expect(result.notice).toMatch(/not configured/i);
  expect(deps.getRecipientDirectory).not.toHaveBeenCalled();
});

test('the fixed default list refuses roster entries and falls back with a notice', async () => {
  const deps = dependencies({
    getSetting: jest.fn(async () => JSON.stringify({
      version: 1,
      attendees: [{ kind: 'roster', rosterId: 9 }],
    })),
  });
  const result = await getDefaultMeetingAttendees(deps);

  expect(result.refs).toEqual({ version: 1, attendees: [] });
  expect(result.notice).toMatch(/could not be resolved/i);
  expect(deps.resolveRecipientRefs).not.toHaveBeenCalled();
});

test('manual and copied-email attendee data is rejected before directory access', () => {
  expect(() => normalizeMeetingAttendeeRefs({
    version: 1,
    attendees: [{ kind: 'manual', name: 'Guest', email: 'guest@example.org' }],
  })).toThrow();
  expect(() => normalizeMeetingAttendeeRefs({
    version: 1,
    attendees: [{ kind: 'staff', profileId: 7, email: 'copied@example.org' }],
  })).toThrow();
});
