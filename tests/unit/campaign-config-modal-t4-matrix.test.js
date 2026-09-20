/**
 * @jest-environment jsdom
 *
 * CampaignConfigModal — T4 client-request-layer matrix (Stage 4). Pins
 * request bytes and body-parse-failure behavior for the file's 3 fetch
 * sites ahead of migrating onto shared/utils/api-request.js:
 *   - defaults GET  /api/review-manager/campaign-timeline-defaults (best-
 *     effort: any failure — non-2xx or a thrown fetch — is swallowed, never
 *     surfaced as the modal's error)
 *   - config GET    /api/review-manager/campaign-config
 *   - save POST     /api/review-manager/campaign-config
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CampaignConfigModal from '../../shared/components/reviewers/CampaignConfigModal';

const REQUEST_ID = 'req-1';

afterEach(() => { if (global.fetch && global.fetch.mockRestore) global.fetch.mockRestore(); });

function mkFetch({ defaults, config, save }) {
  return jest.spyOn(global, 'fetch').mockImplementation((url, opts) => {
    const u = String(url);
    if (u.includes('campaign-timeline-defaults')) {
      return Promise.resolve((defaults || (() => ({ ok: true, status: 200, json: async () => ({ timeline: {} }) })))());
    }
    if (u.includes('campaign-config') && (!opts || opts.method === undefined || opts.method === 'GET')) {
      return Promise.resolve((config || (() => ({ ok: true, status: 200, json: async () => ({ config: {} }) })))());
    }
    return Promise.resolve((save || (() => ({ ok: true, status: 200, json: async () => ({ success: true }) })))(opts));
  });
}

test('defaults GET: a thrown fetch is swallowed and never surfaces as the modal error', async () => {
  mkFetch({
    defaults: () => Promise.reject(new Error('defaults down')),
    config: () => ({ ok: true, status: 200, json: async () => ({ config: { respondOffsetDays: 5, reviewDueDate: '2026-08-01', desiredCount: 4 } }) }),
  });
  render(<CampaignConfigModal requestId={REQUEST_ID} onClose={jest.fn()} />);
  await waitFor(() => expect(screen.getByDisplayValue('4')).toBeInTheDocument());
  expect(screen.queryByText(/defaults down/)).not.toBeInTheDocument();
});

test('defaults GET: a non-2xx response is swallowed (no defaults applied), no error shown', async () => {
  mkFetch({
    defaults: () => ({ ok: false, status: 500, json: async () => ({ error: 'nope' }) }),
    config: () => ({ ok: true, status: 200, json: async () => ({ config: {} }) }),
  });
  render(<CampaignConfigModal requestId={REQUEST_ID} onClose={jest.fn()} />);
  await waitFor(() => expect(screen.queryByText(/Loading/)).not.toBeInTheDocument());
  expect(screen.queryByText(/nope/)).not.toBeInTheDocument();
});

test('config GET: non-2xx unparseable body falls back to the status-embedded message', async () => {
  mkFetch({
    config: () => ({ ok: false, status: 502, json: async () => { throw new Error('bad'); } }),
  });
  render(<CampaignConfigModal requestId={REQUEST_ID} onClose={jest.fn()} />);
  expect(await screen.findByText('Failed to load (502)')).toBeInTheDocument();
});

test('config GET: network rejection surfaces e.message', async () => {
  mkFetch({ config: () => Promise.reject(new Error('offline')) });
  render(<CampaignConfigModal requestId={REQUEST_ID} onClose={jest.fn()} />);
  expect(await screen.findByText('offline')).toBeInTheDocument();
});

test('save POST: exact body bytes/headers; non-2xx unparseable body falls back to the status-embedded message', async () => {
  let sentOpts = null;
  mkFetch({
    config: () => ({ ok: true, status: 200, json: async () => ({ config: { respondOffsetDays: 5, reviewDueDate: '2026-08-01', desiredCount: 4 } }) }),
    save: (opts) => { sentOpts = opts; return { ok: false, status: 502, json: async () => { throw new Error('bad'); } }; },
  });
  render(<CampaignConfigModal requestId={REQUEST_ID} onClose={jest.fn()} />);
  await waitFor(() => expect(screen.getByDisplayValue('4')).toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
  expect(await screen.findByText('Failed to save (502)')).toBeInTheDocument();
  expect(sentOpts.method).toBe('POST');
  expect(sentOpts.headers).toEqual({ 'Content-Type': 'application/json' });
  expect(JSON.parse(sentOpts.body)).toEqual({
    requestId: REQUEST_ID,
    config: { respondOffsetDays: 5, reviewDueDate: '2026-08-01', desiredCount: 4 },
  });
});

test('save POST: network rejection surfaces e.message and re-enables the button', async () => {
  mkFetch({
    config: () => ({ ok: true, status: 200, json: async () => ({ config: { respondOffsetDays: 5, reviewDueDate: '2026-08-01', desiredCount: 4 } }) }),
    save: () => Promise.reject(new Error('save offline')),
  });
  render(<CampaignConfigModal requestId={REQUEST_ID} onClose={jest.fn()} />);
  await waitFor(() => expect(screen.getByDisplayValue('4')).toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
  expect(await screen.findByText('save offline')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /^save$/i })).not.toBeDisabled();
});
