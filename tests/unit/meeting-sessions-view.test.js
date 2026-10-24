/** @jest-environment jsdom */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import Sessions from '../../shared/components/meeting-tracker/MeetingSessionsView';
jest.mock('next/link', () => function Link({ href, children, ...props }) { return <a href={href} {...props}>{children}</a>; });
const sessions = [
  { sessionId: 'first', scheduledStartIso: '2026-11-03T18:00:00Z', ianaTimeZone: 'America/Los_Angeles', location: 'Virtual meeting', status: 100000000 },
  { sessionId: 'second', scheduledStartIso: '2026-11-03T21:00:00Z', ianaTimeZone: 'America/Los_Angeles', location: 'Conference room', status: 100000001 },
];
const response = (data, ok = true) => ({ ok, json: async () => data });
const detail = (id, title) => ({ session: { sessionId: id }, slots: [{ wmkf_deliberationslotid: id, wmkf_minutes: 30, wmkf_Request: { akoya_requestnum: '123456', akoya_title: title } }] });

test('same-day sessions remain distinct, status/location search is explicit, and opening retains context', async () => {
  global.fetch = jest.fn(async (url) => response(detail(url.split('/').pop(), 'Actual agenda title')));
  render(<Sessions sessions={sessions} cycleCode="D26" programId="research" />);
  expect(await screen.findByText('Actual agenda title')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /10:00 AM PST/ })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByRole('button', { name: /1:00 PM PST/ }));
  await waitFor(() => expect(within(screen.getByRole('region', { name: 'Selected session preview' })).getByRole('link', { name: /Open selected session/ })).toHaveAttribute('href', '/meeting-tracker/sessions/second?cycleCode=D26&programId=research'));
  fireEvent.change(screen.getByRole('searchbox', { name: 'Find a session' }), { target: { value: 'Conference' } });
  expect(screen.queryByRole('button', { name: /10:00 AM PST/ })).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole('combobox', { name: 'Status' }), { target: { value: '100000000' } });
  expect(screen.getByText(/No sessions match these filters/)).toBeInTheDocument();
});
test('late responses never replace the selected agenda', async () => {
  let resolveFirst;
  global.fetch = jest.fn((url) => url.endsWith('/first') ? new Promise((resolve) => { resolveFirst = resolve; }) : Promise.resolve(response(detail('second', 'Second agenda'))));
  render(<Sessions sessions={sessions} />);
  fireEvent.click(screen.getByRole('button', { name: /1:00 PM PST/ }));
  expect(await screen.findByText('Second agenda')).toBeInTheDocument();
  await act(async () => resolveFirst(response(detail('first', 'Stale agenda'))));
  expect(screen.queryByText(/Stale agenda/)).not.toBeInTheDocument();
  expect(screen.getByText('Second agenda')).toBeInTheDocument();
});
test('malformed success is an agenda error, and retry recovers without a write', async () => {
  global.fetch = jest.fn().mockResolvedValueOnce(response({})).mockResolvedValueOnce(response(detail('first', 'Recovered agenda')));
  render(<Sessions sessions={sessions} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('The agenda could not be loaded.');
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByText('Recovered agenda')).toBeInTheDocument();
  expect(global.fetch.mock.calls.every(([, options]) => !options.method || options.method === 'GET')).toBe(true);
});
