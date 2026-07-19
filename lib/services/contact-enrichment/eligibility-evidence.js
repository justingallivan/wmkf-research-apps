/**
 * Conservative reviewer-eligibility evidence.
 *
 * Search snippets are noisy: an active faculty page can contain navigation or
 * news text about somebody else's death. They are leads only. Act only after a
 * guarded fetch of a first-party institutional page whose title/sole H1 names
 * the candidate and whose page text directly binds the eligibility statement
 * to that person. Anything else is `unknown` and changes no existing behavior.
 */

const { ContactParser } = require('../../utils/contact-parser');
const { safeFetchInstitutionPage } = require('../../utils/safe-fetch');
const { mayPersistIdentity } = require('../reviewer-identity-resolver');
const { SerpContactService } = require('../serp-contact-service');

const ELIGIBILITY_STATUSES = new Set(['unknown', 'emeritus', 'deceased']);

function normalizedText(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[‐‑‒–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parsedName(name) {
  const clean = normalizedText(ContactParser.stripHonorifics(name || ''))
    .replace(/[^a-z0-9' -]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const tokens = clean.split(' ').filter(Boolean);
  if (tokens.length < 2 || tokens[0].length < 2 || tokens[tokens.length - 1].length < 2) return null;
  return {
    clean,
    tokens,
    first: tokens[0],
    last: tokens[tokens.length - 1],
  };
}

function namePattern(parsed) {
  const tokenPattern = (token, index) => {
    const escaped = escapeRegex(token);
    return index > 0 && index < parsed.tokens.length - 1 && token.length === 1
      ? `${escaped}\\.?`
      : escaped;
  };
  const fullName = parsed.tokens.map(tokenPattern).join('\\s+');
  const firstLast = `${escapeRegex(parsed.first)}\\s+${escapeRegex(parsed.last)}`;
  return parsed.tokens.length > 2 ? `(?:${fullName}|${firstLast})` : fullName;
}

function textNamesCandidate(text, parsed) {
  return new RegExp(`\\b${namePattern(parsed)}\\b`, 'i').test(normalizedText(text));
}

function directDeceasedEvidence(item, parsed) {
  const title = normalizedText(item?.title);
  const snippet = normalizedText(item?.snippet);
  const named = namePattern(parsed);
  const titleSubject = new RegExp(
    `^(?:(?:in memory of|in memoriam|remembering|obituary)\\s*[:\\-]?\\s*${named}\\b|${named}\\b[^:;.!?\\n]{0,100}\\b(?:obituary|in memoriam|passes away|passed away|dies|died|deceased)\\b)`,
    'i',
  );
  if (titleSubject.test(title)) return true;

  const subjectThenDeath = new RegExp(
    `\\b${named}\\b\\s*(?:(?:has\\s+)?(?:passed away|died|dies|is deceased)|,\\s*[^,.;!?\\n]{0,100},\\s*(?:has\\s+)?(?:passed away|died|dies|is deceased)|\\([^)]{0,80}\\)\\s*(?:has\\s+)?(?:passed away|died|dies|is deceased))\\b`,
    'i',
  );
  const deathOfSubject = new RegExp(`\\b(?:death|passing) of\\s+${named}\\b`, 'i');
  return subjectThenDeath.test(snippet) || deathOfSubject.test(snippet);
}

function directEmeritusEvidence(item, parsed) {
  const title = normalizedText(item?.title);
  const snippet = normalizedText(item?.snippet);
  const named = namePattern(parsed);
  const role = '(?:professor emeritus|emeritus professor|emerita professor|professor emerita|retired professor|retired faculty)';
  const namedThenRole = new RegExp(
    `\\b${named}\\b\\s*(?:(?:is|was)\\s+|[-,:|]\\s*)\\b${role}\\b`,
    'i',
  );
  const roleThenNamed = new RegExp(`\\b${role}\\b\\s+${named}\\b`, 'i');
  const namedRetired = new RegExp(`\\b${named}\\b\\s+(?:has\\s+)?retired from\\b`, 'i');
  return namedThenRole.test(title)
    || roleThenNamed.test(title)
    || namedThenRole.test(snippet)
    || roleThenNamed.test(snippet)
    || namedRetired.test(snippet);
}

function normalizedDomain(value) {
  if (!value) return null;
  const candidate = String(value).trim().toLowerCase();
  try {
    const parsed = new URL(candidate.includes('://') ? candidate : `https://${candidate}`);
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

function isTrustedResultUrl(url, domains) {
  const host = normalizedDomain(url);
  if (!host) return false;
  return domains.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

function trustedInstitutionDomains(enrichment = {}) {
  const domains = [
    ...(Array.isArray(enrichment.anchoredInstitutionDomains) ? enrichment.anchoredInstitutionDomains : []),
    enrichment.verifiedInstitutionDomain,
  ]
    .map(normalizedDomain)
    .filter(Boolean);
  return [...new Set(domains)].slice(0, 4);
}

function buildEligibilityQuery(name, domains) {
  const cleanName = ContactParser.stripHonorifics(name || '').trim();
  const sites = domains.map((domain) => `site:${domain}`).join(' OR ');
  return `"${cleanName}" (${sites}) ("passed away" OR died OR obituary OR "in memoriam" OR emeritus OR retired)`;
}

function evidenceFromResult(status, item, checkedAt) {
  return {
    status,
    url: item.link,
    title: item.title || null,
    snippet: item.snippet ? item.snippet.slice(0, 800) : null,
    sourceDomain: normalizedDomain(item.link),
    checkedAt,
  };
}

function evidenceSentence(text, parsed, status) {
  const parts = String(text || '').split(/(?<=[.!?])\s+|\n+/).filter(Boolean);
  const match = parts.find((part) => {
    const item = { title: '', snippet: part };
    return status === 'deceased'
      ? directDeceasedEvidence(item, parsed)
      : directEmeritusEvidence(item, parsed);
  });
  return match ? match.trim().slice(0, 800) : null;
}

function classifyEligibilityPage(name, page, sourceUrl, checkedAt = new Date().toISOString()) {
  const parsed = parsedName(name);
  if (!parsed || !page) return { status: 'unknown', reason: null, evidence: null };
  const titleText = page.titleText || '';
  const h1Texts = Array.isArray(page.h1Texts) ? page.h1Texts : [];
  const identityAnchored = textNamesCandidate(titleText, parsed)
    || (h1Texts.length === 1 && textNamesCandidate(h1Texts[0], parsed));
  if (!identityAnchored) return { status: 'unknown', reason: null, evidence: null };

  const titleCandidates = [titleText, ...h1Texts].filter(Boolean);
  const item = {
    title: titleCandidates.find((title) => directDeceasedEvidence({ title }, parsed)) || '',
    snippet: page.text || '',
  };
  if (directDeceasedEvidence(item, parsed)) {
    return {
      status: 'deceased',
      reason: 'An official institutional page directly reports this person as deceased.',
      evidence: {
        status: 'deceased',
        url: sourceUrl,
        title: titleText || h1Texts[0] || null,
        snippet: evidenceSentence(page.text, parsed, 'deceased'),
        sourceDomain: normalizedDomain(sourceUrl),
        checkedAt,
      },
    };
  }

  const emeritusItem = {
    title: titleCandidates.find((title) => directEmeritusEvidence({ title }, parsed)) || '',
    snippet: page.text || '',
  };
  if (directEmeritusEvidence(emeritusItem, parsed)) {
    return {
      status: 'emeritus',
      reason: 'An official institutional page identifies this person as emeritus or retired.',
      evidence: {
        status: 'emeritus',
        url: sourceUrl,
        title: titleText || h1Texts[0] || null,
        snippet: evidenceSentence(page.text, parsed, 'emeritus'),
        sourceDomain: normalizedDomain(sourceUrl),
        checkedAt,
      },
    };
  }
  return { status: 'unknown', reason: null, evidence: null };
}

function classifyEligibilitySearchLeads(name, results, trustedDomains, checkedAt = new Date().toISOString()) {
  const parsed = parsedName(name);
  const domains = (Array.isArray(trustedDomains) ? trustedDomains : [])
    .map(normalizedDomain)
    .filter(Boolean);
  if (!parsed || domains.length === 0) return { status: 'unknown', reason: null, evidence: null };

  const firstParty = (Array.isArray(results) ? results : [])
    .filter((item) => item?.link && isTrustedResultUrl(item.link, domains));
  const deceased = firstParty.find((item) => directDeceasedEvidence(item, parsed));
  if (deceased) {
    return {
      status: 'deceased',
      reason: 'An official institutional result directly reports this person as deceased.',
      evidence: evidenceFromResult('deceased', deceased, checkedAt),
    };
  }
  const emeritus = firstParty.find((item) => directEmeritusEvidence(item, parsed));
  if (emeritus) {
    return {
      status: 'emeritus',
      reason: 'An official institutional result identifies this person as emeritus or retired.',
      evidence: evidenceFromResult('emeritus', emeritus, checkedAt),
    };
  }
  return { status: 'unknown', reason: null, evidence: null };
}

async function attachEligibilityEvidence(candidate, result, {
  useSerpSearch = false,
  credentials = {},
  signal,
  onProgress = () => {},
  searchOrganicResults = (...args) => SerpContactService.searchOrganicResults(...args),
  fetchInstitutionPage = (...args) => safeFetchInstitutionPage(...args),
  now = () => new Date().toISOString(),
  deadlineAt,
} = {}) {
  const ce = result?.contactEnrichment;
  if (!ce) return result;

  ce.eligibilityStatus = 'unknown';
  ce.eligibilityReason = null;
  ce.eligibilityEvidence = null;
  result.eligibilityStatus = 'unknown';
  result.eligibilityReason = null;
  result.eligibilityEvidence = null;

  if (
    !useSerpSearch
    || !credentials.serpApiKey
    || !mayPersistIdentity(ce.identity?.status)
  ) {
    return result;
  }
  const domains = trustedInstitutionDomains(ce);
  if (domains.length === 0 || !parsedName(candidate?.name)) return result;

  try {
    onProgress({
      tier: 'eligibility',
      status: 'searching',
      message: `Checking official institutional sources for ${candidate.name} eligibility…`,
    });
    const query = buildEligibilityQuery(candidate.name, domains);
    if (Array.isArray(ce.tiersUsed) && !ce.tiersUsed.includes('eligibility_evidence')) {
      ce.tiersUsed.push('eligibility_evidence');
    }
    const results = await searchOrganicResults(query, credentials.serpApiKey, { signal, limit: 10 });
    const firstPartyLeads = results.filter((item) => (
      item?.link
      && isTrustedResultUrl(item.link, domains)
      && classifyEligibilitySearchLeads(candidate.name, [item], domains, now()).status !== 'unknown'
    ));
    let classification = { status: 'unknown', reason: null, evidence: null };
    for (const lead of firstPartyLeads) {
      const sourceDomain = domains.find((domain) => isTrustedResultUrl(lead.link, [domain]));
      if (!sourceDomain) continue;
      const remainingMs = deadlineAt == null ? 8000 : Math.max(1, deadlineAt - Date.now());
      try {
        const pageResponse = await fetchInstitutionPage(lead.link, {
          allowedDomain: sourceDomain,
          signal,
          timeoutMs: Math.min(8000, remainingMs),
        });
        if (!pageResponse?.ok || !pageResponse.text) continue;
        const page = ContactParser.extractEmailsFromHtml(pageResponse.text);
        classification = classifyEligibilityPage(
          candidate.name,
          page,
          pageResponse.finalUrl || lead.link,
          now(),
        );
        if (classification.status !== 'unknown') break;
      } catch (pageError) {
        if (signal?.aborted) throw pageError;
        // Search results are only leads. An unreadable first-party page cannot
        // support a decision; try another lead and otherwise abstain.
      }
    }
    if (!ELIGIBILITY_STATUSES.has(classification.status)) return result;
    ce.eligibilityStatus = classification.status;
    ce.eligibilityReason = classification.reason || null;
    ce.eligibilityEvidence = classification.evidence || null;
    result.eligibilityStatus = ce.eligibilityStatus;
    result.eligibilityReason = ce.eligibilityReason;
    result.eligibilityEvidence = ce.eligibilityEvidence;
    onProgress({
      tier: 'eligibility',
      status: classification.status === 'unknown' ? 'not_found' : 'found',
      message: classification.status === 'deceased'
        ? `${candidate.name} is not eligible: official source reports the person is deceased`
        : classification.status === 'emeritus'
          ? `${candidate.name} is emeritus/retired and will be ranked lower`
          : `No direct eligibility limitation found for ${candidate.name}`,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    console.error('Reviewer eligibility evidence error (non-fatal):', error.message);
    onProgress({
      tier: 'eligibility',
      status: 'error',
      message: `Eligibility evidence unavailable for ${candidate.name}; leaving status unchanged`,
    });
  }
  return result;
}

module.exports = {
  ELIGIBILITY_STATUSES,
  parsedName,
  trustedInstitutionDomains,
  buildEligibilityQuery,
  classifyEligibilitySearchLeads,
  classifyEligibilityPage,
  attachEligibilityEvidence,
};
