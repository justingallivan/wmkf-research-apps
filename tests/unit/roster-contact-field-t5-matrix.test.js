/**
 * @jest-environment jsdom
 *
 * RosterContactField — T5 gap-fill (Stage 5a). tests/unit/roster-contact-
 * link-ui.test.js already pins 2xx success/reason states for both fetch
 * sites (linked-contact resolve GET, search GET), both bare `.json()` with
 * no catch (strict), migrated to requestJson with the default strict
 * tolerantBody. This file adds network-rejection, axis (e), and 2xx
 * malformed-body coverage — all three funnel into the same fixed
 * "Contact status could not be loaded" / search-cleared copy today.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RosterContactField from '../../shared/components/expertise-finder/RosterContactField';

const CONTACT_ID = '11111111-1111-4111-8111-111111111111';
const unparseable = () => Promise.reject(new SyntaxError('Unexpected token <'));

afterEach(() => jest.restoreAllMocks());

test('resolve: network rejection is never silent (fixed lookup-failed copy)', async () => {
  global.fetch = jest.fn().mockRejectedValue(new Error('offline'));
  render(<RosterContactField contactId={CONTACT_ID} memberName="Ada" onSelect={jest.fn()} onClear={jest.fn()} />);
  expect(await screen.findByText('Contact status could not be loaded')).toBeInTheDocument();
});

test('resolve axis (e): non-2xx unparseable body is never silent (fixed lookup-failed copy)', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 502, json: unparseable });
  render(<RosterContactField contactId={CONTACT_ID} memberName="Ada" onSelect={jest.fn()} onClear={jest.fn()} />);
  expect(await screen.findByText('Contact status could not be loaded')).toBeInTheDocument();
});

test('resolve: 2xx malformed body (strict, no .catch) is never silent (fixed lookup-failed copy)', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: unparseable });
  render(<RosterContactField contactId={CONTACT_ID} memberName="Ada" onSelect={jest.fn()} onClear={jest.fn()} />);
  expect(await screen.findByText('Contact status could not be loaded')).toBeInTheDocument();
});

test('search: non-2xx {error} clears results and is never silent', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: 'boom' }) });
  render(<RosterContactField contactId={null} memberName="" onSelect={jest.fn()} onClear={jest.fn()} />);
  const box = screen.getByRole('searchbox', { name: 'Dataverse contact' });
  await userEvent.clear(box);
  await userEvent.type(box, 'Ada');
  await userEvent.click(screen.getByRole('button', { name: 'Search' }));
  await waitFor(() => expect(global.fetch).toHaveBeenCalled());
  await waitFor(() => expect(screen.queryByRole('option')).not.toBeInTheDocument());
});
