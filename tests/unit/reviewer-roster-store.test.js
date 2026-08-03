/**
 * @jest-environment node
 *
 * Unit tests for reviewer-roster-store (S224) — the Postgres CRUD behind the
 * Workbench Find-tab durable candidate roster. `@vercel/postgres` `sql` is
 * mocked; these cover the JS-side behavior (normalization, name filtering,
 * partitioning, return shapes) and assert the SQL guards/intent are present.
 */

jest.mock('@vercel/postgres', () => ({ sql: jest.fn() }));
import { sql } from '@vercel/postgres';

const store = require('../../lib/services/reviewer-roster-store');
const {
  STAGES,
  CONTRACT_VERSIONS,
  planCandidateFreshness,
} = require('../../lib/services/reviewer-stage-freshness');
const { projectStaffConfirmedIdentityEvidence } = require('../../lib/services/workbench/reviewer-stage-producers/identity');
const { expiredLeaseRecoverySourceVersion } = require('../../lib/services/workbench/reviewer-stage-source-versions');

const REQ = '11111111-1111-1111-1111-111111111111';

beforeEach(() => {
  sql.mockReset();
  sql.mockResolvedValue({ rows: [], rowCount: 0 });
});

// Flatten the interpolated values of every sql`...` call for assertions.
function allInterpolations() {
  return sql.mock.calls.flatMap((call) => call.slice(1));
}
function queryTextOf(callIndex) {
  const frags = sql.mock.calls[callIndex][0];
  return Array.isArray(frags) ? frags.join(' ') : '';
}
function hasJavaScriptLineComment(sqlText) {
  return sqlText.includes('//');
}
function jsonInterpolations() {
  return allInterpolations().flatMap((value) => {
    if (typeof value !== 'string' || !value.trim().startsWith('{')) return [];
    try { return [JSON.parse(value)]; } catch { return []; }
  });
}

const TERMINAL_STAGES = STAGES.filter((stage) => stage !== 'roster_persistence');
const SOURCE_VERSION = 'a'.repeat(64);
function currentReceipt(stage, suffix = stage) {
  return {
    state: 'current',
    contractVersion: CONTRACT_VERSIONS[stage],
    sourceVersion: SOURCE_VERSION,
    resultVersion: `${suffix}:result`,
    completedAt: '2026-08-02T12:01:00.000Z',
    reasonCode: null,
    failureCode: null,
  };
}
function allCurrentUpstreams() {
  return Object.fromEntries(TERMINAL_STAGES.map((stage) => [stage, currentReceipt(stage)]));
}
function coldEnvelope(stage, suffix = stage, evidencePatch = {}) {
  return {
    outcome: 'current',
    evidencePatch,
    receipt: currentReceipt(stage, suffix),
  };
}

describe('listForRequest', () => {
  test('partitions active/excluded/ineligible/blocked and collects allNames across EVERY status', async () => {
    sql.mockResolvedValueOnce({ rows: [
      { status: 'active', display_name: 'Ann Lee', candidate: { name: 'Ann Lee' } },
      { status: 'excluded', display_name: 'Bob Roe', candidate: { name: 'Bob Roe' } },
      { status: 'ineligible', display_name: 'Pat Thiel', candidate: { name: 'Pat Thiel', eligibilityStatus: 'deceased' } },
      { status: 'blocked', display_name: 'Eve Poe', candidate: { name: 'Eve Poe', promotionDecision: 'blocked_applicant_excluded' } },
      { status: 'saved', candidate_key: 'suggestion:sug-9', display_name: 'Cy Poe', candidate: { name: 'Cy Poe', suggestionId: 'SUG-9' } },
      { status: 'coi_dropped', display_name: 'Dee Coe', candidate: { name: 'Dee Coe', hasInstitutionCOI: true } },
    ] });
    const out = await store.listForRequest(REQ);
    expect(out.active.map((c) => c.name)).toEqual(['Ann Lee']);
    expect(out.excluded.map((c) => c.name)).toEqual(['Bob Roe']);
    expect(out.ineligible.map((c) => c.name)).toEqual(['Pat Thiel']);
    expect(out.blocked.map((c) => c.name)).toEqual(['Eve Poe']);
    expect(out.savedKeys).toEqual(['suggestion:sug-9']);
    // allNames is the cross-run dedup union — must include saved + excluded + coi_dropped too.
    expect(out.allNames).toEqual(['Ann Lee', 'Bob Roe', 'Pat Thiel', 'Eve Poe', 'Cy Poe', 'Dee Coe']);
  });
});

