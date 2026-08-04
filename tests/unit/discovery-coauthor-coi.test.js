/**
 * Characterization tests for the DiscoveryService coauthor-COI cluster
 * (toPubMedAuthorFormat, checkCoauthorHistory, checkCoauthorshipsForCandidates).
 * gradeCoauthorCOI is already covered by discovery-track-b-identity.test.js.
 *
 * Written before Stage 4 of the DiscoveryService decomposition
 * (docs/DISCOVERY_SERVICE_DECOMPOSITION_PLAN.md) to pin current behavior before the code moves to
 * lib/services/discovery/coauthor-coi.js. PubMedService is mocked so no network is hit.
 */

jest.mock('../../lib/services/pubmed-service', () => ({
  PubMedService: { search: jest.fn() },
}));
const { PubMedService } = require('../../lib/services/pubmed-service');
const { DiscoveryService } = require('../../lib/services/discovery-service');

beforeEach(() => { PubMedService.search.mockReset(); });
afterEach(() => { jest.restoreAllMocks(); });

describe('DiscoveryService.toPubMedAuthorFormat', () => {
  it('formats "First Last" as "Last F", stripping titles', () => {
    expect(DiscoveryService.toPubMedAuthorFormat('Forest Rohwer')).toBe('Rohwer F');
    expect(DiscoveryService.toPubMedAuthorFormat('Dr. Mya Breitbart')).toBe('Breitbart M');
  });
  it('returns a single token unchanged', () => {
    expect(DiscoveryService.toPubMedAuthorFormat('Cher')).toBe('Cher');
  });
});

describe('DiscoveryService.checkCoauthorHistory', () => {
  it('short-circuits with no proposal authors', async () => {
    const out = await DiscoveryService.checkCoauthorHistory('Jane Smith', []);
    expect(out).toEqual({ hasCoauthorship: false, coauthorships: [] });
    expect(PubMedService.search).not.toHaveBeenCalled();
  });
  it('aggregates shared papers and reports the max-with-one-author', async () => {
    PubMedService.search.mockResolvedValue([
      { title: 'P1', year: 2021, pmid: '11' },
      { title: 'P2', year: 2022, pmid: '12' },
    ]);
    const out = await DiscoveryService.checkCoauthorHistory('Jane Smith', ['Bob Jones']);
    expect(out.hasCoauthorship).toBe(true);
    expect(out.sharedPaperTotal).toBe(2);
    expect(out.maxSharedWithOneAuthor).toBe(2);
    expect(out.coauthorships[0]).toMatchObject({ proposalAuthor: 'Bob Jones', paperCount: 2 });
    // Query uses PubMed author format for both names.
    expect(PubMedService.search).toHaveBeenCalledWith(
      'Smith J[Author] AND Jones B[Author]',
      10,
      { throwOnError: true },
    );
    expect(out.coauthorCheckStatus).toBe('complete');
    expect(out.coauthorCheckFailures).toEqual([]);
  });
  it('skips a "not specified" proposal author', async () => {
    const out = await DiscoveryService.checkCoauthorHistory('Jane Smith', ['not specified']);
    expect(out.hasCoauthorship).toBe(false);
    expect(PubMedService.search).not.toHaveBeenCalled();
  });
  it('marks an exhausted PubMed failure incomplete instead of treating it as a clean negative', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    const error = Object.assign(new Error('PubMed esearch failed (429)'), { status: 429 });
    PubMedService.search.mockRejectedValue(error);
    const out = await DiscoveryService.checkCoauthorHistory('Jane Smith', ['Bob Jones']);
    expect(out.hasCoauthorship).toBe(false);
    expect(out.coauthorCheckStatus).toBe('incomplete');
    expect(out.coauthorCheckFailures).toEqual([{
      proposalAuthor: 'Bob Jones',
      status: 429,
      reason: 'rate_limited',
    }]);
  });
  it('propagates cancellation instead of converting it into an incomplete check', async () => {
    const controller = new AbortController();
    const error = new Error('deadline exceeded');
    error.name = 'AbortError';
    PubMedService.search.mockRejectedValue(error);

    await expect(DiscoveryService.checkCoauthorHistory(
      'Jane Smith',
      ['Bob Jones'],
      { signal: controller.signal },
    )).rejects.toBe(error);
    expect(PubMedService.search).toHaveBeenCalledWith(
      'Smith J[Author] AND Jones B[Author]',
      10,
      { throwOnError: true, signal: controller.signal },
    );
  });
});

