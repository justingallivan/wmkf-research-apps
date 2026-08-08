/**
 * @jest-environment jsdom
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DynamicsFeedbackSection } from '../../pages/admin';

const feedbackResponse = () => ({
  ok: true,
  json: async () => ({ feedback: [], summary: {} }),
});

beforeEach(() => {
  global.fetch = jest.fn().mockImplementation(async () => feedbackResponse());
});

afterEach(() => {
  jest.restoreAllMocks();
});

test('selecting All statuses overrides the default new status filter', async () => {
  render(<DynamicsFeedbackSection />);

  await screen.findByText('No feedback records found.');
  expect(fetch).toHaveBeenNthCalledWith(
    1,
    '/api/dynamics-explorer/feedback?status=new',
  );

  fireEvent.change(screen.getAllByRole('combobox')[0], {
    target: { value: '' },
  });

  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  expect(fetch.mock.calls[1][0]).not.toContain('status=');
});

test('selecting All types overrides the previously selected type filter', async () => {
  render(<DynamicsFeedbackSection />);

  await screen.findByText('No feedback records found.');
  const typeFilter = screen.getAllByRole('combobox')[1];
  fireEvent.change(typeFilter, { target: { value: 'negative' } });
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  expect(fetch.mock.calls[1][0]).toContain('type=negative');

  const updatedFilters = await screen.findAllByRole('combobox');
  fireEvent.change(updatedFilters[1], { target: { value: '' } });

  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
  expect(fetch.mock.calls[2][0]).not.toContain('type=');
});
