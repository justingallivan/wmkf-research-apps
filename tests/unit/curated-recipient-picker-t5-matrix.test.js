/**
 * @jest-environment jsdom
 *
 * CuratedRecipientPicker — T5 matrix (Stage 5a). No RTL test exists today.
 * The single fetch site (recipient-options GET) is a bare `.json().catch(()
 * => ({}))` throw-on-!ok-with-fallback site, migrated to requestJson with
 * `tolerantBody: true`.
 */
import { render, screen } from '@testing-library/react';
import CuratedRecipientPicker from '../../shared/components/workbench/CuratedRecipientPicker';

function renderPicker(overrides = {}) {
  return render(
    <CuratedRecipientPicker
      open
      target="to"
      toValue=""
      ccValue=""
      onAdd={jest.fn()}
      onClose={jest.fn()}
      {...overrides}
    />,
  );
}

const unparseable = () => Promise.reject(new SyntaxError('Unexpected token <'));

afterEach(() => jest.restoreAllMocks());

test('2xx success renders the recipient list', async () => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true, status: 200,
    json: async () => ({ recipients: [{ email: 'a@example.org', name: 'A Person', category: 'staff' }] }),
  });
  renderPicker();
  expect(await screen.findByText('A Person')).toBeInTheDocument();
});

test('non-2xx {error} surfaces the server message verbatim', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: 'Forbidden' }) });
  renderPicker();
  expect(await screen.findByText('Forbidden')).toBeInTheDocument();
});

test('network rejection is never silent', async () => {
  global.fetch = jest.fn().mockRejectedValue(new Error('offline'));
  renderPicker();
  expect(await screen.findByText('offline')).toBeInTheDocument();
});

test('malformed 2xx body (tolerant) yields an empty recipient list, matching today\'s .catch(() => ({}))', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: unparseable });
  renderPicker();
  expect(await screen.findByText('No recipients have been configured.')).toBeInTheDocument();
});

test('axis (e): non-2xx unparseable body falls to the fallback text, never silent', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 502, json: unparseable });
  renderPicker();
  expect(await screen.findByText('The recipient directory could not be loaded.')).toBeInTheDocument();
});
