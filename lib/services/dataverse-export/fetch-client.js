/**
 * Dataverse Power Tools — Track B — backoff-hardened FetchXML primitive.
 *
 * THE CENTRAL NEW INFRASTRUCTURE (build plan §3a). The codebase has no
 * FetchXML support: dynamics-service.js::queryAllRecords is OData-only,
 * hard-capped at exactly 5,000, throws on the first non-200, has no
 * 429/Retry-After/backoff. OData /$count silently caps at 5,000 — that ~80%
 * undercount is the exact trigger this tool exists to fix. So this is a NEW
 * primitive, not a reuse:
 *
 *   - fetchXmlPage         one page via ?fetchXml=, paging-cookie injected
 *   - fetchXmlAll          pages via the FetchXML paging cookie (NOT
 *                          @odata.nextLink); hard row/budget ceilings
 *   - fetchXmlAggregateCount  the TRUE total via <fetch aggregate="true">,
 *                          NEVER OData /$count (a hard correctness invariant)
 *
 * Reuses dynamics-service.js ONLY for OAuth token acquisition + the
 * abortable-timeout wiring (fetchWithTimeout is module-private there, so the
 * equivalent abort wiring is reimplemented locally — the contract is "an
 * abortable timeout", not that exact symbol). The query path is independent.
 *
 * Backoff-hardened: the broad query the tool exists to serve must SUCCEED,
 * not throw on the first blip. A page that ultimately fails after capped
 * retries ⇒ a loud, actionable error — NEVER a silently-short file.
 */

import { DynamicsService } from '../dynamics-service.js';
import { assertDataverseOperationAllowed } from '../../dataverse/core/interlock.js';

// ── Concrete v1 limits (build plan §3a/§8 — fixed here, not "open") ──
const PAGE_SIZE = 1000; // Prefer: odata.maxpagesize=1000 (committed default)
const HARD_CAP_ROWS = 50_000; // parameterized; replaces the arbitrary 5,000
const HARD_BUDGET_MS = 240_000; // 240s — under Vercel's 300s, headroom for build
const MEM_ABORT_BYTES = 200 * 1024 * 1024; // 200 MB resident
const MEM_ABORT_ROWS = 250_000; // whichever first
const PAGE_TIMEOUT_MS = 60_000; // per-page abort (broad pages are slow)

// Backoff (429 / Retry-After / 5xx → exponential + jitter, capped retries).
const MAX_RETRIES = 5;
const BASE_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;

const API_PATH = '/api/data/v9.2';

