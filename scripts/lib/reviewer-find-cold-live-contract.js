/**
 * Pure safety contract for the one-time Reviewer Find cold-preparation run.
 *
 * The browser is fixed to request 1002914 and may perform only the explicit
 * proposal/search producers listed below.  Candidate promotion, invitation,
 * email, reviewer tracking, and arbitrary roster mutation are deliberately
 * absent from the allowlist.
 */

const COLD_REQUEST_NUMBER = '1002914';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const STATIC_READ_PATHS = new Set([
  '/api/auth/status',
  '/api/auth/session',
  '/api/app-access',
  '/api/user-profiles',
]);
const POST_KEYS = Object.freeze({
  '/api/reviewer-finder/load-proposal': new Set(['requestId']),
  '/api/workbench/enrich-recommended': new Set([
    'requestId', 'blobUrl', 'proposalKey', 'analysisResult',
  ]),
  '/api/reviewer-finder/analyze': new Set([
    'blobUrl', 'requestId', 'excludedNames', 'reviewerCount', 'additionalNotes',
  ]),
  '/api/reviewer-finder/discover': new Set([
    'analysisResult', 'requestId', 'excludedNames', 'referredSeeds', 'options',
  ]),
  '/api/reviewer-finder/enrich-contacts': new Set([
    'candidates', 'options', 'authorInstitution', 'requestId',
  ]),
});

const FORBIDDEN_PATH_PATTERNS = Object.freeze([
  /^\/api\/review-manager(?:\/|$)/,
  /^\/api\/workbench\/promote-applicant-reviewer$/,
  /^\/api\/workbench\/reviewer-roster$/,
  /^\/api\/workbench\/reviewer-lookup$/,
  /^\/api\/workbench\/manual-reviewer$/,
  /^\/api\/workbench\/grantee-deliverables\/send-invite$/,
  /^\/api\/reviewer-finder\/save-candidates$/,
  /^\/api\/reviewer-finder\/export$/,
  /(?:^|\/)send(?:-|_)?emails?(?:\/|$)/,
  /(?:^|\/)invite(?:s|d)?(?:\/|$)/,
  /(?:^|\/)(?:revoke|regenerate)(?:\/|$)/,
]);

