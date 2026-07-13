/**
 * @jest-environment node
 *
 * Pins the safety logic of the manual reviewer-binding production smoke
 * (scripts/smoke-reviewer-binding.js) without any live writes: the frozen
 * job payload (repeat + opted-out + no board identity), whole-second event
 * timestamps, the clean-init precondition, the Wave 13 assertion set (a
 * legacy-fallback run must FAIL), the acceptance-email negative assertion,
 * and the no-cleanup-while-active rule.
 */
import { readFileSync } from 'fs';
import {
  assertApprovedRequest,
  assertCleanInitRow,
  assertDrainAttribution,
  assertJobOutcome,
  assertWave13Binding,
  buildSmokeJobArgs,
  buildSmokeKey,
  canAutoCleanupRecovery,
  canCleanup,
  evaluateCleanup,
  findMatchingDrainAttributionRun,
  isJobTerminal,
  isWholeSecondIso,
  parsePopulationCounts,
  secondEqual,
  wholeSecondIso,
} from '../../scripts/lib/smoke-reviewer-binding-core.js';
import { APPROVED_FIXTURE_REQUEST_IDS } from '../../scripts/lib/smoke-reviewer-binding-fixtures.js';

const ORCID = '0000-0002-1825-0097';
const ACCEPTED_AT = '2026-07-14T10:00:00.000Z';
const APPROVED_REQUEST_ID = '54e2b88b-04b9-f011-bbd3-6045bd02b4cc';
const SUGGESTION = { wmkf_appreviewersuggestionid: '11111111-1111-4111-8111-111111111111', wmkf_accepted: true };
const REVIEWER = { wmkf_potentialreviewersid: '33333333-3333-4333-8333-333333333333' };
const RUNNER_SOURCE = readFileSync('scripts/smoke-reviewer-binding.js', 'utf8');

function unboundPersonRow(overrides = {}) {
  return {
    _etag: 'W/"1"',
    wmkf_identitybindingversion: null,
    wmkf_identitybindingsource: null,
    wmkf_identitybindinganchor: null,
    wmkf_identityboundat: null,
    wmkf_identityderivedbindingversion: null,
    wmkf_identityfieldlineagejson: null,
    wmkf_googlescholarid: null,
    wmkf_googlescholarurl: null,
    wmkf_hindex: null,
    wmkf_i10index: null,
    wmkf_totalcitations: null,
    wmkf_orcid: null,
    wmkf_orcidurl: null,
    ...overrides,
  };
}

// The person row exactly as Dataverse returns it after a successful durable
// init: second-precision timestamps (no fractional part on round-trip).
function boundPersonRow(overrides = {}) {
  return {
    ...unboundPersonRow(),
    wmkf_identitybindingversion: 1,
    wmkf_identitybindingsource: 'self_reported',
    wmkf_identitybindinganchor: `orcid:${ORCID}`,
    wmkf_identityboundat: '2026-07-14T10:00:00Z',
    wmkf_identityderivedbindingversion: null,
    wmkf_identityfieldlineagejson: JSON.stringify({
      schemaVersion: 1,
      fields: {
        wmkf_orcid: { source: 'self_reported', bindingVersion: 1 },
        wmkf_orcidurl: { source: 'self_reported', bindingVersion: 1 },
      },
    }),
    wmkf_orcid: ORCID,
    wmkf_orcidurl: `https://orcid.org/${ORCID}`,
    wmkf_identitystatus: 'confirmed',
    wmkf_identityconfidenceband: 'high',
    wmkf_identityresolverversion: 'self-report@accept',
    wmkf_identityresolvedat: '2026-07-14T10:00:00Z',
    wmkf_identityevidencesummary: 'Reviewer self-confirmed this ORCID on the authenticated invitation form (magic-link).',
    wmkf_identityverifiedanchorsjson: JSON.stringify([{
      type: 'self_reported_orcid',
      canonicalKey: `orcid:${ORCID}`,
      sourceUrl: `https://orcid.org/${ORCID}`,
      verifier: 'reviewerSelfReport@self-report@accept',
    }]),
    ...overrides,
  };
}

