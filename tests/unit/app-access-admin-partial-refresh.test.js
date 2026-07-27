/**
 * @jest-environment jsdom
 *
 * A grant/revoke batch can complete a prefix before returning non-2xx. The
 * admin UI must immediately replace its editable snapshot from the server so
 * Discard cannot restore stale permissions.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AppAccessSection } from '../../pages/admin';

const response = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

afterEach(() => {
  fetch.mockReset();
  jest.restoreAllMocks();
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

test('initial grant-load failure does not render a false empty state', async () => {
  fetch.mockResolvedValueOnce(response(502, {
    error: 'Unable to load app access grants',
  }));

  render(<AppAccessSection />);

  expect(await screen.findByText('Unable to load app access grants')).toBeInTheDocument();
  expect(screen.queryByText('No users found.')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Retry grant reload' })).toBeInTheDocument();
});

test('successful user removal preserves its confirmation after the canonical reload', async () => {
  jest.spyOn(window, 'confirm').mockReturnValue(true);
  let resolveDelete;
  const pendingDelete = new Promise(resolve => {
    resolveDelete = resolve;
  });
  fetch
    .mockResolvedValueOnce(response(200, {
      grants: [{
        user_profile_id: 8,
        user_name: 'Test User',
        azure_email: null,
        apps: ['dynamics-explorer'],
      }],
      allApps: ['dynamics-explorer'],
    }))
    .mockImplementationOnce(() => pendingDelete)
    .mockResolvedValueOnce(response(200, {
      grants: [],
      allApps: ['dynamics-explorer'],
    }));

  render(<AppAccessSection />);
  await screen.findByText('Test User');
  fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

  expect(screen.getByRole('button', { name: 'Remove' })).toBeDisabled();
  for (const checkbox of screen.getAllByRole('checkbox')) {
    expect(checkbox).toBeDisabled();
  }

  await act(async () => {
    resolveDelete(response(200, { name: 'Test User' }));
  });

  expect(await screen.findByText('Removed Test User')).toBeInTheDocument();
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
  expect(screen.getByText('Removed Test User')).toBeInTheDocument();
  expect(screen.queryByText('Test User')).not.toBeInTheDocument();
  expect(screen.getByText('No users found.')).toBeInTheDocument();
});

test('successful user removal stays explicit when the canonical reload fails', async () => {
  jest.spyOn(window, 'confirm').mockReturnValue(true);
  fetch
    .mockResolvedValueOnce(response(200, {
      grants: [{
        user_profile_id: 8,
        user_name: 'Test User',
        azure_email: null,
        apps: ['dynamics-explorer'],
      }],
      allApps: ['dynamics-explorer'],
    }))
    .mockResolvedValueOnce(response(200, {
      name: 'Test User',
    }))
    .mockResolvedValueOnce(response(502, {
      error: 'Unable to load app access grants',
    }));

  render(<AppAccessSection />);
  await screen.findByText('Test User');
  fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

  expect(await screen.findByText(
    'Removed Test User, but the current grant snapshot could not be reloaded. Refresh before editing again.',
  )).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Remove' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Retry grant reload' })).toBeInTheDocument();
  expect(screen.queryByText('No users found.')).not.toBeInTheDocument();
});

test('successful grant save preserves its confirmation after the canonical reload', async () => {
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
    .mockResolvedValueOnce(response(200, {
      granted: ['dynamics-explorer'],
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

  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
  expect(screen.getByText('Saved: 1 granted')).toBeInTheDocument();
});

test('successful user removal remains explicit when authorization expires during reload', async () => {
  jest.spyOn(window, 'confirm').mockReturnValue(true);
  fetch
    .mockResolvedValueOnce(response(200, {
      grants: [{
        user_profile_id: 8,
        user_name: 'Test User',
        azure_email: null,
        apps: ['dynamics-explorer'],
      }],
      allApps: ['dynamics-explorer'],
    }))
    .mockResolvedValueOnce(response(200, {
      name: 'Test User',
    }))
    .mockResolvedValueOnce(response(401, {}));

  render(<AppAccessSection />);
  await screen.findByText('Test User');
  fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

  expect(await screen.findByText(
    'Removed Test User, but your admin session expired before the grant snapshot could be reloaded. Sign in again to verify the current grants.',
  )).toBeInTheDocument();
  expect(screen.queryByText('No users found.')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
});

test('successful grant save remains explicit when authorization expires during reload', async () => {
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
    .mockResolvedValueOnce(response(200, {
      granted: ['dynamics-explorer'],
    }))
    .mockResolvedValueOnce(response(403, {}));

  render(<AppAccessSection />);
  await screen.findByText('Test User');
  fireEvent.click(screen.getAllByRole('checkbox')[0]);
  fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

  expect(await screen.findByText(
    'Changes were saved, but your admin session expired before the grant snapshot could be reloaded. Sign in again to verify the current grants.',
  )).toBeInTheDocument();
  expect(screen.queryByText('No users found.')).not.toBeInTheDocument();
});
