/**
 * @jest-environment jsdom
 *
 * InitialAssessmentsPanel — T5 matrix (Stage 5a). No RTL test exists today.
 * The single fetch site (initial-assessment?cycleCode GET) is a bare
 * `.json().catch(() => ({}))` throw-on-!ok-with-fallback site, migrated to
 * requestJson with `tolerantBody: true`.
 */
import { render, screen } from '@testing-library/react';
import InitialAssessmentsPanel from '../../shared/components/workbench/InitialAssessmentsPanel';

jest.mock('../../shared/components/Layout', () => ({
  Card: ({ children }) => <div>{children}</div>,
}));
jest.mock('next/link', () => ({ __esModule: true, default: ({ href, children }) => <a href={href}>{children}</a> }));

const unparseable = () => Promise.reject(new SyntaxError('Unexpected token <'));

afterEach(() => jest.restoreAllMocks());

test('2xx success renders artifacts', async () => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true, status: 200,
    json: async () => ({ artifacts: [{ artifactId: 'a1', requestNumber: '1001', file: { name: 'x.docx' } }] }),
  });
  render(<InitialAssessmentsPanel cycleCode="J26" loadingCycles={false} />);
  expect(await screen.findByText('#1001')).toBeInTheDocument();
});

test('non-2xx {error} surfaces the server message verbatim', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: 'Forbidden' }) });
  render(<InitialAssessmentsPanel cycleCode="J26" loadingCycles={false} />);
  expect(await screen.findByText('Forbidden')).toBeInTheDocument();
});

test('network rejection is never silent', async () => {
  global.fetch = jest.fn().mockRejectedValue(new Error('offline'));
  render(<InitialAssessmentsPanel cycleCode="J26" loadingCycles={false} />);
  expect(await screen.findByText('offline')).toBeInTheDocument();
});

test('axis (e): non-2xx unparseable body falls to the fallback text, never silent', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 502, json: unparseable });
  render(<InitialAssessmentsPanel cycleCode="J26" loadingCycles={false} />);
  expect(await screen.findByText('Failed to load artifacts')).toBeInTheDocument();
});