describe('stage refresh CAS', () => {
  test('starts and completes only one candidate/stage with snapshot and attempt guards', async () => {
    sql.mockResolvedValueOnce({ rows: [{ candidate: { name: 'Ann' }, updated_at_token: 'next' }], rowCount: 1 });
    const started = await store.startStageRefresh(REQ, 'candidate:ann', 'version-1', 'contact', { attemptId: 'attempt-1' });
    expect(started.outcome).toBe('recorded');
    expect(queryTextOf(0)).toMatch(/updated_at::text/);
    expect(queryTextOf(0)).toMatch(/stageRefresh/);
    // PostgreSQL's jsonb_build_object key is polymorphic. The tagged-template
    // placeholder must be typed in SQL itself; otherwise production rejects
    // the lease UPDATE with "could not determine data type of parameter".
    expect(queryTextOf(0)).toMatch(/jsonb_build_object\(\s+::text,\s+::jsonb\)/);
    expect(queryTextOf(0)).toMatch(/status\s*=\s*'active'/);
    expect(allInterpolations()).toEqual(expect.arrayContaining(['candidate:ann', 'version-1']));
    expect(allInterpolations().some((value) => typeof value === 'string' && value.includes('attempt-1'))).toBe(true);
    expect(allInterpolations()).not.toContain(JSON.stringify({ warmCacheVersion: 1 }));

    sql.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    await expect(store.completeStageRefresh(REQ, 'candidate:ann', 'version-2', 'contact', 'wrong-attempt', {})).resolves.toMatchObject({ outcome: 'rejected' });
  });

  test('a second stage cannot advance the row token or strand the first candidate-wide lease', async () => {
    const candidateKey = 'person:ann';
    const leasedCandidate = {
      candidateKey,
      name: 'Ann',
      stageRefresh: {
        contact: {
          refreshAttemptId: 'contact-attempt',
          refreshStartedAt: '2099-08-02T12:00:00.000Z',
        },
      },
      stageFreshness: {},
    };
    sql
      .mockResolvedValueOnce({ rows: [{ candidate: leasedCandidate, updated_at_token: 'version-2' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{
        candidate_key: candidateKey, status: 'active', candidate: leasedCandidate,
        source_kind: 'literature_retrieved', updated_at_token: 'version-2',
      }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{
        candidate_key: candidateKey, status: 'active', candidate: leasedCandidate,
        source_kind: 'literature_retrieved', updated_at_token: 'version-2',
      }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ candidate: { ...leasedCandidate, stageRefresh: {} }, updated_at_token: 'version-3' }], rowCount: 1 });

    await expect(store.startStageRefresh(
      REQ, candidateKey, 'version-1', 'contact', {
        attemptId: 'contact-attempt', startedAt: '2099-08-02T12:00:00.000Z',
      },
    )).resolves.toMatchObject({ outcome: 'recorded', updatedAt: 'version-2' });
    await expect(store.startStageRefresh(
      REQ, candidateKey, 'version-2', 'eligibility', {
        attemptId: 'eligibility-attempt', startedAt: '2099-08-02T12:00:01.000Z',
      },
    )).resolves.toMatchObject({ outcome: 'refresh_in_progress', leaseStage: 'contact' });
    await expect(store.completeStageRefreshWithEvidence(
      REQ, candidateKey, 'version-2', 'contact', 'contact-attempt', coldEnvelope('contact'),
    )).resolves.toMatchObject({ outcome: 'recorded', updatedAt: 'version-3' });

    expect(queryTextOf(1)).toMatch(/stageRefresh.*=\s*'\{\}'/s);
    expect(allInterpolations()).toContain('version-2');
  });

  test('an expired lease owned by another stage requires named recovery and is never overwritten', async () => {
    const candidateKey = 'person:ann';
    sql
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{
        candidate_key: candidateKey,
        status: 'active',
        source_kind: 'literature_retrieved',
        updated_at_token: 'version-2',
        candidate: {
          candidateKey,
          name: 'Ann',
          stageRefresh: {
            contact: {
              refreshAttemptId: 'expired-contact',
              refreshStartedAt: '2020-01-01T00:00:00.000Z',
            },
          },
        },
      }], rowCount: 1 });

    await expect(store.startStageRefresh(
      REQ, candidateKey, 'version-2', 'eligibility', {
        attemptId: 'eligibility-attempt', startedAt: '2026-08-02T12:00:01.000Z',
      },
    )).resolves.toMatchObject({
      outcome: 'lease_recovery_required',
      code: 'lease_recovery_required',
      leaseStage: 'contact',
    });
    expect(sql).toHaveBeenCalledTimes(2);
  });

  test('failure and lease recovery write sealed nonterminal receipts without replacing other evidence', async () => {
    sql
      .mockResolvedValueOnce({ rows: [{
        candidate_key: 'person:ann', status: 'active', updated_at_token: 'v1',
        candidate: { name: 'Ann', stageRefresh: { coauthor_coi: { refreshAttemptId: 'attempt-1' } }, keep: 'existing' },
      }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ candidate: { name: 'Ann' }, updated_at_token: 'next-1' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{
        candidate_key: 'person:ann', status: 'active', updated_at_token: 'v2',
        candidate: { name: 'Ann', stageRefresh: { coauthor_coi: { refreshAttemptId: 'attempt-2', refreshStartedAt: '2020-01-01T00:00:00.000Z' } } },
      }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ candidate: { name: 'Ann' }, updated_at_token: 'next-2' }], rowCount: 1 });

    await expect(store.failStageRefresh(REQ, 'person:ann', 'v1', 'coauthor_coi', 'attempt-1', {
      expectedSourceVersion: 'a'.repeat(64),
    }))
      .resolves.toMatchObject({ outcome: 'failed_retryable' });
    await expect(store.recoverExpiredStageRefresh(REQ, 'person:ann', 'v2', 'coauthor_coi', 'attempt-2', {
      expectedSourceVersion: 'b'.repeat(64),
    }))
      .resolves.toMatchObject({ outcome: 'failed_retryable' });

    const firstFailureWrite = JSON.parse(allInterpolations().find((value) => (
      typeof value === 'string' && value.includes('retryable_failure')
    )));
    expect(firstFailureWrite).toMatchObject({
      keep: 'existing',
      stageFreshness: {
        coauthor_coi: {
          state: 'incomplete',
          contractVersion: CONTRACT_VERSIONS.coauthor_coi,
          sourceVersion: 'a'.repeat(64),
          completedAt: null,
          reasonCode: null,
          failureCode: 'retryable_failure',
        },
      },
    });
    expect(queryTextOf(2)).toMatch(/stageRefresh.*stageFreshness/s);
    expect(queryTextOf(3)).toMatch(/updated_at::text/);
  });

  test('rejects a failure write without the shared opaque expected source before any roster read', async () => {
    await expect(store.failStageRefresh(REQ, 'person:ann', 'v1', 'coauthor_coi', 'attempt-1'))
      .resolves.toEqual({ outcome: 'rejected' });
    await expect(store.recoverExpiredStageRefresh(REQ, 'person:ann', 'v1', 'coauthor_coi', 'attempt-1', {
      expectedSourceVersion: 'source_version_missing',
    })).resolves.toEqual({ outcome: 'rejected' });
    expect(sql).not.toHaveBeenCalled();
  });

  test('expired-lease recovery cannot clear a live or foreign-stage owner even with an exact target attempt', async () => {
    const candidateKey = 'person:ann';
    const recoverySource = expiredLeaseRecoverySourceVersion({
      requestId: REQ,
      candidateKey,
      stage: 'contact',
    });
    const foreignLive = {
      candidateKey,
      stageRefresh: {
        identity: {
          refreshAttemptId: 'live-identity',
          refreshStartedAt: '2099-08-02T12:00:00.000Z',
        },
        contact: {
          refreshAttemptId: 'expired-contact',
          refreshStartedAt: '2020-08-02T12:00:00.000Z',
        },
      },
    };
    const sameStageLive = {
      candidateKey,
      stageRefresh: {
        contact: {
          refreshAttemptId: 'live-contact',
          refreshStartedAt: '2099-08-02T12:00:00.000Z',
        },
      },
    };
    sql
      .mockResolvedValueOnce({ rows: [{
        candidate_key: candidateKey, status: 'active', candidate: foreignLive, updated_at_token: 'v1',
      }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{
        candidate_key: candidateKey, status: 'active', candidate: sameStageLive, updated_at_token: 'v2',
      }], rowCount: 1 });

    await expect(store.recoverExpiredStageRefresh(REQ, candidateKey, 'v1', 'contact', 'expired-contact', {
      expectedSourceVersion: recoverySource,
    })).resolves.toEqual({ outcome: 'skipped_stale' });
    await expect(store.recoverExpiredStageRefresh(REQ, candidateKey, 'v2', 'contact', 'live-contact', {
      expectedSourceVersion: recoverySource,
    })).resolves.toEqual({ outcome: 'skipped_stale' });

    // Each call only reads its exact active-row/CAS/attempt snapshot. Neither
    // path emits the replacement UPDATE that would clear a lease.
    expect(sql).toHaveBeenCalledTimes(2);
  });

  test('a successful server stage completion atomically stamps the warm cache version for the next planner read', async () => {
    const candidateBeforeCompletion = {
      candidateKey: 'suggestion:aaaaaaaa-1111-1111-1111-111111111111',
      isApplicantRecommended: true,
      applicantInputVersion: SOURCE_VERSION,
      proposalContentVersion: 'b'.repeat(64),
      stageRefresh: {
        applicant_anchor: {
          refreshAttemptId: 'attempt-1',
          refreshStartedAt: '2026-08-02T12:00:00.000Z',
        },
      },
    };
    const receipt = {
      state: 'current',
      contractVersion: 1,
      sourceVersion: SOURCE_VERSION,
      resultVersion: 'applicant-anchor-result-v1',
      completedAt: '2026-08-02T12:01:00.000Z',
    };
    sql
      .mockResolvedValueOnce({ rows: [{
        candidate_key: candidateBeforeCompletion.candidateKey,
        status: 'active', candidate: candidateBeforeCompletion, updated_at_token: 'version-1',
      }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{
        candidate: {
          ...candidateBeforeCompletion,
          stageRefresh: {},
          warmCacheVersion: 1,
          stageFreshness: { applicant_anchor: receipt },
        },
        updated_at_token: 'version-2',
      }], rowCount: 1 });

    const completed = await store.completeStageRefresh(
      REQ,
      candidateBeforeCompletion.candidateKey,
      'version-1',
      'applicant_anchor',
      'attempt-1',
      receipt,
    );

    expect(completed).toMatchObject({ outcome: 'recorded', candidate: { warmCacheVersion: 1 } });
    expect(queryTextOf(0)).toMatch(/stageRefresh/);
    expect(queryTextOf(1)).toMatch(/updated_at::text/);
    const plan = planCandidateFreshness({
      candidate: completed.candidate,
      authoritative: {
        authorityState: 'current',
        applicantInputVersion: SOURCE_VERSION,
        proposalContentVersion: 'b'.repeat(64),
        versions: { applicant_anchor: SOURCE_VERSION },
      },
    });
    expect(plan.currentStages).toContain('applicant_anchor');
    expect(plan.refreshes).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ stage: 'applicant_anchor' }),
    ]));
    expect(plan.refreshes).toEqual(expect.arrayContaining([
      expect.objectContaining({ stage: 'identity' }),
    ]));
    expect(plan.promotionAuthority).toBe('blocked_refresh_required');
  });

  test('rejects malformed stage contracts before issuing SQL', async () => {
    await expect(store.startStageRefresh(REQ, 'candidate:ann', 'v', 'contact', { attemptId: 'x'.repeat(101) })).resolves.toEqual({ outcome: 'rejected' });
    await expect(store.startStageRefresh(REQ, 'candidate:ann', 'v', 'contact', { attemptId: 'a', startedAt: 'not-a-date' })).resolves.toEqual({ outcome: 'rejected' });
    await expect(store.completeStageRefresh(REQ, 'candidate:ann', 'v', 'contact', 'a', { state: 'failed', contractVersion: 1, sourceVersion: 'v', completedAt: '2026-08-01T00:00:00.000Z' })).resolves.toMatchObject({ outcome: 'rejected' });
    await expect(store.completeStageRefresh(REQ, 'candidate:ann', 'v', 'contact', 'a', { state: 'not_applicable', contractVersion: 1, sourceVersion: 'v', completedAt: '2026-08-01T00:00:00.000Z' })).resolves.toMatchObject({ outcome: 'rejected' });
    await expect(store.completeStageRefresh(REQ, 'candidate:ann', 'v', 'contact', 'a', { contractVersion: 99, sourceVersion: '', completedAt: 'bad' })).resolves.toMatchObject({ outcome: 'rejected' });
    expect(sql).not.toHaveBeenCalled();
  });

  test('uses the common projector and one lease-guarded CAS for evidence plus terminal convergence', async () => {
    sql
      .mockResolvedValueOnce({ rows: [{
        candidate_key: 'person:ann', status: 'active', updated_at_token: 'version-1',
        candidate: { name: 'Ann', stageRefresh: { applicant_anchor: { refreshAttemptId: 'attempt-1' } }, stageFreshness: {} },
      }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ candidate: { name: 'Ann' }, updated_at_token: 'next' }], rowCount: 1 });
    const result = await store.completeStageRefreshWithEvidence(
      REQ,
      'person:ann',
      'version-1',
      'applicant_anchor',
      'attempt-1',
      {
        outcome: 'current',
        evidencePatch: { applicantInputVersion: 'input:v1' },
        receipt: {
          state: 'current', contractVersion: 1, sourceVersion: SOURCE_VERSION,
          resultVersion: 'anchor-result:v1', completedAt: '2026-08-02T00:00:00.000Z',
          reasonCode: null, failureCode: null,
        },
      },
    );
    expect(result.outcome).toBe('recorded');
    expect(queryTextOf(0)).toMatch(/stageRefresh/);
    expect(queryTextOf(1)).toMatch(/stageRefresh/);
    const persisted = JSON.parse(allInterpolations().find((value) => (
      typeof value === 'string' && value.includes('anchor-result:v1')
    )));
    expect(persisted.stageFreshness.applicant_anchor).toMatchObject({ state: 'current' });
    expect(persisted.stageFreshness.roster_persistence).toBeUndefined();
    expect(allInterpolations()).toContain('attempt-1');
    expect(allInterpolations()).toContain('version-1');
  });

  test('accepts a sealed incomplete producer result, preserves display evidence, and invalidates the terminal receipt', async () => {
    sql
      .mockResolvedValueOnce({ rows: [{
        candidate_key: 'person:ann', status: 'active', updated_at_token: 'version-1',
        candidate: {
          name: 'Ann', oldDisplayEvidence: 'keep',
          stageRefresh: { applicant_anchor: { refreshAttemptId: 'attempt-1' } },
          stageFreshness: { ...allCurrentUpstreams(), roster_persistence: currentReceipt('roster_persistence') },
        },
      }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ candidate: { name: 'Ann' }, updated_at_token: 'next' }], rowCount: 1 });

    const result = await store.completeStageRefreshWithEvidence(
      REQ, 'person:ann', 'version-1', 'applicant_anchor', 'attempt-1', {
        outcome: 'incomplete',
        evidencePatch: { applicantInputVersion: 'input:v2' },
        receipt: {
          state: 'incomplete', contractVersion: CONTRACT_VERSIONS.applicant_anchor,
          sourceVersion: SOURCE_VERSION, resultVersion: 'anchor-result:v2',
          completedAt: null, reasonCode: null, failureCode: 'partial_coverage',
        },
      },
    );

    expect(result.outcome).toBe('failed_retryable');
    const persisted = JSON.parse(allInterpolations().find((value) => (
      typeof value === 'string' && value.includes('partial_coverage')
    )));
    expect(persisted).toMatchObject({
      oldDisplayEvidence: 'keep',
      stageFreshness: {
        applicant_anchor: expect.objectContaining({ state: 'incomplete', completedAt: null }),
      },
    });
    expect(persisted.stageFreshness.roster_persistence).toBeUndefined();
  });

  test('the legacy completion wrapper preserves null completedAt for a terminal failure', async () => {
    sql
      .mockResolvedValueOnce({ rows: [{
        candidate_key: 'person:ann', status: 'active', updated_at_token: 'version-1',
        candidate: { name: 'Ann', stageRefresh: { coauthor_coi: { refreshAttemptId: 'attempt-1' } } },
      }] })
      .mockResolvedValueOnce({ rows: [{ candidate: { name: 'Ann' }, updated_at_token: 'version-2' }], rowCount: 1 });
    await expect(store.completeStageRefresh(
      REQ, 'person:ann', 'version-1', 'coauthor_coi', 'attempt-1', {
        state: 'failed', contractVersion: CONTRACT_VERSIONS.coauthor_coi,
        sourceVersion: SOURCE_VERSION, resultVersion: 'coauthor-result:v1',
        completedAt: null, reasonCode: null, failureCode: 'terminal_failure',
      },
    )).resolves.toMatchObject({ outcome: 'failed_terminal' });
    const persisted = jsonInterpolations().find((value) => (
      value?.stageFreshness?.coauthor_coi?.state === 'failed'
    ));
    expect(persisted.stageFreshness.coauthor_coi.completedAt).toBeNull();
  });

  test('has a provider-free, CAS-bound terminal repair and never accepts a terminal cold receipt', async () => {
    sql
      .mockResolvedValueOnce({ rows: [{
        candidate_key: 'person:ann', status: 'active', updated_at_token: 'version-1',
        candidate: { name: 'Ann', stageFreshness: allCurrentUpstreams() },
      }] })
      .mockResolvedValueOnce({ rows: [{ candidate: { name: 'Ann' }, updated_at_token: 'next' }], rowCount: 1 });
    await expect(store.finalizeCachedRosterEvidence(REQ, 'person:ann', 'version-1'))
      .resolves.toMatchObject({ outcome: 'recorded' });
    expect(queryTextOf(1)).toMatch(/updated_at::text/);
    const finalized = JSON.parse(allInterpolations().find((value) => (
      typeof value === 'string' && value.includes('roster_persistence')
    )));
    expect(finalized.stageFreshness.roster_persistence).toMatchObject({ state: 'current' });
    expect(finalized).not.toHaveProperty('rosterStatus');
    expect(finalized).not.toHaveProperty('rosterUpdatedAt');

    const outcomes = await store.recordSurfacedWithStageEvidence(REQ, [{
      candidate: { name: 'Ann Lee', candidateKey: 'candidate:ann' },
      stageEvidence: { roster_persistence: {} },
    }]);
    expect(outcomes).toEqual([{
      candidateKey: 'candidate:ann', outcome: 'rejected', code: 'terminal_receipt_server_owned',
    }]);
  });

  test('cold, manual, and explicit-finalize writes derive identical terminal source/result versions for the same upstream receipt set', async () => {
    const applicantReceipt = currentReceipt('applicant_anchor', 'anchor');
    const completeUpstreams = { ...allCurrentUpstreams(), applicant_anchor: applicantReceipt };
    const manualPrerequisites = { ...completeUpstreams };
    delete manualPrerequisites.applicant_anchor;

    sql
      .mockResolvedValueOnce({ rows: [{
        candidate_key: 'person:ann', status: 'active', updated_at_token: 'manual-v1',
        candidate: { name: 'Ann', stageFreshness: manualPrerequisites, stageRefresh: { applicant_anchor: { refreshAttemptId: 'attempt-1' } } },
      }] })
      .mockResolvedValueOnce({ rows: [{ candidate: { name: 'Ann' }, updated_at_token: 'manual-v2' }], rowCount: 1 });
    await store.completeStageRefreshWithEvidence(
      REQ, 'person:ann', 'manual-v1', 'applicant_anchor', 'attempt-1', {
        outcome: 'current', evidencePatch: {}, receipt: applicantReceipt,
      },
    );
    const manualTerminal = jsonInterpolations().find((value) => (
      value?.stageFreshness?.roster_persistence
    )).stageFreshness.roster_persistence;

    sql.mockReset();
    sql
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ candidate: { name: 'Ann' }, updated_at_token: 'cold-v2' }], rowCount: 1 });
    const coldStageEvidence = Object.fromEntries(TERMINAL_STAGES.map((stage) => [
      stage,
      coldEnvelope(stage, stage === 'applicant_anchor' ? 'anchor' : stage),
    ]));
    await store.recordSurfacedWithStageEvidence(REQ, [{
      candidate: { name: 'Ann', candidateKey: 'person:ann' },
      stageEvidence: coldStageEvidence,
    }]);
    const coldTerminal = jsonInterpolations().find((value) => (
      value?.stageFreshness?.roster_persistence
    )).stageFreshness.roster_persistence;

    sql.mockReset();
    sql
      .mockResolvedValueOnce({ rows: [{
        candidate_key: 'person:ann', status: 'active', updated_at_token: 'final-v1',
        candidate: { name: 'Ann', stageFreshness: completeUpstreams },
      }] })
      .mockResolvedValueOnce({ rows: [{ candidate: { name: 'Ann' }, updated_at_token: 'final-v2' }], rowCount: 1 });
    await store.finalizeCachedRosterEvidence(REQ, 'person:ann', 'final-v1');
    const finalTerminal = jsonInterpolations().find((value) => (
      value?.stageFreshness?.roster_persistence
    )).stageFreshness.roster_persistence;

    expect([coldTerminal, manualTerminal, finalTerminal].map((receipt) => ({
      sourceVersion: receipt.sourceVersion,
      resultVersion: receipt.resultVersion,
    }))).toEqual([
      expect.objectContaining({ sourceVersion: expect.any(String), resultVersion: expect.any(String) }),
      expect.objectContaining({ sourceVersion: expect.any(String), resultVersion: expect.any(String) }),
      expect.objectContaining({ sourceVersion: expect.any(String), resultVersion: expect.any(String) }),
    ]);
    expect(coldTerminal.sourceVersion).toBe(manualTerminal.sourceVersion);
    expect(coldTerminal.resultVersion).toBe(manualTerminal.resultVersion);
    expect(coldTerminal.sourceVersion).toBe(finalTerminal.sourceVersion);
    expect(coldTerminal.resultVersion).toBe(finalTerminal.resultVersion);
  });

  function structuredEnvelope(stage, sourceVersion, evidencePatch) {
    return {
      outcome: 'current',
      evidencePatch,
      receipt: {
        state: 'current',
        contractVersion: CONTRACT_VERSIONS[stage],
        sourceVersion,
        resultVersion: `${stage}-result`,
        completedAt: '2026-08-02T12:02:00.000Z',
        reasonCode: null,
        failureCode: null,
      },
    };
  }

  function structuredAddressReceipt(candidateKey = 'person:ann') {
    return {
      receiptId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      email: 'ann@example.edu',
      personConfirmed: true,
      actorProfileId: 'profile-1',
      actorSystemUserId: 'actor-1',
      requestId: REQ,
      candidateKey,
      evidenceType: 'institution_page',
      evidenceUrl: 'https://example.edu/ann',
      note: null,
      attestedAt: '2026-08-02T12:02:00.000Z',
      canonicalPersonId: '33333333-3333-4333-8333-333333333333',
      canonicalPersonEtag: 'W/"post-action"',
    };
  }

  function structuredContactEnvelope(sourceVersion = 'b'.repeat(64)) {
    return structuredEnvelope('contact', sourceVersion, {
      email: 'ann@example.edu', emailSource: 'staff_verified', emailPersistAllowed: true,
      emailEvidence: null, emailAction: 'ready', emailActionReason: null,
      website: null, websiteSource: null, websitePersistAllowed: false,
      facultyPageUrl: null, affiliation: null, affiliationSource: null, affiliationPersistAllowed: false,
      contactStatus: null, contactStatusReason: null, contactLeads: [], contactTierSummary: { tiersUsed: [], providerError: false },
      canonicalPersonId: '33333333-3333-4333-8333-333333333333',
      canonicalPersonEtag: 'W/"post-action"', personEtag: 'W/"post-action"',
    });
  }

  function structuredAddressEnvelope(sourceVersion = 'c'.repeat(64)) {
    return structuredEnvelope('address_trust', sourceVersion, {
      addressTrustStatus: 'staff_verified', addressTrustReason: null,
      addressTrustEmail: 'ann@example.edu', addressTrustSource: 'staff_verified',
      addressTrustEvidence: {
        canonicalPersonId: '33333333-3333-4333-8333-333333333333',
        canonicalPersonEtag: 'W/"post-action"', actorId: 'actor-1',
        attestedAt: '2026-08-02T12:02:00.000Z', evidenceType: 'institution_page',
        evidenceUrl: 'https://example.edu/ann',
      },
    });
  }

  test('atomically publishes structured contact + address receipts and terminal convergence', async () => {
    const candidateKey = 'person:ann';
    const candidate = {
      name: 'Ann', candidateKey,
      stageFreshness: { ...allCurrentUpstreams(), roster_persistence: currentReceipt('roster_persistence', 'old-terminal') },
    };
    sql
      .mockResolvedValueOnce({ rows: [{ candidate_key: candidateKey, status: 'active', candidate, updated_at_token: 'version-1' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ candidate: { ...candidate, warmCacheVersion: 1 }, updated_at_token: 'version-2' }], rowCount: 1 });

    const result = await store.completeStructuredAddressVerification(REQ, candidateKey, 'version-1', {
      contactEnvelope: structuredContactEnvelope(),
      addressTrustEnvelope: structuredAddressEnvelope(),
      expectedSourceVersions: { contact: 'b'.repeat(64), address_trust: 'c'.repeat(64) },
      legacyAddressReceipt: structuredAddressReceipt(candidateKey),
    });

    expect(result).toMatchObject({ outcome: 'recorded', updatedAt: 'version-2' });
    expect(sql).toHaveBeenCalledTimes(2);
    expect(queryTextOf(1)).toMatch(/updated_at::text/);
    const persisted = jsonInterpolations().find((value) => value?.addressTrustReceipt?.receiptId);
    expect(persisted).toMatchObject({
      email: 'ann@example.edu',
      canonicalPersonId: '33333333-3333-4333-8333-333333333333',
      stageFreshness: {
        contact: expect.objectContaining({ sourceVersion: 'b'.repeat(64) }),
        address_trust: expect.objectContaining({ sourceVersion: 'c'.repeat(64) }),
        roster_persistence: expect.objectContaining({ state: 'current' }),
      },
      addressTrustReceipt: expect.objectContaining({ canonicalPersonEtag: 'W/"post-action"', actorSystemUserId: 'actor-1' }),
    });
  });

  test('a lost structured CAS preserves prior evidence and never reports either stage recorded', async () => {
    const candidateKey = 'person:ann';
    const candidate = { name: 'Ann', candidateKey, oldEvidence: 'keep', stageFreshness: allCurrentUpstreams() };
    sql
      .mockResolvedValueOnce({ rows: [{ candidate_key: candidateKey, status: 'active', candidate, updated_at_token: 'version-1' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await expect(store.completeStructuredAddressVerification(REQ, candidateKey, 'version-1', {
      contactEnvelope: structuredContactEnvelope(),
      addressTrustEnvelope: structuredAddressEnvelope(),
      expectedSourceVersions: { contact: 'b'.repeat(64), address_trust: 'c'.repeat(64) },
      legacyAddressReceipt: structuredAddressReceipt(candidateKey),
    })).resolves.toEqual({ outcome: 'skipped_stale' });
    expect(sql).toHaveBeenCalledTimes(2);
  });

  test('structured completion refuses an unrelated candidate lease before advancing the row token', async () => {
    const candidateKey = 'person:ann';
    const candidate = {
      name: 'Ann', candidateKey,
      stageRefresh: {
        eligibility: {
          refreshAttemptId: 'eligibility-attempt',
          refreshStartedAt: '2099-08-02T12:00:00.000Z',
        },
      },
      stageFreshness: allCurrentUpstreams(),
    };
    sql.mockResolvedValueOnce({
      rows: [{ candidate_key: candidateKey, status: 'active', candidate, updated_at_token: 'version-1' }],
      rowCount: 1,
    });

    await expect(store.completeStructuredAddressVerification(REQ, candidateKey, 'version-1', {
      contactEnvelope: structuredContactEnvelope(),
      addressTrustEnvelope: structuredAddressEnvelope(),
      expectedSourceVersions: { contact: 'b'.repeat(64), address_trust: 'c'.repeat(64) },
      legacyAddressReceipt: structuredAddressReceipt(candidateKey),
    })).resolves.toMatchObject({
      outcome: 'refresh_in_progress',
      leaseStage: 'eligibility',
    });
    expect(sql).toHaveBeenCalledTimes(1);
  });

  test('rejects an invalid member of the structured pair before any write', async () => {
    const invalidContact = structuredContactEnvelope();
    invalidContact.evidencePatch.unexpected = 'browser-injected';
    await expect(store.completeStructuredAddressVerification(REQ, 'person:ann', 'version-1', {
      contactEnvelope: invalidContact,
      addressTrustEnvelope: structuredAddressEnvelope(),
      expectedSourceVersions: { contact: 'b'.repeat(64), address_trust: 'c'.repeat(64) },
      legacyAddressReceipt: structuredAddressReceipt(),
    })).resolves.toMatchObject({ outcome: 'rejected', code: 'invalid_structured_stage_evidence' });
    expect(sql).not.toHaveBeenCalled();
  });

  test('invalidates terminal convergence when another upstream receipt is stale', async () => {
    const candidateKey = 'person:ann';
    const candidate = {
      name: 'Ann', candidateKey,
      stageFreshness: {
        ...allCurrentUpstreams(),
        coauthor_coi: { ...currentReceipt('coauthor_coi'), state: 'incomplete', completedAt: null, failureCode: 'partial_coverage' },
        roster_persistence: currentReceipt('roster_persistence', 'old-terminal'),
      },
    };
    sql
      .mockResolvedValueOnce({ rows: [{ candidate_key: candidateKey, status: 'active', candidate, updated_at_token: 'version-1' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ candidate, updated_at_token: 'version-2' }], rowCount: 1 });

    await expect(store.completeStructuredAddressVerification(REQ, candidateKey, 'version-1', {
      contactEnvelope: structuredContactEnvelope(),
      addressTrustEnvelope: structuredAddressEnvelope(),
      expectedSourceVersions: { contact: 'b'.repeat(64), address_trust: 'c'.repeat(64) },
      legacyAddressReceipt: structuredAddressReceipt(candidateKey),
    })).resolves.toMatchObject({ outcome: 'recorded' });
    const persisted = jsonInterpolations().find((value) => value?.addressTrustReceipt?.receiptId);
    expect(persisted.stageFreshness.roster_persistence).toBeUndefined();
  });
});

describe('findCandidateBySuggestion', () => {
  test('returns the server-owned roster status with the candidate blob', async () => {
    sql.mockResolvedValueOnce({ rows: [{
      candidate_key: 'suggestion:sug-1',
      status: 'ineligible',
      display_name: 'Pat Thiel',
      candidate: { name: 'Pat Thiel', suggestionId: 'SUG-1' },
      source_kind: 'applicant_suggested',
      updated_at_token: '2026-07-20 10:00:00+00',
    }] });

    await expect(store.findCandidateBySuggestion(REQ, 'SUG-1')).resolves.toMatchObject({
      name: 'Pat Thiel',
      suggestionId: 'SUG-1',
      candidateKey: 'suggestion:sug-1',
      rosterStatus: 'ineligible',
      rosterUpdatedAt: '2026-07-20 10:00:00+00',
    });
    expect(queryTextOf(0)).toMatch(/candidate_key\s*=/);
    expect(allInterpolations()).toContain('suggestion:sug-1');
  });

  // The promote path depends on this staying canonical-key-only: an anchor-stamped row
  // that predates the identity spine must remain invisible here, because its gate inputs
  // are null and resolving it would wave it through promotion (S387).
  test('still requires the canonical key, not just the anchor', async () => {
    await store.findCandidateBySuggestion(REQ, 'SUG-1');
    expect(queryTextOf(0)).toMatch(/candidate_key\s*=/);
  });
});

describe('findCandidateByKey', () => {
  test('uses only the exact request/key correlation and returns the server row', async () => {
    sql.mockResolvedValueOnce({ rows: [{
      candidate_key: 'candidate:ann', status: 'active', display_name: 'Ann Lee',
      candidate: { name: 'Ann Lee' }, source_kind: 'literature_retrieved',
      updated_at_token: 'version-1',
    }] });
    await expect(store.findCandidateByKey(REQ, 'candidate:ann')).resolves.toMatchObject({
      candidateKey: 'candidate:ann', rosterStatus: 'active', rosterUpdatedAt: 'version-1',
    });
    expect(queryTextOf(0)).toMatch(/candidate_key\s*=/);
    expect(allInterpolations()).toContain('candidate:ann');
  });
});

describe('findCandidateBySuggestionAnchor', () => {
  test('resolves a row whose key is a pre-anchor placeholder', async () => {
    sql.mockResolvedValueOnce({ rows: [{
      candidate_key: 'legacy-row:369',
      status: 'active',
      display_name: 'W. Lee Kraus',
      candidate: { name: 'W. Lee Kraus', suggestionId: 'SUG-1', candidateKey: 'legacy-row:369' },
      source_kind: 'applicant_suggested',
      updated_at_token: '2026-07-29 17:36:31+00',
    }] });

    await expect(store.findCandidateBySuggestionAnchor(REQ, 'SUG-1')).resolves.toMatchObject({
      name: 'W. Lee Kraus',
      candidateKey: 'legacy-row:369',
      rosterStatus: 'active',
    });
    // Matches on the ANCHOR — the key appears only as an ORDER BY tiebreak, never as a
    // filter, which is the whole point: a placeholder-keyed row must be findable.
    expect(queryTextOf(0)).toMatch(/candidate->>'suggestionId'/);
    const whereClause = queryTextOf(0).split(/ORDER BY/i)[0].split(/WHERE/i)[1] || '';
    expect(whereClause).not.toMatch(/candidate_key/);
    expect(queryTextOf(0)).toMatch(/ORDER BY \(candidate_key/);
  });

  test('prefers the canonical row when both shapes exist', async () => {
    await store.findCandidateBySuggestionAnchor(REQ, 'SUG-1');
    expect(queryTextOf(0)).toMatch(/ORDER BY \(candidate_key\s*=/);
    expect(allInterpolations()).toContain('suggestion:sug-1');
  });

  test('returns null without querying when the anchor is missing', async () => {
    await expect(store.findCandidateBySuggestionAnchor(REQ, '')).resolves.toBeNull();
    expect(sql).not.toHaveBeenCalled();
  });
});

describe('findCandidatesByKeys', () => {
  test('returns exact request-scoped roster rows with status and concurrency tokens', async () => {
    const longGeneratedKey = `candidate:${'a'.repeat(680)}`;
    sql.mockResolvedValueOnce({ rows: [{
      candidate_key: 'candidate:ann',
      status: 'active',
      display_name: 'Ann Lee',
      candidate: { name: 'Ann Lee' },
      source_kind: 'literature_retrieved',
      updated_at_token: '2026-07-20 11:00:00+00',
    }] });

    await expect(store.findCandidatesByKeys(REQ, [
      'candidate:ann',
      'candidate:ann',
      longGeneratedKey,
      '',
    ])).resolves.toEqual([expect.objectContaining({
      name: 'Ann Lee',
      candidateKey: 'candidate:ann',
      rosterStatus: 'active',
      rosterUpdatedAt: '2026-07-20 11:00:00+00',
    })]);
    expect(queryTextOf(0)).toMatch(/jsonb_array_elements_text/);
    expect(allInterpolations()).toEqual(expect.arrayContaining([
      REQ,
      JSON.stringify(['candidate:ann', longGeneratedKey]),
    ]));
  });
});

describe('removePreviousActiveSearchResults', () => {
  test('deletes only active allowlisted search provenance and returns the count', async () => {
    sql.mockResolvedValueOnce({ rows: [{
      removed: 2,
      removed_keys: ['candidate:a', 'candidate:b'],
      roster_rows: [
        { status: 'active', display_name: 'Applicant Person', candidate: { name: 'Applicant Person' }, updated_at_token: '2026-07-19 15:00:00.123456+00' },
        { status: 'excluded', display_name: 'Excluded Person', candidate: { name: 'Excluded Person' } },
        { status: 'saved', display_name: 'Saved Person', candidate: { name: 'Saved Person' } },
        { status: 'active', display_name: 'Flagged COI Person', candidate: { name: 'Flagged COI Person', hasInstitutionCOI: true }, updated_at_token: '2026-07-19 14:00:00.654321+00' },
        { status: 'coi_dropped', display_name: 'COI Ledger Person', candidate: { name: 'COI Ledger Person' } },
      ],
    }] });

    const out = await store.removePreviousActiveSearchResults(
      REQ,
      [
        { candidateKey: 'candidate:a', updatedAt: '2026-07-19T12:00:00.000Z' },
        { candidateKey: 'candidate:b', updatedAt: '2026-07-19T13:00:00.000Z' },
        { candidateKey: 'candidate:a', updatedAt: '2026-07-19T12:00:00.000Z' },
      ],
    );
    expect(out.removed).toBe(2);
    expect(out.removedKeys).toEqual(['candidate:a', 'candidate:b']);
    expect(out.active.map((candidate) => candidate.name)).toEqual(['Applicant Person', 'Flagged COI Person']);
    expect(out.active[0].rosterUpdatedAt).toBe('2026-07-19 15:00:00.123456+00');
    expect(out.excluded.map((candidate) => candidate.name)).toEqual(['Excluded Person']);
    expect(out.allNames).toEqual(['Applicant Person', 'Excluded Person', 'Saved Person', 'Flagged COI Person', 'COI Ledger Person']);

    const text = queryTextOf(0);
    expect(text).toMatch(/DELETE FROM reviewer_find_roster/);
    expect(text).toMatch(/roster\.status = 'active'/);
    expect(text).toMatch(/jsonb_to_recordset/);
    expect(text).toMatch(/roster\.updated_at::text = target\.updated_at_token/);
    expect(text).toMatch(/hasInstitutionCOI.*IS DISTINCT FROM 'true'/);
    expect(text).toMatch(/candidate_key NOT IN \(SELECT candidate_key FROM deleted\)/);
    expect(text).toMatch(/source_kind IN/);
    expect(text).toMatch(/'literature_retrieved'/);
    expect(text).toMatch(/'referred'/);
    expect(text).toMatch(/'claude_verified'/);
    expect(text).not.toMatch(/'applicant_suggested'/);
    expect(text).not.toMatch(/status IN/);
    expect(allInterpolations()).toContain(REQ);
    expect(allInterpolations()).toContain(JSON.stringify([
      { candidate_key: 'candidate:a', updated_at_token: '2026-07-19T12:00:00.000Z' },
      { candidate_key: 'candidate:b', updated_at_token: '2026-07-19T13:00:00.000Z' },
    ]));
  });

  test('an empty candidate-ref set performs only the roster read', async () => {
    sql.mockResolvedValueOnce({ rows: [
      { status: 'active', display_name: 'Applicant Person', candidate: { name: 'Applicant Person' } },
    ] });
    const out = await store.removePreviousActiveSearchResults(REQ, []);
    expect(out.removed).toBe(0);
    expect(out.removedKeys).toEqual([]);
    expect(out.active.map((candidate) => candidate.name)).toEqual(['Applicant Person']);
    expect(out.excluded).toEqual([]);
    expect(out.allNames).toEqual(['Applicant Person']);
    expect(sql).toHaveBeenCalledTimes(1);
    expect(queryTextOf(0)).toMatch(/SELECT candidate_key, status/);
    expect(queryTextOf(0)).not.toMatch(/DELETE/);
  });
});

describe('recordSurfaced', () => {
  beforeEach(() => {
    sql.mockResolvedValue({ rows: [], rowCount: 1 });
  });

  test('records named candidates (normalized) and skips unnamed/blank ones', async () => {
    const n = await store.recordSurfaced(REQ, [
      { name: 'Dr. Ann Lee' }, { name: '' }, { name: '   ' }, { name: 'Bob' },
    ]);
    expect(n).toBe(2);
    const interps = allInterpolations();
    expect(interps).toContain('ann lee'); // honorific stripped + normalized
    expect(interps).toContain('bob');
  });

  test('does not report a surfaced write as successful until the active/saved cap is enforced', async () => {
    await store.recordSurfaced(REQ, [{ name: 'Ann Lee' }]);

    const capDelete = sql.mock.calls.findIndex((call) => queryTextOf(sql.mock.calls.indexOf(call)).includes('OFFSET'));
    expect(capDelete).toBeGreaterThanOrEqual(0);
    expect(queryTextOf(capDelete)).toMatch(/DELETE FROM reviewer_find_roster/);
    expect(allInterpolations()).toContain(store.PER_REQUEST_ACTIVE_CAP);
  });

  test('fails explicitly when cap enforcement cannot complete after a surfaced write', async () => {
    sql
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockRejectedValueOnce(new Error('database unavailable'));
    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});

    await expect(store.recordSurfaced(REQ, [{ name: 'Ann Lee' }])).rejects.toMatchObject({
      code: 'reviewer_roster_cap_enforcement_failed',
    });
    expect(errorLog).toHaveBeenCalledWith('reviewer-roster enforceCap error:', 'database unavailable');
    errorLog.mockRestore();
  });

  test('emits PostgreSQL-safe template text without JavaScript line comments', async () => {
    await store.recordSurfaced(REQ, [{ name: 'Ann Lee' }]);
    const insertCall = sql.mock.calls.findIndex((call) => (
      Array.isArray(call[0]) && call[0].join(' ').includes('INSERT INTO reviewer_find_roster')
    ));

    // PostgreSQL recognizes -- and /* */ comments, not JavaScript // lines.
    // Keep a negative fixture so the gate proves it catches the production bug.
    expect(hasJavaScriptLineComment('SELECT 1\n  // invalid PostgreSQL comment')).toBe(true);
    expect(insertCall).toBeGreaterThanOrEqual(0);
    expect(hasJavaScriptLineComment(queryTextOf(insertCall))).toBe(false);
  });

  test('the conflict update guards against downgrading excluded/saved (never-downgrade)', async () => {
    await store.recordSurfaced(REQ, [{ name: 'Ann Lee' }]);
    // The INSERT ... ON CONFLICT DO UPDATE must only run WHERE status='active',
    // so excluded/saved/coi_dropped can never be reactivated by a surfaced record.
    const insertCall = sql.mock.calls.findIndex((c) =>
      Array.isArray(c[0]) && c[0].join(' ').includes('INSERT INTO reviewer_find_roster'));
    expect(insertCall).toBeGreaterThanOrEqual(0);
    expect(queryTextOf(insertCall)).toMatch(/status = 'active'/);
  });

  test('records direct deceased evidence as monotonic ineligible status', async () => {
    await store.recordSurfaced(REQ, [{
      name: 'Patricia Thiel',
      eligibilityStatus: 'deceased',
      eligibilityEvidence: { url: 'https://ameslab.gov/pat-thiel' },
    }]);
    const text = queryTextOf(0);
    expect(allInterpolations()).toContain('ineligible');
    expect(text).toMatch(/EXCLUDED\.status = 'ineligible'/);
    expect(text).toMatch(/reviewer_find_roster\.status = 'ineligible'/);
  });

  test('keeps same-name candidates with different affiliations in separate roster rows', async () => {
    await store.recordSurfaced(REQ, [
      { name: 'Alex Kim', affiliation: 'University One' },
      { name: 'Alex Kim', affiliation: 'University Two' },
    ]);
    const inserts = sql.mock.calls.filter((call) => queryTextOf(sql.mock.calls.indexOf(call)).includes('INSERT INTO reviewer_find_roster'));
    expect(inserts).toHaveLength(2);
    const keys = inserts.map((call) => call.slice(1).find((value) => (
      typeof value === 'string' && value.startsWith('candidate:')
    )));
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBeTruthy();
    expect(keys[0]).not.toBe(keys[1]);
    expect(inserts[0][0].join(' ')).toMatch(/ON CONFLICT \(request_id, candidate_key\)/);
  });

  test('uses the snapshot token for conflict updates and reports a stale no-op', async () => {
    sql.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const n = await store.recordSurfaced(
      REQ,
      [{ name: 'Ann Lee', suggestionId: 'SUG-1' }],
      { expectedUpdatedAt: '2026-07-20 10:00:00+00' },
    );
    expect(n).toBe(0);
    expect(queryTextOf(0)).toMatch(/reviewer_find_roster\.updated_at::text/);
    expect(allInterpolations()).toEqual(expect.arrayContaining([
      true,
      '2026-07-20 10:00:00+00',
    ]));
  });

  test('allows a first insert while refusing a conflict when the snapshot had no row', async () => {
    const n = await store.recordSurfaced(
      REQ,
      [{ name: 'Ann Lee', suggestionId: 'SUG-1' }],
      { expectedUpdatedAt: null },
    );
    expect(n).toBe(1);
    expect(queryTextOf(0)).toMatch(/INSERT INTO reviewer_find_roster/);
    expect(allInterpolations()).toEqual(expect.arrayContaining([false, '']));
  });

  test('drops every stage receipt when generic replacement evidence wins', async () => {
    await store.recordSurfaced(REQ, [{
      name: 'Ann Lee',
      identityEvidence: { decision: 'changed evidence' },
      stageFreshness: allCurrentUpstreams(),
      stageRefresh: { identity: { refreshAttemptId: 'browser-lease' } },
      warmCacheVersion: 999,
      proposalContentVersion: 'forged-proposal-version',
      applicantInputVersion: 'forged-applicant-version',
      staffIdentityConfirmation: { forged: true },
      pdIdentityConfirmed: true,
      pdIdentityConfirmationId: 'forged-confirmation',
      addressTrustReceipt: { forged: true },
      manualContactFields: ['email'],
    }]);

    const text = queryTextOf(0);
    const submitted = jsonInterpolations().find((value) => value?.identityEvidence?.decision === 'changed evidence');
    expect(submitted.stageFreshness).toBeUndefined();
    expect(submitted.stageRefresh).toBeUndefined();
    expect(submitted.warmCacheVersion).toBeUndefined();
    expect(submitted.proposalContentVersion).toBeUndefined();
    expect(submitted.applicantInputVersion).toBeUndefined();
    expect(submitted.staffIdentityConfirmation).toBeUndefined();
    expect(submitted.pdIdentityConfirmed).toBeUndefined();
    expect(submitted.pdIdentityConfirmationId).toBeUndefined();
    expect(submitted.addressTrustReceipt).toBeUndefined();
    expect(submitted.manualContactFields).toBeUndefined();
    expect(text).toMatch(/'stageFreshness', '\{\}'::jsonb/);
    expect(text).not.toMatch(/COALESCE\(reviewer_find_roster\.candidate->'stageFreshness'/);
    expect(text).toMatch(/'stageRefresh', reviewer_find_roster\.candidate->'stageRefresh'/);
    expect(text).not.toMatch(/jsonb_strip_nulls/);
  });
});

describe('recordSurfacedWithStageEvidence', () => {
  test('enforces the active/saved cap after a new cold-stage row is recorded', async () => {
    sql
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ candidate: { name: 'Ann' }, updated_at_token: 'version-2' }], rowCount: 1 });
    const outcomes = await store.recordSurfacedWithStageEvidence(REQ, [{
      candidate: { name: 'Ann', candidateKey: 'person:ann' },
      stageEvidence: { applicant_anchor: coldEnvelope('applicant_anchor') },
    }]);

    expect(outcomes).toEqual([expect.objectContaining({ outcome: 'recorded' })]);
    const capDelete = sql.mock.calls.findIndex((call) => queryTextOf(sql.mock.calls.indexOf(call)).includes('OFFSET'));
    expect(capDelete).toBeGreaterThanOrEqual(0);
    expect(queryTextOf(capDelete)).toMatch(/DELETE FROM reviewer_find_roster/);
  });

  test('fails explicitly when cap enforcement cannot complete after a cold-stage write', async () => {
    sql
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ candidate: { name: 'Ann' }, updated_at_token: 'version-2' }], rowCount: 1 })
      .mockRejectedValueOnce(new Error('database unavailable'));
    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});

    await expect(store.recordSurfacedWithStageEvidence(REQ, [{
      candidate: { name: 'Ann', candidateKey: 'person:ann' },
      stageEvidence: { applicant_anchor: coldEnvelope('applicant_anchor') },
    }])).rejects.toMatchObject({
      code: 'reviewer_roster_cap_enforcement_failed',
    });
    expect(errorLog).toHaveBeenCalledWith('reviewer-roster enforceCap error:', 'database unavailable');
    errorLog.mockRestore();
  });

  test('merges CAS-valid cold receipts with stored receipts and computes terminal from the actual merged receipt set', async () => {
    const existingAnchor = currentReceipt('applicant_anchor', 'anchor');
    sql
      .mockResolvedValueOnce({ rows: [{
        candidate_key: 'person:ann', status: 'active', updated_at_token: 'version-1',
        candidate: { name: 'Ann', stageFreshness: { applicant_anchor: existingAnchor } },
      }] })
      .mockResolvedValueOnce({ rows: [{ candidate: { name: 'Ann' }, updated_at_token: 'version-2' }], rowCount: 1 });

    const downstreamEvidence = Object.fromEntries(TERMINAL_STAGES
      .filter((stage) => stage !== 'applicant_anchor')
      .map((stage) => [stage, coldEnvelope(stage)]));
    const outcomes = await store.recordSurfacedWithStageEvidence(REQ, [{
      candidate: { name: 'Ann', candidateKey: 'person:ann' },
      expectedUpdatedAt: 'version-1',
      stageEvidence: downstreamEvidence,
    }]);

    expect(outcomes).toEqual([expect.objectContaining({ candidateKey: 'person:ann', outcome: 'recorded' })]);
    const persisted = jsonInterpolations().find((value) => (
      value?.stageFreshness?.roster_persistence
    ));
    expect(persisted.stageFreshness.applicant_anchor).toEqual(existingAnchor);
    expect(persisted.stageFreshness.identity).toMatchObject({ state: 'current' });
    expect(persisted.stageFreshness.roster_persistence).toEqual(store.rosterPersistenceReceipt(
      'person:ann',
      Object.fromEntries(TERMINAL_STAGES.map((stage) => [stage, persisted.stageFreshness[stage]])),
      persisted.stageFreshness.roster_persistence.completedAt,
    ));
    expect(queryTextOf(1)).toMatch(/updated_at::text/);
    expect(allInterpolations()).toContain('version-1');
  });

  test('a stale per-entry token leaves the stored row untouched and returns skipped_stale', async () => {
    sql.mockResolvedValueOnce({ rows: [{
      candidate_key: 'person:ann', status: 'active', updated_at_token: 'newer-token',
      candidate: { name: 'Ann', stageFreshness: { applicant_anchor: currentReceipt('applicant_anchor') } },
    }] });

    const outcomes = await store.recordSurfacedWithStageEvidence(REQ, [{
      candidate: { name: 'Ann', candidateKey: 'person:ann' },
      expectedUpdatedAt: 'stale-token',
      stageEvidence: { identity: coldEnvelope('identity') },
    }]);

    expect(outcomes).toEqual([expect.objectContaining({ outcome: 'skipped_stale' })]);
    expect(sql).toHaveBeenCalledTimes(2); // snapshot + cap; no candidate mutation
    expect(queryTextOf(0)).toMatch(/SELECT candidate_key/);
  });

  test('creates a cold deceased candidate as ineligible from projected eligibility evidence', async () => {
    sql
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ candidate: { name: 'Pat' }, updated_at_token: 'version-2' }], rowCount: 1 });

    const outcomes = await store.recordSurfacedWithStageEvidence(REQ, [{
      candidate: { name: 'Pat', candidateKey: 'person:pat' },
      stageEvidence: {
        eligibility: coldEnvelope('eligibility', 'deceased', {
          eligibilityStatus: 'deceased',
          eligibilityCheckStatus: 'complete',
        }),
      },
    }]);

    expect(outcomes).toEqual([expect.objectContaining({ outcome: 'recorded' })]);
    expect(allInterpolations()).toContain('ineligible');
    expect(queryTextOf(1)).toMatch(/INSERT INTO reviewer_find_roster/);
  });

  test('marks an active cold row ineligible when projected eligibility is deceased', async () => {
    sql
      .mockResolvedValueOnce({ rows: [{
        candidate_key: 'person:pat', status: 'active', updated_at_token: 'version-1',
        candidate: { name: 'Pat', candidateKey: 'person:pat' },
      }] })
      .mockResolvedValueOnce({ rows: [{ candidate: { name: 'Pat' }, updated_at_token: 'version-2' }], rowCount: 1 });

    const outcomes = await store.recordSurfacedWithStageEvidence(REQ, [{
      candidate: { name: 'Pat', candidateKey: 'person:pat' },
      expectedUpdatedAt: 'version-1',
      stageEvidence: {
        eligibility: coldEnvelope('eligibility', 'deceased', {
          eligibilityStatus: 'deceased',
          eligibilityCheckStatus: 'complete',
        }),
      },
    }]);

    expect(outcomes).toEqual([expect.objectContaining({ outcome: 'recorded' })]);
    expect(allInterpolations()).toContain('ineligible');
    expect(queryTextOf(1)).toMatch(/SET status = CASE/);
  });

  test('leaves a staff-confirmed row untouched when cold evidence projects an identity-dependent stage', async () => {
    const priorReceipts = allCurrentUpstreams();
    sql.mockResolvedValueOnce({ rows: [{
      candidate_key: 'person:ann', status: 'active', updated_at_token: 'version-1',
      candidate: {
        name: 'Ann', candidateKey: 'person:ann', stageFreshness: priorReceipts,
        pdIdentityConfirmed: true,
        staffIdentityConfirmation: { confirmationId: 'staff-confirm-1' },
      },
    }] });

    const outcomes = await store.recordSurfacedWithStageEvidence(REQ, [{
      candidate: { name: 'Ann', candidateKey: 'person:ann' },
      expectedUpdatedAt: 'version-1',
      stageEvidence: { applicant_anchor: coldEnvelope('applicant_anchor', 'new-anchor') },
    }]);

    expect(outcomes).toEqual([expect.objectContaining({
      candidateKey: 'person:ann', outcome: 'skipped_staff_authority', code: 'skipped_staff_authority',
      stageOutcomes: expect.objectContaining({ identity: 'current' }),
    })]);
    expect(sql.mock.calls.some((call) => queryTextOf(sql.mock.calls.indexOf(call)).includes('UPDATE reviewer_find_roster'))).toBe(false);
    expect(sql).toHaveBeenCalledTimes(2); // snapshot + cap only
  });

  test('discards forged candidate receipt/version/evidence fields and persists only projector output', async () => {
    sql
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ candidate: { name: 'Ann' }, updated_at_token: 'version-2' }], rowCount: 1 });
    const outcomes = await store.recordSurfacedWithStageEvidence(REQ, [{
      candidate: {
        name: 'Ann', candidateKey: 'person:ann', warmCacheVersion: 999,
        proposalContentVersion: 'forged-proposal', applicantInputVersion: 'forged-input',
        proposalAuthorVersion: 'b'.repeat(64),
        canonicalPersonId: 'forged-person', personEtag: 'forged-etag',
        identityDecision: 'forged-identity', email: 'forged@example.edu',
        addressTrustReceipt: { forged: true },
        stageFreshness: allCurrentUpstreams(),
        contactEnrichment: {
          identity: { status: 'confirmed' },
          email: 'nested-forged@example.edu',
          eligibilityStatus: 'eligible',
          affiliation: 'Nested forged institution',
        },
      },
      stageEvidence: {
        applicant_anchor: coldEnvelope('applicant_anchor', 'server-anchor', { applicantInputVersion: 'server-input' }),
      },
    }]);

    expect(outcomes).toEqual([expect.objectContaining({ outcome: 'recorded' })]);
    const persisted = JSON.parse(allInterpolations().find((value) => (
      typeof value === 'string' && value.includes('server-input')
    )));
    expect(persisted).toMatchObject({ warmCacheVersion: 1, applicantInputVersion: 'server-input' });
    expect(persisted.identityDecision).toBeUndefined();
    expect(persisted.email).toBeUndefined();
    expect(persisted.addressTrustReceipt).toBeUndefined();
    expect(persisted.proposalContentVersion).toBeUndefined();
    expect(persisted.proposalAuthorVersion).toBeUndefined();
    expect(persisted.canonicalPersonId).toBeUndefined();
    expect(persisted.personEtag).toBeUndefined();
    expect(persisted.contactEnrichment).toBeUndefined();
    expect(persisted.stageFreshness).toEqual({ applicant_anchor: expect.any(Object) });
  });

  test('uses each entry’s own token in a mixed new, current, and stale cold batch', async () => {
    sql
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ candidate: { name: 'New' }, updated_at_token: 'new-v2' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{
        candidate_key: 'person:existing', status: 'active', updated_at_token: 'existing-v1', candidate: { name: 'Existing' },
      }] })
      .mockResolvedValueOnce({ rows: [{ candidate: { name: 'Existing' }, updated_at_token: 'existing-v2' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{
        candidate_key: 'person:stale', status: 'active', updated_at_token: 'newer-v1', candidate: { name: 'Stale' },
      }] });
    const stageEvidence = { applicant_anchor: coldEnvelope('applicant_anchor') };

    const outcomes = await store.recordSurfacedWithStageEvidence(REQ, [
      { candidate: { name: 'New', candidateKey: 'person:new' }, stageEvidence },
      { candidate: { name: 'Existing', candidateKey: 'person:existing' }, expectedUpdatedAt: 'existing-v1', stageEvidence },
      { candidate: { name: 'Stale', candidateKey: 'person:stale' }, expectedUpdatedAt: 'stale-v1', stageEvidence },
    ]);

    expect(outcomes.map((outcome) => outcome.outcome)).toEqual(['recorded', 'recorded', 'skipped_stale']);
    expect(allInterpolations()).toEqual(expect.arrayContaining(['existing-v1']));
    expect(allInterpolations()).not.toContain('stale-v1');
  });

  test('leaves a fully complete legacy key partial rather than minting terminal authority', async () => {
    sql
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ candidate: { name: 'Legacy' }, updated_at_token: 'legacy-v2' }], rowCount: 1 });
    const stageEvidence = Object.fromEntries(TERMINAL_STAGES.map((stage) => [stage, coldEnvelope(stage)]));
    const outcomes = await store.recordSurfacedWithStageEvidence(REQ, [{
      candidate: { name: 'Legacy', candidateKey: 'candidate:legacy' },
      stageEvidence,
    }]);

    expect(outcomes).toEqual([expect.objectContaining({ outcome: 'partial', code: 'canonical_candidate_unavailable' })]);
    const persisted = jsonInterpolations().find((value) => value?.candidateKey === 'candidate:legacy');
    expect(persisted.stageFreshness.roster_persistence).toBeUndefined();
  });
});