describe('whole-second event timestamps', () => {
  test('wholeSecondIso floors milliseconds to .000Z', () => {
    expect(wholeSecondIso(new Date('2026-07-14T10:00:00.347Z'))).toBe(ACCEPTED_AT);
    expect(wholeSecondIso(new Date('2026-07-14T10:00:00.999Z'))).toBe(ACCEPTED_AT);
  });

  test('isWholeSecondIso accepts .000Z and bare-second forms, rejects fractional', () => {
    expect(isWholeSecondIso(ACCEPTED_AT)).toBe(true);
    expect(isWholeSecondIso('2026-07-14T10:00:00Z')).toBe(true);
    expect(isWholeSecondIso('2026-07-14T10:00:00.347Z')).toBe(false);
    expect(isWholeSecondIso('not-a-date')).toBe(false);
  });

  test('secondEqual compares at Dataverse storage fidelity', () => {
    expect(secondEqual('2026-07-14T10:00:00Z', ACCEPTED_AT)).toBe(true);
    expect(secondEqual('2026-07-14T10:00:01Z', ACCEPTED_AT)).toBe(false);
    expect(secondEqual(null, ACCEPTED_AT)).toBe(false);
  });
});

describe('buildSmokeJobArgs', () => {
  const args = () => buildSmokeJobArgs({
    acceptanceKey: 'smoke-key',
    acceptedAt: ACCEPTED_AT,
    suggestion: SUGGESTION,
    request: { akoya_requestid: 'r-1' },
    reviewer: REVIEWER,
    orcid: ORCID,
  });

  test('freezes the side-effect-excluding payload shape', () => {
    const built = args();
    expect(built).toMatchObject({
      isAcceptRepeat: true,
      optedOut: true,
      status: 'queued',
      acceptOrcidRaw: ORCID,
      acks: null,
      body: { honorariumOptOut: true },
    });
    // The board-identity capture must see NO key at all → nothing_to_write.
    expect(built.body).not.toHaveProperty('boardIdentity');
    expect(built.body).not.toHaveProperty('address');
    expect(built.body).not.toHaveProperty('contactEdits');
  });

  test('rejects a millisecond-bearing acceptedAt (replay identity would not round-trip)', () => {
    expect(() => buildSmokeJobArgs({
      acceptanceKey: 'k',
      acceptedAt: '2026-07-14T10:00:00.347Z',
      suggestion: SUGGESTION,
      reviewer: REVIEWER,
      orcid: ORCID,
    })).toThrow(/whole-second/);
  });

  test.each([
    ['acceptanceKey', { acceptanceKey: null }],
    ['suggestion id', { suggestion: {} }],
    ['reviewer id', { reviewer: {} }],
    ['orcid', { orcid: '' }],
  ])('rejects a missing %s', (_label, override) => {
    expect(() => buildSmokeJobArgs({
      acceptanceKey: 'k',
      acceptedAt: ACCEPTED_AT,
      suggestion: SUGGESTION,
      reviewer: REVIEWER,
      orcid: ORCID,
      ...override,
    })).toThrow();
  });
});

describe('assertCleanInitRow', () => {
  test('passes a fully unbound clean row', () => {
    expect(assertCleanInitRow(unboundPersonRow())).toEqual({ ok: true, problems: [] });
  });

  test('fails when a binding field is populated', () => {
    const out = assertCleanInitRow(unboundPersonRow({ wmkf_identitybindingversion: 1 }));
    expect(out.ok).toBe(false);
    expect(out.problems.join(' ')).toContain('wmkf_identitybindingversion');
  });

  test('fails when a legacy identity value would trigger the typed fallback', () => {
    const out = assertCleanInitRow(unboundPersonRow({ wmkf_hindex: 12 }));
    expect(out.ok).toBe(false);
    expect(out.problems.join(' ')).toContain('legacy_classification_required');
  });

  test('fails when lineage JSON exists without a binding', () => {
    const out = assertCleanInitRow(unboundPersonRow({ wmkf_identityfieldlineagejson: '{}' }));
    expect(out.ok).toBe(false);
  });
});

