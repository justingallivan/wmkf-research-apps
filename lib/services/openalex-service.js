const psl = require('psl');
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
// Since February 2026, OpenAlex authenticates with OPENALEX_API_KEY; the old
// polite-pool `mailto` parameter is ignored. Keep the monitored contact in the
// User-Agent for operator identification, but never treat it as authentication.
const OPENALEX_POLITE_MAILTO = process.env.OPENALEX_POLITE_MAILTO || null;
const DEFAULT_LIMIT = 10;
const DEFAULT_TIMEOUT_MS = 5000;
const MAX_RETRY_ATTEMPTS = 3;
const MAX_RETRY_DELAY_MS = 5000;

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

function authenticatedOpenAlexUrl(url) {
  const apiKey = String(process.env.OPENALEX_API_KEY || '').trim();
  if (!apiKey) return url;
  const parsed = new URL(url);
  parsed.searchParams.set('api_key', apiKey);
  return parsed.toString();
}

function retryDelayMs(response, attempt) {
  const retryAfter = response?.headers?.get?.('retry-after');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(MAX_RETRY_DELAY_MS, Math.round(seconds * 1000));
    }
  }
  const reset = Number(response?.headers?.get?.('x-ratelimit-reset'));
  if (Number.isFinite(reset) && reset > 0) {
    const resetMs = reset > 1e12 ? reset : reset * 1000;
    return Math.min(MAX_RETRY_DELAY_MS, Math.max(0, resetMs - Date.now()));
  }
  return Math.min(MAX_RETRY_DELAY_MS, 250 * (2 ** attempt));
}

