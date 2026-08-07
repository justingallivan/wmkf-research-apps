'use strict';

/**
 * PII-minimized institution decision boundary shared by production shadow
 * resolution and the frozen falsification benchmark.
 */

const crypto = require('crypto');

const SCHEMA_VERSION = 'institution-decision/v1';
const OUTCOMES = new Set(['resolved', 'review', 'unresolved']);

function decisionInputHash(input = {}) {
  const payload = JSON.stringify({
    affiliation_string: String(input.affiliation_string || '').trim(),
    country_code: input.country_code == null ? null : String(input.country_code).trim().toUpperCase(),
    domain_evidence: input.domain_evidence == null
      ? []
      : (Array.isArray(input.domain_evidence) ? input.domain_evidence : [input.domain_evidence])
        .map((value) => String(value).trim().toLowerCase()).sort(),
  });
  return crypto.createHash('sha256').update(payload).digest('hex');
}

function assertDecision(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('decision must be an object');
  }
  if (value.schema_version !== SCHEMA_VERSION) {
    throw new Error(`decision schema must be ${SCHEMA_VERSION}`);
  }
  if (!OUTCOMES.has(value.outcome)) throw new Error(`invalid decision outcome ${value.outcome}`);
  if (!Array.isArray(value.selected_ror_ids)) throw new Error('selected_ror_ids must be an array');
  const uniqueIds = new Set(value.selected_ror_ids);
  if (uniqueIds.size !== value.selected_ror_ids.length) throw new Error('selected_ror_ids must be unique');
  for (const id of uniqueIds) {
    if (!/^https:\/\/ror\.org\/[0-9a-z]{9}$/.test(id)) throw new Error(`invalid selected ROR id ${id}`);
  }
  if (value.outcome === 'resolved' && uniqueIds.size === 0) {
    throw new Error('resolved decision requires at least one selected ROR id');
  }
  if (value.outcome !== 'resolved' && uniqueIds.size !== 0) {
    throw new Error(`${value.outcome} decision must not select a ROR id`);
  }
  if (!Array.isArray(value.reasons) || !value.reasons.length) {
    throw new Error('decision requires at least one reason');
  }
  if (!Array.isArray(value.evaluations)) throw new Error('decision evaluations must be an array');
  for (const evaluation of value.evaluations) {
    if (!/^https:\/\/ror\.org\/[0-9a-z]{9}$/.test(evaluation.ror_id || '')) {
      throw new Error('decision evaluation requires a ROR id');
    }
    if (!Number.isFinite(evaluation.score)) throw new Error('decision evaluation requires a finite score');
    if (!Array.isArray(evaluation.vetoes) || !evaluation.features || typeof evaluation.features !== 'object') {
      throw new Error('decision evaluation requires vetoes and features');
    }
  }
  const serialized = JSON.stringify(value);
  for (const forbidden of ['affiliation_string', 'display_name', 'organization_name', 'query']) {
    if (serialized.includes(`"${forbidden}"`)) throw new Error(`decision must not expose ${forbidden}`);
  }
  if (!value.provenance || value.provenance.resolver_version !== 'ror-claim-resolver/v1') {
    throw new Error('decision resolver provenance is required');
  }
  if (!/^[0-9a-f]{64}$/.test(value.provenance.input_hash || '')) {
    throw new Error('decision input hash must be SHA-256');
  }
  return value;
}

function createDecision({ outcome, selectedRorIds = [], reasons, evaluations = [], input }) {
  return assertDecision({
    schema_version: SCHEMA_VERSION,
    outcome,
    selected_ror_ids: [...new Set(selectedRorIds)].sort(),
    reasons: [...new Set(reasons)].sort(),
    evaluations: evaluations.map((evaluation) => ({
      ror_id: evaluation.ror_id,
      score: evaluation.score,
      vetoes: [...new Set(evaluation.vetoes || [])].sort(),
      features: { ...evaluation.features },
    })),
    provenance: {
      resolver_version: 'ror-claim-resolver/v1',
      input_hash: decisionInputHash(input),
    },
  });
}

module.exports = { SCHEMA_VERSION, assertDecision, createDecision, decisionInputHash };
