'use strict';

/**
 * Veto-first local institution decision policy over verdict-free ROR candidates.
 * The provider's rank, score, and chosen flag are never sufficient authority.
 */
const crypto = require('node:crypto');
const {
  assertCandidateInput,
  assertCandidateSet,
} = require('./ror-institution-candidate-contract');
const {
  STATE_NAMES_BY_CODE,
  candidateSignals,
  containsPhrase,
  localityAliases,
  normalizeText,
  parentAcronymScope,
  parseOrganizationSpans,
} = require('./ror-institution-evidence');

const SCHEMA_VERSION = 'institution-decision/v1';
const RESOLVER_VERSION = 'ror-claim-resolver/v1';
const OUTCOMES = new Set(['resolved', 'review', 'unresolved']);
const MIN_SCORE = 130;
const MIN_MARGIN = 10;
const LOCATION_NOISE = new Set([
  ...Object.keys(STATE_NAMES_BY_CODE).map((value) => normalizeText(value)),
  ...Object.values(STATE_NAMES_BY_CODE).map((value) => normalizeText(value)),
  'canada', 'mexico', 'uk', 'united kingdom', 'united states',
  'united states of america', 'us', 'usa',
]);

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
  if (uniqueIds.size !== value.selected_ror_ids.length) {
    throw new Error('selected_ror_ids must be unique');
  }
  for (const id of uniqueIds) {
    if (!/^https:\/\/ror\.org\/[0-9a-z]{9}$/.test(id)) {
      throw new Error(`invalid selected ROR id ${id}`);
    }
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
    if (!Number.isFinite(evaluation.score)) {
      throw new Error('decision evaluation requires a finite score');
    }
    if (!Array.isArray(evaluation.vetoes)
      || !evaluation.features
      || typeof evaluation.features !== 'object') {
      throw new Error('decision evaluation requires vetoes and features');
    }
  }
  const serialized = JSON.stringify(value);
  for (const forbidden of ['affiliation_string', 'display_name', 'organization_name', 'query']) {
    if (serialized.includes(`"${forbidden}"`)) {
      throw new Error(`decision must not expose ${forbidden}`);
    }
  }
  if (!value.provenance || value.provenance.resolver_version !== RESOLVER_VERSION) {
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
      resolver_version: RESOLVER_VERSION,
      input_hash: decisionInputHash(input),
    },
  });
}

function parentIds(candidate) {
  return new Set((candidate.relationships || [])
    .filter((relationship) => relationship.type === 'parent')
    .map((relationship) => relationship.ror_id));
}

function inferredTypeConflict(candidate, text) {
  const normalized = normalizeText(text);
  const types = new Set(candidate.types || []);
  if (/\b(hospital|health|medical center)\b/.test(normalized)) {
    return !types.has('healthcare') && !types.has('education');
  }
  if (/\b(laboratory|lab)\b/.test(normalized)) {
    return !types.has('facility') && !types.has('education') && !types.has('nonprofit');
  }
  if (/\b(university|college|school)\b/.test(normalized)) return !types.has('education');
  return false;
}

function predecessorSignal(candidate, allCandidates, input) {
  return allCandidates.some((predecessor) => (
    predecessor.status !== 'active'
    && predecessor.relationships?.some((relationship) => (
      relationship.type === 'successor' && relationship.ror_id === candidate.ror_id
    ))
    && (() => {
      const signals = candidateSignals(predecessor, input);
      return signals.exact_name || signals.name_phrase || signals.acronym;
    })()
  ));
}

function explicitLocationConflict(candidate, input, features) {
  if (features.successor_from_predecessor) return false;
  const parts = String(input.affiliation_string || '')
    .split(',')
    .map((part) => normalizeText(part))
    .filter(Boolean);
  if (parts.length < 2) return false;
  const candidateNames = (candidate.names || []).map((name) => normalizeText(name.value));
  const possibleLocations = parts.filter((part) => {
    if (LOCATION_NOISE.has(part) || /\d/.test(part)) return false;
    if (/\b(department|dept|division|faculty|program|school|university|college|institute|hospital|laboratory|lab|center|centre)\b/.test(part)) {
      return false;
    }
    if (candidateNames.some((name) => name === part || containsPhrase(name, part))) return false;
    return part.split(' ').length <= 4;
  });
  if (!possibleLocations.length) return false;
  const cities = [
    ...(candidate.locations || []).map((location) => normalizeText(location.city)).filter(Boolean),
    ...localityAliases(candidate).map(normalizeText),
  ];
  return !possibleLocations.some((location) => (
    cities.some((city) => containsPhrase(city, location) || containsPhrase(location, city))
  ));
}

