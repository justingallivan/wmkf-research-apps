const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const manifest = require('../../../benchmarks/fuzzy-matching-falsification/versions/v3/manifest.json');
const {
  createCandidateSet,
  normalizeCandidate,
} = require('../../../benchmarks/fuzzy-matching-falsification/versions/v2/candidate-contract');
const {
  createRorCandidateUnionAdapter,
} = require('../../../benchmarks/fuzzy-matching-falsification/versions/v3/adapters-ror-api');
const {
  assertDecision,
} = require('../../../benchmarks/fuzzy-matching-falsification/versions/v3/decision-contract');
const {
  LOCALITY_EVIDENCE,
} = require('../../../benchmarks/fuzzy-matching-falsification/versions/v3/location-evidence');
const {
  ordinaryFallbackQueries,
  organizationSpans,
  parseOrganizationSpans,
} = require('../../../benchmarks/fuzzy-matching-falsification/versions/v3/organization-parser');
const {
  createInstitutionDecisionResolver,
} = require('../../../benchmarks/fuzzy-matching-falsification/versions/v3/resolver');
const { normalizeText } = require('../../../benchmarks/fuzzy-matching-falsification/versions/v3/text-evidence');

const UC_PARENT = 'https://ror.org/00pjdza24';

function organization(id, name, {
  aliases = [], acronyms = [], domains = [], city = null, country = 'US',
  types = ['education'], relationships = [], status = 'active',
} = {}) {
  return {
    id,
    status,
    names: [
      { value: name, types: ['ror_display', 'label'], lang: 'en' },
      ...aliases.map((value) => ({ value, types: ['alias'], lang: 'en' })),
      ...acronyms.map((value) => ({ value, types: ['acronym'], lang: null })),
    ],
    domains,
    locations: city ? [{ country_code: country, city, subdivision_code: null }] : [],
    types,
    relationships,
  };
}

function candidate(id, name, options = {}) {
  return normalizeCandidate(organization(id, name, options), {
    strategy: 'test', rank: 0, score: 1, matching_type: 'test', provider_chosen: true,
  });
}

function set(...candidates) {
  return createCandidateSet({
    provider: 'test',
    candidates,
    provenance: {
      api_version: 'test', adapter_version: 'test/v1', observed_on: '2026-08-07',
      input_hash: 'a'.repeat(64), strategies: ['test'], request_count: 0, retry_count: 0,
    },
  });
}

function adapterFor(map) {
  return {
    institutionCandidates: jest.fn(async (input) => {
      const value = map[normalizeText(input.affiliation_string)];
      if (value instanceof Error) throw value;
      return set(...(value || []));
    }),
  };
}

describe('falsification suite v3 frozen boundary', () => {
  test('pins every v2 input consumed by the final-decision benchmark', () => {
    const baseDir = path.resolve(
      __dirname,
      '../../../benchmarks/fuzzy-matching-falsification/versions/v3',
      manifest.base_suite,
    );
    for (const [relativePath, expectedHash] of Object.entries(manifest.base_files_sha256)) {
      const actual = crypto.createHash('sha256')
        .update(fs.readFileSync(path.join(baseDir, relativePath))).digest('hex');
      expect(actual).toBe(expectedHash);
    }
  });

  test('requires every curated locality alias to carry authoritative provenance', () => {
    for (const evidence of Object.values(LOCALITY_EVIDENCE)) {
      expect(evidence.aliases.length).toBeGreaterThan(0);
      expect(evidence.sources.length).toBeGreaterThan(0);
      expect(evidence.sources.every((source) => source.startsWith('https://'))).toBe(true);
    }
  });

  test('pins the accepted result hash and strips skipped-case payloads', () => {
    const resultPath = path.resolve(
      __dirname,
      '../../../benchmarks/fuzzy-matching-falsification/versions/v3/results/ror-claim-resolver-2026-08-07-v11.results.jsonl',
    );
    const summary = require('../../../benchmarks/fuzzy-matching-falsification/versions/v3/results/ror-claim-resolver-2026-08-07-v11.summary.json');
    const bytes = fs.readFileSync(resultPath);
    expect(crypto.createHash('sha256').update(bytes).digest('hex')).toBe(summary.result_sha256);
    const skipped = bytes.toString('utf8').trim().split('\n').map(JSON.parse)
      .filter((row) => row.status === 'skipped');
    expect(skipped).toHaveLength(25);
    expect(skipped.every((row) => !('input' in row) && !('expected_v1' in row))).toBe(true);
  });
});

