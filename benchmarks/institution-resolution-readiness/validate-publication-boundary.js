'use strict';

const { URL } = require('url');

const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const ORCID_RE = /(?:https?:\/\/orcid\.org\/)?\b\d{4}-\d{4}-\d{4}-\d{3}[\dX]\b/i;
const GUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i;
const BEARER_RE = /\bbearer\s+[a-z0-9._~+/=-]{8,}/i;
const SECRET_QUERY_RE = /[?&](?:api[_-]?key|access[_-]?token|token|key|secret|password)=/i;
const COMPLETED_CYCLE_RE = /\b(?:completed[-_ ]cycle|cycle[-_ ]derived|production[-_ ]case|real[-_ ]reviewer)\b/i;
const PERSON_PATH_RE = /\/(?:people|person|persons|faculty|staff|directory|profile|profiles|bio|biography|researcher|researchers)(?:\/|$)/i;
const SAFE_ROR_RE = /^https:\/\/ror\.org\/[0-9a-z]{9}$/;
const PROVIDER_HOSTS = new Set(['api.ror.org', 'api.openalex.org']);

const FORBIDDEN_KEYS = new Set([
  'reviewername',
  'revieweremail',
  'authorid',
  'authorname',
  'authors',
  'authorships',
  'email',
  'emailaddress',
  'orcid',
  'proposalid',
  'proposalkey',
  'requestid',
  'requestnumber',
  'candidatekey',
  'contactid',
  'suggestionid',
  'frequencyweight',
  'firstname',
  'fullname',
  'lastname',
  'sourceclass',
  'productionrecordid',
  'rawrecordid',
  'privatecaseid',
  'personname',
  'cycleid',
  'cyclename',
]);

function normalizedKey(key) {
  return String(key).replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function add(problems, path, message) {
  problems.push(`${path}: ${message}`);
}

function isForbiddenTrackedPath(filePath, privateRoot = null) {
  const normalized = String(filePath).replace(/\\/g, '/').toLowerCase();
  if (privateRoot) {
    const normalizedRoot = String(privateRoot).replace(/\\/g, '/').replace(/\/$/, '').toLowerCase();
    if (normalized === normalizedRoot || normalized.startsWith(`${normalizedRoot}/`)) return true;
  }
  const parts = normalized.split('/').filter(Boolean);
  return parts.some((part) => [
    'private',
    'cycle-cases',
    'cycle-cassettes',
    'case-results',
    'completed-cycle',
    'completed-cycles',
  ].includes(part))
    || /(?:completed[-_ ]cycle|cycle[-_ ]derived|private[-_ ]cases?|private[-_ ]cassettes?)/i.test(normalized);
}

function safeInstitutionEvidence(urlString, allowedEvidenceHosts) {
  if (SAFE_ROR_RE.test(urlString)) return true;
  let parsed;
  try {
    parsed = new URL(urlString);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) return false;
  const hostname = parsed.hostname.toLowerCase();
  if (!allowedEvidenceHosts.has(hostname)) return false;
  if (PERSON_PATH_RE.test(parsed.pathname)) return false;
  const path = parsed.pathname.replace(/\/+$/, '') || '/';
  return path === '/' || /^\/(?:about|about-us|organization|institution)$/i.test(path);
}

function safeProviderEndpoint(urlString, provider, strategy = null) {
  let parsed;
  try {
    parsed = new URL(urlString);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash) return false;
  if (parsed.search || SECRET_QUERY_RE.test(urlString)) return false;
  if (!PROVIDER_HOSTS.has(parsed.hostname.toLowerCase())) return false;
  if (provider === 'ror' && parsed.hostname.toLowerCase() !== 'api.ror.org') return false;
  if (provider === 'openalex' && parsed.hostname.toLowerCase() !== 'api.openalex.org') return false;
  if (PERSON_PATH_RE.test(parsed.pathname)) return false;
  const path = parsed.pathname.replace(/\/+$/, '') || '/';
  if (provider === 'ror') {
    if (strategy === 'organization-by-ror') {
      return /^\/v2\/organizations\/[0-9a-z]{9}$/.test(path);
    }
    return strategy === 'affiliation-single-search'
      && (path === '/v2/organizations' || path === '/organizations');
  }
  if (provider === 'openalex') {
    if (strategy === 'institution-by-id') return /^\/institutions\/I\d+$/.test(path);
    return strategy === 'institution-single-search' && path === '/institutions';
  }
  return false;
}

function scanString(value, path, problems) {
  if (EMAIL_RE.test(value)) add(problems, path, 'email-like values are forbidden');
  if (ORCID_RE.test(value)) add(problems, path, 'ORCID values are forbidden');
  if (GUID_RE.test(value)) add(problems, path, 'GUID-like production identifiers are forbidden');
  if (BEARER_RE.test(value)) add(problems, path, 'authorization credentials are forbidden');
  if (SECRET_QUERY_RE.test(value)) add(problems, path, 'secret-bearing query parameters are forbidden');
  if (COMPLETED_CYCLE_RE.test(value)) add(problems, path, 'completed-cycle linkage is forbidden');
}

function visit(value, path, problems, context) {
  if (typeof value === 'string') {
    scanString(value, path, problems);
    if (PERSON_PATH_RE.test(value)) add(problems, path, 'person-level evidence URLs are forbidden');
    if (context.artifactType === 'result'
      && /^https?:\/\//i.test(value)
      && !SAFE_ROR_RE.test(value)) {
      add(problems, path, 'only canonical ROR identifiers may be URLs in public-fixture results');
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => visit(item, `${path}[${index}]`, problems, context));
    return;
  }
  if (!value || typeof value !== 'object') return;

  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (FORBIDDEN_KEYS.has(normalizedKey(key))) {
      add(problems, childPath, 'field is forbidden in public artifacts');
    }
    visit(child, childPath, problems, context);
  }
}

