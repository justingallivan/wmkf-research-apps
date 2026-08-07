'use strict';

const { assertCandidateInput } = require('../v2/candidate-contract');
const { relationshipBetween } = require('../v2/relationship');
const { createDecision } = require('./decision-contract');
const { localityAliases } = require('./location-evidence');
const { parseOrganizationSpans } = require('./organization-parser');
const {
  candidateSignals,
  containsPhrase,
  normalizeText,
  parentAcronymScope,
  STATE_NAMES_BY_CODE,
} = require('./text-evidence');

const MIN_SCORE = 130;
const MIN_MARGIN = 10;
const LOCATION_NOISE = new Set([
  ...Object.keys(STATE_NAMES_BY_CODE).map((value) => normalizeText(value)),
  ...Object.values(STATE_NAMES_BY_CODE).map((value) => normalizeText(value)),
  'canada', 'mexico', 'uk', 'united kingdom', 'united states',
  'united states of america', 'us', 'usa',
]);

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
  if (/\b(university|college|school)\b/.test(normalized)) {
    return !types.has('education');
  }
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
  if (candidate.status && candidate.status !== 'active') vetoes.push('inactive_without_canonicalization');
  if (inferredTypeConflict(candidate, input.affiliation_string)
    && !features.exact_name) vetoes.push('type_conflict');
  return { ror_id: candidate.ror_id, score, vetoes, features, candidate };
}

