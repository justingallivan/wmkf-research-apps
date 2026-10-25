/** @jest-environment jsdom */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ReviewerDueDateEditor, { minimumExtensionDate } from '../../shared/components/reviewers/ReviewerDueDateEditor';
const ID = '11111111-1111-4111-8111-111111111111';
const props = { suggestionId: ID, reviewerName: 'Ada Lovelace', defaultDate: '2099-09-01', canManage: true, assignedPdContext: 'pd:pd' };
const initial = { ok: true, preview: { template: { subject: 'Deadline: {{proposalTitle}}', body: '{{greeting}}\n{{signature}}' }, subject: 'Deadline: Telescope', bodyText: 'Ada\nPat', from: 'pd@example.org', to: 'ada@example.org', cc: [], proof: 'proof', effectiveReviewDeadline: '2099-09-15' } };
const reply = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });
beforeEach(() => { global.fetch = jest.fn(async () => reply(initial)); });
async function open() { fireEvent.click(screen.getByRole('button', { name: /grant extension|change extension/i })); await screen.findByLabelText('Subject'); }
async function review() { fireEvent.click(screen.getByRole('button', { name: 'Preview email' })); await screen.findByRole('button', { name: /save deadline and send|restore deadline and send|send deadline email/i }); }
function payload() { return JSON.parse(global.fetch.mock.calls.at(-1)[1].body); }
test('read-only default, including a superuser without explicit assigned PD capability, has no action', () => { render(<ReviewerDueDateEditor {...props} canManage={false} />); expect(screen.queryByRole('button')).toBeNull(); });
test('minimum extension date is later of today or day after original', () => { expect(minimumExtensionDate('2099-09-01', '2099-08-01')).toBe('2099-09-02'); expect(minimumExtensionDate('2020-01-01', '2099-08-01')).toBe('2099-08-01'); });
test('opens with visible read-only addresses and no writes; final action needs preview', async () => {
  render(<ReviewerDueDateEditor {...props} />); await open();
  expect(screen.getByText('pd@example.org')).toBeInTheDocument(); expect(screen.getByText('ada@example.org')).toBeInTheDocument();
  expect(payload()).toMatchObject({ action: 'preview', operation: 'resend', cc: [] });
  expect(screen.queryByRole('button', { name: 'Save deadline and send' })).toBeNull();
  fireEvent.change(screen.getByLabelText('New deadline'), { target: { value: '2099-09-15' } });
  await review(); expect(payload()).toMatchObject({ action: 'preview', operation: 'save', reviewDueDateOverride: '2099-09-15' });
  global.fetch.mockResolvedValueOnce(reply({ ok: true, saved: true, notified: true })); fireEvent.click(screen.getByRole('button', { name: 'Save deadline and send' }));
  await screen.findByText('Sent for delivery.'); expect(payload()).toMatchObject({ action: 'save', proof: 'proof', reviewDueDateOverride: '2099-09-15' }); expect(payload()).not.toHaveProperty('operation');
});
test('empty message and one-send Cc are submitted, edits invalidate prior preview', async () => {
  render(<ReviewerDueDateEditor {...props} />); await open();
  fireEvent.change(screen.getByLabelText('Message (optional)'), { target: { value: '' } });
  fireEvent.change(screen.getByLabelText('Cc (this send only)'), { target: { value: 'friend@example.org' } });
  global.fetch.mockResolvedValueOnce(reply({ ...initial, preview: { ...initial.preview, template: { subject: 'Deadline', body: '' }, bodyText: '', cc: ['friend@example.org'] } }));
  await review(); expect(payload()).toMatchObject({ template: { body: '' }, cc: ['friend@example.org'] });
  fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Changed' } }); expect(screen.queryByRole('button', { name: 'Save deadline and send' })).toBeNull();
});
test('restore and resend require review and never post a client date', async () => {
  render(<ReviewerDueDateEditor {...props} overrideDate="2099-09-15" />); await open();
  fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'restore' } }); await review(); expect(payload()).toMatchObject({ operation: 'restore' }); expect(payload()).not.toHaveProperty('reviewDueDateOverride');
  fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'resend' } }); await review(); expect(payload()).toMatchObject({ operation: 'resend' });
});
test('saved but unsent retains wording and Cc, posts renewed retry proof and no date', async () => {
  render(<ReviewerDueDateEditor {...props} />); await open();
  fireEvent.change(screen.getByLabelText('Message (optional)'), { target: { value: 'My words' } });
  fireEvent.change(screen.getByLabelText('Cc (this send only)'), { target: { value: 'friend@example.org' } });
  global.fetch.mockResolvedValueOnce(reply({ ...initial, preview: { ...initial.preview, cc: ['friend@example.org'] } })); await review();
  global.fetch.mockResolvedValueOnce(reply({ ok: false, saved: true, notified: false, reason: 'send_failed', retryable: true, retryProof: 'renewed' }, 502));
  fireEvent.click(screen.getByRole('button', { name: 'Save deadline and send' })); await screen.findByRole('button', { name: 'Retry email' });
  expect(screen.getByLabelText('Message (optional)')).toHaveValue('My words'); expect(screen.getByLabelText('Cc (this send only)')).toHaveValue('friend@example.org');
  global.fetch.mockResolvedValueOnce(reply({ ok: true, saved: false, notified: true })); fireEvent.click(screen.getByRole('button', { name: 'Retry email' }));
  await screen.findByText('Sent for delivery.'); expect(payload()).toMatchObject({ action: 'retry', proof: 'renewed' }); expect(payload()).not.toHaveProperty('reviewDueDateOverride');
});
test('uncertain delivery blocks retry and instructs checking history', async () => {
  render(<ReviewerDueDateEditor {...props} />); await open(); await review();
  global.fetch.mockResolvedValueOnce(reply({ ok: false, saved: true, notified: false, reason: 'send_unconfirmed' }, 202)); fireEvent.click(screen.getByRole('button', { name: 'Save deadline and send' }));
  await screen.findByText(/Dynamics did not confirm/); expect(screen.queryByRole('button', { name: 'Retry email' })).toBeNull(); expect(screen.queryByRole('button', { name: 'Preview email' })).toBeNull();
});
test('close/reopen clears Cc and wording; loads current defaults', async () => {
  render(<ReviewerDueDateEditor {...props} />); await open(); fireEvent.change(screen.getByLabelText('Cc (this send only)'), { target: { value: 'friend@example.org' } });
  fireEvent.click(screen.getByRole('button', { name: 'Close' })); await open(); expect(screen.getByLabelText('Cc (this send only)')).toHaveValue('');
});
test.each([{ suggestionId: 'other' }, { defaultDate: '2099-09-02' }, { assignedPdContext: 'pd:new' }, { canManage: false }])('late load cannot populate changed context %p', async (patch) => {
  let finish; global.fetch = jest.fn(() => new Promise((resolve) => { finish = () => resolve(reply(initial)); })); const view = render(<ReviewerDueDateEditor {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'Grant extension' })); view.rerender(<ReviewerDueDateEditor {...props} {...patch} />); await act(async () => finish()); expect(screen.queryByRole('dialog')).toBeNull();
});
test('fallback notice shows without overwriting stored default', async () => {
  global.fetch.mockResolvedValueOnce(reply({ ...initial, preview: { ...initial.preview, templateNotice: 'preference_unavailable' } }));
  render(<ReviewerDueDateEditor {...props} />); await open(); expect(screen.getByText(/Your saved wording couldn’t be loaded/)).toBeInTheDocument(); expect(global.fetch).toHaveBeenCalledTimes(1);
});
test('in-flight send locks edits and defaults controls', async () => {
  render(<ReviewerDueDateEditor {...props} />); await open(); await review();
  let finish; global.fetch.mockImplementationOnce(() => new Promise((resolve) => { finish = () => resolve(reply({ ok: true, saved: true, notified: true })); }));
  fireEvent.click(screen.getByRole('button', { name: 'Save deadline and send' })); expect(screen.getByLabelText('Subject')).toBeDisabled(); expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled(); await act(async () => finish());
});