function scoreCandidate(candidate, allCandidates, input) {
  const features = candidateSignals(candidate, input);
  features.successor_from_predecessor = predecessorSignal(candidate, allCandidates, input);
  features.explicit_location_conflict = explicitLocationConflict(candidate, input, features);
  features.parent_acronym_scope = parentAcronymScope(candidate, input);
  const normalizedInput = normalizeText(input.affiliation_string);
  features.system_scope = /\b(system|office of the president)\b/.test(normalizedInput)
    && parentIds(candidate).size === 0
    && (candidate.names || []).some((name) => {
      const normalizedName = normalizeText(name.value);
      if (!normalizedName.endsWith(' system')) return false;
      const baseName = normalizedName.replace(/\s+system$/, '');
      return baseName.split(' ').length >= 2 && containsPhrase(normalizedInput, baseName);
    });

  let score = 0;
  if (features.exact_name) score = 200;
  else if (features.name_phrase) score = 100 + Math.min(70, features.matched_name_tokens * 10);
  else if (features.acronym) score = 130;
  else if (features.generic_suffix_completion) score = 160;
  else if (features.name_prefix) score = 150 - Math.min(30, features.name_prefix_extra_tokens * 5);
  if (features.successor_from_predecessor) score = Math.max(score, 180);
  if (features.system_scope) score = Math.max(score, 180);
  if (features.parent_acronym_scope && features.acronym) score += 15;
  if (features.domain_match) score += 40;
  if (features.city_match) score += 10;
  if (features.country_match) score += 5;
  if (candidate.status === 'active') score += 5;

  const vetoes = [];
  const domains = input.domain_evidence == null
    ? []
    : Array.isArray(input.domain_evidence) ? input.domain_evidence : [input.domain_evidence];
  if (domains.length && !features.domain_match) vetoes.push('domain_conflict');
  if (input.country_code && !features.country_match) vetoes.push('country_conflict');
  if (features.explicit_location_conflict) vetoes.push('location_conflict');
  if (candidate.status && candidate.status !== 'active') {
    vetoes.push('inactive_without_canonicalization');
  }
  if (inferredTypeConflict(candidate, input.affiliation_string) && !features.exact_name) {
    vetoes.push('type_conflict');
  }
  return { ror_id: candidate.ror_id, score, vetoes, features, candidate };
}

function siblingConflict(evaluations) {
  for (let leftIndex = 0; leftIndex < evaluations.length; leftIndex += 1) {
    const left = evaluations[leftIndex];
    if (!left.candidate.types?.includes('education')) continue;
    const leftParents = parentIds(left.candidate);
    if (!leftParents.size) continue;
    const leftNameSignal = left.features.exact_name
      || left.features.name_phrase
      || left.features.acronym;
    if (!leftNameSignal) continue;
    for (let rightIndex = 0; rightIndex < evaluations.length; rightIndex += 1) {
      if (leftIndex === rightIndex) continue;
      const right = evaluations[rightIndex];
      if (!right.candidate.types?.includes('education')) continue;
      if (![...leftParents].some((parent) => parentIds(right.candidate).has(parent))) continue;
      const independentRightSignal = right.features.acronym
        || right.features.city_match
        || right.features.domain_match
        || right.features.exact_name
        || right.features.name_phrase;
      if (independentRightSignal) return true;
    }
  }
  return false;
}

function canonicalParent(best, candidates, input) {
  if (!/\boffice of the president\b/.test(normalizeText(input.affiliation_string))) return null;
  const parents = [...parentIds(best.candidate)];
  if (parents.length !== 1) return null;
  return candidates.find((candidate) => candidate.ror_id === parents[0]) || null;
}

function isBareParentClaim(input, evaluations) {
  const normalized = normalizeText(input.affiliation_string);
  if (/\b(system|office of the president)\b/.test(normalized)) return false;
  return evaluations.some((evaluation) => {
    if (parentIds(evaluation.candidate).size !== 0) return false;
    return (evaluation.candidate.names || []).some((name) => {
      const normalizedName = normalizeText(name.value);
      if (!normalizedName.endsWith(' system')) return false;
      const candidateName = normalizedName.replace(/\s+system$/, '');
      return candidateName && candidateName === normalized;
    });
  });
}

