/** @jest-environment jsdom */
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import ScheduledEmailsPage from '../../pages/scheduled-emails';
import Defaults, { ScheduledReminderWordingEditor } from '../../shared/components/ScheduledGranteeReminderDefaults';
import useScheduledDefaultsUnsavedChanges from '../../shared/components/useScheduledDefaultsUnsavedChanges';
const EventEmitter = require('events');
const mockRouter = { isReady: true, query: {}, replace: jest.fn(async () => true), events: new EventEmitter(), beforePopState: jest.fn() };
let mockSession;
jest.mock('next/router', () => ({ useRouter: () => mockRouter }));
jest.mock('next-auth/react', () => ({ useSession: () => mockSession }));
jest.mock('../../shared/context/ProfileContext', () => ({ useProfile: () => ({ currentProfile: { id: 42 }, status: 'ready' }) }));
jest.mock('../../shared/components/Layout', () => ({ __esModule: true, default: ({ children }) => <div>{children}</div>, PageHeader: ({ title }) => <h1>{title}</h1>, Card: ({ children }) => <section>{children}</section>, Button: ({ children, ...props }) => <button {...props}>{children}</button> }));
const OWNER = 'abcdefab-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const pair = { subject: 'Shared subject', body: 'Dear {{granteeName}}, please review {{proposalTitle}} by {{dueDate}}.' };
const dto = (extra = {}) => ({ ok: true, ownerSystemId: OWNER, ownStatus: 'absent', own: null, shared: pair, source: 'shared', canSave: true, canClear: false, ...extra });
const response = data => ({ ok: true, status: 200, json: async () => data });
const deferred = () => { let resolve, reject; const promise = new Promise((r, j) => { resolve = r; reject = j; }); return { promise, resolve, reject }; };
async function open() {
  const details = screen.getByText('Your default wording — grantee reminders').closest('details');
  await act(async () => { details.open = true; fireEvent(details, new Event('toggle')); });
  await waitFor(() => expect(screen.getByLabelText('Default subject')).toBeEnabled());
}
beforeEach(() => {
  mockRouter.events.removeAllListeners(); mockRouter.beforePopState.mockClear();
  mockSession = { status: 'authenticated', data: { user: { profileId: 42, dynamicsSystemuserId: OWNER } } };
  global.fetch = jest.fn(async () => response(dto())); jest.spyOn(window, 'confirm').mockReturnValue(true);
  window.history.replaceState({}, '', '/scheduled-emails');
});
afterEach(() => jest.restoreAllMocks());
test('loads raw wording without mutations; save is explicit, normalized and future-only', async () => {
  render(<ScheduledReminderWordingEditor owner={OWNER} active />); await open();
  expect(global.fetch).toHaveBeenCalledTimes(1); expect(screen.getByText(/Existing messages, edits and approvals are unchanged/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Default subject'), { target: { value: 'My future subject' } });
  global.fetch.mockResolvedValueOnce(response(dto({ ownStatus: 'configured', own: { ...pair, subject: 'My future subject' }, source: 'personal', canClear: true })));
  fireEvent.click(screen.getByText('Save as my default'));
  await screen.findByText(/Saved for future reminders/);
  expect(JSON.parse(global.fetch.mock.calls[1][1].body)).toEqual({ template: { ...pair, subject: 'My future subject' } });
  expect(global.fetch.mock.calls.every(([url]) => url === '/api/scheduled-emails/email-preferences')).toBe(true);
});
test('field validation does not mutate, and shared prefill need not be save-valid', async () => {
  global.fetch.mockResolvedValue(response(dto({ shared: { subject: '{{literal}}', body: 'Legacy [Name]' } })));
  render(<ScheduledReminderWordingEditor owner={OWNER} active />); await open(); fireEvent.click(screen.getByText('Save as my default'));
  expect(await screen.findByText(/without placeholders/)).toBeInTheDocument(); expect(screen.getByText(/Include.*granteeName/)).toBeInTheDocument(); expect(global.fetch).toHaveBeenCalledTimes(1);
});
test('cancel Reload/Clear preserves edits; confirmed Clear only removes own future default', async () => {
  global.fetch.mockResolvedValue(response(dto({ ownStatus: 'configured', own: pair, canClear: true })));
  render(<ScheduledReminderWordingEditor owner={OWNER} active />); await open();
  fireEvent.change(screen.getByLabelText('Default subject'), { target: { value: 'Unsaved' } });
  window.confirm.mockReturnValue(false); fireEvent.click(screen.getByText('Reload defaults')); fireEvent.click(screen.getByText('Clear my default'));
  expect(screen.getByLabelText('Default subject')).toHaveValue('Unsaved'); expect(global.fetch).toHaveBeenCalledTimes(1);
  window.confirm.mockReturnValue(true); global.fetch.mockResolvedValueOnce(response(dto())); fireEvent.click(screen.getByText('Clear my default'));
  await screen.findByText(/Your default was cleared/); expect(global.fetch.mock.calls[1][1].method).toBe('DELETE'); expect(screen.getByLabelText('Default subject')).toHaveValue(pair.subject);
});
test('network uncertainty latches until strict Reload; unsuccessful reload does not unlock mutation', async () => {
  global.fetch.mockResolvedValueOnce(response(dto())); render(<ScheduledReminderWordingEditor owner={OWNER} active />); await open();
  global.fetch.mockRejectedValueOnce(new Error('lost')); fireEvent.click(screen.getByText('Save as my default')); await screen.findByText(/could not be confirmed/);
  expect(screen.getByText('Save as my default')).toBeDisabled();
  global.fetch.mockResolvedValueOnce(response(dto({ ownStatus: 'unavailable', canSave: false, canClear: false })));
  fireEvent.click(screen.getByText('Reload defaults')); await waitFor(() => expect(screen.getByText('Reload defaults')).toBeEnabled());
  expect(screen.getByText('Save as my default')).toBeDisabled();
  global.fetch.mockResolvedValueOnce(response(dto())); fireEvent.click(screen.getByText('Reload defaults'));
  await waitFor(() => expect(screen.getByText('Save as my default')).toBeEnabled());
});
test('confirmed mutation with lost refresh remains confirmed but needs Reload', async () => {
  render(<ScheduledReminderWordingEditor owner={OWNER} active />); await open();
  global.fetch.mockResolvedValueOnce(response({ ok: true, refreshUnavailable: true })); fireEvent.click(screen.getByText('Save as my default'));
  await screen.findByText(/change was confirmed/); expect(screen.getByText('Save as my default')).toBeDisabled();
});
test('transient profile loading preserves edits and never remounts or reloads for same actor', async () => {
  const view = render(<Defaults profileId={42} profileStatus="ready" />); await open();
  fireEvent.change(screen.getByLabelText('Default subject'), { target: { value: 'Keep edit' } });
  view.rerender(<Defaults profileId={42} profileStatus="loading" />); expect(screen.getByLabelText('Default subject')).toHaveValue('Keep edit'); expect(screen.getByText('Save as my default')).toBeDisabled();
  view.rerender(<Defaults profileId={42} profileStatus="ready" />); expect(screen.getByLabelText('Default subject')).toHaveValue('Keep edit'); expect(global.fetch).toHaveBeenCalledTimes(1);
});
test('mutation completing while profile loads cannot silently enable another write', async () => {
  const pending = deferred(); const view = render(<Defaults profileId={42} profileStatus="ready" />); await open();
  global.fetch.mockReturnValueOnce(pending.promise); fireEvent.click(screen.getByText('Save as my default'));
  view.rerender(<Defaults profileId={42} profileStatus="loading" />);
  await act(async () => { pending.reject(new Error('lost')); });
  view.rerender(<Defaults profileId={42} profileStatus="ready" />);
  expect(screen.getByText('Save as my default')).toBeDisabled(); expect(screen.getByText('Reload defaults')).toBeEnabled();
});
test('real actor switch ignores late old-actor read and clears private editor state', async () => {
  const pending = deferred(); global.fetch.mockReturnValueOnce(pending.promise);
  const view = render(<Defaults profileId={42} profileStatus="ready" />);
  const details = screen.getByText('Your default wording — grantee reminders').closest('details');
  await act(async () => { details.open = true; fireEvent(details, new Event('toggle')); });
  mockSession = { status: 'authenticated', data: { user: { profileId: 43, dynamicsSystemuserId: OTHER } } };
  view.rerender(<Defaults profileId={43} profileStatus="ready" />);
  await act(async () => pending.resolve(response(dto({ own: { ...pair, subject: 'Private old actor' } }))));
  expect(screen.getByLabelText('Default subject')).toHaveValue(''); expect(screen.queryByDisplayValue('Private old actor')).not.toBeInTheDocument();
});
test('busy prevents double mutation and Reload; unmount ignores late result', async () => {
  const pending = deferred(); const view = render(<ScheduledReminderWordingEditor owner={OWNER} active />); await open();
  global.fetch.mockReturnValueOnce(pending.promise); fireEvent.click(screen.getByText('Save as my default')); fireEvent.click(screen.getByText('Save as my default')); fireEvent.click(screen.getByText('Reload defaults'));
  expect(global.fetch).toHaveBeenCalledTimes(2); expect(screen.getByText('Reload defaults')).toBeDisabled();
  view.unmount(); await act(async () => pending.resolve(response(dto())));
});
test('dirty editor survives unrelated row-state rerender without fetching', async () => {
  const view = render(<ScheduledReminderWordingEditor owner={OWNER} active disabled={false} />); await open();
  fireEvent.change(screen.getByLabelText('Default subject'), { target: { value: 'Independent draft' } });
  view.rerender(<ScheduledReminderWordingEditor owner={OWNER} active disabled />);
  view.rerender(<ScheduledReminderWordingEditor owner={OWNER} active disabled={false} />);
  expect(screen.getByLabelText('Default subject')).toHaveValue('Independent draft'); expect(global.fetch).toHaveBeenCalledTimes(1);
});
function Guard({ pending = false }) { useScheduledDefaultsUnsavedChanges(true, pending); return null; }
test('route guard exempts shallow selection, blocks cancelled departure and preserves history', () => {
  render(<Guard />); window.confirm.mockReturnValue(false);
  expect(() => mockRouter.events.emit('routeChangeStart', '/scheduled-emails?message=2', { shallow: true })).not.toThrow(); expect(window.confirm).not.toHaveBeenCalled();
  expect(() => mockRouter.events.emit('routeChangeStart', '/workbench', {})).toThrow('Unsaved scheduled'); expect(window.confirm).toHaveBeenCalledTimes(1);
  const pop = mockRouter.beforePopState.mock.calls[0][0]; expect(pop({ as: '/scheduled-emails?message=3', options: { shallow: true } })).toBe(true); expect(pop({ as: '/workbench', options: {} })).toBe(false); expect(window.location.pathname).toBe('/scheduled-emails');
});
test('pending navigation warns the change may already be saved; beforeunload is registered', () => {
  render(<Guard pending />); window.confirm.mockReturnValue(false);
  expect(() => mockRouter.events.emit('routeChangeStart', '/workbench', {})).toThrow(); expect(window.confirm.mock.calls[0][0]).toContain('may already be saved');
  const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); expect(event.defaultPrevented).toBe(true);
});

function pageFixture(overrides = {}) {
  const rows = [1, 2].map(n => ({ id: `m${n}`, version: 1, workflowType: 'grantee_abstract_reminder', status: 'scheduled', subject: `Row ${n}`, bodyText: `Existing row ${n} content`, recipientName: `Recipient ${n}`, previewHtml: '<p>Stored preview</p>', recipientContactIds: [], from: 'pd@example.org', toRecipients: ['pi@example.org'], ccRecipients: [] }));
  global.fetch.mockImplementation(async (url, opts = {}) => {
    if (overrides[url]) return overrides[url](opts);
    if (url === '/api/scheduled-emails') return response({ messages: rows });
    if (url === '/api/email-automation-preferences') return response({ preference: { reviewAll: false } });
    if (url === '/api/scheduled-emails/vip-flags') return response({ flags: [] });
    if (url === '/api/scheduled-emails/email-preferences') return response(dto());
    throw new Error(`unexpected ${url}`);
  });
  return rows;
}
test('empty inbox still exposes future defaults without creating a scheduled message', async () => {
  pageFixture({ '/api/scheduled-emails': async () => response({ messages: [] }) });
  render(<ScheduledEmailsPage />); await screen.findByText('No scheduled emails'); await open();
  expect(screen.getByLabelText('Default subject')).toHaveValue(pair.subject);
  expect(global.fetch.mock.calls.every(([, opts]) => !opts?.method || opts.method === 'GET')).toBe(true);
});
test('default response preserves selected row edits, and selection preserves raw default edits', async () => {
  const pending = deferred(); pageFixture({ '/api/scheduled-emails/email-preferences': async () => pending.promise });
  render(<ScheduledEmailsPage />); await screen.findByDisplayValue('Row 1');
  fireEvent.change(screen.getByLabelText('Message', { exact: true }), { target: { value: 'One message edit retained' } });
  const details = screen.getByText('Your default wording — grantee reminders').closest('details');
  await act(async () => { details.open = true; fireEvent(details, new Event('toggle')); });
  await act(async () => pending.resolve(response(dto())));
  expect(screen.getByLabelText('Message', { exact: true })).toHaveValue('One message edit retained');
  fireEvent.change(screen.getByLabelText('Default subject'), { target: { value: 'Future draft retained' } });
  fireEvent.click(screen.getByText('Recipient 2'));
  expect(screen.getByLabelText('Default subject')).toHaveValue('Future draft retained');
  expect(screen.getByLabelText('Subject', { exact: true })).toHaveValue('Row 2');
  expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/scheduled-emails', query: { message: 'm2' } }, undefined, { shallow: true });
  expect(global.fetch.mock.calls.filter(([url]) => url.endsWith('/email-preferences'))).toHaveLength(1);
});
test('late default Save does not change a new row selection or edited message/approval action', async () => {
  const pending = deferred(); pageFixture({ '/api/scheduled-emails/email-preferences': opts => opts.method === 'PUT' ? pending.promise : response(dto()) });
  render(<ScheduledEmailsPage />); await screen.findByDisplayValue('Row 1'); await open();
  fireEvent.change(screen.getByLabelText('Default subject'), { target: { value: 'Saved future' } });
  fireEvent.click(screen.getByText('Save as my default'));
  fireEvent.click(screen.getByText('Recipient 2'));
  fireEvent.change(screen.getByLabelText('Message', { exact: true }), { target: { value: 'Second row local edit' } });
  await act(async () => pending.resolve(response(dto({ ownStatus: 'configured', own: { ...pair, subject: 'Saved future' }, source: 'personal', canClear: true }))));
  expect(screen.getByLabelText('Subject', { exact: true })).toHaveValue('Row 2');
  expect(screen.getByLabelText('Message', { exact: true })).toHaveValue('Second row local edit');
  expect(screen.getByText('Looks good')).toBeDisabled();
  expect(global.fetch.mock.calls.filter(([,opts]) => opts?.method && opts.method !== 'GET').map(([url]) => url)).toEqual(['/api/scheduled-emails/email-preferences']);
});

test.each([{ ok: true }, { ok: true, ownerSystemId: OWNER }, dto({ ownerSystemId: OTHER }), dto({ ownStatus: 'configured', own: {} })])('malformed/foreign mutation receipt %p never unlocks a second Save', async invalid => {
  render(<ScheduledReminderWordingEditor owner={OWNER} active />); await open();
  global.fetch.mockResolvedValueOnce(response(invalid)); fireEvent.click(screen.getByText('Save as my default'));
  await screen.findByText(/could not be confirmed/); expect(screen.getByText('Save as my default')).toBeDisabled();
});
test('duplicate state exposes Clear repair while Save is disabled', async () => {
  global.fetch.mockResolvedValueOnce(response(dto({ ownStatus: 'duplicates', canSave: false, canClear: true })));
  render(<ScheduledReminderWordingEditor owner={OWNER} active />); await open();
  expect(screen.getByText('Save as my default')).toBeDisabled(); expect(screen.getByText('Clear my default')).toBeEnabled();
  expect(screen.getByRole('alert')).toHaveTextContent('paused');
});

test('cancel Back after shallow selection restores the latest URL/history rather than the initial one', () => {
  render(<Guard />); window.history.replaceState({ message: 'm2' }, '', '/scheduled-emails?message=m2');
  act(() => mockRouter.events.emit('routeChangeComplete', '/scheduled-emails?message=m2', { shallow: true }));
  window.history.replaceState({}, '', '/workbench'); window.confirm.mockReturnValue(false);
  const pop = mockRouter.beforePopState.mock.calls[0][0]; expect(pop({ as: '/workbench', options: {} })).toBe(false);
  expect(window.location.search).toBe('?message=m2'); expect(window.history.state).toEqual({ message: 'm2' });
});
test('confirmed save with failed refresh has a truthful departure warning', async () => {
  render(<ScheduledReminderWordingEditor owner={OWNER} active />); await open();
  global.fetch.mockResolvedValueOnce(response({ ok: true, refreshUnavailable: true })); fireEvent.click(screen.getByText('Save as my default')); await screen.findByText(/change was confirmed/);
  window.confirm.mockReturnValue(false); expect(() => mockRouter.events.emit('routeChangeStart', '/workbench', {})).toThrow();
  expect(window.confirm.mock.calls[0][0]).toContain('was confirmed'); expect(window.confirm.mock.calls[0][0]).not.toContain('pending or unconfirmed');
});
test('known pre-write read failure says nothing changed and requires Reload without uncertain-write wording', async () => {
  render(<ScheduledReminderWordingEditor owner={OWNER} active />); await open();
  global.fetch.mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({ ok: false, reason: 'preference_unavailable' }) });
  fireEvent.click(screen.getByText('Save as my default')); await screen.findByText(/Nothing was changed/);
  expect(screen.getByText('Save as my default')).toBeDisabled(); expect(screen.queryByText(/could not be confirmed and may/)).toBeNull();
});
test('independent shared configuration failure is visible even with a valid personal pair', async () => {
  global.fetch.mockResolvedValueOnce(response(dto({ ownStatus: 'configured', own: pair, source: 'personal', shared: null, sharedStatus: 'unavailable', canClear: true })));
  render(<ScheduledReminderWordingEditor owner={OWNER} active />); await open();
  expect(screen.getByRole('alert')).toHaveTextContent('New scheduling still requires valid shared wording'); expect(screen.getByLabelText('Default subject')).toHaveValue(pair.subject);
});

test('history snapshot updates after shallow history change even before route completion', async () => {
  render(<Guard />);
  act(() => mockRouter.events.emit('beforeHistoryChange', '/scheduled-emails?message=m2', { shallow: true }));
  window.history.replaceState({ message: 'm2' }, '', '/scheduled-emails?message=m2');
  await act(async () => { await Promise.resolve(); });
  window.history.replaceState({}, '', '/workbench'); window.confirm.mockReturnValue(false);
  const pop = mockRouter.beforePopState.mock.calls[0][0]; expect(pop({ as: '/workbench', options: {} })).toBe(false);
  expect(window.location.search).toBe('?message=m2'); expect(window.history.state).toEqual({ message: 'm2' });
});