function abortableDelay(milliseconds, signal) {
  if (!milliseconds) return Promise.resolve();
  if (signal?.aborted) return Promise.reject(signal.reason || new Error('openalex_aborted'));
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    function onAbort() {
      clearTimeout(timeoutId);
      signal?.removeEventListener('abort', onAbort);
      reject(signal.reason || new Error('openalex_aborted'));
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function fetchJsonWithRetry(url, { signal, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  let lastError = null;
  const requestUrl = authenticatedOpenAlexUrl(url);

  for (let attempt = 0; attempt < MAX_RETRY_ATTEMPTS; attempt += 1) {
    const composed = composeSignals(signal, timeoutMs);
    try {
      const response = await safeFetch(requestUrl, {
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
        err.rateLimit = {
          remaining: response.headers?.get?.('x-ratelimit-remaining') || null,
          reset: response.headers?.get?.('x-ratelimit-reset') || null,
          retryAfter: response.headers?.get?.('retry-after') || null,
        };
        if (retryableStatus(response.status) && attempt < MAX_RETRY_ATTEMPTS - 1) {
          lastError = err;
          composed.cleanup();
          await abortableDelay(retryDelayMs(response, attempt), signal);
          continue;
        }
        throw err;
      }

      return response.json();
    } catch (err) {
      lastError = err;
      if (err?.name === 'AbortError' || err?.code === 'openalex_timeout' || err?.status < 500
        || attempt >= MAX_RETRY_ATTEMPTS - 1) {
        throw err;
      }
      composed.cleanup();
      await abortableDelay(250 * (2 ** attempt), signal);
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

// Extract the registrable domain (eTLD+1) from an institution homepage URL, using the
// canonical Mozilla Public Suffix List (`psl`). Strips the scheme/userinfo/port/path,
// lowercases, then `psl.get(host)`: `https://web.mit.edu` → `mit.edu`; `https://www.ox.ac.uk/`
// → `ox.ac.uk`; `https://www.university.edu.ph` → `university.edu.ph`; `https://www.alpha.school.ge`
// → `alpha.school.ge`. FAILS CLOSED — returns null — when there is no safe eTLD+1 (a bare public
// suffix like `edu.ph`, an IP literal, or an unparseable host), so the keep-biased email-domain
// guard (`_validateEmailAgainstVerifiedDomain`) skips rather than over-matching a sibling
// namesake. The full PSL replaces an earlier hand-rolled suffix heuristic that kept leaking the
// next omitted educational suffix (Codex S251: `edu.ph`, then `school.ge`).
function registrableDomainFromUrl(url) {
  if (!url) return null;
  let host = String(url).trim().toLowerCase();
  host = host.replace(/^[a-z][a-z0-9+.-]*:\/\//, ''); // strip scheme
  host = host.split(/[/?#]/)[0];                       // strip path/query/fragment
  host = host.split('@').pop();                        // strip any userinfo
  host = host.split(':')[0];                           // strip port
  host = host.replace(/\.$/, '');                      // strip trailing dot
  if (!host || !host.includes('.')) return null;
  // Reject IPv4 literals — `psl.get('127.0.0.1')` returns a bogus '0.1'. An institution
  // homepage being a bare IP is implausible; fail closed.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return null;
  return psl.get(host) || null;
}

function mapInstitutionRecord(record = {}) {
  const homepageUrl = record.homepage_url || null;
  return {
    openAlexId: record.id || null,
    displayName: record.display_name || null,
    ror: record.ror || null,
    country: record.country_code || null,
    homepageUrl,
    domain: registrableDomainFromUrl(homepageUrl),
    associatedInstitutions: (Array.isArray(record.associated_institutions)
      ? record.associated_institutions
      : [])
      .map((institution) => ({
        openAlexId: institution?.id || null,
        displayName: institution?.display_name || null,
        ror: institution?.ror || null,
        country: institution?.country_code || null,
        relationship: institution?.relationship || null,
      }))
      .filter((institution) => institution.openAlexId || institution.ror),
  };
}

// Reconstruct a work's abstract from OpenAlex's `abstract_inverted_index`
// ({ word: [positions…] }) — OpenAlex does not return a plain-text abstract. Places each
// token at its position(s) and joins. Returns null when absent/empty. Bounded to keep a
// pathological index from producing a huge string (the literature layer truncates further).
function reconstructAbstract(invertedIndex) {
  if (!invertedIndex || typeof invertedIndex !== 'object' || Array.isArray(invertedIndex)) return null;
  const positions = [];
  for (const [word, idxs] of Object.entries(invertedIndex)) {
    if (!Array.isArray(idxs)) continue;
    for (const i of idxs) {
      if (Number.isInteger(i) && i >= 0 && i < 20000) positions[i] = word;
    }
  }
  const text = positions.filter((w) => w != null).join(' ').trim();
  return text ? text.slice(0, 5000) : null;
}

function mapWorkRecord(record = {}) {
  return {
    openAlexId: record.id || null,
    title: record.display_name || record.title || null,
    // Citation count + reconstructed abstract (Slice 2 — literature/PI-pubs novelty context).
    // Null when absent; never fabricated.
    citedByCount: Number.isFinite(record.cited_by_count) ? record.cited_by_count : null,
    abstract: reconstructAbstract(record.abstract_inverted_index),
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
   * Resolve an ORCID to the RICHEST OpenAlex author entity sharing that ORCID.
   *
   * OpenAlex sometimes splits one ORCID across multiple author entities — e.g. a
   * full 139-work record AND a 1-work stub, both carrying the same ORCID. The
   * single-object `getAuthorByOrcid` (path form) returns OpenAlex's canonical pick,
   * which can be the sparse stub (observed live: ORCID 0000-0002-8194-8439 →
   * a 1-work entity over the real 139-work one), making bibliometrics read
   * "1 publication, h-index 0". This queries the `?filter=orcid:<id>` LIST form,
   * which returns EVERY entity for the ORCID, and returns the richest by
   * works_count (tiebreak h-index, then citations). ORCID is the hard identity key,
   * so every returned entity is the same person — picking the richest is safe and
   * only improves the metrics source. The returned record carries the looked-up
   * ORCID, so a caller's `acceptPath:'orcid'` gate (record orcid === claimed) holds.
   *
   * Falls back to the canonical `getAuthorByOrcid` when the list form yields nothing
   * (or errors), so it never regresses below today's behavior. Returns null on an
   * invalid ORCID without calling the API.
   *
   * @param {string} orcid - bare/hyphenated/URL-form ORCID
   * @returns {Promise<object|null>} richest mapAuthorRecord, or null when unresolvable
   */
  static async getRichestAuthorByOrcid(orcid, { signal, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    const checked = validateOrcidChecked(orcid);
    if (!checked || checked.state !== 'valid') return null;

    const params = new URLSearchParams({ filter: `orcid:${checked.id}`, 'per-page': '100' });

    let records;
    try {
      const data = await fetchJsonWithRetry(`${OPENALEX_AUTHOR_BASE_URL}?${params.toString()}`, { signal, timeoutMs });
      // The query is constrained to this ORCID, so every result is the same person.
      records = (Array.isArray(data?.results) ? data.results : [])
        .map(mapAuthorRecord)
        .filter((r) => r.openAlexId);
    } catch (err) {
      // Match getAuthorByOrcid's error contract: a 404 means "no list" → fall back to
      // the canonical single (which also maps 404→null). Abort/timeout/transient errors
      // PROPAGATE — a list-layer failure must NOT silently degrade to the stub-prone
      // canonical lookup (Codex post-impl MEDIUM); the caller treats it as best-effort.
      if (err?.status === 404) return this.getAuthorByOrcid(orcid, { signal, timeoutMs });
      throw err;
    }

    if (records.length === 0) {
      // List form succeeded but returned nothing: fall back to the canonical
      // single-entity lookup so we never do worse than the pre-fix behavior.
      return this.getAuthorByOrcid(orcid, { signal, timeoutMs });
    }

    // Richest first: works_count, then h-index, then citations. Deterministic.
    records.sort((a, b) =>
      (b.worksCount - a.worksCount)
      || ((b.hIndex ?? -1) - (a.hIndex ?? -1))
      || ((b.citedByCount ?? -1) - (a.citedByCount ?? -1))
    );
    return records[0];
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
   * to its canonical identity, associated institutions, and homepage-derived registrable
   * domain. Returns `{ openAlexId, displayName, ror, country, homepageUrl, domain,
   * associatedInstitutions }`, or null when the identifier is missing or unresolvable.
   * `domain` may be null when OpenAlex has no usable homepage. A 404 returns null; other
   * errors propagate.
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

  static async searchInstitutions(query, { signal, timeoutMs = DEFAULT_TIMEOUT_MS, limit = 3 } = {}) {
    const search = String(query || '').trim();
    if (!search) return [];
    const params = new URLSearchParams({
      search,
      'per-page': String(Math.max(1, Math.min(Number(limit) || 3, 10))),
    });
    const data = await fetchJsonWithRetry(`${OPENALEX_INSTITUTION_BASE_URL}?${params.toString()}`, { signal, timeoutMs });
    return (Array.isArray(data?.results) ? data.results : []).map(mapInstitutionRecord);
  }

  static async getWorkByExternalId(kind, value, { signal, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    const normalizedKind = String(kind || '').toLowerCase();
    const rawValue = String(value || '').trim();
    if (!rawValue) return { totalCount: 0, records: [] };

    const params = new URLSearchParams({ 'per-page': '5' });

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

    const data = await fetchJsonWithRetry(`${OPENALEX_WORK_BASE_URL}?${params.toString()}`, { signal, timeoutMs });
    return {
      totalCount: Number(data?.meta?.count || 0),
      records: (Array.isArray(data?.results) ? data.results : []).map(mapWorkRecord),
    };
  }

  /**
   * Full-text works search for a free-text query (Slice 2 — novelty literature search,
   * replaces SerpAPI `google_scholar`). Unlike getWorkByTitle (title-shaped lookup), this is
   * for claim/topic phrases. `yearFrom` (a full year, e.g. now−5) adds a
   * `from_publication_date:<year>-01-01` recency filter. Records are mapWorkRecord shape
   * (incl. `abstract` + `citedByCount`). Free OpenAlex; no key.
   *
   * @param {string} query - free-text search phrase
   * @returns {Promise<{ totalCount: number, records: Array }>}
   */
  static async searchWorks(query, { signal, timeoutMs = DEFAULT_TIMEOUT_MS, yearFrom = null, limit = 5 } = {}) {
    const q = String(query || '').trim();
    if (!q) return { totalCount: 0, records: [] };

    const params = new URLSearchParams({
      search: q,
      'per-page': String(Math.max(1, Math.min(Number(limit) || 5, 25))),
    });
    if (Number.isInteger(yearFrom)) params.set('filter', `from_publication_date:${yearFrom}-01-01`);

    const data = await fetchJsonWithRetry(`${OPENALEX_WORK_BASE_URL}?${params.toString()}`, { signal, timeoutMs });
    return {
      totalCount: Number(data?.meta?.count || 0),
      records: (Array.isArray(data?.results) ? data.results : []).map(mapWorkRecord),
    };
  }

  /**
   * Find recent works carrying an exact-ish raw byline name. This is deliberately
   * separate from free-text `searchWorks`: the W2 reviewer resolver needs the
   * OpenAlex `raw_author_name.search` filter so title/topic text cannot create a
   * candidate author match.
   */
  static async searchWorksByRawAuthorName(name, {
    signal,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    limit = 50,
  } = {}) {
    const query = ContactParser.stripHonorifics(String(name || '')).trim();
    if (!query) return { totalCount: 0, records: [] };

    const params = new URLSearchParams({
      filter: `raw_author_name.search:${JSON.stringify(query)},type:!paratext`,
      sort: 'publication_date:desc',
      'per-page': String(Math.max(1, Math.min(Number(limit) || 50, 50))),
    });
    const data = await fetchJsonWithRetry(
      `${OPENALEX_WORK_BASE_URL}?${params.toString()}`,
      { signal, timeoutMs },
    );
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
   * `yearFrom` (a full year) adds an AND `from_publication_date:<year>-01-01` recency filter
   * (Slice 2 PI-pubs — the spine rescue path omits it and gets the most-recent works regardless).
   *
   * @param {string} authorId - OpenAlex author id (short `A…` or full URL).
   * @returns {Promise<{ totalCount: number, records: Array }>} records are mapWorkRecord shape (incl. year/url).
   */
  static async getWorksByAuthor(authorId, { signal, timeoutMs = DEFAULT_TIMEOUT_MS, limit = 5, yearFrom = null } = {}) {
    const id = shortOpenAlexId(authorId);
    if (!id) return { totalCount: 0, records: [] };

    // OpenAlex ANDs comma-separated filter clauses.
    const filter = Number.isInteger(yearFrom)
      ? `author.id:${id},from_publication_date:${yearFrom}-01-01`
      : `author.id:${id}`;
    const params = new URLSearchParams({
      filter,
      sort: 'publication_date:desc',
      'per-page': String(Math.max(1, Math.min(Number(limit) || 5, 25))),
    });

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
  // Exported for unit tests (OpenAlex abstract reconstruction for literature snippets).
  reconstructAbstract,
};
