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
  summarizeLedger,
  parseVercelObservationEvents,
} = require('../../scripts/lib/reviewer-find-live-contract');

const OBSERVATION_ID = 'rfw_0123456789abcdef0123456789abcdef';
const COMMIT = '1234567890abcdef1234567890abcdef12345678';
const ROSTER_VERSION = 'a'.repeat(64);

describe('Reviewer Find live runner contract', () => {
  test('is fixed to the dedicated no-send request', () => {
    expect(SMOKE_REQUEST_NUMBER).toBe('1002788');
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

  test('requires exact Vercel host, commit, readiness, and deployment class', () => {
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
    expect(mismatch.reasons).toContain('deployment_host_mismatch');
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

  test('does not accept incomplete or effectful observation events as a warm pass', () => {
    const clean = summarizeLedger([
      { event: 'effect', observationId: OBSERVATION_ID, effectClass: 'postgres_read', mode: 'cached' },
      { event: 'complete', observationId: OBSERVATION_ID, mode: 'cached', complete: true },
      { event: 'effect', observationId: OBSERVATION_ID, effectClass: 'dataverse_read', mode: 'reconciled' },
      { event: 'complete', observationId: OBSERVATION_ID, mode: 'reconciled', complete: true },
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
  });

  test('extracts only exact bounded observation events from Vercel JSON log lines', () => {
    const output = [
      JSON.stringify({ message: JSON.stringify({ kind: 'reviewer_find_warm_observation', observationId: OBSERVATION_ID, event: 'effect', mode: 'cached', effectClass: 'postgres_read', reasonCode: 'completed', requestId: 'must_not_return' }) }),
      JSON.stringify({ message: JSON.stringify({ kind: 'reviewer_find_warm_observation', observationId: OBSERVATION_ID, event: 'complete', mode: 'cached', complete: true, incomplete: false, reasonCode: 'warm_get_completed' }) }),
      JSON.stringify({ message: JSON.stringify({ kind: 'reviewer_find_warm_observation', observationId: OBSERVATION_ID, event: 'complete', mode: 'reconciled', complete: true, incomplete: false, reasonCode: 'warm_get_completed' }) }),
      JSON.stringify({ message: 'another app log with person@example.org' }),
    ].join('\n');
    expect(parseVercelObservationEvents(output, OBSERVATION_ID)).toEqual([
      { observationId: OBSERVATION_ID, event: 'effect', effectClass: 'postgres_read', mode: 'cached', complete: false, incomplete: false, reasonCode: 'completed' },
      { observationId: OBSERVATION_ID, event: 'complete', effectClass: null, mode: 'cached', complete: true, incomplete: false, reasonCode: 'warm_get_completed' },
      { observationId: OBSERVATION_ID, event: 'complete', effectClass: null, mode: 'reconciled', complete: true, incomplete: false, reasonCode: 'warm_get_completed' },
    ]);
    expect(parseVercelObservationEvents('not-json', OBSERVATION_ID)).toEqual([]);
    expect(parseVercelObservationEvents(`${output}\n{\"message\":`, OBSERVATION_ID)).toEqual([]);
  });
});
