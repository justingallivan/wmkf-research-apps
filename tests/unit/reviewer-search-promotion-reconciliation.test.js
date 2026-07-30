/**
 * @jest-environment jsdom
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ReviewerSearchSection from '../../shared/components/reviewers/ReviewerSearchSection';
const { reviewerSaveKey } = require('../../lib/utils/reviewer-save-key');

const REQ = 'aaaaaaaa-1111-1111-1111-111111111111';
const candidate = (name, email) => ({
  name,
  email,
  emailSource: 'pubmed',
  emailPersistAllowed: true,
  identityStatus: 'probable',
  provenance: {
    kind: 'literature_retrieved',
    sources: ['pubmed'],
    seedRole: 'query_seed',
    groundingWorkIds: [],
  },
});

function response(body, ok = true, status = ok ? 200 : 422) {
  return { ok, status, json: async () => body };
}

afterEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn();
});

test('applicant-excluded collision moves the exact candidate into terminal read-only state even on 422', async () => {
  const blocked = candidate('Blocked Reviewer', 'blocked@example.edu');
  const key = reviewerSaveKey(blocked);
  global.fetch = jest.fn((url) => {
    const target = String(url);
    if (target.includes('/api/workbench/reviewer-roster?')) {
      return Promise.resolve(response({
        success: true,
        active: [blocked],
        excluded: [],
        ineligible: [],
        blocked: [],
        savedKeys: [],
        allNames: [blocked.name],
      }));
    }
    if (target === '/api/reviewer-finder/save-candidates') {
      return Promise.resolve(response({
        success: false,
        savedCount: 0,
        savedKeys: [],
        errors: [{
          name: blocked.name,
          candidateKey: key,
          code: 'applicant_excluded',
          error: 'This reviewer is applicant-excluded for the request and cannot be promoted.',
        }],
        results: [{
          name: blocked.name,
          candidateKey: key,
          outcome: 'failed',
          code: 'applicant_excluded',
          decision: 'blocked_applicant_excluded',
        }],
      }, false, 422));
    }
    throw new Error(`unexpected fetch ${target}`);
  });

  render(<ReviewerSearchSection requestId={REQ} blobUrl="blob" proposalKey="proposal" />);
  fireEvent.click(await screen.findByLabelText(`Select ${blocked.name}`));
  fireEvent.click(screen.getByRole('button', { name: /promote 1 selected to invite/i }));

  expect(await screen.findByText(/Promotion blocked \(1\) — applicant-excluded for this request/i)).toBeInTheDocument();
  expect(screen.getByText(blocked.name)).toBeInTheDocument();
  expect(screen.queryByLabelText(`Select ${blocked.name}`)).not.toBeInTheDocument();
});

test('partial non-2xx response still graduates only the exact server-confirmed saved key', async () => {
  const saved = candidate('Saved Reviewer', 'saved@example.edu');
  const withheld = candidate('Withheld Reviewer', 'withheld@example.edu');
  const savedKey = reviewerSaveKey(saved);
  const withheldKey = reviewerSaveKey(withheld);
  global.fetch = jest.fn((url) => {
    const target = String(url);
    if (target.includes('/api/workbench/reviewer-roster?')) {
      return Promise.resolve(response({
        success: true,
        active: [saved, withheld],
        excluded: [],
        ineligible: [],
        blocked: [],
        savedKeys: [],
        allNames: [saved.name, withheld.name],
      }));
    }
    if (target === '/api/reviewer-finder/save-candidates') {
      return Promise.resolve(response({
        success: false,
        savedCount: 1,
        savedKeys: [savedKey],
        errors: [{
          name: withheld.name,
          candidateKey: withheldKey,
          code: 'identity_confirmation_required',
          outcome: 'withheld',
          error: 'Identity confirmation required.',
        }],
        results: [
          { name: saved.name, candidateKey: savedKey, outcome: 'saved' },
          { name: withheld.name, candidateKey: withheldKey, outcome: 'withheld', code: 'identity_confirmation_required' },
        ],
      }, false, 422));
    }
    throw new Error(`unexpected fetch ${target}`);
  });

  render(<ReviewerSearchSection requestId={REQ} blobUrl="blob" proposalKey="proposal" />);
  fireEvent.click(await screen.findByLabelText(`Select ${saved.name}`));
  fireEvent.click(screen.getByLabelText(`Select ${withheld.name}`));
  fireEvent.click(screen.getByRole('button', { name: /promote 2 selected to invite/i }));

  await waitFor(() => expect(screen.queryByText(saved.name)).not.toBeInTheDocument());
  expect(screen.getByText(withheld.name)).toBeInTheDocument();
  expect(screen.getByLabelText(`Select ${withheld.name}`)).toBeInTheDocument();
});
