/** @jest-environment jsdom */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import SiteVisitLogisticsPanel from '../../shared/components/workbench/SiteVisitLogisticsPanel';

jest.mock('../../shared/components/Layout', () => ({
  Card: ({ children }) => <div>{children}</div>,
}));

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const SETUP_FETCH = global.fetch;
const visit = {
  activityId: '22222222-2222-4222-8222-222222222222',
  etag: 'W/"2"',
  subject: 'Site Visit — 1002379',
  description: 'Discussion',
  startLocal: '2026-09-15T09:00',
  endLocal: '2026-09-15T11:00',
  timeZone: 'America/Chicago',
  format: 100000002,
  locationOrLink: 'Conference room / Teams',
  organizer: { kind: 'staff', profileId: 7 },
  requiredAttendees: [{ kind: 'roster', rosterId: 12 }],
  optionalAttendees: [],
};

function response(body, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
}

beforeEach(() => {
  global.fetch = jest.fn()
    .mockImplementationOnce(() => response({
      success: true,
      siteVisit: visit,
      materials: [{
        artifactId: '33333333-3333-4333-8333-333333333333',
        filename: 'Applicant Slides.pdf',
        artifactTypeLabel: 'Applicant Slides',
      }],
    }))
    .mockImplementationOnce(() => response({
      success: true,
      staff: [{ kind: 'staff', profileId: 7, name: 'Organizer', email: 'organizer@wmkeck.org' }],
      external: [{ kind: 'roster', rosterId: 12, name: 'Board Member', email: 'board@example.org', roleType: 'Board' }],
    }));
});

afterEach(() => {
  global.fetch = SETUP_FETCH;
});

