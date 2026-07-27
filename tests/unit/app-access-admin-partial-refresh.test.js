/**
 * @jest-environment jsdom
 *
 * A grant/revoke batch can complete a prefix before returning non-2xx. The
 * admin UI must immediately replace its editable snapshot from the server so
 * Discard cannot restore stale permissions.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AppAccessSection } from '../../pages/admin';

const response = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

afterEach(() => {
  fetch.mockReset();
});

test('partial grant failure forces and awaits a canonical snapshot refresh', async () => {
  fetch
    .mockResolvedValueOnce(response(200, {
      grants: [{
        user_profile_id: 8,
        user_name: 'Test User',
        azure_email: null,
        apps: [],
      }],
      allApps: ['dynamics-explorer', 'literature-analyzer'],
    }))
    .mockResolvedValueOnce(response(502, {
      error: 'Unable to grant all requested app access',
      granted: ['dynamics-explorer'],
    }))
    .mockResolvedValueOnce(response(200, {
      grants: [{
        user_profile_id: 8,
        user_name: 'Test User',
        azure_email: null,
        apps: ['dynamics-explorer'],
      }],
      allApps: ['dynamics-explorer', 'literature-analyzer'],
    }));

  render(<AppAccessSection />);
  await screen.findByText('Test User');

  const checkboxes = screen.getAllByRole('checkbox');
  expect(checkboxes).toHaveLength(3);
  fireEvent.click(checkboxes[0]);
  fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

  expect(await screen.findByText(
    'Unable to grant all requested app access. Current grants were reloaded.',
  )).toBeInTheDocument();
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));

  expect(screen.getAllByRole('checkbox')[0]).toBeChecked();
  expect(screen.queryByRole('button', { name: 'Discard' })).not.toBeInTheDocument();
});

test('failed canonical refresh locks the stale snapshot until Retry succeeds', async () => {
  fetch
    .mockResolvedValueOnce(response(200, {
      grants: [{
        user_profile_id: 8,
        user_name: 'Test User',
        azure_email: null,
        apps: [],
      }],
      allApps: ['dynamics-explorer'],
    }))
    .mockResolvedValueOnce(response(502, {
      error: 'Unable to grant all requested app access',
      granted: ['dynamics-explorer'],
    }))
    .mockResolvedValueOnce(response(502, {
      error: 'Unable to load app access grants',
    }))
    .mockResolvedValueOnce(response(200, {
      grants: [{
        user_profile_id: 8,
        user_name: 'Test User',
        azure_email: null,
        apps: ['dynamics-explorer'],
      }],
      allApps: ['dynamics-explorer'],
    }));

  render(<AppAccessSection />);
  await screen.findByText('Test User');

  fireEvent.click(screen.getAllByRole('checkbox')[0]);
  fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

  expect(await screen.findByText(/Current grants could not be reloaded/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save Changes' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Discard' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Remove' })).toBeDisabled();
  for (const checkbox of screen.getAllByRole('checkbox')) {
    expect(checkbox).toBeDisabled();
  }

  fireEvent.click(screen.getByRole('button', { name: 'Retry grant reload' }));

  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(4));
  await waitFor(() => expect(screen.getAllByRole('checkbox')[0]).toBeEnabled());
  expect(screen.getAllByRole('checkbox')[0]).toBeChecked();
  expect(screen.queryByRole('button', { name: 'Discard' })).not.toBeInTheDocument();
});
