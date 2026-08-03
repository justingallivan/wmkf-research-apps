/** @jest-environment node */

const {
  COLD_REQUEST_NUMBER,
  validateColdBrowserRequest,
  validateLifecycleUnchanged,
  validateColdCompletion,
  validateColdExecutionConfig,
} = require('../../scripts/lib/reviewer-find-cold-live-contract');

const BASE_URL = 'https://reviewer-find-preview.example.org';
const REQUEST_ID = '11111111-1111-1111-1111-111111111111';

function check(method, pathname, body) {
  return validateColdBrowserRequest({
    method,
    url: `${BASE_URL}${pathname}`,
    baseUrl: BASE_URL,
    requestId: REQUEST_ID,
    postData: body === undefined ? null : JSON.stringify(body),
  });
}

describe('Reviewer Find cold live safety contract', () => {
  test('is fixed to the owner-designated no-send request', () => {
    expect(COLD_REQUEST_NUMBER).toBe('1002914');
  });

  test('allows constrained same-origin reads and only the five explicit cold producers', () => {
    expect(check('GET', '/workbench')).toMatchObject({ allowed: true, kind: 'static_read' });
    expect(check('GET', '/api/auth/session')).toMatchObject({ allowed: true, kind: 'read' });
    expect(check('GET', `/api/workbench/resolve-request?requestNumber=${COLD_REQUEST_NUMBER}`)).toMatchObject({ allowed: true });
    expect(check('GET', `/api/workbench/resolve-request?requestId=${REQUEST_ID}`)).toMatchObject({ allowed: true });
    expect(check('GET', `/api/workbench/reviewer-roster?requestId=${REQUEST_ID}&mode=cached`)).toMatchObject({ allowed: true });
    expect(check('GET', `/api/workbench/reviewer-roster?requestId=${REQUEST_ID}&mode=reconciled&rosterVersion=${'a'.repeat(64)}`)).toMatchObject({ allowed: true });
    expect(check('GET', `/api/workbench/reviewer-rollup?requestId=${REQUEST_ID}`)).toMatchObject({ allowed: true });
    expect(check('GET', `/api/workbench/applicant-reviewers?requestId=${REQUEST_ID}`)).toMatchObject({ allowed: true });
    expect(check('GET', `/api/review-manager/reviewers?proposalId=${REQUEST_ID}`)).toMatchObject({ allowed: true });
    expect(check('GET', `/api/reviewer-finder/my-candidates?requestId=${REQUEST_ID}`)).toMatchObject({ allowed: true });
    expect(check('GET', `/api/workbench/decline-referrals?requestId=${REQUEST_ID}`)).toMatchObject({ allowed: true });
    expect(check('POST', '/api/reviewer-finder/load-proposal', {
      requestId: REQUEST_ID,
    })).toMatchObject({ allowed: true, path: '/api/reviewer-finder/load-proposal' });
    expect(check('POST', '/api/workbench/enrich-recommended', {
      requestId: REQUEST_ID,
      blobUrl: 'https://blob.example.org/private.pdf?token=redacted',
      proposalKey: 'binding-key',
    }).allowed).toBe(true);
    expect(check('POST', '/api/reviewer-finder/analyze', {
      requestId: REQUEST_ID,
      blobUrl: 'https://blob.example.org/private.pdf?token=redacted',
      excludedNames: [],
      reviewerCount: 10,
    }).allowed).toBe(true);
    expect(check('POST', '/api/reviewer-finder/discover', {
      requestId: REQUEST_ID,
      analysisResult: {},
      excludedNames: [],
      referredSeeds: [],
      options: {},
    }).allowed).toBe(true);
    expect(check('POST', '/api/reviewer-finder/enrich-contacts', {
      requestId: REQUEST_ID,
      candidates: [],
      options: {},
      authorInstitution: null,
    }).allowed).toBe(true);
  });

  test.each([
    '/api/review-manager/send-emails',
    '/api/workbench/grantee-deliverables/send-invite',
    '/api/workbench/promote-applicant-reviewer',
    '/api/workbench/reviewer-roster',
    '/api/reviewer-finder/save-candidates',
    '/api/workbench/reviewer-lookup',
  ])('rejects email, invitation, promotion, and arbitrary persistence route %s', (pathname) => {
    expect(check('POST', pathname, { requestId: REQUEST_ID }).allowed).toBe(false);
  });

  test.each([
    '/api/review-manager/send-emails',
    '/api/workbench/promote-applicant-reviewer',
    '/api/unknown-read',
    `/api/workbench/reviewer-roster?requestId=${REQUEST_ID}&mode=unknown`,
    `/api/workbench/reviewer-rollup?requestId=22222222-2222-2222-2222-222222222222`,
  ])('rejects unknown, dangerous, or wrong-fixture GET %s', (pathname) => {
    expect(check('GET', pathname).allowed).toBe(false);
  });

  test('rejects wrong fixtures, manual file overrides, extra keys, off-origin, and non-POST mutations', () => {
    expect(check('POST', '/api/reviewer-finder/load-proposal', {
      requestId: '22222222-2222-2222-2222-222222222222',
    })).toMatchObject({ allowed: false, reason: 'request_id_mismatch' });
    expect(check('POST', '/api/reviewer-finder/load-proposal', {
      requestId: REQUEST_ID,
      fileKey: 'manual::override::forbidden.pdf',
    }).allowed).toBe(false);
    expect(check('POST', '/api/workbench/enrich-recommended', {
      requestId: REQUEST_ID,
      blobUrl: 'https://example.org/a.pdf',
      proposalKey: 'key',
      sendEmail: true,
    })).toMatchObject({ allowed: false, reason: 'unexpected_body_key' });
    expect(check('PATCH', '/api/workbench/reviewer-roster', { requestId: REQUEST_ID }).allowed).toBe(false);
    expect(validateColdBrowserRequest({
      method: 'GET',
      url: 'https://login.microsoftonline.com/',
      baseUrl: BASE_URL,
      requestId: REQUEST_ID,
    })).toMatchObject({ allowed: false, reason: 'off_origin' });
  });

  test('fails completion on partial success, blocked traffic, or lifecycle drift', () => {
    const lifecycle = { selected: 0, invited: 0, accepted: 0, declined: 0, reviewArtifacts: 0 };
    expect(validateColdCompletion({
      preparedProposal: true,
      applicantVerificationComplete: true,
      generalSearchComplete: true,
      rosterBefore: 0,
      rosterAfter: 5,
      lifecycleBefore: lifecycle,
      lifecycleAfter: lifecycle,
      blockedRequests: [],
    })).toMatchObject({ ok: true, failures: [] });

    expect(validateColdCompletion({
      preparedProposal: true,
      applicantVerificationComplete: false,
      generalSearchComplete: true,
      rosterBefore: 0,
      rosterAfter: 0,
      lifecycleBefore: lifecycle,
      lifecycleAfter: { ...lifecycle, invited: 1 },
      blockedRequests: [{ method: 'POST', path: '/api/review-manager/send-emails' }],
    }).failures).toEqual(expect.arrayContaining([
      'applicant_verification_incomplete',
      'authoritative_roster_count_mismatch',
      'reviewer_lifecycle_changed',
      'browser_request_blocked',
    ]));
    expect(validateLifecycleUnchanged(lifecycle, lifecycle)).toEqual({ ok: true, changed: [] });
    expect(validateLifecycleUnchanged(
      { ...lifecycle, totalSuggestions: 5, uninvitedSuggestions: 5 },
      { ...lifecycle, totalSuggestions: 6, uninvitedSuggestions: 6 },
    )).toEqual({ ok: false, changed: ['totalSuggestions', 'uninvitedSuggestions'] });
  });

  test('permits Preview only for preflight and requires explicit Production confirmation for the cold run', () => {
    expect(validateColdExecutionConfig({
      mode: 'preflight',
      deploymentClass: 'preview',
    })).toEqual({ ok: true, failures: [] });
    expect(validateColdExecutionConfig({
      mode: 'run',
      deploymentClass: 'preview',
      confirmProductionColdPrepare: true,
    }).failures).toContain('cold_run_requires_production_deployment');
    expect(validateColdExecutionConfig({
      mode: 'run',
      deploymentClass: 'production',
    }).failures).toContain('production_cold_prepare_confirmation_required');
    expect(validateColdExecutionConfig({
      mode: 'run',
      deploymentClass: 'production',
      confirmProductionColdPrepare: true,
    })).toEqual({ ok: true, failures: [] });
  });
});
