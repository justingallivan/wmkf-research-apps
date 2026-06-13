const { safeFetch } = require('../utils/safe-fetch.js');
const { ContactParser } = require('../utils/contact-parser');
// Checksum-validating ORCID normalizer (shared). Aliased so it doesn't collide
// with the local prefix-strip `normalizeOrcid` used by mapAuthorRecord on OUTPUT
// records. Used to validate the INPUT orcid before building the author-lookup URL
// (a mis-entered ORCID must fail closed → null, not produce a wrong lookup) —
// Codex S240 #12.
const { normalizeOrcid: validateOrcidChecked } = require('../utils/orcid-normalize');

const OPENALEX_AUTHOR_BASE_URL = 'https://api.openalex.org/authors';
const OPENALEX_WORK_BASE_URL = 'https://api.openalex.org/works';
const OPENALEX_INSTITUTION_BASE_URL = 'https://api.openalex.org/institutions';
// OpenAlex polite-pool contact, configured via the OPENALEX_POLITE_MAILTO env var
// (set in Vercel; see docs/CREDENTIALS_RUNBOOK.md). A real, monitored, non-secret
// mailbox OpenAlex uses only to reach us about API usage. Unset (local/test) →
// common pool, no contact email sent. Never hardcode a fabricated address here.
const OPENALEX_POLITE_MAILTO = process.env.OPENALEX_POLITE_MAILTO || null;
const DEFAULT_LIMIT = 10;
const DEFAULT_TIMEOUT_MS = 5000;

function composeSignals(signal, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => {
    const err = new Error('openalex_timeout');
    err.code = 'openalex_timeout';
    timeoutController.abort(err);
  }, timeoutMs);

  if (!signal) {
    return { signal: timeoutController.signal, cleanup: () => clearTimeout(timeoutId) };
  }

  if (signal.aborted) {
    clearTimeout(timeoutId);
    return { signal, cleanup: () => {} };
  }

  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.any === 'function') {
    return {
      signal: AbortSignal.any([signal, timeoutController.signal]),
      cleanup: () => clearTimeout(timeoutId),
    };
  }

  const combined = new AbortController();
  const abort = (event) => combined.abort(event?.target?.reason || new Error('openalex_aborted'));
  signal.addEventListener('abort', abort, { once: true });
  timeoutController.signal.addEventListener('abort', abort, { once: true });
  return {
    signal: combined.signal,
    cleanup: () => {
      clearTimeout(timeoutId);
      signal.removeEventListener('abort', abort);
      timeoutController.signal.removeEventListener('abort', abort);
    },
  };
}

function retryableStatus(status) {
  return status === 429 || status >= 500;
}

