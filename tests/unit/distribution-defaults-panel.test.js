/** @jest-environment jsdom */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import PreSiteDistributionPanel from '../../shared/components/workbench/PreSiteDistributionPanel';
jest.mock('next/router', () => ({ useRouter: () => ({ events: { on: jest.fn(), off: jest.fn(), emit: jest.fn() }, beforePopState: jest.fn() }) }));
const ID = '11111111-1111-4111-8111-111111111111';
const props = { requestId: ID, requestNumber: '123', sourceArtifact: { artifactId: 'sourceA' }, suggestedTo: ['staff@example.org'], composer: 'dialog', composeOpenVersion: 1 };
const pair = { subject: 'Personal {{requestNumber}}', body: 'Personal message' };
const defaults = (template = pair) => ({ ok: true, ownStatus: 'configured', own: template, shared: pair, effective: template, source: 'personal', canSave: true, canClear: true });
const attempt = { operationId: 'op1', requestId: ID, previewHash: 'hash1', briefingLinkId: 'link1', from: 'sender@example.org', to: ['staff@example.org'], cc: [], subject: 'Personal 123', bodyText: 'Personal message', attachments: [], transportAccepted: false, dynamicsEmailId: null, sendRequestedAt: null };
const response = (data, status = 200) => ({ ok: status < 300, status, json: async () => data });
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; };
let sendResult, preferenceResult, historyRows;
beforeEach(() => {
  sendResult = null; preferenceResult = null; historyRows = [];
  global.fetch = jest.fn(async (url, options = {}) => {
    if (url.includes('email-preferences')) return preferenceResult && options.method !== 'GET' ? preferenceResult.promise : response(defaults());
    if (url.includes('/prepare')) return response({ attempt });
    if (url.includes('/send')) return sendResult ? sendResult.promise : response({ attempt: { ...attempt, transportAccepted: true } });
    return response({ attempts: historyRows });
  });
});
async function ready(viewProps = props) { const view = render(<PreSiteDistributionPanel {...viewProps} />); await waitFor(() => expect(screen.getByLabelText('Subject')).toHaveValue('Personal 123')); return view; }
async function preview() { fireEvent.click(screen.getByRole('button', { name: 'Create preview' })); await screen.findByRole('heading', { name: 'Email preview' }); fireEvent.click(screen.getByRole('checkbox')); }
const calls = suffix => global.fetch.mock.calls.filter(([url]) => url.includes(suffix));
test('fresh ordinary reopen reseeds unchanged suggestions and defaults; close cancellation preserves edits', async () => {
  const close = jest.fn(); const view = await ready({ ...props, onCloseComposer: close });
  fireEvent.change(screen.getByLabelText('To'), { target: { value: 'changed@example.org' } });
  fireEvent.click(screen.getAllByRole('button', { name: 'Close' })[0]);
  expect(close).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
  expect(screen.getByLabelText('To')).toHaveValue('changed@example.org');
  fireEvent.click(screen.getAllByRole('button', { name: 'Close' })[1]); fireEvent.click(screen.getByRole('button', { name: 'Discard edits and close' }));
  expect(close).toHaveBeenCalledTimes(1);
  view.rerender(<PreSiteDistributionPanel {...props} composer="hidden" />);
  view.rerender(<PreSiteDistributionPanel {...props} composeOpenVersion={2} />);
  await waitFor(() => expect(screen.getByLabelText('To')).toHaveValue('staff@example.org'));
  expect(calls('email-preferences')).toHaveLength(2);
});
test('future Save and Clear preserve form, preview and confirmation without prepare/lock/send side effects', async () => {
  const lock = jest.fn(); await ready({ ...props, beforePrepare: lock }); await preview();
  const priorCalls = global.fetch.mock.calls.length;
  fireEvent.click(screen.getByText('Your default wording'));
  fireEvent.change(screen.getByLabelText('Default subject'), { target: { value: 'Future {{requestNumber}}' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save as my default' }));
  await screen.findByText('Default saved. The current email is unchanged.');
  expect(screen.getByLabelText('Subject')).toHaveValue('Personal 123'); expect(screen.getByRole('checkbox')).toBeChecked();
  expect(calls('/prepare')).toHaveLength(1); expect(calls('/send')).toHaveLength(0); expect(lock).toHaveBeenCalledTimes(1);
  expect(global.fetch.mock.calls.slice(priorCalls).every(([url]) => url.includes('email-preferences'))).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Clear my default' }));
  await screen.findByText('Default cleared. The current email is unchanged.'); expect(screen.getByRole('checkbox')).toBeChecked();
});
test('pending Save survives source pause and blocks Close; uncertain mutation requires strict reload', async () => {
  const close = jest.fn(); const view = await ready({ ...props, onCloseComposer: close });
  fireEvent.click(screen.getByText('Your default wording')); preferenceResult = deferred();
  fireEvent.click(screen.getByRole('button', { name: 'Save as my default' }));
  view.rerender(<PreSiteDistributionPanel {...props} sourceUnavailable onCloseComposer={close} />);
  fireEvent.click(screen.getAllByRole('button', { name: 'Close' })[0]); expect(close).not.toHaveBeenCalled();
  await act(async () => preferenceResult.reject(new Error('lost response')));
  expect(screen.getByText(/Reload defaults before trying/)).toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Save as my default' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Reload defaults' }));
  await waitFor(() => expect(screen.queryByText(/Reload defaults before trying/)).not.toBeInTheDocument());
});
test.each(['network', 'in-progress', 'persist_failed', 'malformed', 'unknown'])('issued %s outcome freezes exact envelope across close/reopen and later stale refusal', async kind => {
  const close = jest.fn(); const view = await ready({ ...props, onCloseComposer: close }); await preview();
  sendResult = deferred(); fireEvent.click(screen.getByRole('button', { name: 'Send email' }));
  await act(async () => {
    if (kind === 'network') sendResult.reject(new Error('network'));
    else sendResult.resolve(response(kind === 'malformed' ? {} : kind === 'in-progress' ? { inProgress: true } : { code: kind, outcome: 'uncertain' }, kind === 'in-progress' || kind === 'malformed' ? 200 : 500));
  });
  fireEvent.click(screen.getAllByRole('button', { name: 'Close' })[0]); expect(close).toHaveBeenCalledTimes(1);
  view.rerender(<PreSiteDistributionPanel {...props} composer="hidden" />); view.rerender(<PreSiteDistributionPanel {...props} composeOpenVersion={2} />);
  expect(screen.getByLabelText('Subject')).toBeDisabled(); expect(screen.getByRole('button', { name: 'Create new preview' })).toBeDisabled();
  sendResult = deferred(); historyRows = [attempt]; fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(screen.getByRole('button', { name: 'Send email' }));
  await act(async () => sendResult.resolve(response({ code: 'distribution_stale_source' }, 409)));
  expect(screen.getByLabelText('Subject')).toBeDisabled();
  expect(calls('/send').map(([, options]) => JSON.parse(options.body))).toEqual(Array(2).fill({ requestId: ID, operationId: 'op1', previewHash: 'hash1' }));
});
test('complete first refusal releases only with fresh explicit no-transport proof', async () => {
  await ready(); await preview(); sendResult = deferred(); historyRows = [attempt];
  fireEvent.click(screen.getByRole('button', { name: 'Send email' }));
  await act(async () => sendResult.resolve(response({ code: 'distribution_stale_source', error: 'Changed source' }, 409)));
  await waitFor(() => expect(screen.queryByRole('heading', { name: 'Email preview' })).not.toBeInTheDocument());
  expect(screen.getByLabelText('Subject')).toBeEnabled(); expect(screen.getByLabelText('Subject')).toHaveValue('Personal 123');
  expect(calls('/history').at(-1)[1].headers).toEqual({ 'Cache-Control': 'no-cache' });
});
test.each([{ ...attempt, dynamicsEmailId: 'activity' }, { ...attempt, sendRequestedAt: 'intent' }, { ...attempt, dynamicsEmailId: undefined }, { ...attempt, requestId: 'other' }])('incomplete/recorded-activity history cannot release envelope %p', async row => {
  await ready(); await preview(); sendResult = deferred(); historyRows = [row]; fireEvent.click(screen.getByRole('button', { name: 'Send email' }));
  await act(async () => sendResult.resolve(response({ code: 'refused' }, 409)));
  expect(screen.getByLabelText('Subject')).toBeDisabled();
});
test.each([true, false])('source/history change during send preserves accepted/error result and clears busy (%s)', async accepted => {
  const onHistory = jest.fn(); const view = await ready({ ...props, onHistory }); await preview(); sendResult = deferred();
  fireEvent.click(screen.getByRole('button', { name: 'Send email' }));
  view.rerender(<PreSiteDistributionPanel {...props} onHistory={onHistory} sourceArtifact={{ artifactId: 'sourceB' }} />);
  await waitFor(() => expect(calls('/history')).toHaveLength(2)); const historyCount = onHistory.mock.calls.length;
  await act(async () => sendResult.resolve(accepted ? response({ attempt: { ...attempt, transportAccepted: true } }) : response({ code: 'persist_failed', outcome: 'uncertain' }, 500)));
  expect(screen.queryByRole('button', { name: 'Sending…' })).not.toBeInTheDocument(); expect(onHistory.mock.calls.length).toBe(historyCount);
  if (!accepted) expect(screen.getByLabelText('Subject')).toBeDisabled();
});

