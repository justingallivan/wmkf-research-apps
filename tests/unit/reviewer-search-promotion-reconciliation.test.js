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
  fireEvent.click(screen.getByRole('button', { name: /add 1 selected to invite/i }));

  expect(await screen.findByText(/Cannot add to Invite \(1\) — applicant-excluded for this request/i)).toBeInTheDocument();
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
  fireEvent.click(screen.getByRole('button', { name: /add 2 selected to invite/i }));

  await waitFor(() => expect(screen.queryByText(saved.name)).not.toBeInTheDocument());
  expect(screen.getByText(withheld.name)).toBeInTheDocument();
  expect(screen.getByLabelText(`Select ${withheld.name}`)).toBeInTheDocument();
});

test('a saved result removes only the indexed roster card when an unsubmitted card shares its save key', async () => {
  const primary = {
    ...candidate('Dr Collision Reviewer', 'collision@example.edu'),
    candidateKey: 'openalex:primary',
    openAlexId: 'primary',
  };
  const sibling = {
    ...candidate('Collision Reviewer', 'collision@example.edu'),
    candidateKey: 'openalex:sibling',
    openAlexId: 'sibling',
  };
  const sharedSaveKey = reviewerSaveKey(primary);
  expect(reviewerSaveKey(sibling)).toBe(sharedSaveKey);
  global.fetch = jest.fn((url) => {
    const target = String(url);
    if (target.includes('/api/workbench/reviewer-roster?')) {
      return Promise.resolve(response({
        success: true,
        active: [primary, sibling],
        excluded: [],
        ineligible: [],
        blocked: [],
        savedKeys: [],
        allNames: [primary.name, sibling.name],
      }));
    }
    if (target === '/api/reviewer-finder/save-candidates') {
      return Promise.resolve(response({
        success: true,
        savedCount: 1,
        savedKeys: [sharedSaveKey],
        results: [{
          name: primary.name,
          candidateKey: sharedSaveKey,
          index: 0,
          outcome: 'saved',
        }],
      }));
    }
    throw new Error(`unexpected fetch ${target}`);
  });

  render(<ReviewerSearchSection requestId={REQ} blobUrl="blob" proposalKey="proposal" />);
  fireEvent.click(await screen.findByLabelText(`Select ${primary.name}`));
  fireEvent.click(screen.getByRole('button', { name: /add 1 selected to invite/i }));

  await waitFor(() => expect(screen.queryByLabelText(`Select ${primary.name}`)).not.toBeInTheDocument());
  expect(screen.getByLabelText(`Select ${sibling.name}`)).toBeInTheDocument();
});

test('an applicant-excluded result blocks only the indexed roster card when another card shares its save key', async () => {
  const primary = {
    ...candidate('Dr Block Collision', 'block-collision@example.edu'),
    candidateKey: 'openalex:block-primary',
    openAlexId: 'block-primary',
  };
  const sibling = {
    ...candidate('Block Collision', 'block-collision@example.edu'),
    candidateKey: 'openalex:block-sibling',
    openAlexId: 'block-sibling',
  };
  const sharedSaveKey = reviewerSaveKey(primary);
  expect(reviewerSaveKey(sibling)).toBe(sharedSaveKey);
  global.fetch = jest.fn((url) => {
    const target = String(url);
    if (target.includes('/api/workbench/reviewer-roster?')) {
      return Promise.resolve(response({
        success: true,
        active: [primary, sibling],
        excluded: [],
        ineligible: [],
        blocked: [],
        savedKeys: [],
        allNames: [primary.name, sibling.name],
      }));
    }
    if (target === '/api/reviewer-finder/save-candidates') {
      return Promise.resolve(response({
        success: false,
        savedCount: 0,
        savedKeys: [],
        results: [{
          name: primary.name,
          candidateKey: sharedSaveKey,
          index: 0,
          outcome: 'failed',
          code: 'applicant_excluded',
        }],
      }, false, 422));
    }
    throw new Error(`unexpected fetch ${target}`);
  });

  render(<ReviewerSearchSection requestId={REQ} blobUrl="blob" proposalKey="proposal" />);
  fireEvent.click(await screen.findByLabelText(`Select ${primary.name}`));
  fireEvent.click(screen.getByRole('button', { name: /add 1 selected to invite/i }));

  expect(await screen.findByText(/Cannot add to Invite \(1\)/i)).toBeInTheDocument();
  expect(screen.queryByLabelText(`Select ${primary.name}`)).not.toBeInTheDocument();
  expect(screen.getByLabelText(`Select ${sibling.name}`)).toBeInTheDocument();
});