async function fetchJsonWithRetry(url, { signal, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  let lastError = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const composed = composeSignals(signal, timeoutMs);
    try {
      const response = await safeFetch(url, {
        headers: {
          Accept: 'application/json',
          'User-Agent': OPENALEX_POLITE_MAILTO
            ? `WMKF-Reviewer-Finder/1.0 (mailto:${OPENALEX_POLITE_MAILTO})`
            : 'WMKF-Reviewer-Finder/1.0',
        },
        signal: composed.signal,
      });

      if (!response.ok) {
        const err = new Error(`OpenAlex request failed: ${response.status}`);
        err.status = response.status;
        if (retryableStatus(response.status) && attempt === 0) {
          lastError = err;
          await new Promise((resolve) => setTimeout(resolve, 100));
          continue;
        }
        throw err;
      }

      return response.json();
    } catch (err) {
      lastError = err;
      if (err?.name === 'AbortError' || err?.code === 'openalex_timeout' || err?.status < 500 || attempt > 0) {
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    } finally {
      composed.cleanup();
    }
  }

  throw lastError || new Error('OpenAlex request failed');
}

function normalizeOrcid(orcid) {
  if (!orcid) return null;
  const value = String(orcid).trim();
  return value.replace(/^https?:\/\/orcid\.org\//i, '') || null;
}

function topTopics(record) {
  const concepts = Array.isArray(record?.x_concepts) ? record.x_concepts : [];
  const maxScore = Math.max(0, ...concepts.map((concept) => Number(concept?.score || 0)));
  const threshold = maxScore > 1 ? 25 : 0.25;
  return concepts
    .filter((concept) => Number(concept?.score || 0) > threshold && concept?.display_name)
    .slice(0, 8)
    .map((concept) => concept.display_name);
}

function mapAuthorRecord(record = {}) {
  // OpenAlex returns `last_known_institutions` (plural array) on the current API;
  // the singular `last_known_institution` is deprecated and absent live. Read the
  // array first (fall back to the singular only for legacy/cached shapes).
  const lastInst = record.last_known_institutions?.[0] || record.last_known_institution || null;
  const stats = record.summary_stats || {};
  return {
    openAlexId: record.id || null,
    displayName: record.display_name || null,
    orcid: normalizeOrcid(record.orcid),
    lastKnownInstitution: lastInst?.display_name || null,
    // Institution refs for the Slice 1b verified-domain lookup (getInstitution):
    // the OpenAlex institution id (`I…`) is the canonical key; ROR is a fallback.
    lastKnownInstitutionId: lastInst?.id || null,
    lastKnownInstitutionRor: lastInst?.ror || null,
    // Bibliometrics (Slice 1b — replaces SerpAPI google_scholar_author). OpenAlex
    // author objects carry `summary_stats.{h_index,i10_index}` + top-level
    // `cited_by_count` by default (verified live S250: h=24, i10=32, cites=5577).
    // Null when absent — never fabricated.
    hIndex: Number.isFinite(stats.h_index) ? stats.h_index : null,
    i10Index: Number.isFinite(stats.i10_index) ? stats.i10_index : null,
    citedByCount: Number.isFinite(record.cited_by_count) ? record.cited_by_count : null,
    topics: topTopics(record),
    worksCount: Number(record.works_count || 0),
  };
}

function normalizeDoi(doi) {
  if (!doi) return null;
  return String(doi).trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').replace(/^doi:/i, '') || null;
}

function normalizePmid(pmid) {
  if (!pmid) return null;
  const value = String(pmid).trim().replace(/^pmid:/i, '');
  return value || null;
}

function firstInstitution(authorship = {}) {
  const institutions = Array.isArray(authorship.institutions) ? authorship.institutions : [];
  return institutions[0]?.display_name || null;
}

function authorshipTopics(work = {}, author = {}) {
  // OpenAlex *works* expose `concepts` (authors expose `x_concepts`). Read the work's
  // `concepts` (fall back to the deprecated `x_concepts` for legacy/cached shapes);
  // the author object inside a work's authorships carries no concepts, so this is the
  // real topic source alongside `primary_topic`.
  const concepts = Array.isArray(author.x_concepts) && author.x_concepts.length
    ? author.x_concepts
    : (Array.isArray(work.concepts) ? work.concepts : (Array.isArray(work.x_concepts) ? work.x_concepts : []));
  const topics = [];
  if (work.primary_topic?.display_name) topics.push(work.primary_topic.display_name);
  topics.push(...topTopics({ x_concepts: concepts }));
  return Array.from(new Set(topics.filter(Boolean))).slice(0, 8);
}

// OpenAlex author ids come back as full URLs (`https://openalex.org/A5023888391`); the
// `/works?filter=author.id:` filter accepts either form, but normalize to the canonical
// short id to be safe (Codex design review).
function shortOpenAlexId(id) {
  const s = String(id || '').trim();
  if (!s) return null;
  const m = s.match(/A\d+$/i);
  return m ? m[0].toUpperCase() : s;
}

// Canonical short OpenAlex institution id (`I…`) extracted from a URL/bare form, for
// the `/institutions/I…` lookup. Returns null if no `I\d+` token is present.
function shortOpenAlexInstitutionId(id) {
  const m = String(id || '').match(/I\d+/i);
  return m ? m[0].toUpperCase() : null;
}

// Multi-label public suffixes common to academic homepages, where the registrable
// domain (eTLD+1) is the LAST THREE labels, not two (e.g. `www.ox.ac.uk` → `ox.ac.uk`,
// not `ac.uk`). This is a curated academic subset, NOT the full Public Suffix List —
// it covers the institution homepages this guard sees; anything else falls back to the
// last two labels. The guard that consumes the result (_validateEmailAgainstVerifiedDomain)
// is keep-biased and label-boundary-matched, so an over-broad fallback can only fail to
// match, never wrongly drop a real email.
const MULTI_LABEL_SUFFIXES = new Set([
  'ac.uk', 'ac.jp', 'ac.nz', 'ac.za', 'ac.in', 'ac.kr', 'ac.cn', 'ac.il', 'ac.at', 'ac.be',
  'edu.au', 'edu.cn', 'edu.sg', 'edu.hk', 'edu.tw', 'edu.in', 'edu.br', 'edu.mx', 'edu.my',
  'edu.pl', 'edu.tr', 'edu.sa', 'edu.eg', 'edu.co', 'edu.ar', 'edu.pe', 'edu.gr',
  'co.jp', 'co.uk', 'co.in', 'com.au', 'com.br', 'com.cn', 'or.jp', 'go.jp', 'gov.uk',
  'res.in', 'gob.mx', 'edu.es',
]);

// Extract the registrable domain (eTLD+1) from an institution homepage URL. Strips the
// scheme/path/port, lowercases, drops a leading `www.`, and reduces to eTLD+1 using the
// curated multi-label-suffix list above (else the last two labels). `https://web.mit.edu`
// → `mit.edu`; `https://www.ox.ac.uk/` → `ox.ac.uk`. Returns null when no host is present.
function registrableDomainFromUrl(url) {
  if (!url) return null;
  let host = String(url).trim().toLowerCase();
  host = host.replace(/^[a-z][a-z0-9+.-]*:\/\//, ''); // strip scheme
  host = host.split(/[/?#]/)[0];                       // strip path/query/fragment
  host = host.split('@').pop();                        // strip any userinfo
  host = host.split(':')[0];                           // strip port
  host = host.replace(/\.$/, '');                      // strip trailing dot
  if (!host || !host.includes('.')) return host || null;
  const labels = host.split('.').filter(Boolean);
  if (labels.length <= 2) return labels.join('.');
  const lastTwo = labels.slice(-2).join('.');
  if (MULTI_LABEL_SUFFIXES.has(lastTwo) && labels.length >= 3) {
    return labels.slice(-3).join('.');
  }
  return lastTwo;
}

function mapInstitutionRecord(record = {}) {
  const homepageUrl = record.homepage_url || null;
  return {
    openAlexId: record.id || null,
    displayName: record.display_name || null,
    ror: record.ror || null,
    homepageUrl,
    domain: registrableDomainFromUrl(homepageUrl),
  };
}

function mapWorkRecord(record = {}) {
  return {
    openAlexId: record.id || null,
    title: record.display_name || record.title || null,
    // Display-safe fields for the candidate card's publication list ({title, year, url} —
    // the persisted roster shape). OpenAlex returns `doi` as a full https://doi.org/… URL;
    // fall back to the OpenAlex work landing page.
    year: Number.isFinite(record.publication_year) ? record.publication_year : null,
    url: record.doi || record.id || null,
    doi: normalizeDoi(record.doi),
    pmid: normalizePmid(record.ids?.pmid),
    arxivId: record.ids?.arxiv || null,
    authorships: (Array.isArray(record.authorships) ? record.authorships : []).map((authorship) => {
      const author = authorship.author || {};
      return {
        openAlexAuthorId: author.id || null,
        displayName: author.display_name || authorship.raw_author_name || null,
        orcid: normalizeOrcid(author.orcid || authorship.raw_orcid),
        institution: firstInstitution(authorship),
        topics: authorshipTopics(record, author),
        raw: authorship,
      };
    }),
    raw: record,
  };
}

class OpenAlexService {
  static async searchAuthors(name, { signal, limit = DEFAULT_LIMIT, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    // Strip honorifics ("Prof."/"Dr."/…) before the search: the analyze stage emits
    // titled names ("Prof. Ursula Keller") and OpenAlex's author search treats the
    // honorific as a name token, returning the wrong namesake or zero hits (e.g.
    // "Prof. Ursula Keller" → Ursula Spichiger-Keller, not U. Keller @ ETH; "Prof.
    // Reinhard Dörner" → 0 results). Unstripped, the spine abstained on every titled
    // suggestion. See ContactParser.stripHonorifics (shared canonical stripper).
    const query = ContactParser.stripHonorifics(String(name || '')).trim();
    if (!query) return { totalCount: 0, records: [] };

    const params = new URLSearchParams({
      search: query,
      'per-page': String(Math.max(1, Math.min(Number(limit) || DEFAULT_LIMIT, 25))),
    });
    if (OPENALEX_POLITE_MAILTO) params.set('mailto', OPENALEX_POLITE_MAILTO);

    const data = await fetchJsonWithRetry(`${OPENALEX_AUTHOR_BASE_URL}?${params.toString()}`, { signal, timeoutMs });
    return {
      totalCount: Number(data?.meta?.count || 0),
      records: (Array.isArray(data?.results) ? data.results : []).map(mapAuthorRecord),
    };
  }

  /**
   * Resolve an ORCID to its single canonical OpenAlex author record. ORCID is the
   * hard identity key, so this carries no name-search namesake hazard (unlike
   * searchAuthors). Used to resolve the structured proposal PI (request Project
   * Leader → contact wmkf_orcid → this) for exclusion + COI.
   *
   * The input ORCID is checksum-validated first; a malformed/invalid value returns
   * null rather than building a wrong lookup URL. OpenAlex resolves the ORCID via
   * the PATH form `/authors/https://orcid.org/<id>` (validated live in the S239
   * probe; the embedded URL is NOT percent-encoded — the encoded form 404s) and
   * returns a SINGLE author object, not a `{ results: [] }` list. A 404 (no
   * OpenAlex record for that ORCID) returns null; other errors propagate.
   *
   * @param {string} orcid - bare/hyphenated/URL-form ORCID
   * @returns {Promise<object|null>} mapAuthorRecord shape, or null when unresolvable
   */
  static async getAuthorByOrcid(orcid, { signal, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    const checked = validateOrcidChecked(orcid);
    if (!checked || checked.state !== 'valid') return null;

    const params = new URLSearchParams();
    if (OPENALEX_POLITE_MAILTO) params.set('mailto', OPENALEX_POLITE_MAILTO);
    const qs = params.toString();
    const url = `${OPENALEX_AUTHOR_BASE_URL}/https://orcid.org/${checked.id}${qs ? `?${qs}` : ''}`;

    let data;
    try {
      data = await fetchJsonWithRetry(url, { signal, timeoutMs });
    } catch (err) {
      if (err?.status === 404) return null;
      throw err;
    }
    // Single-object endpoint; tolerate a defensive `results` wrapper just in case
    // a future API shape changes (Codex S240 #10).
    const record = data && Array.isArray(data.results) ? data.results[0] : data;
    if (!record || !record.id) return null;
    return mapAuthorRecord(record);
  }

  /**
   * Fetch a single OpenAlex author by its canonical id (`A…` short form or full URL).
   * Used by the Slice 1b enrichment metrics step on the NO-ORCID path, to fetch
   * bibliometrics for an author the discovery spine already resolved (the candidate
   * carries `openAlexId` + `identityStatus`) — so the spine isn't re-run in the hot
   * path. The id is identity-anchored upstream (spine verdict); this only adds metrics.
   * A 404 (stale/merged id) returns null; other errors propagate.
   *
   * @param {string} authorId - OpenAlex author id (short `A…` or full URL)
   * @returns {Promise<object|null>} mapAuthorRecord shape, or null when unresolvable
   */
  static async getAuthorById(authorId, { signal, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    const id = shortOpenAlexId(authorId);
    if (!id || !/^A\d+$/i.test(id)) return null;

    const params = new URLSearchParams();
    if (OPENALEX_POLITE_MAILTO) params.set('mailto', OPENALEX_POLITE_MAILTO);
    const qs = params.toString();
    const url = `${OPENALEX_AUTHOR_BASE_URL}/${id}${qs ? `?${qs}` : ''}`;

    let data;
    try {
      data = await fetchJsonWithRetry(url, { signal, timeoutMs });
    } catch (err) {
      if (err?.status === 404) return null;
      throw err;
    }
    const record = data && Array.isArray(data.results) ? data.results[0] : data;
    if (!record || !record.id) return null;
    return mapAuthorRecord(record);
  }

  /**
   * Resolve an OpenAlex institution (by canonical OpenAlex id `I…`, preferred, or ROR)
   * to its homepage-derived registrable domain. Slice 1b re-sources the verified-email
   * domain guard from the ORCID/spine-anchored author's institution (better-anchored than
   * Scholar's self-reported "Verified email at X" hint). Returns
   * `{ openAlexId, displayName, ror, homepageUrl, domain }`, or null when unresolvable
   * (no id, 404, or no homepage). A 404 returns null; other errors propagate.
   *
   * @param {string} rorOrId - OpenAlex institution id (`I…`/full URL) or a ROR (url/bare)
   * @returns {Promise<object|null>}
   */
  static async getInstitution(rorOrId, { signal, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    const raw = String(rorOrId || '').trim();
    if (!raw) return null;

    // Prefer the canonical OpenAlex institution id (`/institutions/I…`); fall back to the
    // ROR path form (`/institutions/https://ror.org/<id>`, NOT percent-encoded — mirrors
    // the verified getAuthorByOrcid path form).
    const shortId = shortOpenAlexInstitutionId(raw);
    let path;
    if (shortId) {
      path = shortId;
    } else {
      const rorMatch = raw.match(/(?:https?:\/\/ror\.org\/)?([0-9a-z]{9})$/i);
      if (!rorMatch) return null;
      path = `https://ror.org/${rorMatch[1].toLowerCase()}`;
    }

    const params = new URLSearchParams();
    if (OPENALEX_POLITE_MAILTO) params.set('mailto', OPENALEX_POLITE_MAILTO);
    const qs = params.toString();
    const url = `${OPENALEX_INSTITUTION_BASE_URL}/${path}${qs ? `?${qs}` : ''}`;

    let data;
    try {
      data = await fetchJsonWithRetry(url, { signal, timeoutMs });
    } catch (err) {
      if (err?.status === 404) return null;
      throw err;
    }
    const record = data && Array.isArray(data.results) ? data.results[0] : data;
    if (!record || !record.id) return null;
    return mapInstitutionRecord(record);
  }

  static async getWorkByExternalId(kind, value, { signal, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    const normalizedKind = String(kind || '').toLowerCase();
    const rawValue = String(value || '').trim();
    if (!rawValue) return { totalCount: 0, records: [] };

    const params = new URLSearchParams({ 'per-page': '5' });
    if (OPENALEX_POLITE_MAILTO) params.set('mailto', OPENALEX_POLITE_MAILTO);

    if (normalizedKind === 'doi') {
      params.set('filter', `doi:${normalizeDoi(rawValue)}`);
    } else if (normalizedKind === 'pmid') {
      params.set('filter', `ids.pmid:${normalizePmid(rawValue)}`);
    } else if (normalizedKind === 'arxiv') {
      // Live probe 2026-06-07: `ids.arxiv` is not a valid OpenAlex works
      // filter, so arXiv candidates fall back to the canonical arXiv DOI.
      params.set('filter', `doi:${normalizeDoi(`10.48550/arXiv.${rawValue}`)}`);
    } else {
      throw new Error(`Unsupported OpenAlex work id kind: ${kind}`);
    }

    const data = await fetchJsonWithRetry(`${OPENALEX_WORK_BASE_URL}?${params.toString()}`, { signal, timeoutMs });
    return {
      totalCount: Number(data?.meta?.count || 0),
      records: (Array.isArray(data?.results) ? data.results : []).map(mapWorkRecord),
    };
  }

  static async getWorkByTitle(title, { signal, timeoutMs = DEFAULT_TIMEOUT_MS, limit = 5 } = {}) {
    const query = String(title || '').trim();
    if (!query) return { totalCount: 0, records: [] };

    const params = new URLSearchParams({
      search: query,
      'per-page': String(Math.max(1, Math.min(Number(limit) || 5, 10))),
    });
    if (OPENALEX_POLITE_MAILTO) params.set('mailto', OPENALEX_POLITE_MAILTO);

    const data = await fetchJsonWithRetry(`${OPENALEX_WORK_BASE_URL}?${params.toString()}`, { signal, timeoutMs });
    return {
      totalCount: Number(data?.meta?.count || 0),
      records: (Array.isArray(data?.results) ? data.results : []).map(mapWorkRecord),
    };
  }

  /**
   * Most-recent works for a resolved OpenAlex author, newest first. Used to backfill the
   * publication LIST for candidates confirmed via the OpenAlex/ORCID identity paths (the
   * spine / Track-B), which attach identity + metrics but no works list. The works come from
   * the SAME confirmed author id, so they are identity-anchored (no namesake risk).
   *
   * @param {string} authorId - OpenAlex author id (short `A…` or full URL).
   * @returns {Promise<{ totalCount: number, records: Array }>} records are mapWorkRecord shape (incl. year/url).
   */
  static async getWorksByAuthor(authorId, { signal, timeoutMs = DEFAULT_TIMEOUT_MS, limit = 5 } = {}) {
    const id = shortOpenAlexId(authorId);
    if (!id) return { totalCount: 0, records: [] };

    const params = new URLSearchParams({
      filter: `author.id:${id}`,
      sort: 'publication_date:desc',
      'per-page': String(Math.max(1, Math.min(Number(limit) || 5, 25))),
    });
    if (OPENALEX_POLITE_MAILTO) params.set('mailto', OPENALEX_POLITE_MAILTO);

    const data = await fetchJsonWithRetry(`${OPENALEX_WORK_BASE_URL}?${params.toString()}`, { signal, timeoutMs });
    return {
      totalCount: Number(data?.meta?.count || 0),
      records: (Array.isArray(data?.results) ? data.results : []).map(mapWorkRecord),
    };
  }
}

module.exports = {
  OpenAlexService,
  OPENALEX_POLITE_MAILTO,
  // Exported for unit tests (registrable-domain extraction feeds the verified-domain guard).
  registrableDomainFromUrl,
};
