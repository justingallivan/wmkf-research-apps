const { safeFetch } = require('../utils/safe-fetch.js');
const { ContactParser } = require('../utils/contact-parser');

const OPENALEX_AUTHOR_BASE_URL = 'https://api.openalex.org/authors';
const OPENALEX_WORK_BASE_URL = 'https://api.openalex.org/works';
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
  return {
    openAlexId: record.id || null,
    displayName: record.display_name || null,
    orcid: normalizeOrcid(record.orcid),
    // OpenAlex returns `last_known_institutions` (plural array) on the current API;
    // the singular `last_known_institution` is deprecated and absent live. Read the
    // array first (fall back to the singular only for legacy/cached shapes).
    lastKnownInstitution: record.last_known_institutions?.[0]?.display_name
      || record.last_known_institution?.display_name
      || null,
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
};
