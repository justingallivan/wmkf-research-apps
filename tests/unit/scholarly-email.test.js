/**
 * @jest-environment node
 */

const { PubMedService } = require('../../lib/services/pubmed-service');
const scholarlyEmail = require('../../lib/services/contact-enrichment/scholarly-email');

const CANDIDATE = {
  name: 'Dr. Jane Roe',
  affiliation: 'Stanford University School of Medicine',
  publications: [],
};

function pubmedPublication({
  pmid,
  email = 'jane.roe@stanford.edu',
  year = 2026,
  authorName = 'Jane Roe',
  authorOrcid = null,
  affiliation = 'Department of Medicine, Stanford University',
} = {}) {
  return {
    pmid,
    title: `Paper ${pmid}`,
    year,
    doi: `10.1000/${pmid}`,
    authors: [{
      name: authorName,
      authorId: authorOrcid,
      affiliation: `${affiliation}. ${email}`,
      allAffiliations: [`${affiliation}. ${email}`],
    }],
  };
}

function europePmcPublication({
  pmid,
  pmcid = null,
  email = 'jane.roe@stanford.edu',
  year = 2026,
  authorName = 'Jane Roe',
} = {}) {
  const nameParts = authorName.split(/\s+/);
  const firstName = nameParts[0];
  const lastName = nameParts[nameParts.length - 1];
  return {
    pmid,
    pmcid,
    doi: `10.1000/${pmid}`,
    title: `Paper ${pmid}`,
    pubYear: String(year),
    authorList: {
      author: [{
        fullName: `${lastName} ${firstName[0]}`,
        firstName,
        lastName,
        authorAffiliationDetailsList: {
          authorAffiliation: [{
            affiliation: `Department of Medicine, Stanford University. ${email}`,
          }],
        },
      }],
    },
  };
}

afterEach(() => {
  jest.restoreAllMocks();
});

test('the scholarly caller can opt out of PubMedService error swallowing', async () => {
  jest.spyOn(PubMedService, 'searchPMIDs').mockRejectedValue(new Error('NCBI unavailable'));
  await expect(
    PubMedService.search('Jane Roe[Author]', 5, { throwOnError: true }),
  ).rejects.toThrow('NCBI unavailable');
});

test('the same PMID returned by NCBI and Europe PMC counts once', async () => {
  jest.spyOn(PubMedService, 'search').mockResolvedValue([
    pubmedPublication({ pmid: '111' }),
  ]);
  jest.spyOn(global, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => ({
      resultList: { result: [europePmcPublication({ pmid: '111', pmcid: 'PMC111' })] },
    }),
  });

  const result = await scholarlyEmail.findScholarlyEmail(CANDIDATE);
  expect(PubMedService.search).toHaveBeenCalledWith(
    expect.any(String),
    25,
    expect.objectContaining({ throwOnError: true }),
  );
  expect(result).toMatchObject({
    status: 'found',
    email: 'jane.roe@stanford.edu',
    publicationCount: 1,
  });
  expect(result.publications[0].providers).toEqual(
    expect.arrayContaining(['ncbi_pubmed', 'europe_pmc']),
  );
});

test('two distinct recent works promote the address to multi-publication evidence', async () => {
  jest.spyOn(PubMedService, 'search').mockResolvedValue([
    pubmedPublication({ pmid: '111' }),
  ]);
  jest.spyOn(global, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => ({
      resultList: {
        result: [
          europePmcPublication({ pmid: '111', pmcid: 'PMC111' }),
          europePmcPublication({ pmid: '222', pmcid: 'PMC222', year: 2025 }),
        ],
      },
    }),
  });

  const result = await scholarlyEmail.findScholarlyEmail(CANDIDATE);
  expect(result).toMatchObject({
    status: 'found',
    email: 'jane.roe@stanford.edu',
    publicationCount: 2,
    latestYear: 2026,
  });
});

test('initial-only author evidence is rejected without an ORCID match', () => {
  const publication = scholarlyEmail.normalizePublication(
    pubmedPublication({ pmid: '333', authorName: 'J Roe' }),
    'ncbi_pubmed',
  );
  expect(scholarlyEmail.extractPublicationEvidence(publication, CANDIDATE)).toEqual([]);
});

