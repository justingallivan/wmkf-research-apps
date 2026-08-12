/**
 * @jest-environment jsdom
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ReviewerDueDateEditor from '../../shared/components/reviewers/ReviewerDueDateEditor';
import { currentYmdInTimeZone } from '../../lib/utils/date-ymd';

const SUGGESTION_ID = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  global.fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ success: true }),
  }));
});

test('shows the effective request default and saves a reviewer-specific date', async () => {
  const onSaved = jest.fn();
  render(
    <ReviewerDueDateEditor
      suggestionId={SUGGESTION_ID}
      effectiveDate="2026-09-01"
      defaultDate="2026-09-01"
      onSaved={onSaved}
    />,
  );

  fireEvent.click(screen.getByRole('button', { name: /review due: sep 1, 2026/i }));
  const dateInput = screen.getByLabelText(/reviewer-specific review due date/i);
  expect(dateInput).toHaveAttribute('min', currentYmdInTimeZone());
  fireEvent.change(dateInput, {
    target: { value: '2026-09-15' },
  });
  fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
    '/api/reviewer-finder/my-candidates',
    expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({
        suggestionId: SUGGESTION_ID,
        reviewDueDateOverride: '2026-09-15',
      }),
    }),
  ));
  await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
});

test('Use default clears an existing override with explicit null', async () => {
  render(
    <ReviewerDueDateEditor
      suggestionId={SUGGESTION_ID}
      overrideDate="2026-09-15"
      effectiveDate="2026-09-15"
      defaultDate="2026-09-01"
    />,
  );

  fireEvent.click(screen.getByRole('button', { name: /sep 15, 2026.*override/i }));
  fireEvent.click(screen.getByRole('button', { name: /use default/i }));

  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
    '/api/reviewer-finder/my-candidates',
    expect.objectContaining({
      body: JSON.stringify({
        suggestionId: SUGGESTION_ID,
        reviewDueDateOverride: null,
      }),
    }),
  ));
});

test('read-only mode renders the effective date without edit controls', () => {
  render(
    <ReviewerDueDateEditor
      suggestionId={SUGGESTION_ID}
      overrideDate="2026-09-15"
      effectiveDate="2026-09-15"
      defaultDate="2026-09-01"
      canManage={false}
    />,
  );

  expect(screen.getByText('Sep 15, 2026 (override)')).toBeInTheDocument();
  expect(screen.queryByRole('button')).toBeNull();
});

test('ignores a stale save response after the component is reused for another reviewer', async () => {
  let finishRequest;
  global.fetch = jest.fn(() => new Promise((resolve) => {
    finishRequest = () => resolve({
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
    });
  }));
  const onSaved = jest.fn();
  const { rerender } = render(
    <ReviewerDueDateEditor
      suggestionId={SUGGESTION_ID}
      effectiveDate="2026-09-01"
      defaultDate="2026-09-01"
      onSaved={onSaved}
    />,
  );

  fireEvent.click(screen.getByRole('button', { name: /review due: sep 1, 2026/i }));
  fireEvent.change(screen.getByLabelText(/reviewer-specific review due date/i), {
    target: { value: '2026-09-15' },
  });
  fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
  await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));

  rerender(
    <ReviewerDueDateEditor
      suggestionId="22222222-2222-4222-8222-222222222222"
      effectiveDate="2026-10-01"
      defaultDate="2026-10-01"
      onSaved={onSaved}
    />,
  );
  finishRequest();

  await waitFor(() => expect(screen.getByRole('button', { name: /review due: oct 1, 2026/i })).toBeEnabled());
  expect(onSaved).not.toHaveBeenCalled();
});
