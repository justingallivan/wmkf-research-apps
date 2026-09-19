/**
 * @jest-environment jsdom
 *
 * P7 public-consumer contract proof. The producer suite freezes the handler
 * envelopes; these tests feed the same envelope fixture into the public
 * ReviewerSearchSection and characterize the existing unknown-outcome split.
 */

const { cleanup, fireEvent, render, screen, waitFor } = require('@testing-library/react');
jest.mock('../../shared/components/reviewers/sse', () => ({
  readSseStream: jest.fn(),
}));
const ReviewerSearchSection = require('../../shared/components/reviewers/ReviewerSearchSection').default;
const contract = require('../fixtures/reviewer-search-http-contract.json');
const { reviewerSaveKey } = require('../../lib/utils/reviewer-save-key');
const { readSseStream } = require('../../shared/components/reviewers/sse');

const REQUEST_ID = '11111111-1111-1111-1111-111111111111';
const ORDINARY = {
  name: 'Ordinary Saved',
  email: 'applicant@example.edu',
  emailSource: 'pubmed',
  emailPersistAllowed: true,
  candidateKey: 'roster:ordinary',
  addressTrustReceipt: {
    receiptId: 'synthetic-address-receipt',
    personConfirmed: true,
    email: 'applicant@example.edu',
  },
  identityStatus: 'probable',
  provenance: { kind: 'literature_retrieved', sources: ['pubmed'] },
};

function response(body, ok = true, status = ok ? 200 : 422) {
  return { ok, status, json: async () => body };
}

function rosterEnvelope(active = [ORDINARY]) {
  return {
    ...contract.rosterRecovery,
    active,
    savedKeys: [],
    allNames: active.map((candidate) => candidate.name),
  };
}

afterEach(() => {
  cleanup();
  global.fetch = jest.fn();
  readSseStream.mockReset();
});

test('ordinary pre-response network loss reconciles the roster but cannot confirm a saved non-suggestion key', async () => {
  let rosterGets = 0;
  const onSaved = jest.fn();
  global.fetch = jest.fn((url) => {
    if (String(url).includes('/api/workbench/reviewer-roster?')) {
      rosterGets += 1;
      return Promise.resolve(response(rosterGets === 1 ? rosterEnvelope() : contract.rosterRecovery));
    }
    if (url === '/api/reviewer-finder/save-candidates') {
      return Promise.reject(new Error('connection dropped before response'));
    }
    throw new Error('unexpected fetch ' + url);
  });

  render(<ReviewerSearchSection requestId={REQUEST_ID} blobUrl="blob" proposalKey="proposal" onSaved={onSaved} />);
  fireEvent.click(await screen.findByLabelText('Select ' + ORDINARY.name));
  fireEvent.click(screen.getByRole('button', { name: /add 1 selected to invite/i }));

  await waitFor(() => expect(rosterGets).toBe(2));
  expect(global.fetch).toHaveBeenCalledTimes(3);
  expect(screen.queryByLabelText('Select ' + ORDINARY.name)).not.toBeInTheDocument();
  expect(await screen.findByRole('button', { name: 'Try again' })).toBeEnabled();
  // Existing empty-roster rendering hides the action-local unknown-outcome
  // notice. Do not invent successful confirmation or repair this in a refactor.
  expect(screen.queryByText(/Save outcome is unknown/i)).not.toBeInTheDocument();
  expect(onSaved).not.toHaveBeenCalled();
});

test('ordinary response JSON failure does not perform pre-response roster recovery', async () => {
  let rosterGets = 0;
  global.fetch = jest.fn((url) => {
    if (String(url).includes('/api/workbench/reviewer-roster?')) {
      rosterGets += 1;
      return Promise.resolve(response(rosterEnvelope()));
    }
    if (url === '/api/reviewer-finder/save-candidates') {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.reject(new Error('unreadable JSON')),
      });
    }
    throw new Error('unexpected fetch ' + url);
  });

  render(<ReviewerSearchSection requestId={REQUEST_ID} blobUrl="blob" proposalKey="proposal" />);
  fireEvent.click(await screen.findByLabelText('Select ' + ORDINARY.name));
  fireEvent.click(screen.getByRole('button', { name: /add 1 selected to invite/i }));

  expect(await screen.findByText(/No candidates were saved/i)).toBeInTheDocument();
  expect(global.fetch).toHaveBeenCalledTimes(2);
  expect(rosterGets).toBe(1);
  expect(screen.getByLabelText('Select ' + ORDINARY.name)).toBeChecked();
});

