/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

jest.mock('next/router', () => ({ useRouter: () => ({ query: { token: 'jwt' } }) }));
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
  await screen.findByText('The staged file could not be saved. It remains available with Retry, or choose a different file.');
  expect(JSON.parse(window.sessionStorage.getItem(STORAGE_KEY))).toEqual({ stagingId: STAGING_ID, slot: 'presentation_pdf' });
});

test('(d)/(e) finalize: a malformed non-2xx body is tolerated to {} and falls back to the generic save-failed message', async () => {
  global.fetch = jest.fn(async (url) => {
    if (url.endsWith('/context')) return response(200, context);
    if (url.endsWith('/upload-token')) return response(200, { ok: true, stagingId: STAGING_ID, pathname: 'private/path', clientToken: 'client', contentType: 'application/pdf' });
    if (url.endsWith('/finalize')) return { ok: false, status: 502, json: async () => { throw new SyntaxError('bad json'); } };
    throw new Error(`unexpected fetch ${url}`);
  });
  render(<MaterialsContributorPage />);
  const input = await screen.findByLabelText('Presentation file');
  fireEvent.change(input, { target: { files: [new File(['%PDF'], 'deck.pdf', { type: 'application/pdf' })] } });
  await screen.findByText('The file could not be saved.');
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
