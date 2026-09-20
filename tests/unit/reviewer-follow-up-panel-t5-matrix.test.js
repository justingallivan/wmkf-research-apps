/**
 * @jest-environment jsdom
 *
 * ReviewerFollowUpPanel — T5 matrix (Stage 5a). No RTL test exists today.
 * loadProposals fires two parallel GETs (dashboard, review-manager/reviewers)
 * via Promise.all, both bare `.json().catch(() => ({}))`, each with its own
 * status-interpolated fallback. Migrated onto requestEnvelope with
 * tolerantBody: true, preserving both fallback texts verbatim.
 */
import { render, screen } from '@testing-library/react';
import ReviewerFollowUpPanel from '../../shared/components/workbench/ReviewerFollowUpPanel';

jest.mock('../../shared/components/Layout', () => ({
  Card: ({ children }) => <div>{children}</div>,
}));
jest.mock('../../shared/components/reviewers/ReviewerManagePanel', () => () => null);
jest.mock('../../shared/components/reviewers/EmailTemplatesModal', () => () => null);
jest.mock('next/link', () => ({ __esModule: true, default: ({ href, children }) => <a href={href}>{children}</a> }));

function renderPanel(overrides = {}) {
  return render(
    <ReviewerFollowUpPanel
      programId="program-a"
      cycleCode="J26"
      loadingCycles={false}
      scope="my"
      reviewersView="attention"
      search=""
      onScopeChange={jest.fn()}
      onReviewersViewChange={jest.fn()}
      onSearchChange={jest.fn()}
      {...overrides}
    />,
  );
}

function ok(body) {
  return { ok: true, status: 200, json: async () => body };
}
const unparseable = () => Promise.reject(new SyntaxError('Unexpected token <'));

afterEach(() => jest.restoreAllMocks());

test('loadProposals: 2xx success on both endpoints renders no error', async () => {
  global.fetch = jest.fn().mockResolvedValue(ok({ proposals: [] }));
  renderPanel();
  await new Promise((r) => setTimeout(r, 0));
  expect(screen.queryByText(/Failed to load/)).not.toBeInTheDocument();
});

test('dashboard non-2xx {error} surfaces its own fallback text verbatim', async () => {
  global.fetch = jest.fn((url) => (
    String(url).includes('/api/workbench/dashboard')
      ? Promise.resolve({ ok: false, status: 403, json: async () => ({ error: 'Forbidden' }) })
      : Promise.resolve(ok({ proposals: [] }))
  ));
  renderPanel();
  expect(await screen.findByText('Forbidden')).toBeInTheDocument();
});

test('reviewer-manager non-2xx {error} surfaces its own fallback text verbatim', async () => {
  global.fetch = jest.fn((url) => (
    String(url).includes('/api/review-manager/reviewers')
      ? Promise.resolve({ ok: false, status: 403, json: async () => ({ error: 'No access' }) })
      : Promise.resolve(ok({ proposals: [] }))
  ));
  renderPanel();
  expect(await screen.findByText('No access')).toBeInTheDocument();
});

test('network rejection is never silent', async () => {
  global.fetch = jest.fn().mockRejectedValue(new Error('offline'));
  renderPanel();
  expect(await screen.findByText('offline')).toBeInTheDocument();
});

test('dashboard axis (e): non-2xx unparseable body falls to the status fallback, never silent', async () => {
  global.fetch = jest.fn((url) => (
    String(url).includes('/api/workbench/dashboard')
      ? Promise.resolve({ ok: false, status: 502, json: unparseable })
      : Promise.resolve(ok({ proposals: [] }))
  ));
  renderPanel();
  expect(await screen.findByText('Failed to load assigned requests (502)')).toBeInTheDocument();
});

test('reviewer-manager axis (e): non-2xx unparseable body falls to the status fallback, never silent', async () => {
  global.fetch = jest.fn((url) => (
    String(url).includes('/api/review-manager/reviewers')
      ? Promise.resolve({ ok: false, status: 502, json: unparseable })
      : Promise.resolve(ok({ proposals: [] }))
  ));
  renderPanel();
  expect(await screen.findByText('Failed to load reviewer tracking (502)')).toBeInTheDocument();
});
