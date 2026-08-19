/**
 * @jest-environment jsdom
 *
 * Institution-mismatch banner copy (S400 increment E).
 *
 * Pins the two honesty fixes on the card banner:
 *  1. Attribution: applicant-referred rows say "The applicant listed" while
 *     generated rows use source-neutral staff language.
 *  2. No fabricated counter-evidence: when the needs-review DTO withholds
 *     the matched affiliation (it is null), the banner must not claim
 *     "PubMed shows a different institution." When an affiliation is present,
 *     the evidence institution is still named without leaking pipeline terms.
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

let activeCandidates;

beforeEach(() => {
  delete process.env.NEXT_PUBLIC_INSTITUTION_STAGE2_PRESENTATION;
  activeCandidates = [APPLICANT_MISMATCH, SEARCH_MISMATCH];
  global.fetch = jest.fn((url, options = {}) => {
    const target = String(url);
    if (target.includes('/api/workbench/reviewer-roster?')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          active: activeCandidates,
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
  delete process.env.NEXT_PUBLIC_INSTITUTION_STAGE2_PRESENTATION;
});

test('Stage 2 historical copy replaces the legacy mismatch accusation without changing the held card', async () => {
  process.env.NEXT_PUBLIC_INSTITUTION_STAGE2_PRESENTATION = 'on';
  activeCandidates = [{
    ...APPLICANT_MISMATCH,
    name: 'Dr Historical Move',
    reasoning: null,
    institutionPresentation: {
      version: 'institution-stage2-presentation/v1',
      visible: true,
      kind: 'historical',
      tone: 'neutral',
      heading: 'Earlier affiliation',
      detail: 'Earlier work lists Old University; the recorded affiliation is New University. No institution correction is required from this evidence alone.',
      relationship: 'distinct',
      evidenceContext: 'historical_difference',
      remedies: [],
      legacyHold: true,
    },
  }];

  render(<ReviewerSearchSection requestId={REQ} blobUrl="blob-a" proposalKey="proposal-a" />);
  await screen.findByText('Dr Historical Move');

  expect(screen.getByText(/Earlier affiliation:/)).toBeInTheDocument();
  expect(screen.getByText(/No institution correction is required/)).toBeInTheDocument();
  expect(screen.queryByText(/Institution needs review:/)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: /not a fit: Dr Historical Move/i })).toBeInTheDocument();
});

test('Stage 2 provider failure exposes the existing retry-enrichment action', async () => {
  process.env.NEXT_PUBLIC_INSTITUTION_STAGE2_PRESENTATION = 'on';
  activeCandidates = [{
    ...APPLICANT_MISMATCH,
    name: 'Dr Retry Institution',
    reasoning: null,
    applicantKnownReviewer: { status: 'known' },
    institutionPresentation: {
      version: 'institution-stage2-presentation/v1',
      visible: true,
      kind: 'provider_failure',
      tone: 'warning',
      heading: 'Institution comparison unavailable',
      detail: 'The institution service could not complete the comparison. Retry enrichment; this is not a confirmed mismatch.',
      relationship: 'unresolved',
      evidenceContext: 'unresolved',
      remedies: ['retry_enrichment'],
      legacyHold: true,
    },
  }];

  render(<ReviewerSearchSection requestId={REQ} blobUrl="blob-a" proposalKey="proposal-a" />);
  await screen.findByText('Dr Retry Institution');

  expect(screen.getByText(/Institution comparison unavailable:/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /retry enrichment/i })).toBeInTheDocument();
  expect(screen.queryByText(/Institution needs review:/)).not.toBeInTheDocument();
});

test('turning Stage 2 off restores the legacy banner even when cached presentation data exists', async () => {
  activeCandidates = [{
    ...APPLICANT_MISMATCH,
    institutionPresentation: {
      version: 'institution-stage2-presentation/v1',
      visible: true,
      kind: 'historical',
      tone: 'neutral',
      heading: 'Earlier affiliation',
      detail: 'This stale typed presentation must not render while the flag is off.',
      relationship: 'distinct',
      evidenceContext: 'historical_difference',
      remedies: [],
      legacyHold: true,
    },
  }];

  render(<ReviewerSearchSection requestId={REQ} blobUrl="blob-a" proposalKey="proposal-a" />);
  await screen.findByText('Dr Applicant Referred');

  expect(screen.getByText(/Institution needs review:/)).toBeInTheDocument();
  expect(screen.queryByText(/Earlier affiliation:/)).not.toBeInTheDocument();
});

test('applicant-referred mismatch banner attributes the applicant and never fabricates a counter-institution', async () => {
  render(<ReviewerSearchSection requestId={REQ} blobUrl="blob-a" proposalKey="proposal-a" />);
  await screen.findByText('Dr Applicant Referred');

  const attribution = await screen.findByText(/The applicant listed/);
  expect(attribution).toBeInTheDocument();
  expect(screen.queryByText(/a different institution/)).not.toBeInTheDocument();
  expect(screen.getByText(/retrieved publications could not be reconciled with it/)).toBeInTheDocument();
  expect(screen.getByText(/Why this needs review:/).parentElement).toHaveTextContent('Could not confirm this is the right person');
  expect(screen.queryByText(/Suggested because:/)).not.toBeInTheDocument();
  expect(screen.getByText(/retry enrichment after the linked reviewer record is repaired/i)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /confirm identity for Dr Applicant Referred/i })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: /not a fit: Dr Applicant Referred/i })).toBeInTheDocument();
});

test('non-applicant mismatch uses source-neutral attribution and names the evidence institution neutrally', async () => {
  render(<ReviewerSearchSection requestId={REQ} blobUrl="blob-a" proposalKey="proposal-a" />);
  await screen.findByText('Dr Search Result');

  expect(await screen.findByText(/The suggestion listed/)).toBeInTheDocument();
  // Source-neutral phrasing: the displayed affiliation may be ORCID/OpenAlex-
  // sourced, so the banner must not attribute it to PubMed (Codex S400
  // review, MEDIUM).
  expect(screen.getByText(/linked evidence shows/)).toBeInTheDocument();
  expect(screen.queryByText(/PubMed shows/)).not.toBeInTheDocument();
  expect(screen.getByText('Northwestern University Feinberg School of Medicine')).toBeInTheDocument();
});
