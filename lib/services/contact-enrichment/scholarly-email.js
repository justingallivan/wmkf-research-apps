/**
 * Structured scholarly-email evidence for new reviewer candidates.
 *
 * This tier searches NCBI PubMed and Europe PMC, then accepts an address only
 * when it appears in the matched author's own recent affiliation and that
 * affiliation corroborates the candidate's resolved institution. Repeated
 * evidence is counted by distinct publication, not by provider response, so
 * the same PMID returned by both services never earns two votes.
 */

const { ContactParser } = require('../../utils/contact-parser');
const { PubMedService } = require('../pubmed-service');
const nameMatching = require('../discovery/name-matching');
const domainEvidence = require('./domain-evidence');

const EUROPE_PMC_SEARCH_URL = 'https://www.ebi.ac.uk/europepmc/webservices/rest/search';
const MAX_RESULTS_PER_PROVIDER = 25;
const MAX_EVIDENCE_PUBLICATIONS = 5;
const MAX_EMAIL_AGE_YEARS = 3;

function normalizeOrcid(value) {
  const match = String(value || '').match(/\d{4}-\d{4}-\d{4}-[\dX]{4}/i);
  return match ? match[0].toUpperCase() : null;
}

function authorOrcid(author = {}) {
  const ids = [
    author.authorId,
    ...(Array.isArray(author.authorIdList?.authorId) ? author.authorIdList.authorId : []),
  ].filter(Boolean);

  for (const entry of ids) {
    if (typeof entry === 'string') {
      const normalized = normalizeOrcid(entry);
      if (normalized) return normalized;
      continue;
    }
    const type = String(entry.type || entry.$?.type || '').toUpperCase();
    const value = entry.value || entry._ || entry.id || '';
    if (!type || type === 'ORCID') {
      const normalized = normalizeOrcid(value);
      if (normalized) return normalized;
    }
  }
  return null;
}

function authorName(author = {}) {
  return String(
    [author.firstName || author.foreName, author.lastName].filter(Boolean).join(' ')
    || author.name
    || author.fullName
    || '',
  ).trim();
}

function authorAffiliations(author = {}) {
  const detailed = author.authorAffiliationDetailsList?.authorAffiliation;
  const values = [
    ...(Array.isArray(detailed) ? detailed.map((item) => item?.affiliation || item) : []),
    ...(Array.isArray(author.allAffiliations) ? author.allAffiliations : []),
    author.affiliation,
  ];
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
}

function affiliationCorroborates(candidateAffiliation, authorAffiliation) {
  const candidateTokens = new Set(domainEvidence.institutionTokens(candidateAffiliation));
  const authorTokens = domainEvidence.institutionTokens(authorAffiliation);
  if (!candidateTokens.size || !authorTokens.length) return false;
  return authorTokens.some((token) => candidateTokens.has(token));
}

function authorMatchesCandidate(author, candidate) {
  const candidateOrcid = normalizeOrcid(
    candidate?.orcid
    || candidate?.orcidId
    || candidate?.contactEnrichment?.orcidId,
  );
  const matchedOrcid = authorOrcid(author);
  if (candidateOrcid && matchedOrcid && candidateOrcid === matchedOrcid) {
    return { matches: true, matchedBy: 'orcid' };
  }

  const evidence = nameMatching.nameMatchEvidence(candidate?.name, authorName(author));
  return {
    matches: evidence.matches && evidence.fullForenameMatch && !evidence.initialOnly,
    matchedBy: evidence.fullForenameMatch ? 'full_name' : null,
  };
}

function publicationKeys(publication = {}) {
  const keys = [];
  if (publication.pmid) keys.push(`pmid:${String(publication.pmid).toLowerCase()}`);
  if (publication.pmcid) keys.push(`pmcid:${String(publication.pmcid).toLowerCase()}`);
  if (publication.doi) keys.push(`doi:${String(publication.doi).toLowerCase()}`);
  const title = String(publication.title || '').toLowerCase().replace(/\W+/g, ' ').trim();
  if (title) keys.push(`title:${title}:${publication.year || ''}`);
  return keys;
}

