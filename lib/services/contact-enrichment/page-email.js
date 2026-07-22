/**
 * ContactEnrichmentService — resolved-page email tier cluster
 * (docs/RESOLVED_PAGE_EMAIL_TIER_DESIGN.md).
 *
 * Stage 5 of the ContactEnrichmentService decomposition
 * (docs/CONTACT_ENRICHMENT_SERVICE_DECOMPOSITION_PLAN.md). The facade keeps thin
 * delegating wrappers; this module now owns the resolved-page behavior, including
 * deterministic mailbox ownership ranking. Depends on domain-evidence
 * (`domainRelated`, `emailDomain`), safe-fetch, ContactParser, and constants
 * (`SEARCH_EMAIL_SOURCES`) / abort (`abortError`) — all stateless.
 *
 * C11 (decomposition plan): `attachEmailFromResolvedPage` reads
 * `process.env.REVIEWER_PAGE_EMAIL_TIER_ENABLED` AT CALL TIME (not hoisted to a
 * module-load const) — a test mutates this env var after import
 * (resolved-page-email-tier-service.test.js). Do not hoist this read.
 */

const { ContactParser } = require('../../utils/contact-parser');
const { safeFetchInstitutionPage, hostWithinDomain } = require('../../utils/safe-fetch.js');
const { domainRelated, emailDomain } = require('./domain-evidence');
const { SEARCH_EMAIL_SOURCES } = require('./constants');
const { abortError } = require('./abort');

