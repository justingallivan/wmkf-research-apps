/**
 * @jest-environment jsdom
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ReviewerSearchSection, {
  applicantAnchorRepairTarget,
  CandidateCard,
  buildEvidencePlansByCandidateKey,
  projectEvidenceCheck,
} from '../../shared/components/reviewers/ReviewerSearchSection';

const REQ_A = 'aaaaaaaa-1111-1111-1111-111111111111';
const REQ_B = 'bbbbbbbb-2222-2222-2222-222222222222';
const SUGGESTION_ID = 'cccccccc-3333-3333-3333-333333333333';
const SUGGESTION_KEY = `suggestion:${SUGGESTION_ID}`;

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

function applicantCandidate(overrides = {}) {
  return {
    ...candidate(SUGGESTION_KEY, 'Dr Applicant Evidence'),
    suggestionId: SUGGESTION_ID,
    isApplicantRecommended: true,
    provenance: { kind: 'applicant_suggested' },
    rosterUpdatedAt: '2026-08-02 12:00:00+00',
    ...overrides,
  };
}

function applicantAnchorPlan(overrides = {}) {
  return {
    candidateKey: SUGGESTION_KEY,
    currentStages: ['identity'],
    evidenceCheckedDates: { identity: '2026-08-01T12:00:00.000Z' },
    refreshes: [{ stage: 'applicant_anchor', reason: 'candidate_input_changed' }],
    pendingStages: [],
    ...overrides,
  };
}

function repairSnapshot(requestId, subject, stagePlan, rosterVersion = 'repair-roster-version') {
  return {
    requestId,
    authorityState: 'current',
    rosterVersion,
    data: {
      active: [subject],
      excluded: [],
      ineligible: [],
      blocked: [],
      handled: [],
      savedKeys: [],
      allNames: [subject.name],
      warmValidation: { candidatePlans: [stagePlan] },
    },
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
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

test('derives an applicant-anchor repair target only from the exact canonical applicant plan and server roster token', () => {
  const subject = applicantCandidate();
  expect(applicantAnchorRepairTarget(subject, applicantAnchorPlan())).toEqual({
    candidateKey: SUGGESTION_KEY,
    suggestionId: SUGGESTION_ID,
    expectedUpdatedAt: '2026-08-02 12:00:00+00',
  });
  expect(applicantAnchorRepairTarget(
    applicantCandidate({ name: 'Dr Same Name', candidateKey: 'person:another' }),
    applicantAnchorPlan({ candidateKey: 'person:another' }),
  )).toBeNull();
  expect(applicantAnchorRepairTarget(subject, applicantAnchorPlan({
    refreshes: [{ stage: 'identity', reason: 'stage_missing' }],
  }))).toBeNull();
  expect(applicantAnchorRepairTarget(subject, applicantAnchorPlan({
    pendingStages: ['applicant_anchor'],
  }))).toBeNull();
  expect(applicantAnchorRepairTarget(
    applicantCandidate({ rosterUpdatedAt: null }),
    applicantAnchorPlan(),
  )).toBeNull();
  expect(applicantAnchorRepairTarget(
    applicantCandidate({ suggestionId: 'not-a-guid' }),
    applicantAnchorPlan(),
  )).toBeNull();
});

test('offers the applicant-anchor repair in P0 display-only mode and posts only the canonical refresh target', async () => {
  const subject = applicantCandidate();
  const onRetryRoster = jest.fn();
  global.fetch = jest.fn(async () => ({
    ok: true,
    json: async () => ({ outcome: 'recorded' }),
  }));

  render(
    <ReviewerSearchSection
      requestId={REQ_A}
      blobUrl={null}
      proposalKey={null}
      displayOnly
      rosterSnapshot={repairSnapshot(REQ_A, subject, applicantAnchorPlan())}
      onRetryRoster={onRetryRoster}
    />,
  );

  const repair = await screen.findByRole('button', { name: 'Refresh applicant input evidence' });
  expect(repair).toBeEnabled();
  expect(screen.getByText(/repairs evidence only; it does not select or promote/i)).toBeInTheDocument();
  expect(screen.getByText(evidenceSummaryMatcher('2026-08-01T12:00:00.000Z'))).toBeInTheDocument();

  fireEvent.click(repair);
  await waitFor(() => expect(onRetryRoster).toHaveBeenCalledTimes(1));
  expect(global.fetch).toHaveBeenCalledWith('/api/workbench/reviewer-stage-refresh', expect.objectContaining({
    method: 'POST',
    body: JSON.stringify({
      requestId: REQ_A,
      suggestionId: SUGGESTION_ID,
      stage: 'applicant_anchor',
      expectedUpdatedAt: '2026-08-02 12:00:00+00',
    }),
  }));
  // The refresh state never clears the prior server plan before the parent
  // reloads it, so the last evidence remains visible during reconciliation.
  expect(screen.getByText(evidenceSummaryMatcher('2026-08-01T12:00:00.000Z'))).toBeInTheDocument();
});

test('a stale applicant-anchor repair surfaces reload guidance instead of retrying against the old roster token', async () => {
  const subject = applicantCandidate();
  const onRetryRoster = jest.fn();
  global.fetch = jest.fn(async () => ({
    ok: false,
    status: 409,
    json: async () => ({ outcome: 'skipped_stale' }),
  }));

  render(
    <ReviewerSearchSection
      requestId={REQ_A}
      blobUrl={null}
      proposalKey={null}
      displayOnly
      rosterSnapshot={repairSnapshot(REQ_A, subject, applicantAnchorPlan())}
      onRetryRoster={onRetryRoster}
    />,
  );

  fireEvent.click(await screen.findByRole('button', { name: 'Refresh applicant input evidence' }));
  const reload = await screen.findByRole('button', { name: 'Reload reviewer status' });
  expect(screen.getByText(/roster changed before this evidence refresh completed/i)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Refresh applicant input evidence' })).not.toBeInTheDocument();
  expect(onRetryRoster).not.toHaveBeenCalled();
  fireEvent.click(reload);
  expect(onRetryRoster).toHaveBeenCalledTimes(1);
});

test('aborts an applicant-anchor repair and suppresses its success callback after a request switch', async () => {
  const subject = applicantCandidate();
  const repair = deferred();
  const onRetryRoster = jest.fn();
  global.fetch = jest.fn(() => repair.promise);

  const { rerender } = render(
    <ReviewerSearchSection
      requestId={REQ_A}
      blobUrl={null}
      proposalKey={null}
      displayOnly
      rosterSnapshot={repairSnapshot(REQ_A, subject, applicantAnchorPlan())}
      onRetryRoster={onRetryRoster}
    />,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Refresh applicant input evidence' }));
  const signal = global.fetch.mock.calls[0][1].signal;

  await act(async () => {
    rerender(
      <ReviewerSearchSection
        requestId={REQ_B}
        blobUrl={null}
        proposalKey={null}
        displayOnly
        rosterSnapshot={repairSnapshot(REQ_B, applicantCandidate({
          candidateKey: 'person:other',
          suggestionId: undefined,
        }), applicantAnchorPlan({ candidateKey: 'person:other', refreshes: [] }))}
        onRetryRoster={onRetryRoster}
      />,
    );
  });
  expect(signal.aborted).toBe(true);

  await act(async () => {
    repair.resolve({ ok: true, json: async () => ({ outcome: 'recorded' }) });
    await repair.promise;
  });
  expect(onRetryRoster).not.toHaveBeenCalled();
  expect(screen.queryByText(/Evidence refresh recorded/i)).not.toBeInTheDocument();
});

test('aborts an applicant-anchor repair on unmount without invoking the parent reload callback', async () => {
  const subject = applicantCandidate();
  const repair = deferred();
  const onRetryRoster = jest.fn();
  global.fetch = jest.fn(() => repair.promise);

  const { unmount } = render(
    <ReviewerSearchSection
      requestId={REQ_A}
      blobUrl={null}
      proposalKey={null}
      displayOnly
      rosterSnapshot={repairSnapshot(REQ_A, subject, applicantAnchorPlan())}
      onRetryRoster={onRetryRoster}
    />,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Refresh applicant input evidence' }));
  const signal = global.fetch.mock.calls[0][1].signal;

  await act(async () => {
    unmount();
  });
  expect(signal.aborted).toBe(true);

  await act(async () => {
    repair.resolve({ ok: true, json: async () => ({ outcome: 'recorded' }) });
    await repair.promise;
  });
  expect(onRetryRoster).not.toHaveBeenCalled();
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
