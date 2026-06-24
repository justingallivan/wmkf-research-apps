/**
 * @jest-environment jsdom
 *
 * AppAccessContext resilience (S281) — the access fetch gates every app page,
 * so a stalled/failed request must NOT strand the UI on a permanent "Loading…"
 * spinner. These tests exercise the guard end-to-end against a mocked fetch:
 *   - success → gated content renders
 *   - no grant → "Access Not Available" (deny path preserved)
 *   - persistent failure → bounded retries end in a Retry affordance (not an
 *     endless spinner), and Retry recovers once the fetch succeeds.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { AppAccessProvider } from '../../shared/context/AppAccessContext';
import RequireAppAccess from '../../shared/components/RequireAppAccess';

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children }) => <a href={href}>{children}</a>,
}));

const okResponse = (body) => ({ ok: true, status: 200, json: async () => body });

function renderGuarded() {
  return render(
    <AppAccessProvider>
      <RequireAppAccess appKey="reviewers">
        <div>SECRET CONTENT</div>
      </RequireAppAccess>
    </AppAccessProvider>,
  );
}

// `fetch` is a global jest.fn() (jest.setup.js) cleared before each test; we set
// its implementation per-test and reset it afterward so impls don't leak.
afterEach(() => {
  fetch.mockReset();
});

test('renders gated content once access loads', async () => {
  fetch.mockResolvedValue(okResponse({ apps: ['reviewers'], isSuperuser: false }));
  renderGuarded();
  expect(await screen.findByText('SECRET CONTENT')).toBeInTheDocument();
});

test('shows "Access Not Available" when the user lacks the grant (deny path preserved)', async () => {
  fetch.mockResolvedValue(okResponse({ apps: [], isSuperuser: false }));
  renderGuarded();
  expect(await screen.findByText('Access Not Available')).toBeInTheDocument();
  expect(screen.queryByText('SECRET CONTENT')).not.toBeInTheDocument();
});

test('a persistently failing fetch ends in Retry (not an endless spinner), and Retry recovers', async () => {
  let calls = 0;
  fetch.mockImplementation(() => {
    calls += 1;
    // The mount load + its retries (MAX_ATTEMPTS) all fail; later calls succeed.
    if (calls <= 3) return Promise.reject(new Error('network'));
    return Promise.resolve(okResponse({ apps: ['reviewers'], isSuperuser: false }));
  });

  renderGuarded();

  // After the bounded retries the guard surfaces a Retry affordance — proving it
  // did not hang on "Loading…" forever.
  const retry = await screen.findByRole('button', { name: 'Retry' }, { timeout: 6000 });
  expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
  expect(screen.queryByText('SECRET CONTENT')).not.toBeInTheDocument();

  // Retry now succeeds → gated content renders.
  fireEvent.click(retry);
  expect(await screen.findByText('SECRET CONTENT')).toBeInTheDocument();
}, 15000);