function decideSingle(input, candidateSet) {
  assertCandidateInput(input);
  assertCandidateSet(candidateSet);
  const candidates = candidateSet.candidates || [];
  if (!candidates.length) {
    return createDecision({
      outcome: 'unresolved', reasons: ['no_candidates'], evaluations: [], input,
    });
  }
  const evaluations = candidates.map((candidate) => scoreCandidate(candidate, candidates, input));
  if (siblingConflict(evaluations)) {
    for (const evaluation of evaluations) evaluation.vetoes.push('sibling_conflict');
    return createDecision({
      outcome: 'review', reasons: ['sibling_conflict'], evaluations, input,
    });
  }
  if (isBareParentClaim(input, evaluations)) {
    return createDecision({
      outcome: 'review', reasons: ['parent_granularity_ambiguous'], evaluations, input,
    });
  }
  const survivors = evaluations
    .filter((evaluation) => evaluation.vetoes.length === 0)
    .sort((left, right) => right.score - left.score || left.ror_id.localeCompare(right.ror_id));
  if (!survivors.length) {
    return createDecision({
      outcome: 'review', reasons: ['all_candidates_vetoed'], evaluations, input,
    });
  }
  const best = survivors[0];
  const margin = best.score - (survivors[1]?.score ?? 0);
  if (best.score < MIN_SCORE || (survivors.length > 1 && margin < MIN_MARGIN)) {
    return createDecision({
      outcome: 'review',
      reasons: [best.score < MIN_SCORE ? 'insufficient_evidence' : 'insufficient_margin'],
      evaluations,
      input,
    });
  }
  const canonicalParentCandidate = canonicalParent(best, candidates, input);
  if (/\boffice of the president\b/.test(normalizeText(input.affiliation_string))
    && parentIds(best.candidate).size > 0 && !canonicalParentCandidate) {
    return createDecision({
      outcome: 'review',
      reasons: ['parent_canonicalization_unavailable'],
      evaluations,
      input,
    });
  }
  const selected = canonicalParentCandidate || best.candidate;
  return createDecision({
    outcome: 'resolved',
    selectedRorIds: [selected.ror_id],
    reasons: [canonicalParentCandidate ? 'parent_scope_canonicalized' : 'unique_scored_candidate'],
    evaluations,
    input,
  });
}

function createInstitutionDecisionResolver({ candidateAdapter }) {
  if (!candidateAdapter?.institutionCandidates) {
    throw new Error('candidateAdapter must export institutionCandidates(input)');
  }

  function beginResolution(signal) {
    return typeof candidateAdapter.beginResolution === 'function'
      ? candidateAdapter.beginResolution({ signal })
      : null;
  }

  async function resolve(input = {}) {
    assertCandidateInput(input);
    const parsed = parseOrganizationSpans(input.affiliation_string);
    if (parsed.issue) {
      return createDecision({
        outcome: 'review', reasons: [parsed.issue], evaluations: [], input,
      });
    }
    if (!parsed.spans.length) {
      return createDecision({
        outcome: 'unresolved', reasons: ['empty_affiliation'], evaluations: [], input,
      });
    }

    const resolutionScope = beginResolution(input.signal);
    const decisions = [];
    for (const span of parsed.spans) {
      const spanInput = { ...input, affiliation_string: span };
      try {
        const options = resolutionScope ? { resolutionScope } : undefined;
        const candidateSet = await candidateAdapter.institutionCandidates(spanInput, options);
        decisions.push(decideSingle(spanInput, candidateSet));
      } catch (error) {
        if (input.signal?.aborted) throw input.signal.reason || error;
        return createDecision({
          outcome: 'review', reasons: ['provider_failure'], evaluations: [], input,
        });
      }
    }

    if (decisions.length === 1) return decisions[0];
    const evaluations = decisions.flatMap((decision) => decision.evaluations);
    if (decisions.some((decision) => decision.outcome !== 'resolved')) {
      return createDecision({
        outcome: 'review',
        reasons: ['multi_span_partial_or_ambiguous'],
        evaluations,
        input,
      });
    }
    return createDecision({
      outcome: 'resolved',
      selectedRorIds: decisions.flatMap((decision) => decision.selected_ror_ids),
      reasons: ['all_organization_spans_resolved'],
      evaluations,
      input,
    });
  }

  return Object.freeze({ resolve });
}

module.exports = {
  MIN_MARGIN,
  MIN_SCORE,
  RESOLVER_VERSION,
  SCHEMA_VERSION,
  assertDecision,
  createDecision,
  createInstitutionDecisionResolver,
  decideSingle,
  decisionInputHash,
  scoreCandidate,
};
