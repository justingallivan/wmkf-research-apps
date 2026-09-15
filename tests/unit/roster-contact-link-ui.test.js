/** @jest-environment jsdom */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RosterContactField from '../../shared/components/expertise-finder/RosterContactField';
import { buildRosterSubmitPayload } from '../../shared/utils/roster-contact-link';

const CONTACT_ID = '11111111-1111-4111-8111-111111111111';

function response(contacts, extra = {}) {
  return {
    ok: true,
    json: async () => ({ contacts, truncated: false, limit: 50, ...extra }),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

test('an untouched edit omits the contact field so a stale form cannot unlink a newer link', () => {
  const form = { id: 7, name: 'Ada', dataverse_contact_id: null };
  expect(buildRosterSubmitPayload(form, { isEdit: true, contactLinkDirty: false }))
    .toEqual({ id: 7, name: 'Ada' });
  expect(buildRosterSubmitPayload(form, { isEdit: true, contactLinkDirty: true }))
    .toEqual(form);
  expect(buildRosterSubmitPayload(form, { isEdit: false, contactLinkDirty: false }))
    .toEqual(form);
});

test('an untouched Add-form search follows the member name', () => {
  const props = { contactId: null, onSelect: jest.fn(), onClear: jest.fn() };
  const { rerender } = render(<RosterContactField {...props} memberName="" />);
  rerender(<RosterContactField {...props} memberName="Ada Lovelace" />);
  expect(screen.getByRole('searchbox', { name: 'Dataverse contact' })).toHaveValue('Ada Lovelace');
  expect(screen.getByText(/Not linked.*manual preferred email/i)).toBeInTheDocument();
});

test('a linked row explains live resolution and can be explicitly unlinked', async () => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ contact: { contactId: CONTACT_ID, name: 'Ada Lovelace', email: 'ada@example.org', active: true, available: true, reason: null } }),
  });
  const onClear = jest.fn();
  render(
    <RosterContactField
      contactId={CONTACT_ID}
      memberName="Ada Lovelace"
      onSelect={jest.fn()}
      onClear={onClear}
    />,
  );
  expect(await screen.findByText('ada@example.org')).toBeInTheDocument();
  expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Unlink' }));
  expect(onClear).toHaveBeenCalledTimes(1);
});

test('a broken pre-existing link shows the live Dataverse remedy', async () => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ contact: { contactId: CONTACT_ID, name: 'Ada Lovelace', email: null, active: false, available: false, reason: 'contact_inactive' } }),
  });
  render(<RosterContactField contactId={CONTACT_ID} memberName="Ada" onSelect={jest.fn()} onClear={jest.fn()} />);
  expect(await screen.findByText('Inactive contact')).toBeInTheDocument();
  expect(screen.getByText(/selection will fail until this Contact is fixed, relinked, or.*unlinked/i)).toBeInTheDocument();
});

test('unavailable contacts are visible but cannot be selected', async () => {
  global.fetch = jest.fn().mockResolvedValue(response([{
    contactId: CONTACT_ID,
    name: 'Ada Lovelace',
    email: null,
    active: true,
    available: false,
    reason: 'contact_email_missing',
  }]));
  const onSelect = jest.fn();
  render(<RosterContactField contactId={null} memberName="Ada" onSelect={onSelect} onClear={jest.fn()} />);
  await userEvent.click(screen.getByRole('button', { name: 'Search' }));
  const result = await screen.findByRole('button', { name: /Ada Lovelace.*No primary email/i });
  expect(result).toBeDisabled();
  expect(onSelect).not.toHaveBeenCalled();
});

test('typing a new query invalidates an older response even if fetch ignores abort', async () => {
  let resolveAda;
  let resolveGrace;
  global.fetch = jest.fn()
    .mockReturnValueOnce(new Promise((resolve) => { resolveAda = resolve; }))
    .mockReturnValueOnce(new Promise((resolve) => { resolveGrace = resolve; }));

  render(<RosterContactField contactId={null} memberName="Ada" onSelect={jest.fn()} onClear={jest.fn()} />);
  const input = screen.getByRole('searchbox', { name: 'Dataverse contact' });
  await userEvent.click(screen.getByRole('button', { name: 'Search' }));
  await userEvent.clear(input);
  await userEvent.type(input, 'Grace');
  await userEvent.click(screen.getByRole('button', { name: 'Search' }));

  resolveGrace(response([{
    contactId: '22222222-2222-4222-8222-222222222222',
    name: 'Grace Hopper',
    email: 'grace@example.org',
    active: true,
    available: true,
    reason: null,
  }]));
  expect(await screen.findByText('Grace Hopper')).toBeInTheDocument();

  resolveAda(response([{
    contactId: CONTACT_ID,
    name: 'Ada Lovelace',
    email: 'ada@example.org',
    active: true,
    available: true,
    reason: null,
  }]));
  await waitFor(() => expect(screen.queryByText('Ada Lovelace')).not.toBeInTheDocument());
});
