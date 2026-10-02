/** @jest-environment jsdom */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

let mockRouterToken = 'jwt';
jest.mock('next/router', () => ({ useRouter: () => ({ query: { token: mockRouterToken } }) }));
jest.mock('@vercel/blob/client', () => ({ put: jest.fn(async () => undefined) }));

import { put } from '@vercel/blob/client';
import MaterialsContributorPage from '../../pages/external/materials/[token]';

const STAGING_ID = '22222222-2222-4222-8222-222222222222';
const STORAGE_KEY = 'site-visit-materials:pending:jwt:presentation_pdf';
const realFetch = global.fetch;
const context = {
  ok: true,
  institution: 'Caltech',
  proposalTitle: 'Neural dust',
  dueAt: '2026-12-04T23:59:00Z',
  closesAt: '2026-12-08T17:00:00Z',
  closed: false,
  maxMb: 500,
  programCoordinator: { name: 'Casey Coordinator', email: 'casey@wmkeck.org' },
  checklist: [{ key: 'presentation_pdf', label: 'Presentation', required: true, received: null }],
  other: [],
};

function response(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function fileWithSize(size, name = 'deck.pdf') {
  const file = new File(['%PDF'], name, { type: 'application/pdf' });
  Object.defineProperty(file, 'size', { configurable: true, value: size });
  return file;
}

beforeEach(() => {
  jest.clearAllMocks();
  window.sessionStorage.clear();
  mockRouterToken = 'jwt';
});

afterEach(() => {
  global.fetch = realFetch;
});

test('a transient finalize failure keeps the same staging id and Retry re-posts it without another Blob PUT', async () => {
  let finalizeCount = 0;
  global.fetch = jest.fn(async (url) => {
    if (url.endsWith('/context')) return response(200, context);
    if (url.endsWith('/upload-token')) return response(200, { ok: true, stagingId: STAGING_ID, pathname: 'private/path', clientToken: 'client', contentType: 'application/pdf' });
    if (url.endsWith('/finalize')) {
      finalizeCount += 1;
      return finalizeCount === 1
        ? response(409, { ok: false, reason: 'slot_busy' })
        : response(200, { ok: true, slot: 'presentation_pdf', filename: 'saved.pdf' });
    }
    throw new Error(`unexpected fetch ${url}`);
  });

  render(<MaterialsContributorPage />);
  const input = await screen.findByLabelText('Presentation file');
  fireEvent.change(input, { target: { files: [new File(['%PDF'], 'deck.pdf', { type: 'application/pdf' })] } });

  const retry = await screen.findByRole('button', { name: 'Retry' });
  expect(JSON.parse(window.sessionStorage.getItem(STORAGE_KEY))).toEqual({ stagingId: STAGING_ID, slot: 'presentation_pdf' });
  expect(put).toHaveBeenCalledTimes(1);
  expect(put.mock.calls[0][2]).toMatchObject({ multipart: false });
  fireEvent.click(retry);

  await waitFor(() => expect(window.sessionStorage.getItem(STORAGE_KEY)).toBeNull());
  const finalizeCalls = global.fetch.mock.calls.filter(([url]) => url.endsWith('/finalize'));
  expect(finalizeCalls).toHaveLength(2);
  for (const [, options] of finalizeCalls) {
    expect(JSON.parse(options.body)).toEqual({ stagingId: STAGING_ID, slot: 'presentation_pdf' });
  }
  expect(put).toHaveBeenCalledTimes(1);
});

test('an upload that finishes after unmount is stored for retry without starting finalize', async () => {
  let finishPut;
  put.mockImplementationOnce(() => new Promise((resolve) => { finishPut = resolve; }));
  global.fetch = jest.fn(async (url) => {
    if (url.endsWith('/context')) return response(200, context);
    if (url.endsWith('/upload-token')) return response(200, { ok: true, stagingId: STAGING_ID, pathname: 'private/path', clientToken: 'client', contentType: 'application/pdf' });
    throw new Error(`unexpected fetch ${url}`);
  });

  const { unmount } = render(<MaterialsContributorPage />);
  fireEvent.change(await screen.findByLabelText('Presentation file'), {
    target: { files: [new File(['%PDF'], 'deck.pdf', { type: 'application/pdf' })] },
  });
  await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
  unmount();

  await act(async () => { finishPut(); });
  expect(JSON.parse(window.sessionStorage.getItem(STORAGE_KEY))).toEqual({ stagingId: STAGING_ID, slot: 'presentation_pdf' });
  expect(global.fetch.mock.calls.some(([url]) => url.endsWith('/finalize'))).toBe(false);
});

test('a token change remount keeps an in-flight upload under its original pending key', async () => {
  let finishPut;
  put.mockImplementationOnce(() => new Promise((resolve) => { finishPut = resolve; }));
  global.fetch = jest.fn(async (url) => {
    if (url.endsWith('/context')) return response(200, context);
    if (url.endsWith('/upload-token')) return response(200, { ok: true, stagingId: STAGING_ID, pathname: 'private/path', clientToken: 'client', contentType: 'application/pdf' });
    throw new Error(`unexpected fetch ${url}`);
  });

  const { rerender } = render(<MaterialsContributorPage />);
  fireEvent.change(await screen.findByLabelText('Presentation file'), {
    target: { files: [new File(['%PDF'], 'deck.pdf', { type: 'application/pdf' })] },
  });
  await waitFor(() => expect(put).toHaveBeenCalledTimes(1));

  mockRouterToken = 'new-jwt';
  rerender(<MaterialsContributorPage />);
  await screen.findByLabelText('Presentation file');
  await act(async () => { finishPut(); });

  expect(JSON.parse(window.sessionStorage.getItem(STORAGE_KEY))).toEqual({ stagingId: STAGING_ID, slot: 'presentation_pdf' });
  expect(window.sessionStorage.getItem('site-visit-materials:pending:new-jwt:presentation_pdf')).toBeNull();
  expect(global.fetch.mock.calls.some(([url]) => url.endsWith('/finalize'))).toBe(false);
});

test.each([
  ['scan_timeout', 'The security scan did not finish in time'],
  ['scan_busy', 'The security scanner is busy right now'],
  ['scan_unavailable', 'The security scanner is temporarily unavailable'],
  ['scan_misconfigured', 'The system could not start the security scan'],
])('the %s message explains the failure and keeps the staged upload retryable', async (reason, message) => {
  global.fetch = jest.fn(async (url) => {
    if (url.endsWith('/context')) return response(200, context);
    if (url.endsWith('/upload-token')) return response(200, { ok: true, stagingId: STAGING_ID, pathname: 'private/path', clientToken: 'client', contentType: 'application/pdf' });
    if (url.endsWith('/finalize')) return response(reason === 'scan_misconfigured' ? 500 : 503, { ok: false, reason });
    throw new Error(`unexpected fetch ${url}`);
  });

  render(<MaterialsContributorPage />);
  const input = await screen.findByLabelText('Presentation file');
  fireEvent.change(input, { target: { files: [new File(['%PDF'], 'deck.pdf', { type: 'application/pdf' })] } });

  expect(await screen.findByRole('alert')).toHaveTextContent(message);
  expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  expect(JSON.parse(window.sessionStorage.getItem(STORAGE_KEY))).toEqual({ stagingId: STAGING_ID, slot: 'presentation_pdf' });
  expect(put).toHaveBeenCalledTimes(1);
});

test('reload restores a pending finalize from session storage and retries without minting a new upload', async () => {
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ stagingId: STAGING_ID, slot: 'presentation_pdf' }));
  global.fetch = jest.fn(async (url) => {
    if (url.endsWith('/context')) return response(200, context);
    if (url.endsWith('/finalize')) return response(200, { ok: true, slot: 'presentation_pdf', filename: 'saved.pdf' });
    throw new Error(`unexpected fetch ${url}`);
  });

  render(<MaterialsContributorPage />);
  fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));

  await waitFor(() => expect(window.sessionStorage.getItem(STORAGE_KEY)).toBeNull());
  expect(global.fetch.mock.calls.some(([url]) => url.endsWith('/upload-token'))).toBe(false);
  expect(put).not.toHaveBeenCalled();
});