test('late defaults cannot overwrite staff recipient or message edits or enable stale initialization after a newer Save', async () => {
  const load = deferred(); const fetcher = global.fetch;
  global.fetch = jest.fn((url, options) => url.includes('email-preferences') ? load.promise : fetcher(url, options));
  render(<PreSiteDistributionPanel {...props} />);
  fireEvent.change(screen.getByLabelText('To'), { target: { value: 'manual@example.org' } });
  fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Typed while loading' } });
  await act(async () => load.resolve(response(defaults())));
  expect(screen.getByLabelText('To')).toHaveValue('manual@example.org'); expect(screen.getByLabelText('Message')).toHaveValue('Typed while loading');
  expect(screen.getByText(/Wording source: built-in/)).toBeInTheDocument();
});
test('late automatic suggestions stay clean; returning staff edits to the baseline removes discard warning', async () => {
  const close = jest.fn(); const view = await ready({ ...props, suggestedTo: [], onCloseComposer: close });
  view.rerender(<PreSiteDistributionPanel {...props} suggestedTo={['later@example.org']} onCloseComposer={close} />);
  fireEvent.click(screen.getAllByRole('button', { name: 'Close' })[0]); expect(close).toHaveBeenCalledTimes(1);
  fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Changed' } });
  fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Personal 123' } });
  fireEvent.click(screen.getAllByRole('button', { name: 'Close' })[0]); expect(close).toHaveBeenCalledTimes(2);
});
test('Escape cancels inline discard without losing preview, and editor discard cannot remove recovery', async () => {
  const close = jest.fn(); await ready({ ...props, onCloseComposer: close }); await preview();
  fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Edited' } }); await preview();
  fireEvent(screen.getByRole('dialog'), new Event('cancel', { bubbles: false, cancelable: true }));
  expect(screen.getByRole('button', { name: 'Keep editing' })).toBeInTheDocument();
  fireEvent(screen.getByRole('dialog'), new Event('cancel', { bubbles: false, cancelable: true }));
  expect(screen.queryByRole('button', { name: 'Keep editing' })).toBeNull(); expect(screen.getByRole('checkbox')).toBeChecked();
  sendResult = deferred(); fireEvent.click(screen.getByRole('button', { name: 'Send email' }));
  await act(async () => sendResult.reject(new Error('uncertain')));
  fireEvent.click(screen.getByText('Your default wording')); fireEvent.change(screen.getByLabelText('Default message'), { target: { value: 'Unsaved future wording' } });
  fireEvent.click(screen.getAllByRole('button', { name: 'Close' })[0]); fireEvent.click(screen.getByRole('button', { name: 'Discard edits and close' }));
  expect(close).toHaveBeenCalledTimes(1); expect(screen.getByLabelText('Subject')).toBeDisabled(); expect(screen.getByRole('heading', { name: 'Email preview' })).toBeInTheDocument();
});
test('source replacement preserves draft/editor text while invalidating ordinary preview and confirmation', async () => {
  const view = await ready(); await preview(); fireEvent.click(screen.getByText('Your default wording'));
  fireEvent.change(screen.getByLabelText('Default message'), { target: { value: 'Future edit' } });
  view.rerender(<PreSiteDistributionPanel {...props} sourceArtifact={{ artifactId: 'replacement' }} sourceUnavailable />);
  expect(screen.getByLabelText('Default message')).toHaveValue('Future edit'); expect(screen.getByLabelText('Subject')).toHaveValue('Personal 123'); expect(screen.queryByRole('heading', { name: 'Email preview' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Create preview' })).toBeDisabled();
});
test('regeneration refusal then stale refusal can each release after explicit no-transport proof', async () => {
  await ready(); historyRows = [attempt];
  for (const code of ['brief_regeneration_in_progress', 'distribution_stale_source']) {
    await preview(); sendResult = deferred(); fireEvent.click(screen.getByRole('button', { name: 'Send email' }));
    await act(async () => sendResult.resolve(response({ code }, 409)));
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Email preview' })).toBeNull());
    expect(screen.getByLabelText('Subject')).toBeEnabled();
  }
});
test.each([{}, { ...attempt, requestId: 'other', transportAccepted: true }, { ...attempt, from: 'other@example.org', transportAccepted: true }, { ...attempt, attachments: undefined, transportAccepted: true }])('malformed/foreign 2xx acceptance cannot resolve exact envelope %p', async invalid => {
  await ready(); await preview(); sendResult = deferred(); historyRows = [attempt]; fireEvent.click(screen.getByRole('button', { name: 'Send email' }));
  await act(async () => sendResult.resolve(response({ attempt: invalid })));
  expect(screen.getByLabelText('Subject')).toBeDisabled(); expect(screen.getByTestId('distribution-send-feedback')).toHaveTextContent('uncertain');
});
