/**
 * @jest-environment jsdom
 *
 * StaffDeliberationsPanel — T5 gap-fill (Stage 5a). tests/unit/staff-
 * deliberations-panel.test.js already pins 2xx success; this file adds
 * non-2xx, network-rejection, and axis-(e) coverage for the single fetch
 * site (staff-deliberations GET, migrated to requestJson with
 * tolerantBody: true).
 */
import { render, screen } from '@testing-library/react';
import StaffDeliberationsPanel from '../../shared/components/workbench/StaffDeliberationsPanel';

jest.mock('next/link', () => function MockLink({ children, href }) {
  return <a href={href}>{children}</a>;
});

const unparseable = () => Promise.reject(new SyntaxError('Unexpected token <'));

afterEach(() => jest.restoreAllMocks());

test('non-2xx {error} surfaces the server message verbatim', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: 'Forbidden' }) });
  render(<StaffDeliberationsPanel cycleCode="D26" loadingCycles={false} scope="all" />);
  expect(await screen.findByText('Forbidden')).toBeInTheDocument();
});

test('network rejection is never silent', async () => {
  global.fetch = jest.fn().mockRejectedValue(new Error('offline'));
  render(<StaffDeliberationsPanel cycleCode="D26" loadingCycles={false} scope="all" />);
  expect(await screen.findByText('offline')).toBeInTheDocument();
});

test('axis (e): non-2xx unparseable body falls to the fallback text, never silent', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 502, json: unparseable });
  render(<StaffDeliberationsPanel cycleCode="D26" loadingCycles={false} scope="all" />);
  expect(await screen.findByText('Failed to load pre-site drafts')).toBeInTheDocument();
});
