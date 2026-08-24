/** @jest-environment jsdom */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import SiteVisitLogisticsPanel from '../../shared/components/workbench/SiteVisitLogisticsPanel';

jest.mock('../../shared/components/Layout', () => ({
  Card: ({ children }) => <div>{children}</div>,
}));

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
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
  delete global.fetch;
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
  await waitFor(() => expect(onContext).toHaveBeenCalledWith(expect.objectContaining({
    siteVisit: visit,
    suggestedTo: ['board@example.org'],
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
    organizer: { kind: 'staff', profileId: 7 },
    requiredAttendees: [{ kind: 'roster', rosterId: 12 }],
  });
});
