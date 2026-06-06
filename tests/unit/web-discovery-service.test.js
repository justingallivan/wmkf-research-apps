/**
 * WebDiscoveryService unit tests (Perplexity Track C v1 — read-only panel).
 *
 * `DatabaseService` is mocked so `search_cache` calls don't touch Postgres.
 * `LLMClient` is mocked so the REAL `_extractNames` path can be exercised
 * (to prove the extraction call gets the CLAUDE key, not the Perplexity key —
 * the bug the deps-`complete` seam alone would hide). See
 * docs/REVIEWER_WEB_DISCOVERY_PLAN.md.
 */

jest.mock('../../lib/services/database-service', () => ({
  DatabaseService: {
    checkCache: jest.fn(async () => null),
    cacheSearch: jest.fn(async () => {}),
  },
}));

// Capture the options LLMClient is constructed with (esp. apiKey).
const llmCtorOpts = [];
jest.mock('../../lib/services/llm-client', () => ({
  LLMClient: jest.fn().mockImplementation((opts) => {
    llmCtorOpts.push(opts);
    return { complete: async () => ({ text: 'NAME: Jane Smith | SOURCE: 1' }) };
  }),
}));

import { WebDiscoveryService } from '../../lib/services/web-discovery-service';
import { DatabaseService } from '../../lib/services/database-service';

function fakeFetch(resultsByCall) {
  let call = 0;
  return jest.fn(async () => {
    const results = resultsByCall[Math.min(call, resultsByCall.length - 1)] || [];
    call += 1;
    return { ok: true, json: async () => ({ results }) };
  });
}

const RESULTS = [
  { title: 'Dr. Jane Smith — Recent advances in X', url: 'https://uni.edu/jsmith', snippet: 'Jane Smith, assistant professor...', date: '2024-03-01' },
  { title: 'Bob Lee lab', url: 'https://uni.edu/blee', snippet: 'Bob Lee, associate professor...', date: '2023-11-01' },
];

beforeEach(() => {
  jest.clearAllMocks();
  llmCtorOpts.length = 0;
  DatabaseService.checkCache.mockResolvedValue(null);
});

describe('WebDiscoveryService.search — fail-soft gates', () => {
  test('no key → { webLeads: [], skipped: "no_key" }, never throws', async () => {
    const saved = process.env.PERPLEXITY_API_KEY;
    delete process.env.PERPLEXITY_API_KEY;
    const out = await WebDiscoveryService.search({ queries: ['x'] });
    expect(out).toEqual({ webLeads: [], skipped: 'no_key' });
    if (saved !== undefined) process.env.PERPLEXITY_API_KEY = saved;
  });

  test('no queries → skipped: "no_queries"', async () => {
    const out = await WebDiscoveryService.search({ queries: [], apiKey: 'k' });
    expect(out).toEqual({ webLeads: [], skipped: 'no_queries' });
  });

  test('Perplexity non-ok → { webLeads: [], error }, swallowed not thrown', async () => {
    const _fetch = jest.fn(async () => ({ ok: false, status: 500, json: async () => ({ error: { message: 'boom' } }) }));
    const out = await WebDiscoveryService.search({ queries: ['x'], apiKey: 'k' }, { fetch: _fetch, complete: async () => '' });
    expect(out.webLeads).toEqual([]);
    expect(out.error).toBeTruthy();
  });

  test('fetch THROWS → { webLeads: [], error }, swallowed not thrown', async () => {
    const _fetch = jest.fn(async () => { throw new Error('network down'); });
    const out = await WebDiscoveryService.search({ queries: ['x'], apiKey: 'k' }, { fetch: _fetch, complete: async () => '' });
    expect(out.webLeads).toEqual([]);
    expect(out.error).toBe('network down');
  });
});

describe('WebDiscoveryService.search — extraction + provenance', () => {
  test('maps SOURCE number to the REAL results[].url (never a model-authored URL)', async () => {
    const _fetch = fakeFetch([RESULTS]);
    const _complete = async () =>
      'NAME: Jane Smith | SOURCE: 1 (https://evil.example/phish)\nNAME: Bob Lee | SOURCE: 2';
    const out = await WebDiscoveryService.search({ queries: ['x'], apiKey: 'k' }, { fetch: _fetch, complete: _complete });
    expect(out.webLeads).toEqual([
      { name: 'Jane Smith', provenanceUrl: 'https://uni.edu/jsmith', snippet: RESULTS[0].snippet, date: '2024-03-01', source: 'web' },
      { name: 'Bob Lee', provenanceUrl: 'https://uni.edu/blee', snippet: RESULTS[1].snippet, date: '2023-11-01', source: 'web' },
    ]);
    expect(out.webLeads.some((l) => l.provenanceUrl.includes('evil.example'))).toBe(false);
  });

  test('out-of-range SOURCE dropped; duplicate names deduped; pipe cannot bleed into name', async () => {
    const _fetch = fakeFetch([RESULTS]);
    const _complete = async () =>
      'NAME: Jane Smith | SOURCE: 1\nNAME: Ghost | SOURCE: 99\nNAME: jane smith | SOURCE: 2';
    const out = await WebDiscoveryService.search({ queries: ['x'], apiKey: 'k' }, { fetch: _fetch, complete: _complete });
    expect(out.webLeads.map((l) => l.name)).toEqual(['Jane Smith']);
  });

  test('NONE / no parseable lines → empty webLeads (not an error)', async () => {
    const _fetch = fakeFetch([RESULTS]);
    const out = await WebDiscoveryService.search({ queries: ['x'], apiKey: 'k' }, { fetch: _fetch, complete: async () => 'NONE' });
    expect(out.webLeads).toEqual([]);
    expect(out.error).toBeUndefined();
  });

  test('non-http(s) result urls are rejected as provenance', async () => {
    const _fetch = fakeFetch([[{ title: 'X', url: 'ftp://uni.edu/x', snippet: 's', date: null }, RESULTS[0]]]);
    // After filtering the ftp row, results = [jsmith]; SOURCE 1 maps to it.
    const out = await WebDiscoveryService.search({ queries: ['x'], apiKey: 'k' }, { fetch: _fetch, complete: async () => 'NAME: Jane Smith | SOURCE: 1' });
    expect(out.webLeads).toEqual([
      { name: 'Jane Smith', provenanceUrl: 'https://uni.edu/jsmith', snippet: RESULTS[0].snippet, date: '2024-03-01', source: 'web' },
    ]);
  });
});