describe('recordCoiDropped', () => {
  test('upserts named institution-COI drops as non-selectable coi_dropped ledger rows', async () => {
    const n = await store.recordCoiDropped(REQ, [
      {
        name: 'Dr. Dee Coe',
        affiliation: 'University of Michigan',
        institutionCOIDetails: {
          piInstitution: 'University of Michigan',
          reviewerInstitution: 'University of Michigan',
        },
      },
      { name: '' },
    ], { dropStage: 'track_a_verified', matchSource: 'test' });

    expect(n).toBe(1);
    const text = queryTextOf(0);
    expect(text).toMatch(/INSERT INTO reviewer_find_roster/);
    expect(text).toMatch(/'coi_dropped'/);
    expect(text).toMatch(/status = 'coi_dropped'/);
    expect(allInterpolations()).toEqual(expect.arrayContaining(['dee coe']));
    const blob = JSON.parse(allInterpolations().find((value) => typeof value === 'string' && value.includes('track_a_verified')));
    expect(blob).toMatchObject({
      name: 'Dr. Dee Coe',
      hasInstitutionCOI: true,
      institutionCOIDetails: {
        piInstitution: 'University of Michigan',
        reviewerInstitution: 'University of Michigan',
        dropStage: 'track_a_verified',
        matchSource: 'test',
      },
    });
  });
});

