/** @jest-environment node */

const {
  SMOKE_REQUEST_NUMBER,
  normalizeBaseUrl,
  validateLiveConfig,
  isAllowedBrowserRequest,
  isGuid,
  redactBrowserPath,
  summarizeRoster,
  summarizeWarmValidation,
  validateRuntimeAttestation,
  deploymentSummary,
  enrichDeploymentWithListing,
  LIVE_WARM_TIMING_BUDGETS,
  LEDGER_PHASE_MAX_WAIT_MS,
  validateWarmVisitMilestones,
  observationLogPollPlan,
  ledgerPhaseDeadline,
  summarizeLedger,
  parseVercelObservationEvents,
} = require('../../scripts/lib/reviewer-find-live-contract');

const OBSERVATION_ID = 'rfw_0123456789abcdef0123456789abcdef';
const COMMIT = '1234567890abcdef1234567890abcdef12345678';
const ROSTER_VERSION = 'a'.repeat(64);

describe('Reviewer Find live runner contract', () => {
  test('is fixed to the dedicated no-send request', () => {
    expect(SMOKE_REQUEST_NUMBER).toBe('1002914');
  });

  test('requires an exact HTTPS deployment identity and explicit production confirmation', () => {
    expect(normalizeBaseUrl('https://preview-example.vercel.app/')).toBe('https://preview-example.vercel.app');
    expect(normalizeBaseUrl('http://preview-example.vercel.app')).toBeNull();
    expect(normalizeBaseUrl('https://preview-example.vercel.app/workbench')).toBeNull();

    expect(validateLiveConfig({
      baseUrl: 'https://preview-example.vercel.app',
      deploymentId: 'dpl_abcdefgh',
      expectedCommit: COMMIT,
      deploymentClass: 'preview',
      observationId: OBSERVATION_ID,
    })).toMatchObject({ ok: true, failures: [] });
    expect(validateLiveConfig({
      baseUrl: 'https://preview-example.vercel.app',
      deploymentId: 'dpl_abcdefgh',
      expectedCommit: COMMIT,
      deploymentClass: 'production',
      observationId: OBSERVATION_ID,
    }).failures).toContain('production_confirmation_required');
  });

  test('fences browser traffic to same-origin safe methods and redacts dynamic paths', () => {
    const baseUrl = 'https://preview-example.vercel.app';
    expect(isAllowedBrowserRequest({ method: 'GET', url: `${baseUrl}/workbench`, baseUrl })).toBe(true);
    expect(isAllowedBrowserRequest({ method: 'POST', url: `${baseUrl}/api/workbench/reviewer-roster`, baseUrl })).toBe(false);
    expect(isAllowedBrowserRequest({ method: 'POST', url: `${baseUrl}/api/review-manager/send-emails`, baseUrl })).toBe(false);
    expect(isAllowedBrowserRequest({ method: 'POST', url: `${baseUrl}/api/workbench/grantee-deliverables/send-invite`, baseUrl })).toBe(false);
    expect(isAllowedBrowserRequest({ method: 'GET', url: 'https://login.microsoftonline.com/', baseUrl })).toBe(false);
    expect(redactBrowserPath(
      `${baseUrl}/workbench/11111111-1111-1111-1111-111111111111?email=person@example.org`,
      baseUrl,
    )).toBe('/workbench/:requestId');
    expect(isGuid('11111111-1111-1111-1111-111111111111')).toBe(true);
    expect(isGuid('11111111-1111-1111-111111111111'.replace('-1111-', '-'))).toBe(false);
  });

  test('keeps roster and proposal summaries free of candidate and file payloads', () => {
    expect(summarizeRoster({
      rosterVersion: ROSTER_VERSION,
      active: [{ name: 'Must not leave this function' }],
      excluded: [],
      ineligible: [{ email: 'must-not-be-returned@example.org' }],
      blocked: [],
    })).toEqual({
      rosterVersion: ROSTER_VERSION,
      counts: { active: 1, excluded: 0, ineligible: 1, blocked: 0 },
      total: 2,
    });
    expect(summarizeWarmValidation({
      state: 'current',
      binding: 'fallback',
      proposalContentVersion: ROSTER_VERSION,
      reasonCode: null,
      bindingKey: 'akoya_request::private folder::Phase I/ProjectDescription.pdf',
    })).toEqual({
      state: 'current', reasonCode: null, binding: 'fallback', hasVersionedMetadata: true,
    });
  });

  test('requires inspected immutable host or its current alias, commit, readiness, and deployment class', () => {
    const good = deploymentSummary({
      readyState: 'READY',
      url: 'preview-example.vercel.app',
      target: null,
      meta: { githubCommitSha: COMMIT },
    }, {
      baseUrl: 'https://preview-example.vercel.app', expectedCommit: COMMIT, deploymentClass: 'preview',
    });
    expect(good).toMatchObject({ ready: true, target: 'preview', actualCommit: COMMIT });

    const mismatch = deploymentSummary({
      readyState: 'READY', url: 'another-preview.vercel.app', target: null, meta: { githubCommitSha: COMMIT },
    }, {
      baseUrl: 'https://preview-example.vercel.app', expectedCommit: COMMIT, deploymentClass: 'preview',
    });
    expect(mismatch.ready).toBe(false);
    expect(mismatch.reasons).toContain('deployment_base_host_unlisted');

    const alias = deploymentSummary({
      readyState: 'READY',
      url: 'immutable-preview.vercel.app',
      aliases: ['reviewer-find-smoke.example.org'],
      target: null,
      meta: { githubCommitSha: COMMIT },
    }, {
      baseUrl: 'https://reviewer-find-smoke.example.org', expectedCommit: COMMIT, deploymentClass: 'preview',
    });
    expect(alias).toMatchObject({ ready: true, deploymentHost: 'immutable-preview.vercel.app', baseHostMatch: 'alias' });

    const aliasRemovedAfterBrowser = deploymentSummary({
      readyState: 'READY',
      url: 'immutable-preview.vercel.app',
      aliases: [],
      target: null,
      meta: { githubCommitSha: COMMIT },
    }, {
      baseUrl: 'https://reviewer-find-smoke.example.org', expectedCommit: COMMIT, deploymentClass: 'preview',
    });
    expect(aliasRemovedAfterBrowser).toMatchObject({ ready: false, baseHostMatch: null });
    expect(aliasRemovedAfterBrowser.reasons).toContain('deployment_base_host_unlisted');

    const aliasMovedAfterBrowser = deploymentSummary({
      readyState: 'READY',
      url: 'other-immutable-preview.vercel.app',
      aliases: ['another-stable-host.example.org'],
      target: null,
      meta: { githubCommitSha: COMMIT },
    }, {
      baseUrl: 'https://reviewer-find-smoke.example.org', expectedCommit: COMMIT, deploymentClass: 'preview',
    });
    expect(aliasMovedAfterBrowser).toMatchObject({ ready: false, baseHostMatch: null });
  });

  test('joins omitted inspect git metadata only from one exact immutable hostname', () => {
    const inspected = {
      id: 'dpl_abcdefgh',
      url: 'preview-example.vercel.app',
      readyState: 'READY',
      target: 'preview',
      meta: null,
      gitSource: null,
    };
    const listed = {
      deployments: [{
        url: 'preview-example.vercel.app',
        meta: { githubCommitSha: COMMIT },
      }],
    };
    expect(enrichDeploymentWithListing(inspected, listed)).toMatchObject({
      id: 'dpl_abcdefgh',
      url: 'preview-example.vercel.app',
      meta: { githubCommitSha: COMMIT },
    });
    expect(enrichDeploymentWithListing(inspected, {
      deployments: [listed.deployments[0], listed.deployments[0]],
    })).toEqual(inspected);
    expect(enrichDeploymentWithListing(inspected, {
      deployments: [{ url: 'branch-alias.vercel.app', meta: { githubCommitSha: COMMIT } }],
    })).toEqual(inspected);
    expect(enrichDeploymentWithListing(inspected, {
      deployments: [{ id: 'dpl_other', url: inspected.url, meta: { githubCommitSha: COMMIT } }],
    })).toEqual(inspected);
    expect(enrichDeploymentWithListing(inspected, {
      deployments: [{ uid: inspected.id, url: inspected.url, meta: { githubCommitSha: COMMIT } }],
    })).toMatchObject({ id: inspected.id, meta: { githubCommitSha: COMMIT } });

    const listedAliasOnly = enrichDeploymentWithListing({
      ...inspected,
      alias: undefined,
      aliases: undefined,
    }, {
      deployments: [{
        id: inspected.id,
        url: inspected.url,
        alias: ['reviewer-find-smoke.example.org'],
        meta: { githubCommitSha: COMMIT },
      }],
    });
    expect(listedAliasOnly.alias).toBeUndefined();
    expect(listedAliasOnly.aliases).toBeUndefined();
    expect(deploymentSummary(listedAliasOnly, {
      baseUrl: 'https://reviewer-find-smoke.example.org', expectedCommit: COMMIT, deploymentClass: 'preview',
    })).toMatchObject({ ready: false, baseHostMatch: null });
  });

  test('accepts only the explicit read-only production-target runtime attestation', () => {
    const good = {
      scope: 'reviewer_roster_warm_read_only',
      deploymentClass: 'preview',
      dataverseTargetClass: 'production',
      interlockMode: 'on',
    };
    expect(validateRuntimeAttestation(good, 'preview')).toMatchObject({ ok: true, value: good });
    for (const change of [
      { scope: 'other' },
      { deploymentClass: 'production' },
      { dataverseTargetClass: 'sandbox' },
      { dataverseTargetClass: 'unknown' },
      { interlockMode: 'warn' },
      { interlockMode: 'off' },
    ]) {
      expect(validateRuntimeAttestation({ ...good, ...change }, 'preview').ok).toBe(false);
    }
  });

  test('requires per-scope complete-effect positive controls and rejects unsafe summaries', () => {
    const clean = summarizeLedger([
      { event: 'effect', observationId: OBSERVATION_ID, effectClass: 'postgres_read', mode: 'cached' },
      {
        event: 'complete', observationId: OBSERVATION_ID, mode: 'cached', complete: true, incomplete: false,
        effectCounts: { postgres_read: 1 },
      },
      { event: 'effect', observationId: OBSERVATION_ID, effectClass: 'dataverse_read', mode: 'reconciled' },
      {
        event: 'complete', observationId: OBSERVATION_ID, mode: 'reconciled', complete: true, incomplete: false,
        effectCounts: { postgres_read: 1, dataverse_read: 1 },
      },
    ], OBSERVATION_ID);
    expect(clean).toMatchObject({
      complete: true,
      completeModes: ['cached', 'reconciled'],
      forbiddenEffects: [],
      effectCounts: { postgres_read: 1, dataverse_read: 1 },
    });

    const unsafe = summarizeLedger([
      { event: 'effect', observationId: OBSERVATION_ID, effectClass: 'claude', mode: 'cached' },
      { event: 'observation_incomplete', observationId: OBSERVATION_ID, mode: 'cached', incomplete: true },
      { event: 'complete', observationId: OBSERVATION_ID, mode: 'cached', complete: false, incomplete: true },
    ], OBSERVATION_ID);
    expect(unsafe.complete).toBe(false);
    expect(unsafe.forbiddenEffects).toEqual(['claude']);

    const attemptedEmail = summarizeLedger([
      { event: 'effect', observationId: OBSERVATION_ID, effectClass: 'email', mode: 'reconciled' },
      { event: 'effect', observationId: OBSERVATION_ID, effectClass: 'dataverse_action', mode: 'reconciled' },
      {
        event: 'complete', observationId: OBSERVATION_ID, mode: 'cached', complete: true, incomplete: false,
        effectCounts: { postgres_read: 1 },
      },
      {
        event: 'complete', observationId: OBSERVATION_ID, mode: 'reconciled', complete: true, incomplete: false,
        effectCounts: { postgres_read: 1, dataverse_read: 1, email: 1, dataverse_action: 1 },
      },
    ], OBSERVATION_ID);
    expect(attemptedEmail.complete).toBe(false);
    expect(attemptedEmail.forbiddenEffects.sort()).toEqual(['dataverse_action', 'email']);
    expect(attemptedEmail.completeSummaryForbiddenEffects.sort()).toEqual(['dataverse_action', 'email']);

    const unknown = summarizeLedger([
      { event: 'effect', observationId: OBSERVATION_ID, effectClass: 'unclassified_effect', mode: 'cached' },
      {
        event: 'complete', observationId: OBSERVATION_ID, mode: 'cached', complete: true, incomplete: false,
        effectCounts: { postgres_read: 1 },
      },
      {
        event: 'complete', observationId: OBSERVATION_ID, mode: 'reconciled', complete: true, incomplete: false,
        effectCounts: { postgres_read: 1, dataverse_read: 1 },
      },
    ], OBSERVATION_ID);
    expect(unknown.complete).toBe(false);
    expect(unknown.unknownEffects).toEqual(['unclassified_effect']);

    const missingCachedPositiveControl = summarizeLedger([
      {
        event: 'complete', observationId: OBSERVATION_ID, mode: 'cached', complete: true, incomplete: false,
        effectCounts: {},
      },
      {
        event: 'complete', observationId: OBSERVATION_ID, mode: 'reconciled', complete: true, incomplete: false,
        effectCounts: { postgres_read: 1, dataverse_read: 1 },
      },
    ], OBSERVATION_ID);
    expect(missingCachedPositiveControl.complete).toBe(false);
    expect(missingCachedPositiveControl.completeSummaryFailures)
      .toContain('cached_complete_postgres_read_missing');

    const malformedReconciledSummary = summarizeLedger([
      {
        event: 'complete', observationId: OBSERVATION_ID, mode: 'cached', complete: true, incomplete: false,
        effectCounts: { postgres_read: 1 },
      },
      {
        event: 'complete', observationId: OBSERVATION_ID, mode: 'reconciled', complete: true, incomplete: false,
        effectCounts: { postgres_read: 'one', dataverse_read: 1 },
      },
    ], OBSERVATION_ID);
    expect(malformedReconciledSummary.complete).toBe(false);
    expect(malformedReconciledSummary.completeSummaryFailures)
      .toContain('reconciled_complete_effect_counts_invalid');

    const forbiddenCompleteSummary = summarizeLedger([
      {
        event: 'complete', observationId: OBSERVATION_ID, mode: 'cached', complete: true, incomplete: false,
        effectCounts: { postgres_read: 1, claude: 1 },
      },
      {
        event: 'complete', observationId: OBSERVATION_ID, mode: 'reconciled', complete: true, incomplete: false,
        effectCounts: { postgres_read: 1, dataverse_read: 1 },
      },
    ], OBSERVATION_ID);
    expect(forbiddenCompleteSummary.complete).toBe(false);
    expect(forbiddenCompleteSummary.completeSummaryForbiddenEffects).toEqual(['claude']);
  });

  test('fails closed unless cached candidate UI visibly precedes reconciliation within warm budgets', () => {
    expect(validateWarmVisitMilestones({
      cachedCandidateUiVisibleMs: LIVE_WARM_TIMING_BUDGETS.cachedCandidateUiVisibleMs,
      reconciledRosterUiReadyMs: LIVE_WARM_TIMING_BUDGETS.reconciledRosterUiReadyMs,
      reconciliationPendingAtCachedUi: true,
    })).toEqual({ ok: true, reasons: [] });
    expect(validateWarmVisitMilestones({
      cachedCandidateUiVisibleMs: LIVE_WARM_TIMING_BUDGETS.cachedCandidateUiVisibleMs + 1,
      reconciledRosterUiReadyMs: LIVE_WARM_TIMING_BUDGETS.reconciledRosterUiReadyMs,
      reconciliationPendingAtCachedUi: true,
    }).reasons).toContain('cached_candidate_ui_budget_exceeded');
    expect(validateWarmVisitMilestones({
      cachedCandidateUiVisibleMs: 100,
      reconciledRosterUiReadyMs: 200,
      reconciliationPendingAtCachedUi: false,
    }).reasons).toContain('cached_ui_not_observed_before_reconciliation');
  });

  test('polls Vercel logs through the remaining global run window only', () => {
    expect(observationLogPollPlan({ nowMs: 100, deadlineAtMs: 100 })).toEqual({
      canPoll: false, queryTimeoutMs: 0, retryDelayMs: 0,
    });
    expect(observationLogPollPlan({ nowMs: 1_000, deadlineAtMs: 4_000 })).toEqual({
      canPoll: true, queryTimeoutMs: 3_000, retryDelayMs: 2_000,
    });
    expect(observationLogPollPlan({ nowMs: 1_000, deadlineAtMs: 40_000 })).toMatchObject({
      canPoll: true, queryTimeoutMs: 10_000, retryDelayMs: 2_000,
    });
    expect(ledgerPhaseDeadline({
      nowMs: 1_000,
      globalDeadlineAtMs: 200_000,
      phase: 'preflight',
    })).toBe(1_000 + LEDGER_PHASE_MAX_WAIT_MS.preflight);
    expect(ledgerPhaseDeadline({
      nowMs: 1_000,
      globalDeadlineAtMs: 30_000,
      phase: 'final',
    })).toBe(30_000);
    expect(ledgerPhaseDeadline({
      nowMs: 1_000,
      globalDeadlineAtMs: 30_000,
      phase: 'unknown',
    })).toBeNull();
  });

  test('extracts only exact bounded observation events from Vercel JSON log lines', () => {
    const output = [
      JSON.stringify({ message: JSON.stringify({ kind: 'reviewer_find_warm_observation', observationId: OBSERVATION_ID, route: 'reviewer_roster', event: 'effect', mode: 'cached', effectClass: 'postgres_read', reasonCode: 'completed', requestId: 'must_not_return' }) }),
      JSON.stringify({ message: JSON.stringify({ kind: 'reviewer_find_warm_observation', observationId: OBSERVATION_ID, route: 'reviewer_roster', event: 'complete', mode: 'cached', complete: true, incomplete: false, effectCounts: { postgres_read: 1 }, reasonCode: 'warm_get_completed' }) }),
      JSON.stringify({ message: JSON.stringify({ kind: 'reviewer_find_warm_observation', observationId: OBSERVATION_ID, route: 'reviewer_roster', event: 'complete', mode: 'reconciled', complete: true, incomplete: false, effectCounts: { postgres_read: 1, dataverse_read: 1 }, reasonCode: 'warm_get_completed' }) }),
      JSON.stringify({ message: 'another app log with person@example.org' }),
    ].join('\n');
    expect(parseVercelObservationEvents(output, OBSERVATION_ID)).toEqual([
      { observationId: OBSERVATION_ID, event: 'effect', effectClass: 'postgres_read', mode: 'cached', complete: false, incomplete: false, effectCounts: null, reasonCode: 'completed' },
      { observationId: OBSERVATION_ID, event: 'complete', effectClass: null, mode: 'cached', complete: true, incomplete: false, effectCounts: { postgres_read: 1 }, reasonCode: 'warm_get_completed' },
      { observationId: OBSERVATION_ID, event: 'complete', effectClass: null, mode: 'reconciled', complete: true, incomplete: false, effectCounts: { postgres_read: 1, dataverse_read: 1 }, reasonCode: 'warm_get_completed' },
    ]);
    expect(parseVercelObservationEvents('not-json', OBSERVATION_ID)).toEqual([]);
    expect(parseVercelObservationEvents(`${output}\n{\"message\":`, OBSERVATION_ID)).toEqual(parseVercelObservationEvents(output, OBSERVATION_ID));
    const malformedCorrelated = parseVercelObservationEvents(
      `${output}\n{\"message\":\"truncated ${OBSERVATION_ID}`,
      OBSERVATION_ID,
    );
    expect(malformedCorrelated.at(-1)).toEqual({
      observationId: OBSERVATION_ID,
      event: 'observation_incomplete',
      effectClass: null,
      mode: null,
      complete: false,
      incomplete: true,
      effectCounts: null,
      reasonCode: 'malformed_observation_log_line',
    });
    expect(summarizeLedger(malformedCorrelated, OBSERVATION_ID).complete).toBe(false);
    expect(parseVercelObservationEvents(JSON.stringify({
      message: JSON.stringify({ kind: 'reviewer_find_warm_observation', observationId: OBSERVATION_ID, route: 'other_route', event: 'complete', mode: 'cached', complete: true, incomplete: false }),
    }), OBSERVATION_ID)).toEqual([]);
  });

  test('extracts the complete bounded event sequence from Vercel request-level logs', () => {
    const cachedStart = JSON.stringify({
      kind: 'reviewer_find_warm_observation', observationId: OBSERVATION_ID,
      route: 'reviewer_roster', event: 'start', mode: 'cached', reasonCode: 'warm_get_started',
    });
    const cachedComplete = JSON.stringify({
      kind: 'reviewer_find_warm_observation', observationId: OBSERVATION_ID,
      route: 'reviewer_roster', event: 'complete', mode: 'cached', complete: true,
      incomplete: false, effectCounts: { postgres_read: 1 }, reasonCode: 'warm_get_completed',
    });
    const reconciledComplete = JSON.stringify({
      kind: 'reviewer_find_warm_observation', observationId: OBSERVATION_ID,
      route: 'reviewer_roster', event: 'complete', mode: 'reconciled', complete: true,
      incomplete: false, effectCounts: { postgres_read: 1, dataverse_read: 1 }, reasonCode: 'warm_get_completed',
    });
    const output = JSON.stringify({
      message: cachedStart,
      logs: [
        { level: 'info', message: cachedStart },
        { level: 'info', message: cachedComplete },
        { level: 'info', message: reconciledComplete },
      ],
    });

    const events = parseVercelObservationEvents(output, OBSERVATION_ID);
    expect(events).toHaveLength(3);
    expect(summarizeLedger(events, OBSERVATION_ID)).toMatchObject({
      complete: true,
      completeModes: ['cached', 'reconciled'],
      completeScopeCounts: { cached: 1, reconciled: 1 },
    });

    const malformedNested = parseVercelObservationEvents(JSON.stringify({
      message: 'request completed',
      logs: [{ level: 'info', message: `truncated ${OBSERVATION_ID}` }],
    }), OBSERVATION_ID);
    expect(summarizeLedger(malformedNested, OBSERVATION_ID).incomplete).toBe(true);
  });
});
