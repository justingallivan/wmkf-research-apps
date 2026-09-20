/**
 * @jest-environment jsdom
 *
 * MeetingTrackerList — T5 gap-fill (Stage 5a). tests/unit/meeting-tracker-
 * pages.test.js already pins 2xx success for the three parallel GET sites
 * (dashboard, sessions, optional picker dashboard), migrated to
 * requestEnvelope with tolerantBody: true. This file adds non-2xx,
 * network-rejection, and axis-(e) coverage for the two required sites (the
 * optional picker site silently no-ops on failure both before and after
 * migration, per `pickerEnvelope?.ok ? ... : null`).
 */
import { render, screen } from '@testing-library/react';
import MeetingTrackerList from '../../shared/components/meeting-tracker/MeetingTrackerList';

let routerQuery = {};
jest.mock('next/router', () => ({
  useRouter: () => ({ isReady: true, query: routerQuery, replace: jest.fn(async () => true), pathname: '/meeting-tracker' }),
}));
jest.mock('../../shared/components/Layout', () => ({
  __esModule: true,
  default: ({ children }) => <div>{children}</div>,
  PageHeader: ({ title }) => <h1>{title}</h1>,
  Button: ({ children, ...props }) => <button {...props}>{children}</button>,
}));
jest.mock('next/link', () => function MockLink({ children, href }) {
  return <a href={typeof href === 'string' ? href : href.pathname}>{children}</a>;
});

const unparseable = () => Promise.reject(new SyntaxError('Unexpected token <'));

afterEach(() => jest.restoreAllMocks());

beforeEach(() => { routerQuery = { cycleCode: 'D26', programId: 'p1' }; });

test('dashboard non-2xx {error} surfaces its own fallback text verbatim', async () => {
  global.fetch = jest.fn((url) => (
    String(url).includes('cycleCode=')
      ? Promise.resolve({ ok: false, status: 500, json: async () => ({ error: 'boom' }) })
      : Promise.resolve({ ok: true, status: 200, json: async () => ({ sessions: [] }) })
  ));
  render(<MeetingTrackerList />);
  expect(await screen.findByRole('alert')).toHaveTextContent('boom');
});

test('sessions non-2xx falls to the fixed fallback text, never silent', async () => {
  global.fetch = jest.fn((url) => (
    String(url).includes('/sessions')
      ? Promise.resolve({ ok: false, status: 500, json: async () => ({}) })
      : Promise.resolve({
        ok: true, status: 200,
        json: async () => ({ programs: [{ id: 'p1', name: 'Research' }], programId: 'p1', cycleCode: 'D26', proposals: [], notices: [] }),
      })
  ));
  render(<MeetingTrackerList />);
  expect(await screen.findByRole('alert')).toHaveTextContent('The meeting sessions could not be loaded. Please try again.');
});

test('network rejection is never silent', async () => {
  global.fetch = jest.fn().mockRejectedValue(new Error('offline'));
  render(<MeetingTrackerList />);
  expect(await screen.findByRole('alert')).toHaveTextContent('offline');
});

test('dashboard axis (e): non-2xx unparseable body falls to the fixed fallback text, never silent', async () => {
  global.fetch = jest.fn((url) => (
    String(url).includes('cycleCode=')
      ? Promise.resolve({ ok: false, status: 502, json: unparseable })
      : Promise.resolve({ ok: true, status: 200, json: async () => ({ sessions: [] }) })
  ));
  render(<MeetingTrackerList />);
  expect(await screen.findByRole('alert')).toHaveTextContent('The meeting schedule could not be loaded. Please try again.');
});
