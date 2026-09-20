/**
 * @jest-environment jsdom
 *
 * ProposalTab — T5 gap-fill (Stage 5a). tests/unit/workbench-proposal-tab-
 * documents.test.js and -primer-export.test.js already pin 2xx success,
 * malformed-success-flag, and request-shape for this file's 2 fetch sites
 * (proposal-documents GET, field-primer/generate POST), both bare-`.json()
 * .catch(() => ({}))` migrated to requestJson with a static fallback
 * message (no existing test pins the prior status-interpolated text). This
 * file adds network rejection and axis (e) coverage.
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

test('proposal-documents axis (e): non-2xx unparseable body falls to the fallback text, never silent', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 502, json: unparseable });
  render(<ProposalTab requestId={REQUEST_ID} context={null} />);
  expect(await screen.findByText((_c, node) => node?.textContent === 'Couldn’t load documents: Failed to load documents')).toBeInTheDocument();
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

test('field-primer/generate axis (e): non-2xx unparseable body falls to the fallback text, never silent', async () => {
  global.fetch = jest.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true, aiMaterials: [], reviewerMaterials: [], slots: [] }) })
    .mockResolvedValue({ ok: false, status: 502, json: unparseable });
  render(<ProposalTab context={context} />);
  const button = await screen.findByRole('button', { name: /Generate Field Primer/i });
  fireEvent.click(button);
  expect(await screen.findByText('Generation failed')).toBeInTheDocument();
});