function siblingConflict(evaluations) {
  for (let leftIndex = 0; leftIndex < evaluations.length; leftIndex += 1) {
    const left = evaluations[leftIndex];
    if (!left.candidate.types?.includes('education')) continue;
    const leftParents = parentIds(left.candidate);
    if (!leftParents.size) continue;
    const leftNameSignal = left.features.exact_name || left.features.name_phrase || left.features.acronym;
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
  const candidates = candidateSet.candidates || [];
  if (!candidates.length) {
    return {
      decision: createDecision({
        outcome: 'unresolved', reasons: ['no_candidates'], evaluations: [], input,
      }),
      selectedCandidates: [],
    };
  }
  const evaluations = candidates.map((candidate) => scoreCandidate(candidate, candidates, input));
  if (siblingConflict(evaluations)) {
    for (const evaluation of evaluations) evaluation.vetoes.push('sibling_conflict');
    return {
      decision: createDecision({
        outcome: 'review', reasons: ['sibling_conflict'], evaluations, input,
      }),
      selectedCandidates: [],
    };
  }
  if (isBareParentClaim(input, evaluations)) {
    return {
      decision: createDecision({
        outcome: 'review', reasons: ['parent_granularity_ambiguous'], evaluations, input,
      }),
      selectedCandidates: [],
    };
  }
  const survivors = evaluations
    .filter((evaluation) => evaluation.vetoes.length === 0)
    .sort((left, right) => right.score - left.score || left.ror_id.localeCompare(right.ror_id));
  if (!survivors.length) {
    return {
      decision: createDecision({
        outcome: 'review', reasons: ['all_candidates_vetoed'], evaluations, input,
      }),
      selectedCandidates: [],
    };
  }
  const best = survivors[0];
  const margin = best.score - (survivors[1]?.score ?? 0);
  if (best.score < MIN_SCORE || (survivors.length > 1 && margin < MIN_MARGIN)) {
    return {
      decision: createDecision({
        outcome: 'review',
        reasons: [best.score < MIN_SCORE ? 'insufficient_evidence' : 'insufficient_margin'],
        evaluations,
        input,
      }),
      selectedCandidates: [],
    };
  }
  const canonicalParentCandidate = canonicalParent(best, candidates, input);
  if (/\boffice of the president\b/.test(normalizeText(input.affiliation_string))
    && parentIds(best.candidate).size > 0 && !canonicalParentCandidate) {
    return {
      decision: createDecision({
        outcome: 'review', reasons: ['parent_canonicalization_unavailable'], evaluations, input,
      }),
      selectedCandidates: [],
    };
  }
  const selected = canonicalParentCandidate || best.candidate;
  return {
    decision: createDecision({
      outcome: 'resolved',
      selectedRorIds: [selected.ror_id],
      reasons: [canonicalParentCandidate ? 'parent_scope_canonicalized' : 'unique_scored_candidate'],
      evaluations,
      input,
    }),
    selectedCandidates: [selected],
  };
}

function relatedNameCompatible(left, right) {
  return (left.names || []).some((leftName) => (
    (right.names || []).some((rightName) => {
      const a = normalizeText(leftName.value);
      const b = normalizeText(rightName.value);
      if (a.split(' ').length < 2 || b.split(' ').length < 2) return false;
      return containsPhrase(a, b) || containsPhrase(b, a);
    })
  ));
}

function createInstitutionDecisionResolver({ candidateAdapter }) {
  if (!candidateAdapter?.institutionCandidates) {
    throw new Error('candidateAdapter must export institutionCandidates(input)');
  }

  async function resolveDetailed(input = {}) {
    assertCandidateInput(input);
    const parsed = parseOrganizationSpans(input.affiliation_string);
    if (parsed.issue) {
      return {
        decision: createDecision({
          outcome: 'review', reasons: [parsed.issue], evaluations: [], input,
        }),
        selectedCandidates: [],
      };
    }
    const spans = parsed.spans;
    if (!spans.length) {
      return {
        decision: createDecision({
          outcome: 'unresolved', reasons: ['empty_affiliation'], evaluations: [], input,
        }),
        selectedCandidates: [],
      };
    }
    const settled = [];
    for (const span of spans) {
      const spanInput = { ...input, affiliation_string: span };
      try {
        const candidateSet = await candidateAdapter.institutionCandidates(spanInput);
        settled.push(decideSingle(spanInput, candidateSet));
      } catch (error) {
        if (input.signal?.aborted) throw input.signal.reason || error;
        return {
          decision: createDecision({
            outcome: 'review', reasons: ['provider_failure'], evaluations: [], input,
          }),
          selectedCandidates: [],
        };
      }
    }
    const evaluations = settled.flatMap((entry) => entry.decision.evaluations);
    const selectedCandidates = [...new Map(settled
      .flatMap((entry) => entry.selectedCandidates)
      .map((candidate) => [candidate.ror_id, candidate])).values()];
    const selectedIds = [...new Set(selectedCandidates.map((candidate) => candidate.ror_id))];
    if (spans.length === 1) return settled[0];
    if (settled.some((entry) => entry.decision.outcome !== 'resolved')) {
      return {
        decision: createDecision({
          outcome: 'review', reasons: ['multi_span_partial_or_ambiguous'], evaluations, input,
        }),
        selectedCandidates: [],
      };
    }
    return {
      decision: createDecision({
        outcome: 'resolved',
        selectedRorIds: selectedIds,
        reasons: [spans.length > 1 ? 'all_organization_spans_resolved' : 'unique_scored_candidate'],
        evaluations,
        input,
      }),
      selectedCandidates,
    };
  }

  async function resolve(input = {}) {
    return (await resolveDetailed(input)).decision;
  }

  async function compare({ listed, evidence, signal } = {}) {
    const left = await resolveDetailed({ affiliation_string: listed, signal });
    const right = await resolveDetailed({ affiliation_string: evidence, signal });
    if (left.decision.outcome !== 'resolved' || right.decision.outcome !== 'resolved'
      || left.selectedCandidates.length !== 1 || right.selectedCandidates.length !== 1) {
      return {
        outcome: 'review',
        relation: null,
        left_ror_ids: left.decision.selected_ror_ids,
        right_ror_ids: right.decision.selected_ror_ids,
        reasons: ['operand_unresolved_or_multi_org'],
        left: left.decision,
        right: right.decision,
      };
    }
    const leftCandidate = left.selectedCandidates[0];
    const rightCandidate = right.selectedCandidates[0];
    const relation = relationshipBetween(leftCandidate, rightCandidate);
    const consistent = relation === 'same'
      || (relation === 'related' && relatedNameCompatible(leftCandidate, rightCandidate));
    return {
      outcome: consistent ? 'resolved' : 'review',
      relation,
      left_ror_ids: [leftCandidate.ror_id],
      right_ror_ids: [rightCandidate.ror_id],
      reasons: [consistent ? 'policy_consistent' : 'policy_requires_review'],
      left: left.decision,
      right: right.decision,
    };
  }

  return Object.freeze({ compare, resolve });
}

module.exports = {
  MIN_MARGIN,
  MIN_SCORE,
  createInstitutionDecisionResolver,
  decideSingle,
  relatedNameCompatible,
  scoreCandidate,
};
