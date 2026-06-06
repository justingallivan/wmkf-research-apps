/**
 * WebDiscoveryService — Perplexity Search-API web-grounded reviewer discovery
 * (Track C v1, READ-ONLY panel). Spec: docs/REVIEWER_WEB_DISCOVERY_PLAN.md.
 *
 * Purpose: counter Claude's training-cutoff + fame bias in candidate discovery
 * by surfacing CURRENTLY-ACTIVE, mid-career researchers from the live web.
 *
 * Contract (v1):
 *  - Leads-only + display-only: returns `WebLead[] = {name, provenanceUrl,
 *    snippet, date, source:'web'}` for a SEPARATE UI panel. It does NOT touch
 *    `/discover`, the candidate pipeline, ranking, COI, roster, or save.
 *  - `provenanceUrl` is ALWAYS a real `results[].url`. The extraction model
 *    returns a source NUMBER (never a URL — Perplexity docs warn model-authored
 *    URLs hallucinate); this service maps the number to the real url.
 *  - A7: web results AND the proposal-context blurb are UNTRUSTED — wrapped
 *    before they enter the extraction prompt (createWebExtractionPrompt,
 *    A7-registered, calls buildUntrustedContentPreamble in-body).
 *  - Two distinct credentials: the PERPLEXITY key authenticates the SEARCH call;
 *    the CLAUDE key authenticates the extraction LLM call. They are never crossed.
 *  - Fail-soft: no key / outage / parse error → `{ webLeads: [], ... }`, NEVER
 *    throws. The caller renders an empty panel; the normal search is unaffected.
 *  - Caps: ≤3 queries, ≤10 results/query, ≤24 results total. Cache reuses
 *    `search_cache` under a dedicated `perplexity` source namespace.
 *
 * The Perplexity SEARCH API (`POST /search`) is a DIFFERENT surface from the
 * `sonar` chat-completions call in `multi-llm-service.js` (Virtual Review Panel).
 * `api.perplexity.ai` is already in `safe-fetch.js` ALLOWED_HOSTS.
 */
import { LLMClient } from './llm-client.js';
import { safeFetch } from '../utils/safe-fetch.js';
import { DatabaseService } from './database-service.js';
import { createWebExtractionPrompt } from '../../shared/config/prompts/reviewer-finder.js';
import { DATA_CLASSES, wrapUntrustedContent } from '../utils/ai-payload-boundary.js';
import { getModelForApp, getFallbackModelForApp } from '../../shared/config/baseConfig.js';

const PERPLEXITY_SEARCH_URL = 'https://api.perplexity.ai/search';
const CACHE_SOURCE = 'perplexity'; // dedicated namespace; search_cache key is (source, query_hash)
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const MAX_QUERIES = 3;
const MAX_RESULTS_PER_QUERY = 10;
const MAX_RESULTS_TOTAL = 24;
const RECENCY_YEARS = 5; // bias toward currently-active researchers
// Extraction-input budget. The Perplexity Search API returns LARGE snippets
// (faculty/lab directory pages ran ~8KB live, S227) — the kind of page our
// person-oriented queries target. The old 20K total let only ~2-3 of up to 24
// results reach the extraction model; the rest were truncated away unseen,
// capping recall (the feature's whole point). Nothing forces a small budget:
// 100K chars ≈ ~25K tokens, ~12% of Sonnet's 200K window, ~cents/search; the
// wrapUntrustedContent A7 boundary is identical at any size. PER_SNIPPET caps any
// one pathological page so it can't eat the whole budget. (S227 tuning.)
const WEB_RESULTS_MAX_CHARS = 100_000;
const PER_SNIPPET_MAX_CHARS = 6_000; // guard: bound one snippet's share of the budget
const PROPOSAL_CONTEXT_MAX_CHARS = 4_000;
const EXTRACTION_MAX_TOKENS = 4096; // ~250-350 `NAME | SOURCE` lines (was 1024 ≈ ~60-90)
const EXTRACTION_TIMEOUT_MS = 60_000;
const SEARCH_TIMEOUT_MS = 30_000;

class WebDiscoveryService {
  /** Whether the Perplexity key is configured (drives the capability/toggle). */
  static isConfigured() {
    return !!process.env.PERPLEXITY_API_KEY;
  }