test('the upload page no longer says the link stays open past the meeting', async () => {
  global.fetch = jest.fn(async (url) => {
    if (url.endsWith('/context')) return response(200, context);
    throw new Error(`unexpected fetch ${url}`);
  });
  render(<MaterialsContributorPage />);
  await screen.findByText(/Please upload the items below by/);
  expect(screen.queryByText(/replace a file at any time/i)).toBeNull();
  expect(screen.queryByText(/stays open until/i)).toBeNull();
});

test('a pending upload remains retryable when mint rejects a replacement under a newer lower cap', async () => {
  let tokenCalls = 0;
  global.fetch = jest.fn(async (url, options) => {
    if (url.endsWith('/context')) return response(200, context);
    if (url.endsWith('/upload-token')) {
      tokenCalls += 1;
      // The first upload-token mints normally; the second reports that the
      // context cap was stale and the replacement exceeds the current cap.
      if (tokenCalls === 1) return response(200, { ok: true, stagingId: STAGING_ID, pathname: 'private/path', clientToken: 'client', contentType: 'application/pdf' });
      return response(400, { ok: false, reason: 'file_too_large', maxMb: 50 });
    }
    if (url.endsWith('/finalize')) {
      // The only file that ever reaches finalize is the first one, and it
      // always fails so the slot stays pending.
      return response(409, { ok: false, reason: 'slot_busy' });
    }
    throw new Error(`unexpected fetch ${url}`);
  });

  render(<MaterialsContributorPage />);
  const input = await screen.findByLabelText('Presentation file');
  fireEvent.change(input, { target: { files: [new File(['%PDF'], 'deck.pdf', { type: 'application/pdf' })] } });

  await screen.findByRole('button', { name: 'Retry' });
  const differentFileInput = await screen.findByLabelText('Presentation different file');
  expect(JSON.parse(window.sessionStorage.getItem(STORAGE_KEY))).toEqual({ stagingId: STAGING_ID, slot: 'presentation_pdf' });

  fireEvent.change(differentFileInput, { target: { files: [fileWithSize(75 * 1024 * 1024, 'other.pdf')] } });

  await waitFor(() => expect(tokenCalls).toBe(2));
  expect(JSON.parse(window.sessionStorage.getItem(STORAGE_KEY))).toEqual({ stagingId: STAGING_ID, slot: 'presentation_pdf' });
  expect(await screen.findByRole('alert')).toHaveTextContent('78,643,200 bytes');
  expect(screen.getByRole('alert')).toHaveTextContent('current upload limit is 50 MB');
  expect(screen.getByRole('alert')).toHaveTextContent('Your earlier upload is still available');
  expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  expect(screen.getByText('Up to 50 MB.')).toBeInTheDocument();
  expect(screen.getByLabelText('Presentation different file')).toBeInTheDocument();
  expect(put).toHaveBeenCalledTimes(1);

  const finalizeBodies = global.fetch.mock.calls.filter(([url]) => url.endsWith('/finalize')).map(([, options]) => JSON.parse(options.body));
  expect(finalizeBodies).toEqual([{ stagingId: STAGING_ID, slot: 'presentation_pdf' }]);
});

