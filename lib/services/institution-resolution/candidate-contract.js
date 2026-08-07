'use strict';

/**
 * Verdict-free candidate-set boundary shared by production institution
 * resolution and the frozen falsification benchmark.
 */

const crypto = require('crypto');

const SCHEMA_VERSION = 'institution-candidate-set/v1';
const FORBIDDEN_DECISION_KEYS = new Set([
  'consistent', 'decision', 'outcome', 'resolved', 'selected', 'target', 'verdict',
]);
const ALLOWED_INPUT_KEYS = new Set([
  'affiliation_string', 'country_code', 'domain_evidence', 'signal',
]);

function normalizeStringArray(value) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map((item) => String(item || '').trim())
    .filter(Boolean))].sort();
}

function assertCandidateInput(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('candidate input must be an object');
  }
  for (const key of Object.keys(input)) {
    if (!ALLOWED_INPUT_KEYS.has(key)) {
      throw new Error(`candidate input must not contain ${key}`);
    }
  }
  if (input.affiliation_string != null && typeof input.affiliation_string !== 'string') {
    throw new Error('candidate input affiliation_string must be a string');
  }
  if (String(input.affiliation_string || '').length > 1000) {
    throw new Error('candidate input affiliation_string exceeds 1000 characters');
  }
  if (String(input.affiliation_string || '').includes('@')) {
    throw new Error('candidate input affiliation_string must not contain an email address');
  }
  if (input.country_code != null && !/^[A-Za-z]{2}$/.test(String(input.country_code).trim())) {
    throw new Error('candidate input country_code must be ISO-2');
  }
  if (input.domain_evidence != null
    && !Array.isArray(input.domain_evidence)
    && typeof input.domain_evidence !== 'string') {
    throw new Error('candidate input domain_evidence must be a string or array');
  }
  const domains = input.domain_evidence == null
    ? []
    : Array.isArray(input.domain_evidence) ? input.domain_evidence : [input.domain_evidence];
  for (const domain of domains) {
    if (!/^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(String(domain || '').trim())) {
      throw new Error('candidate input domain_evidence must contain bare domains only');
    }
  }
  return input;
}

function candidateInputHash(input = {}) {
  assertCandidateInput(input);
  const payload = JSON.stringify({
    affiliation_string: String(input.affiliation_string || '').trim(),
    country_code: input.country_code == null ? null : String(input.country_code).trim().toUpperCase(),
    domain_evidence: normalizeStringArray(
      Array.isArray(input.domain_evidence) ? input.domain_evidence : [input.domain_evidence],
    ),
  });
  return crypto.createHash('sha256').update(payload).digest('hex');
}

function normalizeCandidate(organization = {}, retrieval = {}) {
  const rorId = String(organization.id || organization.ror_id || '').trim();
  if (!/^https:\/\/ror\.org\/[0-9a-z]{9}$/.test(rorId)) {
    throw new Error(`candidate has invalid ROR id: ${JSON.stringify(rorId)}`);
  }
  const names = (Array.isArray(organization.names) ? organization.names : [])
    .filter((name) => name && String(name.value || '').trim())
    .map((name) => ({
      value: String(name.value).trim(),
      types: normalizeStringArray(name.types),
      lang: name.lang == null ? null : String(name.lang),
    }));
  const display = names.find((name) => name.types.includes('ror_display'))
    || names.find((name) => name.types.includes('provider_display'))
    || names[0]
    || null;
  return {
    ror_id: rorId,
    status: organization.status == null ? null : String(organization.status),
    display_name: display?.value ?? null,
    names,
    domains: normalizeStringArray(organization.domains),
    locations: (Array.isArray(organization.locations) ? organization.locations : []).map((location) => ({
      country_code: location?.geonames_details?.country_code
        || location?.country_code
        || null,
      subdivision_code: location?.geonames_details?.country_subdivision_code
        || location?.subdivision_code
        || null,
      city: location?.geonames_details?.name || location?.city || null,
    })),
    types: normalizeStringArray(organization.types),
    relationships: (Array.isArray(organization.relationships) ? organization.relationships : [])
      .filter((relationship) => relationship?.id && relationship?.type)
      .map((relationship) => ({
        ror_id: String(relationship.id),
        type: String(relationship.type),
        label: relationship.label == null ? null : String(relationship.label),
      })),
    retrieval: (Array.isArray(retrieval) ? retrieval : [retrieval]).map((source) => ({
      strategy: String(source.strategy || 'unknown'),
      rank: Number.isInteger(source.rank) && source.rank >= 0 ? source.rank : null,
      score: Number.isFinite(source.score) ? source.score : null,
      matching_type: source.matching_type == null ? null : String(source.matching_type),
      provider_chosen: source.provider_chosen === true,
    })),
  };
}