describe('assertWave13Binding', () => {
  test('passes the exact persisted first self_reported binding', () => {
    expect(assertWave13Binding(boundPersonRow(), { orcid: ORCID, acceptedAt: ACCEPTED_AT }))
      .toEqual({ ok: true, problems: [] });
  });

  test('FAILS a legacy-fallback row (legacy ORCID written, no binding) — the false-confidence mode', () => {
    const legacyOnly = unboundPersonRow({
      wmkf_orcid: ORCID,
      wmkf_orcidurl: `https://orcid.org/${ORCID}`,
      wmkf_identitystatus: 'confirmed',
    });
    const out = assertWave13Binding(legacyOnly, { orcid: ORCID, acceptedAt: ACCEPTED_AT });
    expect(out.ok).toBe(false);
    expect(out.problems.join(' ')).toContain('transitional fallback');
  });

  test('fails a version bump (retry did not replay as a no-op)', () => {
    const out = assertWave13Binding(boundPersonRow({ wmkf_identitybindingversion: 2 }), { orcid: ORCID, acceptedAt: ACCEPTED_AT });
    expect(out.ok).toBe(false);
    expect(out.problems.join(' ')).toContain('expected 1');
  });

  test.each([
    ['wrong source', { wmkf_identitybindingsource: 'automated' }],
    ['wrong anchor', { wmkf_identitybindinganchor: 'orcid:0000-0001-5109-3700' }],
    ['boundAt off by a second', { wmkf_identityboundat: '2026-07-14T10:00:01Z' }],
    ['derived version set', { wmkf_identityderivedbindingversion: 1 }],
    ['lineage drift', { wmkf_identityfieldlineagejson: JSON.stringify({ schemaVersion: 1, fields: { wmkf_orcid: { source: 'automated', bindingVersion: 1 }, wmkf_orcidurl: { source: 'automated', bindingVersion: 1 } } }) }],
    ['non-confirmed decision', { wmkf_identitystatus: 'probable' }],
    ['wrong resolver version', { wmkf_identityresolverversion: 'resolver@1' }],
    ['missing evidence summary', { wmkf_identityevidencesummary: null }],
    ['drifted evidence summary', { wmkf_identityevidencesummary: 'confirmed — resolver evidence' }],
    ['missing anchors JSON', { wmkf_identityverifiedanchorsjson: null }],
    ['anchors for a different ORCID', { wmkf_identityverifiedanchorsjson: JSON.stringify([{ type: 'self_reported_orcid', canonicalKey: 'orcid:0000-0001-5109-3700', sourceUrl: 'https://orcid.org/0000-0001-5109-3700', verifier: 'reviewerSelfReport@self-report@accept' }]) }],
  ])('fails on %s', (_label, override) => {
    expect(assertWave13Binding(boundPersonRow(override), { orcid: ORCID, acceptedAt: ACCEPTED_AT }).ok).toBe(false);
  });

  test.each([
    ['wmkf_googlescholarid', 'abc123'],
    ['wmkf_googlescholarurl', 'https://scholar.google.com/citations?user=abc123'],
    ['wmkf_hindex', 12],
    ['wmkf_i10index', 3],
    ['wmkf_totalcitations', 400],
  ])('fails when untouched identity field %s was written', (field, value) => {
    const out = assertWave13Binding(boundPersonRow({ [field]: value }), { orcid: ORCID, acceptedAt: ACCEPTED_AT });
    expect(out.ok).toBe(false);
    expect(out.problems.join(' ')).toContain(field);
  });
});