test('same-person different-address conflict exposes identity confirmation on the exact ORCID card', async () => {
  const peter = {
    ...candidate('Peter Reiners', 'reiners@arizona.edu'),
    candidateKey: 'orcid:0000-0002-4517-2318',
    orcid: '0000-0002-4517-2318',
    website: 'https://profiles.arizona.edu/person/reiners',
    affiliation: 'University of Arizona',
  };
  const saveKey = reviewerSaveKey(peter);
  expect(saveKey).not.toBe(peter.candidateKey);
  global.fetch = jest.fn((url) => {
    const target = String(url);
    if (target.includes('/api/workbench/reviewer-roster?')) {
      return Promise.resolve(response({
        success: true,
        active: [peter],
        excluded: [],
        ineligible: [],
        blocked: [],
        savedKeys: [],
        allNames: [peter.name],
      }));
    }
    if (target === '/api/reviewer-finder/save-candidates') {
      return Promise.resolve(response({
        success: false,
        savedCount: 0,
        savedKeys: [],
        errors: [{
          name: peter.name,
          candidateKey: saveKey,
          index: 0,
          code: 'ambiguous_or_name_mismatch',
          decision: 'identity_choice_required',
          error: 'Dataverse identity evidence conflicts or is ambiguous.',
        }],
        results: [{
          name: peter.name,
          candidateKey: saveKey,
          index: 0,
          outcome: 'withheld',
          code: 'ambiguous_or_name_mismatch',
          decision: 'identity_choice_required',
        }],
      }, false, 422));
    }
    throw new Error(`unexpected fetch ${target}`);
  });

  render(<ReviewerSearchSection requestId={REQ} blobUrl="blob" proposalKey="proposal" />);
  fireEvent.click(await screen.findByLabelText(`Select ${peter.name}`));
  fireEvent.click(screen.getByRole('button', { name: /add 1 selected to invite/i }));

  expect(await screen.findByRole('button', { name: /confirm identity/i })).toBeInTheDocument();
  expect(screen.queryByLabelText(`Select ${peter.name}`)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /confirm identity/i }));
  expect(screen.getByDisplayValue(peter.email)).toBeInTheDocument();
  expect(screen.getByDisplayValue(peter.website)).toBeInTheDocument();
});

test('record-repair conflicts stay on the repair remedy even when the server also labels them identity-choice-required', async () => {
  const reviewer = {
    ...candidate('Repair Reviewer', 'repair@example.edu'),
    candidateKey: 'orcid:0000-0002-1825-0097',
    orcid: '0000-0002-1825-0097',
  };
  const saveKey = reviewerSaveKey(reviewer);
  expect(saveKey).not.toBe(reviewer.candidateKey);
  global.fetch = jest.fn((url) => {
    const target = String(url);
    if (target.includes('/api/workbench/reviewer-roster?')) {
      return Promise.resolve(response({
        success: true,
        active: [reviewer],
        excluded: [],
        ineligible: [],
        blocked: [],
        savedKeys: [],
        allNames: [reviewer.name],
      }));
    }
    if (target === '/api/reviewer-finder/save-candidates') {
      return Promise.resolve(response({
        success: false,
        savedCount: 0,
        savedKeys: [],
        errors: [{
          name: reviewer.name,
          candidateKey: saveKey,
          index: 0,
          code: 'contact_linked_elsewhere',
          decision: 'identity_choice_required',
          error: 'The contact is linked to another reviewer record.',
        }],
        results: [{
          name: reviewer.name,
          candidateKey: saveKey,
          index: 0,
          outcome: 'withheld',
          code: 'contact_linked_elsewhere',
          decision: 'identity_choice_required',
        }],
      }, false, 422));
    }
    throw new Error(`unexpected fetch ${target}`);
  });

  render(<ReviewerSearchSection requestId={REQ} blobUrl="blob" proposalKey="proposal" />);
  fireEvent.click(await screen.findByLabelText(`Select ${reviewer.name}`));
  fireEvent.click(screen.getByRole('button', { name: /add 1 selected to invite/i }));

  expect(await screen.findByRole('button', { name: /create repair request/i })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /confirm identity/i })).not.toBeInTheDocument();
  expect(screen.queryByLabelText(`Select ${reviewer.name}`)).not.toBeInTheDocument();
});

