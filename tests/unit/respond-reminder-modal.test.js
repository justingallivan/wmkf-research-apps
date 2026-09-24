/** @jest-environment jsdom */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import RespondReminderModal from '../../shared/components/reviewers/RespondReminderModal';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const SUGGESTION_ID = '22222222-2222-4222-8222-222222222222';
const SENDER_ID = '33333333-3333-4333-8333-333333333333';
const candidate = { suggestionId: SUGGESTION_ID, name: 'Dr. Reviewer' };
const template = { subject: 'Original subject', body: '{{greeting}},\n\nOriginal body\n\n{{signature}}' };
const draft = {
  suggestionId: SUGGESTION_ID, name: candidate.name,
  to: 'reviewer@example.org', from: 'pd@keck.org', senderId: SENDER_ID,
  subject: template.subject, bodyText: 'Dear Dr. Reviewer,\n\nOriginal body\n\nDr. PD',
  template, proof: 'signed-proof',
};
const response = (data, ok = true, status = 200) => ({ ok, status, json: async () => data });
function installFetch({ preview = draft, send = { ok: true }, ownSystemId = SENDER_ID } = {}) {
  global.fetch = jest.fn((url, options) => {
    if (url.startsWith('/api/review-manager/reminder-email-preferences?')) return Promise.resolve(response({ ok: true, ownSystemId }));
    if (url === '/api/review-manager/send-review-reminder') {
      const body = JSON.parse(options.body);
      if (body.action === 'preview') return Promise.resolve(response({ ok: true, draft: preview }));
      return Promise.resolve(response(send));
    }
    if (url === '/api/review-manager/reminder-email-preferences') return Promise.resolve(response({ ok: true }));
    throw new Error(`Unexpected request ${url}`);
  });
}
beforeEach(() => { jest.clearAllMocks(); installFetch(); });

test('initial preview has no send and Cancel only closes', async () => {
  const onClose = jest.fn();
  render(<RespondReminderModal requestId={REQUEST_ID} candidate={candidate} onClose={onClose} />);
  expect(await screen.findByText('Email preview')).toBeInTheDocument();
  expect(global.fetch.mock.calls.filter(([url, options]) => url === '/api/review-manager/send-review-reminder' && JSON.parse(options.body).action === 'send')).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(onClose).toHaveBeenCalledTimes(1);
});

