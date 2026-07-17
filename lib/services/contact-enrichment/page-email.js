/**
 * ContactEnrichmentService — resolved-page email tier cluster
 * (docs/RESOLVED_PAGE_EMAIL_TIER_DESIGN.md).
 *
 * Stage 5 of the ContactEnrichmentService decomposition
 * (docs/CONTACT_ENRICHMENT_SERVICE_DECOMPOSITION_PLAN.md). Behavior-freeze, pure
 * code motion: the 9 resolved-page-email helpers moved verbatim out of
 * contact-enrichment-service.js; internal `this._x(...)` self-calls became
 * direct sibling-function calls. The facade keeps a thin delegating wrapper for
 * each. Depends on domain-evidence (`domainRelated`, `emailDomain`), safe-fetch,
 * ContactParser, and constants (`SEARCH_EMAIL_SOURCES`) / abort (`abortError`)
 * — all stateless.
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
    .replace(/[.,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Forename + surname tokens for the page forename-gate; null if <2 name tokens. */
function parseCandidateName(name) {
  const tokens = normForNameMatch(ContactParser.stripHonorifics(name || ''))
    .split(/\s+/)
    .filter((t) => t.length >= 2);
  if (tokens.length < 2) return null;
  return { forename: tokens[0], surname: tokens[tokens.length - 1] };
}

/** Email's domain is related to the verified institution domain (email-validation relation). */
function emailDomainRelated(email, verifiedDomain) {
  return domainRelated(emailDomain(email), verifiedDomain);
}

/** True when a text window names the candidate with ordered, near-contiguous evidence. */
function windowNamesCandidate(window, { forename, surname }) {
  if (!forename || !surname || surname.length < 3) return false;
  const tokens = normForNameMatch(window).split(/\s+/).filter(Boolean);
  const NEAR = 3;
  const isForename = (token) => token === forename || token === forename[0];
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
 * Select a page-grounded email. Among emails whose domain is related to the
 * verified institution domain, keep only those ASSOCIATED with the candidate, by
 * EITHER route:
 *   (a) name-adjacency — the candidate's name (surname + forename/initial) appears
 *       within a small window of the email; OR
 *   (b) page-owner match — the page IDENTIFIES the candidate (their name is in the
 *       <title>/<h1..3>) AND the email's local part equals the URL personal-page
 *       slug (e.g. `/~phbuck/` ↔ `phbuck@`). This recovers a first-person
 *       "contact me: phbuck@…" block whose address is nowhere near the name.
 * Return the address iff exactly one distinct candidate-associated email exists;
 * otherwise abstain. This is the trust gate — NOT isNameConsistentEmail (which
 * rejects opaque local parts like `phbuck`). Route (b) needs BOTH page-identity
 * and the slug↔local-part match, so a group roster's other members and a lone
 * lab-admin address stay out.
 */
function selectGroundedEmail(name, text, emails, verifiedDomain, { identityText = '', pageUrl = '' } = {}) {
  const parsed = parseCandidateName(name);
  if (!parsed || !Array.isArray(emails) || !emails.length) return null;
  const ASSOC_WINDOW = 100;
  // Page-identity zone = <title>/<h1..3> PLUS the leading body region. Senior-faculty
  // pages are often hand-built (no proper <title>/<h1>) yet name the person near the
  // top (e.g. "Phil's CV / Philip Bucksbaum …"). The slug route below still also
  // requires localPart === the page's own URL handle, so widening identity here
  // cannot, by itself, attach a non-owner address.
  const identityZone = `${identityText} ${text.slice(0, 800)}`;
  const pageIdentifiesCandidate = windowNamesCandidate(identityZone, parsed);
  const slug = pageIdentifiesCandidate ? personalPageSlug(pageUrl) : null;
  const associated = new Set();
  for (const { email, index } of emails) {
    if (!emailDomainRelated(email, verifiedDomain)) continue;
    const window = text.slice(Math.max(0, index - ASSOC_WINDOW), index + ASSOC_WINDOW);
    const localPart = email.slice(0, email.indexOf('@')).toLowerCase();
    const adjacency = windowNamesCandidate(window, parsed);
    const ownerMatch = !!slug && localPart === slug && slugNamesCandidate(slug, parsed);
    if (adjacency || ownerMatch) associated.add(email);
  }
  return associated.size === 1 ? [...associated][0] : null;
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
      const { text, identityText, emails } = ContactParser.extractEmailsFromHtml(page.text);
      const grounded = selectGroundedEmail(candidate.name, text, emails, verifiedDomain, {
        identityText,
        pageUrl: page.finalUrl || url,
      });
      if (grounded) {
        ce.email = grounded;
        ce.emailSource = 'institution_page';
        ce.emailEvidence = {
          sourceKind: 'institution_page',
          sourceUrl: page.finalUrl || url,
          sourceTitle: null,
          citedText: null,
          ownershipProof: 'candidate_associated_unique',
          observedAt: new Date().toISOString(),
        };
        ce.emailIsRecent = true;
        ce.emailPersistAllowed = true;
        ce.facultyPageUrl = ce.facultyPageUrl || (page.finalUrl || url);
        ce.contactStatus = null;
        ce.contactStatusReason = null;
        ce.tierResults.institution_page = { url: page.finalUrl || url, email: grounded, grounding: 'candidate_associated_unique' };
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
  selectGroundedEmail,
  orderCandidateUrls,
  attachEmailFromResolvedPage,
};