test('ordinary mixed producer envelope removes only the saved UI row', async () => {
  const blocked = {
    name: 'Ordinary Blocked',
    email: 'applicant@example.edu',
    emailSource: 'pubmed',
    emailPersistAllowed: true,
    candidateKey: 'roster:conflict',
    addressTrustReceipt: {
      receiptId: 'synthetic-address-receipt-conflict',
      personConfirmed: true,
      email: 'applicant@example.edu',
    },
    identityStatus: 'probable',
    provenance: { kind: 'literature_retrieved', sources: ['pubmed'] },
  };
  global.fetch = jest.fn((url) => {
    if (String(url).includes('/api/workbench/reviewer-roster?')) {
      return Promise.resolve(response(rosterEnvelope([ORDINARY, blocked])));
    }
    if (url === '/api/reviewer-finder/save-candidates') {
      return Promise.resolve(response(contract.ordinaryMixedSave));
    }
    throw new Error('unexpected fetch ' + url);
  });

  render(<ReviewerSearchSection requestId={REQUEST_ID} blobUrl="blob" proposalKey="proposal" />);
  fireEvent.click(await screen.findByLabelText('Select ' + ORDINARY.name));
  fireEvent.click(screen.getByLabelText('Select ' + blocked.name));
  fireEvent.click(screen.getByRole('button', { name: /add 2 selected to invite/i }));

  await waitFor(() => expect(screen.queryByLabelText('Select ' + ORDINARY.name)).not.toBeInTheDocument());
  expect(screen.getByText(blocked.name)).toBeInTheDocument();
  expect(screen.getByText(/Saved 1 of 2/i)).toBeInTheDocument();
  expect(screen.getByText(/A conflict safety record could not be written/i)).toBeInTheDocument();
});

test('applicant transport failure does not perform ordinary roster recovery', async () => {
  const suggestionId = contract.applicantPartialPromotion.suggestionId;
  const applicant = {
    ...ORDINARY,
    name: 'Applicant Reviewer',
    candidateKey: 'roster:applicant',
    suggestionId,
    isApplicantRecommended: true,
    enrichedProposalKey: 'proposal',
    provenance: {
      kind: 'applicant_suggested',
      sources: ['applicant'],
      seedRole: 'applicant_suggested',
      groundingWorkIds: [],
    },
  };
  let rosterGets = 0;
  global.fetch = jest.fn((url) => {
    if (String(url).includes('/api/workbench/reviewer-roster?')) {
      rosterGets += 1;
      return Promise.resolve(response(rosterEnvelope([applicant])));
    }
    if (url === '/api/workbench/promote-applicant-reviewer') {
      return Promise.reject(new Error('applicant transport failed'));
    }
    throw new Error('unexpected fetch ' + url);
  });

  render(<ReviewerSearchSection requestId={REQUEST_ID} blobUrl="blob" proposalKey="proposal" />);
  fireEvent.click(await screen.findByLabelText('Select ' + applicant.name));
  fireEvent.click(screen.getByRole('button', { name: /add 1 selected to invite/i }));

  await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
  expect(rosterGets).toBe(1);
  expect(screen.getByLabelText('Select ' + applicant.name)).toBeChecked();
  expect(await screen.findByText(/No candidates were saved: Applicant Reviewer: applicant transport failed/i)).toBeInTheDocument();
});