describe('assertApprovedRequest — double-entry fixture authorization', () => {
  test('tracks only the owner-approved request 1002379 GUID', () => {
    expect(APPROVED_FIXTURE_REQUEST_IDS).toEqual([APPROVED_REQUEST_ID]);
  });

  const APPROVED = '22222222-2222-4222-8222-222222222222';
  const ALLOWLIST = [APPROVED];

  test('passes when the resolved GUID equals the approval and is committed in the allowlist', () => {
    expect(assertApprovedRequest(APPROVED.toUpperCase(), APPROVED, ALLOWLIST)).toEqual({ ok: true, problems: [] });
  });

  test('fails when the resolved request differs from the approval', () => {
    const out = assertApprovedRequest('99999999-9999-4999-8999-999999999999', APPROVED, ALLOWLIST);
    expect(out.ok).toBe(false);
    expect(out.problems.join(' ')).toContain('unapproved request');
  });

  test('fails when the same GUID is supplied twice but not committed in the allowlist', () => {
    const out = assertApprovedRequest(APPROVED, APPROVED, []);
    expect(out.ok).toBe(false);
    expect(out.problems.join(' ')).toContain('commit the approved fixture GUID');
  });

  test('fails when the resolved request is not in the committed allowlist', () => {
    const out = assertApprovedRequest(APPROVED, APPROVED, ['99999999-9999-4999-8999-999999999999']);
    expect(out.ok).toBe(false);
    expect(out.problems.join(' ')).toContain('not in the committed');
  });

  test.each([
    ['missing', undefined],
    ['not a GUID', 'REQ-123'],
    ['empty', ''],
  ])('fails when the approval id is %s', (_label, approved) => {
    expect(assertApprovedRequest(APPROVED, approved, ALLOWLIST).ok).toBe(false);
  });
});

describe('assertDrainAttribution — blocking deployed-cron attribution', () => {
  const jobId = 77;
  const matchingRun = {
    id: 101,
    details: {
      jobIds: [77],
      completedJobIds: [77],
      deployment: { gitCommitSha: '38640dd7abcdef', deploymentId: 'dpl_good' },
    },
  };

  test('passes when one run records the exact job id and matching git SHA prefix', () => {
    const runs = [matchingRun];
    const matchedRun = findMatchingDrainAttributionRun(runs, { jobId, expectDeployment: '38640dd7' });
    expect(assertDrainAttribution({ matchedRun, totalRuns: runs.length, jobId, expectDeployment: '38640dd7' }))
      .toEqual({ ok: true, problems: [] });
  });

  test('passes when one run records the exact job id and matching deployment id', () => {
    const runs = [matchingRun];
    const matchedRun = findMatchingDrainAttributionRun(runs, { jobId, expectDeployment: 'dpl_good' });
    expect(assertDrainAttribution({ matchedRun, totalRuns: runs.length, jobId, expectDeployment: 'dpl_good' }).ok).toBe(true);
  });

  test('fails with zero maintenance runs in the window', () => {
    const out = assertDrainAttribution({ matchedRun: null, totalRuns: 0, jobId, expectDeployment: '38640dd7' });
    expect(out.ok).toBe(false);
    expect(out.problems.join(' ')).toContain('cannot be attributed');
  });

  test('fails when a run has the job id but wrong deployment fingerprint', () => {
    const runs = [{
      id: 102,
      details: { completedJobIds: [jobId], deployment: { gitCommitSha: 'aaaaaaaaaaaaaaaa', deploymentId: 'dpl_wrong' } },
    }];
    const matchedRun = findMatchingDrainAttributionRun(runs, { jobId, expectDeployment: '38640dd7' });
    const out = assertDrainAttribution({ matchedRun, totalRuns: runs.length, jobId, expectDeployment: '38640dd7' });
    expect(out.ok).toBe(false);
    expect(out.problems.join(' ')).toContain('completedJobIds');
  });

  test('fails when a run has the job id but no deployment fingerprint', () => {
    const runs = [{ id: 103, details: { completedJobIds: [jobId] } }];
    const matchedRun = findMatchingDrainAttributionRun(runs, { jobId, expectDeployment: '38640dd7' });
    expect(assertDrainAttribution({ matchedRun, totalRuns: runs.length, jobId, expectDeployment: '38640dd7' }).ok).toBe(false);
  });

  test('fails when a run has the matching fingerprint but not the smoke job id', () => {
    const runs = [{
      id: 104,
      details: { completedJobIds: [999], deployment: { gitCommitSha: '38640dd7abcdef', deploymentId: 'dpl_good' } },
    }];
    const matchedRun = findMatchingDrainAttributionRun(runs, { jobId, expectDeployment: '38640dd7' });
    expect(assertDrainAttribution({ matchedRun, totalRuns: runs.length, jobId, expectDeployment: '38640dd7' }).ok).toBe(false);
  });

  test('fails without an attested deployment', () => {
    expect(assertDrainAttribution({ matchedRun: matchingRun, totalRuns: 1, jobId, expectDeployment: '' }).ok).toBe(false);
  });

  test('fails when the expected deployment claimed and retried the job without completing it', () => {
    const runs = [{
      id: 105,
      details: {
        jobIds: [jobId],
        completed: 0,
        completedJobIds: [],
        retried: 1,
        retriedJobIds: [jobId],
        deployment: { gitCommitSha: '38640dd7abcdef', deploymentId: 'dpl_good' },
      },
    }];
    const matchedRun = findMatchingDrainAttributionRun(runs, { jobId, expectDeployment: '38640dd7' });
    const out = assertDrainAttribution({ matchedRun, totalRuns: runs.length, jobId, expectDeployment: '38640dd7' });

    expect(matchedRun).toBeNull();
    expect(out.ok).toBe(false);
    expect(out.problems.join(' ')).toContain('claim/retry/failure is not proof');
  });
});

