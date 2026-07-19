const {
  generateNameVariants,
  nameMatchEvidence,
} = require('../../lib/services/discovery/name-matching');

const HIGH_FRAGMENTATION_CANDIDATE_COUNT = 10;
const VALID_DECISIONS = new Set(['bind', 'review', 'abstain']);
const VALID_OUTCOMES = new Set([
  'correct_bind',
  'false_bind',
  'right_person_policy_bind',
  'miss',
  'correct_abstain',
]);

function shortOpenAlexAuthorId(value) {
  const match = String(value || '').match(/A\d+/i);
  return match ? match[0].toUpperCase() : null;
}

function shortOpenAlexInstitutionId(value) {
  const match = String(value || '').match(/I\d+/i);
  return match ? match[0].toUpperCase() : null;
}

function normalizeOrcid(value) {
  const match = String(value || '').match(/\d{4}-\d{4}-\d{4}-[\dX]{4}/i);
  return match ? match[0].toUpperCase() : null;
}

function stripHonorific(value) {
  return String(value || '').replace(/^(dr\.?|prof\.?|professor)\s+/i, '').trim();
}

function comparableName(value) {
  return stripHonorific(value)
    .normalize('NFKC')
    .replace(/[‐‑‒–—]/g, '-')
    .replace(/\./g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function worksFirstNameVariants(name) {
  const clean = stripHonorific(name);
  const base = generateNameVariants(clean).filter((variant) => {
    const parts = variant.split(/\s+/);
    return parts.length >= 2 && parts[0].length > 1;
  });
  const parts = clean.split(/\s+/);
  if (parts.length === 2) base.push(`${parts[1]} ${parts[0]}`);
  return Array.from(new Set(base));
}

function nameConsistent(candidateName, returnedName) {
  if (!returnedName) return null;
  const candidate = comparableName(candidateName);
  const returned = comparableName(returnedName);
  const direct = nameMatchEvidence(candidate, returned);
  if (direct.matches) return direct;
  const parts = candidate.split(/\s+/);
  if (parts.length !== 2) return null;
  const reversed = nameMatchEvidence(`${parts[1]} ${parts[0]}`, returned);
  return reversed.matches ? reversed : null;
}

function candidateUsesInitialOnly(name) {
  const first = stripHonorific(name).split(/\s+/)[0] || '';
  return first.replace(/\./g, '').length <= 1;
}

function createCandidate(authorId) {
  return {
    authorId,
    orcids: new Set(),
    bylineCount: 0,
    institutionIds: new Set(),
    displayNames: new Set(),
    profile: null,
  };
}

function collectBylineCandidates(candidateName, works = []) {
  const byAuthorId = new Map();
  for (const work of works) {
    for (const authorship of Array.isArray(work?.authorships) ? work.authorships : []) {
      if (!nameConsistent(candidateName, authorship?.raw_author_name)) continue;
      const authorId = shortOpenAlexAuthorId(authorship?.author?.id);
      if (!authorId) continue;
      const entry = byAuthorId.get(authorId) || createCandidate(authorId);
      entry.bylineCount += 1;
      const orcid = normalizeOrcid(authorship?.author?.orcid);
      if (orcid) entry.orcids.add(orcid);
      if (authorship?.author?.display_name) {
        entry.displayNames.add(authorship.author.display_name);
      }
      for (const institution of Array.isArray(authorship?.institutions)
        ? authorship.institutions
        : []) {
        const institutionId = shortOpenAlexInstitutionId(institution?.id);
        if (institutionId) entry.institutionIds.add(institutionId);
      }
      byAuthorId.set(authorId, entry);
    }
  }
  return byAuthorId;
}

function mergeProfile(entry, profile) {
  if (!profile) return entry;
  entry.profile = profile;
  const orcid = normalizeOrcid(profile.orcid);
  if (orcid) entry.orcids.add(orcid);
  if (profile.displayName) entry.displayNames.add(profile.displayName);
  const institutionId = shortOpenAlexInstitutionId(profile.lastKnownInstitutionId);
  if (institutionId) entry.institutionIds.add(institutionId);
  return entry;
}

function stableClusterSort(left, right) {
  const leftWorks = Number(left.profile?.worksCount || 0);
  const rightWorks = Number(right.profile?.worksCount || 0);
  return (rightWorks - leftWorks)
    || (right.bylineCount - left.bylineCount)
    || left.authorId.localeCompare(right.authorId);
}

function selectedAnchor(entry) {
  const orcids = Array.from(entry.orcids).sort();
  if (orcids.length !== 1) return null;
  return `orcid:${orcids[0]}`;
}

function publicCandidate(entry, claimedInstitutionId) {
  return {
    authorId: entry.authorId,
    orcids: Array.from(entry.orcids).sort(),
    bylineCount: entry.bylineCount,
    institutionMatched: Boolean(
      claimedInstitutionId && entry.institutionIds.has(claimedInstitutionId),
    ),
    worksCount: Number(entry.profile?.worksCount || 0),
    displayNames: Array.from(entry.displayNames).sort(),
  };
}

async function resolveWorksFirst(candidate, {
  searchWorks,
  searchInstitution,
  getAuthor,
  maxVariants = 3,
  highFragmentationCandidateCount = HIGH_FRAGMENTATION_CANDIDATE_COUNT,
} = {}) {
  if (typeof searchWorks !== 'function'
    || typeof searchInstitution !== 'function'
    || typeof getAuthor !== 'function') {
    throw new TypeError('resolveWorksFirst requires searchWorks, searchInstitution, and getAuthor');
  }

  const works = [];
  const variants = worksFirstNameVariants(candidate?.name).slice(0, maxVariants);
  for (const variant of variants) {
    const result = await searchWorks(variant);
    works.push(...(Array.isArray(result) ? result : []));
  }

  const collected = collectBylineCandidates(candidate?.name, works);
  let plausible = Array.from(collected.values()).filter((entry) =>
    Array.from(entry.displayNames).some((displayName) =>
      nameConsistent(candidate?.name, displayName)));

  if (plausible.length === 0) {
    return {
      decision: 'abstain',
      anchor: null,
      reason: collected.size ? 'canonical_name_contradiction' : 'no_byline_match',
      candidateCount: 0,
      candidates: [],
    };
  }

  let claimedInstitutionId = null;
  if (candidate?.claimedAffiliation) {
    const institutions = await searchInstitution(candidate.claimedAffiliation);
    claimedInstitutionId = shortOpenAlexInstitutionId(institutions?.[0]?.openAlexId);
  }

  if (!claimedInstitutionId) {
    return {
      decision: 'review',
      anchor: null,
      reason: 'claimed_institution_unresolved',
      candidateCount: plausible.length,
      candidates: plausible.map((entry) => publicCandidate(entry, null)),
    };
  }

  let institutionMatched = plausible.filter((entry) =>
    entry.institutionIds.has(claimedInstitutionId));
  if (institutionMatched.length === 0) {
    return {
      decision: 'abstain',
      anchor: null,
      reason: 'no_institution_corroborated_byline',
      candidateCount: plausible.length,
      candidates: plausible.map((entry) => publicCandidate(entry, claimedInstitutionId)),
    };
  }

  for (const entry of institutionMatched) {
    try {
      mergeProfile(entry, await getAuthor(entry.authorId));
    } catch {
      return {
        decision: 'review',
        anchor: null,
        reason: 'author_profile_fetch_failed',
        candidateCount: plausible.length,
        candidates: plausible.map((item) => publicCandidate(item, claimedInstitutionId)),
      };
    }
  }

  // Same-ORCID OpenAlex fragments are one person. Prefer the richest profile so a
  // sparse split never displaces the useful cluster.
  const byOrcid = new Map();
  for (const entry of institutionMatched) {
    for (const orcid of entry.orcids) {
      if (!byOrcid.has(orcid)) byOrcid.set(orcid, []);
      byOrcid.get(orcid).push(entry);
    }
  }

  const observedOrcids = Array.from(new Set(
    plausible.flatMap((entry) => Array.from(entry.orcids)),
  )).sort();
  if (observedOrcids.length > 1) {
    return {
      decision: 'review',
      anchor: null,
      reason: 'multiple_distinct_orcid_clusters',
      candidateCount: plausible.length,
      observedOrcids,
      candidates: plausible.map((entry) => publicCandidate(entry, claimedInstitutionId)),
    };
  }

  if (byOrcid.size === 0) {
    return {
      decision: 'review',
      anchor: null,
      reason: 'no_orcid_anchor',
      candidateCount: plausible.length,
      candidates: plausible.map((entry) => publicCandidate(entry, claimedInstitutionId)),
    };
  }

  const anchoredEntries = Array.from(byOrcid.values()).flat();
  anchoredEntries.sort(stableClusterSort);
  const selected = anchoredEntries[0];
  const anchor = selectedAnchor(selected);
  if (!anchor) {
    return {
      decision: 'review',
      anchor: null,
      reason: 'ambiguous_selected_anchor',
      candidateCount: plausible.length,
      candidates: plausible.map((entry) => publicCandidate(entry, claimedInstitutionId)),
    };
  }

  if (plausible.length >= highFragmentationCandidateCount) {
    return {
      decision: 'review',
      anchor,
      reason: 'high_name_fragmentation',
      candidateCount: plausible.length,
      candidates: plausible.map((entry) => publicCandidate(entry, claimedInstitutionId)),
    };
  }

  return {
    decision: 'bind',
    anchor,
    reason: institutionMatched.length > 1
      ? 'orcid_richest_institution_cluster'
      : 'unique_orcid_institution_cluster',
    candidateCount: plausible.length,
    observedOrcids,
    candidates: plausible.map((entry) => publicCandidate(entry, claimedInstitutionId)),
  };
}

function normalizeDecision(result) {
  const decision = result?.decision || (result?.bind ? 'bind' : 'abstain');
  if (!VALID_DECISIONS.has(decision)) {
    return { decision: 'review', anchor: null, reason: 'invalid_resolver_decision' };
  }
  if (decision === 'bind' && !result?.anchor) {
    return { decision: 'review', anchor: null, reason: 'bind_without_anchor' };
  }
  return { ...result, decision };
}

function combineIdentityDecisions(candidate, spineResult, worksResult, { anchorsAgree = false } = {}) {
  const spine = normalizeDecision(spineResult);
  const works = normalizeDecision(worksResult);

  if (spine.decision === 'bind') {
    if (works.decision === 'bind') {
      if (!anchorsAgree) {
        return {
          decision: 'review',
          anchor: null,
          reason: 'resolver_anchor_disagreement',
          spine,
          works,
        };
      }
      return {
        decision: 'bind',
        anchor: spine.anchor,
        reason: 'spine_works_consensus',
        spine,
        works,
      };
    }
    if (candidateUsesInitialOnly(candidate?.name)) {
      return {
        decision: 'review',
        anchor: works.anchor || null,
        reason: 'initial_only_not_works_corroborated',
        spine,
        works,
      };
    }
    return {
      decision: 'bind',
      anchor: spine.anchor,
      reason: 'spine_retained_without_works_contradiction',
      spine,
      works,
    };
  }

  if (works.decision === 'bind') {
    return {
      decision: 'bind',
      anchor: works.anchor,
      reason: 'works_rescue',
      spine,
      works,
    };
  }
  return {
    decision: works.decision,
    anchor: works.anchor || null,
    reason: works.reason,
    spine,
    works,
  };
}

async function scoreDecision(expected, result, anchorsMatch, {
  rightPersonPolicyMatch = false,
} = {}) {
  const resolved = normalizeDecision(result);
  const expectedBind = expected?.abstain === false;
  if (resolved.decision === 'bind') {
    if (!expectedBind) {
      return rightPersonPolicyMatch ? 'right_person_policy_bind' : 'false_bind';
    }
    return await anchorsMatch(expected.personAnchor, resolved.anchor)
      ? 'correct_bind'
      : 'false_bind';
  }
  return expectedBind ? 'miss' : 'correct_abstain';
}

function tally(rows, arm) {
  const counts = {
    correct_bind: 0,
    false_bind: 0,
    right_person_policy_bind: 0,
    miss: 0,
    correct_abstain: 0,
    review: 0,
  };
  for (const row of rows) {
    const outcome = row?.[arm]?.outcome;
    if (!VALID_OUTCOMES.has(outcome)) {
      throw new Error(`Unknown ${arm} outcome for ${row?.caseId || 'unknown case'}`);
    }
    counts[outcome] += 1;
    if (row[arm].decision === 'review') counts.review += 1;
  }
  return counts;
}

function evaluatePromotion(rows, {
  minimumCorrectBindGain = 3,
  maximumFalseBinds = 0,
  maximumMisses = 8,
} = {}) {
  const spine = tally(rows, 'spine');
  const combined = tally(rows, 'combined');
  const gates = {
    correctBindGain: {
      actual: combined.correct_bind - spine.correct_bind,
      required: minimumCorrectBindGain,
      pass: combined.correct_bind - spine.correct_bind >= minimumCorrectBindGain,
    },
    falseBinds: {
      actual: combined.false_bind,
      maximum: maximumFalseBinds,
      pass: combined.false_bind <= maximumFalseBinds,
    },
    rightPersonPolicyBinds: {
      actual: combined.right_person_policy_bind,
      maximum: spine.right_person_policy_bind,
      pass: combined.right_person_policy_bind <= spine.right_person_policy_bind,
    },
    misses: {
      actual: combined.miss,
      maximum: maximumMisses,
      pass: combined.miss <= maximumMisses,
    },
  };
  return {
    pass: Object.values(gates).every((gate) => gate.pass),
    gates,
    spine,
    combined,
  };
}

function changedCases(rows) {
  return rows.filter((row) =>
    row.spine.outcome !== row.combined.outcome
    || (
      row.spine.decision === 'bind'
      && row.combined.decision === 'bind'
      && row.spine.anchor !== row.combined.anchor
    ));
}

module.exports = {
  HIGH_FRAGMENTATION_CANDIDATE_COUNT,
  candidateUsesInitialOnly,
  changedCases,
  collectBylineCandidates,
  combineIdentityDecisions,
  evaluatePromotion,
  nameConsistent,
  normalizeOrcid,
  resolveWorksFirst,
  scoreDecision,
  shortOpenAlexAuthorId,
  shortOpenAlexInstitutionId,
  worksFirstNameVariants,
};