  /**
   * Run web discovery for a set of search queries.
   *
   * @param {Object}   input
   * @param {string[]} input.queries          - search query strings (capped to 3)
   * @param {string}   [input.proposalContext]- short topic blurb for relevance (wrapped as untrusted)
   * @param {string}   [input.apiKey]          - Perplexity key override (else PERPLEXITY_API_KEY)
   * @param {string}   [input.claudeApiKey]    - Claude key override (else CLAUDE_API_KEY)
   * @param {AbortSignal} [input.signal]
   * @param {number}   [input.deadlineAt]      - epoch ms; bounds the extraction call
   * @param {number|null} [input.userProfileId]
   * @param {Object}   [deps] - test seam: { fetch, complete } default to real impls
   * @returns {Promise<{webLeads: Array, queriesRun?: number, fromCache?: number, skipped?: string, error?: string}>}
   */
  static async search(input = {}, deps = {}) {
    const {
      queries = [],
      proposalContext = '',
      apiKey,
      claudeApiKey,
      signal,
      deadlineAt,
      userProfileId = null,
    } = input;
    const _fetch = deps.fetch || safeFetch;
    const _complete = deps.complete || ((opts) => this._extractNames(opts));

    // Two distinct credentials — never crossed (Perplexity authenticates SEARCH,
    // Claude authenticates the extraction LLM call).
    const perplexityKey = apiKey || process.env.PERPLEXITY_API_KEY;
    const claudeKey = claudeApiKey || process.env.CLAUDE_API_KEY;
    if (!perplexityKey) return { webLeads: [], skipped: 'no_key' };

    try {
      const capped = (Array.isArray(queries) ? queries : [])
        .map((q) => (typeof q === 'string' ? q.trim() : ''))
        .filter(Boolean)
        .slice(0, MAX_QUERIES);
      if (capped.length === 0) return { webLeads: [], skipped: 'no_queries' };

      // 1) Gather results across queries; cache under the `perplexity` namespace.
      const seenUrls = new Set();
      const results = [];
      let fromCache = 0;
      let queriesRun = 0;
      for (const q of capped) {
        if (signal?.aborted) break;
        queriesRun += 1;
        let rows = await DatabaseService.checkCache(CACHE_SOURCE, q);
        if (Array.isArray(rows)) {
          fromCache += 1;
        } else {
          rows = await this._perplexitySearch(q, { apiKey: perplexityKey, signal, _fetch });
          await DatabaseService.cacheSearch({
            source: CACHE_SOURCE,
            query: q,
            results: rows,
            expiresAt: new Date(Date.now() + CACHE_TTL_MS),
          });
        }
        // Enforce the per-query cap on returned/cached rows too (not just the
        // requested max_results) — a stale cache row or non-conforming response
        // must not let one query flood the total.
        for (const r of (Array.isArray(rows) ? rows : []).slice(0, MAX_RESULTS_PER_QUERY)) {
          const url = typeof r?.url === 'string' ? r.url : null;
          if (!url || !/^https?:\/\//i.test(url) || seenUrls.has(url)) continue; // http(s) provenance only
          seenUrls.add(url);
          results.push({ title: r.title || '', url, snippet: r.snippet || '', date: r.date || null });
          if (results.length >= MAX_RESULTS_TOTAL) break;
        }
        if (results.length >= MAX_RESULTS_TOTAL) break;
      }
      if (results.length === 0) {
        // Funnel trace (counts only — no names/URLs, so the display-only invariant
        // holds and nothing PII lands in logs). Lets us answer "is the wider budget
        // surfacing more results?" / "where do leads get lost?" from Vercel logs
        // without persisting the ephemeral webLeads. (S229 monitoring.)
        console.log('[WebDiscoveryService] funnel', JSON.stringify({ queriesRun, fromCache, rawResults: 0, webLeads: 0 }));
        return { webLeads: [], queriesRun, fromCache };
      }

      // 2) A7-wrap the untrusted results (and the optional context blurb), then
      //    extract names.
      // Cap each snippet's share of the extraction budget so one giant directory
      // page can't crowd out later results (the total cap is the WEB_RESULTS_MAX_CHARS
      // backstop). The FULL r.snippet is still stored for the panel's provenance display.
      const numbered = results
        .map((r, i) => `[${i + 1}] ${r.title}\n${(r.snippet || '').slice(0, PER_SNIPPET_MAX_CHARS)}`)
        .join('\n\n');
      const wrappedResults = wrapUntrustedContent({
        text: numbered,
        source: 'reviewer-finder.web-search.results',
        dataClass: DATA_CLASSES.EXTERNAL_API_TEXT,
        maxChars: WEB_RESULTS_MAX_CHARS,
        label: 'web search results',
      });
      const nonces = [wrappedResults.nonce];
      let contextText = '';
      if (proposalContext && String(proposalContext).trim()) {
        const wrappedContext = wrapUntrustedContent({
          text: String(proposalContext),
          source: 'reviewer-finder.web-search.proposal-context',
          dataClass: DATA_CLASSES.EXTERNAL_API_TEXT,
          maxChars: PROPOSAL_CONTEXT_MAX_CHARS,
          label: 'research area',
        });
        contextText = wrappedContext.text;
        nonces.push(wrappedContext.nonce);
      }
      const prompt = createWebExtractionPrompt(wrappedResults.text, contextText, nonces);
      const text = await _complete({ prompt, apiKey: claudeKey, signal, deadlineAt, userProfileId });

      // 3) Parse `NAME: x | SOURCE: n` → map the number to the REAL results[].url.
      const webLeads = this._parseExtraction(text, results);
      // Funnel trace: raw results in → leads extracted out. Counts only (see note
      // on the empty-results branch above); makes the recall question observable.
      console.log('[WebDiscoveryService] funnel', JSON.stringify({ queriesRun, fromCache, rawResults: results.length, webLeads: webLeads.length }));
      return { webLeads, queriesRun, fromCache };
    } catch (err) {
      // Fail-soft: web discovery must never break the normal search.
      console.error('[WebDiscoveryService] search failed (fail-soft):', err?.message);
      return { webLeads: [], error: err?.message || 'web_search_failed' };
    }
  }

  /** One Perplexity Search-API call. Throws on non-ok (caught by search()). */
  static async _perplexitySearch(query, { apiKey, signal, _fetch }) {
    const after = new Date();
    after.setFullYear(after.getFullYear() - RECENCY_YEARS);
    const body = {
      query,
      max_results: MAX_RESULTS_PER_QUERY,
      // Bias toward recent work. M/D/YYYY is Perplexity's date-filter format —
      // VERIFIED LIVE 2026-06-05 (S227) against the real /search API: accepted and
      // honored, no result predated the window. See scripts/probe-perplexity-search.mjs.
      search_after_date_filter: this._formatDate(after),
    };
    const resp = await _fetch(PERPLEXITY_SEARCH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: this._withTimeout(signal, SEARCH_TIMEOUT_MS),
    });
    if (!resp.ok) {
      const e = await resp.json().catch(() => ({}));
      throw new Error(e?.error?.message || `Perplexity Search API error: ${resp.status}`);
    }
    const data = await resp.json();
    return Array.isArray(data?.results) ? data.results : [];
  }