describe('assertJobOutcome', () => {
  test('passes a completed job with no acceptance-confirmation step', () => {
    expect(assertJobOutcome({ status: 'completed', steps: {} })).toEqual({ ok: true, problems: [] });
  });

  test('fails when the email step engaged — negative assertion backed by the dangerous input', () => {
    const out = assertJobOutcome({
      status: 'completed',
      steps: { acceptance_confirmation: { claimedAt: '2026-07-14T10:02:00.000Z' } },
    });
    expect(out.ok).toBe(false);
    expect(out.problems.join(' ')).toContain('acceptance_confirmation');
  });

  test('fails a failed job and surfaces last_error', () => {
    const out = assertJobOutcome({ status: 'failed', last_error: 'boom', steps: {} });
    expect(out.ok).toBe(false);
    expect(out.problems.join(' ')).toContain('boom');
  });

  test('parses string-typed steps columns', () => {
    const out = assertJobOutcome({ status: 'completed', steps: JSON.stringify({ acceptance_confirmation: { sentAt: 'x' } }) });
    expect(out.ok).toBe(false);
  });
});

describe('cleanup guard', () => {
  test.each([
    ['accept_pending', false],
    ['queued', false],
    ['completed', true],
    ['failed', false],
    ['cancelled', false],
  ])('status %s → canCleanup %s', (status, expected) => {
    expect(canCleanup({ status })).toBe(expected);
  });

  test.each(['completed', 'failed', 'cancelled'])('polling recognizes terminal status %s', (status) => {
    expect(isJobTerminal({ status })).toBe(true);
  });

  test('no job → no cleanup', () => {
    expect(canCleanup(null)).toBe(false);
  });

  test('unexpected-failure auto-cleanup is opt-in and allowed before any job is staged', () => {
    expect(canAutoCleanupRecovery({ cleanupRequested: true, jobId: null, job: null })).toBe(true);
    expect(canAutoCleanupRecovery({ cleanupRequested: false, jobId: null, job: null })).toBe(false);
  });

  test('an uncertain job-staging write blocks recovery cleanup', () => {
    expect(canAutoCleanupRecovery({
      cleanupRequested: true,
      jobId: null,
      job: null,
      pendingWrite: 'job_staging',
    })).toBe(false);
  });

  test('a staged job permits recovery cleanup only after immutable completion', () => {
    expect(canAutoCleanupRecovery({
      cleanupRequested: true,
      jobId: 77,
      job: { status: 'queued' },
    })).toBe(false);
    expect(canAutoCleanupRecovery({
      cleanupRequested: true,
      jobId: 77,
      job: { status: 'failed' },
    })).toBe(false);
    expect(canAutoCleanupRecovery({
      cleanupRequested: true,
      jobId: 77,
      job: { status: 'cancelled' },
    })).toBe(false);
    expect(canAutoCleanupRecovery({
      cleanupRequested: true,
      jobId: 77,
      job: { status: 'completed' },
    })).toBe(true);
  });

  test('signal handling never auto-cleans while a production write may still be resolving', () => {
    expect(canAutoCleanupRecovery({
      cleanupRequested: true,
      jobId: null,
      job: null,
      signal: 'SIGTERM',
    })).toBe(false);
  });

  test('a cleanup failure never recursively starts a second cleanup pass', () => {
    expect(canAutoCleanupRecovery({
      cleanupRequested: true,
      jobId: 77,
      job: { status: 'completed' },
      cleanupInProgress: true,
    })).toBe(false);
  });

  test('allows job deletion only after deletes, GUID absence, and restored population', () => {
    expect(evaluateCleanup({
      suggestionOutcome: { deleted: true },
      personOutcome: { deleted: true },
      suggestionStillReadable: false,
      personStillReadable: false,
      populationRestored: true,
    })).toEqual({ ok: true, allowJobDeletion: true, problems: [] });
  });

  test('fails and keeps the job when suggestion delete falls back to deactivation', () => {
    const out = evaluateCleanup({
      suggestionOutcome: { deleted: false, deactivated: true },
      personOutcome: { deleted: true },
      suggestionStillReadable: true,
      personStillReadable: false,
      populationRestored: false,
    });
    expect(out.ok).toBe(false);
    expect(out.allowJobDeletion).toBe(false);
    expect(out.problems.join(' ')).toContain('deactivated');
  });

  test('fails and keeps the job when person deletion fails', () => {
    const out = evaluateCleanup({
      suggestionOutcome: { deleted: true },
      personOutcome: { deleted: false, error: 'blocked by dependency' },
      suggestionStillReadable: false,
      personStillReadable: true,
      populationRestored: false,
    });
    expect(out.ok).toBe(false);
    expect(out.allowJobDeletion).toBe(false);
    expect(out.problems.join(' ')).toContain('person delete failed');
  });

  test('fails and keeps the job when GUID absence checks fail despite delete outcomes', () => {
    const out = evaluateCleanup({
      suggestionOutcome: { deleted: true },
      personOutcome: { deleted: true },
      suggestionStillReadable: false,
      personStillReadable: true,
      populationRestored: true,
    });
    expect(out.ok).toBe(false);
    expect(out.allowJobDeletion).toBe(false);
    expect(out.problems.join(' ')).toContain('person GUID');
  });

  test('fails and keeps the job when population is not restored', () => {
    const out = evaluateCleanup({
      suggestionOutcome: { deleted: true },
      personOutcome: { deleted: true },
      suggestionStillReadable: false,
      personStillReadable: false,
      populationRestored: false,
    });
    expect(out.ok).toBe(false);
    expect(out.allowJobDeletion).toBe(false);
    expect(out.problems.join(' ')).toContain('population baseline');
  });
});