test('client preflight accepts the exact cap and enables multipart upload for large files', async () => {
  global.fetch = jest.fn(async (url) => {
    if (url.endsWith('/context')) return response(200, context);
    if (url.endsWith('/upload-token')) return response(200, { ok: true, stagingId: STAGING_ID, pathname: 'private/path', clientToken: 'client', contentType: 'application/pdf' });
    if (url.endsWith('/finalize')) return response(200, { ok: true, slot: 'presentation_pdf', filename: 'deck.pdf' });
    throw new Error(`unexpected fetch ${url}`);
  });

  render(<MaterialsContributorPage />);
  const input = await screen.findByLabelText('Presentation file');
  fireEvent.change(input, { target: { files: [fileWithSize(500 * 1024 * 1024)] } });

  await waitFor(() => expect(global.fetch.mock.calls.some(([url]) => url.endsWith('/finalize'))).toBe(true));
  expect(put).toHaveBeenCalledWith('private/path', expect.any(File), expect.objectContaining({ multipart: true }));
});

test('preflight rejects one byte over cap without a request and links the assigned coordinator', async () => {
  global.fetch = jest.fn(async (url) => {
    if (url.endsWith('/context')) return response(200, context);
    throw new Error(`unexpected fetch ${url}`);
  });

  render(<MaterialsContributorPage />);
  const input = await screen.findByLabelText('Presentation file');
  fireEvent.change(input, { target: { files: [fileWithSize(500 * 1024 * 1024 + 1)] } });

  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('524,288,001 bytes');
  expect(alert).toHaveTextContent('current upload limit is 500 MB');
  expect(alert).toHaveTextContent('Please reduce the file size');
  expect(alert).toHaveTextContent('Casey Coordinator');
  expect(screen.getByRole('link', { name: 'casey@wmkeck.org' })).toHaveAttribute('href', 'mailto:casey%40wmkeck.org');
  expect(global.fetch.mock.calls.some(([url]) => url.endsWith('/upload-token'))).toBe(false);
  expect(put).not.toHaveBeenCalled();
});

test('oversize preflight preserves an earlier staged upload for Retry', async () => {
  global.fetch = jest.fn(async (url) => {
    if (url.endsWith('/context')) return response(200, context);
    if (url.endsWith('/upload-token')) return response(200, { ok: true, stagingId: STAGING_ID, pathname: 'private/path', clientToken: 'client', contentType: 'application/pdf' });
    if (url.endsWith('/finalize')) return response(409, { ok: false, reason: 'slot_busy' });
    throw new Error(`unexpected fetch ${url}`);
  });

  render(<MaterialsContributorPage />);
  fireEvent.change(await screen.findByLabelText('Presentation file'), { target: { files: [new File(['%PDF'], 'first.pdf', { type: 'application/pdf' })] } });
  await screen.findByRole('button', { name: 'Retry' });
  fireEvent.change(screen.getByLabelText('Presentation different file'), { target: { files: [fileWithSize(500 * 1024 * 1024 + 1, 'too-large.pdf')] } });

  expect(await screen.findByRole('alert')).toHaveTextContent('Your earlier upload is still available');
  expect(JSON.parse(window.sessionStorage.getItem(STORAGE_KEY))).toEqual({ stagingId: STAGING_ID, slot: 'presentation_pdf' });
  expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  expect(global.fetch.mock.calls.filter(([url]) => url.endsWith('/upload-token'))).toHaveLength(1);
});