function parseBody(postData) {
  if (typeof postData !== 'string' || !postData.trim()) return null;
  try {
    const parsed = JSON.parse(postData);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function hasOnlyAllowedKeys(body, allowedKeys) {
  return Object.keys(body).every((key) => allowedKeys.has(key));
}

function isForbiddenPath(pathname) {
  return FORBIDDEN_PATH_PATTERNS.some((pattern) => pattern.test(pathname));
}

function hasOnlySearchKeys(searchParams, allowedKeys) {
  return [...searchParams.keys()].every((key) => allowedKeys.has(key));
}

function exactRequestParam(parsed, key, requestId) {
  return typeof requestId === 'string'
    && parsed.searchParams.get(key) === requestId;
}

function validateApiRead(parsed, requestId) {
  if (STATIC_READ_PATHS.has(parsed.pathname)) {
    return parsed.search === ''
      ? { allowed: true, kind: 'read' }
      : { allowed: false, reason: 'unexpected_read_query' };
  }
  if (parsed.pathname === '/api/user-preferences') {
    return hasOnlySearchKeys(parsed.searchParams, new Set(['key']))
      ? { allowed: true, kind: 'read' }
      : { allowed: false, reason: 'unexpected_read_query' };
  }
  if (parsed.pathname === '/api/admin/alerts') {
    return hasOnlySearchKeys(parsed.searchParams, new Set(['summary', 'limit', 'unreadOnly']))
      ? { allowed: true, kind: 'read' }
      : { allowed: false, reason: 'unexpected_read_query' };
  }
  if (parsed.pathname === '/api/workbench/resolve-request') {
    const keys = new Set(parsed.searchParams.keys());
    const byNumber = keys.size === 1
      && parsed.searchParams.get('requestNumber') === COLD_REQUEST_NUMBER;
    const byId = keys.size === 1 && exactRequestParam(parsed, 'requestId', requestId);
    return byNumber || byId
      ? { allowed: true, kind: 'read' }
      : { allowed: false, reason: 'request_selector_mismatch' };
  }
  if (parsed.pathname === '/api/workbench/reviewer-roster') {
    if (!exactRequestParam(parsed, 'requestId', requestId)) {
      return { allowed: false, reason: 'request_id_mismatch' };
    }
    const mode = parsed.searchParams.get('mode');
    const allowedKeys = mode === 'reconciled'
      ? new Set(['requestId', 'mode', 'rosterVersion'])
      : new Set(['requestId', 'mode']);
    if (!['cached', 'reconciled'].includes(mode)
      || !hasOnlySearchKeys(parsed.searchParams, allowedKeys)
      || (mode === 'reconciled' && !parsed.searchParams.get('rosterVersion'))) {
      return { allowed: false, reason: 'roster_read_shape_invalid' };
    }
    return { allowed: true, kind: 'read' };
  }
  const requestReads = new Map([
    ['/api/workbench/reviewer-rollup', 'requestId'],
    ['/api/workbench/applicant-reviewers', 'requestId'],
    ['/api/review-manager/reviewers', 'proposalId'],
    ['/api/reviewer-finder/my-candidates', 'requestId'],
    ['/api/workbench/decline-referrals', 'requestId'],
  ]);
  const requestKey = requestReads.get(parsed.pathname);
  if (requestKey) {
    return parsed.searchParams.size === 1 && exactRequestParam(parsed, requestKey, requestId)
      ? { allowed: true, kind: 'read' }
      : { allowed: false, reason: 'request_selector_mismatch' };
  }
  return { allowed: false, reason: 'api_read_path_not_allowed' };
}

function validateColdBrowserRequest({ method, url, baseUrl, requestId, postData } = {}) {
  const normalizedMethod = String(method || '').toUpperCase();
  let parsed;
  let base;
  try {
    parsed = new URL(url);
    base = new URL(baseUrl);
  } catch {
    return { allowed: false, reason: 'invalid_url' };
  }
  if (parsed.origin !== base.origin) return { allowed: false, reason: 'off_origin' };
  if (SAFE_METHODS.has(normalizedMethod)) {
    if (!parsed.pathname.startsWith('/api/')) return { allowed: true, kind: 'static_read' };
    return validateApiRead(parsed, requestId);
  }
  if (isForbiddenPath(parsed.pathname)) return { allowed: false, reason: 'forbidden_path' };
  if (normalizedMethod !== 'POST') return { allowed: false, reason: 'method_not_allowed' };

  const allowedKeys = POST_KEYS[parsed.pathname];
  if (!allowedKeys) return { allowed: false, reason: 'post_path_not_allowed' };
  const body = parseBody(postData);
  if (!body) return { allowed: false, reason: 'invalid_json_body' };
  if (!hasOnlyAllowedKeys(body, allowedKeys)) {
    return { allowed: false, reason: 'unexpected_body_key' };
  }
  if (typeof requestId !== 'string' || body.requestId !== requestId) {
    return { allowed: false, reason: 'request_id_mismatch' };
  }
  if (parsed.pathname === '/api/reviewer-finder/load-proposal'
      && Object.hasOwn(body, 'fileKey')) {
    return { allowed: false, reason: 'manual_file_override_forbidden' };
  }
  return { allowed: true, kind: 'cold_producer', path: parsed.pathname };
}

function validateLifecycleUnchanged(before = {}, after = {}) {
  const fields = [
    'selected',
    'invited',
    'accepted',
    'declined',
    'reviewArtifacts',
    'totalSuggestions',
    'uninvitedSuggestions',
  ];
  const changed = fields.filter((field) => Number(before[field] || 0) !== Number(after[field] || 0));
  return { ok: changed.length === 0, changed };
}

function validateColdCompletion({
  preparedProposal = false,
  applicantVerificationComplete = false,
  generalSearchComplete = false,
  rosterBefore = 0,
  rosterAfter = 0,
  lifecycleBefore = {},
  lifecycleAfter = {},
  blockedRequests = [],
  expectedRosterCount = 5,
} = {}) {
  const failures = [];
  if (!preparedProposal) failures.push('proposal_not_prepared');
  if (!applicantVerificationComplete) failures.push('applicant_verification_incomplete');
  if (!generalSearchComplete) failures.push('general_search_incomplete');
  if (Number(rosterBefore || 0) !== 0) failures.push('fixture_roster_not_empty');
  if (Number(rosterAfter || 0) !== Number(expectedRosterCount)) {
    failures.push('authoritative_roster_count_mismatch');
  }
  const lifecycle = validateLifecycleUnchanged(lifecycleBefore, lifecycleAfter);
  if (!lifecycle.ok) failures.push('reviewer_lifecycle_changed');
  if (Array.isArray(blockedRequests) && blockedRequests.length > 0) failures.push('browser_request_blocked');
  return { ok: failures.length === 0, failures, lifecycle };
}

function validateColdExecutionConfig({
  mode,
  deploymentClass,
  confirmProductionColdPrepare = false,
} = {}) {
  const failures = [];
  if (!['preflight', 'run'].includes(mode)) failures.push('invalid_mode');
  if (!['preview', 'production'].includes(deploymentClass)) failures.push('invalid_deployment_class');
  if (mode === 'run' && deploymentClass !== 'production') {
    failures.push('cold_run_requires_production_deployment');
  }
  if (mode === 'run' && confirmProductionColdPrepare !== true) {
    failures.push('production_cold_prepare_confirmation_required');
  }
  return { ok: failures.length === 0, failures };
}

module.exports = {
  COLD_REQUEST_NUMBER,
  POST_KEYS,
  FORBIDDEN_PATH_PATTERNS,
  validateColdBrowserRequest,
  validateLifecycleUnchanged,
  validateColdCompletion,
  validateColdExecutionConfig,
};