test('a known mismatched author ORCID vetoes an otherwise matching name and affiliation', () => {
  const publication = scholarlyEmail.normalizePublication(
    pubmedPublication({
      pmid: '334',
      authorOrcid: '0000-0002-1825-0097',
    }),
    'ncbi_pubmed',
  );
  const candidate = { ...CANDIDATE, orcidId: '0000-0001-5109-3700' };
  expect(scholarlyEmail.extractPublicationEvidence(publication, candidate)).toEqual([]);
});

test('one generic affiliation token does not corroborate a namesake', () => {
  const publication = scholarlyEmail.normalizePublication(
    pubmedPublication({
      pmid: '335',
      affiliation: 'Department of Medicine, University of Michigan',
    }),
    'ncbi_pubmed',
  );
  const candidate = { ...CANDIDATE, affiliation: 'Michigan State University' };
  expect(scholarlyEmail.extractPublicationEvidence(publication, candidate)).toEqual([]);
});

test('multiple generic affiliation tokens do not corroborate different institutions', () => {
  const publication = scholarlyEmail.normalizePublication(
    pubmedPublication({
      pmid: '336',
      affiliation: 'National University of Singapore, Cancer Science Institute',
    }),
    'ncbi_pubmed',
  );
  const candidate = { ...CANDIDATE, affiliation: 'National Cancer Institute' };
  expect(scholarlyEmail.extractPublicationEvidence(publication, candidate)).toEqual([]);
});

test('equally supported conflicting addresses cause abstention', () => {
  const rows = [
    {
      email: 'jane@stanford.edu',
      workKey: 'pmid:1',
      provider: 'ncbi_pubmed',
      matchedBy: 'full_name',
      publication: { pmid: '1', title: 'One', year: 2026, url: 'https://pubmed.ncbi.nlm.nih.gov/1/' },
    },
    {
      email: 'jroe@stanford.edu',
      workKey: 'pmid:2',
      provider: 'europe_pmc',
      matchedBy: 'full_name',
      publication: { pmid: '2', title: 'Two', year: 2026, url: 'https://pubmed.ncbi.nlm.nih.gov/2/' },
    },
  ];
  expect(scholarlyEmail.selectEmail(rows)).toMatchObject({
    status: 'conflict',
    candidates: [
      { email: 'jane@stanford.edu', publicationCount: 1 },
      { email: 'jroe@stanford.edu', publicationCount: 1 },
    ],
  });
});

test('one provider may fail while the other returns usable evidence', async () => {
  jest.spyOn(PubMedService, 'search').mockRejectedValue(new Error('NCBI unavailable'));
  jest.spyOn(global, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => ({
      resultList: { result: [europePmcPublication({ pmid: '444' })] },
    }),
  });

  const result = await scholarlyEmail.findScholarlyEmail(CANDIDATE);
  expect(result).toMatchObject({
    status: 'found',
    publicationCount: 1,
    providerErrors: [{ provider: 'ncbi_pubmed', error: 'NCBI unavailable' }],
  });
});

test('total provider failure is distinguishable from a definitive miss', async () => {
  jest.spyOn(PubMedService, 'search').mockRejectedValue(new Error('NCBI unavailable'));
  jest.spyOn(global, 'fetch').mockRejectedValue(new Error('Europe PMC unavailable'));

  const result = await scholarlyEmail.findScholarlyEmail(CANDIDATE);
  expect(result).toMatchObject({
    status: 'provider_error',
    candidates: [],
    providerErrors: [
      { provider: 'ncbi_pubmed', error: 'NCBI unavailable' },
      { provider: 'europe_pmc', error: 'Europe PMC unavailable' },
    ],
  });
});

test('a cancellation abort propagates instead of becoming a provider error', async () => {
  const controller = new AbortController();
  controller.abort(new Error('reviewer_time_budget_exceeded'));
  jest.spyOn(PubMedService, 'search').mockRejectedValue(controller.signal.reason);
  jest.spyOn(global, 'fetch').mockRejectedValue(controller.signal.reason);

  await expect(
    scholarlyEmail.findScholarlyEmail(CANDIDATE, { signal: controller.signal }),
  ).rejects.toThrow('reviewer_time_budget_exceeded');
});