test('applicant promotion repair failure attaches the repair remedy to the exact applicant card', async () => {
  const suggestionId = '44444444-4444-4444-4444-444444444444';
  const reviewer = {
    ...candidate('Applicant Repair Reviewer', 'applicant-repair@example.edu'),
    candidateKey: `suggestion:${suggestionId}`,
    suggestionId,
    isApplicantRecommended: true,
    enrichedProposalKey: 'proposal',
    provenance: {
      kind: 'applicant_suggested',
      sources: ['applicant'],
      seedRole: 'query_seed',
      groundingWorkIds: [],
    },
  };
  global.fetch = jest.fn((url) => {
    const target = String(url);
    if (target.includes('/api/workbench/reviewer-roster?')) {
      return Promise.resolve(response({
        success: true,
        active: [reviewer],
        excluded: [],
        ineligible: [],
        blocked: [],
        savedKeys: [],
        allNames: [reviewer.name],
      }));
    }
    if (target === '/api/workbench/promote-applicant-reviewer') {
      return Promise.resolve(response({
        success: false,
        code: 'person_inactive',
        error: 'The applicant-linked reviewer record is inactive.',
      }, false, 422));
    }
    throw new Error(`unexpected fetch ${target}`);
  });

  render(<ReviewerSearchSection requestId={REQ} blobUrl="blob" proposalKey="proposal" />);
  fireEvent.click(await screen.findByLabelText(`Select ${reviewer.name}`));
  fireEvent.click(screen.getByRole('button', { name: /add 1 selected to invite/i }));

  expect(await screen.findByRole('button', { name: /create repair request/i })).toBeInTheDocument();
  expect(screen.queryByLabelText(`Select ${reviewer.name}`)).not.toBeInTheDocument();
});

test('applicant promotion address-verification failure exposes the address remedy and deselects the card', async () => {
  const suggestionId = '55555555-5555-5555-5555-555555555555';
  const reviewer = {
    ...candidate('Applicant Address Reviewer', 'applicant-address@example.edu'),
    candidateKey: `suggestion:${suggestionId}`,
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
  global.fetch = jest.fn((url) => {
    const target = String(url);
    if (target.includes('/api/workbench/reviewer-roster?')) {
      return Promise.resolve(response({
        success: true,
        active: [reviewer],
        excluded: [],
        ineligible: [],
        blocked: [],
        savedKeys: [],
        allNames: [reviewer.name],
      }));
    }
    if (target === '/api/workbench/promote-applicant-reviewer') {
      return Promise.resolve(response({
        success: false,
        code: 'address_verification_required',
        error: 'Select and verify the exact address before promotion.',
      }, false, 422));
    }
    throw new Error(`unexpected fetch ${target}`);
  });

  render(<ReviewerSearchSection requestId={REQ} blobUrl="blob" proposalKey="proposal" />);
  fireEvent.click(await screen.findByLabelText(`Select ${reviewer.name}`));
  fireEvent.click(screen.getByRole('button', { name: /add 1 selected to invite/i }));

  expect(await screen.findByRole('button', { name: /verify address/i })).toBeInTheDocument();
  expect(screen.queryByLabelText(`Select ${reviewer.name}`)).not.toBeInTheDocument();
  expect(screen.getByText(/Address verification is required/i)).toBeInTheDocument();
});

test('plain website edits are durably acknowledged by the request roster before the modal closes', async () => {
  const reviewer = {
    ...candidate('Peter Reiners', 'reiners@arizona.edu'),
    candidateKey: 'orcid:0000-0002-4517-2318',
    orcid: '0000-0002-4517-2318',
    website: null,
    affiliation: 'University of Arizona',
  };
  const website = 'https://profiles.arizona.edu/person/reiners';
  let patchBody;
  global.fetch = jest.fn((url, options = {}) => {
    const target = String(url);
    if (target.includes('/api/workbench/reviewer-roster?')) {
      return Promise.resolve(response({
        success: true,
        active: [reviewer],
        excluded: [],
        ineligible: [],
        blocked: [],
        savedKeys: [],
        allNames: [reviewer.name],
      }));
    }
    if (target === '/api/workbench/reviewer-roster' && options.method === 'PATCH') {
      patchBody = JSON.parse(options.body);
      return Promise.resolve(response({
        success: true,
        candidate: {
          ...reviewer,
          website,
          websiteSource: 'manual',
          websitePersistAllowed: true,
          manualContactFields: ['website'],
          serverIdentityReviewReason: 'manual_contact_changed',
          contactEnrichment: {
            website,
            websiteSource: 'manual',
            websitePersistAllowed: true,
          },
        },
      }));
    }
    throw new Error(`unexpected fetch ${target} ${options.method || 'GET'}`);
  });

  render(<ReviewerSearchSection requestId={REQ} blobUrl="blob" proposalKey="proposal" />);
  fireEvent.click(await screen.findByRole('button', { name: /edit contact/i }));
  fireEvent.change(screen.getByText('Website').parentElement.querySelector('input'), {
    target: { value: website },
  });
  const localEmailEdit = 'REINERS@ARIZONA.EDU';
  fireEvent.change(screen.getByText('Email').parentElement.querySelector('input'), {
    target: { value: localEmailEdit },
  });
  fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

  expect(await screen.findByText(/contact details saved to this request/i)).toBeInTheDocument();
  expect(patchBody).toEqual({
    requestId: REQ,
    action: 'update_contact_draft',
    candidateKey: reviewer.candidateKey,
    updates: { website },
  });
  expect(screen.getByRole('button', { name: /confirm identity/i })).toBeInTheDocument();
  expect(screen.queryByLabelText(`Select ${reviewer.name}`)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /confirm identity/i }));
  expect(screen.getByDisplayValue(website)).toBeInTheDocument();
  expect(screen.getByDisplayValue(localEmailEdit)).toBeInTheDocument();
});

