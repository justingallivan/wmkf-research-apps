/**
 * DiscoveryService match-signals cluster — Stage 3 of the DiscoveryService decomposition
 * (docs/DISCOVERY_SERVICE_DECOMPOSITION_PLAN.md).
 *
 * Pure scoring/relevance predicates used during Track-A verification: filter articles to those
 * topically relevant to an author's claimed expertise, score expertise-match confidence,
 * detect an institution mismatch between the PubMed-verified affiliation and Claude's claimed
 * institution (with a large alias table), and detect an expertise mismatch. Extracted VERBATIM
 * from discovery-service.js as a behavior-freeze — these methods had no `this.X` self-calls, no
 * constants, and no external services, so the bodies are unchanged. The facade delegates each.
 *
 * Pure leaf cluster: no dependencies. Characterization net:
 * tests/unit/discovery-match-signals.test.js.
 */

/** Filter articles to those whose title/abstract contains an expertise keyword (len > 3). */
function filterByExpertiseRelevance(articles, expertiseAreas) {
  if (!expertiseAreas || !Array.isArray(expertiseAreas) || expertiseAreas.length === 0) {
    return articles;
  }

  // Extract keywords from expertise areas
  const keywords = expertiseAreas
    .flatMap(area => area.toLowerCase().split(/[\s,]+/))
    .filter(word => word.length > 3); // Ignore short words

  if (keywords.length === 0) {
    return articles;
  }

  return articles.filter(article => {
    const searchText = `${article.title || ''} ${article.abstract || ''}`.toLowerCase();
    // Article must match at least one keyword
    return keywords.some(keyword => searchText.includes(keyword));
  });
}

/**
 * Calculate how well the found articles match the expected expertise
 * Returns a confidence score from 0 to 1
 *
 * More lenient matching for scientific terminology:
 * - Accepts single significant keyword matches
 * - Expands common scientific synonyms
 * - Gives partial credit for related terms
 */
function calculateExpertiseMatch(articles, expertiseAreas) {
  if (!expertiseAreas || !Array.isArray(expertiseAreas) || expertiseAreas.length === 0) {
    return 0.5; // Unknown confidence - benefit of the doubt
  }

  if (articles.length === 0) {
    return 0;
  }

  // Common scientific synonyms to expand matching
  const synonyms = {
    'viral': ['virus', 'virology', 'viruses', 'phage', 'bacteriophage'],
    'virus': ['viral', 'virology', 'viruses', 'phage'],
    'virology': ['viral', 'virus', 'viruses'],
    'ecology': ['ecological', 'ecosystem', 'ecological'],
    'ecological': ['ecology', 'ecosystem'],
    'marine': ['ocean', 'oceanic', 'aquatic', 'sea'],
    'ocean': ['marine', 'oceanic', 'aquatic', 'sea'],
    'microbial': ['microbe', 'microbiome', 'bacterial', 'bacteria'],
    'microbe': ['microbial', 'microbiome', 'bacterial'],
    'bacteria': ['bacterial', 'microbial', 'microbe'],
    'bacterial': ['bacteria', 'microbial', 'microbe'],
    'evolution': ['evolutionary', 'evolve', 'evolved'],
    'evolutionary': ['evolution', 'evolve'],
    'phage': ['bacteriophage', 'viral', 'virus'],
    'bacteriophage': ['phage', 'viral', 'virus'],
    'population': ['populations', 'community', 'communities'],
    'community': ['communities', 'population', 'populations'],
    'dynamics': ['dynamic', 'interactions', 'interaction'],
    'modeling': ['model', 'models', 'mathematical', 'computational'],
    'model': ['modeling', 'models', 'mathematical'],
    'quantitative': ['mathematical', 'computational', 'modeling']
  };

  // Extract all unique keywords from expertise areas (with synonyms)
  const allKeywords = new Set();
  for (const area of expertiseAreas) {
    const words = area.toLowerCase().split(/[\s,]+/).filter(w => w.length > 3);
    for (const word of words) {
      allKeywords.add(word);
      // Add synonyms
      if (synonyms[word]) {
        synonyms[word].forEach(syn => allKeywords.add(syn));
      }
    }
  }

  const keywordArray = Array.from(allKeywords);

  // Count articles that match ANY keyword (more lenient)
  let matchingArticles = 0;
  let totalKeywordMatches = 0;

  for (const article of articles) {
    const searchText = `${article.title || ''} ${article.abstract || ''}`.toLowerCase();
    const matchedKeywords = keywordArray.filter(kw => searchText.includes(kw));

    if (matchedKeywords.length > 0) {
      matchingArticles++;
      totalKeywordMatches += matchedKeywords.length;
    }
  }

  // Calculate confidence:
  // - Base: percentage of articles with at least one keyword match
  // - Bonus: average keyword matches per article (capped at +20%)
  const baseConfidence = matchingArticles / articles.length;
  const avgMatches = totalKeywordMatches / articles.length;
  const bonus = Math.min(0.2, avgMatches * 0.05); // 5% per avg match, max 20% bonus

  const confidence = Math.min(1, baseConfidence + bonus);
  return Math.round(confidence * 100) / 100;
}