describe('setExcluded', () => {
  test('upserts (eviction-tolerant) and forces status excluded', async () => {
    await store.setExcluded(REQ, { name: 'Bob Roe' });
    const text = queryTextOf(0);
    expect(text).toMatch(/INSERT INTO reviewer_find_roster/);
    expect(text).toMatch(/status = 'excluded'/);
    expect(allInterpolations()).toContain('bob roe');
  });

  test('throws on a nameless candidate', async () => {
    await expect(store.setExcluded(REQ, { name: '' })).rejects.toThrow(/name\/key required/);
  });
});

describe('promote', () => {
  test('returns the stored candidate blob on success', async () => {
    sql.mockResolvedValueOnce({ rows: [{ candidate: { name: 'Bob Roe', hIndex: 9 } }] });
    const blob = await store.promote(REQ, 'candidate:bob');
    expect(blob).toEqual({ name: 'Bob Roe', hIndex: 9 });
    expect(queryTextOf(0)).toMatch(/status = 'excluded'/); // only promotes from excluded
    expect(queryTextOf(0)).toMatch(/candidate_key =/);
    expect(allInterpolations()).toContain('candidate:bob');
    expect(queryTextOf(1)).toMatch(/DELETE FROM reviewer_find_roster/);
  });

  test('fails explicitly rather than returning promotion success if cap enforcement fails', async () => {
    sql
      .mockResolvedValueOnce({ rows: [{ candidate: { name: 'Bob Roe' } }], rowCount: 1 })
      .mockRejectedValueOnce(new Error('database unavailable'));
    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});

    await expect(store.promote(REQ, 'candidate:bob')).rejects.toMatchObject({
      code: 'reviewer_roster_cap_enforcement_failed',
    });
    expect(errorLog).toHaveBeenCalledWith('reviewer-roster enforceCap error:', 'database unavailable');
    errorLog.mockRestore();
  });

  test('no-op (null) when the row is gone (cap eviction)', async () => {
    sql.mockResolvedValueOnce({ rows: [] });
    expect(await store.promote(REQ, 'candidate:ghost')).toBeNull();
  });
});

