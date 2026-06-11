/**
 * DeduplicationService - Handle researcher name matching and deduplication
 *
 * Features:
 * - Name similarity matching (John Smith vs J. Smith)
 * - Merge duplicate researcher records
 * - Conflict of interest filtering
 * - Relevance ranking
 */

const stringSimilarity = require('string-similarity');
const { normalizeName } = require('../utils/name-normalization');
const { rankByRelevance } = require('../utils/relevance-score');
const { ContactParser } = require('../utils/contact-parser');

class DeduplicationService {

  // ============================================
  // MAIN DEDUPLICATION FUNCTION
  // ============================================

  /**
   * Deduplicate candidates and store unique researchers
   */
  static async deduplicateAndStore(candidates) {
    const deduplicated = [];
    const nameGroups = this.groupByNameSimilarity(candidates);

    for (const group of nameGroups) {
      const merged = await this.mergeGroup(group);
      if (merged) {
        deduplicated.push(merged);
      }
    }

    return deduplicated;
  }

  // ============================================
  // NAME SIMILARITY GROUPING
  // ============================================

  /**
   * Group candidates by name similarity
   */
  static groupByNameSimilarity(candidates) {
    const groups = [];
    const processed = new Set();

    for (let i = 0; i < candidates.length; i++) {
      if (processed.has(i)) continue;

      const group = [candidates[i]];
      processed.add(i);

      // Find similar names
      for (let j = i + 1; j < candidates.length; j++) {
        if (processed.has(j)) continue;

        if (this.areNamesSimilar(candidates[i].name, candidates[j].name)) {
          group.push(candidates[j]);
          processed.add(j);
        }
      }

      groups.push(group);
    }

    return groups;
  }

  /**
   * Check if two names are similar enough to be the same person
   */
  static areNamesSimilar(name1, name2) {
    if (!name1 || !name2) return false;

    // Strip honorifics before comparing. "Prof. Ursula Keller" (a verified Track-A
    // reviewer) and "Ursula Keller" (the same person re-surfaced by a Track-B arxiv
    // search) are identical, but normalizeName only strips the period — the bare
    // "prof" token survives and defeats every comparison below, so the discover()
    // dedup leaves the verified reviewer duplicated as an unverified candidate.
    const n1 = ContactParser.stripHonorifics(name1);
    const n2 = ContactParser.stripHonorifics(name2);

    const normalized1 = this.normalizeName(n1);
    const normalized2 = this.normalizeName(n2);

    // Exact match after normalization
    if (normalized1 === normalized2) return true;

    // String similarity threshold
    const similarity = stringSimilarity.compareTwoStrings(normalized1, normalized2);
    if (similarity > 0.85) return true;

    // Check if one is initials of the other
    if (this.isInitialsMatch(n1, n2)) return true;

    // Check last name match with partial first name
    if (this.isPartialMatch(n1, n2)) return true;

    return false;
  }

