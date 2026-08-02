/**
 * @jest-environment jsdom
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ReviewerSearchSection, {
  CandidateCard,
  buildEvidencePlansByCandidateKey,
  projectEvidenceCheck,
} from '../../shared/components/reviewers/ReviewerSearchSection';

const REQ_A = 'aaaaaaaa-1111-1111-1111-111111111111';
const REQ_B = 'bbbbbbbb-2222-2222-2222-222222222222';

function plan(candidateKey, currentStages, evidenceCheckedDates) {
  return { candidateKey, currentStages, evidenceCheckedDates };
}

function snapshot(requestId, candidatePlans) {
  return {
    requestId,
    authorityState: 'current',
    data: { warmValidation: { candidatePlans } },
  };
}

function candidate(candidateKey, name = 'Dr Evidence') {
  return {
    candidateKey,
    name,
    affiliation: 'Example University',
    identityStatus: 'confirmed',
    sources: ['pubmed'],
    publications: [],
  };
}

function evidenceSummaryMatcher(date) {
  return (_content, element) => (
    element?.tagName === 'P'
    && element.textContent === `Evidence checked as of ${date}`
  );
}

test('renders the conservative evidence date and accessible per-stage details from the server plan', () => {
  const subject = candidate('person:alpha');
  const evidenceCheck = projectEvidenceCheck(subject, buildEvidencePlansByCandidateKey(
    snapshot(REQ_A, [plan('person:alpha', ['identity', 'contact', 'not_a_stage'], {
      identity: '2026-08-01T12:00:00.000Z',
      contact: '2026-07-01T12:00:00.000Z',
      not_a_stage: '2020-01-01T00:00:00.000Z',
    })]),
    REQ_A,
  ));

  render(<CandidateCard candidate={subject} checked={false} onToggle={jest.fn()} evidenceCheck={evidenceCheck} />);

  expect(screen.getByText(evidenceSummaryMatcher('2026-07-01T12:00:00.000Z'))).toBeInTheDocument();
  expect(screen.queryByText(/information current as of/i)).not.toBeInTheDocument();
  const details = screen.getByText('Evidence checked by stage').closest('details');
  expect(details).not.toHaveAttribute('open');
  fireEvent.click(screen.getByText('Evidence checked by stage'));
  expect(screen.getByText('Identity')).toBeInTheDocument();
  expect(screen.getByText('Contact')).toBeInTheDocument();
  expect(screen.queryByText('not_a_stage')).not.toBeInTheDocument();
});

test('omits the evidence claim when current stages have only missing or invalid dates', () => {
  const subject = candidate('person:invalid');
  const evidenceCheck = projectEvidenceCheck(subject, buildEvidencePlansByCandidateKey(
    snapshot(REQ_A, [plan('person:invalid', ['identity', 'contact'], {
      identity: '2026-08-01',
      contact: 'not-a-date',
    })]),
    REQ_A,
  ));

  expect(evidenceCheck).toBeNull();
  render(<CandidateCard candidate={subject} checked={false} onToggle={jest.fn()} evidenceCheck={evidenceCheck} />);
  expect(screen.queryByText(/Evidence checked as of/)).not.toBeInTheDocument();
});

test('joins same-name candidates only by their distinct canonical candidate keys', () => {
  const plans = buildEvidencePlansByCandidateKey(snapshot(REQ_A, [
    plan('person:one', ['identity'], { identity: '2026-08-01T00:00:00.000Z' }),
    plan('person:two', ['identity'], { identity: '2026-07-01T00:00:00.000Z' }),
  ]), REQ_A);

  expect(projectEvidenceCheck(candidate('person:one', 'Dr Same Name'), plans)?.summaryDate)
    .toBe('2026-08-01T00:00:00.000Z');
  expect(projectEvidenceCheck(candidate('person:two', 'Dr Same Name'), plans)?.summaryDate)
    .toBe('2026-07-01T00:00:00.000Z');
  expect(projectEvidenceCheck(candidate('person:missing', 'Dr Same Name'), plans)).toBeNull();
});

test('a request switch never paints the prior request evidence dates', async () => {
  global.fetch = jest.fn(() => {
    throw new Error('parent-owned roster snapshots must not fetch here');
  });
  const subject = candidate('person:alpha');
  const snapshotA = {
    ...snapshot(REQ_A, [plan('person:alpha', ['identity'], { identity: '2026-08-01T00:00:00.000Z' })]),
    data: {
      active: [subject], excluded: [], ineligible: [], blocked: [], handled: [], savedKeys: [], allNames: [subject.name],
      warmValidation: { candidatePlans: [plan('person:alpha', ['identity'], { identity: '2026-08-01T00:00:00.000Z' })] },
    },
  };
  const { rerender } = render(
    <ReviewerSearchSection requestId={REQ_A} blobUrl={null} proposalKey={null} displayOnly rosterSnapshot={snapshotA} />,
  );
  expect(await screen.findByText(evidenceSummaryMatcher('2026-08-01T00:00:00.000Z'))).toBeInTheDocument();

  rerender(
    <ReviewerSearchSection requestId={REQ_B} blobUrl={null} proposalKey={null} displayOnly rosterSnapshot={snapshotA} />,
  );
  await waitFor(() => expect(screen.queryByText(/Evidence checked as of/)).not.toBeInTheDocument());
  expect(global.fetch).not.toHaveBeenCalled();
});