test('a failed replacement Blob transfer keeps the earlier staging id and hides SDK error text', async () => {
  let uploadTokenCalls = 0;
  global.fetch = jest.fn(async (url) => {
    if (url.endsWith('/context')) return response(200, context);
    if (url.endsWith('/upload-token')) {
      uploadTokenCalls += 1;
      return response(200, { ok: true, stagingId: uploadTokenCalls === 1 ? STAGING_ID : '33333333-3333-4333-8333-333333333333', pathname: 'private/path', clientToken: 'client', contentType: 'application/pdf' });
    }
    if (url.endsWith('/finalize')) return response(409, { ok: false, reason: 'slot_busy' });
    throw new Error(`unexpected fetch ${url}`);
  });
  put.mockImplementationOnce(async () => undefined).mockRejectedValueOnce(new Error('Vercel Blob: Client token has expired.'));

  render(<MaterialsContributorPage />);
  fireEvent.change(await screen.findByLabelText('Presentation file'), { target: { files: [new File(['%PDF'], 'first.pdf', { type: 'application/pdf' })] } });
  await screen.findByRole('button', { name: 'Retry' });
  fireEvent.change(screen.getByLabelText('Presentation different file'), { target: { files: [new File(['%PDF'], 'replacement.pdf', { type: 'application/pdf' })] } });

  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('upload link expired');
  expect(alert).toHaveTextContent('choose the file again');
  expect(alert).toHaveTextContent('Your earlier upload remains available with Retry');
  expect(alert).not.toHaveTextContent('Vercel Blob');
  expect(JSON.parse(window.sessionStorage.getItem(STORAGE_KEY))).toEqual({ stagingId: STAGING_ID, slot: 'presentation_pdf' });
  expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
});