  /**
   * Normalize a name for comparison
   */
  static normalizeName(name) {
    if (!name) return '';
    return name
      .toLowerCase()
      .replace(/[^a-z\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Check if names match with initials (J. Smith vs John Smith)
   */
  static isInitialsMatch(name1, name2) {
    const parts1 = name1.trim().split(/\s+/);
    const parts2 = name2.trim().split(/\s+/);

    // Need at least 2 parts (first + last)
    if (parts1.length < 2 || parts2.length < 2) return false;

    // Check if last names match
    const lastName1 = parts1[parts1.length - 1].toLowerCase();
    const lastName2 = parts2[parts2.length - 1].toLowerCase();

    if (lastName1 !== lastName2) return false;

    // Check first name/initials
    const first1 = parts1[0].toLowerCase().replace(/\./g, '');
    const first2 = parts2[0].toLowerCase().replace(/\./g, '');

    // One is initial of the other
    if (first1.length === 1 && first2.startsWith(first1)) return true;
    if (first2.length === 1 && first1.startsWith(first2)) return true;

    return false;
  }

  /**
   * Check for partial first name match with same last name
   */
  static isPartialMatch(name1, name2) {
    const parts1 = name1.trim().split(/\s+/);
    const parts2 = name2.trim().split(/\s+/);

    if (parts1.length < 2 || parts2.length < 2) return false;

    const lastName1 = parts1[parts1.length - 1].toLowerCase();
    const lastName2 = parts2[parts2.length - 1].toLowerCase();

    if (lastName1 !== lastName2) return false;

    const first1 = parts1[0].toLowerCase();
    const first2 = parts2[0].toLowerCase();

    // One first name starts with or contains the other
    if (first1.includes(first2) || first2.includes(first1)) return true;

    return false;
  }

  // ============================================
  // MERGE GROUP INTO SINGLE RESEARCHER
  // ============================================

  /**
   * Merge a group of similar candidates into one researcher
   */
  static async mergeGroup(group) {
    if (!group || group.length === 0) return null;

    // Use the most complete name (longest)
    const bestName = group.reduce((longest, current) =>
      (current.name?.length || 0) > (longest.name?.length || 0) ? current : longest
    ).name;

    if (!bestName) return null;

    // Post-W5-caller-migration: the previous `DatabaseService.findResearcher`
    // lookup pulled a Postgres `researchers.id` to thread into the merged
    // object. That id was never consumed downstream (merged candidates are
    // transient discovery-flow objects, not persisted here — comments at
    // the bottom of this function explicitly say "Researchers are NOT
    // saved to database during discovery"). Dropped cleanly; consumers
    // that need a stable identifier rely on email post-enrichment.

    // Collect all publications from the group
    const allPublications = group.flatMap(c => c.publications || []);

    // Merge all data from the group
    // Look for affiliation in multiple possible fields (different sources use different names)
    const bestAffiliation = this.selectBest(group.map(c =>
      c.affiliation || c.primaryAffiliation || c.institution
    ));

    // Distinct affiliations seen across the merged group — the affiliation
    // HISTORY markInstitutionCOI scans to flag a FORMER shared institution with
    // the PI. Track B candidates each carry one affiliation (from one paper);
    // merging same-author rows aggregates them. Also folds in any pre-existing
    // affiliationHistory (e.g. a Claude-verified candidate merged in). (Codex P2.)
    const affiliationHistory = [...new Set(
      group.flatMap(c => [
        ...(Array.isArray(c.affiliationHistory) ? c.affiliationHistory : []),
        c.affiliation || c.primaryAffiliation || c.institution,
      ]).map(a => (typeof a === 'string' ? a.trim() : '')).filter(Boolean)
    )];

    const merged = {
      name: bestName,
      normalizedName: normalizeName(bestName),
      primaryAffiliation: bestAffiliation,
      affiliation: bestAffiliation,  // Also provide as 'affiliation' for UI compatibility
      affiliationHistory,
      email: this.selectBest(group.map(c => c.email)),
      website: this.selectBest(group.map(c => c.website)),
      hIndex: Math.max(...group.map(c => c.hIndex || 0)),
      totalCitations: Math.max(...group.map(c => c.citations || 0)),
      sources: [...new Set(group.flatMap(c => [
        ...(Array.isArray(c.sources) ? c.sources : []),
        c.source,
      ]).filter(Boolean))],
      // Include publications from all candidates in the group
      publications: allPublications,
      publicationCount5yr: group.reduce((sum, c) => {
        if (Number.isFinite(c.publicationCount5yr)) return sum + c.publicationCount5yr;
        return sum + (Array.isArray(c.publications) ? c.publications.length : 0);
      }, 0),
      // Preserve Claude's reason for suggesting this reviewer
      claudeReason: this.selectBest(group.map(c => c.claudeReason)),
      // Flag if this was a Claude-suggested reviewer
      claudeSuggested: group.some(c => c.source === 'claude'),
    };

    // NOTE: Researchers are NOT saved to database during discovery.
    // They are only saved when the user explicitly clicks "Save" in the UI.
    // This keeps the database clean with only user-selected candidates.

    return merged;
  }

  /**
   * Select the best (longest non-empty) value from a list
   */
  static selectBest(values) {
    return values
      .filter(v => v && v.trim?.().length > 0)
      .reduce((best, current) =>
        !best || (current && current.length > best.length) ? current : best
      , undefined);
  }

  // ============================================
  // CONFLICT OF INTEREST DETECTION
  // ============================================

  /**
   * Mark researchers with institution COI (same institution as PI)
   * Returns researchers with hasInstitutionCOI flag added
   */
  // CURRENT-affiliation only (S240 Chunk 2a): historical / former-shared institution
  // no longer counts — reviewers self-disclose relationship conflicts, and a flag the
  // PD won't verify adds manual-search burden (project-reviewer-coi-rely-on-self-disclosure).
  // `authorInstitution` accepts a string OR the PI-institution UNION array. This SOFT
  // flag now runs only on the applicant-recommended + post-enrichment paths; the normal
  // search HARD-DROPS via filterConflicts.
  static markInstitutionCOI(researchers, authorInstitution) {
    const institutions = (Array.isArray(authorInstitution) ? authorInstitution : [authorInstitution])
      .filter(Boolean);
    if (institutions.length === 0) return researchers;

    const normalized = institutions.map((inst) => ({ raw: inst, norm: this.normalizeInstitution(inst) }));

    return researchers.map(researcher => {
      const researcherAffiliation = researcher.affiliation || researcher.primaryAffiliation;

      let matchedPi = null;
      if (researcherAffiliation) {
        const researcherInst = this.normalizeInstitution(researcherAffiliation);
        const hit = normalized.find((n) => this.institutionsMatch(n.norm, researcherInst));
        if (hit) matchedPi = hit.raw;
      }

      const hasInstitutionCOI = !!matchedPi;

      return {
        ...researcher,
        hasInstitutionCOI,
        institutionCOIDetails: hasInstitutionCOI ? {
          piInstitution: matchedPi,
          reviewerInstitution: researcherAffiliation,
        } : null
      };
    });
  }

  /**
   * Filter out proposal authors (PI and co-authors) from candidate list
   * Uses fuzzy name matching to catch variations like "Michael D Pluth" vs "Michael Pluth"
   *
   * @param {Array} candidates - List of candidate researchers
   * @param {Array} proposalAuthors - List of author names to exclude
   * @returns {Object} { filtered: candidates without authors, excluded: removed candidates }
   */
  static filterProposalAuthors(candidates, proposalAuthors) {
    if (!proposalAuthors || proposalAuthors.length === 0) {
      return { filtered: candidates, excluded: [] };
    }

    const excluded = [];
    const filtered = candidates.filter(candidate => {
      const candidateName = candidate.name;

      // Check if candidate name matches any proposal author
      const matchingAuthor = proposalAuthors.find(authorName =>
        this.areNamesSimilar(candidateName, authorName)
      );

      if (matchingAuthor) {
        excluded.push({
          ...candidate,
          excludedReason: `Name matches proposal author: ${matchingAuthor}`
        });
        return false;
      }

      return true;
    });

    return { filtered, excluded };
  }

  /**
   * Filter out researchers with conflicts of interest
   * Note: Consider using markInstitutionCOI instead to flag rather than filter
   */
  // `authorInstitution` accepts a single string OR an array of institutions (S240
  // Chunk 2a): the PI-institution UNION (ORCID-current + OpenAlex last-known + LLM)
  // so a dual-appointment PI's reviewers are all caught. Hard-drops a candidate whose
  // CURRENT affiliation matches ANY institution in the set.
  static filterConflicts(researchers, authorInstitution, excludeNames = []) {
    const institutions = (Array.isArray(authorInstitution) ? authorInstitution : [authorInstitution])
      .filter(Boolean)
      .map((inst) => this.normalizeInstitution(inst));
    if (institutions.length === 0) return researchers;

    return researchers.filter(researcher => {
      // Exclude if at the same institution as ANY union member.
      // Check both 'affiliation' and 'primaryAffiliation' fields.
      const researcherAffiliation = researcher.affiliation || researcher.primaryAffiliation;
      if (researcherAffiliation) {
        const researcherInst = this.normalizeInstitution(researcherAffiliation);
        if (institutions.some((inst) => this.institutionsMatch(inst, researcherInst))) {
          return false;
        }
      }

      // Exclude if name is in exclude list
      const researcherName = this.normalizeName(researcher.name);
      if (excludeNames.some(name => this.normalizeName(name) === researcherName)) {
        return false;
      }

      return true;
    });
  }

  /**
   * Common institution abbreviation mappings
   */
  static INSTITUTION_ABBREVIATIONS = {
    'uc': 'university of california',
    'ucla': 'university of california los angeles',
    'ucsf': 'university of california san francisco',
    'ucsd': 'university of california san diego',
    'ucsb': 'university of california santa barbara',
    'ucsc': 'university of california santa cruz',
    'uci': 'university of california irvine',
    'ucr': 'university of california riverside',
    'ucd': 'university of california davis',
    'mit': 'massachusetts institute of technology',
    'caltech': 'california institute of technology',
    'gatech': 'georgia institute of technology',
    'georgia tech': 'georgia institute of technology',
    'gt': 'georgia institute of technology',
    'umd': 'university of maryland',
    'uw': 'university of washington',
    'umn': 'university of minnesota',
    'usf': 'university of south florida',
    'ubc': 'university of british columbia',
    'nyu': 'new york university',
    'cuny': 'city university of new york',
    'suny': 'state university of new york',
    'osu': 'ohio state university',
    'psu': 'penn state university',
    'penn state': 'pennsylvania state university',
    'ut': 'university of texas',
    'uf': 'university of florida',
    'virginia tech': 'virginia polytechnic institute',
    'texas tech': 'texas tech university',
  };

  /**
   * Normalize institution name for comparison
   * Preserves key identifying words while removing noise
   */
  static normalizeInstitution(institution) {
    if (!institution) return '';

    let normalized = institution.toLowerCase();

    // Remove department/school prefixes - match only up to the next comma or "university"/"institute"
    // Use non-greedy matching and stop at institutional keywords
    normalized = normalized.replace(
      /^(department|dept|school|division|center|centre)\s+(of|for)\s+[^,]*?,\s*/i,
      ''
    );

    // Also try removing prefix if followed by university/institute (handles comma-less strings)
    normalized = normalized.replace(
      /^(department|dept|school|division|center|centre)\s+(of|for)\s+[\w\s]+?,\s*(?=university|institute|college)/i,
      ''
    );

    // Remove common suffixes
    normalized = normalized.replace(/,?\s*(usa|united states|u\.?s\.?a?\.?)$/i, '');

    // Remove special characters but keep spaces
    normalized = normalized.replace(/[^a-z\s]/g, '');

    // Clean up whitespace
    normalized = normalized.replace(/\s+/g, ' ').trim();

    return normalized;
  }

  /**
   * Expand known abbreviations in institution name
   */
  static expandInstitutionAbbreviations(institution) {
    if (!institution) return '';

    let expanded = institution.toLowerCase().trim();

    // Check each abbreviation
    for (const [abbrev, full] of Object.entries(this.INSTITUTION_ABBREVIATIONS)) {
      // Match abbreviation at word boundary (e.g., "UC Berkeley" -> "university of california Berkeley")
      const regex = new RegExp(`\\b${abbrev}\\b`, 'gi');
      if (regex.test(expanded)) {
        expanded = expanded.replace(regex, full);
      }
    }

    return expanded;
  }

  /**
   * Check if two institutions are the same
   */
  static institutionsMatch(inst1, inst2) {
    if (!inst1 || !inst2) return false;

    // Direct match
    if (inst1 === inst2) return true;

    // Expand abbreviations before comparison
    const expanded1 = this.expandInstitutionAbbreviations(inst1);
    const expanded2 = this.expandInstitutionAbbreviations(inst2);

    // Normalize after expansion
    const norm1 = this.normalizeInstitution(expanded1);
    const norm2 = this.normalizeInstitution(expanded2);

    // Check again after expansion/normalization
    if (norm1 === norm2) return true;

    // One string contains the other entirely (for cases like "University of Michigan, Ann Arbor")
    if (norm1.includes(norm2) || norm2.includes(norm1)) return true;

    // Extract key identifying words (excluding common words)
    const stopWords = ['of', 'the', 'and', 'at', 'in', 'for'];
    // Keep short words that are significant identifiers (like "am" from "A&M")
    const significantShortWords = ['am'];
    const getKeyWords = (str) => str.split(/\s+/).filter(w =>
      (w.length > 2 || significantShortWords.includes(w)) && !stopWords.includes(w)
    );

    const words1 = getKeyWords(norm1);
    const words2 = getKeyWords(norm2);

    // For "University of Michigan" vs "Michigan State University":
    // words1 = ['university', 'michigan']
    // words2 = ['michigan', 'state', 'university']
    // These share words but are different institutions

    // Require EXACT same key words (order doesn't matter) for a match
    // This is strict but avoids false positives
    if (words1.length === words2.length) {
      const sorted1 = [...words1].sort().join(' ');
      const sorted2 = [...words2].sort().join(' ');
      if (sorted1 === sorted2) return true;
    }

    // Also allow subset matching ONLY if the shorter is a proper subset
    // and the longer doesn't have conflicting words like "state"
    const conflictingWords = ['state', 'tech', 'polytechnic', 'community', 'medical', 'health', 'am'];
    const shorter = words1.length <= words2.length ? words1 : words2;
    const longer = words1.length <= words2.length ? words2 : words1;

    // Check if longer has any conflicting words that aren't in shorter
    const longerHasConflict = longer.some(w => conflictingWords.includes(w) && !shorter.includes(w));
    if (longerHasConflict) return false;

    // Check if all shorter words appear in longer
    const allInLonger = shorter.every(w => longer.includes(w));
    if (allInLonger && shorter.length >= 2) return true;

    // String similarity as final fallback (high threshold)
    const similarity = stringSimilarity.compareTwoStrings(norm1, norm2);
    return similarity > 0.9;
  }

  // ============================================
  // RANKING BY RELEVANCE
  // ============================================

  /**
   * Rank researchers by relevance to proposal. Delegates to the shared pure
   * scorer in `lib/utils/relevance-score.js` so the server (this path, via
   * /discover) and the Workbench client (post-enrichment re-rank) never drift.
   */
  static rankByRelevance(researchers, proposalKeywords = []) {
    return rankByRelevance(researchers, proposalKeywords);
  }

  /**
   * Filter by minimum h-index (to ensure qualified reviewers)
   */
  static filterByMinimumQualifications(researchers, minHIndex = 5) {
    return researchers.filter(r => (r.hIndex || 0) >= minHIndex);
  }
}

module.exports = { DeduplicationService };