describe('parsePopulationCounts', () => {
  test('parses the preflight population snapshot lines', () => {
    const stdout = [
      'Wave 13 population snapshot (target=prod):',
      '  wmkf_potentialreviewers: 0 row(s) with any Wave 13 field non-null.',
      '  wmkf_appreviewersuggestion: 2 row(s) with any Wave 13 field non-null.',
    ].join('\n');
    expect(parsePopulationCounts(stdout)).toEqual({
      wmkf_potentialreviewers: 0,
      wmkf_appreviewersuggestion: 2,
    });
  });

  test('returns null when the snapshot section is absent', () => {
    expect(parsePopulationCounts('Summary: 0 absent, 10 exact, 0 divergent.')).toBeNull();
  });
});

describe('buildSmokeKey', () => {
  test('is unique per second and carries the source tag', () => {
    const key = buildSmokeKey(new Date('2026-07-14T10:00:00.000Z'));
    expect(key).toBe('smoke-reviewer-binding-20260714100000');
  });
});

describe('incremental recovery artifact wiring', () => {
  test.each([
    ['person_create', 'potentialReviewer.upsertByEmail'],
    ['suggestion_create', 'suggestionAdapter.upsert'],
    ['accepted_state', "DynamicsService.updateRecord('wmkf_appreviewersuggestions'"],
    ['job_staging', 'enqueueReviewerAcceptanceJob'],
  ])('persists before and immediately after the %s production boundary', (boundary, writeCall) => {
    const before = RUNNER_SOURCE.indexOf(`beginProductionWrite('${boundary}')`);
    const write = RUNNER_SOURCE.indexOf(writeCall, before);
    const after = RUNNER_SOURCE.indexOf(`finishProductionWrite('${boundary}'`, write);
    expect(before).toBeGreaterThan(-1);
    expect(write).toBeGreaterThan(before);
    expect(after).toBeGreaterThan(write);
  });

  test('the recorder writes JSON synchronously and outer handling covers errors, SIGINT, and SIGTERM', () => {
    expect(RUNNER_SOURCE).toContain('writeFileSync(artifactPath, JSON.stringify(artifact, null, 2))');
    expect(RUNNER_SOURCE).toContain("for (const signal of ['SIGINT', 'SIGTERM'])");
    expect(RUNNER_SOURCE).toContain('await requestFatal(error)');
    expect(RUNNER_SOURCE).toContain('observedJobStatus');
  });

  test('signal state is persisted before the recovery job read and main exit awaits fatal shutdown', () => {
    const handler = RUNNER_SOURCE.indexOf('async function handleFatal');
    const firstPersist = RUNNER_SOURCE.indexOf('persistArtifact({ finished: true })', handler);
    const recoveryRead = RUNNER_SOURCE.indexOf('await readRecoveryJob()', handler);
    const fatalAwait = RUNNER_SOURCE.indexOf('if (fatalPromise) await fatalPromise;');
    const successExit = RUNNER_SOURCE.indexOf('process.exit(failed ? 1 : 0)');
    expect(firstPersist).toBeGreaterThan(handler);
    expect(firstPersist).toBeLessThan(recoveryRead);
    expect(fatalAwait).toBeGreaterThan(recoveryRead);
    expect(fatalAwait).toBeLessThan(successExit);
  });

  test('a fatal request blocks every new main-flow production boundary', () => {
    const begin = RUNNER_SOURCE.indexOf('function beginProductionWrite');
    const guard = RUNNER_SOURCE.indexOf('if (!allowDuringFatal) assertMainFlowActive();', begin);
    const pendingWrite = RUNNER_SOURCE.indexOf('artifact.pendingWrite = name;', begin);
    expect(guard).toBeGreaterThan(begin);
    expect(guard).toBeLessThan(pendingWrite);
  });

  test('a signal during delete fences the fallback deactivation write', () => {
    const helper = RUNNER_SOURCE.indexOf('async function deleteOrReport');
    const deleteWrite = RUNNER_SOURCE.indexOf('await DynamicsService.deleteRecord', helper);
    const fallbackGuard = RUNNER_SOURCE.indexOf('if (!allowDuringFatal) assertMainFlowActive();', deleteWrite);
    const deactivateWrite = RUNNER_SOURCE.indexOf('await DynamicsService.updateRecord', deleteWrite);
    expect(fallbackGuard).toBeGreaterThan(deleteWrite);
    expect(fallbackGuard).toBeLessThan(deactivateWrite);
  });
});