class FetchXmlError extends Error {
  constructor(message, { stage, page, retryable, status } = {}) {
    super(message);
    this.name = 'FetchXmlError';
    this.stage = stage; // 'paging' | 'count' | 'auth' | 'config'
    this.page = page;
    this.retryable = retryable === true;
    this.status = status;
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/** Abortable timeout wiring (mirrors dynamics-service.js fetchWithTimeout). */
async function fetchWithTimeout(url, options, timeoutMs) {
  // Interlock (docs/DATAVERSE_TARGET_WRITE_INTERLOCK_PLAN.md §3.5.3),
  // unconditional — self-scopes (no-ops on non-Dataverse URLs and when the
  // flag is off).
  assertDataverseOperationAllowed({ url, method: options?.method, callerLabel: 'dataverse-export/fetch-client' });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new FetchXmlError(
        `FetchXML request timed out after ${Math.round(timeoutMs / 1000)}s`,
        { stage: 'paging', retryable: true });
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function baseUrl() {
  const u = process.env.DYNAMICS_URL;
  if (!u) {
    throw new FetchXmlError(
      'Missing DYNAMICS_URL — cannot reach Dataverse', { stage: 'config' });
  }
  return u;
}

// ── Paging-cookie injection ──────────────────────────────────────────────
// FetchXML server-side paging is driven by attributes ON the <fetch> element:
//   count="<pageSize>" page="<N>" paging-cookie="<xml-escaped cookie>"
// The cookie comes back in @Microsoft.Dynamics.CRM.fetchxmlpagingcookie and
// must be XML-attribute-escaped before re-embedding. We strip any existing
// paging attributes first so a compiled fetch can be paged idempotently.

function xmlAttrEscape(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function injectPaging(fetchXml, { page, pageSize, cookie }) {
  const m = fetchXml.match(/^<fetch\b([^>]*)>/);
  if (!m) {
    throw new FetchXmlError(
      'Compiled FetchXML is malformed (no <fetch> root)', { stage: 'config' });
  }
  let attrs = m[1]
    .replace(/\s+count="[^"]*"/g, '')
    .replace(/\s+page="[^"]*"/g, '')
    .replace(/\s+paging-cookie="[^"]*"/g, '');
  attrs += ` count="${pageSize}" page="${page}"`;
  if (cookie) attrs += ` paging-cookie="${xmlAttrEscape(cookie)}"`;
  return fetchXml.replace(/^<fetch\b[^>]*>/, `<fetch${attrs}>`);
}

/**
 * Issue ONE request through the backoff ladder. Retries 429/Retry-After/5xx
 * with exponential backoff + jitter, capped. A non-retryable non-200, or
 * exhausted retries, throws a loud FetchXmlError (never a silent partial).
 */
async function requestWithBackoff(url, headers, { stage, page }) {
  let attempt = 0;
  for (;;) {
    let resp;
    try {
      resp = await fetchWithTimeout(url, { headers }, PAGE_TIMEOUT_MS);
    } catch (err) {
      if (err instanceof FetchXmlError && err.retryable && attempt < MAX_RETRIES) {
        await sleep(backoffMs(attempt++));
        continue;
      }
      throw err instanceof FetchXmlError
        ? err
        : new FetchXmlError(`FetchXML network error: ${err.message}`,
            { stage, page, retryable: false });
    }

    if (resp.ok) return resp;

    const retryable = resp.status === 429 || (resp.status >= 500 && resp.status <= 599);
    if (retryable && attempt < MAX_RETRIES) {
      const ra = parseRetryAfter(resp.headers && resp.headers.get
        ? resp.headers.get('Retry-After') : null);
      await sleep(ra != null ? ra : backoffMs(attempt));
      attempt++;
      continue;
    }

    // Loud, actionable terminal failure — never a silently-short result.
    let body = '';
    try { body = await resp.text(); } catch { /* ignore */ }
    throw new FetchXmlError(
      `FetchXML ${stage} failed (HTTP ${resp.status})`
      + (retryable ? ` after ${attempt} retries` : '')
      + `: ${truncate(body, 500)}`,
      { stage, page, retryable: false, status: resp.status });
  }
}

function backoffMs(attempt) {
  const exp = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** attempt);
  return Math.floor(exp / 2 + Math.random() * (exp / 2)); // full-ish jitter
}

function parseRetryAfter(h) {
  if (!h) return null;
  const secs = Number(h);
  if (Number.isFinite(secs)) return Math.min(MAX_BACKOFF_MS, secs * 1000);
  const when = Date.parse(h);
  if (!Number.isNaN(when)) return Math.max(0, Math.min(MAX_BACKOFF_MS, when - Date.now()));
  return null;
}

function truncate(s, n) {
  s = String(s || '');
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function readHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    'OData-Version': '4.0',
    Accept: 'application/json',
    'Content-Type': 'application/json',
    Prefer: `odata.include-annotations="*",odata.maxpagesize=${PAGE_SIZE}`,
  };
}

// ── Public primitive ─────────────────────────────────────────────────────

/**
 * Fetch a single FetchXML page.
 * @returns {{ rows, cookie, moreRecords }}
 */
async function fetchXmlPage(entitySet, fetchXml, { page = 1, cookie = null, token } = {}) {
  if (!entitySet) {
    throw new FetchXmlError('fetchXmlPage requires an entitySet', { stage: 'config' });
  }
  const tok = token || await acquireToken();
  const paged = injectPaging(fetchXml, { page, pageSize: PAGE_SIZE, cookie });
  const url = `${baseUrl()}${API_PATH}/${entitySet}?fetchXml=${encodeURIComponent(paged)}`;
  const resp = await requestWithBackoff(url, readHeaders(tok), { stage: 'paging', page });
  const data = await resp.json();
  const rows = (data.value || []).map(r => DynamicsService.processAnnotations(r));
  return {
    rows,
    cookie: data['@Microsoft.Dynamics.CRM.fetchxmlpagingcookie'] || null,
    moreRecords: data['@Microsoft.Dynamics.CRM.morerecords'] === true,
  };
}

/**
 * Page a compiled FetchXML to completion via the FetchXML paging cookie
 * (NOT @odata.nextLink). Buffers rows. Enforces hard row + budget + memory
 * ceilings; on cap/budget it returns what was fetched WITH the truncation
 * flags (loud-truncation UX is the caller's job) — never a hang, never a
 * silent cut. A page that ultimately fails ⇒ the whole run fails loud
 * (FetchXmlError) — there is no "best-effort partial export".
 *
 * @returns {{ rows, fetched, pages, capped, truncatedByBudget }}
 */
async function fetchXmlAll(entitySet, fetchXml, opts = {}) {
  const hardCapRows = opts.hardCapRows ?? HARD_CAP_ROWS;
  const hardBudgetMs = opts.hardBudgetMs ?? HARD_BUDGET_MS;
  const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;
  const started = Date.now();
  const token = await acquireToken();

  const rows = [];
  let page = 1;
  let cookie = null;
  let bufferedBytes = 0;
  let capped = false;
  let truncatedByBudget = false;

  for (;;) {
    const res = await fetchXmlPage(entitySet, fetchXml, { page, cookie, token });
    rows.push(...res.rows);

    // In-memory abort — the BUFFERED-PAYLOAD size, accumulated. Whole-process
    // process.memoryUsage().rss is deliberately NOT used (Codex S160 P2
    // pushed back with reasoning): RSS conflates the Node/Next runtime
    // baseline — already >200 MB in a serverless worker — with the rows we
    // actually buffer, so it false-positives on tiny results and is not a
    // signal about THIS query. The build plan's "200 MB resident" intent is
    // "don't OOM on a too-broad filter"; the buffered-row byte estimate is
    // the faithful proxy for that, paired with the hard row ceiling.
    bufferedBytes += res.rows.length
      ? Buffer.byteLength(JSON.stringify(res.rows)) : 0;
    if (rows.length > MEM_ABORT_ROWS || bufferedBytes > MEM_ABORT_BYTES) {
      throw new FetchXmlError(
        `In-memory ceiling exceeded (${rows.length} rows / `
        + `~${Math.round(bufferedBytes / 1024 / 1024)} MB buffered). The filter `
        + `is too broad — narrow by program / year / status / institution.`,
        { stage: 'paging', page, retryable: false });
    }

    if (onProgress) onProgress({ pages: page, fetched: rows.length });

    if (rows.length >= hardCapRows) {
      capped = true;
      rows.length = hardCapRows;
      break;
    }
    if (Date.now() - started >= hardBudgetMs) {
      truncatedByBudget = true;
      break;
    }
    if (!res.moreRecords) break;

    // moreRecords=true but NO paging cookie ⇒ we cannot fetch the rest.
    // Fail LOUD — a silently-short result that looks complete is the exact
    // plausible-wrong-answer this tool exists to prevent (Codex S160 P1;
    // build plan §3a partial-page-failure contract). Never a silent break.
    if (!res.cookie) {
      throw new FetchXmlError(
        `Dataverse reported more records after page ${page} but returned no `
        + `paging cookie — refusing to emit a silently-short result. Re-run; `
        + `if it persists, narrow the filter.`,
        { stage: 'paging', page, retryable: false });
    }
    cookie = res.cookie;
    page += 1;
  }

  return { rows, fetched: rows.length, pages: page, capped, truncatedByBudget };
}

/**
 * The TRUE total via a FetchXML aggregate count. NEVER OData /$count
 * (a hard correctness invariant — /$count silently caps at 5,000 and looks
 * exactly like the triggering "~5,000 requests").
 *
 * @param {string} entitySet  e.g. "akoya_requests"
 * @param {string} countFetchXml  the compiler's countFetchXml
 * @param {string} alias  the aggregate alias (compiler's COUNT_ALIAS)
 * @returns {number} exact total
 */
async function fetchXmlAggregateCount(entitySet, countFetchXml, alias) {
  if (!entitySet || !countFetchXml || !alias) {
    throw new FetchXmlError(
      'fetchXmlAggregateCount requires (entitySet, countFetchXml, alias)',
      { stage: 'config' });
  }
  const token = await acquireToken();
  const url = `${baseUrl()}${API_PATH}/${entitySet}?fetchXml=${encodeURIComponent(countFetchXml)}`;
  let resp;
  try {
    resp = await requestWithBackoff(url, readHeaders(token), { stage: 'count' });
  } catch (err) {
    // Dataverse caps aggregate queries at 50,000 — surface it loudly &
    // actionably, never a silent fallback to a wrong number.
    if (err instanceof FetchXmlError && /aggregate/i.test(err.message)) {
      throw new FetchXmlError(
        'True-count unavailable: the result exceeds Dataverse\'s 50,000 '
        + 'aggregate-count limit. Narrow the filter — do NOT trust a partial count.',
        { stage: 'count', retryable: false });
    }
    throw err;
  }
  const data = await resp.json();
  const row = (data.value || [])[0] || {};
  const n = row[alias];
  if (typeof n !== 'number') {
    throw new FetchXmlError(
      `Aggregate count returned no "${alias}" value — refusing to guess a total`,
      { stage: 'count', retryable: false });
  }
  return n;
}

async function acquireToken() {
  try {
    return await DynamicsService.getAccessToken();
  } catch (err) {
    throw new FetchXmlError(`Dataverse auth failed: ${err.message}`,
      { stage: 'auth', retryable: false });
  }
}

export {
  fetchXmlPage,
  fetchXmlAll,
  fetchXmlAggregateCount,
  FetchXmlError,
  // exported for the headless backoff/paging test suite
  injectPaging,
  backoffMs,
  parseRetryAfter,
  PAGE_SIZE,
  HARD_CAP_ROWS,
  HARD_BUDGET_MS,
  MAX_RETRIES,
};