describe('DiscoveryService.checkCoauthorshipsForCandidates', () => {
  it('attaches coauthorship info + S238 grade to each candidate', async () => {
    // 3 shared papers with one author → "likely" (>= COAUTHOR_COI_STRONG_MIN).
    PubMedService.search.mockResolvedValue([
      { title: 'P1', pmid: '1' }, { title: 'P2', pmid: '2' }, { title: 'P3', pmid: '3' },
    ]);
    const out = await DiscoveryService.checkCoauthorshipsForCandidates(
      [{ name: 'Jane Smith' }], ['Bob Jones'],
    );
    expect(out[0]).toMatchObject({
      name: 'Jane Smith',
      hasCoauthorCOI: true,
      coauthorSharedPaperTotal: 3,
      coauthorMaxWithOneAuthor: 3,
      coauthorCOIStrength: 'likely',
      coauthorCheckStatus: 'complete',
      coauthorCheckFailures: [],
    });
  });
  it('reconciles mixed candidate outcomes without discarding successful checks', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    const error = Object.assign(new Error('PubMed esearch failed (429)'), { status: 429 });
    PubMedService.search.mockImplementation(async (query) => {
      if (query.startsWith('Smith J')) return [{ title: 'P1', pmid: '1' }];
      throw error;
    });
    const out = await DiscoveryService.checkCoauthorshipsForCandidates(
      [{ name: 'Jane Smith' }, { name: 'Alex Rivera' }],
      ['Bob Jones'],
    );
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      name: 'Jane Smith',
      hasCoauthorCOI: true,
      coauthorCheckStatus: 'complete',
    });
    expect(out[1]).toMatchObject({
      name: 'Alex Rivera',
      hasCoauthorCOI: false,
      coauthorCheckStatus: 'incomplete',
      coauthorCheckFailures: [{ proposalAuthor: 'Bob Jones', status: 429, reason: 'rate_limited' }],
    });
  });
  it('returns candidates unchanged with no proposal authors', async () => {
    const cands = [{ name: 'X' }];
    expect(await DiscoveryService.checkCoauthorshipsForCandidates(cands, [])).toBe(cands);
  });
});

describe('DiscoveryService.summarizeCoauthorChecks', () => {
  it('never reports no conflicts when any candidate check is incomplete', () => {
    expect(DiscoveryService.summarizeCoauthorChecks([
      { name: 'Checked', hasCoauthorCOI: false, coauthorCheckStatus: 'complete' },
      { name: 'Partial', hasCoauthorCOI: false, coauthorCheckStatus: 'incomplete' },
    ])).toEqual({
      coiCount: 0,
      incompleteCount: 1,
      status: 'partial',
      message: 'PubMed coauthorship checks were incomplete for 1 candidate(s) after automatic retries',
    });
  });

  it('retains the existing positive and clean-negative messages for complete checks', () => {
    expect(DiscoveryService.summarizeCoauthorChecks([
      { hasCoauthorCOI: true, coauthorCheckStatus: 'complete' },
    ])).toMatchObject({
      coiCount: 1,
      incompleteCount: 0,
      status: 'complete',
      message: 'Found 1 candidate(s) with coauthorship history',
    });
    expect(DiscoveryService.summarizeCoauthorChecks([
      { hasCoauthorCOI: false, coauthorCheckStatus: 'complete' },
    ]).message).toBe('No coauthorship conflicts found');
  });
});
