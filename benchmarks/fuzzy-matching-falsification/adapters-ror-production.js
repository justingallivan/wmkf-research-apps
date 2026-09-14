#!/usr/bin/env node
/**
 * Production ROR institution comparator for the frozen single-string cases.
 *
 * The production candidate union and veto-first decision supply the scored
 * outcome. The production OpenAlex bridge supplies the displayed identity and
 * is recorded separately: it cannot return a single identity for a multi-org
 * decision. ROR IDs and veto observations are provenance, never judge inputs.
 *
 * There is deliberately no institutionPairConsistent export. Production has no
 * ROR pair policy, so the frozen pair cases must remain skipped rather than be
 * scored using a policy invented by this comparator. The other non-institution
 * adapters are also absent.
 */
'use strict';

const {
  createRorCandidateUnionAdapter,
} = require('../../lib/services/ror-institution-candidate-adapter');
const {
  createInstitutionDecisionResolver,
} = require('../../lib/services/ror-institution-decision');
const {
  createRorInstitutionIdentityResolver,
} = require('../../lib/services/ror-institution-identity-resolver');

const candidateAdapter = createRorCandidateUnionAdapter();
const decisionResolver = createInstitutionDecisionResolver({ candidateAdapter });
const identityResolver = createRorInstitutionIdentityResolver({ candidateAdapter });

function delta(after, before, key) {
  return (after[key] || 0) - (before[key] || 0);
}

async function institutionResolve(input) {
  const startedAt = Date.now();
  const candidateBefore = candidateAdapter.metrics;
  const identityBefore = identityResolver.metrics;
  const decision = await decisionResolver.resolve(input);
  if (decision.reasons.includes('provider_failure')) {
    throw new Error('production ROR decision provider failure');
  }

  const identity = await identityResolver.resolve(input.affiliation_string, {
    countryCode: input.country_code ?? null,
    domainEvidence: input.domain_evidence ?? null,
  });
  const candidateAfter = candidateAdapter.metrics;
  const identityAfter = identityResolver.metrics;
  const providerFailures = delta(candidateAfter, candidateBefore, 'providerFailures');
  const bridgeFailures = delta(identityAfter, identityBefore, 'bridgeFailures');
  if (providerFailures || bridgeFailures) {
    throw new Error(`production ROR provider failure: ROR=${providerFailures}, bridge=${bridgeFailures}`);
  }

  const selectedIds = new Set(decision.selected_ror_ids);
  const selectedVetoes = decision.evaluations
    .filter((evaluation) => selectedIds.has(evaluation.ror_id) && evaluation.vetoes.length)
    .map((evaluation) => ({ ror_id: evaluation.ror_id, vetoes: evaluation.vetoes }));
  const evaluatedIds = new Set(decision.evaluations.map((evaluation) => evaluation.ror_id));

  return {
    outcome: decision.outcome,
    target: identity ? { name: identity.displayName, ror_id: identity.ror } : null,
    decision_selected_ror_ids: decision.selected_ror_ids,
    decision_reasons: decision.reasons,
    decision_resolver_version: decision.provenance.resolver_version,
    selected_vetoes: selectedVetoes,
    selected_ids_without_evaluation: decision.selected_ror_ids.filter((id) => !evaluatedIds.has(id)),
    identity_bridge: identity ? 'hydrated' : 'null',
    ror_provider_requests: delta(candidateAfter, candidateBefore, 'providerRequests'),
    ror_provider_timeouts: delta(candidateAfter, candidateBefore, 'providerTimeouts'),
    ror_provider_failures: providerFailures,
    openalex_bridge_attempts: delta(identityAfter, identityBefore, 'bridgeAttempts'),
    openalex_bridge_failures: bridgeFailures,
    wall_time_ms: Date.now() - startedAt,
  };
}

module.exports = { institutionResolve };