describe('WebDiscoveryService.search — A7 wrapping', () => {
  test('the extraction prompt carries the untrusted-content preamble + nonce sentinels', async () => {
    const _fetch = fakeFetch([RESULTS]);
    let capturedPrompt = '';
    const _complete = async ({ prompt }) => { capturedPrompt = prompt; return 'NONE'; };
    await WebDiscoveryService.search(
      { queries: ['x'], apiKey: 'k', proposalContext: 'cryo-EM of membrane proteins' },
      { fetch: _fetch, complete: _complete },
    );
    expect(capturedPrompt).toContain('UNTRUSTED CONTENT RULES');
    expect(capturedPrompt).toMatch(/nonce=/);
    // The raw web title appears INSIDE the wrapped block, not as bare instructions.
    expect(capturedPrompt).toContain('Recent advances in X');
  });
});

describe('WebDiscoveryService.search — credential routing (real _extractNames)', () => {
  test('the extraction LLM call gets the CLAUDE key, never the Perplexity key', async () => {
    const _fetch = fakeFetch([RESULTS]);
    // No deps.complete → the REAL _extractNames runs (LLMClient is mocked).
    const out = await WebDiscoveryService.search(
      { queries: ['x'], apiKey: 'pplx-secret', claudeApiKey: 'sk-claude-secret' },
      { fetch: _fetch },
    );
    expect(llmCtorOpts).toHaveLength(1);
    expect(llmCtorOpts[0].apiKey).toBe('sk-claude-secret');
    expect(llmCtorOpts[0].apiKey).not.toBe('pplx-secret');
    expect(out.webLeads.map((l) => l.name)).toEqual(['Jane Smith']);
  });
});

describe('WebDiscoveryService.search — caps + cache', () => {
  test('caps at 3 queries even when given more', async () => {
    const _fetch = fakeFetch([RESULTS]);
    const out = await WebDiscoveryService.search(
      { queries: ['a', 'b', 'c', 'd', 'e'], apiKey: 'k' },
      { fetch: _fetch, complete: async () => 'NAME: Jane Smith | SOURCE: 1' },
    );
    expect(out.queriesRun).toBe(3);
    expect(_fetch).toHaveBeenCalledTimes(3);
  });

  test('enforces ≤10 results per query even if a query returns more', async () => {
    const big = Array.from({ length: 15 }, (_, i) => ({ title: `T${i}`, url: `https://uni.edu/r${i}`, snippet: 's', date: null }));
    const _fetch = fakeFetch([big]);
    let capturedPrompt = '';
    const _complete = async ({ prompt }) => { capturedPrompt = prompt; return 'NONE'; };
    await WebDiscoveryService.search({ queries: ['x'], apiKey: 'k' }, { fetch: _fetch, complete: _complete });
    // The numbered list in the prompt should contain at most 10 entries from this query.
    expect(capturedPrompt).toContain('[10]');
    expect(capturedPrompt).not.toContain('[11]');
  });

  test('cache hit skips the Perplexity fetch for that query', async () => {
    DatabaseService.checkCache.mockResolvedValueOnce(RESULTS);
    const _fetch = fakeFetch([RESULTS]);
    const out = await WebDiscoveryService.search(
      { queries: ['cached'], apiKey: 'k' },
      { fetch: _fetch, complete: async () => 'NAME: Jane Smith | SOURCE: 1' },
    );
    expect(_fetch).not.toHaveBeenCalled();
    expect(out.fromCache).toBe(1);
    expect(out.webLeads.map((l) => l.name)).toEqual(['Jane Smith']);
  });

  test('a fresh query is written to the perplexity cache namespace', async () => {
    const _fetch = fakeFetch([RESULTS]);
    await WebDiscoveryService.search(
      { queries: ['fresh'], apiKey: 'k' },
      { fetch: _fetch, complete: async () => 'NAME: Jane Smith | SOURCE: 1' },
    );
    expect(DatabaseService.cacheSearch).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'perplexity', query: 'fresh' }),
    );
  });
});

describe('WebDiscoveryService.isConfigured', () => {
  test('reflects PERPLEXITY_API_KEY presence', () => {
    const saved = process.env.PERPLEXITY_API_KEY;
    process.env.PERPLEXITY_API_KEY = 'k';
    expect(WebDiscoveryService.isConfigured()).toBe(true);
    delete process.env.PERPLEXITY_API_KEY;
    expect(WebDiscoveryService.isConfigured()).toBe(false);
    if (saved !== undefined) process.env.PERPLEXITY_API_KEY = saved;
  });
});
