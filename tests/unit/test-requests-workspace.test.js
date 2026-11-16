/**
 * @jest-environment jsdom
 */
/**
 * Test Requests workspace (owner, 2026-11-15): the email allowlist panel starts collapsed, so a
 * load-time problem with the saved list must still be visible in the panel's summary (Codex).
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TestRequestsWorkspace } from '../../shared/components/admin/workspaces/TestRequestsWorkspace';

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body), headers: { get: () => 'application/json' } });

function serve(allowlist, put = null) {
  global.fetch.mockImplementation(async (url, init = {}) => {
    if (String(url).includes('/email-allowlist')) return (init.method === 'PUT' ? put : allowlist);
    return json(200, { runs: [], formEnabled: true, target: 'production' });
  });
}

beforeEach(() => { global.fetch.mockReset(); });

test('the allowlist panel starts closed and shows no warning when the list loads', async () => {
  serve(json(200, { addresses: ['a@example.org'], foundationDomain: 'wmkeck.org', maxAddresses: 200, unavailable: false }));
  render(<TestRequestsWorkspace />);
  const title = await screen.findByRole('heading', { name: 'Test-request email allowlist' });
  expect(title.closest('details').open).toBe(false);
  await screen.findByDisplayValue('a@example.org');
  expect(screen.queryByText(/Open this panel/)).toBeNull();
});

test('an unreadable saved list is announced in the closed panel summary', async () => {
  serve(json(200, { addresses: [], foundationDomain: 'wmkeck.org', maxAddresses: 200, unavailable: true }));
  render(<TestRequestsWorkspace />);
  const warning = await screen.findByText("The saved list can't be read, so only @wmkeck.org addresses are allowed right now. Open this panel to fix it.");
  const details = warning.closest('details');
  expect(details.open).toBe(false);
  expect(warning.closest('summary')).toBeTruthy();
});

test('a failed load is announced in the closed panel summary', async () => {
  serve(json(500, { error: 'boom' }));
  render(<TestRequestsWorkspace />);
  const warning = await screen.findByText("The allowlist couldn't be loaded. Open this panel to see why.");
  expect(warning.closest('summary')).toBeTruthy();
});

const typeAndSave = (value) => {
  fireEvent.change(screen.getByLabelText(/Allowed addresses/), { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: 'Save allowlist' }));
};

test('a failed save is announced in the summary, so a closed panel does not hide it (Codex)', async () => {
  serve(json(200, { addresses: [], foundationDomain: 'wmkeck.org', maxAddresses: 200, unavailable: false }), json(400, { error: 'Not a valid address.' }));
  render(<TestRequestsWorkspace />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save allowlist' })).toBeTruthy());
  typeAndSave('not-an-address');
  const warning = await screen.findByText("The last change to the allowlist wasn't saved. Open this panel to see why.");
  expect(warning.closest('summary')).toBeTruthy();
});

test('a successful save after a failed load clears the summary warning (Codex)', async () => {
  serve(json(500, { error: 'boom' }), json(200, { addresses: ['b@example.org'] }));
  render(<TestRequestsWorkspace />);
  await screen.findByText("The allowlist couldn't be loaded. Open this panel to see why.");
  typeAndSave('b@example.org');
  await screen.findByText('Saved 1 address.');
  expect(screen.queryByText(/Open this panel/)).toBeNull();
});