test('one-send edits require refreshed preview and do not save a default', async () => {
  const edited = { subject: 'Edited subject', body: template.body };
  global.fetch = jest.fn((url, options) => {
    if (url.startsWith('/api/review-manager/reminder-email-preferences?')) return Promise.resolve(response({ ok: true, ownSystemId: SENDER_ID }));
    const payload = JSON.parse(options.body);
    if (payload.action === 'preview') return Promise.resolve(response({ ok: true, draft: payload.template ? { ...draft, subject: edited.subject, template: edited, proof: 'edited-proof' } : draft }));
    return Promise.resolve(response({ ok: true }));
  });
  const onSent = jest.fn();
  render(<RespondReminderModal requestId={REQUEST_ID} candidate={candidate} onClose={jest.fn()} onSent={onSent} />);
  fireEvent.change(await screen.findByDisplayValue('Original subject'), { target: { value: 'Edited subject' } });
  expect(screen.getByRole('button', { name: 'Send reminder' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh preview' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Send reminder' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Send reminder' }));
  await waitFor(() => expect(onSent).toHaveBeenCalledTimes(1));
  const sends = global.fetch.mock.calls.filter(([url, options]) => url === '/api/review-manager/send-review-reminder' && JSON.parse(options.body).action === 'send');
  expect(JSON.parse(sends[0][1].body)).toEqual({ requestId: REQUEST_ID, suggestionId: SUGGESTION_ID, kind: 'respond', action: 'send', template: edited, proof: 'edited-proof' });
  expect(global.fetch.mock.calls.some(([url, options]) => url === '/api/review-manager/reminder-email-preferences' && options.method === 'PUT')).toBe(false);
});

test('explicit Save writes the raw template only for the mailbox owner', async () => {
  render(<RespondReminderModal requestId={REQUEST_ID} candidate={candidate} onClose={jest.fn()} />);
  await screen.findByText('Email preview');
  fireEvent.click(await screen.findByRole('button', { name: 'Save as my default' }));
  await waitFor(() => expect(screen.getByText('Saved for future reminders from your mailbox.')).toBeInTheDocument());
  const put = global.fetch.mock.calls.find(([url, options]) => url === '/api/review-manager/reminder-email-preferences' && options.method === 'PUT');
  expect(JSON.parse(put[1].body)).toEqual({ kind: 'respond', template });
  expect(global.fetch.mock.calls.some(([url, options]) => url === '/api/review-manager/send-review-reminder' && JSON.parse(options.body).action === 'send')).toBe(false);
});

test('Clear my saved default affects future drafts and preserves the current one-send copy', async () => {
  const shared = { subject: 'Admin copy', body: '{{greeting}} Admin {{signature}}' };
  global.fetch = jest.fn((url, options) => {
    if (url.startsWith('/api/review-manager/reminder-email-preferences?')) return Promise.resolve(response({ ok: true, ownSystemId: SENDER_ID, configured: true, shared }));
    if (url === '/api/review-manager/send-review-reminder') return Promise.resolve(response({ ok: true, draft }));
    if (url === '/api/review-manager/reminder-email-preferences' && options.method === 'DELETE') return Promise.resolve(response({ ok: true }));
    throw new Error(`Unexpected request ${url}`);
  });
  render(<RespondReminderModal requestId={REQUEST_ID} candidate={candidate} onClose={jest.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Clear my saved default' }));
  expect(await screen.findByText('Your saved default was cleared. This one-send draft is unchanged.')).toBeInTheDocument();
  expect(screen.getByDisplayValue('Original subject')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Send reminder' })).toBeEnabled();
  const del = global.fetch.mock.calls.find(([url, options]) => url === '/api/review-manager/reminder-email-preferences' && options.method === 'DELETE');
  expect(JSON.parse(del[1].body)).toEqual({ kind: 'respond' });
});

test('refreshing the preview during Save does not leave the preference controls stuck', async () => {
  let finishSave;
  const original = global.fetch;
  global.fetch = jest.fn((url, options) => {
    if (url === '/api/review-manager/reminder-email-preferences' && options.method === 'PUT') {
      return new Promise((resolve) => { finishSave = resolve; });
    }
    return original(url, options);
  });
  render(<RespondReminderModal requestId={REQUEST_ID} candidate={candidate} onClose={jest.fn()} />);
  await screen.findByText('Email preview');
  fireEvent.click(await screen.findByRole('button', { name: 'Save as my default' }));
  fireEvent.click(screen.getByRole('button', { name: 'Refresh preview' }));
  await act(async () => { finishSave(response({ ok: true })); });
  expect(await screen.findByText('Saved for future reminders from your mailbox.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save as my default' })).toBeEnabled();
});

test('an invalid own default can be cleared and the Admin copy previewed again', async () => {
  let previews = 0;
  global.fetch = jest.fn((url, options) => {
    if (url.startsWith('/api/review-manager/reminder-email-preferences?')) {
      return Promise.resolve(response({ ok: false, reason: 'preference_invalid', ownSystemId: SENDER_ID, configured: true, shared: template }, false, 409));
    }
    if (url === '/api/review-manager/reminder-email-preferences' && options.method === 'DELETE') return Promise.resolve(response({ ok: true }));
    if (url === '/api/review-manager/send-review-reminder') {
      previews += 1;
      return Promise.resolve(previews === 1
        ? response({ ok: false, reason: 'preference_invalid' }, false, 503)
        : response({ ok: true, draft }));
    }
    throw new Error(`Unexpected request ${url}`);
  });
  render(<RespondReminderModal requestId={REQUEST_ID} candidate={candidate} onClose={jest.fn()} />);
  expect(await screen.findByText(/Your saved default needs correction/)).toBeInTheDocument();
  expect(screen.getByDisplayValue(template.subject)).toBeInTheDocument();
  fireEvent.click(await screen.findByRole('button', { name: 'Clear my saved default' }));
  expect(await screen.findByText('Email preview')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Send reminder' })).toBeEnabled();
});

test('an invalid own default does not overwrite a completed preview from another PD', async () => {
  let finishOwn;
  global.fetch = jest.fn((url) => {
    if (url.startsWith('/api/review-manager/reminder-email-preferences?')) return new Promise((resolve) => { finishOwn = resolve; });
    return Promise.resolve(response({ ok: true, draft }));
  });
  render(<RespondReminderModal requestId={REQUEST_ID} candidate={candidate} onClose={jest.fn()} />);
  await screen.findByText('Email preview');
  await act(async () => {
    finishOwn(response({ ok: false, reason: 'preference_invalid', ownSystemId: '44444444-4444-4444-8444-444444444444', configured: true, shared: { subject: 'Different Admin subject', body: template.body } }, false, 409));
  });
  expect(screen.getByDisplayValue('Original subject')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Send reminder' })).toBeEnabled();
});

test('superuser acting for another PD can save only their own default', async () => {
  installFetch({ ownSystemId: '44444444-4444-4444-8444-444444444444' });
  render(<RespondReminderModal requestId={REQUEST_ID} candidate={candidate} onClose={jest.fn()} />);
  await screen.findByText('Email preview');
  expect(await screen.findByText(/Saving a default changes only your own settings/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Save as my default' }));
  await waitFor(() => expect(screen.getByText('Saved for future reminders from your mailbox.')).toBeInTheDocument());
  const put = global.fetch.mock.calls.find(([url, options]) => url === '/api/review-manager/reminder-email-preferences' && options.method === 'PUT');
  expect(JSON.parse(put[1].body)).toEqual({ kind: 'respond', template });
});

test('review-due shows the exact server-rendered link-free preview', async () => {
  installFetch({ preview: { ...draft, kind: 'reviewdue', previewHtml: '<p>Due tomorrow</p><p>Use your original email.</p>', fixedAccessInstruction: 'Use your original email.' } });
  render(<RespondReminderModal requestId={REQUEST_ID} candidate={candidate} kind="reviewdue" onClose={jest.fn()} />);
  expect(await screen.findByText('Due tomorrow')).toBeInTheDocument();
  expect(screen.getByText('Use your original email.')).toBeInTheDocument();
  expect(screen.getByText('No new review link is included.')).toBeInTheDocument();
});

test('network uncertainty after Send never reports confirmed delivery', async () => {
  installFetch();
  const original = global.fetch;
  global.fetch = jest.fn((url, options) => {
    if (url === '/api/review-manager/send-review-reminder' && JSON.parse(options.body).action === 'send') return Promise.reject(new Error('offline'));
    return original(url, options);
  });
  const onSent = jest.fn();
  render(<RespondReminderModal requestId={REQUEST_ID} candidate={candidate} onClose={jest.fn()} onSent={onSent} />);
  await screen.findByText('Email preview');
  fireEvent.click(screen.getByRole('button', { name: 'Send reminder' }));
  expect(await screen.findByText('The app could not confirm the result. Check reviewer activity before trying again.')).toBeInTheDocument();
  expect(onSent).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh preview' }));
  await screen.findByText('Email preview');
  expect(screen.getByText('The app could not confirm the result. Check reviewer activity before trying again.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Send reminder' })).toBeDisabled();
  expect(global.fetch.mock.calls.filter(([url, options]) => url === '/api/review-manager/send-review-reminder' && JSON.parse(options.body).action === 'send')).toHaveLength(1);
});

test('the template cannot be edited while a refreshed preview is in flight', async () => {
  let finishPreview;
  const original = global.fetch;
  global.fetch = jest.fn((url, options) => {
    if (url === '/api/review-manager/send-review-reminder' && JSON.parse(options.body).action === 'preview' && JSON.parse(options.body).template) {
      return new Promise((resolve) => { finishPreview = resolve; });
    }
    return original(url, options);
  });
  render(<RespondReminderModal requestId={REQUEST_ID} candidate={candidate} onClose={jest.fn()} />);
  fireEvent.change(await screen.findByDisplayValue('Original subject'), { target: { value: 'Edited subject' } });
  fireEvent.click(screen.getByRole('button', { name: 'Refresh preview' }));
  expect(screen.getByDisplayValue('Edited subject')).toBeDisabled();
  expect(screen.getByRole('textbox', { name: 'Message template' })).toBeDisabled();
  await act(async () => { finishPreview(response({ ok: true, draft: { ...draft, subject: 'Edited subject', template: { ...template, subject: 'Edited subject' } } })); });
  expect(screen.getByDisplayValue('Edited subject')).toBeEnabled();
});

test('a failed initial preview can retry the effective default without typing a template', async () => {
  let previews = 0;
  const original = global.fetch;
  global.fetch = jest.fn((url, options) => {
    if (url === '/api/review-manager/send-review-reminder' && JSON.parse(options.body).action === 'preview') {
      previews += 1;
      return Promise.resolve(previews === 1
        ? response({ ok: false, reason: 'read_failed' }, false, 502)
        : response({ ok: true, draft }));
    }
    return original(url, options);
  });
  render(<RespondReminderModal requestId={REQUEST_ID} candidate={candidate} onClose={jest.fn()} />);
  expect(await screen.findByText('The latest reviewer status could not be verified. No reminder was sent.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry preview' }));
  expect(await screen.findByText('Email preview')).toBeInTheDocument();
  expect(global.fetch.mock.calls.filter(([url, options]) => url === '/api/review-manager/send-review-reminder' && JSON.parse(options.body).action === 'preview').every(([, options]) => !Object.hasOwn(JSON.parse(options.body), 'template'))).toBe(true);
});

test('a parent refresh error cannot turn a confirmed send into a failed send', async () => {
  const onSent = jest.fn(() => { throw new Error('refresh failed'); });
  render(<RespondReminderModal requestId={REQUEST_ID} candidate={candidate} onClose={jest.fn()} onSent={onSent} />);
  await screen.findByText('Email preview');
  fireEvent.click(screen.getByRole('button', { name: 'Send reminder' }));
  expect(await screen.findByText(/Sent for delivery/)).toBeInTheDocument();
  expect(onSent).toHaveBeenCalledTimes(1);
});

test('a send completion calls the latest parent refresh callback', async () => {
  let finishSend;
  const original = global.fetch;
  global.fetch = jest.fn((url, options) => {
    if (url === '/api/review-manager/send-review-reminder' && JSON.parse(options.body).action === 'send') {
      return new Promise((resolve) => { finishSend = resolve; });
    }
    return original(url, options);
  });
  const oldRefresh = jest.fn();
  const newRefresh = jest.fn();
  const { rerender } = render(<RespondReminderModal requestId={REQUEST_ID} candidate={candidate} onClose={jest.fn()} onSent={oldRefresh} />);
  await screen.findByText('Email preview');
  fireEvent.click(screen.getByRole('button', { name: 'Send reminder' }));
  rerender(<RespondReminderModal requestId={REQUEST_ID} candidate={candidate} onClose={jest.fn()} onSent={newRefresh} />);
  await act(async () => { finishSend(response({ ok: true })); });
  expect(oldRefresh).not.toHaveBeenCalled();
  expect(newRefresh).toHaveBeenCalledTimes(1);
});

test('a departed request cannot install its late preview in the next request', async () => {
  let resolveOld;
  global.fetch = jest.fn((url, options) => {
    if (url.startsWith('/api/review-manager/reminder-email-preferences?')) return Promise.resolve(response({ ok: true, ownSystemId: SENDER_ID }));
    const payload = JSON.parse(options.body);
    if (payload.requestId === REQUEST_ID) return new Promise((resolve) => { resolveOld = resolve; });
    return Promise.resolve(response({ ok: true, draft: { ...draft, subject: 'New request subject', template: { ...template, subject: 'New request subject' } } }));
  });
  const { rerender } = render(<RespondReminderModal requestId={REQUEST_ID} candidate={candidate} onClose={jest.fn()} />);
  rerender(<RespondReminderModal requestId="44444444-4444-4444-8444-444444444444" candidate={candidate} onClose={jest.fn()} />);
  expect(await screen.findByDisplayValue('New request subject')).toBeInTheDocument();
  await act(async () => { resolveOld(response({ ok: true, draft })); });
  expect(screen.getByDisplayValue('New request subject')).toBeInTheDocument();
  expect(screen.queryByDisplayValue('Original subject')).not.toBeInTheDocument();
});
