/**
 * @jest-environment jsdom
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ReviewerSearchSection, {
  applicantAnchorRepairTarget,
  CandidateCard,
  buildEvidencePlansByCandidateKey,
  projectEvidenceCheck,
  reviewerStageInFlightKey,
  reviewerStageRefreshTarget,
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

test('stage refresh in-flight ownership is candidate-wide rather than stage-local', () => {
  const common = {
    requestId: REQ_A,
    candidateKey: SUGGESTION_KEY,
    generation: 7,
  };
  expect(reviewerStageInFlightKey({ ...common, stage: 'contact' })).toBe(
    reviewerStageInFlightKey({ ...common, stage: 'eligibility' }),
  );
  expect(reviewerStageInFlightKey({ ...common, stage: 'contact' })).not.toBe(
    reviewerStageInFlightKey({ ...common, generation: 8, stage: 'contact' }),
  );
});

function deferred() {
  let resolve; let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
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

test('shows signed legacy selection evidence as-of and suppresses the per-stage refresh action', () => {
  const subject = {
    ...candidate('person:legacy-selection', 'Dr Legacy Selection'),
    rosterUpdatedAt: '2026-08-02 12:00:00+00',
    email: 'legacy.selection@example.edu',
    emailSource: 'scholarly_multi',
    emailPersistAllowed: true,
    provenance: { kind: 'proposal_named' },
  };
  const legacyPlan = {
    candidateKey: subject.candidateKey,
    cacheOutcome: 'miss',
    currentStages: [],
    pendingStages: [],
    refreshes: [{ stage: 'identity', reason: 'warm_cache_version_changed' }],
    promotionAuthority: 'blocked_refresh_required',
    legacySelection: {
      version: 1,
      state: 'selectable',
      evidenceCheckedAt: '2026-07-29T00:00:00.000Z',
    },
  };

  render(
    <ReviewerSearchSection
      requestId={REQ_A}
      blobUrl={null}
      proposalKey={null}
      displayOnly
      rosterSnapshot={repairSnapshot(REQ_A, subject, legacyPlan)}
    />,
  );

  expect(screen.getByText(
    'Selection evidence current as of 2026-07-29T00:00:00.000Z; current contact and conflict checks run automatically when promoted.',
  )).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Refresh identity evidence/i })).not.toBeInTheDocument();
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
    kind: 'refresh',
    candidateKey: SUGGESTION_KEY,
    expectedUpdatedAt: '2026-08-02 12:00:00+00',
    stage: 'applicant_anchor',
    reason: 'candidate_input_changed',
  });
  expect(applicantAnchorRepairTarget(
    applicantCandidate({ name: 'Dr Same Name', candidateKey: 'person:another' }),
    applicantAnchorPlan({ candidateKey: 'person:another' }),
  )).toMatchObject({ candidateKey: 'person:another', stage: 'applicant_anchor' });
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
  )).toMatchObject({ candidateKey: SUGGESTION_KEY, stage: 'applicant_anchor' });
});

test('chooses one recognized warm-plan action in dependency order and reserves structured address trust', () => {
  const subject = applicantCandidate();
  expect(reviewerStageRefreshTarget(subject, applicantAnchorPlan({
    refreshes: [
      { stage: 'contact', reason: 'stage_missing' },
      { stage: 'institution_domains', reason: 'stage_missing' },
    ],
  }))).toMatchObject({ kind: 'refresh', stage: 'institution_domains', candidateKey: SUGGESTION_KEY });
  expect(reviewerStageRefreshTarget(subject, applicantAnchorPlan({
    refreshes: [{ stage: 'identity', reason: 'stage_missing' }],
  }))).toMatchObject({ kind: 'refresh', stage: 'identity' });
  expect(reviewerStageRefreshTarget(subject, applicantAnchorPlan({
    refreshes: [{ stage: 'address_trust', reason: 'stage_missing' }],
  }))).toMatchObject({ kind: 'dedicated', stage: 'address_trust' });
  expect(reviewerStageRefreshTarget(subject, applicantAnchorPlan({
    pendingStages: ['contact'],
    refreshes: [],
  }))).toMatchObject({ kind: 'pending', stage: 'contact', candidateKey: SUGGESTION_KEY });
  expect(reviewerStageRefreshTarget(subject, applicantAnchorPlan({
    refreshes: [
      { stage: 'applicant_anchor', reason: 'candidate_input_changed', action: 'refresh_stage' },
      { stage: 'contact', reason: 'prior_refresh_incomplete', action: 'recover_expired_lease' },
    ],
  }))).toMatchObject({ kind: 'refresh', stage: 'contact', candidateKey: SUGGESTION_KEY });
  expect(reviewerStageRefreshTarget(subject, applicantAnchorPlan({
    refreshes: [{ stage: 'contact', reason: 'warm_cache_version_changed', action: 'recover_expired_lease' }],
  }))).toMatchObject({ kind: 'invalid', candidateKey: SUGGESTION_KEY });
  expect(reviewerStageRefreshTarget(subject, applicantAnchorPlan({
    refreshes: [{ stage: 'contact', reason: 'prior_refresh_incomplete', action: 'recover_expired_lease' }],
  }))).toMatchObject({ kind: 'refresh', stage: 'contact', candidateKey: SUGGESTION_KEY });
  expect(reviewerStageRefreshTarget(subject, applicantAnchorPlan({
    leaseRepairRequired: true,
    refreshes: [{ stage: 'contact', reason: 'stage_incomplete', action: 'operator_repair_required' }],
  }))).toMatchObject({ kind: 'operator_repair', candidateKey: SUGGESTION_KEY });
  expect(reviewerStageRefreshTarget(subject, applicantAnchorPlan({
    refreshes: [{ stage: 'roster_persistence', reason: 'stage_missing' }],
  }))).toMatchObject({ kind: 'reserved', stage: 'roster_persistence' });
  expect(reviewerStageRefreshTarget(subject, applicantAnchorPlan({
    refreshes: [{
      stage: 'roster_persistence', reason: 'stage_missing', action: 'finalize_cached_evidence',
    }],
  }))).toMatchObject({ kind: 'refresh', stage: 'roster_persistence' });
});

test('projects a server pending refresh onto the named candidate stage without crashing', () => {
  const subject = applicantCandidate();
  render(
    <ReviewerSearchSection
      requestId={REQ_A}
      blobUrl={null}
      proposalKey={null}
      displayOnly
      rosterSnapshot={repairSnapshot(REQ_A, subject, applicantAnchorPlan({
        pendingStages: ['contact'],
        refreshes: [],
      }))}
    />,
  );

  expect(screen.getByText(/Contact evidence needs a server action/i)).toBeInTheDocument();
  expect(screen.getByText(/refresh is already in progress/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Reload reviewer status' })).toBeInTheDocument();
});

test('keeps a malformed warm lease repair-only and never posts the generic refresh', () => {
  const subject = applicantCandidate();
  const onRetryRoster = jest.fn();
  global.fetch = jest.fn();

  render(
    <ReviewerSearchSection
      requestId={REQ_A}
      blobUrl={null}
      proposalKey={null}
      displayOnly
      rosterSnapshot={repairSnapshot(REQ_A, subject, applicantAnchorPlan({
        leaseRepairRequired: true,
        refreshes: [],
      }))}
      onRetryRoster={onRetryRoster}
    />,
  );

  expect(screen.getByText(/malformed lease data and cannot be retried automatically/i)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Refresh contact evidence/i })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Reload reviewer status' }));
  expect(onRetryRoster).toHaveBeenCalledTimes(1);
  expect(global.fetch).not.toHaveBeenCalled();
});

test('submits the server-named expired lease owner and reloads after same-stage recovery', async () => {
  const subject = applicantCandidate();
  const onRetryRoster = jest.fn();
  global.fetch = jest.fn(async () => ({
    ok: false,
    status: 503,
    json: async () => ({
      candidateKey: SUGGESTION_KEY,
      requestedStage: 'contact',
      outcome: 'failed_retryable',
      stageState: 'incomplete',
      reasonCode: 'prior_refresh_incomplete',
    }),
  }));

  render(
    <ReviewerSearchSection
      requestId={REQ_A}
      blobUrl={null}
      proposalKey={null}
      displayOnly
      rosterSnapshot={repairSnapshot(REQ_A, subject, applicantAnchorPlan({
        refreshes: [
          { stage: 'applicant_anchor', reason: 'candidate_input_changed', action: 'refresh_stage' },
          { stage: 'contact', reason: 'prior_refresh_incomplete', action: 'recover_expired_lease' },
        ],
      }))}
      onRetryRoster={onRetryRoster}
    />,
  );

  fireEvent.click(await screen.findByRole('button', { name: 'Refresh contact evidence' }));
  await waitFor(() => expect(onRetryRoster).toHaveBeenCalledTimes(1));
  expect(global.fetch).toHaveBeenCalledWith('/api/workbench/reviewer-stage-refresh', expect.objectContaining({
    method: 'POST',
    body: JSON.stringify({
      requestId: REQ_A,
      candidateKey: SUGGESTION_KEY,
      stage: 'contact',
      expectedUpdatedAt: '2026-08-02 12:00:00+00',
    }),
  }));
});

test('offers the applicant-anchor repair in P0 display-only mode and posts only the canonical refresh target', async () => {
  const subject = applicantCandidate({
    evidence: { forged: 'browser-must-not-send' },
    stageFreshness: { applicant_anchor: { sourceVersion: 'browser-must-not-send' } },
  });
  const onRetryRoster = jest.fn();
  global.fetch = jest.fn(async () => ({
    ok: true,
    json: async () => ({
      candidateKey: SUGGESTION_KEY,
      requestedStage: 'applicant_anchor',
      outcome: 'recorded',
      stageState: 'current',
      reasonCode: null,
    }),
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
      candidateKey: SUGGESTION_KEY,
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
    json: async () => ({
      candidateKey: SUGGESTION_KEY,
      requestedStage: 'applicant_anchor',
      outcome: 'skipped_stale',
      stageState: 'stale',
      reasonCode: 'authority_changed',
    }),
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

test('a lease-repair response from a racing refresh surfaces administrator guidance', async () => {
  const subject = applicantCandidate();
  const onRetryRoster = jest.fn();
  global.fetch = jest.fn(async () => ({
    ok: false,
    status: 409,
    json: async () => ({
      candidateKey: SUGGESTION_KEY,
      requestedStage: 'applicant_anchor',
      outcome: 'lease_repair_required',
      stageState: 'stale',
      reasonCode: 'lease_repair_required',
      leaseStage: 'contact',
    }),
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
  expect(await screen.findByText(/malformed lease data and cannot be retried automatically/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Reload reviewer status' })).toBeInTheDocument();
  expect(onRetryRoster).not.toHaveBeenCalled();
});

test('fails closed to reload guidance for an unknown server response outcome', async () => {
  const subject = applicantCandidate();
  const onRetryRoster = jest.fn();
  global.fetch = jest.fn(async () => ({
    ok: true,
    json: async () => ({
      candidateKey: SUGGESTION_KEY,
      requestedStage: 'applicant_anchor',
      outcome: 'unrecognized_outcome',
      stageState: 'current',
      reasonCode: null,
    }),
  }));
  render(
    <ReviewerSearchSection requestId={REQ_A} blobUrl={null} proposalKey={null} displayOnly rosterSnapshot={repairSnapshot(REQ_A, subject, applicantAnchorPlan())} onRetryRoster={onRetryRoster} />,
  );

  fireEvent.click(await screen.findByRole('button', { name: 'Refresh applicant input evidence' }));
  expect(await screen.findByText(/response was not recognized/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Reload reviewer status' })).toBeInTheDocument();
  expect(onRetryRoster).not.toHaveBeenCalled();
});

test('surfaces a closed 400 refresh error envelope instead of an unrecognized-response warning', async () => {
  const subject = applicantCandidate();
  const onRetryRoster = jest.fn();
  global.fetch = jest.fn(async () => ({
    ok: false,
    status: 400,
    json: async () => ({
      success: false,
      outcome: 'rejected',
      code: 'invalid_expected_updated_at',
      error: 'The reviewer refresh version is missing or invalid. Reload reviewer status before trying again.',
      message: 'The reviewer refresh version is missing or invalid. Reload reviewer status before trying again.',
      requestedStage: 'applicant_anchor',
      stageState: 'stale',
      reasonCode: 'authority_stale',
    }),
  }));
  render(
    <ReviewerSearchSection requestId={REQ_A} blobUrl={null} proposalKey={null} displayOnly rosterSnapshot={repairSnapshot(REQ_A, subject, applicantAnchorPlan())} onRetryRoster={onRetryRoster} />,
  );

  fireEvent.click(await screen.findByRole('button', { name: 'Refresh applicant input evidence' }));
  expect(await screen.findByText(/refresh version is missing or invalid/i)).toBeInTheDocument();
  expect(screen.getByText(/Code: invalid_expected_updated_at/i)).toBeInTheDocument();
  expect(screen.queryByText(/response was not recognized/i)).not.toBeInTheDocument();
  expect(onRetryRoster).not.toHaveBeenCalled();
});

test('recognizes a closed 422 refresh rejection and retains fail-closed reload guidance', async () => {
  const subject = applicantCandidate();
  const onRetryRoster = jest.fn();
  global.fetch = jest.fn(async () => ({
    ok: false,
    status: 422,
    json: async () => ({
      outcome: 'rejected',
      code: 'invalid_refresh_target',
      candidateKey: SUGGESTION_KEY,
      requestedStage: 'applicant_anchor',
      stageState: 'stale',
      reasonCode: 'invalid_refresh_target',
    }),
  }));
  render(
    <ReviewerSearchSection requestId={REQ_A} blobUrl={null} proposalKey={null} displayOnly rosterSnapshot={repairSnapshot(REQ_A, subject, applicantAnchorPlan())} onRetryRoster={onRetryRoster} />,
  );

  fireEvent.click(await screen.findByRole('button', { name: 'Refresh applicant input evidence' }));
  expect(await screen.findByText(/roster changed before this evidence refresh completed/i)).toBeInTheDocument();
  expect(screen.queryByText(/response was not recognized/i)).not.toBeInTheDocument();
  expect(onRetryRoster).not.toHaveBeenCalled();
});

test('turns malformed 400 and non-JSON 500 refresh responses into typed reload guidance', async () => {
  const subject = applicantCandidate();
  const onRetryRoster = jest.fn();
  global.fetch = jest.fn()
    .mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => { throw new SyntaxError('malformed JSON'); },
    })
    .mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => { throw new SyntaxError('not JSON'); },
    });
  const { rerender } = render(
    <ReviewerSearchSection requestId={REQ_A} blobUrl={null} proposalKey={null} displayOnly rosterSnapshot={repairSnapshot(REQ_A, subject, applicantAnchorPlan())} onRetryRoster={onRetryRoster} />,
  );

  fireEvent.click(await screen.findByRole('button', { name: 'Refresh applicant input evidence' }));
  expect(await screen.findByText(/request could not be read by the server/i)).toBeInTheDocument();

  rerender(
    <ReviewerSearchSection requestId={REQ_B} blobUrl={null} proposalKey={null} displayOnly rosterSnapshot={repairSnapshot(REQ_B, applicantCandidate({ candidateKey: 'person:other', suggestionId: undefined }), applicantAnchorPlan({ candidateKey: 'person:other' }))} onRetryRoster={onRetryRoster} />,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Refresh applicant input evidence' }));
  expect(await screen.findByText(/evidence refresh service failed/i)).toBeInTheDocument();
  expect(screen.queryByText(/response was not recognized/i)).not.toBeInTheDocument();
  expect(onRetryRoster).not.toHaveBeenCalled();
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
    repair.resolve({
      ok: true,
      json: async () => ({
        candidateKey: SUGGESTION_KEY,
        requestedStage: 'applicant_anchor',
        outcome: 'recorded',
        stageState: 'current',
        reasonCode: null,
      }),
    });
    await repair.promise;
  });
  expect(onRetryRoster).not.toHaveBeenCalled();
  expect(screen.queryByText(/Evidence refresh recorded/i)).not.toBeInTheDocument();
});

test('a late stage refresh cannot paint stale status onto the same reusable person key after a request switch', async () => {
  const subject = {
    ...candidate('person:reusable-reviewer', 'Dr Reusable Reviewer'),
    rosterUpdatedAt: '2026-08-02 12:00:00+00',
  };
  const stagePlan = {
    candidateKey: subject.candidateKey,
    currentStages: ['identity'],
    refreshes: [{ stage: 'institution_domains', reason: 'stage_missing' }],
    pendingStages: [],
  };
  const repair = deferred();
  const onRetryRoster = jest.fn();
  global.fetch = jest.fn(() => repair.promise);

  const { rerender } = render(
    <ReviewerSearchSection
      requestId={REQ_A}
      blobUrl={null}
      proposalKey={null}
      displayOnly
      rosterSnapshot={repairSnapshot(REQ_A, subject, stagePlan, 'roster-a')}
      onRetryRoster={onRetryRoster}
    />,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Refresh institution domains evidence' }));
  expect(screen.getByRole('button', { name: 'Refreshing institution domains evidence…' })).toBeDisabled();

  await act(async () => {
    rerender(
      <ReviewerSearchSection
        requestId={REQ_B}
        blobUrl={null}
        proposalKey={null}
        displayOnly
        rosterSnapshot={repairSnapshot(REQ_B, subject, stagePlan, 'roster-b')}
        onRetryRoster={onRetryRoster}
      />,
    );
  });
  expect(await screen.findByRole('button', { name: 'Refresh institution domains evidence' })).toBeEnabled();

  await act(async () => {
    repair.resolve({
      ok: true,
      json: async () => ({
        candidateKey: subject.candidateKey,
        requestedStage: 'institution_domains',
        outcome: 'recorded',
        stageState: 'current',
        reasonCode: null,
      }),
    });
    await repair.promise;
  });

  expect(onRetryRoster).not.toHaveBeenCalled();
  expect(screen.queryByText(/Evidence refresh recorded/i)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Refresh institution domains evidence' })).toBeEnabled();
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
    repair.resolve({
      ok: true,
      json: async () => ({
        candidateKey: SUGGESTION_KEY,
        requestedStage: 'applicant_anchor',
        outcome: 'recorded',
        stageState: 'current',
        reasonCode: null,
      }),
    });
    await repair.promise;
  });
  expect(onRetryRoster).not.toHaveBeenCalled();
});

test('a request switch suppresses a late refresh error without painting stale reload guidance', async () => {
  const subject = applicantCandidate();
  const repair = deferred();
  const onRetryRoster = jest.fn();
  global.fetch = jest.fn(() => repair.promise);
  const { rerender } = render(
    <ReviewerSearchSection requestId={REQ_A} blobUrl={null} proposalKey={null} displayOnly rosterSnapshot={repairSnapshot(REQ_A, subject, applicantAnchorPlan())} onRetryRoster={onRetryRoster} />,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Refresh applicant input evidence' }));
  await act(async () => {
    rerender(
      <ReviewerSearchSection requestId={REQ_B} blobUrl={null} proposalKey={null} displayOnly rosterSnapshot={repairSnapshot(REQ_B, applicantCandidate({ candidateKey: 'person:other', suggestionId: undefined }), applicantAnchorPlan({ candidateKey: 'person:other', refreshes: [] }))} onRetryRoster={onRetryRoster} />,
    );
  });
  await act(async () => {
    repair.reject(new Error('late request failure'));
    await repair.promise.catch(() => {});
  });
  expect(onRetryRoster).not.toHaveBeenCalled();
  expect(screen.queryByText(/evidence refresh result is unknown/i)).not.toBeInTheDocument();
});

test('a prior refresh finally block cannot clear a newer generation attempt for the same candidate', async () => {
  const subject = applicantCandidate();
  const first = deferred();
  const second = deferred();
  const onRetryRoster = jest.fn();
  global.fetch = jest.fn()
    .mockImplementationOnce(() => first.promise)
    .mockImplementationOnce(() => second.promise);
  const { rerender } = render(
    <ReviewerSearchSection requestId={REQ_A} blobUrl={null} proposalKey={null} displayOnly rosterSnapshot={repairSnapshot(REQ_A, subject, applicantAnchorPlan())} onRetryRoster={onRetryRoster} />,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Refresh applicant input evidence' }));
  await act(async () => {
    rerender(
      <ReviewerSearchSection requestId={REQ_B} blobUrl={null} proposalKey={null} displayOnly rosterSnapshot={repairSnapshot(REQ_B, applicantCandidate({ candidateKey: 'person:other', suggestionId: undefined }), applicantAnchorPlan({ candidateKey: 'person:other', refreshes: [] }))} onRetryRoster={onRetryRoster} />,
    );
  });
  await act(async () => {
    rerender(
      <ReviewerSearchSection requestId={REQ_A} blobUrl={null} proposalKey={null} displayOnly rosterSnapshot={repairSnapshot(REQ_A, subject, applicantAnchorPlan())} onRetryRoster={onRetryRoster} />,
    );
  });
  fireEvent.click(await screen.findByRole('button', { name: 'Refresh applicant input evidence' }));
  await act(async () => {
    first.resolve({
      ok: true,
      json: async () => ({ candidateKey: SUGGESTION_KEY, requestedStage: 'applicant_anchor', outcome: 'recorded', stageState: 'current', reasonCode: null }),
    });
    await first.promise;
  });
  expect(screen.getByRole('button', { name: 'Refreshing applicant input evidence…' })).toBeDisabled();
  expect(onRetryRoster).not.toHaveBeenCalled();
  await act(async () => {
    second.resolve({
      ok: true,
      json: async () => ({ candidateKey: SUGGESTION_KEY, requestedStage: 'applicant_anchor', outcome: 'recorded', stageState: 'current', reasonCode: null }),
    });
    await second.promise;
  });
  expect(onRetryRoster).toHaveBeenCalledTimes(1);
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
