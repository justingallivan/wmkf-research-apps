'use strict';

/**
 * Versioned contracts for the public institution-resolution readiness assets.
 * These validators are deliberately dependency-free and fail closed on unknown
 * fields. Private completed-cycle artifacts use a separate access-controlled
 * contract and must never be passed through this public writer boundary.
 */

const SCHEMA_VERSION = 1;
const OUTCOMES = new Set(['resolved', 'review', 'unresolved']);
const ORIGINS = new Set(['synthetic', 'public_registry']);
const PROFILES = new Set(['production_shape', 'capability_only']);
const SPLITS = new Set(['calibration', 'public_regression']);
const PROVIDERS = new Set(['ror', 'openalex']);
const CASSETTE_STRATEGIES = {
  ror: new Set(['affiliation-single-search', 'organization-by-ror']),
  openalex: new Set(['institution-single-search', 'institution-by-id']),
};
const RESULT_SCOPES = new Set(['aggregate_private', 'public_fixture']);
const MANIFEST_TYPES = new Set(['public_cases', 'public_cassettes']);
const ROR_RE = /^https:\/\/ror\.org\/[0-9a-z]{9}$/;
const SHA256_RE = /^[a-f0-9]{64}$/;
const COMMIT_RE = /^[a-f0-9]{7,40}$/;
const ID_RE = /^[a-z0-9][a-z0-9._-]{2,100}$/;
const DOMAIN_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const ISO_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function add(problems, path, message) {
  problems.push(`${path}: ${message}`);
}

function exactKeys(value, allowed, path, problems) {
  if (!isObject(value)) {
    add(problems, path, 'must be an object');
    return false;
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) add(problems, `${path}.${key}`, 'field is not allowed');
  }
  return true;
}

function requiredString(value, path, problems, { pattern = null, max = 500 } = {}) {
  if (typeof value !== 'string' || !value.trim()) {
    add(problems, path, 'must be a non-empty string');
    return null;
  }
  const normalized = value.trim();
  if (normalized.length > max) add(problems, path, `must be at most ${max} characters`);
  if (pattern && !pattern.test(normalized)) add(problems, path, 'has an invalid format');
  return normalized;
}

function nonNegativeInteger(value, path, problems) {
  if (!Number.isInteger(value) || value < 0) {
    add(problems, path, 'must be a non-negative integer');
    return null;
  }
  return value;
}

function isRealIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function stringArray(value, path, problems, {
  pattern = null,
  maxItems = 100,
  unique = true,
} = {}) {
  if (!Array.isArray(value)) {
    add(problems, path, 'must be an array');
    return [];
  }
  if (value.length > maxItems) add(problems, path, `must contain at most ${maxItems} items`);
  const normalized = [];
  for (let index = 0; index < value.length; index += 1) {
    const item = requiredString(value[index], `${path}[${index}]`, problems, { pattern, max: 500 });
    if (item) normalized.push(item);
  }
  if (unique && new Set(normalized).size !== normalized.length) {
    add(problems, path, 'must not contain duplicates');
  }
  return normalized;
}

function validateSplit(value, path, problems) {
  if (!exactKeys(value, new Set(['split', 'release']), path, problems)) return;
  if (!SPLITS.has(value.split)) add(problems, `${path}.split`, 'unsupported split');
  requiredString(value.release, `${path}.release`, problems, { pattern: ID_RE, max: 100 });
}

function validateExpected(value, path, problems) {
  if (!exactKeys(value, new Set(['outcome', 'ror_ids', 'must_not_ror_ids']), path, problems)) return;
  if (!OUTCOMES.has(value.outcome)) add(problems, `${path}.outcome`, 'unsupported outcome');
  const selected = stringArray(value.ror_ids, `${path}.ror_ids`, problems, {
    pattern: ROR_RE,
    maxItems: 1,
  });
  const forbidden = stringArray(value.must_not_ror_ids, `${path}.must_not_ror_ids`, problems, {
    pattern: ROR_RE,
    maxItems: 25,
  });
  if (value.outcome === 'resolved' && selected.length !== 1) {
    add(problems, `${path}.ror_ids`, 'resolved outcomes require exactly one canonical ROR id');
  }
  if (value.outcome !== 'resolved' && selected.length !== 0) {
    add(problems, `${path}.ror_ids`, 'review/unresolved outcomes cannot select a ROR id');
  }
  if (selected.some((ror) => forbidden.includes(ror))) {
    add(problems, path, 'selected ROR id cannot also be forbidden');
  }
}