test.each([reply({}, 502), reply({ ok: false, reason: 'server_error' }, 500)])('unstructured failure is uncertain and cannot invite duplicate send', async (response) => {
  render(<ReviewerDueDateEditor {...props} />); await open(); await review(); global.fetch.mockResolvedValueOnce(response);
  fireEvent.click(screen.getByRole('button', { name: 'Save deadline and send' })); await screen.findByText(/result could not be confirmed/);
  expect(screen.queryByRole('button', { name: 'Preview email' })).toBeNull();
});
test.each(['read_failed', 'notification_unavailable', 'misconfigured'])('saved deadline is never described as unchanged after %s', async (reason) => {
  render(<ReviewerDueDateEditor {...props} />); await open(); await review();
  global.fetch.mockResolvedValueOnce(reply({ ok: false, saved: true, notified: false, reason, requiresPreview: true }, 502));
  fireEvent.click(screen.getByRole('button', { name: 'Save deadline and send' })); await screen.findAllByText(/The deadline is saved\. /);
  expect(screen.queryByText(/No deadline was changed/)).toBeNull();
});
test('preference save/clear cannot replace one-send draft, including edits while save is pending', async () => {
  render(<ReviewerDueDateEditor {...props} />); await open();
  fireEvent.change(screen.getByLabelText('Message (optional)'), { target: { value: 'One send only' } });
  global.fetch.mockResolvedValueOnce(reply({ ok: true, configured: true, template: { subject: 'Personal', body: '' }, shared: { subject: 'Admin', body: 'Admin' } }));
  const details = screen.getByText('Your default wording').closest('details'); details.open = true; fireEvent(details, new Event('toggle'));
  await screen.findByRole('button', { name: 'Save as my default' });
  let finish; global.fetch.mockImplementationOnce(() => new Promise((resolve) => { finish = () => resolve(reply({ ok: true })); }));
  fireEvent.click(screen.getByRole('button', { name: 'Save as my default' })); expect(screen.getByLabelText('Message (optional)')).toBeDisabled();
  await act(async () => finish()); expect(screen.getByLabelText('Message (optional)')).toHaveValue('One send only');
  global.fetch.mockResolvedValueOnce(reply({ ok: true })); fireEvent.click(screen.getByRole('button', { name: 'Clear my default' }));
  await screen.findByText(/Your default wording was cleared/); expect(screen.getByLabelText('Message (optional)')).toHaveValue('One send only');
});

test('default repair remains reachable when shared configuration blocks the initial email', async () => {
  global.fetch.mockResolvedValueOnce(reply({ ok: false, reason: 'misconfigured' }, 502));
  render(<ReviewerDueDateEditor {...props} />); fireEvent.click(screen.getByRole('button', { name: 'Grant extension' })); await screen.findByText(/could not prepare the deadline email/);
  global.fetch.mockResolvedValueOnce(reply({ ok: false, reason: 'preference_invalid', ownSystemId: 'own', configured: true, shared: null, sharedUnavailable: true }, 409));
  const details = screen.getByText('Your default wording').closest('details'); details.open = true; fireEvent(details, new Event('toggle'));
  await screen.findByRole('button', { name: 'Clear my default' }); expect(screen.getByLabelText('Default subject')).toHaveValue('');
  expect(screen.getByText(/administrator must repair shared wording/)).toBeInTheDocument();
});