test('verify contact sends every confirmation-bound field and promotes the server-authoritative candidate', async () => {
  const staleConfirmation = {
    confirmationId: 'confirmation-old',
    source: 'staff_confirmed',
    normalizedName: 'tatiana kutateladze',
    email: 'tatiana@example.edu',
    website: 'https://example.edu/old-profile',
    affiliation: 'Old Department',
  };
  const reviewer = {
    ...candidate('Tatiana Kutateladze', 'tatiana@example.edu'),
    candidateKey: 'candidate:tatiana',
    website: staleConfirmation.website,
    affiliation: staleConfirmation.affiliation,
    addressTrustReceipt: null,
    addressVerificationRequired: true,
    pdIdentityConfirmed: true,
    pdIdentityConfirmationId: staleConfirmation.confirmationId,
    staffIdentityConfirmation: staleConfirmation,
  };
  const verifiedCandidate = {
    ...reviewer,
    website: 'https://example.edu/current-profile',
    affiliation: 'Current Department',
    addressVerificationRequired: false,
    addressTrustReceipt: {
      receiptId: 'receipt-current',
      personConfirmed: true,
      email: reviewer.email,
    },
    pdIdentityConfirmationId: 'confirmation-current',
    staffIdentityConfirmation: {
      ...staleConfirmation,
      confirmationId: 'confirmation-current',
      website: 'https://example.edu/current-profile',
      affiliation: 'Current Department',
    },
  };
  let addressBody;
  let saveBody;
  global.fetch = jest.fn((url, options = {}) => {
    const target = String(url);
    if (target.includes('/api/workbench/reviewer-roster?')) {
      return Promise.resolve(response({
        success: true,
        active: [reviewer],
        excluded: [],
        ineligible: [],
        blocked: [],
        savedKeys: [],
        allNames: [reviewer.name],
      }));
    }
    if (target === '/api/workbench/reviewer-address-trust') {
      addressBody = JSON.parse(options.body);
      return Promise.resolve(response({ success: true, candidate: verifiedCandidate }));
    }
    if (target === '/api/reviewer-finder/save-candidates') {
      saveBody = JSON.parse(options.body);
      return Promise.resolve(response({
        success: true,
        savedCount: 1,
        savedNames: [reviewer.name],
        savedKeys: [reviewerSaveKey(verifiedCandidate)],
      }));
    }
    throw new Error(`unexpected fetch ${target} ${options.method || 'GET'}`);
  });

  render(<ReviewerSearchSection requestId={REQ} blobUrl="blob" proposalKey="proposal" />);
  fireEvent.click(await screen.findByRole('button', { name: /verify address/i }));
  fireEvent.change(screen.getByText('Affiliation').parentElement.querySelector('input'), { target: { value: 'Current Department' } });
  const websiteLabel = screen.getAllByText('Website').find((element) => element.tagName === 'LABEL');
  fireEvent.change(websiteLabel.parentElement.querySelector('input'), { target: { value: 'https://example.edu/current-profile' } });
  fireEvent.click(screen.getByLabelText(/belongs to this person — I checked the evidence below/i));
  fireEvent.change(screen.getByText('Evidence link').parentElement.querySelector('input'), { target: { value: 'https://example.edu/current-profile' } });
  fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

  expect(await screen.findByText(/exact person and address verified/i)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /add 1 selected to invite/i }));
  await waitFor(() => expect(saveBody).toBeDefined());

  expect(addressBody).toMatchObject({
    email: reviewer.email,
    verifiedContact: {
      website: 'https://example.edu/current-profile',
      affiliation: 'Current Department',
    },
  });
  expect(saveBody.candidates[0]).toMatchObject({
    website: verifiedCandidate.website,
    affiliation: verifiedCandidate.affiliation,
    pdIdentityConfirmationId: 'confirmation-current',
    staffIdentityConfirmation: {
      website: verifiedCandidate.website,
      affiliation: verifiedCandidate.affiliation,
    },
  });
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
  fireEvent.click(screen.getByRole('button', { name: /Reconsider/i }));

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
  fireEvent.click(screen.getByRole('button', { name: /add 1 selected to invite/i }));

  expect(await screen.findByText(/Saved 1 of 1/i)).toBeInTheDocument();
  expect(screen.getByText(/Find roster could not be finalized/i)).toBeInTheDocument();
  expect(screen.getByLabelText(`Select ${saved.name}`)).toBeInTheDocument();
  expect(rosterLoads).toBe(2);
});