describe('organization parsing and controlled fallback', () => {
  test('splits independent organizations but keeps a single branded organization intact', () => {
    expect(organizationSpans(
      'Dana-Farber Cancer Institute and Harvard Medical School, Boston, MA',
    )).toEqual(['Dana-Farber Cancer Institute', 'Harvard Medical School, Boston, MA']);
    expect(organizationSpans('Broad Institute of MIT and Harvard, Cambridge, MA'))
      .toEqual(['Broad Institute of MIT and Harvard, Cambridge, MA']);
    expect(organizationSpans('Alpha University and Beta Institute and Gamma College'))
      .toEqual(['Alpha University', 'Beta Institute', 'Gamma College']);
    expect(organizationSpans('Harvard University and MIT'))
      .toEqual(['Harvard University', 'MIT']);
    expect(organizationSpans('Massachusetts Institute of Technology and Harvard University'))
      .toEqual(['Massachusetts Institute of Technology', 'Harvard University']);
    expect(parseOrganizationSpans('Harvard University, Massachusetts Institute of Technology'))
      .toMatchObject({ spans: [], issue: 'unparsed_multi_organization_delimiter' });
    expect(parseOrganizationSpans('Harvard and MIT')).toMatchObject({
      spans: [], issue: 'unparsed_organization_conjunction',
    });
    expect(parseOrganizationSpans(
      'A University; B University; C University; D University; E University; F University',
    )).toMatchObject({ spans: [], issue: 'organization_span_overflow' });
  });

  test('normalizes dotted acronyms and bounds ordinary-query variants', () => {
    expect(ordinaryFallbackQueries('U.C.S.D.')).toEqual(['UCSD']);
    expect(ordinaryFallbackQueries('Harvard Medical School, Boston, MA'))
      .toEqual(expect.arrayContaining(['Harvard Medical School, Boston, MA', 'Harvard Medical School']));
    expect(ordinaryFallbackQueries('Harvard Medical School, Boston, MA').length).toBeLessThanOrEqual(3);
    expect(ordinaryFallbackQueries('NC State University'))
      .toContain('North Carolina State University');
    expect(ordinaryFallbackQueries('CA State University'))
      .toContain('California State University');
  });
});

