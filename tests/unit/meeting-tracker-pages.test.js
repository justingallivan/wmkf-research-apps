/** @jest-environment jsdom */

import { render, screen } from '@testing-library/react';
import { AppCard, getServerSideProps as getLandingProps } from '../../pages/index';
import { MeetingTrackerRequestRow } from '../../shared/components/meeting-tracker/MeetingTrackerList';
import { reorderSessionSlots } from '../../shared/components/meeting-tracker/SessionEditor';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const FIRST_SLOT_ID = '22222222-2222-4222-8222-222222222222';
const SECOND_SLOT_ID = '33333333-3333-4333-8333-333333333333';

function proposal(overrides = {}) {
  return {
    requestId: '44444444-4444-4444-8444-444444444444',
    requestNumber: '1002003',
    title: 'Programmable tissue repair',
    programDirector: 'Alex Staff',
    projectLeader: 'Jordan Investigator',
    shareState: { lifecycleLabel: 'Ready for review' },
    deliberation: {
      sessionId: SESSION_ID,
      scheduledStartIso: '2026-09-14T16:00:00.000Z',
      order: 2,
      minutes: 15,
      meetingLink: '',
    },
    siteVisit: null,
    needsScheduling: true,
    ...overrides,
  };
}

test('list row shows scheduling and missing-link cues when either meeting is missing', () => {
  const { rerender } = render(<MeetingTrackerRequestRow proposal={proposal()} cycleCode="D26" programId={SESSION_ID} />);

  expect(screen.getByText('Needs scheduling')).toBeInTheDocument();
  expect(screen.getByText('No link')).toBeInTheDocument();
  expect(screen.getByText('No site visit')).toBeInTheDocument();

  rerender(<MeetingTrackerRequestRow proposal={proposal({
    deliberation: null,
    siteVisit: { scheduledStartIso: '2026-09-16T18:00:00.000Z', formatLabel: 'In person', location: 'Los Angeles' },
  })} cycleCode="D26" programId={SESSION_ID} />);
  expect(screen.getByText('Needs scheduling')).toBeInTheDocument();
  expect(screen.getByText('No session')).toBeInTheDocument();
});

test('valid meeting link renders as a protected Join link and complete rows omit the cue', () => {
  render(<MeetingTrackerRequestRow proposal={proposal({
    deliberation: { ...proposal().deliberation, meetingLink: 'https://zoom.us/j/123' },
    siteVisit: { scheduledStartIso: '2026-09-16T18:00:00.000Z', formatLabel: 'In person', location: 'Los Angeles' },
    needsScheduling: false,
  })} cycleCode="D26" programId={SESSION_ID} />);

  expect(screen.queryByText('Needs scheduling')).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Join' })).toHaveAttribute('rel', 'noopener noreferrer');
});

test('session reorder posts every slot with its current ETag and complete new order', async () => {
  const fetchImpl = jest.fn(async () => ({ ok: true, json: async () => ({ slots: [] }) }));
  await reorderSessionSlots({
    sessionId: SESSION_ID,
    slots: [
      { wmkf_deliberationslotid: SECOND_SLOT_ID, _etag: 'W/"2"' },
      { wmkf_deliberationslotid: FIRST_SLOT_ID, _etag: 'W/"1"' },
    ],
    fetchImpl,
  });

  expect(fetchImpl).toHaveBeenCalledWith('/api/meeting-tracker/slots/reorder', expect.objectContaining({
    method: 'PATCH',
    body: JSON.stringify({
      sessionId: SESSION_ID,
      slots: [
        { slotId: SECOND_SLOT_ID, etag: 'W/"2"', order: 1 },
        { slotId: FIRST_SLOT_ID, etag: 'W/"1"', order: 2 },
      ],
    }),
  }));
});

test('landing tile remains visible and disabled while readiness is unset', async () => {
  const previous = process.env.MEETING_TRACKER_SCHEMA_READY;
  delete process.env.MEETING_TRACKER_SCHEMA_READY;
  await expect(getLandingProps()).resolves.toEqual({
    props: { runtimeAppStatus: { 'meeting-tracker': 'not-ready' } },
  });
  if (previous === undefined) delete process.env.MEETING_TRACKER_SCHEMA_READY;
  else process.env.MEETING_TRACKER_SCHEMA_READY = previous;

  render(<AppCard app={{
    id: 'meeting-tracker',
    title: 'Meeting Tracker',
    description: 'Plan deliberation sessions.',
    icon: 'MT',
    status: 'not-ready',
    path: '/meeting-tracker',
  }} />);
  expect(screen.getAllByText('Not yet enabled')).toHaveLength(2);
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
});