test('applicant partial promotion consumes the frozen envelope and reloads roster recovery', async () => {
  const suggestionId = contract.applicantPartialPromotion.suggestionId;
  const applicant = {
    ...ORDINARY,
    name: 'Applicant Reviewer',
    candidateKey: contract.applicantPartialPromotion.candidateKey,
    suggestionId,
    isApplicantRecommended: true,
    enrichedProposalKey: 'proposal',
    provenance: {
      kind: 'applicant_suggested',
      sources: ['applicant'],
      seedRole: 'applicant_suggested',
      groundingWorkIds: [],
    },
  };
  let rosterGets = 0;
  global.fetch = jest.fn((url) => {
    if (String(url).includes('/api/workbench/reviewer-roster?')) {
      rosterGets += 1;
      return Promise.resolve(response(rosterGets === 1 ? rosterEnvelope([applicant]) : contract.rosterRecovery));
    }
    if (url === '/api/workbench/promote-applicant-reviewer') {
      return Promise.resolve(response(contract.applicantPartialPromotion));
    }
    throw new Error('unexpected fetch ' + url);
  });

  render(<ReviewerSearchSection requestId={REQUEST_ID} blobUrl="blob" proposalKey="proposal" />);
  fireEvent.click(await screen.findByLabelText('Select ' + applicant.name));
  fireEvent.click(screen.getByRole('button', { name: /add 1 selected to invite/i }));

  await waitFor(() => expect(rosterGets).toBe(2));
  expect(global.fetch).toHaveBeenCalledTimes(3);
  expect(screen.queryByLabelText('Select ' + applicant.name)).not.toBeInTheDocument();
  expect(screen.getByText(/Find roster could not be finalized/i)).toBeInTheDocument();
});

test('one click mixed ordinary plus applicant promotion reports one success and calls onSaved once', async () => {
  const applicant = {
    ...ORDINARY,
    name: 'Applicant Reviewer',
    affiliation: 'Example University',
    manualContactFields: ['email', 'affiliation'],
    candidateKey: 'roster:applicant',
    suggestionId: contract.applicantPartialPromotion.suggestionId,
    isApplicantRecommended: true,
    enrichedProposalKey: 'proposal',
    provenance: {
      kind: 'applicant_suggested',
      sources: ['applicant'],
      seedRole: 'applicant_suggested',
      groundingWorkIds: [],
    },
  };
  const onSaved = jest.fn();
  let rosterGets = 0;
  global.fetch = jest.fn((url, options = {}) => {
    if (String(url).includes('/api/workbench/reviewer-roster?')) {
      rosterGets += 1;
      return Promise.resolve(response(rosterGets === 1
        ? rosterEnvelope([ORDINARY, applicant])
        : contract.rosterRecovery));
    }
    if (url === '/api/reviewer-finder/save-candidates') {
      expect(JSON.parse(options.body).candidates.map((candidate) => candidate.name)).toEqual([ORDINARY.name]);
      return Promise.resolve(response(contract.ordinarySingleSave));
    }
    if (url === '/api/workbench/promote-applicant-reviewer') {
      expect(JSON.parse(options.body)).toEqual({ requestId: REQUEST_ID, suggestionId: applicant.suggestionId, contact: { email: applicant.email, affiliation: applicant.affiliation } });
      return Promise.resolve(response(contract.applicantFinalizedPromotion));
    }
    throw new Error('unexpected fetch ' + url);
  });

  render(<ReviewerSearchSection requestId={REQUEST_ID} blobUrl="blob" proposalKey="proposal" onSaved={onSaved} />);
  fireEvent.click(await screen.findByLabelText('Select ' + ORDINARY.name));
  fireEvent.click(screen.getByLabelText('Select ' + applicant.name));
  fireEvent.click(screen.getByRole('button', { name: /add 2 selected to invite/i }));

  await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  expect(screen.getByText(/Saved 1 of 1/i)).toBeInTheDocument();
  expect(screen.getByText(/Added 1 of 1 applicant-referred reviewer/i)).toBeInTheDocument();
});

