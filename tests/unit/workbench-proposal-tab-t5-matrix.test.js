/**
 * @jest-environment jsdom
 *
 * ProposalTab — T5 gap-fill (Stage 5a). tests/unit/workbench-proposal-tab-
 * documents.test.js and -primer-export.test.js already pin 2xx success,
 * malformed-success-flag, and request-shape for this file's 2 fetch sites
 * (proposal-documents GET, field-primer/generate POST). Old code
 * interpolated the HTTP status into both fallback messages (Stage 5a review
 * finding 1); both sites now use requestEnvelope with an explicit
 * `body.error || `... (${status})`` throw. This file adds network rejection
 * and axis (e)/status-suffix coverage.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import ProposalTab from '../../shared/components/workbench/ProposalTab';

const REQUEST_ID = '54e2b88b-04b9-f011-bbd3-6045bd02b4cc';
const context = { requestId: REQUEST_ID, proposalInfo: { coPIs: [] }, aiContent: {} };
const unparseable = () => Promise.reject(new SyntaxError('Unexpected token <'));

afterEach(() => jest.restoreAllMocks());

test('proposal-documents: network rejection is never silent', async () => {
  global.fetch = jest.fn().mockRejectedValue(new Error('offline'));
  render(<ProposalTab requestId={REQUEST_ID} context={null} />);
  expect(await screen.findByText((_c, node) => node?.textContent === 'Couldn’t load documents: offline')).toBeInTheDocument();
});

test('proposal-documents axis (e): non-2xx unparseable body falls to the fallback text with status suffix, never silent', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 502, json: unparseable });
  render(<ProposalTab requestId={REQUEST_ID} context={null} />);
  expect(await screen.findByText((_c, node) => node?.textContent === 'Couldn’t load documents: Failed to load documents (502)')).toBeInTheDocument();
});

test('proposal-documents: non-2xx empty body ({}) falls to the fallback text with status suffix (finding 1 parity)', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
  render(<ProposalTab requestId={REQUEST_ID} context={null} />);
  expect(await screen.findByText((_c, node) => node?.textContent === 'Couldn’t load documents: Failed to load documents (500)')).toBeInTheDocument();
});

test('field-primer/generate: network rejection is never silent', async () => {
  global.fetch = jest.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true, aiMaterials: [], reviewerMaterials: [], slots: [] }) })
    .mockRejectedValue(new Error('offline'));
  render(<ProposalTab context={context} />);
  const button = await screen.findByRole('button', { name: /Generate Field Primer/i });
  fireEvent.click(button);
  expect(await screen.findByText('offline')).toBeInTheDocument();
});

test('field-primer/generate axis (e): non-2xx unparseable body falls to the fallback text with status suffix, never silent', async () => {
  global.fetch = jest.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true, aiMaterials: [], reviewerMaterials: [], slots: [] }) })
    .mockResolvedValue({ ok: false, status: 502, json: unparseable });
  render(<ProposalTab context={context} />);
  const button = await screen.findByRole('button', { name: /Generate Field Primer/i });
  fireEvent.click(button);
  expect(await screen.findByText('Generation failed (502)')).toBeInTheDocument();
});

test('field-primer/generate: non-2xx empty body ({}) falls to the fallback text with status suffix (finding 1 parity)', async () => {
  global.fetch = jest.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true, aiMaterials: [], reviewerMaterials: [], slots: [] }) })
    .mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
  render(<ProposalTab context={context} />);
  const button = await screen.findByRole('button', { name: /Generate Field Primer/i });
  fireEvent.click(button);
  expect(await screen.findByText('Generation failed (500)')).toBeInTheDocument();
});