describe('ROR v3 candidate-union adapter', () => {
  function response(body, status = 200, retryAfter = null) {
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: () => retryAfter },
      json: async () => body,
    };
  }

  test('uses explicit single_search and skips ordinary query after a strong affiliation hit', async () => {
    const harvard = organization('https://ror.org/03vek6s52', 'Harvard University');
    const fetchImpl = jest.fn(async () => response({ items: [{ organization: harvard }] }));
    const adapter = createRorCandidateUnionAdapter({ fetchImpl, paceMs: 0, sleep: async () => {} });
    const result = await adapter.institutionCandidates({ affiliation_string: 'Harvard University' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toContain('affiliation=Harvard%20University&single_search');
    expect(result.provenance.strategies).toEqual(['affiliation-single-search']);
  });

  test('uses all-status ordinary fallback and hydrates an explicit successor', async () => {
    const harvard = organization('https://ror.org/03vek6s52', 'Harvard University');
    const hms = organization('https://ror.org/03wevmz92', 'Harvard Medical School', {
      status: 'withdrawn',
      relationships: [{ id: harvard.id, type: 'successor', label: 'Harvard University' }],
    });
    const fetchImpl = jest.fn(async (url) => {
      if (url.includes('affiliation=')) return response({ items: [] });
      if (url.endsWith('/03vek6s52')) return response(harvard);
      return response({ items: [hms] });
    });
    const adapter = createRorCandidateUnionAdapter({ fetchImpl, paceMs: 0, sleep: async () => {} });
    const result = await adapter.institutionCandidates({
      affiliation_string: 'Harvard Medical School, Boston, MA',
    });
    expect(fetchImpl.mock.calls.some(([url]) => url.includes('query=') && url.includes('all_status')))
      .toBe(true);
    expect(result.candidates.map((item) => item.ror_id)).toEqual(expect.arrayContaining([
      hms.id, harvard.id,
    ]));
    expect(result.provenance.strategies).toEqual(expect.arrayContaining([
      'affiliation-single-search', 'ordinary-query', 'successor-hydration',
    ]));
  });

  test('queries an unmatched embedded acronym even after a strong primary hit', async () => {
    const berkeley = organization('https://ror.org/01an7q238', 'University of California, Berkeley');
    const ucla = organization('https://ror.org/046rm7j60', 'University of California, Los Angeles', {
      acronyms: ['UCLA'],
    });
    const fetchImpl = jest.fn(async (url) => {
      if (url.includes('affiliation=')) {
        return response({ items: [{ organization: berkeley, chosen: true }] });
      }
      return response({ items: [ucla] });
    });
    const adapter = createRorCandidateUnionAdapter({ fetchImpl, paceMs: 0, sleep: async () => {} });
    const result = await adapter.institutionCandidates({
      affiliation_string: 'University of California, Berkeley (UCLA)',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[1][0]).toContain('query=UCLA');
    expect(result.candidates.map((item) => item.ror_id)).toContain(ucla.id);
  });

  test('does not conflate punctuation-distinct ROR request URLs in its cache', async () => {
    const plain = organization('https://ror.org/0168r3w48', 'UC San Diego');
    const dotted = organization('https://ror.org/042nb2s44', 'U.C. San Diego');
    const fetchImpl = jest.fn(async (url) => response({
      items: [{ organization: url.includes('U.C.') ? dotted : plain }],
    }));
    const adapter = createRorCandidateUnionAdapter({ fetchImpl, paceMs: 0, sleep: async () => {} });
    const first = await adapter.institutionCandidates({ affiliation_string: 'UC San Diego' });
    const second = await adapter.institutionCandidates({ affiliation_string: 'U.C. San Diego' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(first.candidates[0].ror_id).toBe(plain.id);
    expect(second.candidates[0].ror_id).toBe(dotted.id);
  });

  test('single-flights only the same exact URL in the same cancellation scope', async () => {
    let release;
    let startedResolve;
    const started = new Promise((resolve) => { startedResolve = resolve; });
    const harvard = organization('https://ror.org/03vek6s52', 'Harvard University');
    const fetchImpl = jest.fn(async () => new Promise((resolve) => {
      release = resolve;
      startedResolve();
    }));
    const adapter = createRorCandidateUnionAdapter({ fetchImpl, paceMs: 0 });
    const first = adapter.institutionCandidates({ affiliation_string: 'Harvard University' });
    const second = adapter.institutionCandidates({ affiliation_string: 'Harvard University' });
    await started;
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    release(response({ items: [{ organization: harvard }] }));
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(adapter.metrics.single_flight_hits).toBe(1);
  });

  test('caps the combined ordinary-query union and total provider request budget', async () => {
    const fetchImpl = jest.fn(async () => response({ items: [] }));
    const adapter = createRorCandidateUnionAdapter({ fetchImpl, paceMs: 0, sleep: async () => {} });
    await adapter.institutionCandidates({
      affiliation_string: 'AA BB CC DD EE FF GG HH II JJ Research Group',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(4);

    const budgetedFetch = jest.fn(async () => response({ items: [] }));
    const budgeted = createRorCandidateUnionAdapter({
      fetchImpl: budgetedFetch,
      maxProviderRequestsPerResolution: 2,
      paceMs: 0,
      sleep: async () => {},
    });
    await expect(budgeted.institutionCandidates({
      affiliation_string: 'AA BB CC DD EE Research Group',
    }))
      .rejects.toThrow('request budget exhausted');
    expect(budgetedFetch).toHaveBeenCalledTimes(2);
  });

  test('falls back exponentially when Retry-After is absent', async () => {
    const harvard = organization('https://ror.org/03vek6s52', 'Harvard University');
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(response({}, 503))
      .mockResolvedValueOnce(response({ items: [{ organization: harvard }] }));
    const sleep = jest.fn(async () => {});
    const adapter = createRorCandidateUnionAdapter({
      fetchImpl, paceMs: 0, backoffBaseMs: 1000, sleep,
    });
    const result = await adapter.institutionCandidates({ affiliation_string: 'Harvard University' });
    expect(sleep).toHaveBeenCalledWith(1000);
    expect(result.provenance).toMatchObject({ request_count: 2, retry_count: 1 });
    expect(adapter.metrics).toMatchObject({ provider_requests: 2, retries: 1 });
    expect(Object.keys(adapter.metrics)).not.toEqual(expect.arrayContaining([
      'affiliation_string', 'query', 'organization_name',
    ]));
  });

  test('caps Retry-After and cancels while waiting in retry backoff', async () => {
    const ok = response({ items: [] });
    const cappedFetch = jest.fn()
      .mockResolvedValueOnce(response({}, 429, '9999'))
      .mockResolvedValue(ok);
    const cappedSleep = jest.fn(async () => {});
    const capped = createRorCandidateUnionAdapter({
      fetchImpl: cappedFetch, paceMs: 0, maxRetryDelayMs: 5000, sleep: cappedSleep,
    });
    await capped.institutionCandidates({ affiliation_string: 'Unknown University' });
    expect(cappedSleep).toHaveBeenCalledWith(5000);

    const controller = new AbortController();
    let providerStartedResolve;
    const providerStarted = new Promise((resolve) => { providerStartedResolve = resolve; });
    const retrying = createRorCandidateUnionAdapter({
      fetchImpl: jest.fn(async () => {
        providerStartedResolve();
        return response({}, 503);
      }),
      paceMs: 0,
      sleep: async () => new Promise(() => {}),
    });
    const pending = retrying.institutionCandidates({
      affiliation_string: 'Unknown University', signal: controller.signal,
    });
    await providerStarted;
    await Promise.resolve();
    controller.abort(new Error('cancelled during backoff'));
    await expect(pending).rejects.toThrow('cancelled during backoff');
    expect(retrying.metrics.provider_failures).toBe(0);
  });

  test('honors cancellation even when a response is already cached', async () => {
    const harvard = organization('https://ror.org/03vek6s52', 'Harvard University');
    const fetchImpl = jest.fn(async () => response({ items: [{ organization: harvard }] }));
    const adapter = createRorCandidateUnionAdapter({ fetchImpl, paceMs: 0, sleep: async () => {} });
    await adapter.institutionCandidates({ affiliation_string: 'Harvard University' });
    const controller = new AbortController();
    controller.abort(new Error('cancelled'));
    await expect(adapter.institutionCandidates({
      affiliation_string: 'Harvard University', signal: controller.signal,
    })).rejects.toThrow('cancelled');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test('cancels a queued lookup before the earlier provider request finishes', async () => {
    let releaseFirst;
    let firstStartedResolve;
    const firstStarted = new Promise((resolve) => { firstStartedResolve = resolve; });
    const harvard = organization('https://ror.org/03vek6s52', 'Harvard University');
    const fetchImpl = jest.fn(async () => new Promise((resolve) => {
      releaseFirst = resolve;
      firstStartedResolve();
    }));
    const adapter = createRorCandidateUnionAdapter({
      fetchImpl, paceMs: 0, requestTimeoutMs: 1000, resolutionTimeoutMs: 1000,
    });
    const first = adapter.institutionCandidates({ affiliation_string: 'Harvard University' });
    await firstStarted;
    const controller = new AbortController();
    const second = adapter.institutionCandidates({
      affiliation_string: 'MIT', signal: controller.signal,
    });
    controller.abort(new Error('queued cancellation'));
    await expect(second).rejects.toThrow('queued cancellation');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    releaseFirst(response({ items: [{ organization: harvard }] }));
    await first;
  });

  test('bounds a stalled provider request and records the failure', async () => {
    const fetchImpl = jest.fn(async (url, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }));
    const adapter = createRorCandidateUnionAdapter({
      fetchImpl, paceMs: 0, requestTimeoutMs: 5, sleep: async () => {},
    });
    await expect(adapter.institutionCandidates({ affiliation_string: 'Harvard University' }))
      .rejects.toMatchObject({ name: 'TimeoutError' });
    expect(adapter.metrics).toMatchObject({ provider_failures: 1, provider_requests: 1 });
  });

  test('bounds the whole resolution independently of the per-request timeout', async () => {
    const fetchImpl = jest.fn(async (url, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }));
    const adapter = createRorCandidateUnionAdapter({
      fetchImpl,
      paceMs: 0,
      requestTimeoutMs: 1000,
      resolutionTimeoutMs: 5,
      sleep: async () => {},
    });
    await expect(adapter.institutionCandidates({ affiliation_string: 'Harvard University' }))
      .rejects.toMatchObject({ name: 'TimeoutError' });
    expect(adapter.metrics.provider_failures).toBe(1);
  });

  test('shares the request budget and deadline across every span in one public resolution', async () => {
    const budgetedFetch = jest.fn(async () => response({ items: [] }));
    const budgetedAdapter = createRorCandidateUnionAdapter({
      fetchImpl: budgetedFetch,
      maxProviderRequestsPerResolution: 3,
      paceMs: 0,
      sleep: async () => {},
    });
    const budgetedResolver = createInstitutionDecisionResolver({ candidateAdapter: budgetedAdapter });
    await expect(budgetedResolver.resolve({
      affiliation_string: 'Alpha University and Beta University',
    })).resolves.toMatchObject({
      outcome: 'review', reasons: ['provider_failure'], selected_ror_ids: [],
    });
    expect(budgetedFetch).toHaveBeenCalledTimes(3);
    expect(budgetedAdapter.metrics).toMatchObject({ provider_failures: 1, provider_requests: 3 });

    const pairFetch = jest.fn(async () => response({ items: [] }));
    const pairAdapter = createRorCandidateUnionAdapter({
      fetchImpl: pairFetch,
      maxProviderRequestsPerResolution: 3,
      paceMs: 0,
      sleep: async () => {},
    });
    const pairResolver = createInstitutionDecisionResolver({ candidateAdapter: pairAdapter });
    await expect(pairResolver.compare({
      listed: 'Alpha University', evidence: 'Beta University',
    })).resolves.toMatchObject({ outcome: 'review' });
    expect(pairFetch).toHaveBeenCalledTimes(3);
    expect(pairAdapter.metrics).toMatchObject({ provider_failures: 1, provider_requests: 3 });

    jest.useFakeTimers();
    try {
      const alpha = organization('https://ror.org/000000001', 'Alpha University');
      const beta = organization('https://ror.org/000000002', 'Beta University');
      const timedFetch = jest.fn(async (url, { signal }) => new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve(response({
          items: [{ organization: url.includes('Alpha') ? alpha : beta }],
        })), 8);
        signal.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(signal.reason);
        }, { once: true });
      }));
      const timedAdapter = createRorCandidateUnionAdapter({
        fetchImpl: timedFetch,
        paceMs: 0,
        requestTimeoutMs: 1000,
        resolutionTimeoutMs: 10,
      });
      const timedResolver = createInstitutionDecisionResolver({ candidateAdapter: timedAdapter });
      const pending = timedResolver.resolve({
        affiliation_string: 'Alpha University and Beta University',
      });
      await jest.advanceTimersByTimeAsync(8);
      await jest.advanceTimersByTimeAsync(3);
      await expect(pending).resolves.toMatchObject({
        outcome: 'review', reasons: ['provider_failure'], selected_ror_ids: [],
      });
      expect(timedFetch).toHaveBeenCalledTimes(2);
      expect(timedAdapter.metrics.provider_failures).toBe(1);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('veto-first institution decisions', () => {
  const berkeley = candidate('https://ror.org/01an7q238', 'University of California, Berkeley', {
    aliases: ['UC Berkeley'], acronyms: ['UCB'], domains: ['berkeley.edu'], city: 'Berkeley',
    relationships: [{ id: UC_PARENT, type: 'parent', label: 'University of California System' }],
  });
  const ucla = candidate('https://ror.org/046rm7j60', 'University of California, Los Angeles', {
    aliases: ['UC Los Angeles'], acronyms: ['UCLA'], domains: ['ucla.edu'], city: 'Los Angeles',
    relationships: [{ id: UC_PARENT, type: 'parent', label: 'University of California System' }],
  });

  test('resolves a unique exact campus claim', async () => {
    const resolver = createInstitutionDecisionResolver({
      candidateAdapter: adapterFor({ 'uc berkeley': [berkeley, ucla] }),
    });
    const decision = await resolver.resolve({ affiliation_string: 'UC Berkeley' });
    expect(decision).toMatchObject({
      outcome: 'resolved', selected_ror_ids: [berkeley.ror_id],
    });
    expect(() => assertDecision(decision)).not.toThrow();
    expect(JSON.stringify(decision)).not.toContain('UC Berkeley');
  });

  test('vetoes contradictory sibling acronym evidence even when one candidate is chosen', async () => {
    const input = 'University of California, Berkeley (UCLA)';
    const resolver = createInstitutionDecisionResolver({
      candidateAdapter: adapterFor({ [normalizeText(input)]: [berkeley, ucla] }),
    });
    const decision = await resolver.resolve({ affiliation_string: input });
    expect(decision).toMatchObject({ outcome: 'review', selected_ror_ids: [] });
    expect(decision.reasons).toContain('sibling_conflict');
  });

  test('does not treat a related facility as a peer university conflict', async () => {
    const lab = candidate('https://ror.org/02jbv0t02', 'Lawrence Berkeley National Laboratory', {
      city: 'Berkeley', types: ['facility', 'funder'],
      relationships: [{ id: UC_PARENT, type: 'parent', label: 'University of California System' }],
    });
    const input = 'Lawrence Berkeley National Laboratory';
    const resolver = createInstitutionDecisionResolver({
      candidateAdapter: adapterFor({ [normalizeText(input)]: [lab, berkeley] }),
    });
    await expect(resolver.resolve({ affiliation_string: input })).resolves.toMatchObject({
      outcome: 'resolved', selected_ror_ids: [lab.ror_id],
    });
  });

  test('uses parent-family acronym scope to distinguish a colliding acronym', async () => {
    const unrelated = candidate('https://ror.org/03qgg3111', 'Unrelated University', {
      acronyms: ['UCLA'],
    });
    const input = 'UCLA';
    const resolver = createInstitutionDecisionResolver({
      candidateAdapter: adapterFor({ [normalizeText(input)]: [unrelated, ucla] }),
    });
    await expect(resolver.resolve({ affiliation_string: input })).resolves.toMatchObject({
      outcome: 'resolved', selected_ror_ids: [ucla.ror_id],
    });
  });

  test('prefers a generic organization-type completion over a branded branch', async () => {
    const flagship = candidate('https://ror.org/01f5ytq51', 'Texas A&M University');
    const branch = candidate('https://ror.org/01mrfdz82', 'Texas A&M University Corpus Christi');
    const system = candidate('https://ror.org/0034eay46', 'Texas A&M University System');
    const input = 'Texas A&M';
    const resolver = createInstitutionDecisionResolver({
      candidateAdapter: adapterFor({ [normalizeText(input)]: [flagship, branch, system] }),
    });
    await expect(resolver.resolve({ affiliation_string: input })).resolves.toMatchObject({
      outcome: 'resolved', selected_ror_ids: [flagship.ror_id],
    });
  });

  test('vetoes contradictory explicit location evidence without a fixture alias', async () => {
    const input = 'Department of Physics, UC Berkeley, La Jolla, California, USA';
    const resolver = createInstitutionDecisionResolver({
      candidateAdapter: adapterFor({ [normalizeText(input)]: [berkeley] }),
    });
    const decision = await resolver.resolve({ affiliation_string: input });
    expect(decision).toMatchObject({ outcome: 'review', selected_ror_ids: [] });
    expect(decision.evaluations[0].vetoes).toContain('location_conflict');

    const ucsd = candidate('https://ror.org/0168r3w48', 'University of California San Diego', {
      aliases: ['UC San Diego'], city: 'San Diego',
      relationships: [{ id: UC_PARENT, type: 'parent', label: 'University of California System' }],
    });
    const positive = 'University of California San Diego, La Jolla, California, USA';
    const positiveResolver = createInstitutionDecisionResolver({
      candidateAdapter: adapterFor({ [normalizeText(positive)]: [ucsd] }),
    });
    await expect(positiveResolver.resolve({ affiliation_string: positive }))
      .resolves.toMatchObject({ outcome: 'resolved', selected_ror_ids: [ucsd.ror_id] });
  });

  test('canonicalizes an explicit office-of-president claim to its hydrated parent', async () => {
    const system = candidate(UC_PARENT, 'University of California System');
    const office = candidate('https://ror.org/00dmfq477', 'University of California Office of the President', {
      relationships: [{ id: UC_PARENT, type: 'parent', label: 'University of California System' }],
    });
    const input = 'University of California Office of the President';
    const resolver = createInstitutionDecisionResolver({
      candidateAdapter: adapterFor({ [normalizeText(input)]: [office, system] }),
    });
    await expect(resolver.resolve({ affiliation_string: input })).resolves.toMatchObject({
      outcome: 'resolved', selected_ror_ids: [UC_PARENT], reasons: ['parent_scope_canonicalized'],
    });
  });

  test('does not resolve a generic office title to an unrelated system', async () => {
    const ucSystem = candidate(UC_PARENT, 'University of California System');
    const texasSystem = candidate('https://ror.org/0034eay46', 'Texas A&M University System');
    const input = 'Office of the President';
    const resolver = createInstitutionDecisionResolver({
      candidateAdapter: adapterFor({ [normalizeText(input)]: [ucSystem, texasSystem] }),
    });
    await expect(resolver.resolve({ affiliation_string: input })).resolves.toMatchObject({
      outcome: 'review', selected_ror_ids: [],
    });
  });

  test('vetoes mismatched domain evidence, including when ROR lacks a candidate domain', async () => {
    const irvine = candidate('https://ror.org/04gyf1771', 'University of California, Irvine', {
      aliases: ['UC Irvine'], city: 'Irvine',
      relationships: [{ id: UC_PARENT, type: 'parent', label: 'University of California System' }],
    });
    const resolver = createInstitutionDecisionResolver({
      candidateAdapter: adapterFor({ 'uc irvine': [irvine] }),
    });
    const decision = await resolver.resolve({
      affiliation_string: 'UC Irvine', domain_evidence: 'ucsb.edu',
    });
    expect(decision).toMatchObject({ outcome: 'review', selected_ror_ids: [] });
    expect(decision.evaluations[0].vetoes).toContain('domain_conflict');
  });

  test('keeps a bare parent claim in review but resolves explicit system scope', async () => {
    const system = candidate(UC_PARENT, 'University of California System', {
      acronyms: ['UC'], domains: ['universityofcalifornia.edu'], city: 'Oakland',
    });
    const candidateAdapter = adapterFor({
      'university of california': [system, berkeley, ucla],
      'university of california system': [system, berkeley, ucla],
    });
    const resolver = createInstitutionDecisionResolver({ candidateAdapter });
    await expect(resolver.resolve({ affiliation_string: 'University of California' }))
      .resolves.toMatchObject({ outcome: 'review', selected_ror_ids: [] });
    await expect(resolver.resolve({ affiliation_string: 'University of California system' }))
      .resolves.toMatchObject({ outcome: 'resolved', selected_ror_ids: [UC_PARENT] });
  });

  test('prefers a specific organization alias over related acronym mentions', async () => {
    const broad = candidate('https://ror.org/05a0ya142', 'Broad Institute', {
      aliases: ['Broad Institute of MIT and Harvard'], types: ['nonprofit'], city: 'Cambridge',
    });
    const mit = candidate('https://ror.org/042nb2s44', 'Massachusetts Institute of Technology', {
      acronyms: ['MIT'], city: 'Cambridge',
    });
    const input = 'Broad Institute of MIT and Harvard, Cambridge, MA';
    const resolver = createInstitutionDecisionResolver({
      candidateAdapter: adapterFor({ [normalizeText(input)]: [broad, mit] }),
    });
    await expect(resolver.resolve({ affiliation_string: input })).resolves.toMatchObject({
      outcome: 'resolved', selected_ror_ids: [broad.ror_id],
    });
  });

  test('resolves every independent span atomically and rejects partial multi-org success', async () => {
    const dana = candidate('https://ror.org/02jzgtq86', 'Dana-Farber Cancer Institute');
    const harvard = candidate('https://ror.org/03vek6s52', 'Harvard University');
    const hms = candidate('https://ror.org/03wevmz92', 'Harvard Medical School', {
      status: 'withdrawn',
      relationships: [{ id: harvard.ror_id, type: 'successor', label: 'Harvard University' }],
    });
    const input = 'Dana-Farber Cancer Institute and Harvard Medical School, Boston, MA';
    const complete = createInstitutionDecisionResolver({
      candidateAdapter: adapterFor({
        'dana farber cancer institute': [dana],
        'harvard medical school boston ma': [hms, harvard],
      }),
    });
    await expect(complete.resolve({ affiliation_string: input })).resolves.toMatchObject({
      outcome: 'resolved', selected_ror_ids: [dana.ror_id, harvard.ror_id].sort(),
    });

    const partial = createInstitutionDecisionResolver({
      candidateAdapter: adapterFor({
        'dana farber cancer institute': [dana],
        'harvard medical school boston ma': [],
      }),
    });
    await expect(partial.resolve({ affiliation_string: input })).resolves.toMatchObject({
      outcome: 'review', selected_ror_ids: [],
    });

    const mit = candidate('https://ror.org/042nb2s44', 'Massachusetts Institute of Technology', {
      acronyms: ['MIT'],
    });
    const acronymSpan = createInstitutionDecisionResolver({
      candidateAdapter: adapterFor({
        'harvard university': [harvard],
        'massachusetts institute of technology': [mit],
        mit: [mit],
      }),
    });
    await expect(acronymSpan.resolve({ affiliation_string: 'Harvard University and MIT' }))
      .resolves.toMatchObject({
        outcome: 'resolved', selected_ror_ids: [harvard.ror_id, mit.ror_id].sort(),
      });
    await expect(acronymSpan.resolve({
      affiliation_string: 'Massachusetts Institute of Technology and Harvard University',
    })).resolves.toMatchObject({
      outcome: 'resolved', selected_ror_ids: [harvard.ror_id, mit.ror_id].sort(),
    });
  });

  test('fails closed for unparsed conjunctions and span overflow before retrieval', async () => {
    const candidateAdapter = adapterFor({});
    const resolver = createInstitutionDecisionResolver({ candidateAdapter });
    await expect(resolver.resolve({ affiliation_string: 'Harvard and MIT' }))
      .resolves.toMatchObject({ outcome: 'review', reasons: ['unparsed_organization_conjunction'] });
    await expect(resolver.resolve({
      affiliation_string: 'Harvard University, Massachusetts Institute of Technology',
    })).resolves.toMatchObject({
      outcome: 'review', reasons: ['unparsed_multi_organization_delimiter'],
    });
    await expect(resolver.resolve({
      affiliation_string: 'A University; B University; C University; D University; E University; F University',
    })).resolves.toMatchObject({ outcome: 'review', reasons: ['organization_span_overflow'] });
    expect(candidateAdapter.institutionCandidates).not.toHaveBeenCalled();
  });

  test('fails closed on provider errors', async () => {
    const resolver = createInstitutionDecisionResolver({
      candidateAdapter: adapterFor({ harvard: new Error('provider unavailable') }),
    });
    await expect(resolver.resolve({ affiliation_string: 'Harvard' })).resolves.toMatchObject({
      outcome: 'review', selected_ror_ids: [], reasons: ['provider_failure'],
    });
  });
});

describe('relationship-aware product comparison', () => {
  test('accepts name-compatible related entities but reviews unrelated related entities', async () => {
    const vanderbilt = candidate('https://ror.org/02vm5rt34', 'Vanderbilt University', {
      relationships: [{
        id: 'https://ror.org/05dq2gs74', type: 'related', label: 'Vanderbilt University Medical Center',
      }],
    });
    const vumc = candidate('https://ror.org/05dq2gs74', 'Vanderbilt University Medical Center');
    const harvard = candidate('https://ror.org/03vek6s52', 'Harvard University', {
      relationships: [{
        id: 'https://ror.org/02jzgtq86', type: 'related', label: 'Dana-Farber Cancer Institute',
      }],
    });
    const dana = candidate('https://ror.org/02jzgtq86', 'Dana-Farber Cancer Institute');
    const resolver = createInstitutionDecisionResolver({
      candidateAdapter: adapterFor({
        'vanderbilt university': [vanderbilt],
        'vanderbilt university medical center': [vumc],
        'harvard university': [harvard],
        'dana farber cancer institute': [dana],
      }),
    });
    await expect(resolver.compare({
      listed: 'Vanderbilt University', evidence: 'Vanderbilt University Medical Center',
    })).resolves.toMatchObject({ outcome: 'resolved', relation: 'related' });
    await expect(resolver.compare({
      listed: 'Harvard University', evidence: 'Dana-Farber Cancer Institute',
    })).resolves.toMatchObject({ outcome: 'review', relation: 'related' });
  });

  test('deduplicates the same organization selected from repeated independent spans', async () => {
    const columbia = candidate('https://ror.org/00hj8s172', 'Columbia University');
    const evidence = 'Columbia University; Columbia University';
    const resolver = createInstitutionDecisionResolver({
      candidateAdapter: adapterFor({
        'columbia university': [columbia],
      }),
    });
    await expect(resolver.compare({ listed: 'Columbia University', evidence }))
      .resolves.toMatchObject({ outcome: 'resolved', relation: 'same' });
  });
});