test('all-rejected ordinary save keeps the row selected, shows the error, and does not call onSaved', async () => {
  const onSaved = jest.fn();
  global.fetch = jest.fn((url) => {
    if (String(url).includes('/api/workbench/reviewer-roster?')) {
      return Promise.resolve(response(rosterEnvelope()));
    }
    if (url === '/api/reviewer-finder/save-candidates') {
      return Promise.resolve(response({
        success: false,
        savedCount: 0,
        savedKeys: [],
        totalRequested: 1,
        rejectedUnresolved: 1,
        errors: [{
          name: ORDINARY.name,
          candidateKey: 'candidate:ordinary%20saved|email:applicant%40example.edu|orcid:-|affiliation:-',
          index: 0,
          code: 'identity_unresolved',
          outcome: 'failed',
          error: 'Candidate identity is unresolved (needs identity review); not saved.',
        }],
        results: [{
          name: ORDINARY.name,
          candidateKey: 'candidate:ordinary%20saved|email:applicant%40example.edu|orcid:-|affiliation:-',
          index: 0,
          code: 'identity_unresolved',
          outcome: 'failed',
        }],
      }, false, 422));
    }
    throw new Error('unexpected fetch ' + url);
  });

  render(<ReviewerSearchSection requestId={REQUEST_ID} blobUrl="blob" proposalKey="proposal" onSaved={onSaved} />);
  fireEvent.click(await screen.findByLabelText('Select ' + ORDINARY.name));
  fireEvent.click(screen.getByRole('button', { name: /add 1 selected to invite/i }));

  expect(await screen.findByText(/No candidates were saved/i)).toBeInTheDocument();
  expect(screen.getByLabelText('Select ' + ORDINARY.name)).toBeChecked();
  expect(onSaved).not.toHaveBeenCalled();
});

test('applicant promotion sends only manually marked contact fields', async () => {
  const applicant = {
    ...ORDINARY,
    name: 'Applicant Manual Reviewer',
    candidateKey: 'roster:applicant-manual',
    suggestionId: contract.applicantPartialPromotion.suggestionId,
    website: 'https://example.edu/reviewer',
    affiliation: 'Example University',
    hIndex: 9,
    manualContactFields: ['email'],
    isApplicantRecommended: true,
    enrichedProposalKey: 'proposal',
    provenance: {
      kind: 'applicant_suggested',
      sources: ['applicant'],
      seedRole: 'applicant_suggested',
      groundingWorkIds: [],
    },
  };
  let applicantBody;
  let rosterGets = 0;
  global.fetch = jest.fn((url, options = {}) => {
    if (String(url).includes('/api/workbench/reviewer-roster?')) {
      rosterGets += 1;
      return Promise.resolve(response(rosterGets === 1
        ? rosterEnvelope([applicant])
        : contract.rosterRecovery));
    }
    if (url === '/api/workbench/promote-applicant-reviewer') {
      applicantBody = JSON.parse(options.body);
      return Promise.resolve(response(contract.applicantPartialPromotion));
    }
    throw new Error('unexpected fetch ' + url);
  });

  render(<ReviewerSearchSection requestId={REQUEST_ID} blobUrl="blob" proposalKey="proposal" />);
  fireEvent.click(await screen.findByLabelText('Select ' + applicant.name));
  fireEvent.click(screen.getByRole('button', { name: /add 1 selected to invite/i }));

  await waitFor(() => expect(applicantBody).toBeDefined());
  expect(applicantBody.contact).toEqual({ email: applicant.email });
  expect(applicantBody.contact).not.toHaveProperty('website');
  expect(applicantBody.contact).not.toHaveProperty('affiliation');
  expect(applicantBody.contact).not.toHaveProperty('hIndex');
});

test('expired verification with a manual field skips automated refresh', async () => {
  const expired = {
    ...ORDINARY,
    name: 'Manual Refresh Reviewer',
    candidateKey: 'roster:manual-refresh',
    automatedIdentityAttestation: 'expired-token',
    manualContactFields: ['email'],
  };
  let enrichCalls = 0;
  global.fetch = jest.fn((url) => {
    if (String(url).includes('/api/workbench/reviewer-roster?')) {
      return Promise.resolve(response(rosterEnvelope([expired])));
    }
    if (url === '/api/reviewer-finder/save-candidates') {
      return Promise.resolve(response({
        success: false,
        savedCount: 0,
        savedKeys: [],
        results: [{
          name: expired.name,
          candidateKey: reviewerSaveKey(expired),
          index: 0,
          outcome: 'failed',
          code: 'identity_attestation_required',
        }],
      }, false, 422));
    }
    if (url === '/api/reviewer-finder/enrich-contacts') {
      enrichCalls += 1;
      return Promise.resolve({ ok: true, status: 200, body: {} });
    }
    throw new Error('unexpected fetch ' + url);
  });

  render(<ReviewerSearchSection requestId={REQUEST_ID} blobUrl="blob" proposalKey="proposal" />);
  fireEvent.click(await screen.findByLabelText('Select ' + expired.name));
  fireEvent.click(screen.getByRole('button', { name: /add 1 selected to invite/i }));

  expect(await screen.findByText(/Manual contact details were not overwritten/i)).toBeInTheDocument();
  expect(enrichCalls).toBe(0);
});