describe('staff identity confirmation', () => {
  test('stores an actor/time/contact-bound confirmation only on an active request row', async () => {
    sql.mockResolvedValueOnce({ rows: [{ candidate: { name: 'Dr Ann Lee' } }], rowCount: 1 });
    const canonicalPerson = {
      canonicalPersonId: '22222222-2222-4222-8222-222222222222',
      canonicalPersonEtag: 'W/"ann-v1"',
      actorId: 'SYS-7',
      confirmedAt: '2026-08-02T12:01:00.000Z',
    };
    const identityEnvelope = projectStaffConfirmedIdentityEvidence({
      candidate: {
        candidateKey: 'candidate:ann',
        name: 'Dr Ann Lee',
        affiliation: 'Example University',
      },
      proposalContentVersion: SOURCE_VERSION,
      confirmation: { authority: 'server_loaded', ...canonicalPerson },
      completedAt: canonicalPerson.confirmedAt,
      expectedSourceVersion: SOURCE_VERSION,
    });
    const out = await store.confirmIdentity(REQ, {
      name: 'Dr Ann Lee',
      email: ' ANN@Example.edu ',
      website: 'https://example.edu/ann',
      affiliation: 'Example University',
      rosterStatus: 'active',
      rosterUpdatedAt: '2026-08-02 12:00:00+00',
    }, {
      actorProfileId: 7,
      actorSystemUserId: 'SYS-7',
      canonicalPerson,
      identityEnvelope,
      expectedUpdatedAt: '2026-08-02 12:00:00+00',
    });

    expect(out.confirmationId).toEqual(expect.any(String));
    const text = queryTextOf(0);
    expect(text).toMatch(/status = 'active'/);
    expect(text).toMatch(/candidate = candidate \|\|/);
    expect(text).toMatch(/candidate_key =/);
    const stored = JSON.parse(allInterpolations().find((entry) => (
      typeof entry === 'string' && entry.includes('staffIdentityConfirmation')
    )));
    expect(stored).toMatchObject({
      email: 'ann@example.edu',
      pdIdentityConfirmed: true,
      applicantContactMismatch: false,
      pdIdentityConfirmationId: out.confirmationId,
      staffIdentityConfirmation: {
        source: 'staff_confirmed',
        state: 'confirmed',
        canonicalPersonId: canonicalPerson.canonicalPersonId,
        canonicalPersonEtag: canonicalPerson.canonicalPersonEtag,
        actorId: 'SYS-7',
        confirmedAt: canonicalPerson.confirmedAt,
        normalizedName: 'ann lee',
        email: 'ann@example.edu',
        actorProfileId: 7,
        actorSystemUserId: 'SYS-7',
      },
    });
    expect(stored).not.toHaveProperty('rosterStatus');
    expect(stored).not.toHaveProperty('rosterUpdatedAt');
  });

  test('findIdentityConfirmation is request + opaque-id scoped', async () => {
    sql.mockResolvedValueOnce({
      rows: [{
        candidate_key: 'candidate:ann',
        confirmation: { source: 'staff_confirmed', email: 'ann@example.edu' },
      }],
    });
    await expect(store.findIdentityConfirmation(REQ, 'confirm-1')).resolves.toMatchObject({
      source: 'staff_confirmed',
      email: 'ann@example.edu',
      rosterCandidateKey: 'candidate:ann',
    });
    expect(queryTextOf(0)).toMatch(/SELECT candidate_key/);
    expect(queryTextOf(0)).toMatch(/candidate->>'pdIdentityConfirmationId'/);
    expect(allInterpolations()).toEqual(expect.arrayContaining([REQ, 'confirm-1']));
  });
});

