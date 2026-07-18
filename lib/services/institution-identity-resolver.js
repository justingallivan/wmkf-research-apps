/**
 * Institution identity substrate (Reviewer Identity & Contact roadmap W0).
 *
 * Resolves one affiliation string to a unique OpenAlex institution identity.
 * This module is deliberately inert: callers must create a resolver and opt in;
 * no production COI or identity path calls it until a later roadmap wave.
 *
 * Safety contract:
 * - never choose by search-result rank alone;
 * - return null for missing, weak, or tied matches;
 * - an optional ISO-2 country hint may narrow otherwise identical names;
 * - provider failures degrade to null, while caller cancellation propagates;
 * - cache only settled results/definitive misses, scoped to one resolver instance.
 */

const { ContactParser } = require('../utils/contact-parser');
const { OpenAlexService } = require('./openalex-service');

const ACRONYM_STOP_WORDS = new Set(['a', 'an', 'and', 'at', 'for', 'of', 'the']);
const MATCH = Object.freeze({
  NONE: 0,
  ACRONYM: 1,
  CONTAINMENT: 2,
  EXACT: 3,
});

function normalizeInstitutionName(value) {
  return ContactParser.normalizeNameForMatch(String(value || ''))
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizedCountryCode(value) {
  const code = String(value || '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : null;
}

function explicitAcronym(value) {
  const raw = String(value || '').trim();
  const compact = raw.replace(/[^A-Za-z0-9]/g, '');
  if (!/^[A-Z0-9]{3,10}$/.test(compact)) return null;
  return compact;
}

function displayNameAcronym(value) {
  const words = normalizeInstitutionName(value)
    .split(/\s+/)
    .filter((word) => word && !ACRONYM_STOP_WORDS.has(word));
  if (words.length < 2) return null;
  return words.map((word) => word[0]).join('').toUpperCase();
}

function institutionNameMatchRank(query, displayName) {
  const queryName = normalizeInstitutionName(query);
  const candidateName = normalizeInstitutionName(displayName);
  if (!queryName || !candidateName) return MATCH.NONE;
  if (queryName === candidateName) return MATCH.EXACT;

  // An explicit acronym is a specific claim, not a substring. This prevents a
  // query such as "MIT" from resolving a unique "MIT Media Lab" result when the
  // canonical Massachusetts Institute of Technology record is absent.
  const acronym = explicitAcronym(query);
  if (acronym) {
    return acronym === displayNameAcronym(displayName) ? MATCH.ACRONYM : MATCH.NONE;
  }

  const paddedQuery = ` ${queryName} `;
  const paddedCandidate = ` ${candidateName} `;
  const shorterName = queryName.length <= candidateName.length ? queryName : candidateName;
  const shorterTokenCount = shorterName.split(/\s+/).filter(Boolean).length;
  if (shorterTokenCount >= 2
    && (paddedQuery.includes(paddedCandidate) || paddedCandidate.includes(paddedQuery))) {
    return MATCH.CONTAINMENT;
  }
  return MATCH.NONE;
}

function institutionIdentityKey(record = {}) {
  return String(record.openAlexId || record.ror || '').trim().toLowerCase()
    || `${normalizeInstitutionName(record.displayName)}|${normalizedCountryCode(record.country) || ''}`;
}

function selectInstitutionCandidate(query, records, { countryCode = null } = {}) {
  const country = normalizedCountryCode(countryCode);
  if (String(countryCode || '').trim() && !country) return null;
  const unique = new Map();
  for (const record of Array.isArray(records) ? records : []) {
    if (!record || (!record.openAlexId && !record.ror)) continue;
    const key = institutionIdentityKey(record);
    if (key && !unique.has(key)) unique.set(key, record);
  }

  const ranked = [...unique.values()]
    .filter((record) => !country || normalizedCountryCode(record.country) === country)
    .map((record) => ({
      record,
      rank: institutionNameMatchRank(query, record.displayName),
    }))
    .filter((entry) => entry.rank > MATCH.NONE);

  if (!ranked.length) return null;
  const bestRank = Math.max(...ranked.map((entry) => entry.rank));
  const best = ranked.filter((entry) => entry.rank === bestRank);
  return best.length === 1 ? best[0].record : null;
}

function freezeInstitutionIdentity(record) {
  if (!record?.openAlexId || !record?.displayName) return null;
  const associatedInstitutions = (Array.isArray(record.associatedInstitutions)
    ? record.associatedInstitutions
    : [])
    .filter((institution) => institution?.openAlexId || institution?.ror)
    .map((institution) => Object.freeze({
      openAlexId: institution.openAlexId || null,
      ror: institution.ror || null,
      country: normalizedCountryCode(institution.country),
      displayName: institution.displayName || null,
      relationship: institution.relationship || null,
    }));

  return Object.freeze({
    openAlexId: record.openAlexId,
    ror: record.ror || null,
    country: normalizedCountryCode(record.country),
    displayName: record.displayName,
    associatedInstitutions: Object.freeze(associatedInstitutions),
  });
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  const error = signal.reason || new Error('Aborted');
  if (!error.name || error.name === 'Error') error.name = 'AbortError';
  throw error;
}

function createInstitutionIdentityResolver({ openAlexService = OpenAlexService } = {}) {
  const cache = new Map();

  async function resolve(affiliation, { countryCode = null, signal } = {}) {
    const query = String(affiliation || '').trim();
    if (!normalizeInstitutionName(query)) return null;
    throwIfAborted(signal);

    const country = normalizedCountryCode(countryCode);
    if (String(countryCode || '').trim() && !country) return null;
    const cacheKey = JSON.stringify([normalizeInstitutionName(query), country]);
    if (cache.has(cacheKey)) return cache.get(cacheKey);

    let records;
    try {
      records = await openAlexService.searchInstitutions(query, {
        signal,
        limit: 10,
      });
      throwIfAborted(signal);
    } catch (error) {
      if (signal?.aborted) throw signal.reason || error;
      return null;
    }

    const selected = selectInstitutionCandidate(query, records, {
      countryCode: country,
    });
    if (!selected) {
      cache.set(cacheKey, null);
      return null;
    }

    let hydrated;
    try {
      hydrated = await openAlexService.getInstitution(
        selected.openAlexId || selected.ror,
        { signal },
      );
      throwIfAborted(signal);
    } catch (error) {
      if (signal?.aborted) throw signal.reason || error;
      return null;
    }

    if (institutionIdentityKey(hydrated) !== institutionIdentityKey(selected)) {
      cache.set(cacheKey, null);
      return null;
    }
    const identity = freezeInstitutionIdentity(hydrated);
    cache.set(cacheKey, identity);
    return identity;
  }

  return Object.freeze({
    resolve,
    get cacheSize() {
      return cache.size;
    },
  });
}

module.exports = {
  MATCH,
  createInstitutionIdentityResolver,
  institutionNameMatchRank,
  normalizeInstitutionName,
  selectInstitutionCandidate,
};