test('expired verification with an unchanged token remains retryable without roster POST', async () => {
  const expired = {
    ...ORDINARY,
    name: 'Unchanged Token Reviewer',
    candidateKey: 'openalex:unchanged-token',
    openAlexId: 'unchanged-token',
    contactEnrichment: { email: 'applicant@example.edu', emailSource: 'pubmed' },
    automatedIdentityAttestation: 'expired-token',
  };
  let rosterPosts = 0;
  global.fetch = jest.fn((url) => {
    if (String(url).includes('/api/workbench/reviewer-roster?')) {
      return Promise.resolve(response(rosterEnvelope([expired])));
    }
    if (url === '/api/reviewer-finder/save-candidates') {
      return Promise.resolve(response({
        success: false,
        savedCount: 0,
        savedKeys: [],
        results: [{
          name: expired.name,
          candidateKey: reviewerSaveKey(expired),
          index: 0,
          outcome: 'failed',
          code: 'identity_attestation_required',
        }],
      }, false, 422));
    }
    if (url === '/api/reviewer-finder/enrich-contacts') {
      return Promise.resolve({ ok: true, status: 200, body: {} });
    }
    if (url === '/api/workbench/reviewer-roster' ) {
      rosterPosts += 1;
      return Promise.resolve(response({ success: true, recorded: 1 }));
    }
    throw new Error('unexpected fetch ' + url);
  });
  readSseStream.mockImplementation(async (_response, onEvent) => {
    onEvent({
      event: 'complete',
      data: {
        type: 'complete',
        results: [{ ...expired, automatedIdentityAttestation: 'expired-token', contactEnrichment: { email: expired.email, emailSource: 'pubmed' } }],
      },
    });
  });

  render(<ReviewerSearchSection requestId={REQUEST_ID} blobUrl="blob" proposalKey="proposal" />);
  fireEvent.click(await screen.findByLabelText('Select ' + expired.name));
  fireEvent.click(screen.getByRole('button', { name: /add 1 selected to invite/i }));

  expect(await screen.findByText(/No candidates were saved: Unchanged Token Reviewer: Contact verification could not be refreshed/i)).toBeInTheDocument();
  expect(rosterPosts).toBe(0);
  expect(screen.getByLabelText('Select ' + expired.name)).toBeChecked();
});

test('expired verification with recorded=0 stays retryable and does not auto-save', async () => {
  const expired = {
    ...ORDINARY,
    name: 'Unrecorded Refresh Reviewer',
    candidateKey: 'roster:recorded-zero',
    contactEnrichment: { email: 'applicant@example.edu', emailSource: 'pubmed' },
    automatedIdentityAttestation: 'expired-token',
  };
  let rosterPosts = 0;
  global.fetch = jest.fn((url) => {
    if (String(url).includes('/api/workbench/reviewer-roster?')) {
      return Promise.resolve(response(rosterEnvelope([expired])));
    }
    if (url === '/api/reviewer-finder/save-candidates') {
      return Promise.resolve(response({
        success: false,
        savedCount: 0,
        savedKeys: [],
        results: [{
          name: expired.name,
          candidateKey: reviewerSaveKey(expired),
          index: 0,
          outcome: 'failed',
          code: 'identity_attestation_required',
        }],
      }, false, 422));
    }
    if (url === '/api/reviewer-finder/enrich-contacts') {
      return Promise.resolve({ ok: true, status: 200, body: {} });
    }
    if (url === '/api/workbench/reviewer-roster') {
      rosterPosts += 1;
      return Promise.resolve(response({ success: true, recorded: 0 }));
    }
    throw new Error('unexpected fetch ' + url);
  });
  readSseStream.mockImplementation(async (_response, onEvent) => {
    onEvent({
      event: 'complete',
      data: {
        type: 'complete',
        results: [{ ...expired, automatedIdentityAttestation: 'fresh-token', contactEnrichment: { email: expired.email, emailSource: 'pubmed' } }],
      },
    });
  });

  render(<ReviewerSearchSection requestId={REQUEST_ID} blobUrl="blob" proposalKey="proposal" />);
  fireEvent.click(await screen.findByLabelText('Select ' + expired.name));
  fireEvent.click(screen.getByRole('button', { name: /add 1 selected to invite/i }));

  expect(await screen.findByText(/No candidates were saved: Unrecorded Refresh Reviewer: Refreshed verification could not be written to the active roster/i)).toBeInTheDocument();
  expect(rosterPosts).toBe(1);
  expect(screen.getByLabelText('Select ' + expired.name)).toBeChecked();
});

