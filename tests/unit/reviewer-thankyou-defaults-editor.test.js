/** @jest-environment jsdom */
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import Editor, { useReviewerThankYouDefaults } from '../../shared/components/reviewers/ReviewerThankYouDefault';
import ProfileSettings from '../../pages/profile-settings';
const EventEmitter = require('events');
const mockRouter = { events: new EventEmitter(), beforePopState: jest.fn() };
let mockSession, mockProfile;
const mockSelect = jest.fn(), mockArchive = jest.fn();
jest.mock('next/router', () => ({ useRouter: () => mockRouter }));
jest.mock('next-auth/react', () => ({ useSession: () => mockSession }));
jest.mock('../../shared/context/ProfileContext', () => ({ useProfile: () => mockProfile }));
jest.mock('../../shared/components/Layout', () => ({ __esModule: true, default: ({ children }) => <div>{children}</div>, PageHeader: ({ title }) => <h1>{title}</h1>, Card: ({ children }) => <section>{children}</section>, Button: ({ children, loading: _loading, ...props }) => <button {...props}>{children}</button> }));
const OWNER = 'abcdefab-1111-4111-8111-111111111111', OTHER = '22222222-2222-4222-8222-222222222222';
const pair = { subject: 'Thank you {{proposalTitle}}', body: '{{greeting}}, thank you. {{signature}}' };
const dto = (extra = {}) => ({ ok: true, authenticatedProfileId: 42, ownerSystemId: OWNER, ownStatus: 'absent', own: null, configured: false, shared: pair, sharedStatus: 'available', source: 'shared', canSave: true, canClear: false, ...extra });
const response = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function Harness(props) { const controller = useReviewerThankYouDefaults({ profileId: 42, profileStatus: 'ready', ...props }); return <Editor controller={controller} />; }
async function open() { const details = screen.getByText('Your default wording — automatic thank-you').closest('details'); await act(async () => { details.open = true; fireEvent(details, new Event('toggle')); }); await waitFor(() => expect(screen.getByLabelText('Default subject')).toBeEnabled()); }
function edit(value = 'Personal subject') { fireEvent.change(screen.getByLabelText('Default subject'), { target: { value } }); }
beforeEach(() => {
  mockRouter.events.removeAllListeners(); mockRouter.beforePopState.mockClear(); mockSelect.mockReset(); mockArchive.mockReset();
  mockSession = { status: 'authenticated', data: { user: { profileId: 42, dynamicsSystemuserId: OWNER } } };
  mockProfile = { status: 'ready', isLoading: false, currentProfile: { id: 42, name: 'PD', displayName: 'PD', isDefault: false }, profiles: [{ id: 42, name: 'PD', isDefault: false }, { id: 99, name: 'Other', isDefault: false }], preferences: {}, selectProfile: mockSelect, archiveProfile: mockArchive };
  global.fetch = jest.fn(async url => String(url).includes('reviewer-thankyou-email-preferences') ? response(dto()) : response({ subject: 'Invite', body: 'Invite body', configured: true }));
  jest.spyOn(window, 'confirm').mockReturnValue(true); window.history.replaceState({}, '', '/profile-settings');
});
afterEach(() => jest.restoreAllMocks());
test('load is lazy, save is explicit and only changes the new pair', async () => {
  render(<Harness />); expect(fetch).not.toHaveBeenCalled(); await open(); expect(fetch).toHaveBeenCalledTimes(1);
  edit(); fetch.mockResolvedValueOnce(response(dto({ ownStatus: 'configured', own: { ...pair, subject: 'Personal subject' }, configured: true, source: 'personal', canClear: true })));
  fireEvent.click(screen.getByText('Save as my default')); await screen.findByText('Saved for future automatic thank-yous.');
  expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ template: { ...pair, subject: 'Personal subject' } });
  expect(fetch.mock.calls.every(([url]) => url === '/api/reviewer-thankyou-email-preferences')).toBe(true);
});
test('validation rejects legacy personal copy without writing, while shared prefill remains visible', async () => {
  fetch.mockResolvedValue(response(dto({ shared: { subject: 'Shared', body: '[greeting] {{honorariumNote}}' } })));
  render(<Harness />); await open(); fireEvent.click(screen.getByText('Save as my default'));
  await screen.findByText(/Replace legacy bracket/); expect(fetch).toHaveBeenCalledTimes(1);
});
test('collapse retains edits and dirty Reload cancellation performs no read', async () => {
  render(<Harness />); await open(); edit(); const details = screen.getByText('Your default wording — automatic thank-you').closest('details');
  await act(async () => { details.open = false; fireEvent(details, new Event('toggle')); details.open = true; fireEvent(details, new Event('toggle')); });
  expect(screen.getByLabelText('Default subject')).toHaveValue('Personal subject'); window.confirm.mockReturnValue(false);
  fireEvent.click(screen.getByText('Reload defaults')); expect(fetch).toHaveBeenCalledTimes(1);
});
test('Clear always confirms, deletes only on approval and reloads confirmed absence', async () => {
  fetch.mockResolvedValueOnce(response(dto({ ownStatus: 'configured', own: pair, configured: true, source: 'personal', canClear: true })));
  render(<Harness />); await open(); window.confirm.mockReturnValue(false); fireEvent.click(screen.getByText('Clear my default')); expect(fetch).toHaveBeenCalledTimes(1);
  window.confirm.mockReturnValue(true); fireEvent.click(screen.getByText('Clear my default')); await screen.findByText(/Your default was cleared/);
  expect(fetch.mock.calls[1][1].method).toBe('DELETE'); expect(fetch.mock.calls[1][1].body).toBe('{}');
});
test.each(['network', 'foreign-owner', 'foreign-profile', 'malformed'])('unknown write %s locks repeated writes until strict Reload', async kind => {
  render(<Harness />); await open(); edit();
  if (kind === 'network') fetch.mockRejectedValueOnce(new Error('lost'));
  else fetch.mockResolvedValueOnce(response(kind === 'malformed' ? { ok: true } : dto({ [kind === 'foreign-owner' ? 'ownerSystemId' : 'authenticatedProfileId']: kind === 'foreign-owner' ? OTHER : 99 })));
  fireEvent.click(screen.getByText('Save as my default')); await screen.findByText(/The change could not be confirmed/);
  expect(screen.getByText('Save as my default')).toBeDisabled(); expect(screen.getByText('Clear my default')).toBeDisabled();
  fireEvent.click(screen.getByText('Reload defaults')); await waitFor(() => expect(screen.getByText('Save as my default')).toBeEnabled());
});
test('pending write prevents duplicates and navigation warns that it may already be saved', async () => {
  render(<Harness />); await open(); edit(); const wait = deferred(); fetch.mockReturnValueOnce(wait.promise);
  fireEvent.click(screen.getByText('Save as my default')); fireEvent.click(screen.getByText('Save as my default')); expect(fetch).toHaveBeenCalledTimes(2);
  window.confirm.mockReturnValue(false); expect(() => mockRouter.events.emit('routeChangeStart', '/workbench', {})).toThrow();
  expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('may already be saved'));
  await act(async () => wait.resolve(response({ ok: false }, 503))); await screen.findByText(/The change could not be confirmed/);
});
test('confirmed write with failed refresh has separate truthful navigation copy and requires Reload', async () => {
  render(<Harness />); await open(); edit(); fetch.mockResolvedValueOnce(response({ ok: true, ownerSystemId: OWNER, authenticatedProfileId: 42, refreshUnavailable: true }));
  fireEvent.click(screen.getByText('Save as my default')); await screen.findByText(/Your change was confirmed/);
  expect(screen.getByText('Save as my default')).toBeDisabled(); window.confirm.mockReturnValue(false);
  expect(() => mockRouter.events.emit('routeChangeStart', '/', {})).toThrow(); expect(window.confirm).toHaveBeenLastCalledWith(expect.stringContaining('change was confirmed'));
});
test('known pre-write read failure says nothing changed and disables mutation until Reload', async () => {
  render(<Harness />); await open(); edit(); fetch.mockResolvedValueOnce(response({ ok: false, reason: 'preference_unavailable' }, 503));
  fireEvent.click(screen.getByText('Save as my default')); await screen.findByText(/Nothing was changed/); expect(screen.getByText('Save as my default')).toBeDisabled();
});
test.each(['owner', 'profile', 'shape'])('foreign/malformed GET %s cannot enable writes or display raw copy', async kind => {
  fetch.mockResolvedValueOnce(response(kind === 'shape' ? { ok: true } : dto({ [kind === 'owner' ? 'ownerSystemId' : 'authenticatedProfileId']: kind === 'owner' ? OTHER : 99 })));
  render(<Harness />); const details = screen.getByText('Your default wording — automatic thank-you').closest('details');
  await act(async () => { details.open = true; fireEvent(details, new Event('toggle')); }); await screen.findByText(/could not be loaded/);
  expect(screen.getByLabelText('Default subject')).toHaveValue(''); expect(screen.getByText('Save as my default')).toBeDisabled();
});
test('same-actor loading pause ignores late save, retains draft and uncertainty after resume', async () => {
  const view = render(<Harness />); await open(); edit(); const wait = deferred(); fetch.mockReturnValueOnce(wait.promise); fireEvent.click(screen.getByText('Save as my default'));
  view.rerender(<Harness loading />); await act(async () => wait.resolve(response(dto({ ownStatus: 'configured', own: pair, configured: true, source: 'personal', canClear: true }))));
  view.rerender(<Harness />); expect(screen.getByLabelText('Default subject')).toHaveValue('Personal subject'); expect(screen.getByText('Save as my default')).toBeDisabled();
});
test('real actor change clears private draft and ignores old response', async () => {
  const view = render(<Harness />); await open(); edit(); const wait = deferred(); fetch.mockReturnValueOnce(wait.promise); fireEvent.click(screen.getByText('Save as my default'));
  mockSession = { status: 'authenticated', data: { user: { profileId: 99, dynamicsSystemuserId: OTHER } } }; view.rerender(<Harness profileId={99} />);
  await act(async () => wait.resolve(response(dto()))); expect(screen.queryByDisplayValue('Personal subject')).toBeNull(); expect(screen.queryByText('Saved for future automatic thank-yous.')).toBeNull();
});
test('unmount with pending read never writes or applies a late response', async () => {
  const wait = deferred(); fetch.mockReturnValueOnce(wait.promise); const view = render(<Harness />);
  const details = screen.getByText('Your default wording — automatic thank-you').closest('details'); await act(async () => { details.open = true; fireEvent(details, new Event('toggle')); });
  view.unmount(); await act(async () => wait.resolve(response(dto()))); expect(fetch).toHaveBeenCalledTimes(1);
});
test('actual Profile Settings loading return preserves controller draft; Switch/Archive guards distinguish other profiles', async () => {
  const view = render(<ProfileSettings />); await open(); edit();
  mockProfile = { ...mockProfile, isLoading: true, status: 'loading' }; view.rerender(<ProfileSettings />); expect(screen.getByText('Loading...')).toBeInTheDocument();
  mockProfile = { ...mockProfile, isLoading: false, status: 'ready' }; view.rerender(<ProfileSettings />); expect(screen.getByLabelText('Default subject')).toHaveValue('Personal subject');
  window.confirm.mockReturnValue(false); fireEvent.click(screen.getByText('Switch')); expect(mockSelect).not.toHaveBeenCalled(); expect(screen.getByLabelText('Default subject')).toHaveValue('Personal subject');
  window.confirm.mockReturnValue(true); const archives = screen.getAllByText('Archive'); fireEvent.click(archives[1]);
  await waitFor(() => expect(mockArchive).toHaveBeenCalledWith(99)); expect(window.confirm).toHaveBeenLastCalledWith(expect.stringContaining('archive'));
});
test('Back cancellation preserves latest URL/history and beforeunload warns', async () => {
  render(<Harness />); await open(); edit(); window.confirm.mockReturnValue(false);
  const pop = mockRouter.beforePopState.mock.calls.at(-1)[0];
  window.history.replaceState({ current: 1 }, '', '/profile-settings?view=emails'); act(() => mockRouter.events.emit('routeChangeComplete'));
  expect(pop({ as: '/workbench', options: {} })).toBe(false); expect(location.search).toBe('?view=emails');
  const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); expect(event.defaultPrevented).toBe(true);
});


