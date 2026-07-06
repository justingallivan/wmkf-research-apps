/**
 * Characterization tests for the DiscoveryService Track-B literature-search cluster
 * (searchPubMed, searchArXiv, searchBioRxiv, searchChemRxiv).
 *
 * These methods are ARCHIVED-OFF in production (TRACK_B_ENABLED=false) but retained; this suite
 * pins their author-extraction + candidate-mapping behavior before the code moves to
 * lib/services/discovery/literature-search.js (Stage 4, docs/DISCOVERY_SERVICE_DECOMPOSITION_PLAN.md).
 * All four scholarly services are mocked so no network is hit. Single-query inputs avoid the
 * inter-query rate-limit sleeps.
 */

jest.mock('../../lib/services/pubmed-service', () => ({ PubMedService: { search: jest.fn() } }));
jest.mock('../../lib/services/arxiv-service', () => ({ ArXivService: { search: jest.fn() } }));
jest.mock('../../lib/services/biorxiv-service', () => ({ BioRxivService: { search: jest.fn() } }));
jest.mock('../../lib/services/chemrxiv-service', () => ({ ChemRxivService: { search: jest.fn() } }));

const { PubMedService } = require('../../lib/services/pubmed-service');
const { ArXivService } = require('../../lib/services/arxiv-service');
const { BioRxivService } = require('../../lib/services/biorxiv-service');
const { ChemRxivService } = require('../../lib/services/chemrxiv-service');
const { DiscoveryService } = require('../../lib/services/discovery-service');
const { PROVENANCE_KINDS, SEED_ROLES } = require('../../lib/utils/reviewer-provenance');

describe('DiscoveryService.searchPubMed', () => {
  it('extracts the senior (last) author as a literature-retrieved candidate', async () => {
    PubMedService.search.mockResolvedValue([
      { title: 'Paper', year: 2022, pmid: '99', journal: 'Nature', doi: '10.1/x',
        authors: [{ name: 'Junior A' }, { name: 'Senior Z', affiliation: 'Uni Z' }] },
    ]);
    const out = await DiscoveryService.searchPubMed(['cancer'], () => {});
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      name: 'Senior Z',
      affiliation: 'Uni Z',
      source: 'pubmed',
      publications: [{ title: 'Paper', year: 2022, pmid: '99', journal: 'Nature', doi: '10.1/x', url: 'https://pubmed.ncbi.nlm.nih.gov/99' }],
    });
    expect(out[0].provenance).toMatchObject({ kind: PROVENANCE_KINDS.LITERATURE_RETRIEVED, seedRole: SEED_ROLES.QUERY_SEED });
  });
});

describe('DiscoveryService.searchArXiv', () => {
  it('maps the last author with an arXiv url', async () => {
    ArXivService.search.mockResolvedValue([
      { title: 'Preprint', year: 2023, arxivId: '2301.001', authors: ['First', 'Last Author'] },
    ]);
    const out = await DiscoveryService.searchArXiv(['quantum'], () => {});
    expect(out[0]).toMatchObject({
      name: 'Last Author',
      source: 'arxiv',
      publications: [{ title: 'Preprint', year: 2023, arxivId: '2301.001', url: 'https://arxiv.org/abs/2301.001' }],
    });
  });
});

describe('DiscoveryService.searchBioRxiv', () => {
  it('uses the corresponding author + article-level institution', async () => {
    BioRxivService.search.mockResolvedValue([
      { title: 'Bio', year: 2022, doi: '10.1101/abc', correspondingAuthor: 'Corr Author', institution: 'Bio Inst' },
    ]);
    const out = await DiscoveryService.searchBioRxiv(['bio'], () => {});
    expect(out[0]).toMatchObject({
      name: 'Corr Author',
      affiliation: 'Bio Inst',
      source: 'biorxiv',
      publications: [{ title: 'Bio', year: 2022, doi: '10.1101/abc', url: 'https://doi.org/10.1101/abc' }],
    });
  });
});

describe('DiscoveryService.searchChemRxiv', () => {
  it('uses the corresponding author + institution', async () => {
    ChemRxivService.search.mockResolvedValue([
      { title: 'Chem', year: 2021, doi: '10.26434/xyz', correspondingAuthor: 'Chem Author', institution: 'Chem Inst' },
    ]);
    const out = await DiscoveryService.searchChemRxiv(['chem'], () => {});
    expect(out[0]).toMatchObject({
      name: 'Chem Author',
      affiliation: 'Chem Inst',
      source: 'chemrxiv',
      publications: [{ title: 'Chem', year: 2021, doi: '10.26434/xyz', url: 'https://doi.org/10.26434/xyz' }],
    });
  });
});
