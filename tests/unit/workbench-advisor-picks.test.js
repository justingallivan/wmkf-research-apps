/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import AdvisorPicks from '../../shared/components/workbench/AdvisorPicks';
import { requestJson } from '../../shared/utils/api-request';
jest.mock('../../shared/utils/api-request', () => ({ requestJson: jest.fn() }));

const picks = (overrides = {}) => ({
  success: true,
  scored: true,
  advisors: [
    { rosterId: 7, name: 'Edward Stolper', picked: false },
    { rosterId: 8, name: 'Kelsey Martin', picked: true },
  ],
  ...overrides,
});
beforeEach(() => { jest.resetAllMocks(); });

it('shows one checkbox per advisor and saves a tick on its own', async () => {
  requestJson.mockResolvedValueOnce(picks());
  render(<AdvisorPicks requestId="request" />);
  const stolper = await screen.findByRole('checkbox', { name: 'Edward Stolper' });
  expect(stolper).not.toBeChecked();
  expect(screen.getByRole('checkbox', { name: 'Kelsey Martin' })).toBeChecked();
  expect(requestJson).toHaveBeenCalledWith('/api/workbench/proposal-lists?requestId=request');

  requestJson.mockResolvedValueOnce(picks({ advisors: [
    { rosterId: 7, name: 'Edward Stolper', picked: true },
    { rosterId: 8, name: 'Kelsey Martin', picked: true },
  ] }));
  fireEvent.click(stolper);
  await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Edward Stolper' })).toBeChecked());
  expect(requestJson).toHaveBeenLastCalledWith('/api/workbench/proposal-lists', {
    method: 'POST', body: { action: 'pick', requestId: 'request', rosterId: 7, picked: true },
    fallbackMessage: 'Could not save that advisor.',
  });
});

it('renders nothing when the server says the request is not Scored', async () => {
  requestJson.mockResolvedValueOnce(picks({ scored: false }));
  const { container } = render(<AdvisorPicks requestId="request" />);
  await waitFor(() => expect(requestJson).toHaveBeenCalled());
  await waitFor(() => expect(container).toBeEmptyDOMElement());
});

it('renders nothing where proposal lists are off', async () => {
  requestJson.mockRejectedValueOnce(Object.assign(new Error('off'), { status: 503 }));
  const { container } = render(<AdvisorPicks requestId="request" />);
  await waitFor(() => expect(container).toBeEmptyDOMElement());
});

it('shows a save failure and keeps the saved ticks', async () => {
  requestJson.mockResolvedValueOnce(picks())
    .mockRejectedValueOnce(Object.assign(new Error('Advisors can be ticked only on a Scored request.'), { status: 409 }));
  render(<AdvisorPicks requestId="request" />);
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Edward Stolper' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('only on a Scored request');
  expect(screen.getByRole('checkbox', { name: 'Edward Stolper' })).not.toBeChecked();
});

it('disables the ticks on a read-only preview', async () => {
  requestJson.mockResolvedValueOnce(picks({ readOnly: true }));
  render(<AdvisorPicks requestId="request" />);
  expect(await screen.findByRole('checkbox', { name: 'Edward Stolper' })).toBeDisabled();
});