test('actual page pending save survives loading return and cannot be retried without Reload', async () => {
  const view = render(<ProfileSettings />); await open(); edit(); const wait = deferred(); fetch.mockReturnValueOnce(wait.promise);
  fireEvent.click(screen.getByText('Save as my default')); mockProfile = { ...mockProfile, isLoading: true, status: 'loading' }; view.rerender(<ProfileSettings />);
  await act(async () => wait.resolve(response(dto({ configured: true, ownStatus: 'configured', own: pair, source: 'personal', canClear: true }))));
  mockProfile = { ...mockProfile, isLoading: false, status: 'ready' }; view.rerender(<ProfileSettings />);
  expect(screen.getByLabelText('Default subject')).toHaveValue('Personal subject'); expect(screen.getByText('Save as my default')).toBeDisabled();
});
test('current-profile Archive warns even when selected profile uses a string ID; cancellation keeps draft', async () => {
  mockProfile = { ...mockProfile, currentProfile: { ...mockProfile.currentProfile, id: '42' } };
  render(<ProfileSettings />); await open(); edit(); window.confirm.mockReturnValueOnce(true).mockReturnValueOnce(false);
  fireEvent.click(screen.getAllByText('Archive')[0]); expect(mockArchive).not.toHaveBeenCalled(); expect(screen.getByLabelText('Default subject')).toHaveValue('Personal subject');
  expect(window.confirm).toHaveBeenLastCalledWith('Discard your unsaved default wording?');
});
test('unavailable own copy cannot unlock an uncertainty barrier, and strict readable Reload can', async () => {
  render(<Harness />); await open(); edit(); fetch.mockRejectedValueOnce(new Error('unknown')); fireEvent.click(screen.getByText('Save as my default')); await screen.findByText(/The change could not be confirmed/);
  fetch.mockResolvedValueOnce(response(dto({ ownStatus: 'unavailable', canSave: false, canClear: false })));
  fireEvent.click(screen.getByText('Reload defaults')); await waitFor(() => expect(screen.getByText('Reload defaults')).toBeEnabled()); expect(screen.getByText('Save as my default')).toBeDisabled();
  fireEvent.click(screen.getByText('Reload defaults')); await waitFor(() => expect(screen.getByText('Save as my default')).toBeEnabled());
});
test('duplicate status allows explicit Clear but not Save; shared outage still warns with own copy', async () => {
  fetch.mockResolvedValueOnce(response(dto({ ownStatus: 'duplicates', canSave: false, canClear: true })));
  render(<Harness />); await open(); expect(screen.getByText('Save as my default')).toBeDisabled(); expect(screen.getByText('Clear my default')).toBeEnabled();
  fetch.mockResolvedValueOnce(response(dto({ configured: true, ownStatus: 'configured', own: pair, source: 'personal', shared: null, sharedStatus: 'unavailable', canClear: true })));
  fireEvent.click(screen.getByText('Reload defaults')); await screen.findByText(/Shared thank-you wording is unavailable/); expect(screen.getByText('Save as my default')).toBeEnabled();
});