function validateLabel(value, path, problems) {
  const allowed = new Set([
    'status',
    'adjudicator_role',
    'evidence',
    'allowed_evidence_hosts',
    'ror_release',
    'ror_release_sha256',
  ]);
  if (!exactKeys(value, allowed, path, problems)) return;
  if (value.status !== 'verified') add(problems, `${path}.status`, 'public labels must be verified');
  requiredString(value.adjudicator_role, `${path}.adjudicator_role`, problems, {
    pattern: ID_RE,
    max: 80,
  });
  stringArray(value.evidence, `${path}.evidence`, problems, { maxItems: 10 });
  stringArray(value.allowed_evidence_hosts || [], `${path}.allowed_evidence_hosts`, problems, {
    pattern: DOMAIN_RE,
    maxItems: 10,
  });
  requiredString(value.ror_release, `${path}.ror_release`, problems, { pattern: ID_RE, max: 100 });
  requiredString(value.ror_release_sha256, `${path}.ror_release_sha256`, problems, {
    pattern: SHA256_RE,
    max: 64,
  });
}

function validateInput(value, profile, path, problems) {
  const productionKeys = new Set(['affiliation_string']);
  const capabilityKeys = new Set(['affiliation_string', 'country_code', 'domain_evidence']);
  if (!exactKeys(value, profile === 'production_shape' ? productionKeys : capabilityKeys, path, problems)) {
    return;
  }
  requiredString(value.affiliation_string, `${path}.affiliation_string`, problems, { max: 500 });
  if (profile === 'capability_only') {
    if (value.country_code !== undefined
      && (typeof value.country_code !== 'string' || !/^[A-Z]{2}$/.test(value.country_code))) {
      add(problems, `${path}.country_code`, 'must be an ISO-2 uppercase country code');
    }
    if (value.domain_evidence !== undefined) {
      requiredString(value.domain_evidence, `${path}.domain_evidence`, problems, {
        pattern: DOMAIN_RE,
        max: 253,
      });
    }
  }
}

function validateCase(value) {
  const problems = [];
  const allowed = new Set([
    'schema_version',
    'id',
    'origin',
    'profile',
    'group',
    'first_split_assignment',
    'split',
    'input',
    'expected',
    'label',
    'note',
  ]);
  if (!exactKeys(value, allowed, 'case', problems)) return problems;
  if (value.schema_version !== SCHEMA_VERSION) add(problems, 'case.schema_version', `must equal ${SCHEMA_VERSION}`);
  requiredString(value.id, 'case.id', problems, { pattern: ID_RE, max: 100 });
  if (!ORIGINS.has(value.origin)) add(problems, 'case.origin', 'must be synthetic or public_registry');
  if (!PROFILES.has(value.profile)) add(problems, 'case.profile', 'unsupported replay profile');
  requiredString(value.group, 'case.group', problems, { pattern: ID_RE, max: 100 });
  validateSplit(value.first_split_assignment, 'case.first_split_assignment', problems);
  if (!SPLITS.has(value.split)) add(problems, 'case.split', 'unsupported split');
  if (isObject(value.first_split_assignment)
    && value.first_split_assignment.split !== value.split) {
    add(problems, 'case.split', 'must match first_split_assignment.split');
  }
  validateInput(value.input, value.profile, 'case.input', problems);
  validateExpected(value.expected, 'case.expected', problems);
  validateLabel(value.label, 'case.label', problems);
  if (value.note !== undefined) requiredString(value.note, 'case.note', problems, { max: 500 });
  return problems;
}

function validateCassette(value) {
  const problems = [];
  const allowed = new Set([
    'schema_version',
    'id',
    'provider',
    'request_hash',
    'request',
    'response',
    'observed_on',
  ]);
  if (!exactKeys(value, allowed, 'cassette', problems)) return problems;
  if (value.schema_version !== SCHEMA_VERSION) add(problems, 'cassette.schema_version', `must equal ${SCHEMA_VERSION}`);
  requiredString(value.id, 'cassette.id', problems, { pattern: ID_RE, max: 100 });
  if (!PROVIDERS.has(value.provider)) add(problems, 'cassette.provider', 'unsupported provider');
  requiredString(value.request_hash, 'cassette.request_hash', problems, { pattern: SHA256_RE, max: 64 });
  if (exactKeys(value.request, new Set(['method', 'endpoint', 'strategy']), 'cassette.request', problems)) {
    if (value.request.method !== 'GET') add(problems, 'cassette.request.method', 'only GET is allowed');
    requiredString(value.request.endpoint, 'cassette.request.endpoint', problems, { max: 300 });
    const strategy = requiredString(value.request.strategy, 'cassette.request.strategy', problems, {
      pattern: ID_RE,
      max: 100,
    });
    if (strategy && !CASSETTE_STRATEGIES[value.provider]?.has(strategy)) {
      add(problems, 'cassette.request.strategy', 'is not allowed for the declared institution provider');
    }
  }
  if (exactKeys(value.response, new Set(['status', 'body']), 'cassette.response', problems)) {
    if (!Number.isInteger(value.response.status)
      || value.response.status < 100
      || value.response.status > 599) {
      add(problems, 'cassette.response.status', 'must be a valid HTTP status');
    }
    if (!isObject(value.response.body) && !Array.isArray(value.response.body)) {
      add(problems, 'cassette.response.body', 'must be an object or array');
    } else if (JSON.stringify(value.response.body).length > 250_000) {
      add(problems, 'cassette.response.body', 'must be at most 250000 serialized characters');
    }
  }
  if (!isRealIsoDate(value.observed_on)) {
    add(problems, 'cassette.observed_on', 'must be a real YYYY-MM-DD date');
  }
  return problems;
}

