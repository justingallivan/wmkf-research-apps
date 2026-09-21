/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import MaterialsEmailModal from '../../shared/components/meeting-tracker/MaterialsEmailModal';

jest.mock('../../shared/context/ProfileContext', () => ({
  useProfile: () => ({ profileId: null, currentProfile: null, session: { user: {} } }),
}));

const ID = '11111111-1111-4111-8111-111111111111';
const shared = { subject: 'Subject', body: '{{checklist}}' };
const ok = (body) => ({ ok: true, status: 200, json: async () => body });

test('editing after preview disables send until refresh', async () => {
  global.fetch = jest.fn(async (url, options = {}) => {
    if (!options.method) return ok({ template: shared, shared });
    return ok({ subject: 'Rendered', bodyText: 'Body', proof: 'proof', recipients: [], secureLinkPlaceholder: true });
  });
  render(<MaterialsEmailModal requestId={ID} action="create" onClose={jest.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Refresh preview' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).not.toBeDisabled());
  fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Changed' } });
  expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
});

test('partial create result stays open and reports uncertainty', async () => {
  const onClose = jest.fn();
  global.fetch = jest.fn(async (url, options = {}) => {
    if (!options.method) return ok({ template: shared, shared });
    if (JSON.parse(options.body).action === 'preview') return ok({ subject: 'Rendered', bodyText: 'Body', proof: 'proof', recipients: [] });
    return ok({ invitationSent: false, invitationOutcome: 'uncertain' });
  });
  render(<MaterialsEmailModal requestId={ID} action="create" onClose={onClose} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Refresh preview' }));
  await screen.findByText('Rendered');
  fireEvent.click(await screen.findByRole('button', { name: 'Send' }));
  expect(await screen.findByRole('status')).toHaveTextContent('could not be confirmed');
  expect(onClose).not.toHaveBeenCalled();
});
