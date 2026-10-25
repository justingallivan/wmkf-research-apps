/** @jest-environment jsdom */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import AgendaWordingDefault from '../../shared/components/meeting-tracker/AgendaWordingDefault';
const defaults = { subject: 'Saved', message: '', source: 'personal', personalStatus: 'configured', sharedStatus: 'available' };
const data = { configured: true, template: { subject: 'Saved', body: '' }, defaults };
const response = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
async function open(props = {}) {
  const view = render(<AgendaWordingDefault {...props} />);
  const details = screen.getByText('Your default wording').closest('details'); details.open = true; fireEvent(details, new Event('toggle'));
  await screen.findByLabelText('Default subject'); return view;
}
beforeEach(() => { global.fetch = jest.fn(async () => response(data)); });
test.each([
  [400, 'validation', /Check the subject/],
  [409, 'preference_invalid', /Clear my default to remove duplicate/],
  [503, 'persistence_unconfirmed', /could not be confirmed/],
])('failed Save %s reports actionable feedback and releases busy', async (status, reason, message) => {
  const busy = jest.fn(); const changed = jest.fn();
  await open({ onBusyChange: busy, onChanged: changed });
  global.fetch.mockResolvedValueOnce(response({ ok: false, reason }, status));
  fireEvent.click(screen.getByRole('button', { name: 'Save as my default' }));
  expect(await screen.findByText(message)).toBeInTheDocument(); expect(changed).not.toHaveBeenCalled(); expect(busy).toHaveBeenLastCalledWith(false);
});
test('invalid fields explain disabled Save and partial Clear does not claim success', async () => {
  await open();
  fireEvent.change(screen.getByLabelText('Default subject'), { target: { value: '{{unknown}}' } });
  expect(screen.getByRole('button', { name: 'Save as my default' })).toBeDisabled();
  expect(screen.getByLabelText('Default subject')).toHaveAttribute('aria-describedby', 'agenda-default-validation');
  global.fetch.mockResolvedValueOnce(response({ ok: false, reason: 'persistence_unconfirmed', removed: ['one'] }, 503));
  fireEvent.click(screen.getByRole('button', { name: 'Clear my default' }));
  expect(await screen.findByText(/could not be confirmed/)).toBeInTheDocument(); expect(screen.queryByText(/was cleared/)).not.toBeInTheDocument();
});
test('unmount during Save releases parent lock and ignores late success', async () => {
  const busy = jest.fn(); const changed = jest.fn(); const view = await open({ onBusyChange: busy, onChanged: changed }); let finish;
  global.fetch.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  fireEvent.click(screen.getByRole('button', { name: 'Save as my default' })); await waitFor(() => expect(finish).toBeDefined());
  view.unmount(); expect(busy).toHaveBeenLastCalledWith(false);
  await act(async () => { finish(response(data)); }); expect(changed).not.toHaveBeenCalled();
});
