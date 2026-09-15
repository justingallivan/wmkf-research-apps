/** @jest-environment jsdom */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

jest.mock('../../shared/components/FileUploaderSimple', () => function FileUploaderSimple() {
  return null;
});

import { RosterForm } from '../../pages/expertise-finder';

const CONTACT_ID = '11111111-1111-4111-8111-111111111111';

test('selecting a contact restores the initially stored manual email and makes it read-only', async () => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      contacts: [{
        contactId: CONTACT_ID,
        name: 'Ada Lovelace',
        email: 'live@example.org',
        active: true,
        available: true,
        reason: null,
      }],
      truncated: false,
      limit: 50,
    }),
  });
  const onSubmit = jest.fn();
  render(
    <RosterForm
      initialData={{
        id: 7,
        name: 'Ada Lovelace',
        preferred_email: 'stored@example.org',
        dataverse_contact_id: null,
        role_type: 'Board',
      }}
      onSubmit={onSubmit}
      onCancel={jest.fn()}
      saving={false}
      roleTypes={['Board', 'Consultant']}
      isEdit
    />,
  );

  const email = screen.getByPlaceholderText('Preferred Site Visit correspondence address');
  await userEvent.clear(email);
  await userEvent.type(email, 'unsaved@example.org');
  await userEvent.click(screen.getByRole('button', { name: 'Search' }));
  await userEvent.click(await screen.findByRole('button', { name: /Ada Lovelace.*live@example.org/i }));

  expect(email).toBeDisabled();
  expect(email).toHaveValue('stored@example.org');
  expect(screen.getByText(/email comes from the Dataverse contact/i)).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
  expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
    id: 7,
    preferred_email: 'stored@example.org',
    dataverse_contact_id: CONTACT_ID,
  }));
});
