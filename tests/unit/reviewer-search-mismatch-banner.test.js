/**
 * @jest-environment jsdom
 *
 * Institution-mismatch banner copy (S400 increment E).
 *
 * Pins the two honesty fixes on the card banner:
 *  1. Attribution: applicant-referred rows say "The applicant listed" —
 *     the suggestion came from the applicant's form, not Claude (Codex S400
 *     verification finding).
 *  2. No fabricated counter-evidence: when the needs-review DTO withholds
 *     the matched affiliation (it is null), the banner must not claim
 *     "PubMed shows a different institution"; it defers to the identity note.
 *     When an affiliation IS present, the "PubMed shows <first segment>"
 *     form is preserved.
 */

import { render, screen } from '@testing-library/react';
import ReviewerSearchSection from '../../shared/components/reviewers/ReviewerSearchSection';

const REQ = 'aaaaaaaa-1111-1111-1111-111111111111';

const APPLICANT_MISMATCH = {
  name: 'Dr Applicant Referred',
  suggestionId: '2320281c-fd68-f111-a826-000d3a3065b8',
  candidateKey: 'suggestion:2320281c-fd68-f111-a826-000d3a3065b8',
  isApplicantRecommended: true,
  enrichedProposalKey: 'proposal-a',
  identityStatus: 'unresolved',
  needsIdentification: true,
  institutionMismatch: true,
  suggestedInstitution: 'University of California San Diego',
  affiliation: null,
  reasoning: 'Could not confirm this is the right person because the matched publications place them at “X”, which could not be reconciled with the listed “Y”. Confirm or correct the identity before selecting this reviewer.',
};

const SEARCH_MISMATCH = {
  name: 'Dr Search Result',
  identityStatus: 'probable',
  institutionMismatch: true,
  suggestedInstitution: 'Texas A&M University',
  affiliation: 'Northwestern University Feinberg School of Medicine, Chicago, IL',
};

beforeEach(() => {
  global.fetch = jest.fn((url, options = {}) => {
    const target = String(url);
    if (target.includes('/api/workbench/reviewer-roster?')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          active: [APPLICANT_MISMATCH, SEARCH_MISMATCH],
          excluded: [],
          allNames: [APPLICANT_MISMATCH.name, SEARCH_MISMATCH.name],
        }),
      });
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true, recommended: [] }), body: null });
  });
});

afterEach(() => {
  jest.clearAllMocks();
});

test('applicant-referred mismatch banner attributes the applicant and never fabricates a counter-institution', async () => {
  render(<ReviewerSearchSection requestId={REQ} blobUrl="blob-a" proposalKey="proposal-a" />);
  await screen.findByText('Dr Applicant Referred');

  const attribution = await screen.findByText(/The applicant listed/);
  expect(attribution).toBeInTheDocument();
  expect(screen.queryByText(/a different institution/)).not.toBeInTheDocument();
  expect(screen.getByText(/could not be reconciled with it — see the identity note/)).toBeInTheDocument();
});

test('non-applicant mismatch with a present affiliation keeps Claude attribution and names the PubMed institution', async () => {
  render(<ReviewerSearchSection requestId={REQ} blobUrl="blob-a" proposalKey="proposal-a" />);
  await screen.findByText('Dr Search Result');

  expect(await screen.findByText(/Claude suggested/)).toBeInTheDocument();
  expect(screen.getByText('Northwestern University Feinberg School of Medicine')).toBeInTheDocument();
});