test('a successful replacement transfer replaces the earlier staging id for Retry', async () => {
  const replacementId = '33333333-3333-4333-8333-333333333333';
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ stagingId: STAGING_ID, slot: 'presentation_pdf' }));
  global.fetch = jest.fn(async (url) => {
    if (url.endsWith('/context')) return response(200, context);
    if (url.endsWith('/upload-token')) return response(200, { ok: true, stagingId: replacementId, pathname: 'private/replacement', clientToken: 'client', contentType: 'application/pdf' });
    if (url.endsWith('/finalize')) return response(409, { ok: false, reason: 'slot_busy' });
    throw new Error(`unexpected fetch ${url}`);
  });
  render(<MaterialsContributorPage />);
  fireEvent.change(await screen.findByLabelText('Presentation different file'), { target: { files: [new File(['%PDF'], 'replacement.pdf', { type: 'application/pdf' })] } });
  await waitFor(() => expect(JSON.parse(window.sessionStorage.getItem(STORAGE_KEY))).toEqual({ stagingId: replacementId, slot: 'presentation_pdf' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Retry' })).not.toBeDisabled());
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await waitFor(() => expect(global.fetch.mock.calls.filter(([url]) => url.endsWith('/finalize'))).toHaveLength(2));
  for (const [, options] of global.fetch.mock.calls.filter(([url]) => url.endsWith('/finalize'))) {
    expect(JSON.parse(options.body).stagingId).toBe(replacementId);
  }
  expect(put).toHaveBeenCalledTimes(1);
});

test('the support-email footer renders only when the context includes supportEmail', async () => {
  global.fetch = jest.fn(async (url) => {
    if (url.endsWith('/context')) return response(200, context);
    throw new Error(`unexpected fetch ${url}`);
  });
  render(<MaterialsContributorPage />);
  await screen.findByText(/Please upload the items below by/);
  expect(screen.queryByText(/Need help\?/)).toBeNull();
});

// T5 matrix for the two context-GET sites (`load` and the mount effect —
// migrated separately, both function-form) and the finalize/upload-token
// POST sites.
test('(a)/(c)/(d)/(e) context: a network rejection shows the fail-closed default message', async () => {
  global.fetch = jest.fn(async () => { throw new Error('network down'); });
  render(<MaterialsContributorPage />);
  await screen.findByText(/Something went wrong on our end/);
});

test('(e) context: a malformed 2xx body shows the fail-closed default message (today\'s function-form `.catch`)', async () => {
  global.fetch = jest.fn(async (url) => {
    if (url.endsWith('/context')) return { ok: true, status: 200, json: async () => { throw new SyntaxError('bad json'); } };
    throw new Error(`unexpected fetch ${url}`);
  });
  render(<MaterialsContributorPage />);
  await screen.findByText(/Something went wrong on our end/);
});

test('(e) context: a non-2xx unparseable body (502 gateway page) also shows the fail-closed default message', async () => {
  global.fetch = jest.fn(async (url) => {
    if (url.endsWith('/context')) return { ok: false, status: 502, json: async () => { throw new SyntaxError('bad json'); } };
    throw new Error(`unexpected fetch ${url}`);
  });
  render(<MaterialsContributorPage />);
  await screen.findByText(/Something went wrong on our end/);
});

test('(b) context: a 2xx body with ok:false shows the mapped reason message (body-level flag, not status)', async () => {
  global.fetch = jest.fn(async (url) => {
    if (url.endsWith('/context')) return response(200, { ok: false, reason: 'closed' });
    throw new Error(`unexpected fetch ${url}`);
  });
  render(<MaterialsContributorPage />);
  await screen.findByText(/This collection has closed/);
});

test('(c) upload-token: a network rejection surfaces the generic save-failure copy', async () => {
  global.fetch = jest.fn(async (url) => {
    if (url.endsWith('/context')) return response(200, context);
    if (url.endsWith('/upload-token')) throw new Error('network down');
    throw new Error(`unexpected fetch ${url}`);
  });
  render(<MaterialsContributorPage />);
  const input = await screen.findByLabelText('Presentation file');
  fireEvent.change(input, { target: { files: [new File(['%PDF'], 'deck.pdf', { type: 'application/pdf' })] } });
  await screen.findByText('network down');
});

test('(d)/(e) upload-token: a malformed non-2xx body is tolerated to {} and falls back to "could not start"', async () => {
  global.fetch = jest.fn(async (url) => {
    if (url.endsWith('/context')) return response(200, context);
    if (url.endsWith('/upload-token')) return { ok: false, status: 502, json: async () => { throw new SyntaxError('bad json'); } };
    throw new Error(`unexpected fetch ${url}`);
  });
  render(<MaterialsContributorPage />);
  const input = await screen.findByLabelText('Presentation file');
  fireEvent.change(input, { target: { files: [new File(['%PDF'], 'deck.pdf', { type: 'application/pdf' })] } });
  await screen.findByText('The upload could not start.');
});

test('(c) finalize: a network rejection preserves the staging id for retry', async () => {
  global.fetch = jest.fn(async (url) => {
    if (url.endsWith('/context')) return response(200, context);
    if (url.endsWith('/upload-token')) return response(200, { ok: true, stagingId: STAGING_ID, pathname: 'private/path', clientToken: 'client', contentType: 'application/pdf' });
    if (url.endsWith('/finalize')) throw new Error('network down');
    throw new Error(`unexpected fetch ${url}`);
  });
  render(<MaterialsContributorPage />);
  const input = await screen.findByLabelText('Presentation file');
  fireEvent.change(input, { target: { files: [new File(['%PDF'], 'deck.pdf', { type: 'application/pdf' })] } });
  await screen.findByText('Processing stopped before we could confirm this upload was saved. Wait a few minutes and press Retry.');
  expect(JSON.parse(window.sessionStorage.getItem(STORAGE_KEY))).toEqual({ stagingId: STAGING_ID, slot: 'presentation_pdf' });
});

test('(d)/(e) finalize: a malformed 5xx body is tolerated and explains that the save result is unconfirmed', async () => {
  global.fetch = jest.fn(async (url) => {
    if (url.endsWith('/context')) return response(200, context);
    if (url.endsWith('/upload-token')) return response(200, { ok: true, stagingId: STAGING_ID, pathname: 'private/path', clientToken: 'client', contentType: 'application/pdf' });
    if (url.endsWith('/finalize')) return { ok: false, status: 502, json: async () => { throw new SyntaxError('bad json'); } };
    throw new Error(`unexpected fetch ${url}`);
  });
  render(<MaterialsContributorPage />);
  const input = await screen.findByLabelText('Presentation file');
  fireEvent.change(input, { target: { files: [new File(['%PDF'], 'deck.pdf', { type: 'application/pdf' })] } });
  await screen.findByText('Processing stopped before we could confirm this upload was saved. Wait a few minutes and press Retry.');
});

test('a finalize 429 keeps the pending id and labels the prior receipt previously received', async () => {
  const previousContext = {
    ...context,
    checklist: [{ ...context.checklist[0], received: { filename: 'earlier.pdf', receivedAt: '2026-09-20T12:00:00Z' } }],
  };
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ stagingId: STAGING_ID, slot: 'presentation_pdf' }));
  global.fetch = jest.fn(async (url) => {
    if (url.endsWith('/context')) return response(200, previousContext);
    if (url.endsWith('/finalize')) return response(429, { ok: false, reason: 'rate_limited' });
    throw new Error(`unexpected fetch ${url}`);
  });
  render(<MaterialsContributorPage />);
  fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));

  expect(await screen.findByRole('alert')).toHaveTextContent('Too many requests');
  expect(screen.getByText(/Previously received .* earlier\.pdf/)).toBeInTheDocument();
  expect(window.sessionStorage.getItem(STORAGE_KEY)).toBe(JSON.stringify({ stagingId: STAGING_ID, slot: 'presentation_pdf' }));
});

test('processing_busy retries three times at the requested interval and leaves a manual Retry available', async () => {
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ stagingId: STAGING_ID, slot: 'presentation_pdf' }));
  let finalizeCalls = 0;
  global.fetch = jest.fn(async (url) => {
    if (url.endsWith('/context')) return response(200, context);
    if (url.endsWith('/finalize')) {
      finalizeCalls += 1;
      return response(503, { ok: false, reason: 'processing_busy', retryAfterSeconds: 10 });
    }
    throw new Error(`unexpected fetch ${url}`);
  });

  try {
    render(<MaterialsContributorPage />);
    const retry = await screen.findByRole('button', { name: 'Retry' });
    jest.useFakeTimers();
    await act(async () => {
      fireEvent.click(retry);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(finalizeCalls).toBe(1);
    expect(screen.getByRole('status')).toHaveTextContent('Waiting before retry');
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await act(async () => { await jest.advanceTimersByTimeAsync(10_000); });
    }
    expect(finalizeCalls).toBe(4);
    expect(await screen.findByRole('alert')).toHaveTextContent('Another large upload is being processed');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(window.sessionStorage.getItem(STORAGE_KEY)).toBe(JSON.stringify({ stagingId: STAGING_ID, slot: 'presentation_pdf' }));
  } finally {
    jest.useRealTimers();
  }
});

