/**
 * @jest-environment jsdom
 *
 * WorkbenchShell — T5 gap-fill (Stage 5a). tests/unit/workbench-shell.test.js
 * already pins 2xx success and (after this stage's GET call-shape fix) exact
 * request shape for the dashboard cycles GET. This file adds non-2xx,
 * network-rejection, and axis-(e) coverage for that fetch site (migrated to
 * requestJson with a static `fallbackMessage`; no existing test pins the
 * prior status-interpolated fallback text).
 */
import { render, screen } from '@testing-library/react';
import { WorkbenchShell } from '../../shared/components/workbench/WorkbenchShell';

const routerState = { pathname: '/workbench', asPath: '/workbench', query: {}, isReady: true };
jest.mock('next/router', () => ({ useRouter: () => ({ ...routerState, push: jest.fn(), replace: jest.fn() }) }));

jest.mock('../../shared/components/Layout', () => ({
  __esModule: true,
  default: ({ children }) => <div>{children}</div>,
  PageHeader: ({ title }) => <h1>{title}</h1>,
  Card: ({ children }) => <div>{children}</div>,
}));
jest.mock('../../shared/components/workbench/RequestLocator', () => ({ __esModule: true, RequestLocator: () => null }));
jest.mock('../../shared/components/workbench/ReviewerStatusIndicator', () => ({ __esModule: true, default: () => null }));
jest.mock('../../shared/components/reviewers/ReviewerManagePanel', () => ({ __esModule: true, default: () => null }));
jest.mock('../../shared/components/reviewers/EmailTemplatesModal', () => ({ __esModule: true, default: () => null }));
jest.mock('../../shared/components/workbench/ArtifactFileMetadata', () => ({ __esModule: true, default: () => null }));

const unparseable = () => Promise.reject(new SyntaxError('Unexpected token <'));

afterEach(() => jest.restoreAllMocks());

test('cycles load: non-2xx {error} surfaces the server message verbatim', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: 'Forbidden' }) });
  render(<WorkbenchShell />);
  expect(await screen.findByText(/Forbidden/)).toBeInTheDocument();
});

test('cycles load: network rejection is never silent', async () => {
  global.fetch = jest.fn().mockRejectedValue(new Error('offline'));
  render(<WorkbenchShell />);
  expect(await screen.findByText(/offline/)).toBeInTheDocument();
});

test('cycles load axis (e): non-2xx unparseable body falls to the fallback text, never silent', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 502, json: unparseable });
  render(<WorkbenchShell />);
  expect(await screen.findByText(/Failed to load cycles/)).toBeInTheDocument();
});
