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
  maxMb: 100,
  checklist: [{ key: 'presentation_pdf', label: 'Presentation', required: true, received: null }],
  other: [],
};

function response(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
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
  fireEvent.click(retry);

  await waitFor(() => expect(window.sessionStorage.getItem(STORAGE_KEY)).toBeNull());
  const finalizeCalls = global.fetch.mock.calls.filter(([url]) => url.endsWith('/finalize'));
  expect(finalizeCalls).toHaveLength(2);
  for (const [, options] of finalizeCalls) {
    expect(JSON.parse(options.body)).toEqual({ stagingId: STAGING_ID, slot: 'presentation_pdf' });
  }
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

test('a pending upload shows both Retry and Choose a different file; choosing a different file clears the pending key synchronously and never resurrects it if the new upload fails to start', async () => {
  let tokenCalls = 0;
  global.fetch = jest.fn(async (url, options) => {
    if (url.endsWith('/context')) return response(200, context);
    if (url.endsWith('/upload-token')) {
      tokenCalls += 1;
      // The first upload-token mints normally; the second (for the different
      // file) fails to start, so nothing should ever write a new pending key.
      if (tokenCalls === 1) return response(200, { ok: true, stagingId: STAGING_ID, pathname: 'private/path', clientToken: 'client', contentType: 'application/pdf' });
      return response(500, { ok: false, reason: 'server_error' });
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

  fireEvent.change(differentFileInput, { target: { files: [new File(['%PDF'], 'other.pdf', { type: 'application/pdf' })] } });
  // chooseDifferentFile clears the pending key synchronously (before any
  // await), independent of whether the subsequent upload-token call
  // succeeds. A mutant that drops the removePendingUpload call would leave
  // the first staging id here.
  expect(window.sessionStorage.getItem(STORAGE_KEY)).toBeNull();

  await waitFor(() => expect(tokenCalls).toBe(2));
  // The failed upload-token call must not resurrect the pending key, and the
  // slot falls back to the plain "Choose file" picker rather than staying on
  // Retry / "Choose a different file" with stale pending state.
  expect(window.sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  await screen.findByLabelText('Presentation file');
  expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  expect(screen.queryByLabelText('Presentation different file')).toBeNull();

  const finalizeBodies = global.fetch.mock.calls.filter(([url]) => url.endsWith('/finalize')).map(([, options]) => JSON.parse(options.body));
  expect(finalizeBodies).toEqual([{ stagingId: STAGING_ID, slot: 'presentation_pdf' }]);
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
