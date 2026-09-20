/**
 * @jest-environment jsdom
 *
 * SiteVisitEditor — T5 gap-fill (Stage 5a). tests/unit/meeting-tracker-
 * visit-editor.test.js already pins 2xx success, exact request bytes, and
 * the write-conflict reload for the file's 3 fetch sites (visit GET,
 * recipients GET, PATCH save). The local `readJson(url, options, fallback)`
 * helper (previously `readJson(response, fallback)`) is folded to call
 * `requestEnvelope` internally, keeping its thrown Error shape
 * (`.code`, `.status`) verbatim — no fetch( sites remain raw. This file adds
 * network-rejection and axis-(e) coverage.
 */
import { render, screen } from '@testing-library/react';
import SiteVisitEditor from '../../shared/components/meeting-tracker/SiteVisitEditor';

let routerQuery = {};
jest.mock('next/router', () => ({ useRouter: () => ({ isReady: true, query: routerQuery }) }));
jest.mock('next/link', () => function MockLink({ children, href }) {
  return <a href={typeof href === 'string' ? href : href.pathname}>{children}</a>;
});
jest.mock('../../shared/components/Layout', () => ({
  __esModule: true,
  default: ({ children }) => <div>{children}</div>,
  Button: ({ children, loading, ...props }) => <button {...props}>{children}</button>,
}));

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const unparseable = () => Promise.reject(new SyntaxError('Unexpected token <'));

beforeEach(() => {
  routerQuery = { requestId: REQUEST_ID, n: '1003222', cycleCode: 'D26', programId: 'p1' };
});
afterEach(() => jest.restoreAllMocks());

test('load: network rejection is never silent', async () => {
  global.fetch = jest.fn().mockRejectedValue(new Error('offline'));
  render(<SiteVisitEditor />);
  expect(await screen.findByRole('alert')).toHaveTextContent('offline');
});

test('load axis (e): non-2xx unparseable body on the visit GET falls to its own fallback, never silent', async () => {
  global.fetch = jest.fn((url) => (
    String(url).includes('/visits/')
      ? Promise.resolve({ ok: false, status: 502, json: unparseable })
      : Promise.resolve({ ok: true, status: 200, json: async () => ({ staff: [], board: [] }) })
  ));
  render(<SiteVisitEditor />);
  expect(await screen.findByRole('alert')).toHaveTextContent('The site visit could not be loaded.');
});

test('load axis (e): non-2xx unparseable body on the recipients GET falls to its own fallback, never silent', async () => {
  global.fetch = jest.fn((url) => (
    String(url).includes('/recipients')
      ? Promise.resolve({ ok: false, status: 502, json: unparseable })
      : Promise.resolve({ ok: true, status: 200, json: async () => ({ siteVisit: null }) })
  ));
  render(<SiteVisitEditor />);
  expect(await screen.findByRole('alert')).toHaveTextContent('The attendee directory could not be loaded.');
});