describe('address attestation', () => {
  test('persists a receipt for the real literature-row shape with matching top-level and enrichment emails', async () => {
    sql
      .mockResolvedValueOnce({
        rows: [{
          candidate_key: 'candidate:ann',
          status: 'active',
          source_kind: 'literature_retrieved',
          updated_at_token: '2026-07-30 10:00:00+00',
          candidate: {
            name: 'Ann Lee',
            email: 'found@example.edu',
            emailSource: 'scholarly_multi',
            conflictRecordUnavailable: true,
            contactEnrichment: {
              email: 'found@example.edu',
              emailSource: 'scholarly_multi',
              conflictRecordUnavailable: true,
            },
          },
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          candidate_key: 'candidate:ann',
          source_kind: 'literature_retrieved',
          updated_at_token: '2026-07-30 10:01:00+00',
          candidate: { name: 'Ann Lee', email: 'found@example.edu' },
        }],
        rowCount: 1,
      });

    const out = await store.attestAddress(REQ, 'candidate:ann', {
      email: 'found@example.edu',
      evidenceType: 'institution_page',
      evidenceUrl: 'https://example.edu/profile',
      actorProfileId: '7',
      actorSystemUserId: 'SYS-7',
    });

    expect(out.receipt).toMatchObject({
      receiptId: expect.any(String),
      email: 'found@example.edu',
      personConfirmed: true,
      requestId: REQ,
      candidateKey: 'candidate:ann',
    });
    const persisted = JSON.parse(allInterpolations().find((entry) => (
      typeof entry === 'string' && entry.includes('addressTrustReceipt')
    )));
    expect(persisted).toMatchObject({
      email: 'found@example.edu',
      emailSource: 'scholarly_multi',
      manualContactFields: [],
      addressTrustReceipt: { email: 'found@example.edu' },
      contactEnrichment: {
        email: 'found@example.edu',
        emailSource: 'scholarly_multi',
      },
    });
    expect(queryTextOf(1)).toMatch(/updated_at::text/);
    expect(allInterpolations()).toContain('2026-07-30 10:00:00+00');
  });

  test('an explicitly changed attested address replaces both candidate projections and becomes manual', async () => {
    sql
      .mockResolvedValueOnce({
        rows: [{
          candidate_key: 'candidate:ann',
          status: 'active',
          source_kind: 'literature_retrieved',
          updated_at_token: 'row-version-1',
          candidate: {
            name: 'Ann Lee',
            email: 'found@example.edu',
            emailSource: 'scholarly_multi',
            contactEnrichment: { email: 'found@example.edu', emailSource: 'scholarly_multi' },
          },
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          candidate_key: 'candidate:ann',
          source_kind: 'literature_retrieved',
          updated_at_token: 'row-version-2',
          candidate: { name: 'Ann Lee', email: 'stored@example.edu' },
        }],
        rowCount: 1,
      });

    await store.attestAddress(REQ, 'candidate:ann', {
      email: 'stored@example.edu',
      evidenceType: 'direct_correspondence',
      note: 'Confirmed directly.',
    });

    const persisted = JSON.parse(allInterpolations().find((entry) => (
      typeof entry === 'string' && entry.includes('addressTrustReceipt')
    )));
    expect(persisted).toMatchObject({
      email: 'stored@example.edu',
      emailSource: 'manual',
      manualContactFields: ['email'],
      addressTrustReceipt: { email: 'stored@example.edu' },
      contactEnrichment: {
        email: 'stored@example.edu',
        emailSource: 'manual',
      },
    });
  });

  test('verified contact and address renew one matching staff confirmation in the same roster update', async () => {
    sql
      .mockResolvedValueOnce({
        rows: [{
          candidate_key: 'candidate:ann',
          status: 'active',
          source_kind: 'literature_retrieved',
          updated_at_token: 'row-version-1',
          candidate: {
            name: 'Ann Lee',
            email: 'ann@example.edu',
            website: 'https://example.edu/old',
            affiliation: 'Old Department',
            pdIdentityConfirmed: true,
            pdIdentityConfirmationId: 'confirmation-old',
            staffIdentityConfirmation: {
              confirmationId: 'confirmation-old',
              source: 'staff_confirmed',
              normalizedName: 'ann lee',
              email: 'ann@example.edu',
              website: 'https://example.edu/old',
              affiliation: 'Old Department',
            },
            contactEnrichment: { email: 'ann@example.edu' },
          },
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          updated_at_token: 'row-version-2',
          candidate: { name: 'Ann Lee', email: 'ann@example.edu' },
        }],
        rowCount: 1,
      });

    await store.attestAddress(REQ, 'candidate:ann', {
      email: 'ann@example.edu',
      verifiedContact: {
        website: 'https://example.edu/current',
        affiliation: 'Current Department',
      },
      evidenceType: 'institution_page',
      evidenceUrl: 'https://example.edu/current',
      actorProfileId: 'profile-1',
      actorSystemUserId: 'system-1',
    });

    const persisted = JSON.parse(allInterpolations().find((entry) => (
      typeof entry === 'string' && entry.includes('addressTrustReceipt')
    )));
    expect(persisted).toMatchObject({
      email: 'ann@example.edu',
      emailSource: 'manual',
      website: 'https://example.edu/current',
      websiteSource: 'manual',
      affiliation: 'Current Department',
      affiliationSource: 'staff_manual',
      manualContactFields: expect.arrayContaining(['email', 'website', 'affiliation']),
      pdIdentityConfirmed: true,
      pdIdentityConfirmationId: expect.any(String),
      addressTrustReceipt: { email: 'ann@example.edu' },
      staffIdentityConfirmation: {
        confirmationId: expect.any(String),
        source: 'staff_confirmed',
        normalizedName: 'ann lee',
        email: 'ann@example.edu',
        website: 'https://example.edu/current',
        affiliation: 'Current Department',
        actorProfileId: 'profile-1',
        actorSystemUserId: 'system-1',
      },
      contactEnrichment: {
        email: 'ann@example.edu',
        website: 'https://example.edu/current',
        affiliation: 'Current Department',
      },
    });
    expect(persisted.pdIdentityConfirmationId)
      .toBe(persisted.staffIdentityConfirmation.confirmationId);
  });
});

