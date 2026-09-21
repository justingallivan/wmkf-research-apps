/** @jest-environment jsdom */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import MaterialsEmailModal from '../../shared/components/meeting-tracker/MaterialsEmailModal';
import { requestEnvelope } from '../../shared/utils/api-request';
import { EMAIL_SEND_OUTCOME_COPY } from '../../shared/utils/email-send-outcome';

jest.mock('../../shared/utils/api-request', () => ({ requestEnvelope: jest.fn() }));
let mockProfile = 7;
jest.mock('next-auth/react', () => ({ useSession: () => ({ data: { user: { profileId: mockProfile } }, status: 'authenticated' }) }));
jest.mock('../../shared/context/ProfileContext', () => ({ useProfile: () => ({ profileId: mockProfile, currentProfile: { id: mockProfile }, session: { user: { profileId: mockProfile } } }) }));
const template = { subject: 'Personal subject', body: 'Hello {{checklist}}' };
const draft = { success: true, subject: 'Personal subject', bodyText: 'Hello presentation', proof: 'signed-proof', recipients: [{ email: 'pat@example.edu' }], fromEmail: 'duncan@example.org', secureLinkPlaceholder: true };
const ok = (data) => ({ ok: true, status: 200, data });
function deferred() { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; }
let onClose;
let onSent;
beforeEach(() => {
  jest.clearAllMocks(); mockProfile = 7; onClose = jest.fn(); onSent = jest.fn();
  requestEnvelope.mockImplementation(async (_url, options = {}) => {
    if (options.body?.action === 'preview') return ok(draft);
    if (options.method === 'PUT' || options.method === 'DELETE') return ok({ ok: true, template, shared: template });
    if (options.method === 'POST') return ok({ success: true, collection: { id: 'c' }, invitationSent: true });
    return ok({ template, shared: template });
  });
});
async function open(props = {}) {
  const view = render(<MaterialsEmailModal requestId="request-a" action="create" onClose={onClose} onSent={onSent} {...props} />);
  await waitFor(() => expect(screen.getByLabelText('Subject')).toHaveValue('Personal subject'));
  return view;
}
async function reviewed() {
  fireEvent.click(screen.getByRole('button', { name: 'Refresh preview' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Send', exact: true })).toBeEnabled());
}

test('editing an already reviewed message requires another preview and does not save defaults', async () => {
  await open(); await reviewed();
  fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'One-off wording' } });
  expect(screen.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
  expect(requestEnvelope.mock.calls.some(([, options]) => options?.method === 'PUT')).toBe(false);
});

test('editing while preview is pending prevents the old response from enabling Send', async () => {
  await open();
  const pending = deferred(); requestEnvelope.mockImplementationOnce(() => pending.promise);
  fireEvent.click(screen.getByRole('button', { name: 'Refresh preview' }));
  fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'New wording' } });
  await act(async () => pending.resolve(ok(draft)));
  expect(screen.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Refresh preview' })).toBeEnabled();
});

test.each(['request', 'profile'])('a pending preview cannot populate a different %s context', async (change) => {
  const view = await open(); const pending = deferred(); requestEnvelope.mockImplementationOnce(() => pending.promise);
  fireEvent.click(screen.getByRole('button', { name: 'Refresh preview' }));
  if (change === 'profile') mockProfile = 8;
  view.rerender(<MaterialsEmailModal requestId={change === 'request' ? 'request-b' : 'request-a'} action="create" onClose={onClose} onSent={onSent} />);
  await act(async () => pending.resolve(ok(draft)));
  expect(screen.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
});

test.each(['malformed', 'network', 'uncertain'])('%s send displays real uncertainty feedback and refreshes without false success', async (mode) => {
  await open(); await reviewed();
  if (mode === 'network') requestEnvelope.mockRejectedValueOnce(new Error('Network lost'));
  else requestEnvelope.mockResolvedValueOnce(mode === 'malformed' ? ok({}) : { ok: true, status: 202, data: { outcome: 'uncertain' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send', exact: true }));
  expect(await screen.findByText(EMAIL_SEND_OUTCOME_COPY.uncertain.title)).toBeInTheDocument();
  expect(onClose).not.toHaveBeenCalled();
  expect(onSent).toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
});

test('failed invitation after collection creation stays visible and refreshes parent', async () => {
  await open(); await reviewed();
  requestEnvelope.mockResolvedValueOnce(ok({ success: true, collection: { id: 'created' }, invitationSent: false, invitationOutcome: 'failed' }));
  fireEvent.click(screen.getByRole('button', { name: 'Send', exact: true }));
  expect(await screen.findByText(EMAIL_SEND_OUTCOME_COPY.failed.title)).toBeInTheDocument();
  expect(onSent).toHaveBeenCalled(); expect(onClose).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
});

test('double click produces one send; completion after unmount invokes no callbacks', async () => {
  const view = await open(); await reviewed(); const pending = deferred(); requestEnvelope.mockImplementationOnce(() => pending.promise);
  const send = screen.getByRole('button', { name: 'Send', exact: true });
  fireEvent.click(send); fireEvent.click(send);
  expect(requestEnvelope.mock.calls.filter(([, options]) => options?.body?.action === 'create')).toHaveLength(1);
  view.unmount(); await act(async () => pending.resolve(ok({ success: true, collection: { id: 'created' }, invitationSent: true })));
  expect(onSent).not.toHaveBeenCalled(); expect(onClose).not.toHaveBeenCalled();
});

test('failed reset does not erase current edits and reports the failure', async () => {
  await open(); fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Keep this edit' } });
  requestEnvelope.mockResolvedValueOnce({ ok: false, status: 500, data: { error: 'Reset failed' } });
  fireEvent.click(screen.getByRole('button', { name: 'Use shared default' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/reset|default/i);
  expect(screen.getByLabelText('Subject')).toHaveValue('Keep this edit');
});

test('HTTP failure loading defaults is visible', async () => {
  requestEnvelope.mockResolvedValueOnce({ ok: false, status: 503, data: { error: 'Defaults unavailable' } });
  render(<MaterialsEmailModal requestId="request-a" action="create" onClose={onClose} onSent={onSent} />);
  expect(await screen.findByRole('alert')).toHaveTextContent(/default|unavailable/i);
  expect(screen.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
});