function validatePublicationBoundary(value, { artifactType } = {}) {
  const problems = [];
  if (!['case', 'cassette', 'manifest', 'result'].includes(artifactType)) {
    return ['artifactType: must be case, cassette, manifest, or result'];
  }
  visit(value, artifactType, problems, { artifactType });

  if (artifactType === 'case' && value && typeof value === 'object') {
    const hosts = new Set((value.label?.allowed_evidence_hosts || []).map((host) => host.toLowerCase()));
    for (const [index, evidence] of (value.label?.evidence || []).entries()) {
      if (!safeInstitutionEvidence(evidence, hosts)) {
        add(problems, `case.label.evidence[${index}]`, 'must be a canonical ROR URL or allowlisted institutional root/about URL');
      }
    }
  }

  if (artifactType === 'cassette' && value && typeof value === 'object') {
    const endpoint = value.request?.endpoint;
    if (typeof endpoint === 'string'
      && !safeProviderEndpoint(endpoint, value.provider, value.request?.strategy)) {
      add(problems, 'cassette.request.endpoint', 'must be a credential-free endpoint for the declared provider');
    }
  }

  if (artifactType === 'manifest' && value && typeof value === 'object') {
    for (const [index, artifact] of (value.artifacts || []).entries()) {
      if (isForbiddenTrackedPath(artifact?.path || '')) {
        add(problems, `manifest.artifacts[${index}].path`, 'private artifact paths are forbidden');
      }
    }
  }

  return [...new Set(problems)];
}

function assertPublicationSafe(value, options) {
  const problems = validatePublicationBoundary(value, options);
  if (problems.length) {
    throw new Error(`publication boundary failed:\n- ${problems.join('\n- ')}`);
  }
  return value;
}

module.exports = {
  assertPublicationSafe,
  isForbiddenTrackedPath,
  safeInstitutionEvidence,
  safeProviderEndpoint,
  validatePublicationBoundary,
};