describe('finalizeCandidatePromotion', () => {
  test('server-owned finalization persists exact Dataverse anchors and returns the key', async () => {
    sql.mockResolvedValueOnce({ rows: [{ candidate_key: 'candidate:ann' }], rowCount: 1 });

    const result = await store.finalizeCandidatePromotion(
      REQ,
      { name: 'Ann Lee', candidateKey: 'candidate:ann', email: 'ann@example.edu' },
      {
        candidateKey: 'candidate:ann',
        suggestionId: 'SUG-1',
        potentialReviewerId: 'PID-1',
      },
    );

    expect(result).toEqual({ saved: true, candidateKey: 'candidate:ann' });
    const text = queryTextOf(0);
    expect(text).toMatch(/INSERT INTO reviewer_find_roster/);
    expect(text).toMatch(/status = 'saved'/);
    expect(text).toMatch(/status IN \('active', 'saved'\)/);
    expect(text).toMatch(/RETURNING candidate_key/);
    expect(allInterpolations()).toEqual(expect.arrayContaining([
      REQ,
      'candidate:ann',
      JSON.stringify({ suggestionId: 'SUG-1', potentialReviewerId: 'PID-1' }),
    ]));
  });

  test('does not graduate an excluded/ineligible collision', async () => {
    sql.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    await expect(store.finalizeCandidatePromotion(
      REQ,
      { name: 'Ann Lee' },
      {
        candidateKey: 'candidate:ann',
        suggestionId: 'SUG-1',
        potentialReviewerId: 'PID-1',
      },
    )).resolves.toEqual({ saved: false, candidateKey: 'candidate:ann' });
  });

  test('uses the server-read roster version as a CAS instead of recreating a changed row', async () => {
    sql.mockResolvedValueOnce({ rows: [{ candidate_key: 'candidate:ann' }], rowCount: 1 });

    await expect(store.finalizeCandidatePromotion(
      REQ,
      { name: 'Ann Lee' },
      {
        candidateKey: 'candidate:ann',
        suggestionId: 'SUG-1',
        potentialReviewerId: 'PID-1',
        expectedUpdatedAt: '2026-08-02 00:00:00+00',
      },
    )).resolves.toEqual({ saved: true, candidateKey: 'candidate:ann' });

    expect(queryTextOf(0)).toMatch(/UPDATE reviewer_find_roster/);
    expect(queryTextOf(0)).toMatch(/updated_at::text/);
    expect(queryTextOf(0)).not.toMatch(/INSERT INTO reviewer_find_roster/);
    expect(allInterpolations()).toContain('2026-08-02 00:00:00+00');
  });

  test('checks the exact active roster snapshot before external promotion work', async () => {
    sql.mockResolvedValueOnce({ rows: [{ '?column?': 1 }], rowCount: 1 });
    await expect(store.promotionSnapshotIsCurrent(
      REQ,
      'candidate:ann',
      '2026-08-02 00:00:00+00',
    )).resolves.toBe(true);
    expect(queryTextOf(0)).toMatch(/status = 'active'/);
    expect(queryTextOf(0)).toMatch(/updated_at::text/);

    await expect(store.promotionSnapshotIsCurrent(REQ, 'candidate:ann', '')).resolves.toBe(false);
    expect(sql).toHaveBeenCalledTimes(1);
  });

  test('also retires active roster aliases with the same checksum-valid ORCID', async () => {
    sql
      .mockResolvedValueOnce({ rows: [{ candidate_key: 'candidate:ellen-legacy' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ candidate_key: 'orcid:0000-0001-6345-1907' }], rowCount: 1 });

    const result = await store.finalizeCandidatePromotion(
      REQ,
      {
        name: 'Ellen Zhong',
        candidateKey: 'candidate:ellen-legacy',
        email: 'zhonge@cs.princeton.edu',
        orcid: '0000-0001-6345-1907',
      },
      {
        candidateKey: 'candidate:ellen-legacy',
        suggestionId: 'SUG-ELLEN',
        potentialReviewerId: 'PID-ELLEN',
      },
    );

    expect(result).toEqual({ saved: true, candidateKey: 'candidate:ellen-legacy' });
    expect(sql).toHaveBeenCalledTimes(2);
    expect(queryTextOf(1)).toMatch(/status = 'saved'/);
    expect(queryTextOf(1)).toMatch(/candidate->>'orcid'/);
    expect(queryTextOf(1)).toMatch(/candidate->'contactEnrichment'->>'orcidId'/);
    expect(allInterpolations()).toEqual(expect.arrayContaining([
      '0000-0001-6345-1907',
      'candidate:ellen-legacy',
    ]));
  });

  test('does not reverse a committed promotion when best-effort ORCID alias cleanup fails', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    sql
      .mockResolvedValueOnce({ rows: [{ candidate_key: 'candidate:ellen-legacy' }], rowCount: 1 })
      .mockRejectedValueOnce(new Error('alias cleanup unavailable'));

    await expect(store.finalizeCandidatePromotion(
      REQ,
      { name: 'Ellen Zhong', orcid: '0000-0001-6345-1907' },
      {
        candidateKey: 'candidate:ellen-legacy',
        suggestionId: 'SUG-ELLEN',
        potentialReviewerId: 'PID-ELLEN',
      },
    )).resolves.toEqual({ saved: true, candidateKey: 'candidate:ellen-legacy' });
    expect(consoleError).toHaveBeenCalledWith(
      'reviewer-roster finalizeCandidatePromotion alias cleanup error:',
      'alias cleanup unavailable',
    );
    consoleError.mockRestore();
  });
});