/** Deburr + lowercase + drop punctuation for name/window matching. */
function normForNameMatch(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .toLowerCase()
    .replace(/[.'’-]/g, '')
    .replace(/,/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const NAME_SUFFIX_TOKENS = new Set([
  'jr', 'sr', 'ii', 'iii', 'iv', 'vi', 'vii', 'phd', 'md', 'mbbs', 'dphil',
  'dsc', 'scd', 'msc', 'mph', 'mba', 'dds', 'dvm', 'edd', 'drph', 'pharmd',
  'jd', 'esq',
]);

/** Forename + surname tokens for page and mailbox ownership matching. */
function parseCandidateName(name) {
  const rawTokens = String(ContactParser.stripHonorifics(name || ''))
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .toLowerCase()
    .replace(/[.'’]/g, '')
    .replace(/[^a-z\s-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const compactToken = (token) => token.replace(/-/g, '');
  const withoutSuffixes = rawTokens.filter((token) => !NAME_SUFFIX_TOKENS.has(compactToken(token)));
  const nameTokens = withoutSuffixes.length >= 2 ? withoutSuffixes : rawTokens;
  const tokens = nameTokens.map(compactToken).filter(Boolean);
  if (tokens.length < 2) return null;
  const givenInitials = nameTokens
    .slice(0, -1)
    .flatMap((token) => token.split('-'))
    .filter(Boolean)
    .map((token) => token[0])
    .join('');
  return {
    tokens,
    forename: tokens[0],
    surname: tokens[tokens.length - 1],
    givenInitials,
  };
}

/** Email's domain is related to the verified institution domain (email-validation relation). */
function emailDomainRelated(email, verifiedDomain) {
  return domainRelated(emailDomain(email), verifiedDomain);
}

/** True when a text window names the candidate with ordered, near-contiguous evidence. */
function windowNamesCandidate(window, { forename, surname }, { allowForenameInitial = true } = {}) {
  if (!forename || !surname || surname.length < 2) return false;
  const tokens = normForNameMatch(window).split(/\s+/).filter(Boolean);
  const NEAR = 3;
  const isForename = (token) => token === forename
    || (allowForenameInitial && token === forename[0]);
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] !== surname) continue;
    for (let j = Math.max(0, i - NEAR); j < i; j++) {
      if (isForename(tokens[j])) return true;
    }
    for (let j = i + 1; j <= Math.min(tokens.length - 1, i + NEAR); j++) {
      if (isForename(tokens[j])) return true;
    }
  }
  return false;
}

function normalizeMailboxLocal(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

function pageHasStrongCandidateIdentity(parsed, { titleText = '', h1Texts = [] } = {}) {
  if (windowNamesCandidate(titleText, parsed, { allowForenameInitial: false })) return true;
  return Array.isArray(h1Texts)
    && h1Texts.length === 1
    && windowNamesCandidate(h1Texts[0], parsed, { allowForenameInitial: false });
}

function precedingWindowNamesCandidate(window, parsed) {
  const tokens = normForNameMatch(window).split(/\s+/).filter(Boolean);
  const surnamePositions = [];
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] === parsed.surname) surnamePositions.push(i);
  }
  if (!surnamePositions.length) return false;
  const lastSurnamePosition = surnamePositions[surnamePositions.length - 1];
  const NEAR = 3;
  for (let i = Math.max(0, lastSurnamePosition - NEAR); i <= Math.min(tokens.length - 1, lastSurnamePosition + NEAR); i++) {
    if (tokens[i] === parsed.forename) return true;
  }
  return false;
}

const MAILBOX_MATCH_RANK = Object.freeze({
  full_name: 1,
  initials_surname: 2,
  surname_initials: 2,
  exact_surname: 3,
  url_slug: 4,
  name_adjacent: 5,
});

function mailboxMatch(localPart, parsed, {
  strongPageIdentity = false,
  pageIdentifiesCandidate = false,
  slug = null,
  adjacency = false,
} = {}) {
  const local = normalizeMailboxLocal(localPart);
  if (!local) return null;

  const fullNameForms = new Set([
    parsed.tokens.join(''),
    `${parsed.forename}${parsed.surname}`,
    `${parsed.surname}${parsed.forename}`,
  ]);
  if (fullNameForms.has(local)) {
    return { matchClass: 'full_name', ownershipProof: 'mailbox_full_name' };
  }

  if (strongPageIdentity) {
    const verifiedInitialsSurname = `${parsed.givenInitials}${parsed.surname}`;
    const verifiedSurnameInitials = `${parsed.surname}${parsed.givenInitials}`;
    if (local === verifiedInitialsSurname) {
      return { matchClass: 'initials_surname', ownershipProof: 'mailbox_initials_surname' };
    }
    if (local === verifiedSurnameInitials) {
      return { matchClass: 'surname_initials', ownershipProof: 'mailbox_surname_initials' };
    }

    const firstInitial = parsed.forename[0];
    const initialsSurname = new RegExp(`^${firstInitial}[a-z]{0,2}${parsed.surname}$`);
    const surnameInitials = new RegExp(`^${parsed.surname}${firstInitial}[a-z]{0,2}$`);
    if (initialsSurname.test(local)) {
      return {
        matchClass: 'initials_surname',
        ownershipProof: 'mailbox_initials_surname_unverified_middle',
      };
    }
    if (surnameInitials.test(local)) {
      return {
        matchClass: 'surname_initials',
        ownershipProof: 'mailbox_surname_initials_unverified_middle',
      };
    }
    if (local === parsed.surname) {
      return { matchClass: 'exact_surname', ownershipProof: 'mailbox_exact_surname' };
    }
  }

  const rawLocal = String(localPart || '').toLowerCase();
  if (
    pageIdentifiesCandidate
    && slug
    && rawLocal === slug
    && slugNamesCandidate(slug, parsed)
  ) {
    return { matchClass: 'url_slug', ownershipProof: 'page_url_slug' };
  }
  if (adjacency) {
    return { matchClass: 'name_adjacent', ownershipProof: 'name_precedes_email' };
  }
  return null;
}

/** Personal-page handle from a URL: `/~phbuck/` → `phbuck`, else last path segment. */
function personalPageSlug(pageUrl) {
  let pathname;
  try { pathname = new URL(pageUrl).pathname; } catch { return null; }
  const tilde = pathname.match(/\/~([a-z0-9._-]+)/i);
  if (tilde) return tilde[1].toLowerCase();
  const segs = pathname.split('/').filter(Boolean);
  return segs.length ? segs[segs.length - 1].toLowerCase().replace(/\.(html?|php|aspx?)$/, '') : null;
}

function slugNamesCandidate(slug, { forename, surname }) {
  const compact = String(slug || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!compact || !forename || !surname || surname.length < 3) return false;
  if (compact.includes(surname)) return true;
  const stemLength = Math.min(surname.length, 4);
  const surnameStem = surname.slice(0, stemLength);
  const idx = compact.indexOf(surnameStem);
  if (idx < 0) return false;
  const prefix = compact.slice(0, idx);
  if (!prefix) return false;
  return prefix === forename[0] || forename.startsWith(prefix);
}

/**
 * Classify every same-institution mailbox with deterministic ownership evidence.
 * Exact full-name forms are strongest. Initials/surname and bare-surname forms
 * require the candidate in the page title or sole H1. Exact URL-slug and narrow
 * preceding-name adjacency remain lower-ranked fallbacks for opaque mailboxes.
 * A unique best-ranked address wins; equal-best ties abstain.
 */
function selectGroundedEmailWithEvidence(
  name,
  text,
  emails,
  verifiedDomain,
  {
    identityText = '',
    titleText = '',
    h1Texts = [],
    pageUrl = '',
  } = {},
) {
  const parsed = parseCandidateName(name);
  if (!parsed || !Array.isArray(emails) || !emails.length) return null;
  const ASSOC_WINDOW = 100;
  const identityZone = `${identityText} ${text.slice(0, 800)}`;
  const pageIdentifiesCandidate = windowNamesCandidate(identityZone, parsed);
  const strongPageIdentity = pageHasStrongCandidateIdentity(parsed, { titleText, h1Texts });
  const slug = pageIdentifiesCandidate ? personalPageSlug(pageUrl) : null;
  const classified = [];
  for (const { email, index } of emails) {
    if (!emailDomainRelated(email, verifiedDomain)) continue;
    const precedingWindow = text.slice(Math.max(0, index - ASSOC_WINDOW), index);
    const localPart = email.slice(0, email.indexOf('@')).toLowerCase();
    // The fallback requires the full forename, not just an initial. Otherwise a
    // nearby "Peter Hemmer" line can be misread as Philip Hemmer ownership.
    const adjacency = precedingWindowNamesCandidate(precedingWindow, parsed);
    const match = mailboxMatch(localPart, parsed, {
      strongPageIdentity,
      pageIdentifiesCandidate,
      slug,
      adjacency,
    });
    classified.push({
      email,
      matchClass: match?.matchClass || null,
      ownershipProof: match?.ownershipProof || null,
      rank: match ? MAILBOX_MATCH_RANK[match.matchClass] : null,
    });
  }
  const matched = classified.filter((entry) => Number.isFinite(entry.rank));
  if (!matched.length) return null;
  const bestRank = Math.min(...matched.map((entry) => entry.rank));
  const winners = matched.filter((entry) => entry.rank === bestRank);
  if (winners.length !== 1) return null;
  const winner = winners[0];
  return {
    email: winner.email,
    matchClass: winner.matchClass,
    ownershipProof: winner.ownershipProof,
    alternatives: classified
      .filter((entry) => entry.email !== winner.email)
      .slice(0, 8)
      .map(({ email, matchClass }) => ({
        email,
        matchClass: matchClass || 'unmatched',
      })),
  };
}

function selectGroundedEmail(name, text, emails, verifiedDomain, opts = {}) {
  return selectGroundedEmailWithEvidence(name, text, emails, verifiedDomain, opts)?.email || null;
}

/** Captured profile/lab URLs to try, most person-specific first; drop search/aggregator links. */
function orderCandidateUrls(ce, name) {
  const parsed = parseCandidateName(name);
  const surname = parsed?.surname || '';
  const skipHost = /(^|\.)(scholar\.google\.|google\.|orcid\.org|researchgate\.net|linkedin\.com)/i;
  const urls = [ce.facultyPageUrl, ce.website].filter((u) => typeof u === 'string' && u.trim());
  const seen = new Set();
  const cleaned = [];
  for (const u of urls) {
    let host;
    try { host = new URL(u).hostname; } catch { continue; }
    if (skipHost.test(host)) continue;
    // Never fetch a document/media file. facultyPageUrl from the Claude tier is
    // captured without isFacultyPageUrl's gate, so a PDF could reach here; the
    // shared document gate keeps the email tier off non-page files.
    if (ContactParser.isDocumentUrl(u)) continue;
    if (seen.has(u)) continue;
    seen.add(u);
    cleaned.push(u);
  }
  // Person-specific (surname/name token in the URL) first.
  return cleaned.sort((a, b) => {
    const aHit = surname && a.toLowerCase().includes(surname) ? 0 : 1;
    const bHit = surname && b.toLowerCase().includes(surname) ? 0 : 1;
    return aHit - bHit;
  });
}

/**
 * Fetch a captured faculty/profile page (SSRF-bound to anchored institution domains)
 * and recover a page-grounded institutional email. Runs only behind the
 * REVIEWER_PAGE_EMAIL_TIER_ENABLED flag, only when the domain is verified, and only
 * when there is no trusted email yet (a low-trust serp/claude email may be
 * replaced). Best-effort: every error is recorded and swallowed EXCEPT a
 * deadline/cancel abort, which propagates like the other tiers. Mutates
 * result.contactEnrichment in place.
 */
async function attachEmailFromResolvedPage(candidate, result, { signal, deadlineAt, onProgress = () => {} } = {}) {
  if (process.env.REVIEWER_PAGE_EMAIL_TIER_ENABLED !== 'true') return;
  const ce = result.contactEnrichment;
  if (!ce) return;
  const anchoredDomains = Array.isArray(ce.anchoredInstitutionDomains) && ce.anchoredInstitutionDomains.length
    ? ce.anchoredInstitutionDomains
    : (ce.verifiedInstitutionDomain ? [ce.verifiedInstitutionDomain] : []);
  if (!anchoredDomains.length) return;
  const replaceable = !ce.email || SEARCH_EMAIL_SOURCES.has(ce.emailSource) || ce.emailSource === 'search_contested';
  if (!replaceable) return; // an already-trusted email (orcid/pubmed/affiliation) wins

  const urls = orderCandidateUrls(ce, candidate.name);
  if (!urls.length) return;

  for (const url of urls) {
    if (signal?.aborted) throw abortError(signal);
    let host;
    try { host = new URL(url).hostname; } catch { continue; }
    const verifiedDomain = anchoredDomains.find((domain) => hostWithinDomain(host, domain));
    if (!verifiedDomain) {
      ce.tierResults.institution_page = { url, skipped: 'host_not_in_verified_domain' };
      continue;
    }
    const remainingMs = deadlineAt != null ? Math.max(1, deadlineAt - Date.now()) : 8000;
    const timeoutMs = Math.min(8000, remainingMs);
    try {
      onProgress({ tier: 5, status: 'searching', message: `Reading ${host} for a contact email…` });
      const page = await safeFetchInstitutionPage(url, { allowedDomain: verifiedDomain, signal, timeoutMs });
      if (!page || !page.ok || !page.text) {
        ce.tierResults.institution_page = { url, skipped: page ? `status_${page.status}` : 'no_response' };
        continue;
      }
      const {
        text,
        identityText,
        titleText,
        h1Texts,
        emails,
      } = ContactParser.extractEmailsFromHtml(page.text);
      const grounded = selectGroundedEmailWithEvidence(candidate.name, text, emails, verifiedDomain, {
        identityText,
        titleText,
        h1Texts,
        pageUrl: page.finalUrl || url,
      });
      if (grounded) {
        ce.email = grounded.email;
        ce.emailSource = 'institution_page';
        ce.emailEvidence = {
          sourceKind: 'institution_page',
          sourceUrl: page.finalUrl || url,
          sourceTitle: null,
          citedText: null,
          ownershipProof: grounded.ownershipProof,
          matchClass: grounded.matchClass,
          alternatives: grounded.alternatives,
          observedAt: new Date().toISOString(),
        };
        ce.emailIsRecent = true;
        ce.emailPersistAllowed = true;
        ce.facultyPageUrl = ce.facultyPageUrl || (page.finalUrl || url);
        ce.contactStatus = null;
        ce.contactStatusReason = null;
        ce.tierResults.institution_page = {
          url: page.finalUrl || url,
          email: grounded.email,
          grounding: grounded.ownershipProof,
          matchClass: grounded.matchClass,
        };
        onProgress({ tier: 5, status: 'found', message: 'Found a verified institutional email on the faculty page' });
        return;
      }
      ce.tierResults.institution_page = { url, skipped: 'no_grounded_email' };
    } catch (err) {
      if (signal?.aborted) throw err;
      ce.tierResults.institution_page = { url, error: err.message };
    }
  }
}

module.exports = {
  normForNameMatch,
  parseCandidateName,
  emailDomainRelated,
  windowNamesCandidate,
  personalPageSlug,
  slugNamesCandidate,
  normalizeMailboxLocal,
  pageHasStrongCandidateIdentity,
  precedingWindowNamesCandidate,
  mailboxMatch,
  selectGroundedEmailWithEvidence,
  selectGroundedEmail,
  orderCandidateUrls,
  attachEmailFromResolvedPage,
};
