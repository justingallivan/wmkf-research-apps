/**
 * @jest-environment jsdom
 *
 * PreSiteDistributionPanel — T5 gap-fill (Stage 5a). tests/unit/pre-site-
 * distribution-panel.test.js already pins 2xx success, non-2xx body-code
 * branches, and exact request bytes for the send site (and structural bytes
 * for prepare/reissue) across the file's 4 fetch sites:
 *   - loadHistory   GET  /api/workbench/pre-site-visit/distribution/history
 *   - prepare       POST /api/workbench/pre-site-visit/distribution/prepare
 *   - reissueBriefingLink POST /api/workbench/pre-site-visit/briefing-link
 *   - send          POST /api/workbench/pre-site-visit/distribution/send
 *
 * This file adds the missing axes: network rejection and axis (e) — a
 * non-2xx response whose body cannot be parsed — for each site, pinned
 * never-silent. All four sites already parse with `.json().catch(() => ({}))`,
 * so this is a no-op behavior change.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import PreSiteDistributionPanel from '../../shared/components/workbench/PreSiteDistributionPanel';

jest.mock('../../shared/components/Layout', () => ({
  Card: ({ children }) => <div>{children}</div>,
}));

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const ARTIFACT_ID = '22222222-2222-4222-8222-222222222222';

function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}
const unparseable = () => Promise.reject(new SyntaxError('Unexpected token <'));

function preparedAttempt() {
  return {
    operationId: '33333333-3333-4333-8333-333333333333',
    requestId: REQUEST_ID,
    previewHash: 'a'.repeat(64),
    attachmentMode: 'none',
    briefingLinkId: '12121212-1212-4212-8212-121212121212',
    to: ['staff@example.org'],
    cc: [],
    subject: 'Subject',
    bodyText: 'Body',
    state: 'prepared',
    transportAccepted: false,
    attachments: [],
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});
afterEach(() => jest.restoreAllMocks());

function renderPanel() {
  return render(
    <PreSiteDistributionPanel
      requestId={REQUEST_ID}
      requestNumber="1002379"
      sourceArtifact={{ artifactId: ARTIFACT_ID }}
    />,
  );
}

test('loadHistory: network rejection is never silent', async () => {
  global.fetch = jest.fn().mockRejectedValue(new Error('offline'));
  renderPanel();
  expect(await screen.findByText('offline')).toBeInTheDocument();
});

test('loadHistory axis (e): non-2xx unparseable body falls to the fallback message, never silent', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 502, json: unparseable });
  renderPanel();
  expect(await screen.findByText('Email history could not be loaded.')).toBeInTheDocument();
});

async function readyPanel() {
  global.fetch = jest.fn().mockResolvedValue(response({ success: true, attempts: [] }));
  renderPanel();
  await screen.findByText(/No email previews/);
  fireEvent.change(screen.getByLabelText('To'), { target: { value: 'staff@example.org' } });
}

test('prepare: network rejection is never silent', async () => {
  await readyPanel();
  global.fetch = jest.fn((url) => (
    String(url).includes('/prepare') ? Promise.reject(new Error('offline')) : Promise.resolve(response({ success: true, attempts: [] }))
  ));
  fireEvent.click(screen.getByRole('button', { name: 'Create preview' }));
  expect(await screen.findByText('offline')).toBeInTheDocument();
});

test('prepare axis (e): non-2xx unparseable body is never silent (falls to the status fallback)', async () => {
  await readyPanel();
  global.fetch = jest.fn((url) => (
    String(url).includes('/prepare') ? Promise.resolve({ ok: false, status: 502, json: unparseable }) : Promise.resolve(response({ success: true, attempts: [] }))
  ));
  fireEvent.click(screen.getByRole('button', { name: 'Create preview' }));
  expect(await screen.findByText('Preview preparation failed (502)')).toBeInTheDocument();
});

async function withPreparedPreview() {
  global.fetch = jest.fn().mockResolvedValue(response({ success: true, attempts: [] }));
  renderPanel();
  await screen.findByText(/No email previews/);
  fireEvent.change(screen.getByLabelText('To'), { target: { value: 'staff@example.org' } });
  global.fetch = jest.fn().mockResolvedValueOnce(response({ success: true, attempt: preparedAttempt() }));
  fireEvent.click(screen.getByRole('button', { name: 'Create preview' }));
  await screen.findByText('Email preview');
}

test('send: network rejection is never silent', async () => {
  await withPreparedPreview();
  global.fetch = jest.fn((url) => (
    String(url).includes('/send') ? Promise.reject(new Error('offline')) : Promise.resolve(response({ success: true, attempts: [] }))
  ));
  fireEvent.click(screen.getByLabelText(/I reviewed the recipients/));
  fireEvent.click(screen.getByRole('button', { name: 'Send email' }));
  expect(await screen.findByText('offline')).toBeInTheDocument();
});

test('send axis (e): non-2xx unparseable body is never silent (falls to the status fallback)', async () => {
  await withPreparedPreview();
  global.fetch = jest.fn((url) => (
    String(url).includes('/send') ? Promise.resolve({ ok: false, status: 502, json: unparseable }) : Promise.resolve(response({ success: true, attempts: [] }))
  ));
  fireEvent.click(screen.getByLabelText(/I reviewed the recipients/));
  fireEvent.click(screen.getByRole('button', { name: 'Send email' }));
  expect(await screen.findByText('Send failed (502)')).toBeInTheDocument();
});

async function withBriefingLink() {
  global.fetch = jest.fn().mockResolvedValueOnce(response({
    success: true, attempts: [], briefingLink: { id: 'l', url: 'https://apps.test/external/briefing/old', expiresAt: null },
  }));
  renderPanel();
  await screen.findByText('https://apps.test/external/briefing/old');
  fireEvent.click(screen.getByText('Issue new link'));
  await screen.findByText(/stops the current one immediately/);
}

test('reissueBriefingLink: network rejection is never silent', async () => {
  await withBriefingLink();
  global.fetch = jest.fn().mockRejectedValue(new Error('offline'));
  fireEvent.click(screen.getByText('Issue new link'));
  expect(await screen.findByText('offline')).toBeInTheDocument();
});

test('reissueBriefingLink axis (e): non-2xx unparseable body falls to the status fallback, never silent', async () => {
  await withBriefingLink();
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 502, json: unparseable });
  fireEvent.click(screen.getByText('Issue new link'));
  expect(await screen.findByText('The new link could not be issued (502)')).toBeInTheDocument();
});