describe('markPromotionBlocked', () => {
  test('moves only the exact active/blocked key into terminal blocked state with a durable reason', async () => {
    sql.mockResolvedValueOnce({ rows: [{ candidate_key: 'candidate:ann' }], rowCount: 1 });

    await expect(store.markPromotionBlocked(REQ, 'candidate:ann', {
      decision: 'blocked_applicant_excluded',
      code: 'applicant_excluded',
      reason: 'Applicant excluded this reviewer.',
    })).resolves.toEqual({ blocked: true, candidateKey: 'candidate:ann' });

    const text = queryTextOf(0);
    expect(text).toMatch(/SET status = 'blocked'/);
    expect(text).toMatch(/status IN \('active', 'blocked'\)/);
    expect(allInterpolations()).toContain('candidate:ann');
    expect(allInterpolations()).toContain(JSON.stringify({
      promotionDecision: 'blocked_applicant_excluded',
      promotionBlockCode: 'applicant_excluded',
      promotionBlockReason: 'Applicant excluded this reviewer.',
    }));
  });
});

describe('stampSuggestionAnchor', () => {
  test('updates the candidate JSON by request + exact candidate key with suggestion/person ids', async () => {
    sql.mockResolvedValueOnce({ rows: [{ id: 123 }], rowCount: 1 });
    const out = await store.stampSuggestionAnchor(REQ, 'Prof. Anchor Name', {
      candidateKey: 'candidate:anchor',
      suggestionId: 'SUG-1',
      potentialReviewerId: 'PID-1',
    });

    expect(out).toEqual({ updated: 1 });
    const text = queryTextOf(0);
    expect(text).toMatch(/UPDATE reviewer_find_roster/);
    expect(text).toMatch(/candidate = candidate \|\|/);
    expect(text).toMatch(/request_id =/);
    expect(text).toMatch(/candidate_key =/);
    expect(allInterpolations()).toEqual(expect.arrayContaining([
      REQ,
      'candidate:anchor',
      JSON.stringify({ suggestionId: 'SUG-1', potentialReviewerId: 'PID-1' }),
    ]));
  });

  test('missing suggestionId or normalized name is a no-op', async () => {
    await expect(store.stampSuggestionAnchor(REQ, 'No Id', {})).resolves.toEqual({ updated: 0 });
    await expect(store.stampSuggestionAnchor(REQ, 'No Key', { suggestionId: 'SUG-1' })).resolves.toEqual({ updated: 0 });
    expect(sql).not.toHaveBeenCalled();
  });
});