  /** The extraction LLM call (Claude via LLMClient). Uses the CLAUDE key. */
  static async _extractNames({ prompt, apiKey, signal, deadlineAt, userProfileId }) {
    const primary = getModelForApp('reviewer-finder');
    const fallback = getFallbackModelForApp('reviewer-finder');
    // Belt-and-suspenders: never let a Perplexity key reach Anthropic.
    const clientOpts = {
      apiKey: apiKey || process.env.CLAUDE_API_KEY,
      model: primary,
      fallbackModel: fallback && fallback !== primary ? fallback : null,
      appName: 'reviewer-finder',
      userProfileId,
    };
    // Always bound the call; tighten further if a search deadline is in effect.
    const remaining = deadlineAt != null ? deadlineAt - Date.now() : EXTRACTION_TIMEOUT_MS;
    clientOpts.timeoutMs = Math.max(1, Math.min(remaining, EXTRACTION_TIMEOUT_MS));
    const client = new LLMClient(clientOpts);
    const { text } = await client.complete({
      messages: [{ role: 'user', content: prompt }],
      maxTokens: EXTRACTION_MAX_TOKENS,
      temperature: 0,
      signal,
    });
    return text || '';
  }

  /**
   * Parse `NAME: <name> | SOURCE: <n>` lines. The url/snippet/date come ONLY
   * from `results[n-1]` — never from anything the model wrote — so a hallucinated
   * URL in the model output can never become a provenanceUrl. Dedupes by name.
   * The name capture excludes `|` so a stray pipe can't bleed into the name.
   */
  static _parseExtraction(text, results) {
    const out = [];
    const seenNames = new Set();
    if (!text) return out;
    const re = /NAME:\s*([^|]+?)\s*\|\s*SOURCE:\s*(\d+)/gi;
    let m;
    while ((m = re.exec(text)) !== null) {
      const name = m[1].trim();
      const idx = parseInt(m[2], 10) - 1;
      if (!name || !Number.isInteger(idx) || idx < 0 || idx >= results.length) continue;
      const key = name.toLowerCase().replace(/\s+/g, ' ');
      if (seenNames.has(key)) continue;
      seenNames.add(key);
      const r = results[idx];
      out.push({ name, provenanceUrl: r.url, snippet: r.snippet, date: r.date, source: 'web' });
    }
    return out;
  }

  /** Combine a caller signal with a timeout (so a hung fetch can't run forever). */
  static _withTimeout(signal, ms) {
    if (typeof AbortSignal === 'undefined' || typeof AbortSignal.timeout !== 'function') {
      return signal;
    }
    const timeout = AbortSignal.timeout(ms);
    if (signal && typeof AbortSignal.any === 'function') {
      return AbortSignal.any([signal, timeout]);
    }
    return signal || timeout;
  }

  /** M/D/YYYY (Perplexity's documented date-filter format). */
  static _formatDate(d) {
    return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
  }
}

export { WebDiscoveryService };
