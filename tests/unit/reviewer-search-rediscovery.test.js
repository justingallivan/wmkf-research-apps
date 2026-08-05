/**
 * @jest-environment jsdom
 *
 * ReviewerSearchSection — re-discovery reconciliation (S401). A roster/search
 * candidate whose identity anchors match an ENGAGED saved-pool row must leave
 * the selectable results and appear in the "Already handled" section as a
 * "Re-found by search" entry, instead of rendering as a fully invitable card
 * (the Kwong confusion, 2026-08-04). Matching is anchor-based, so a name
 * variant that beat discovery's exact-name exclusion filter is still caught.
 */
import { render, screen, waitFor } from '@testing-library/react';
import ReviewerSearchSection from '../../shared/components/reviewers/ReviewerSearchSection';

jest.mock('../../shared/components/reviewers/sse', () => ({
  readSseStream: jest.fn(),
}));

const REQ = 'aaaaaaaa-1111-1111-1111-111111111111';

// Saved pool row (my-candidates DTO shape): already invited, ORCID-anchored.
const savedInvitedKwong = {
  suggestionId: 'sug-kwong',
  potentialReviewerId: 'person-kwong',
  name: 'Christopher K. Kwong',
  affiliation: 'UCSF',
  orcidUrl: 'https://orcid.org/0000-0001-2345-678X',
  email: 'kwong@ucsf.edu',
  invited: true,
  accepted: false,
  declined: false,
};

// Durable roster row for the same person under a DIFFERENT name spelling —
// exactly the shape the exclusion union misses (normalized names differ).
const rosterTwin = {
  name: 'C. Kwong',
  affiliation: 'University of California, San Francisco',
  orcid: '0000-0001-2345-678X',
  provenance: { kind: 'literature_retrieved', sources: ['pubmed'] },
};

function rosterResponse(active) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      success: true,
      active,
      excluded: [],
      ineligible: [],
      blocked: [],
      handled: [],
      savedKeys: [],
      allNames: active.map((c) => c.name),
    }),
  };
}

afterEach(() => {
  jest.clearAllMocks();
});

test('a re-discovered already-invited person collapses into Already handled instead of an invitable card', async () => {
  global.fetch = jest.fn((url) => {
    const u = String(url);
    if (u.includes('/api/workbench/reviewer-roster')) {
      return Promise.resolve(rosterResponse([rosterTwin]));
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
  });

  render(
    <ReviewerSearchSection
      requestId={REQ}
      blobUrl={null}
      savedPool={[savedInvitedKwong]}
    />,
  );

  // The collapsed entry renders under Already handled with the saved row's
  // canonical name, stage label, and the re-found marker.
  await waitFor(() => expect(screen.getByText('Already handled')).toBeInTheDocument());
  expect(screen.getByText('Christopher K. Kwong')).toBeInTheDocument();
  expect(screen.getByText('Re-found by search')).toBeInTheDocument();
  expect(screen.getByText('already invited (pending)')).toBeInTheDocument();

  // Not an actionable card: no selection checkbox exists for this person.
  expect(screen.queryByLabelText('Select C. Kwong')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Select Christopher K. Kwong')).not.toBeInTheDocument();
});

test('an unengaged saved pool leaves the roster candidate selectable (no collapse)', async () => {
  global.fetch = jest.fn((url) => {
    const u = String(url);
    if (u.includes('/api/workbench/reviewer-roster')) {
      return Promise.resolve(rosterResponse([rosterTwin]));
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
  });

  render(
    <ReviewerSearchSection
      requestId={REQ}
      blobUrl={null}
      savedPool={[{ ...savedInvitedKwong, invited: false }]}
    />,
  );

  // The roster candidate renders as a normal results card (no collapse):
  // present by its own surfaced name, no re-found marker, no handled section.
  await waitFor(() => expect(screen.getByText('C. Kwong')).toBeInTheDocument());
  expect(screen.queryByText('Re-found by search')).not.toBeInTheDocument();
  expect(screen.queryByText('Already handled')).not.toBeInTheDocument();
});