test('multi-row refresh keeps recorded=0 retryable while acknowledging recorded=1', async () => {
  const first = {
    ...ORDINARY,
    name: 'Refresh Recorded Zero',
    candidateKey: 'roster:refresh-zero',
    contactEnrichment: { email: 'applicant@example.edu', emailSource: 'pubmed' },
    automatedIdentityAttestation: 'expired-zero',
  };
  const second = {
    ...ORDINARY,
    name: 'Refresh Recorded One',
    candidateKey: 'roster:refresh-one',
    contactEnrichment: { email: 'applicant@example.edu', emailSource: 'pubmed' },
    automatedIdentityAttestation: 'expired-one',
  };
  let rosterPosts = [];
  global.fetch = jest.fn((url, options = {}) => {
    if (String(url).includes('/api/workbench/reviewer-roster?')) {
      return Promise.resolve(response(rosterEnvelope([first, second])));
    }
    if (url === '/api/reviewer-finder/save-candidates') {
      return Promise.resolve(response({
        success: false,
        savedCount: 0,
        savedKeys: [],
        results: [first, second].map((candidate, index) => ({
          name: candidate.name,
          candidateKey: reviewerSaveKey(candidate),
          index,
          outcome: 'failed',
          code: 'identity_attestation_required',
        })),
      }, false, 422));
    }
    if (url === '/api/reviewer-finder/enrich-contacts') {
      return Promise.resolve({ ok: true, status: 200, body: {} });
    }
    if (url === '/api/workbench/reviewer-roster') {
      const body = JSON.parse(options.body);
      rosterPosts.push(body.candidates[0].candidateKey);
      return Promise.resolve(response({ success: true, recorded: body.candidates[0].candidateKey === second.candidateKey ? 1 : 0 }));
    }
    throw new Error('unexpected fetch ' + url);
  });
  readSseStream.mockImplementation(async (_response, onEvent) => {
    onEvent({
      event: 'complete',
      data: {
        type: 'complete',
        results: [
          { ...first, automatedIdentityAttestation: 'fresh-zero', contactEnrichment: { email: first.email, emailSource: 'pubmed' } },
          { ...second, automatedIdentityAttestation: 'fresh-one', contactEnrichment: { email: second.email, emailSource: 'pubmed' } },
        ],
      },
    });
  });

  render(<ReviewerSearchSection requestId={REQUEST_ID} blobUrl="blob" proposalKey="proposal" />);
  fireEvent.click(await screen.findByLabelText('Select ' + first.name));
  fireEvent.click(screen.getByLabelText('Select ' + second.name));
  fireEvent.click(screen.getByRole('button', { name: /add 2 selected to invite/i }));

  expect(await screen.findByText(/Contact verification was refreshed for 1 reviewer/i)).toBeInTheDocument();
  expect(screen.getByText(/Verification could not be refreshed for 1 reviewer/i)).toBeInTheDocument();
  expect(rosterPosts).toEqual([first.candidateKey, second.candidateKey]);
  expect(screen.getByLabelText('Select ' + first.name)).toBeChecked();
  expect(screen.getByLabelText('Select ' + second.name)).not.toBeChecked();
});
