const { safeFetch } = require('../utils/safe-fetch.js');

const OPENALEX_BASE_URL = 'https://api.openalex.org/authors';
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
  return concepts
    .filter((concept) => Number(concept?.score || 0) > 25 && concept?.display_name)
    .slice(0, 8)
    .map((concept) => concept.display_name);
}

function mapRecord(record = {}) {
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

class OpenAlexService {
  static async searchAuthors(name, { signal, limit = DEFAULT_LIMIT, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    const query = String(name || '').trim();
    if (!query) return { totalCount: 0, records: [] };

    const params = new URLSearchParams({
      search: query,
      'per-page': String(Math.max(1, Math.min(Number(limit) || DEFAULT_LIMIT, 25))),
    });
    if (OPENALEX_POLITE_MAILTO) params.set('mailto', OPENALEX_POLITE_MAILTO);

    const data = await fetchJsonWithRetry(`${OPENALEX_BASE_URL}?${params.toString()}`, { signal, timeoutMs });
    return {
      totalCount: Number(data?.meta?.count || 0),
      records: (Array.isArray(data?.results) ? data.results : []).map(mapRecord),
    };
  }
}

module.exports = {
  OpenAlexService,
  OPENALEX_POLITE_MAILTO,
};
