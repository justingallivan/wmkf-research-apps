/** @jest-environment node */
import { MEETING_TRACKER_AGENDA_DEPENDENCIES } from '../../lib/services/meeting-tracker/agenda-service';
import { getDeliberationSession } from '../../lib/services/meeting-tracker/session-service';
import { getLiveBriefingLink } from '../../lib/services/deliberation-briefing/briefing-link-service';
jest.mock('../../lib/services/meeting-tracker/session-service', () => ({ getDeliberationSession: jest.fn() }));
jest.mock('../../lib/services/deliberation-briefing/briefing-link-service', () => ({ getLiveBriefingLink: jest.fn() }));
beforeEach(() => { jest.clearAllMocks(); getDeliberationSession.mockResolvedValue({ session: {}, slots: [{ _wmkf_request_value: '11111111-1111-4111-8111-111111111111', briefing: null }] }); });
test('confirmed absent is distinct from unreadable or failed link reads', async () => {
  getLiveBriefingLink.mockResolvedValueOnce(null);
  expect((await MEETING_TRACKER_AGENDA_DEPENDENCIES.getSession({ sessionId: 'session' })).slots[0].briefing).toBeNull();
  getLiveBriefingLink.mockResolvedValueOnce({ id: 'live', unreadable: true, url: null });
  await expect(MEETING_TRACKER_AGENDA_DEPENDENCIES.getSession({ sessionId: 'session' })).rejects.toMatchObject({ code: 'agenda_links_unavailable' });
  getLiveBriefingLink.mockRejectedValueOnce(Error('offline'));
  await expect(MEETING_TRACKER_AGENDA_DEPENDENCIES.getSession({ sessionId: 'session' })).rejects.toMatchObject({ code: 'agenda_links_unavailable' });
});

test('invalid slot identity is left for computeAgenda validation, not misreported as link outage', async () => {
  getDeliberationSession.mockResolvedValueOnce({ session: {}, slots: [{ _wmkf_request_value: 'not-a-guid' }] });
  await MEETING_TRACKER_AGENDA_DEPENDENCIES.getSession({ sessionId: 'session' });
  expect(getLiveBriefingLink).not.toHaveBeenCalled();
});