function publicationKey(publication = {}) {
  return publicationKeys(publication)[0] || null;
}

function publicationUrl(publication = {}) {
  if (publication.pmcid) return `https://europepmc.org/articles/${publication.pmcid}`;
  if (publication.pmid) return `https://pubmed.ncbi.nlm.nih.gov/${publication.pmid}/`;
  if (publication.doi) return `https://doi.org/${publication.doi}`;
  return null;
}

function normalizePublication(publication = {}, provider) {
  return {
    pmid: publication.pmid ? String(publication.pmid) : null,
    pmcid: publication.pmcid ? String(publication.pmcid) : null,
    doi: publication.doi ? String(publication.doi) : null,
    title: String(publication.title || '').trim() || null,
    year: Number(publication.pubYear || publication.year) || null,
    authors: Array.isArray(publication.authors)
      ? publication.authors
      : (Array.isArray(publication.authorList?.author) ? publication.authorList.author : []),
    provider,
  };
}

function extractPublicationEvidence(publication, candidate) {
  const keys = publicationKeys(publication);
  if (!keys.length || !publication.year) return [];
  const currentYear = new Date().getFullYear();
  if (publication.year < currentYear - MAX_EMAIL_AGE_YEARS || publication.year > currentYear + 1) {
    return [];
  }

  const evidence = [];
  for (const author of publication.authors || []) {
    const identity = authorMatchesCandidate(author, candidate);
    if (!identity.matches) continue;

    for (const affiliation of authorAffiliations(author)) {
      if (!affiliationCorroborates(candidate.affiliation, affiliation)) continue;
      for (const email of ContactParser.extractEmails(affiliation)) {
        evidence.push({
          email,
          workKey: keys[0],
          workKeys: keys,
          provider: publication.provider,
          matchedBy: identity.matchedBy,
          publication: {
            pmid: publication.pmid,
            pmcid: publication.pmcid,
            doi: publication.doi,
            title: publication.title,
            year: publication.year,
            url: publicationUrl(publication),
          },
        });
      }
    }
  }
  return evidence;
}

