/**
 * @jest-environment node
 */
/**
 * /api/reviewer-finder/web-suggestions (Track C v1) — the read-only web-grounded
 * suggestions endpoint. Verifies the method/auth gates, server-side query
 * derivation from the held analysisResult, the key-gate, and that it stays
 * fail-soft (always 200, never throws) by leaning on WebDiscoveryService — which
 * is mocked so no Perplexity/Claude/Postgres call is made.
 */
jest.mock('../../lib/utils/auth', () => ({ requireAppAccess: jest.fn(async () => ({ profileId: 7 })) }));

const search = jest.fn(async () => ({ webLeads: [{ name: 'Jane Smith', provenanceUrl: 'https://uni.edu/jsmith', snippet: 's', date: '2024-01-01', source: 'web' }], queriesRun: 1, fromCache: 0 }));
let configured = true;
jest.mock('../../lib/services/web-discovery-service', () => ({
  WebDiscoveryService: {
    isConfigured: () => configured,
    search: (...args) => search(...args),
  },
}));

// The service resolves a model synchronously via getModelForApp(), which only
// returns a real id once loadModelOverrides() has warmed the cache. The handler
// MUST call it before search() or Anthropic 404s on the unresolved tier key.
const loadModelOverrides = jest.fn(async () => {});
jest.mock('../../lib/services/model-override-loader', () => ({
  loadModelOverrides: (...args) => loadModelOverrides(...args),
}));

import handler, { deriveWebQueries, deriveProposalContext, collectExcludeNames } from '../../pages/api/reviewer-finder/web-suggestions';
import { requireAppAccess } from '../../lib/utils/auth';