function validateLatency(value, path, problems) {
  if (!exactKeys(value, new Set(['p50', 'p95', 'max']), path, problems)) return;
  const p50 = nonNegativeInteger(value.p50, `${path}.p50`, problems);
  const p95 = nonNegativeInteger(value.p95, `${path}.p95`, problems);
  const max = nonNegativeInteger(value.max, `${path}.max`, problems);
  if (p50 !== null && p95 !== null && max !== null && !(p50 <= p95 && p95 <= max)) {
    add(problems, path, 'must satisfy p50 <= p95 <= max');
  }
}

function validateProviderRequests(value, path, problems) {
  if (!exactKeys(value, new Set(['ror', 'openalex']), path, problems)) return;
  nonNegativeInteger(value.ror, `${path}.ror`, problems);
  nonNegativeInteger(value.openalex, `${path}.openalex`, problems);
}

function validateSummary(value, path, problems) {
  const allowed = new Set([
    'total',
    'resolved',
    'review',
    'unresolved',
    'wrong_automatic',
    'provider_failures',
    'deadline_abstentions',
    'latency_ms',
    'provider_requests',
  ]);
  if (!exactKeys(value, allowed, path, problems)) return;
  const total = nonNegativeInteger(value.total, `${path}.total`, problems);
  const resolved = nonNegativeInteger(value.resolved, `${path}.resolved`, problems);
  const review = nonNegativeInteger(value.review, `${path}.review`, problems);
  const unresolved = nonNegativeInteger(value.unresolved, `${path}.unresolved`, problems);
  nonNegativeInteger(value.wrong_automatic, `${path}.wrong_automatic`, problems);
  nonNegativeInteger(value.provider_failures, `${path}.provider_failures`, problems);
  nonNegativeInteger(value.deadline_abstentions, `${path}.deadline_abstentions`, problems);
  validateLatency(value.latency_ms, `${path}.latency_ms`, problems);
  validateProviderRequests(value.provider_requests, `${path}.provider_requests`, problems);
  if ([total, resolved, review, unresolved].every((item) => item !== null)
    && resolved + review + unresolved !== total) {
    add(problems, path, 'resolved + review + unresolved must equal total');
  }
}

function validatePublicCaseResult(value, path, problems) {
  const allowed = new Set([
    'case_id',
    'expected_outcome',
    'actual_outcome',
    'selected_ror_ids',
    'failure_reasons',
  ]);
  if (!exactKeys(value, allowed, path, problems)) return;
  requiredString(value.case_id, `${path}.case_id`, problems, { pattern: ID_RE, max: 100 });
  if (!OUTCOMES.has(value.expected_outcome)) add(problems, `${path}.expected_outcome`, 'unsupported outcome');
  if (!OUTCOMES.has(value.actual_outcome)) add(problems, `${path}.actual_outcome`, 'unsupported outcome');
  const selected = stringArray(value.selected_ror_ids, `${path}.selected_ror_ids`, problems, {
    pattern: ROR_RE,
    maxItems: 1,
  });
  stringArray(value.failure_reasons, `${path}.failure_reasons`, problems, {
    pattern: ID_RE,
    maxItems: 20,
  });
  if (value.actual_outcome === 'resolved' && selected.length !== 1) {
    add(problems, `${path}.selected_ror_ids`, 'resolved outcomes require exactly one canonical ROR id');
  }
  if (value.actual_outcome !== 'resolved' && selected.length !== 0) {
    add(problems, `${path}.selected_ror_ids`, 'review/unresolved outcomes cannot select a ROR id');
  }
}