function createCandidateSet({ provider, candidates, provenance = {} }) {
  const byId = new Map();
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    const normalized = candidate?.ror_id ? candidate : normalizeCandidate(candidate.organization, candidate.retrieval);
    const existing = byId.get(normalized.ror_id);
    if (!existing) {
      byId.set(normalized.ror_id, normalized);
      continue;
    }
    const retrieval = [...existing.retrieval];
    const seen = new Set(retrieval.map((source) => JSON.stringify(source)));
    for (const source of normalized.retrieval) {
      const key = JSON.stringify(source);
      if (!seen.has(key)) {
        retrieval.push(source);
        seen.add(key);
      }
    }
    byId.set(normalized.ror_id, { ...existing, retrieval });
  }
  return assertCandidateSet({
    schema_version: SCHEMA_VERSION,
    provider: String(provider || ''),
    candidates: [...byId.values()],
    provenance: {
      api_version: provenance.api_version == null ? null : String(provenance.api_version),
      adapter_version: provenance.adapter_version == null ? null : String(provenance.adapter_version),
      observed_on: provenance.observed_on == null ? null : String(provenance.observed_on),
      input_hash: provenance.input_hash == null ? null : String(provenance.input_hash),
      strategies: normalizeStringArray(provenance.strategies),
      request_count: Number.isInteger(provenance.request_count) && provenance.request_count >= 0
        ? provenance.request_count
        : null,
      retry_count: Number.isInteger(provenance.retry_count) && provenance.retry_count >= 0
        ? provenance.retry_count
        : null,
      cache_hit: provenance.cache_hit === true,
      single_flight_hit: provenance.single_flight_hit === true,
    },
  });
}

function assertCandidateSet(value) {
  if (!value || typeof value !== 'object') throw new Error('candidate set must be an object');
  if (value.schema_version !== SCHEMA_VERSION) {
    throw new Error(`candidate set schema must be ${SCHEMA_VERSION}`);
  }
  if (!value.provider) throw new Error('candidate set provider is required');
  if (!Array.isArray(value.candidates)) throw new Error('candidate set candidates must be an array');
  const ids = new Set();
  for (const candidate of value.candidates) {
    for (const key of FORBIDDEN_DECISION_KEYS) {
      if (Object.prototype.hasOwnProperty.call(candidate, key)) {
        throw new Error(`candidate must not contain decision field ${key}`);
      }
    }
    if (!/^https:\/\/ror\.org\/[0-9a-z]{9}$/.test(candidate.ror_id || '')) {
      throw new Error(`candidate has invalid ROR id: ${JSON.stringify(candidate.ror_id)}`);
    }
    if (ids.has(candidate.ror_id)) throw new Error(`duplicate candidate ROR id ${candidate.ror_id}`);
    ids.add(candidate.ror_id);
    for (const key of ['names', 'domains', 'locations', 'types', 'relationships']) {
      if (!Array.isArray(candidate[key])) throw new Error(`candidate ${candidate.ror_id} missing ${key} array`);
    }
    if (!Array.isArray(candidate.retrieval) || !candidate.retrieval.length) {
      throw new Error(`candidate ${candidate.ror_id} missing retrieval provenance`);
    }
  }
  for (const key of FORBIDDEN_DECISION_KEYS) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      throw new Error(`candidate set must not contain decision field ${key}`);
    }
  }
  if (!value.provenance || typeof value.provenance !== 'object') {
    throw new Error('candidate set provenance is required');
  }
  if (!value.provenance.adapter_version) throw new Error('candidate set adapter_version is required');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value.provenance.observed_on || '')) {
    throw new Error('candidate set observed_on must be YYYY-MM-DD');
  }
  if (!/^[0-9a-f]{64}$/.test(value.provenance.input_hash || '')) {
    throw new Error('candidate set input_hash must be SHA-256');
  }
  if (!Array.isArray(value.provenance.strategies) || !value.provenance.strategies.length) {
    throw new Error('candidate set provenance must name at least one strategy');
  }
  return value;
}

module.exports = {
  SCHEMA_VERSION,
  assertCandidateInput,
  assertCandidateSet,
  candidateInputHash,
  createCandidateSet,
  normalizeCandidate,
};
