/**
 * DiscoveryService name-matching cluster — Stage 1 of the DiscoveryService decomposition
 * (docs/DISCOVERY_SERVICE_DECOMPOSITION_PLAN.md).
 *
 * Author-name normalization, nickname-aware forename equivalence, PubMed name-variant
 * generation, and the byline-matching predicates used to confirm a suggested reviewer
 * against retrieved article authors. Extracted VERBATIM from discovery-service.js as a
 * behavior-freeze — internal `this.X` self-calls became direct function calls; `NICKNAME_MAP`
 * now comes from ./constants. The DiscoveryService facade delegates each method to the
 * functions here, so `DiscoveryService.<method>` call sites keep working unchanged.
 *
 * Pure leaf cluster: depends only on ./constants (no other discovery module, no external service).
 * Characterization net: tests/unit/discovery-name-matching.test.js.
 */

const { NICKNAME_MAP } = require('./constants');

/** Normalize a name for matching (lowercase, remove titles, collapse whitespace). */
function normalizeNameForMatch(name) {
  if (!name) return '';
  return name
    .toLowerCase()
    .replace(/^(dr\.?|prof\.?|professor)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Two forenames are equivalent if equal (case-insensitive) or nickname-map linked either way. */
function firstNamesEquivalent(first1, first2) {
  if (!first1 || !first2) return false;
  const f1 = first1.toLowerCase();
  const f2 = first2.toLowerCase();
  if (f1 === f2) return true;
  return NICKNAME_MAP[f1]?.toLowerCase() === f2
    || NICKNAME_MAP[f2]?.toLowerCase() === f1;
}

/** Generate search name variants: full, nickname-expanded, and "initial + surname". */
function generateNameVariants(name) {
  const cleanName = name
    .replace(/^(Dr\.?|Prof\.?|Professor)\s+/i, '')
    .trim();

  const parts = cleanName.split(' ');
  if (parts.length < 2) return [cleanName];

  const firstName = parts[0];
  const restOfName = parts.slice(1).join(' ');
  const variants = [cleanName];

  // Try full name if we have a nickname
  const lowerFirst = firstName.toLowerCase();
  if (NICKNAME_MAP[lowerFirst]) {
    variants.push(`${NICKNAME_MAP[lowerFirst]} ${restOfName}`);
  }

  // Try initial + last name (common in PubMed)
  if (firstName.length > 1) {
    variants.push(`${firstName[0]} ${restOfName}`);
  }

  return variants;
}

/** Structured evidence for whether two names refer to the same person (surname + forename logic). */
function nameMatchEvidence(name1, name2) {
  const normalized1 = normalizeNameForMatch(name1);
  const normalized2 = normalizeNameForMatch(name2);
  if (!normalized1 || !normalized2) {
    return { matches: false, fullForenameMatch: false, initialOnly: false, reason: 'Missing name' };
  }

  const parts1 = normalized1.split(' ');
  const parts2 = normalized2.split(' ');
  const lastName1 = parts1[parts1.length - 1];
  const lastName2 = parts2[parts2.length - 1];
  if (lastName1 !== lastName2) {
    return { matches: false, fullForenameMatch: false, initialOnly: false, reason: 'Surnames differ' };
  }

  const first1 = parts1[0] || '';
  const first2 = parts2[0] || '';
  const first1IsInitial = first1.length <= 2;
  const first2IsInitial = first2.length <= 2;

  if (!first1IsInitial && !first2IsInitial && firstNamesEquivalent(first1, first2)) {
    return {
      matches: true,
      fullForenameMatch: true,
      initialOnly: false,
      matchedAuthorName: normalized2,
      reason: 'Full forename and surname matched',
    };
  }

  if (first1IsInitial && first2.toLowerCase().startsWith(first1.toLowerCase())) {
    return {
      matches: true,
      fullForenameMatch: false,
      initialOnly: true,
      matchedAuthorName: normalized2,
      reason: 'Only first initial matched the returned author forename',
    };
  }
  if (first2IsInitial && first1.toLowerCase().startsWith(first2.toLowerCase())) {
    return {
      matches: true,
      fullForenameMatch: false,
      initialOnly: true,
      matchedAuthorName: normalized2,
      reason: 'Returned author only provided a first initial',
    };
  }

  const firstInitial1 = first1[0]?.toLowerCase();
  const firstInitial2 = first2[0]?.toLowerCase();
  if (firstInitial1 && firstInitial2 && firstInitial1 === firstInitial2) {
    if ((parts1.length === 3 && parts2.length === 2) || (parts2.length === 3 && parts1.length === 2)) {
      return {
        matches: true,
        fullForenameMatch: false,
        initialOnly: true,
        matchedAuthorName: normalized2,
        reason: 'Only initials matched between author strings',
      };
    }
  }

  return {
    matches: false,
    fullForenameMatch: false,
    initialOnly: false,
    reason: 'Full forenames differ',
  };
}

/** Boolean name-match; `allowInitialOnly:false` rejects initial-only evidence. */
function namesMatch(name1, name2, options = {}) {
  const { allowInitialOnly = true } = options;
  const evidence = nameMatchEvidence(name1, name2);
  if (!evidence.matches) return false;
  return allowInitialOnly || !evidence.initialOnly;
}

/** Keep articles whose author byline contains the target name. */
function filterToMatchingAuthor(articles, targetName) {
  if (!articles || !targetName) return [];

  const normalizedTarget = normalizeNameForMatch(targetName);

  return articles.filter(article => {
    if (!article.authors) return false;

    // Check if the target author is in this article's author list
    return article.authors.some(author => {
      const normalizedAuthor = normalizeNameForMatch(author.name);
      return namesMatch(normalizedTarget, normalizedAuthor);
    });
  });
}

/** Keep articles where ANY of the supplied name variants matches an author. */
function filterToMatchingAuthorMultiVariant(articles, nameVariants) {
  if (!articles || !nameVariants || nameVariants.length === 0) return [];

  const normalizedVariants = nameVariants.map(v => normalizeNameForMatch(v));

  return articles.filter(article => {
    if (!article.authors) return false;

    return article.authors.some(author => {
      const normalizedAuthor = normalizeNameForMatch(author.name);
      // Match if ANY variant matches this author
      return normalizedVariants.some(variant =>
        namesMatch(variant, normalizedAuthor)
      );
    });
  });
}

/** Aggregate byline evidence for a suggested name across a set of articles. */
function evaluateNameEvidence(suggestedName, articles) {
  const evidence = {
    suggestedName: normalizeNameForMatch(suggestedName),
    hasFullForenameMatch: false,
    hasInitialOnlyMatch: false,
    matchedAuthorName: null,
    reason: 'No matching author byline found',
  };

  for (const article of articles || []) {
    for (const author of article.authors || []) {
      const match = nameMatchEvidence(suggestedName, author.name);
      if (!match.matches) continue;
      if (match.fullForenameMatch) {
        return {
          ...evidence,
          hasFullForenameMatch: true,
          hasInitialOnlyMatch: false,
          matchedAuthorName: match.matchedAuthorName || normalizeNameForMatch(author.name),
          reason: match.reason,
        };
      }
      if (match.initialOnly) {
        evidence.hasInitialOnlyMatch = true;
        evidence.matchedAuthorName = evidence.matchedAuthorName || match.matchedAuthorName || normalizeNameForMatch(author.name);
        evidence.reason = match.reason;
      }
    }
  }

  if (!evidence.hasInitialOnlyMatch) {
    evidence.reason = 'No returned author full forename matches the suggested full forename';
  }
  return evidence;
}

module.exports = {
  normalizeNameForMatch,
  firstNamesEquivalent,
  generateNameVariants,
  nameMatchEvidence,
  namesMatch,
  filterToMatchingAuthor,
  filterToMatchingAuthorMultiVariant,
  evaluateNameEvidence,
};
