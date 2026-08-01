/**
 * @jest-environment jsdom
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ReviewerSearchSection from '../../shared/components/reviewers/ReviewerSearchSection';
import { readSseStream } from '../../shared/components/reviewers/sse';
const { reviewerSaveKey } = require('../../lib/utils/reviewer-save-key');

jest.mock('../../shared/components/reviewers/sse', () => ({
  readSseStream: jest.fn(),
}));

const REQ = 'aaaaaaaa-1111-1111-1111-111111111111';
const candidate = (name, email) => ({
  name,
  email,
  emailSource: 'pubmed',
  emailPersistAllowed: true,
  addressTrustReceipt: {
    receiptId: `receipt-${email}`,
    personConfirmed: true,
    email,
  },
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
  readSseStream.mockReset();
  global.fetch = jest.fn();
});

test('applicant-excluded collision moves the exact candidate into terminal read-only state even on 422', async () => {
  const blocked = {
    ...candidate('Blocked Reviewer', 'blocked@example.edu'),
    candidateKey: 'orcid:0000-0002-1825-0097',
    orcid: '0000-0002-1825-0097',
  };
  const key = reviewerSaveKey(blocked);
  expect(key).not.toBe(blocked.candidateKey);
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

test('stale promote conflict reloads server truth instead of restoring the reviewer to Excluded', async () => {
  const stale = {
    ...candidate('Stale Excluded Reviewer', 'stale@example.edu'),
    candidateKey: 'candidate:stale-excluded',
  };
  let rosterLoads = 0;
  global.fetch = jest.fn((url, options = {}) => {
    const target = String(url);
    if (target.includes('/api/workbench/reviewer-roster?')) {
      rosterLoads += 1;
      return Promise.resolve(response(rosterLoads === 1 ? {
        success: true,
        active: [],
        excluded: [stale],
        ineligible: [],
        blocked: [],
        savedKeys: [],
        allNames: [stale.name],
      } : {
        success: true,
        active: [],
        excluded: [],
        ineligible: [],
        blocked: [],
        savedKeys: [],
        allNames: [stale.name],
      }));
    }
    if (target === '/api/workbench/reviewer-roster' && options.method === 'PATCH') {
      return Promise.resolve(response({
        success: false,
        code: 'candidate_not_excluded',
        error: 'Candidate is no longer excluded; reload the reviewer roster.',
      }, false, 409));
    }
    throw new Error(`unexpected fetch ${target}`);
  });

  render(<ReviewerSearchSection requestId={REQ} blobUrl="blob" proposalKey="proposal" />);
  fireEvent.click(await screen.findByText(/Excluded \(1\)/i));
  fireEvent.click(screen.getByRole('button', { name: /Promote back/i }));

  expect(await screen.findByText(/no longer actionable, so the reviewer roster was reloaded/i)).toBeInTheDocument();
  expect(screen.queryByText(/Excluded \(1\)/i)).not.toBeInTheDocument();
  expect(rosterLoads).toBe(2);
});

test('saved row with failed roster finalization stays successful and reloads the server-owned roster', async () => {
  const saved = {
    ...candidate('Unfinalized Reviewer', 'unfinalized@example.edu'),
    candidateKey: 'candidate:unfinalized',
  };
  const saveKey = reviewerSaveKey(saved);
  let rosterLoads = 0;
  global.fetch = jest.fn((url) => {
    const target = String(url);
    if (target.includes('/api/workbench/reviewer-roster?')) {
      rosterLoads += 1;
      return Promise.resolve(response({
        success: true,
        active: [saved],
        excluded: [],
        ineligible: [],
        blocked: [],
        savedKeys: [],
        allNames: [saved.name],
      }));
    }
    if (target === '/api/reviewer-finder/save-candidates') {
      return Promise.resolve(response({
        success: true,
        savedCount: 1,
        savedKeys: [saveKey],
        results: [{
          name: saved.name,
          candidateKey: saveKey,
          outcome: 'saved',
          rosterFinalized: false,
        }],
      }));
    }
    throw new Error(`unexpected fetch ${target}`);
  });

  render(<ReviewerSearchSection requestId={REQ} blobUrl="blob" proposalKey="proposal" />);
  fireEvent.click(await screen.findByLabelText(`Select ${saved.name}`));
  fireEvent.click(screen.getByRole('button', { name: /promote 1 selected to invite/i }));

  expect(await screen.findByText(/Saved 1 of 1/i)).toBeInTheDocument();
  expect(screen.getByText(/Find roster could not be finalized/i)).toBeInTheDocument();
  expect(screen.getByLabelText(`Select ${saved.name}`)).toBeInTheDocument();
  expect(rosterLoads).toBe(2);
});

test('expired verification is refreshed durably and deselected for review without automatic promotion', async () => {
  const expired = {
    ...candidate('Expired Verification Reviewer', 'old@example.edu'),
    candidateKey: 'candidate:expired-verification',
    automatedIdentityAttestation: 'expired-token',
    contactEnrichment: {
      email: 'old@example.edu',
      emailSource: 'pubmed',
    },
  };
  const saveKey = reviewerSaveKey(expired);
  global.fetch = jest.fn((url, options = {}) => {
    const target = String(url);
    if (target.includes('/api/workbench/reviewer-roster?')) {
      return Promise.resolve(response({
        success: true,
        active: [expired],
        excluded: [],
        ineligible: [],
        blocked: [],
        savedKeys: [],
        allNames: [expired.name],
      }));
    }
    if (target === '/api/reviewer-finder/save-candidates') {
      return Promise.resolve(response({
        success: false,
        savedCount: 0,
        savedKeys: [],
        errors: [{
          name: expired.name,
          candidateKey: saveKey,
          code: 'identity_attestation_required',
          error: 'Candidate verification has expired or is incomplete.',
        }],
        results: [{
          name: expired.name,
          candidateKey: saveKey,
          outcome: 'failed',
          code: 'identity_attestation_required',
        }],
      }, false, 422));
    }
    if (target === '/api/reviewer-finder/enrich-contacts') {
      return Promise.resolve({ ok: true, status: 200, body: {} });
    }
    if (target === '/api/workbench/reviewer-roster' && options.method === 'POST') {
      const body = JSON.parse(options.body);
      expect(body.candidates).toHaveLength(1);
      expect(body.candidates[0].candidateKey).toBe(expired.candidateKey);
      expect(body.candidates[0].automatedIdentityAttestation).toBe('fresh-token');
      return Promise.resolve(response({ success: true, recorded: 1 }));
    }
    throw new Error(`unexpected fetch ${target} ${options.method || 'GET'}`);
  });
  readSseStream.mockImplementation(async (_response, onEvent) => {
    onEvent({
      event: 'complete',
      data: {
        type: 'complete',
        results: [{
          ...expired,
          email: 'fresh@example.edu',
          automatedIdentityAttestation: 'fresh-token',
          contactEnrichment: {
            ...expired.contactEnrichment,
            email: 'fresh@example.edu',
            emailSource: 'orcid',
          },
        }],
      },
    });
  });

  render(<ReviewerSearchSection requestId={REQ} blobUrl="blob" proposalKey="proposal" />);
  const checkbox = await screen.findByLabelText(`Select ${expired.name}`);
  fireEvent.click(checkbox);
  fireEvent.click(screen.getByRole('button', { name: /promote 1 selected to invite/i }));

  expect(await screen.findByText(/Contact verification was refreshed for 1 reviewer/i)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /fresh@example.edu/i })).toBeInTheDocument();
  expect(screen.queryByLabelText(`Select ${expired.name}`)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: /verify \/ edit address/i })).toBeInTheDocument();
  expect(global.fetch).toHaveBeenCalledWith(
    '/api/reviewer-finder/save-candidates',
    expect.any(Object),
  );
  expect(global.fetch).not.toHaveBeenCalledWith(
    '/api/reviewer-finder/save-candidates',
    expect.objectContaining({ body: expect.stringContaining('fresh-token') }),
  );
});

test('mixed saved and expired rows reconcile independently before the refreshed row is retried', async () => {
  const saved = {
    ...candidate('Mixed Saved Reviewer', 'saved@example.edu'),
    candidateKey: 'candidate:mixed-saved',
  };
  const expired = {
    ...candidate('Mixed Expired Reviewer', 'expired@example.edu'),
    candidateKey: 'candidate:mixed-expired',
    automatedIdentityAttestation: 'expired-token',
    contactEnrichment: {
      email: 'expired@example.edu',
      emailSource: 'pubmed',
    },
  };
  const savedKey = reviewerSaveKey(saved);
  const expiredKey = reviewerSaveKey(expired);
  global.fetch = jest.fn((url, options = {}) => {
    const target = String(url);
    if (target.includes('/api/workbench/reviewer-roster?')) {
      return Promise.resolve(response({
        success: true,
        active: [saved, expired],
        excluded: [],
        ineligible: [],
        blocked: [],
        savedKeys: [],
        allNames: [saved.name, expired.name],
      }));
    }
    if (target === '/api/reviewer-finder/save-candidates') {
      return Promise.resolve(response({
        success: true,
        savedCount: 1,
        savedKeys: [savedKey],
        errors: [{
          name: expired.name,
          candidateKey: expiredKey,
          code: 'identity_attestation_required',
          error: 'Candidate verification has expired or is incomplete.',
        }],
        results: [
          {
            name: saved.name,
            candidateKey: savedKey,
            outcome: 'saved',
            rosterFinalized: true,
          },
          {
            name: expired.name,
            candidateKey: expiredKey,
            outcome: 'failed',
            code: 'identity_attestation_required',
          },
        ],
      }));
    }
    if (target === '/api/reviewer-finder/enrich-contacts') {
      return Promise.resolve({ ok: true, status: 200, body: {} });
    }
    if (target === '/api/workbench/reviewer-roster' && options.method === 'POST') {
      return Promise.resolve(response({ success: true, recorded: 1 }));
    }
    throw new Error(`unexpected fetch ${target} ${options.method || 'GET'}`);
  });
  readSseStream.mockImplementation(async (_response, onEvent) => {
    onEvent({
      event: 'complete',
      data: {
        type: 'complete',
        results: [{
          ...expired,
          email: 'refreshed@example.edu',
          automatedIdentityAttestation: 'fresh-token',
          contactEnrichment: {
            ...expired.contactEnrichment,
            email: 'refreshed@example.edu',
          },
        }],
      },
    });
  });

  render(<ReviewerSearchSection requestId={REQ} blobUrl="blob" proposalKey="proposal" />);
  fireEvent.click(await screen.findByLabelText(`Select ${saved.name}`));
  fireEvent.click(screen.getByLabelText(`Select ${expired.name}`));
  fireEvent.click(screen.getByRole('button', { name: /promote 2 selected to invite/i }));

  expect(await screen.findByText(/Saved 1 of 2/i)).toBeInTheDocument();
  expect(screen.queryByText(saved.name)).not.toBeInTheDocument();
  expect(screen.getByText(expired.name)).toBeInTheDocument();
  expect(screen.queryByLabelText(`Select ${expired.name}`)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: /verify \/ edit address/i })).toBeInTheDocument();
  expect(screen.getByText(/Contact verification was refreshed for 1 reviewer/i)).toBeInTheDocument();
});