test.each([['identity_unavailable', 503], ['identity_mismatch', 403]])('pre-write %s refusal keeps draft and requires Reload without claiming possible save', async (reason, status) => {
  render(<Harness />); await open(); edit(); fetch.mockResolvedValueOnce(response({ ok: false, reason }, status));
  fireEvent.click(screen.getByText('Save as my default')); await screen.findByText(/Your default wording was not changed/);
  expect(screen.getByLabelText('Default subject')).toHaveValue('Personal subject'); expect(screen.getByText('Save as my default')).toBeDisabled();
  window.confirm.mockReturnValue(false); expect(() => mockRouter.events.emit('routeChangeStart', '/', {})).toThrow();
  expect(window.confirm).toHaveBeenLastCalledWith('Discard your unsaved default wording?');
});
test('contradictory failure receipt cannot claim nothing changed or remove uncertainty', async () => {
  render(<Harness />); await open(); edit(); fetch.mockResolvedValueOnce(response({ ok: true, reason: 'identity_unavailable' }, 503));
  fireEvent.click(screen.getByText('Save as my default')); await screen.findByText(/The change could not be confirmed/);
  expect(screen.getByText('Save as my default')).toBeDisabled(); expect(screen.queryByText(/Your default wording was not changed/)).toBeNull();
});