/**
 * Check if the verified affiliation matches Claude's suggested institution
 * Returns true if there's a mismatch (potential wrong person)
 */
function checkInstitutionMismatch(verifiedAffiliation, suggestedInstitution) {
  if (!verifiedAffiliation || !suggestedInstitution) {
    return false; // Can't check without both
  }

  const verifiedLower = verifiedAffiliation.toLowerCase();
  const suggestedLower = suggestedInstitution.toLowerCase();

  // Simple check first: does the suggested institution appear anywhere in the full affiliation?
  // This handles cases like "Department of X, University of Michigan" matching "University of Michigan"
  if (verifiedLower.includes(suggestedLower)) {
    return false; // Match - suggested institution is contained in affiliation
  }

  // Check for common abbreviations and variations
  const institutionAliases = {
    'mit': ['massachusetts institute of technology', 'mit'],
    'caltech': ['california institute of technology', 'caltech'],
    'uc berkeley': ['university of california berkeley', 'uc berkeley', 'ucb', 'berkeley'],
    'ucla': ['university of california los angeles', 'ucla'],
    'ucsf': ['university of california san francisco', 'ucsf'],
    'ucsd': ['university of california san diego', 'ucsd'],
    'ucd': ['university of california davis', 'uc davis', 'ucd'],
    'uci': ['university of california irvine', 'uc irvine', 'uci'],
    'stanford': ['stanford university', 'stanford'],
    'harvard': ['harvard university', 'harvard medical school', 'harvard'],
    'yale': ['yale university', 'yale school of medicine', 'yale'],
    'princeton': ['princeton university', 'princeton'],
    'columbia': ['columbia university', 'columbia'],
    'cornell': ['cornell university', 'weill cornell', 'cornell'],
    'upenn': ['university of pennsylvania', 'upenn', 'penn', 'perelman school'],
    'brandeis': ['brandeis university', 'brandeis'],
    'rockefeller': ['rockefeller university', 'rockefeller'],
    'hhmi': ['howard hughes medical institute', 'hhmi', 'janelia'],
    'nih': ['national institutes of health', 'nih', 'niehs', 'nimh', 'nci'],
    'wustl': ['washington university', 'wustl', 'wash u', 'washington university in st. louis'],
    'umich': ['university of michigan', 'umich', 'u-m', 'michigan'],
    'uw': ['university of washington', 'uw', 'u washington'],
    'wisc': ['university of wisconsin', 'uw-madison', 'wisconsin'],
    'jhu': ['johns hopkins', 'jhu', 'hopkins'],
    'duke': ['duke university', 'duke'],
    'unc': ['university of north carolina', 'unc', 'unc-chapel hill'],
    'emory': ['emory university', 'emory'],
    'vanderbilt': ['vanderbilt university', 'vanderbilt'],
    'northwestern': ['northwestern university', 'northwestern'],
    'uchicago': ['university of chicago', 'uchicago', 'u chicago'],
    'nyu': ['new york university', 'nyu'],
    'bu': ['boston university', 'bu'],
    'bc': ['boston college', 'bc'],
    'pitt': ['university of pittsburgh', 'pitt'],
    'osu': ['ohio state university', 'osu', 'ohio state'],
    'psu': ['penn state', 'pennsylvania state university', 'psu'],
    'msu': ['michigan state university', 'msu', 'michigan state'],
    'uva': ['university of virginia', 'uva'],
    'gt': ['georgia tech', 'georgia institute of technology'],
    'ut austin': ['university of texas at austin', 'ut austin', 'texas'],
    'ucsb': ['university of california santa barbara', 'ucsb'],
    'ucsc': ['university of california santa cruz', 'ucsc'],
    'scripps': ['scripps research', 'scripps institute', 'scripps'],
    'salk': ['salk institute', 'salk'],
    'broad': ['broad institute', 'broad'],
    'whitehead': ['whitehead institute', 'whitehead'],
    'cshl': ['cold spring harbor', 'cshl'],
    'mbl': ['marine biological laboratory', 'mbl', 'woods hole'],
  };

  // Check if both match any common alias
  for (const aliases of Object.values(institutionAliases)) {
    const verifiedMatches = aliases.some(a => verifiedLower.includes(a));
    const suggestedMatches = aliases.some(a => suggestedLower.includes(a));
    if (verifiedMatches && suggestedMatches) {
      return false; // Same institution via alias
    }
  }

  // Extract institution name from full affiliation string
  // Look for patterns like "University of X", "X University", "X Institute", etc.
  const extractInstitution = (text) => {
    const lower = text.toLowerCase();

    // Try to find university/institute patterns anywhere in the text
    const patterns = [
      /university of [\w\s]+/i,
      /[\w\s]+ university/i,
      /[\w\s]+ institute of technology/i,
      /[\w\s]+ institute/i,
      /[\w\s]+ college/i,
      /[\w\s]+ school of medicine/i,
      /[\w\s]+ medical school/i,
      /[\w\s]+ medical center/i,
    ];

    for (const pattern of patterns) {
      const match = lower.match(pattern);
      if (match) {
        return match[0].trim();
      }
    }

    return lower;
  };

  const verifiedInst = extractInstitution(verifiedLower);
  const suggestedInst = extractInstitution(suggestedLower);

  // Check if extracted institutions match
  if (verifiedInst.includes(suggestedInst) || suggestedInst.includes(verifiedInst)) {
    return false; // Match
  }

  // Check for significant word overlap (institution names often share key words)
  const getSignificantWords = (text) => {
    const stopWords = new Set(['of', 'the', 'at', 'in', 'and', 'for', 'school', 'department', 'dept', 'center', 'centre']);
    return text.split(/\s+/)
      .filter(w => w.length > 2 && !stopWords.has(w))
      .map(w => w.replace(/[^a-z]/g, ''));
  };

  const verifiedWords = getSignificantWords(verifiedInst);
  const suggestedWords = getSignificantWords(suggestedInst);
  const commonWords = verifiedWords.filter(w => suggestedWords.includes(w));

  // If they share the key institution word (e.g., "michigan", "stanford"), it's a match
  if (commonWords.length >= 1 && commonWords.some(w => w.length > 4)) {
    return false; // Enough overlap
  }

  // Institutions don't match
  return true;
}