test('expired verification refresh targets only the indexed roster card when another submitted card shares its save key', async () => {
  const primary = {
    ...candidate('Dr Expired Collision', 'expired-collision@example.edu'),
    candidateKey: 'openalex:expired-primary',
    openAlexId: 'expired-primary',
    automatedIdentityAttestation: 'expired-token',
  };
  const sibling = {
    ...candidate('Expired Collision', 'expired-collision@example.edu'),
    candidateKey: 'openalex:expired-sibling',
    openAlexId: 'expired-sibling',
  };
  const sharedSaveKey = reviewerSaveKey(primary);
  expect(reviewerSaveKey(sibling)).toBe(sharedSaveKey);
  let enrichmentBody;
  global.fetch = jest.fn((url, options = {}) => {
    const target = String(url);
    if (target.includes('/api/workbench/reviewer-roster?')) {
      return Promise.resolve(response({
        success: true,
        active: [primary, sibling],
        excluded: [],
        ineligible: [],
        blocked: [],
        savedKeys: [],
        allNames: [primary.name, sibling.name],
      }));
    }
    if (target === '/api/reviewer-finder/save-candidates') {
      return Promise.resolve(response({
        success: false,
        savedCount: 0,
        savedKeys: [],
        results: [{
          name: primary.name,
          candidateKey: sharedSaveKey,
          index: 0,
          outcome: 'failed',
          code: 'identity_attestation_required',
        }],
      }, false, 422));
    }
    if (target === '/api/reviewer-finder/enrich-contacts') {
      enrichmentBody = JSON.parse(options.body);
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
          ...primary,
          email: 'fresh-expired-collision@example.edu',
          automatedIdentityAttestation: 'fresh-token',
          contactEnrichment: {
            email: 'fresh-expired-collision@example.edu',
            emailSource: 'orcid',
          },
        }],
      },
    });
  });

  render(<ReviewerSearchSection requestId={REQ} blobUrl="blob" proposalKey="proposal" />);
  fireEvent.click(await screen.findByLabelText(`Select ${primary.name}`));
  fireEvent.click(screen.getByLabelText(`Select ${sibling.name}`));
  fireEvent.click(screen.getByRole('button', { name: /add 2 selected to invite/i }));

  expect(await screen.findByText(/Contact verification was refreshed for 1 reviewer/i)).toBeInTheDocument();
  expect(enrichmentBody.candidates).toHaveLength(1);
  expect(enrichmentBody.candidates[0].candidateKey).toBe(primary.candidateKey);
  expect(screen.getByLabelText(`Select ${sibling.name}`)).toBeInTheDocument();
  expect(screen.getByLabelText(`Select ${sibling.name}`)).toBeChecked();
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
  fireEvent.click(screen.getByRole('button', { name: /add 1 selected to invite/i }));

  expect(await screen.findByText(/Contact verification was refreshed for 1 reviewer/i)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /fresh@example.edu/i })).toBeInTheDocument();
  expect(screen.queryByLabelText(`Select ${expired.name}`)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: /verify address/i })).toBeInTheDocument();
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
  fireEvent.click(screen.getByRole('button', { name: /add 2 selected to invite/i }));

  expect(await screen.findByText(/Saved 1 of 2/i)).toBeInTheDocument();
  expect(screen.queryByText(saved.name)).not.toBeInTheDocument();
  expect(screen.getByText(expired.name)).toBeInTheDocument();
  expect(screen.queryByLabelText(`Select ${expired.name}`)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: /verify address/i })).toBeInTheDocument();
  expect(screen.getByText(/Contact verification was refreshed for 1 reviewer/i)).toBeInTheDocument();
});
