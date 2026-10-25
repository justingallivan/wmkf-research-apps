/** @jest-environment jsdom */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import DeadlineWordingDefault from '../../shared/components/reviewers/DeadlineWordingDefault';
const template = { subject: 'My deadline', body: '' };
const reply = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });
beforeEach(() => { global.fetch = jest.fn(async () => reply({ ok: true, configured: true, template, shared: { subject: 'Admin', body: 'Shared body' } })); });
async function open() { const details = screen.getByText('Your default wording').closest('details'); details.open = true; fireEvent(details, new Event('toggle')); await screen.findByRole('button', { name: 'Save as my default' }); }
test('empty default is saveable and explicit Save stores only subject/body', async () => {
  render(<DeadlineWordingDefault />); await open(); expect(screen.getByRole('button', { name: 'Save as my default' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Save as my default' })); await screen.findByText('Saved as your default wording.');
  expect(JSON.parse(global.fetch.mock.calls.at(-1)[1].body)).toEqual({ template }); expect(global.fetch.mock.calls.at(-1)[0]).toBe('/api/review-manager/deadline-email-preferences');
});
test('Clear has no template or Cc, and displays shared copy', async () => {
  render(<DeadlineWordingDefault />); await open(); fireEvent.click(screen.getByRole('button', { name: 'Clear my default' }));
  await screen.findByText(/Your default wording was cleared/); expect(screen.getByLabelText('Message')).toHaveValue('Shared body');
  expect(global.fetch.mock.calls.at(-1)[1].method).toBe('DELETE'); expect(JSON.parse(global.fetch.mock.calls.at(-1)[1].body)).toEqual({});
});
test('disabled while send in flight; unmount during preference save releases lock and ignores late result', async () => {
  const busy = jest.fn(); const view = render(<DeadlineWordingDefault onBusyChange={busy} />); await open();
  let finish; global.fetch.mockImplementationOnce(() => new Promise((resolve) => { finish = () => resolve(reply({ ok: true })); }));
  fireEvent.click(screen.getByRole('button', { name: 'Save as my default' })); expect(busy).toHaveBeenLastCalledWith(true); expect(screen.getByLabelText('Message')).toBeDisabled();
  view.unmount(); expect(busy).toHaveBeenLastCalledWith(false); await act(async () => finish());
});
test('damaged own row gets explicit repair editor with shared wording', async () => {
  global.fetch.mockResolvedValueOnce(reply({ ok: false, reason: 'preference_invalid', ownSystemId: 'own', shared: { subject: 'Admin', body: '' } }, 409));
  render(<DeadlineWordingDefault />); await open(); expect(screen.getByText(/saved wording needs correction/)).toBeInTheDocument(); expect(screen.getByLabelText('Message')).toHaveValue('');
});
