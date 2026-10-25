/** @jest-environment jsdom */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import EmailDialog from '../../shared/components/EmailDialog';
import EmailWordingDefault from '../../shared/components/EmailWordingDefault';
import { loadEmailTemplateState, saveEmailTemplateFamily } from '../../shared/components/reviewers/email-template-store';
import { requestEnvelope } from '../../shared/utils/api-request';
jest.mock('../../shared/utils/api-request', () => ({ requestEnvelope: jest.fn() }));
const shared = { invitation: { subject: 'Shared new subject', body: '{{externalLink}}' }, materials: { subject: 'Shared materials', body: 'Shared message' } };
const ok = (data) => ({ ok: true, status: 200, data });
beforeEach(() => jest.clearAllMocks());

test('native modal owns opening/focus return and prevents cancellation during a write', () => {
  const opener = document.createElement('button'); document.body.append(opener); opener.focus();
  const close = jest.fn(); const view = render(<EmailDialog label="Compose" busy onClose={close}><button>Close</button><input aria-label="Message" /></EmailDialog>);
  const dialog = screen.getByRole('dialog', { name: 'Compose' });
  expect(dialog).toHaveAttribute('open'); expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
  const event = new Event('cancel', { bubbles: true, cancelable: true }); fireEvent(dialog, event);
  expect(event.defaultPrevented).toBe(true); expect(close).not.toHaveBeenCalled();
  view.rerender(<EmailDialog label="Compose" onClose={close}><button>Close</button></EmailDialog>);
  fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true })); expect(close).toHaveBeenCalledTimes(1);
  view.unmount(); expect(opener).toHaveFocus(); opener.remove();
});

test('family write preserves sibling overrides and does not freeze untouched inherited copy after Admin changes', async () => {
  const raw = { materials: { body: 'My materials' }, thankyou: { subject: 'Retained legacy subject' } };
  requestEnvelope.mockImplementation(async (url, options) => {
    if (options?.method === 'POST') return ok({ success: true });
    return url.startsWith('/api/user-preferences') ? ok({ value: JSON.stringify(raw) }) : ok({ templates: shared });
  });
  await saveEmailTemplateFamily('invitation', { subject: 'Old inherited subject', body: 'My new body {{externalLink}}' }, ['body']);
  const write = requestEnvelope.mock.calls.find(([, options]) => options?.method === 'POST')[1];
  expect(JSON.parse(write.body.value)).toEqual({ ...raw, invitation: { body: 'My new body {{externalLink}}' } });
});

test.each(['shared', 'own', 'invalid', 'duplicate'])('%s failure never turns into a blank prewrite map', async (failure) => {
  requestEnvelope.mockImplementation(async (url) => url.startsWith('/api/user-preferences')
    ? failure === 'own' || failure === 'duplicate' ? { ok: false, status: failure === 'duplicate' ? 409 : 503 } : ok({ value: failure === 'invalid' ? '{broken' : null })
    : ok({ templates: shared, unavailable: failure === 'shared' }));
  const result = await saveEmailTemplateFamily('materials', shared.materials, [], true);
  expect(result.ok).toBe(false); expect(requestEnvelope.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
});

test('absent own preference is distinct from failure and Clear removes only selected family', async () => {
  requestEnvelope.mockImplementation(async (url, options) => options?.method === 'POST' ? ok({}) : url.startsWith('/api/user-preferences') ? ok({ value: JSON.stringify({ materials: { body: 'Mine' }, followup: { subject: 'Keep' } }) }) : ok({ templates: shared }));
  expect((await loadEmailTemplateState()).ownStatus).toBe('configured');
  expect((await saveEmailTemplateFamily('materials', null, [], true)).ok).toBe(true);
  const write = requestEnvelope.mock.calls.find(([, options]) => options?.method === 'POST')[1];
  expect(JSON.parse(write.body.value)).toEqual({ followup: { subject: 'Keep' } });
});

test('future-only Save/Clear preserve a current edited email and confirmed preview', async () => {
  const write = jest.fn(async () => ({ ok: true }));
  render(<><input aria-label="Current subject" defaultValue="One-send edit" /><input type="checkbox" aria-label="Reviewed exact preview" defaultChecked /><EmailWordingDefault initialOpen scopeKey="A" load={async () => ({ canWrite: true, configured: true, template: { subject: 'My default', body: 'Default body' }, shared: { subject: 'Shared', body: 'Shared body' } })} write={write} /></>);
  fireEvent.change(await screen.findByLabelText('Default subject'), { target: { value: 'Next default' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save as my default' }));
  await screen.findByText('Saved for future emails. The current email is unchanged.');
  expect(write).toHaveBeenCalledWith({ template: { subject: 'Next default', body: 'Default body' }, changedFields: ['subject'], clear: false });
  fireEvent.click(screen.getByRole('button', { name: 'Clear my default' })); await screen.findByText('Your default was cleared. The current email is unchanged.');
  expect(screen.getByLabelText('Current subject')).toHaveValue('One-send edit'); expect(screen.getByLabelText('Reviewed exact preview')).toBeChecked();
});

test('scope change ignores the departed default load and preserves the new actor fields', async () => {
  let finish; const old = new Promise((resolve) => { finish = resolve; });
  const view = render(<EmailWordingDefault initialOpen scopeKey="old" load={() => old} write={jest.fn()} />);
  view.rerender(<EmailWordingDefault initialOpen scopeKey="new" load={async () => ({ canWrite: true, template: { subject: 'New actor', body: '' } })} write={jest.fn()} />);
  await screen.findByDisplayValue('New actor'); await act(async () => finish({ canWrite: true, template: { subject: 'Old secret', body: '' } }));
  await waitFor(() => expect(screen.queryByDisplayValue('Old secret')).not.toBeInTheDocument());
});