/**
 * Check if Claude's claimed expertise terms appear in the candidate's publications
 * Returns mismatch info if none of the specific expertise terms are found
 */
function checkExpertiseMismatch(publications, claimedExpertise) {
  if (!claimedExpertise || !Array.isArray(claimedExpertise) || claimedExpertise.length === 0) {
    return { hasMismatch: false, claimedTerms: [], matchedTerms: [] };
  }

  if (!publications || publications.length === 0) {
    return { hasMismatch: true, claimedTerms: claimedExpertise, matchedTerms: [] };
  }

  // Extract significant terms from Claude's expertise claims
  // Filter out very common/generic words
  const genericWords = new Set([
    'biology', 'research', 'science', 'study', 'analysis', 'methods',
    'molecular', 'cellular', 'genetic', 'genomic', 'protein', 'proteins',
    'mechanism', 'mechanisms', 'function', 'regulation', 'development',
    'evolution', 'evolutionary', 'structure', 'structural', 'model', 'models'
  ]);

  const claimedTerms = claimedExpertise
    .flatMap(area => {
      // Split by comma and common delimiters, then by spaces
      return area.toLowerCase()
        .split(/[,;\/]+/)
        .flatMap(part => {
          // Keep multi-word phrases that might be specific (e.g., "HnRNP proteins")
          const words = part.trim().split(/\s+/).filter(w => w.length > 3);
          // If it's a 2-3 word phrase, keep it as a phrase too
          if (words.length >= 2 && words.length <= 3) {
            return [...words, words.join(' ')];
          }
          return words;
        });
    })
    .filter(term => term.length > 4 && !genericWords.has(term))
    .filter((term, index, arr) => arr.indexOf(term) === index); // dedupe

  if (claimedTerms.length === 0) {
    // All terms were generic, can't check
    return { hasMismatch: false, claimedTerms: [], matchedTerms: [] };
  }

  // Combine all publication titles (and abstracts if available) into searchable text
  const titlesText = publications
    .map(p => `${p.title || ''} ${p.abstract || ''}`.toLowerCase())
    .join(' ');

  // Check which claimed terms appear in publications
  const matchedTerms = claimedTerms.filter(term => titlesText.includes(term));

  // Mismatch if NONE of the specific terms were found
  return {
    hasMismatch: matchedTerms.length === 0,
    claimedTerms,
    matchedTerms
  };
}

module.exports = {
  filterByExpertiseRelevance,
  calculateExpertiseMatch,
  checkInstitutionMismatch,
  checkExpertiseMismatch,
};