function validateResult(value) {
  const problems = [];
  const allowed = new Set([
    'schema_version',
    'result_id',
    'scope',
    'source_commit',
    'created_at',
    'case_manifest_sha256',
    'cassette_manifest_sha256',
    'summary',
    'cases',
  ]);
  if (!exactKeys(value, allowed, 'result', problems)) return problems;
  if (value.schema_version !== SCHEMA_VERSION) add(problems, 'result.schema_version', `must equal ${SCHEMA_VERSION}`);
  requiredString(value.result_id, 'result.result_id', problems, { pattern: ID_RE, max: 100 });
  if (!RESULT_SCOPES.has(value.scope)) add(problems, 'result.scope', 'unsupported result scope');
  requiredString(value.source_commit, 'result.source_commit', problems, { pattern: COMMIT_RE, max: 40 });
  if (typeof value.created_at !== 'string'
    || !ISO_TIMESTAMP_RE.test(value.created_at)
    || !Number.isFinite(Date.parse(value.created_at))) {
    add(problems, 'result.created_at', 'must be a UTC ISO timestamp');
  }
  requiredString(value.case_manifest_sha256, 'result.case_manifest_sha256', problems, {
    pattern: SHA256_RE,
    max: 64,
  });
  requiredString(value.cassette_manifest_sha256, 'result.cassette_manifest_sha256', problems, {
    pattern: SHA256_RE,
    max: 64,
  });
  validateSummary(value.summary, 'result.summary', problems);
  if (value.scope === 'aggregate_private') {
    if (value.cases !== undefined) {
      add(problems, 'result.cases', 'aggregate_private results cannot include a cases field');
    }
  } else {
    if (!Array.isArray(value.cases)) {
      add(problems, 'result.cases', 'public_fixture results require case rows');
    } else {
      value.cases.forEach((row, index) => validatePublicCaseResult(row, `result.cases[${index}]`, problems));
      const caseIds = value.cases.map((row) => row?.case_id).filter(Boolean);
      if (new Set(caseIds).size !== caseIds.length) add(problems, 'result.cases', 'case ids must be unique');
      if (Number.isInteger(value.summary?.total) && value.cases.length !== value.summary.total) {
        add(problems, 'result.cases', 'case count must equal summary.total');
      }
    }
  }
  return problems;
}

function validateManifest(value) {
  const problems = [];
  const allowed = new Set([
    'schema_version',
    'manifest_id',
    'artifact_type',
    'release',
    'ror_release',
    'ror_release_sha256',
    'artifacts',
  ]);
  if (!exactKeys(value, allowed, 'manifest', problems)) return problems;
  if (value.schema_version !== SCHEMA_VERSION) add(problems, 'manifest.schema_version', `must equal ${SCHEMA_VERSION}`);
  requiredString(value.manifest_id, 'manifest.manifest_id', problems, { pattern: ID_RE, max: 100 });
  if (!MANIFEST_TYPES.has(value.artifact_type)) add(problems, 'manifest.artifact_type', 'unsupported artifact type');
  requiredString(value.release, 'manifest.release', problems, { pattern: ID_RE, max: 100 });
  requiredString(value.ror_release, 'manifest.ror_release', problems, { pattern: ID_RE, max: 100 });
  requiredString(value.ror_release_sha256, 'manifest.ror_release_sha256', problems, {
    pattern: SHA256_RE,
    max: 64,
  });
  if (!Array.isArray(value.artifacts) || value.artifacts.length === 0) {
    add(problems, 'manifest.artifacts', 'must contain at least one artifact');
  } else {
    const seen = new Set();
    value.artifacts.forEach((artifact, index) => {
      const path = `manifest.artifacts[${index}]`;
      if (!exactKeys(artifact, new Set(['path', 'sha256', 'records']), path, problems)) return;
      const artifactPath = requiredString(artifact.path, `${path}.path`, problems, { max: 300 });
      if (artifactPath && (artifactPath.startsWith('/')
        || artifactPath.includes('..')
        || artifactPath.includes('\\')
        || !artifactPath.endsWith('.json'))) {
        add(problems, `${path}.path`, 'must be a safe relative JSON path');
      }
      if (artifactPath && seen.has(artifactPath)) add(problems, `${path}.path`, 'must be unique');
      if (artifactPath) seen.add(artifactPath);
      requiredString(artifact.sha256, `${path}.sha256`, problems, { pattern: SHA256_RE, max: 64 });
      nonNegativeInteger(artifact.records, `${path}.records`, problems);
    });
  }
  return problems;
}

function assertValid(value, validator, label) {
  const problems = validator(value);
  if (problems.length) throw new Error(`${label} validation failed:\n- ${problems.join('\n- ')}`);
  return value;
}

module.exports = {
  SCHEMA_VERSION,
  assertValid,
  validateCase,
  validateCassette,
  validateManifest,
  validateResult,
};