test('loads the saved activity and PATCHes stable recipient references with its ETag', async () => {
  const onContext = jest.fn();
  render(
    <SiteVisitLogisticsPanel
      requestId={REQUEST_ID}
      requestNumber="1002379"
      onContext={onContext}
    />,
  );

  expect(await screen.findByDisplayValue('Conference room / Teams')).toBeInTheDocument();
  expect(screen.getByLabelText('Start date')).toHaveValue('2026-09-15');
  expect(screen.getByLabelText('Start time')).toHaveValue('09:00');
  expect(screen.getByLabelText('End date')).toHaveValue('2026-09-15');
  expect(screen.getByLabelText('End time')).toHaveValue('11:00');
  expect(screen.getByLabelText('Time zone')).toHaveValue('America/Chicago');
  expect(screen.getByLabelText('Attendee role for Board Member (board@example.org)')).toHaveValue('required');
  await waitFor(() => expect(onContext).toHaveBeenCalledWith(expect.objectContaining({
    siteVisit: visit,
    suggestedTo: ['organizer@wmkeck.org', 'board@example.org'],
  })));

  global.fetch.mockImplementationOnce(() => response({
    success: true,
    siteVisit: { ...visit, etag: 'W/"3"', locationOrLink: 'New location' },
  }));
  fireEvent.change(screen.getByLabelText('Location or meeting link'), {
    target: { value: 'New location' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Update logistics' }));

  await screen.findByText('Saved');
  const patchCall = global.fetch.mock.calls.find(([, options]) => options?.method === 'PATCH');
  expect(JSON.parse(patchCall[1].body)).toMatchObject({
    requestId: REQUEST_ID,
    activityId: visit.activityId,
    etag: 'W/"2"',
    locationOrLink: 'New location',
    startLocal: '2026-09-15T09:00',
    endLocal: '2026-09-15T11:00',
    timeZone: 'America/Chicago',
    disambiguation: 'earlier',
    organizer: { kind: 'staff', profileId: 7 },
    requiredAttendees: [{ kind: 'roster', rosterId: 12 }],
  });
});

test('uses separate date and time controls and preserves an end time chosen by the user', async () => {
  global.fetch = jest.fn()
    .mockImplementationOnce(() => response({ success: true, siteVisit: null, materials: [] }))
    .mockImplementationOnce(() => response({ success: true, staff: [], external: [] }));

  render(
    <SiteVisitLogisticsPanel
      requestId={REQUEST_ID}
      requestNumber="1002379"
    />,
  );

  const startDate = await screen.findByLabelText('Start date');
  const startTime = screen.getByLabelText('Start time');
  const endDate = screen.getByLabelText('End date');
  const endTime = screen.getByLabelText('End time');
  expect(startDate).toHaveAttribute('type', 'date');
  expect(endDate).toHaveAttribute('type', 'date');
  expect(startTime).toHaveAttribute('type', 'time');
  expect(endTime).toHaveAttribute('type', 'time');
  expect(startTime).toHaveAttribute('step', '900');
  expect(endTime).toHaveAttribute('step', '900');
  const timeZone = screen.getByLabelText('Time zone');
  expect(timeZone.tagName).toBe('SELECT');
  expect(timeZone).toHaveValue('America/Los_Angeles');
  expect([...timeZone.options].map((option) => option.value)).toEqual([
    'America/Los_Angeles',
    'America/Denver',
    'America/Phoenix',
    'America/Chicago',
    'America/New_York',
    'America/Anchorage',
    'Pacific/Honolulu',
  ]);

  fireEvent.change(startDate, { target: { value: '2026-09-15' } });
  expect(endDate).toHaveValue('2026-09-15');
  fireEvent.change(startTime, { target: { value: '09:15' } });
  expect(endTime).toHaveValue('10:15');

  fireEvent.change(endTime, { target: { value: '11:45' } });
  fireEvent.change(startTime, { target: { value: '08:30' } });
  expect(endTime).toHaveValue('11:45');
  expect(screen.queryByLabelText(/Daylight saving time overlap/i)).not.toBeInTheDocument();
});

test('preserves a saved timezone that is not in the curated dropdown', async () => {
  global.fetch = jest.fn()
    .mockImplementationOnce(() => response({
      success: true,
      siteVisit: { ...visit, timeZone: 'America/Boise' },
      materials: [],
    }))
    .mockImplementationOnce(() => response({ success: true, staff: [], external: [] }));

  render(
    <SiteVisitLogisticsPanel
      requestId={REQUEST_ID}
      requestNumber="1002379"
    />,
  );

  const timeZone = await screen.findByLabelText('Time zone');
  expect(timeZone).toHaveValue('America/Boise');
  expect(screen.getByRole('option', { name: 'America/Boise (saved)' })).toBeInTheDocument();
});

test('rolls an untouched default end into the next date', async () => {
  global.fetch = jest.fn()
    .mockImplementationOnce(() => response({ success: true, siteVisit: null, materials: [] }))
    .mockImplementationOnce(() => response({ success: true, staff: [], external: [] }));

  render(
    <SiteVisitLogisticsPanel
      requestId={REQUEST_ID}
      requestNumber="1002379"
    />,
  );

  fireEvent.change(await screen.findByLabelText('Start time'), { target: { value: '23:30' } });
  fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-09-15' } });
  expect(screen.getByLabelText('End date')).toHaveValue('2026-09-16');
  expect(screen.getByLabelText('End time')).toHaveValue('00:30');
});

test('uses one attendee role per email and excludes the organizer automatically', async () => {
  global.fetch = jest.fn()
    .mockImplementationOnce(() => response({ success: true, siteVisit: null, materials: [] }))
    .mockImplementationOnce(() => response({
      success: true,
      staff: [{ kind: 'staff', profileId: 7, name: 'Justin Staff', email: 'jgallivan@wmkeck.org' }],
      external: [
        { kind: 'roster', rosterId: 12, name: 'Justin Board', email: 'JGALLIVAN@wmkeck.org', roleType: 'Board' },
        { kind: 'roster', rosterId: 13, name: 'Consultant One', email: 'consultant@example.org', roleType: 'Consultant' },
      ],
    }));

  render(
    <SiteVisitLogisticsPanel
      requestId={REQUEST_ID}
      requestNumber="1002379"
    />,
  );

  const organizer = await screen.findByLabelText('Organizer');
  fireEvent.change(organizer, { target: { value: 'staff:7' } });
  expect(screen.queryByLabelText('Justin Board')).not.toBeInTheDocument();

  const consultantRole = screen.getByLabelText('Attendee role for Consultant One (consultant@example.org)');
  fireEvent.change(consultantRole, { target: { value: 'required' } });
  expect(consultantRole).toHaveValue('required');
  fireEvent.change(consultantRole, { target: { value: 'optional' } });
  expect(consultantRole).toHaveValue('optional');
});

test('round-trips a saved no-email attendee and still allows removing it', async () => {
  const noEmailVisit = {
    ...visit,
    requiredAttendees: [{ kind: 'roster', rosterId: 99 }],
  };
  global.fetch = jest.fn()
    .mockImplementationOnce(() => response({ success: true, siteVisit: noEmailVisit, materials: [] }))
    .mockImplementationOnce(() => response({
      success: true,
      staff: [{ kind: 'staff', profileId: 7, name: 'Organizer', email: 'organizer@wmkeck.org' }],
      external: [{ kind: 'roster', rosterId: 99, name: 'No Email Board', email: null, roleType: 'Board' }],
    }));

  render(
    <SiteVisitLogisticsPanel
      requestId={REQUEST_ID}
      requestNumber="1002379"
    />,
  );

  const role = await screen.findByLabelText('Attendee role for No Email Board (email needed)');
  expect(role).toBeEnabled();
  expect(role).toHaveValue('required');
  expect(screen.getByText(/can be completed in Expertise Finder/i)).toBeInTheDocument();

  global.fetch.mockImplementationOnce(() => response({
    success: true,
    siteVisit: { ...noEmailVisit, etag: 'W/"3"' },
  }));
  fireEvent.click(screen.getByRole('button', { name: 'Update logistics' }));
  await screen.findByText('Saved');
  let patchCalls = global.fetch.mock.calls.filter(([, options]) => options?.method === 'PATCH');
  expect(JSON.parse(patchCalls[0][1].body).requiredAttendees)
    .toEqual([{ kind: 'roster', rosterId: 99 }]);

  fireEvent.change(role, { target: { value: '' } });
  global.fetch.mockImplementationOnce(() => response({
    success: true,
    siteVisit: { ...noEmailVisit, etag: 'W/"4"', requiredAttendees: [] },
  }));
  fireEvent.click(screen.getByRole('button', { name: 'Update logistics' }));
  await screen.findByText('Saved');
  patchCalls = global.fetch.mock.calls.filter(([, options]) => options?.method === 'PATCH');
  expect(JSON.parse(patchCalls[1][1].body).requiredAttendees).toEqual([]);
});