function res() {
  return { statusCode: 200, body: null, setHeader() {}, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}

// POST req with the headers/socket the rate limiter reads for its identifier.
function post(body) {
  return { method: 'POST', headers: {}, socket: { remoteAddress: '127.0.0.1' }, body };
}

const ANALYSIS = {
  proposalInfo: {
    title: 'Engineered gene circuits for biosensing',
    primaryResearchArea: 'synthetic biology',
    secondaryAreas: 'metabolic engineering',
    keyMethodologies: 'CRISPRi, directed evolution',
    keywords: 'biosensor, riboswitch',
  },
  searchQueries: { pubmed: ['fallback query A'], arxiv: [], biorxiv: [], chemrxiv: [] },
};

beforeEach(() => {
  jest.clearAllMocks();
  configured = true;
  requireAppAccess.mockResolvedValue({ profileId: 7 });
});

describe('deriveWebQueries', () => {
  it('builds ≤3 topical queries from proposalInfo, capped', () => {
    const q = deriveWebQueries(ANALYSIS);
    expect(q).toHaveLength(3);
    expect(q[0]).toContain('synthetic biology');
    expect(q.some((s) => s.includes('CRISPRi') || s.includes('biosensor'))).toBe(true);
    expect(q.some((s) => s.includes('metabolic engineering'))).toBe(true);
  });

  it('does not duplicate the secondary area when it equals the primary', () => {
    const q = deriveWebQueries({ proposalInfo: { primaryResearchArea: 'X', secondaryAreas: 'x' } });
    expect(q).toEqual(['X researchers recent publications']);
  });

  it('targets individuals/recent work, not faculty directories (S230)', () => {
    const q = deriveWebQueries(ANALYSIS);
    expect(q.join(' ')).not.toMatch(/faculty|research group/i);
    expect(q.some((s) => /recent (publications|research|.*papers)/i.test(s))).toBe(true);
  });

  it('falls back to literature queries when proposalInfo is empty', () => {
    const q = deriveWebQueries({ proposalInfo: {}, searchQueries: { pubmed: ['fallback query A'] } });
    expect(q).toEqual(['fallback query A']);
  });

  it('returns [] when nothing usable is present', () => {
    expect(deriveWebQueries({})).toEqual([]);
    expect(deriveWebQueries(null)).toEqual([]);
  });
});

describe('collectExcludeNames (COI/self filter)', () => {
  it('pulls PI + Co-Investigators from the analysis and merges caller exclusions', () => {
    const names = collectExcludeNames({
      proposalInfo: {
        principalInvestigator: 'Dr. Jane Smith',
        coInvestigators: 'Anthony Leung, John Doe',
      },
    }, ['Excluded Person']);
    expect(names).toEqual(expect.arrayContaining(['Dr. Jane Smith', 'Anthony Leung', 'John Doe', 'Excluded Person']));
  });

  it('drops null-equivalent sentinels (None / Not specified)', () => {
    const names = collectExcludeNames({
      proposalInfo: { principalInvestigator: 'Not specified', coInvestigators: 'None' },
    });
    expect(names).toEqual([]);
  });
});

describe('deriveProposalContext', () => {
  it('joins research areas + title, skipping blanks', () => {
    expect(deriveProposalContext(ANALYSIS)).toBe('synthetic biology — metabolic engineering — Engineered gene circuits for biosensing');
    expect(deriveProposalContext({ proposalInfo: { primaryResearchArea: 'X' } })).toBe('X');
  });
});

describe('handler', () => {
  it('rejects non-POST (405)', async () => {
    const r = res();
    await handler({ method: 'GET' }, r);
    expect(r.statusCode).toBe(405);
    expect(search).not.toHaveBeenCalled();
  });

  it('stops when auth fails (requireAppAccess returned null)', async () => {
    requireAppAccess.mockResolvedValue(null);
    const r = res();
    await handler(post({ analysisResult: ANALYSIS }), r);
    expect(search).not.toHaveBeenCalled();
  });

  it('returns an empty panel (no throw) when the key is unset', async () => {
    configured = false;
    const r = res();
    await handler(post({ analysisResult: ANALYSIS }), r);
    expect(r.statusCode).toBe(200);
    expect(r.body).toEqual({ success: true, webLeads: [], skipped: 'no_key' });
    expect(search).not.toHaveBeenCalled();
  });

  it('400s when analysisResult is missing', async () => {
    const r = res();
    await handler(post({}), r);
    expect(r.statusCode).toBe(400);
    expect(search).not.toHaveBeenCalled();
  });

  it('returns an empty panel when no queries can be derived', async () => {
    const r = res();
    await handler(post({ analysisResult: { proposalInfo: {} } }), r);
    expect(r.statusCode).toBe(200);
    expect(r.body).toEqual({ success: true, webLeads: [], skipped: 'no_queries' });
    expect(search).not.toHaveBeenCalled();
  });

  it('passes derived queries + context + profileId to WebDiscoveryService and returns its leads', async () => {
    const r = res();
    await handler(post({ analysisResult: ANALYSIS }), r);
    expect(r.statusCode).toBe(200);
    expect(search).toHaveBeenCalledTimes(1);
    const arg = search.mock.calls[0][0];
    expect(arg.queries.length).toBe(3);
    expect(arg.proposalContext).toContain('synthetic biology');
    expect(arg.userProfileId).toBe(7);
    expect(r.body.success).toBe(true);
    expect(r.body.webLeads).toHaveLength(1);
    expect(r.body.webLeads[0].name).toBe('Jane Smith');
  });

  it('forwards the proposal PI/Co-Is + caller exclusions to search as excludeNames (COI filter, S230)', async () => {
    const r = res();
    const analysis = {
      ...ANALYSIS,
      proposalInfo: { ...ANALYSIS.proposalInfo, principalInvestigator: 'Jane Smith', coInvestigators: 'Anthony Leung' },
    };
    await handler(post({ analysisResult: analysis, excludeNames: ['Manual Exclude'] }), r);
    expect(search).toHaveBeenCalledTimes(1);
    const arg = search.mock.calls[0][0];
    expect(arg.excludeNames).toEqual(expect.arrayContaining(['Jane Smith', 'Anthony Leung', 'Manual Exclude']));
  });

  it('warms model overrides BEFORE calling search (regression: prod 404 on tier key "sonnet")', async () => {
    const r = res();
    await handler(post({ analysisResult: ANALYSIS }), r);
    expect(loadModelOverrides).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledTimes(1);
    // Ordering: the override cache must be warm before the service resolves a model.
    expect(loadModelOverrides.mock.invocationCallOrder[0])
      .toBeLessThan(search.mock.invocationCallOrder[0]);
  });
});