test('the support-email footer shows a mailto link to the configured address when present', async () => {
  const withSupport = { ...context, supportEmail: 'portalhelp@wmkeck.org' };
  global.fetch = jest.fn(async (url) => {
    if (url.endsWith('/context')) return response(200, withSupport);
    throw new Error(`unexpected fetch ${url}`);
  });
  render(<MaterialsContributorPage />);
  const link = await screen.findByRole('link', { name: 'portalhelp@wmkeck.org' });
  expect(link.getAttribute('href')).toMatch(/^mailto:portalhelp@wmkeck\.org\?subject=/);
  expect(decodeURIComponent(link.getAttribute('href'))).toContain('Site visit materials — Neural dust');
});

test('202 acceptance becomes durable queued status, keeps the prior receipt visible, and clears the staged retry', async () => {
  const previousContext = {
    ...context,
    checklist: [{ ...context.checklist[0], received: { filename: 'earlier.pdf', receivedAt: '2026-09-20T12:00:00Z' } }],
  };
  let contextCalls = 0;
  global.fetch = jest.fn(async (url) => {
    if (url.endsWith('/context')) {
      contextCalls += 1;
      return response(200, contextCalls === 1 ? previousContext : {
        ...previousContext,
        jobs: [{ jobId: 'job-1', stagingId: STAGING_ID, slot: 'presentation_pdf', status: 'queued', filename: 'new.pdf', createdAt: '2026-10-01T10:00:00Z' }],
      });
    }
    if (url.endsWith('/upload-token')) return response(200, { ok: true, stagingId: STAGING_ID, pathname: 'private/path', clientToken: 'client', contentType: 'application/pdf' });
    if (url.endsWith('/finalize')) return response(202, { ok: true, jobId: 'job-1', stagingId: STAGING_ID, status: 'queued' });
    throw new Error(`unexpected fetch ${url}`);
  });

  render(<MaterialsContributorPage />);
  fireEvent.change(await screen.findByLabelText('Presentation file'), { target: { files: [new File(['%PDF'], 'new.pdf', { type: 'application/pdf' })] } });

  expect(await screen.findByText('Upload received. We’re checking and saving your file. You can close this page.')).toBeInTheDocument();
  expect(screen.getByText(/Previously received .* earlier\.pdf/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Presentation file')).not.toBeInTheDocument();
  expect(window.sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  expect(contextCalls).toBe(2);
});

test('a refreshed page restores active jobs from context and polls once per page every 15 seconds', async () => {
  const withJob = {
    ...context,
    jobs: [{ jobId: 'job-1', stagingId: STAGING_ID, slot: 'presentation_pdf', status: 'processing', filename: 'new.pdf' }],
  };
  global.fetch = jest.fn(async (url) => {
    if (url.endsWith('/context')) return response(200, withJob);
    throw new Error(`unexpected fetch ${url}`);
  });

  jest.useFakeTimers();
  const { unmount } = render(<MaterialsContributorPage />);
  try {
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getByText('Upload received. We’re checking and saving your file. You can close this page.')).toBeInTheDocument();
    expect(window.sessionStorage.getItem(STORAGE_KEY)).toBeNull();
    await act(async () => { await jest.advanceTimersByTimeAsync(14_999); });
    expect(global.fetch.mock.calls.filter(([url]) => url.endsWith('/context'))).toHaveLength(1);
    await act(async () => { await jest.advanceTimersByTimeAsync(1); });
    expect(global.fetch.mock.calls.filter(([url]) => url.endsWith('/context'))).toHaveLength(2);
    expect(global.fetch.mock.calls.filter(([url]) => url.endsWith('/context'))[1][1].signal).toBeInstanceOf(AbortSignal);
  } finally {
    unmount();
    jest.useRealTimers();
  }
});

test('a context 429 backs off for 30 seconds while a job remains active', async () => {
  const withJob = {
    ...context,
    jobs: [{ jobId: 'job-1', stagingId: STAGING_ID, slot: 'presentation_pdf', status: 'queued' }],
  };
  let contextCalls = 0;
  global.fetch = jest.fn(async (url) => {
    if (url.endsWith('/context')) {
      contextCalls += 1;
      return contextCalls === 2 ? response(429, { ok: false, reason: 'rate_limited' }) : response(200, withJob);
    }
    throw new Error(`unexpected fetch ${url}`);
  });

  jest.useFakeTimers();
  const { unmount } = render(<MaterialsContributorPage />);
  try {
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getByText('Upload received. We’re checking and saving your file. You can close this page.')).toBeInTheDocument();
    await act(async () => { await jest.advanceTimersByTimeAsync(15_000); });
    expect(contextCalls).toBe(2);
    expect(screen.getByText('Upload status could not be refreshed. We’ll try again shortly.')).toBeInTheDocument();
    await act(async () => { await jest.advanceTimersByTimeAsync(29_999); });
    expect(contextCalls).toBe(2);
    await act(async () => { await jest.advanceTimersByTimeAsync(1); });
    expect(contextCalls).toBe(3);
  } finally {
    unmount();
    jest.useRealTimers();
  }
});

test('a lost 202 response keeps its staging id when context cannot yet confirm admission', async () => {
  let finalizeCalls = 0;
  let contextCalls = 0;
  const queuedContext = {
    ...context,
    jobs: [{ jobId: 'job-1', stagingId: STAGING_ID, slot: 'presentation_pdf', status: 'queued', filename: 'new.pdf' }],
  };
  global.fetch = jest.fn(async (url) => {
    if (url.endsWith('/context')) {
      contextCalls += 1;
      return response(200, contextCalls <= 2 ? context : queuedContext);
    }
    if (url.endsWith('/upload-token')) return response(200, { ok: true, stagingId: STAGING_ID, pathname: 'private/path', clientToken: 'client', contentType: 'application/pdf' });
    if (url.endsWith('/finalize')) {
      finalizeCalls += 1;
      if (finalizeCalls === 1) throw new Error('response lost after commit');
      return response(202, { ok: true, jobId: 'job-1', stagingId: STAGING_ID, status: 'queued' });
    }
    throw new Error(`unexpected fetch ${url}`);
  });

  const first = render(<MaterialsContributorPage />);
  fireEvent.change(await screen.findByLabelText('Presentation file'), { target: { files: [new File(['%PDF'], 'new.pdf', { type: 'application/pdf' })] } });
  expect(await screen.findByRole('alert')).toHaveTextContent('Processing stopped before we could confirm this upload was saved');
  expect(window.sessionStorage.getItem(STORAGE_KEY)).toBe(JSON.stringify({ stagingId: STAGING_ID, slot: 'presentation_pdf' }));
  first.unmount();

  render(<MaterialsContributorPage />);
  fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));
  expect(await screen.findByText('Upload received. We’re checking and saving your file. You can close this page.')).toBeInTheDocument();
  expect(finalizeCalls).toBe(2);
  expect(put).toHaveBeenCalledTimes(1);
  expect(window.sessionStorage.getItem(STORAGE_KEY)).toBeNull();
});

