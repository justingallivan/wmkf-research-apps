/**
 * @jest-environment jsdom
 *
 * FinalWriteupsViews — T5 gap-fill (Stage 5a). tests/unit/final-writeups-
 * views.test.js already pins 2xx success and exact request bytes for the
 * file's 3 fetch sites (dashboard cycleCode GET, focused requestId GET,
 * acknowledgement POST), migrated to requestJson with tolerantBody: true
 * and a static `fallbackMessage` (D3: drops the prior status-interpolated
 * text; no existing test pinned it). This file adds network-rejection and
 * axis (e).
 */
import { render, screen } from '@testing-library/react';
import {
  FinalWriteupFocusedView,
  FinalWriteupsPanel,
} from '../../shared/components/final-writeups/FinalWriteupsViews';

jest.mock('../../shared/components/Layout', () => ({
  __esModule: true,
  default: ({ children }) => <main>{children}</main>,
}));

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const unparseable = () => Promise.reject(new SyntaxError('Unexpected token <'));

afterEach(() => jest.restoreAllMocks());

test('dashboard load: network rejection is never silent', async () => {
  global.fetch = jest.fn().mockRejectedValue(new Error('offline'));
  render(<FinalWriteupsPanel cycleCode="D26" />);
  expect(await screen.findByRole('alert')).toHaveTextContent('offline');
});

test('dashboard load axis (e): non-2xx unparseable body falls to the fallback text, never silent', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 502, json: unparseable });
  render(<FinalWriteupsPanel cycleCode="D26" />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load Final Writeups');
});

test('focused load: network rejection is never silent', async () => {
  global.fetch = jest.fn().mockRejectedValue(new Error('offline'));
  render(<FinalWriteupFocusedView requestId={REQUEST_ID} />);
  expect(await screen.findByText('offline')).toBeInTheDocument();
});

test('focused load axis (e): non-2xx unparseable body falls to the fallback text, never silent', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 502, json: unparseable });
  render(<FinalWriteupFocusedView requestId={REQUEST_ID} />);
  expect(await screen.findByText('Failed to load Final Writeup')).toBeInTheDocument();
});