function cleanCandidateName(candidate) {
  return ContactParser.stripHonorifics(String(candidate?.name || ''))
    .replace(/"/g, '')
    .trim();
}

function buildEuropePmcQuery(candidate) {
  const endYear = new Date().getFullYear();
  const startYear = endYear - MAX_EMAIL_AGE_YEARS;
  return `AUTH:"${cleanCandidateName(candidate)}" AND FIRST_PDATE:[${startYear}-01-01 TO ${endYear}-12-31] sort_date:y`;
}

async function searchEuropePmc(candidate, { signal } = {}) {
  const params = new URLSearchParams({
    query: buildEuropePmcQuery(candidate),
    format: 'json',
    resultType: 'core',
    pageSize: String(MAX_RESULTS_PER_PROVIDER),
  });
  const contactEmail = process.env.NOTIFICATION_EMAIL_FROM;
  if (contactEmail) params.set('email', contactEmail);

  const response = await fetch(`${EUROPE_PMC_SEARCH_URL}?${params}`, { signal });
  if (!response.ok) {
    throw new Error(`Europe PMC search failed (${response.status})`);
  }
  const payload = await response.json();
  return (payload?.resultList?.result || []).map((publication) =>
    normalizePublication(publication, 'europe_pmc'));
}

async function searchPubMed(candidate, { signal } = {}) {
  const endYear = new Date().getFullYear();
  const startYear = endYear - MAX_EMAIL_AGE_YEARS;
  const cleanName = cleanCandidateName(candidate);
  const query = `"${cleanName}"[Full Author Name] AND (${startYear}:${endYear}[pdat])`;
  const publications = await PubMedService.search(query, MAX_RESULTS_PER_PROVIDER, {
    signal,
    throwOnError: true,
  });
  return publications.map((publication) => normalizePublication(publication, 'ncbi_pubmed'));
}

function selectEmail(evidenceRows) {
  const byEmail = new Map();
  for (const row of evidenceRows) {
    if (!byEmail.has(row.email)) byEmail.set(row.email, []);
    const works = byEmail.get(row.email);
    const rowKeys = new Set(row.workKeys || [row.workKey].filter(Boolean));
    const matches = works.filter((work) =>
      [...rowKeys].some((key) => work.workKeys.has(key)));
    if (!matches.length) {
      works.push({
        ...row.publication,
        workKeys: rowKeys,
        providers: [row.provider],
        matchedBy: row.matchedBy,
      });
    } else {
      const existing = matches[0];
      for (const duplicate of matches.slice(1)) {
        for (const key of duplicate.workKeys) existing.workKeys.add(key);
        for (const provider of duplicate.providers) {
          if (!existing.providers.includes(provider)) existing.providers.push(provider);
        }
        works.splice(works.indexOf(duplicate), 1);
      }
      for (const key of rowKeys) existing.workKeys.add(key);
      if (!existing.providers.includes(row.provider)) existing.providers.push(row.provider);
      for (const field of ['pmid', 'pmcid', 'doi', 'title', 'year', 'url']) {
        if (!existing[field] && row.publication[field]) existing[field] = row.publication[field];
      }
    }
  }

  const ranked = [...byEmail.entries()]
    .map(([email, works]) => ({
      email,
      publications: works
        .map(({ workKeys, ...publication }) => publication)
        .sort((a, b) => (b.year || 0) - (a.year || 0)),
    }))
    .sort((a, b) => b.publications.length - a.publications.length);

  if (!ranked.length) return { status: 'not_found', candidates: [] };
  if (ranked[1] && ranked[0].publications.length === ranked[1].publications.length) {
    return {
      status: 'conflict',
      candidates: ranked.slice(0, 3).map((entry) => ({
        email: entry.email,
        publicationCount: entry.publications.length,
      })),
    };
  }

  const best = ranked[0];
  const providers = [...new Set(best.publications.flatMap((publication) => publication.providers))];
  return {
    status: 'found',
    email: best.email,
    publicationCount: best.publications.length,
    latestYear: best.publications[0]?.year || null,
    providers,
    publications: best.publications.slice(0, MAX_EVIDENCE_PUBLICATIONS),
  };
}

/**
 * Resolve a structured scholarly email. Provider failures are recorded and do
 * not fail the candidate; cancellation/deadline aborts always propagate.
 */
async function findScholarlyEmail(candidate, { signal } = {}) {
  const seeded = (candidate.publications || [])
    .map((publication) => normalizePublication(publication, 'candidate_publication'));
  const providerErrors = [];

  const settled = await Promise.allSettled([
    searchPubMed(candidate, { signal }),
    searchEuropePmc(candidate, { signal }),
  ]);
  if (signal?.aborted) {
    throw signal.reason || new DOMException('Aborted', 'AbortError');
  }

  const publications = [...seeded];
  for (const [index, item] of settled.entries()) {
    if (item.status === 'fulfilled') {
      publications.push(...item.value);
    } else {
      providerErrors.push({
        provider: index === 0 ? 'ncbi_pubmed' : 'europe_pmc',
        error: item.reason?.message || 'Unknown provider error',
      });
    }
  }

  const evidenceRows = publications.flatMap((publication) =>
    extractPublicationEvidence(publication, candidate));
  return {
    ...selectEmail(evidenceRows),
    providerErrors,
  };
}

module.exports = {
  MAX_EMAIL_AGE_YEARS,
  authorAffiliations,
  authorMatchesCandidate,
  buildEuropePmcQuery,
  extractPublicationEvidence,
  findScholarlyEmail,
  normalizePublication,
  publicationKey,
  publicationKeys,
  searchEuropePmc,
  selectEmail,
};