test('durable context clears a matching staged retry after a lost 202, including completed jobs', async () => {
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ stagingId: STAGING_ID, slot: 'presentation_pdf' }));
  const completed = {
    ...context,
    checklist: [{ ...context.checklist[0], received: { filename: 'saved.pdf', receivedAt: '2026-10-01T10:00:00Z' } }],
    jobs: [{ jobId: 'job-1', stagingId: STAGING_ID, slot: 'presentation_pdf', status: 'completed', filename: 'saved.pdf' }],
  };
  global.fetch = jest.fn(async (url) => {
    if (url.endsWith('/context')) return response(200, completed);
    throw new Error(`unexpected fetch ${url}`);
  });

  render(<MaterialsContributorPage />);
  expect(await screen.findByText('Your file was saved.')).toBeInTheDocument();
  await waitFor(() => expect(window.sessionStorage.getItem(STORAGE_KEY)).toBeNull());
  expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  expect(global.fetch.mock.calls.filter(([url]) => url.endsWith('/finalize'))).toHaveLength(0);
});

test('an aborted visibility poll cannot schedule a duplicate poll after the page becomes visible again', async () => {
  const priorDescriptor = Object.getOwnPropertyDescriptor(document, 'visibilityState');
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  const active = { ...context, jobs: [{ jobId: 'job-1', stagingId: STAGING_ID, slot: 'presentation_pdf', status: 'processing' }] };
  let contextCalls = 0;
  let resolveAbortedPoll;
  global.fetch = jest.fn((url) => {
    if (!url.endsWith('/context')) throw new Error(`unexpected fetch ${url}`);
    contextCalls += 1;
    if (contextCalls === 2) return new Promise((resolve) => { resolveAbortedPoll = () => resolve(response(200, active)); });
    return Promise.resolve(response(200, active));
  });

  jest.useFakeTimers();
  const view = render(<MaterialsContributorPage />);
  try {
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    await act(async () => { await jest.advanceTimersByTimeAsync(15_000); });
    expect(contextCalls).toBe(2);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); await Promise.resolve(); await Promise.resolve(); });
    expect(contextCalls).toBe(2);
    await act(async () => { resolveAbortedPoll(); await Promise.resolve(); });
    await act(async () => { await jest.advanceTimersByTimeAsync(14_999); });
    expect(contextCalls).toBe(2);
    await act(async () => { await jest.advanceTimersByTimeAsync(1); });
    expect(contextCalls).toBe(3);
    await act(async () => { await jest.advanceTimersByTimeAsync(15_000); });
    expect(contextCalls).toBe(4);
  } finally {
    view.unmount();
    jest.useRealTimers();
    if (priorDescriptor) Object.defineProperty(document, 'visibilityState', priorDescriptor);
    else delete document.visibilityState;
  }
});

