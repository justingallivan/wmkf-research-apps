/**
 * @jest-environment jsdom
 *
 * Manual-add "Confirm existing person" affordance (S403, owner report
 * 2026-08-06): when the identity lookup returns ambiguous candidates, the
 * submit used to silently re-render the amber box with no instruction, and the
 * candidate cards carried no visible signal that clicking one IS the confirm
 * action. Pins:
 *   1. Submitting with an ambiguous lookup surfaces an explicit inline error
 *      (no silent no-op).
 *   2. Each candidate card shows a "Use this person" affordance that flips to
 *      "✓ Selected" once chosen.
 *   3. Submitting after selection POSTs the chosen resolution to
 *      /api/workbench/manual-reviewer.
 */

import { act, render, screen, waitFor, fireEvent } from '@testing-library/react';

jest.mock('../../shared/components/Layout', () => ({
  Card: ({ children }) => <div>{children}</div>,
}));
// Render the manual-add slot so the form under test reaches the DOM.
jest.mock('../../shared/components/reviewers/ReviewerSearchSection', () => function SearchStub({ manualAddSlot }) {
  return <div data-testid="search">{manualAddSlot}</div>;
});

import ReviewerFindPanel from '../../shared/components/reviewers/ReviewerFindPanel';

const REQ = 'aaaaaaaa-1111-1111-1111-111111111111';

function response(data, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => data };
}

const LOOKUP_CANDIDATES = {
  outcome: 'candidates',
  candidates: [
    {
      source: 'reviewer',
      reviewerId: 'r-77',
      contactId: 'c-77',
      matchKey: 'email',
      context: { name: 'Peter Guengerich', email: 'f.guengerich@vanderbilt.edu', affiliation: 'Vanderbilt University' },
    },
  ],
};

function mockFetch({ onManualPost }) {
  global.fetch = jest.fn((url, opts = {}) => {
    const target = String(url);
    if (target.includes('/api/workbench/applicant-reviewers')) {
      return Promise.resolve(response({ success: true, recommended: [], slotsPopulated: 0 }));
    }
    if (target === '/api/reviewer-finder/load-proposal') {
      return Promise.resolve(response({ success: true, blobUrl: null, allFiles: [] }));
    }
    if (target === '/api/workbench/reviewer-lookup') {
      return Promise.resolve(response(LOOKUP_CANDIDATES));
    }
    if (target === '/api/workbench/manual-reviewer') {
      const body = JSON.parse(opts.body);
      if (onManualPost) onManualPost(body);
      return Promise.resolve(response({ success: true, outcome: 'created', candidate: { name: body.name } }));
    }
    return Promise.resolve(response({ success: true }));
  });
}

afterEach(() => {
  jest.clearAllMocks();
});

async function renderPanelAndSubmit() {
  await act(async () => {
    render(<ReviewerFindPanel requestId={REQ} savedPool={[]} />);
  });
  fireEvent.change(screen.getByLabelText(/^Name$/i), { target: { value: 'Fred Guengerich' } });
  fireEvent.change(screen.getByLabelText(/^Email$/i), { target: { value: 'f.guengerich@vanderbilt.edu' } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /add reviewer/i }));
  });
}

test('ambiguous lookup on submit surfaces an explicit instruction instead of a silent no-op', async () => {
  mockFetch({});
  await renderPanelAndSubmit();

  expect(screen.getByText('Confirm existing person')).toBeTruthy();
  // The inline error tells staff what to do next — this was previously absent.
  await waitFor(() => {
    expect(screen.getByText(/select a match below/i)).toBeTruthy();
  });
  // No create/reuse POST happened.
  const manualPosts = global.fetch.mock.calls.filter(([u]) => String(u) === '/api/workbench/manual-reviewer');
  expect(manualPosts).toHaveLength(0);
});

test('selecting a candidate turns the card green and "Confirm and Add" posts the resolution', async () => {
  const posts = [];
  mockFetch({ onManualPost: (body) => posts.push(body) });
  await renderPanelAndSubmit();

  // Confirm and Add is disabled until a candidate is selected.
  const confirmButton = await screen.findByRole('button', { name: 'Confirm and Add' });
  expect(confirmButton.disabled).toBe(true);

  const useButton = screen.getByText('Use this person');
  const card = useButton.closest('button');
  fireEvent.click(card);
  expect(screen.getByText('✓ Selected')).toBeTruthy();
  // Selected card matches the "✓ Existing linked reviewer record" green.
  expect(card.className).toContain('bg-emerald-50');
  // Choosing a resolution clears the instruction error.
  expect(screen.queryByText(/select a match below/i)).toBeNull();
  expect(confirmButton.disabled).toBe(false);

  await act(async () => {
    fireEvent.click(confirmButton);
  });

  expect(posts).toHaveLength(1);
  expect(posts[0].resolution).toEqual({ mode: 'reuse_reviewer', reviewerId: 'r-77', contactId: 'c-77' });
  await waitFor(() => {
    expect(screen.getByText(/added fred guengerich/i)).toBeTruthy();
  });
});

test('"Disconfirm" closes the card and submit posts create_new', async () => {
  const posts = [];
  mockFetch({ onManualPost: (body) => posts.push(body) });
  await renderPanelAndSubmit();

  fireEvent.click(await screen.findByRole('button', { name: 'Disconfirm' }));
  // Card closes and the instruction clears.
  expect(screen.queryByText('Confirm existing person')).toBeNull();
  expect(screen.queryByText(/select a match below/i)).toBeNull();

  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /add reviewer/i }));
  });

  // No re-lookup loop: the recorded create_new resolution submits directly.
  expect(posts).toHaveLength(1);
  expect(posts[0].resolution).toEqual({ mode: 'create_new' });
});