test('an older same-token poll cannot overwrite a newer enqueue context', async () => {
  const priorContext = {
    ...context,
    checklist: [
      ...context.checklist,
      { key: 'participant_bios', label: 'Participant bios', required: true, received: null },
    ],
    jobs: [{ jobId: 'job-old', stagingId: 'old-stage', slot: 'participant_bios', status: 'processing' }],
  };
  const refreshedContext = {
    ...priorContext,
    jobs: [
      ...priorContext.jobs,
      { jobId: 'job-new', stagingId: STAGING_ID, slot: 'presentation_pdf', status: 'queued', filename: 'new.pdf' },
    ],
  };
  let contextCalls = 0;
  let resolveOldPoll;
  global.fetch = jest.fn((url) => {
    if (url.endsWith('/context')) {
      contextCalls += 1;
      if (contextCalls === 1) return Promise.resolve(response(200, priorContext));
      if (contextCalls === 2) return new Promise((resolve) => { resolveOldPoll = () => resolve(response(200, priorContext)); });
      return Promise.resolve(response(200, refreshedContext));
    }
    if (url.endsWith('/upload-token')) return Promise.resolve(response(200, { ok: true, stagingId: STAGING_ID, pathname: 'private/path', clientToken: 'client', contentType: 'application/pdf' }));
    if (url.endsWith('/finalize')) return Promise.resolve(response(202, { ok: true, jobId: 'job-new', stagingId: STAGING_ID, status: 'queued' }));
    throw new Error(`unexpected fetch ${url}`);
  });

  jest.useFakeTimers();
  const view = render(<MaterialsContributorPage />);
  try {
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    await act(async () => { await jest.advanceTimersByTimeAsync(15_000); });
    expect(contextCalls).toBe(2);
    fireEvent.change(screen.getByLabelText('Presentation file'), { target: { files: [new File(['%PDF'], 'new.pdf', { type: 'application/pdf' })] } });
    await waitFor(() => expect(screen.queryByLabelText('Presentation file')).not.toBeInTheDocument());
    expect(contextCalls).toBe(3);
    await act(async () => { resolveOldPoll(); await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getAllByText('Upload received. We’re checking and saving your file. You can close this page.')).toHaveLength(2);
    expect(screen.queryByLabelText('Presentation file')).not.toBeInTheDocument();
  } finally {
    view.unmount();
    jest.useRealTimers();
  }
});

test('a terminal expiry discovered during background polling closes the upload view', async () => {
  const active = { ...context, jobs: [{ jobId: 'job-1', stagingId: STAGING_ID, slot: 'presentation_pdf', status: 'processing' }] };
  let contextCalls = 0;
  global.fetch = jest.fn(async (url) => {
    if (!url.endsWith('/context')) throw new Error(`unexpected fetch ${url}`);
    contextCalls += 1;
    return contextCalls === 1 ? response(200, active) : response(401, { ok: false, reason: 'expired' });
  });
  jest.useFakeTimers();
  const view = render(<MaterialsContributorPage />);
  try {
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getByText('Upload received. We’re checking and saving your file. You can close this page.')).toBeInTheDocument();
    await act(async () => { await jest.advanceTimersByTimeAsync(15_000); });
    expect(await screen.findByText('This link has expired. Please contact the Foundation if you still need to send materials.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Presentation file')).not.toBeInTheDocument();
  } finally {
    view.unmount();
    jest.useRealTimers();
  }
});

test('late context success after token change cannot replace the new token context', async () => {
  let resolveOld;
  let jwtCalls = 0;
  global.fetch = jest.fn((url) => {
    if (url.endsWith('/context') && mockRouterToken === 'jwt') {
      jwtCalls += 1;
      if (jwtCalls === 1) return new Promise((resolve) => { resolveOld = resolve; });
      return Promise.resolve(response(200, { ...context, institution: 'Returned institution' }));
    }
    if (url.endsWith('/context')) return Promise.resolve(response(200, { ...context, institution: 'New institution' }));
    throw new Error(`unexpected fetch ${url}`);
  });
  const view = render(<MaterialsContributorPage />);
  mockRouterToken = 'new-jwt';
  view.rerender(<MaterialsContributorPage />);
  expect(await screen.findByRole('heading', { name: 'Site visit materials · New institution' })).toBeInTheDocument();
  mockRouterToken = 'jwt';
  view.rerender(<MaterialsContributorPage />);
  expect(await screen.findByRole('heading', { name: 'Site visit materials · Returned institution' })).toBeInTheDocument();
  await act(async () => { resolveOld(response(200, { ...context, institution: 'Stale institution' })); });
  expect(screen.queryByText('Site visit materials · Stale institution')).not.toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Site visit materials · Returned institution' })).toBeInTheDocument();
});
