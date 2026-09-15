const {
  MAX_TTL_MS,
  METHODS,
  RESULTS,
  VERSION,
  buildIdentityInputDigest,
  evaluateIndependentReviewerIdentity,
  sameWork,
} = require('../../lib/services/independent-reviewer-identity');

const NOW = Date.parse('2026-09-14T18:00:00.000Z');
const BINDING = {
  requestBinding: 'request-100',
  candidateKey: 'candidate-100',
};

function authorship(displayName, authorId = 'A100', orcid = null, rawAuthorName = displayName) {
  return {
    displayName,
    openAlexAuthorId: `https://openalex.org/${authorId}`,
    orcid,
    ...(rawAuthorName ? {
      raw: {
        raw_author_name: rawAuthorName,
        ...(orcid ? { raw_orcid: orcid } : {}),
      },
    } : {}),
  };
}

function work(
  pmid,
  displayName = 'Alice Example',
  authorId = 'A100',
  orcid = null,
  rawAuthorName = displayName,
) {
  return {
    openAlexId: `https://openalex.org/W${pmid}`,
    title: `Bound work ${pmid}`,
    pmid: String(pmid),
    authorships: [authorship(displayName, authorId, orcid, rawAuthorName)],
  };
}

function pubmedResult(records, totalCount = records.length) {
  return { totalCount, records };
}

function article(pmid, displayName = 'Alice Example') {
  return {
    pmid: String(pmid),
    title: `Bound work ${pmid}`,
    authors: [{ name: displayName, affiliation: 'Excluded from identity evaluation' }],
  };
}

function dependencies(serverInputs, providerOverrides = {}, extra = {}) {
  return {
    now: () => NOW,
    loadServerInputs: jest.fn(async () => ({
      requestBinding: BINDING.requestBinding,
      candidateKey: BINDING.candidateKey,
      allowedMethods: Object.values(METHODS),
      candidateName: 'Alice Example',
      sourceWorkLineage: 'proposal_citation',
      providerState: 'complete',
      providerObservedAt: new Date(NOW).toISOString(),
      ...serverInputs,
    })),
    providers: {
      searchPubmed: jest.fn(async () => pubmedResult([])),
      searchAuthors: jest.fn(async () => ({ totalCount: 0, records: [] })),
      getWorkByExternalId: jest.fn(async (kind, value) => {
        const record = work(value, 'Alice Example', 'A100', serverInputs?.sourceOrcid || null);
        if (kind === 'doi') {
          record.doi = value;
          record.pmid = null;
        }
        if (kind === 'arxiv') {
          record.arxivId = value;
          record.pmid = null;
        }
        return { totalCount: 1, records: [record] };
      }),
      getWorkByTitle: jest.fn(async () => ({ totalCount: 0, records: [] })),
      getOrcidWorkReferences: jest.fn(async () => ({
        totalCount: 0,
        examinedCount: 0,
        records: [],
      })),
      ...providerOverrides,
    },
    ...extra,
  };
}

describe('independent-identity/v1', () => {
  test('exact-work matching rejects conflicting or non-comparable identifiers', () => {
    expect(sameWork(
      { pmid: '101', doi: '10.1000/one' },
      { pmid: '101', doi: '10.1000/two' },
    )).toBe(false);
    expect(sameWork(
      { pmid: '101', title: 'Shared title' },
      { doi: '10.1000/one', title: 'Shared title' },
    )).toBe(false);
    expect(sameWork(
      { title: 'Shared title' },
      { doi: '10.1000/one', title: 'Shared title' },
    )).toBe(true);
  });

  test('exact work requires one full-forename authorship and emits bounded binding claims', async () => {
    const deps = dependencies({ sourceWork: { pmid: '101' } });
    const result = await evaluateIndependentReviewerIdentity({
      ...BINDING,
      method: METHODS.EXACT_WORK_UNIQUE_AUTHOR,
    }, deps);

    expect(result).toMatchObject({
      version: VERSION,
      result: RESULTS.SUFFICIENT,
      reason: 'exact_work_unique_author',
      excludesAffiliation: true,
      method: METHODS.EXACT_WORK_UNIQUE_AUTHOR,
      requestBinding: BINDING.requestBinding,
      candidateKey: BINDING.candidateKey,
      providerState: 'complete',
      providerObservedAt: new Date(NOW).toISOString(),
      evidence: {
        workId: 'W101',
        pmid: '101',
        authorshipIndex: 0,
        openAlexAuthorId: 'A100',
      },
    });
    expect(result.identityInputDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(result.evidenceDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(result.identityInputDigest).toBe(buildIdentityInputDigest(
      BINDING,
      METHODS.EXACT_WORK_UNIQUE_AUTHOR,
      await deps.loadServerInputs(BINDING),
    ));
    expect(Date.parse(result.expiresAt) - Date.parse(result.providerObservedAt)).toBe(MAX_TTL_MS);
  });

  test('initial-only authorship is insufficient', async () => {
    const deps = dependencies(
      { sourceWork: { pmid: '102' } },
      {
        getWorkByExternalId: jest.fn(async () => ({
          totalCount: 1,
          records: [work('102', 'A Example')],
        })),
      },
    );
    const result = await evaluateIndependentReviewerIdentity({
      ...BINDING,
      method: METHODS.EXACT_WORK_UNIQUE_AUTHOR,
    }, deps);
    expect(result).toMatchObject({
      result: RESULTS.INSUFFICIENT,
      reason: 'no_full_forename_author_match',
    });
  });

  test('a normalized OpenAlex cluster name cannot upgrade an initial-only raw byline', async () => {
    const deps = dependencies(
      { sourceWork: { pmid: '1021' } },
      {
        getWorkByExternalId: jest.fn(async () => ({
          totalCount: 1,
          records: [work('1021', 'Alice Example', 'A100', null, 'A. Example')],
        })),
      },
    );
    const result = await evaluateIndependentReviewerIdentity({
      ...BINDING,
      method: METHODS.EXACT_WORK_UNIQUE_AUTHOR,
    }, deps);
    expect(result).toMatchObject({
      result: RESULTS.INSUFFICIENT,
      reason: 'no_full_forename_author_match',
    });
  });

  test('a missing raw byline cannot ground on the OpenAlex cluster name alone', async () => {
    const noRawByline = work('1023');
    delete noRawByline.authorships[0].raw;
    noRawByline.authorships[0].name = 'Alice Example';
    const result = await evaluateIndependentReviewerIdentity({
      ...BINDING,
      method: METHODS.EXACT_WORK_UNIQUE_AUTHOR,
    }, dependencies(
      { sourceWork: { pmid: '1023' } },
      { getWorkByExternalId: jest.fn(async () => ({ totalCount: 1, records: [noRawByline] })) },
    ));
    expect(result).toMatchObject({
      result: RESULTS.INSUFFICIENT,
      reason: 'no_full_forename_author_match',
    });
  });

  test('a mismatched cluster name does not contradict a matching raw byline', async () => {
    const deps = dependencies(
      { sourceWork: { pmid: '1022' } },
      {
        getWorkByExternalId: jest.fn(async () => ({
          totalCount: 1,
          records: [work('1022', 'Brenda Example', 'A100', null, 'Alice Example')],
        })),
      },
    );
    const result = await evaluateIndependentReviewerIdentity({
      ...BINDING,
      method: METHODS.EXACT_WORK_UNIQUE_AUTHOR,
    }, deps);
    expect(result).toMatchObject({
      result: RESULTS.INSUFFICIENT,
      reason: 'no_full_forename_author_match',
    });
  });

  test('nickname equivalence does not satisfy exact full-forename grounding', async () => {
    const deps = dependencies(
      { candidateName: 'Will Example', sourceWork: { pmid: '1021' } },
      {
        getWorkByExternalId: jest.fn(async () => ({
          totalCount: 1,
          records: [work('1021', 'William Example')],
        })),
      },
    );
    const result = await evaluateIndependentReviewerIdentity({
      ...BINDING,
      method: METHODS.EXACT_WORK_UNIQUE_AUTHOR,
    }, deps);
    expect(result).toMatchObject({
      result: RESULTS.INSUFFICIENT,
      reason: 'no_full_forename_author_match',
    });
  });

  test('a surname-only candidate cannot create a contradiction', async () => {
    const result = await evaluateIndependentReviewerIdentity({
      ...BINDING,
      method: METHODS.EXACT_WORK_UNIQUE_AUTHOR,
    }, dependencies(
      { candidateName: 'Example', sourceWork: { pmid: '1024' } },
      { getWorkByExternalId: jest.fn(async () => ({
        totalCount: 1,
        records: [work('1024', 'Brenda Example')],
      })) },
    ));
    expect(result).toMatchObject({
      result: RESULTS.INSUFFICIENT,
      reason: 'no_full_forename_author_match',
    });
  });

  test('dotless initials remain ambiguous beside a full same-surname match', async () => {
    const candidateWork = work('1025');
    candidateWork.authorships.push(authorship('AM Example', 'A200'));
    const result = await evaluateIndependentReviewerIdentity({
      ...BINDING,
      method: METHODS.EXACT_WORK_UNIQUE_AUTHOR,
    }, dependencies(
      { sourceWork: { pmid: '1025' } },
      { getWorkByExternalId: jest.fn(async () => ({ totalCount: 1, records: [candidateWork] })) },
    ));
    expect(result).toMatchObject({
      result: RESULTS.INSUFFICIENT,
      reason: 'ambiguous_author_match',
    });
  });

  test('a byline middle name cannot create a forename contradiction', async () => {
    const result = await evaluateIndependentReviewerIdentity({
      ...BINDING,
      method: METHODS.EXACT_WORK_UNIQUE_AUTHOR,
    }, dependencies(
      { sourceWork: { pmid: '1026' } },
      { getWorkByExternalId: jest.fn(async () => ({
        totalCount: 1,
        records: [work('1026', 'Mary Alice Example')],
      })) },
    ));
    expect(result).toMatchObject({
      result: RESULTS.INSUFFICIENT,
      reason: 'no_full_forename_author_match',
    });
  });

  test('a candidate middle name cannot create a forename contradiction', async () => {
    const result = await evaluateIndependentReviewerIdentity({
      ...BINDING,
      method: METHODS.EXACT_WORK_UNIQUE_AUTHOR,
    }, dependencies(
      { candidateName: 'Mary Alice Example', sourceWork: { pmid: '1027' } },
      { getWorkByExternalId: jest.fn(async () => ({
        totalCount: 1,
        records: [work('1027', 'Alice Example')],
      })) },
    ));
    expect(result).toMatchObject({
      result: RESULTS.INSUFFICIENT,
      reason: 'no_full_forename_author_match',
    });
  });

  test('a full match plus an initial-only same-surname coauthor remains ambiguous', async () => {
    const deps = dependencies(
      { sourceWork: { pmid: '1022' } },
      {
        getWorkByExternalId: jest.fn(async () => ({
          totalCount: 1,
          records: [{
            ...work('1022'),
            authorships: [
              authorship('Alice Example', 'A100'),
              authorship('A Example', 'A200'),
            ],
          }],
        })),
      },
    );
    const result = await evaluateIndependentReviewerIdentity({
      ...BINDING,
      method: METHODS.EXACT_WORK_UNIQUE_AUTHOR,
    }, deps);
    expect(result).toMatchObject({
      result: RESULTS.INSUFFICIENT,
      reason: 'ambiguous_author_match',
    });
  });

  test('a differing full forename on the same surname is contradicted', async () => {
    const deps = dependencies(
      { sourceWork: { pmid: '103' } },
      {
        getWorkByExternalId: jest.fn(async () => ({
          totalCount: 1,
          records: [work('103', 'Brenda Example')],
        })),
      },
    );
    const result = await evaluateIndependentReviewerIdentity({
      ...BINDING,
      method: METHODS.EXACT_WORK_UNIQUE_AUTHOR,
    }, deps);
    expect(result).toMatchObject({
      result: RESULTS.CONTRADICTED,
      reason: 'full_forename_contradiction',
    });
  });

  test('an initial-only candidate byline prevents a coauthor surname from becoming a contradiction', async () => {
    const candidateWork = work('1031', 'A. Example');
    candidateWork.authorships.push(authorship('Brenda Example', 'A200'));
    const result = await evaluateIndependentReviewerIdentity({
      ...BINDING,
      method: METHODS.EXACT_WORK_UNIQUE_AUTHOR,
    }, dependencies(
      { sourceWork: { pmid: '1031' } },
      { getWorkByExternalId: jest.fn(async () => ({ totalCount: 1, records: [candidateWork] })) },
    ));
    expect(result).toMatchObject({
      result: RESULTS.INSUFFICIENT,
      reason: 'no_full_forename_author_match',
    });
  });

  test('punctuated initials and an honorific cannot create a contradiction', async () => {
    const candidateWork = work('1032', 'Alice Example', 'A100', null, 'A.M. Example');
    candidateWork.authorships.push(authorship('Brenda Example', 'A200'));
    const result = await evaluateIndependentReviewerIdentity({
      ...BINDING,
      method: METHODS.EXACT_WORK_UNIQUE_AUTHOR,
    }, dependencies(
      { candidateName: 'Dr. Alice Example', sourceWork: { pmid: '1032' } },
      { getWorkByExternalId: jest.fn(async () => ({ totalCount: 1, records: [candidateWork] })) },
    ));
    expect(result).toMatchObject({
      result: RESULTS.INSUFFICIENT,
      reason: 'no_full_forename_author_match',
    });
  });

  test('accent normalization recognizes the candidate byline before considering a coauthor', async () => {
    const candidateWork = work('1033', 'Jose Perez', 'A100', null, 'Jose Perez');
    candidateWork.authorships.push(authorship('Juan Perez', 'A200'));
    const result = await evaluateIndependentReviewerIdentity({
      ...BINDING,
      method: METHODS.EXACT_WORK_UNIQUE_AUTHOR,
    }, dependencies(
      { candidateName: 'José Pérez', sourceWork: { pmid: '1033' } },
      { getWorkByExternalId: jest.fn(async () => ({ totalCount: 1, records: [candidateWork] })) },
    ));
    expect(result).toMatchObject({ result: RESULTS.SUFFICIENT });
  });

  test('provider evidence changes do not change the server-input digest', async () => {
    const serverInputs = { sourceWork: { pmid: '1034' } };
    const first = await evaluateIndependentReviewerIdentity({
      ...BINDING,
      method: METHODS.EXACT_WORK_UNIQUE_AUTHOR,
    }, dependencies(serverInputs));
    const second = await evaluateIndependentReviewerIdentity({
      ...BINDING,
      method: METHODS.EXACT_WORK_UNIQUE_AUTHOR,
    }, dependencies(serverInputs, {
      getWorkByExternalId: jest.fn(async () => ({
        totalCount: 1,
        records: [{ ...work('1034'), openAlexId: 'https://openalex.org/W9999' }],
      })),
    }));
    expect(first.identityInputDigest).toBe(second.identityInputDigest);
    expect(first.evidenceDigest).not.toBe(second.evidenceDigest);
  });

  test('an identifier miss cannot fall back to a matching title', async () => {
    const deps = dependencies(
      { sourceWork: { pmid: '1999', title: 'Bound work 1999' } },
      {
        getWorkByExternalId: jest.fn(async () => ({ totalCount: 0, records: [] })),
        getWorkByTitle: jest.fn(async () => ({ totalCount: 1, records: [work('1999')] })),
      },
    );
    const result = await evaluateIndependentReviewerIdentity({
      ...BINDING,
      method: METHODS.EXACT_WORK_UNIQUE_AUTHOR,
    }, deps);
    expect(result).toMatchObject({ result: RESULTS.INSUFFICIENT, reason: 'work_not_found' });
    expect(deps.providers.getWorkByTitle).not.toHaveBeenCalled();
  });

  test('a missing source work is not evaluable', async () => {
    const result = await evaluateIndependentReviewerIdentity({
      ...BINDING,
      method: METHODS.EXACT_WORK_UNIQUE_AUTHOR,
    }, dependencies({ sourceWork: null }));
    expect(result).toMatchObject({ result: RESULTS.NOT_EVALUABLE, reason: 'missing_source_work' });
  });

  test('an unproven source-work lineage is not evaluable before provider lookup', async () => {
    const deps = dependencies({
      sourceWork: { pmid: '1035' },
      sourceWorkLineage: 'affiliation_selected',
    });
    const result = await evaluateIndependentReviewerIdentity({
      ...BINDING,
      method: METHODS.EXACT_WORK_UNIQUE_AUTHOR,
    }, deps);
    expect(result).toMatchObject({
      result: RESULTS.NOT_EVALUABLE,
      reason: 'source_work_lineage_missing',
    });
    expect(deps.providers.getWorkByExternalId).not.toHaveBeenCalled();
  });

  test('browser-carried identity fields are ignored in favor of the server loader', async () => {
    const deps = dependencies({ sourceWork: { pmid: '104' } });
    const result = await evaluateIndependentReviewerIdentity({
      ...BINDING,
      method: METHODS.EXACT_WORK_UNIQUE_AUTHOR,
      candidateName: 'Mallory Browser',
      sourceWork: { pmid: '999' },
      identityStatus: 'confirmed',
      orcid: '0000-0002-1825-0097',
    }, deps);

    expect(result.result).toBe(RESULTS.SUFFICIENT);
    expect(deps.loadServerInputs).toHaveBeenCalledWith({
      requestBinding: BINDING.requestBinding,
      candidateKey: BINDING.candidateKey,
      signal: undefined,
    });
    expect(deps.providers.getWorkByExternalId)
      .toHaveBeenCalledWith('pmid', '104', { signal: undefined });
  });

  test('PubMed initial-only works do not count toward the three-work minimum', async () => {
    const deps = dependencies(
      { sourceWork: { pmid: '201' } },
      {
        searchPubmed: jest.fn(async () => pubmedResult([
          article('201'),
          article('202', 'A Example'),
          article('203', 'A Example'),
        ])),
      },
    );
    const result = await evaluateIndependentReviewerIdentity({
      ...BINDING,
      method: METHODS.PUBMED_MULTI_WORK_AUTHOR,
    }, deps);
    expect(result).toMatchObject({
      result: RESULTS.INSUFFICIENT,
      reason: 'too_few_full_forename_works',
      evidence: { fullForenameWorkCount: 1 },
    });
    expect(deps.providers.getWorkByExternalId).not.toHaveBeenCalled();
  });

  test('the source work does not count unless PubMed supplies a full-forename byline', async () => {
    const deps = dependencies(
      { sourceWork: { pmid: '251' } },
      {
        searchPubmed: jest.fn(async () => pubmedResult([article('252'), article('253')])),
      },
    );
    const result = await evaluateIndependentReviewerIdentity({
      ...BINDING,
      method: METHODS.PUBMED_MULTI_WORK_AUTHOR,
    }, deps);
    expect(result).toMatchObject({
      result: RESULTS.INSUFFICIENT,
      reason: 'too_few_full_forename_works',
      evidence: { fullForenameWorkCount: 2 },
    });
    expect(deps.providers.getWorkByExternalId).not.toHaveBeenCalled();
  });

  test('a title-only source work cannot ground the PubMed method', async () => {
    const deps = dependencies({ sourceWork: { title: 'Generic source title' } });
    const result = await evaluateIndependentReviewerIdentity({
      ...BINDING,
      method: METHODS.PUBMED_MULTI_WORK_AUTHOR,
    }, deps);
    expect(result).toMatchObject({
      result: RESULTS.NOT_EVALUABLE,
      reason: 'source_work_identifier_required',
    });
    expect(deps.providers.searchPubmed).not.toHaveBeenCalled();
  });

  test('a truncated PubMed result pool is not evaluable', async () => {
    const articles = Array.from({ length: 30 }, (_, index) => article(260 + index));
    const deps = dependencies(
      { sourceWork: { pmid: '260' } },
      { searchPubmed: jest.fn(async () => pubmedResult(articles, 31)) },
    );
    const result = await evaluateIndependentReviewerIdentity({
      ...BINDING,
      method: METHODS.PUBMED_MULTI_WORK_AUTHOR,
    }, deps);
    expect(result).toMatchObject({
      result: RESULTS.NOT_EVALUABLE,
      reason: 'pubmed_pool_incomplete',
      providerState: 'partial',
      evidence: { articlePoolSize: 30, articleTotalCount: 31 },
    });
    expect(deps.providers.getWorkByExternalId).not.toHaveBeenCalled();
  });

  test('a PubMed response without its total count is not evaluable', async () => {
    const deps = dependencies(
      { sourceWork: { pmid: '291' } },
      { searchPubmed: jest.fn(async () => ({ totalCount: null, records: [] })) },
    );
    const result = await evaluateIndependentReviewerIdentity({
      ...BINDING,
      method: METHODS.PUBMED_MULTI_WORK_AUTHOR,
    }, deps);
    expect(result).toMatchObject({
      result: RESULTS.NOT_EVALUABLE,
      reason: 'pubmed_provider_contract_invalid',
      providerState: 'partial',
    });
  });

  test('PubMed returns sufficient only when three full-forename works bind to one author cluster', async () => {
    const deps = dependencies(
      { sourceWork: { pmid: '301' } },
      {
        searchPubmed: jest.fn(async () => pubmedResult([
          article('301'), article('302'), article('303'),
        ])),
      },
    );
    const result = await evaluateIndependentReviewerIdentity({
      ...BINDING,
      method: METHODS.PUBMED_MULTI_WORK_AUTHOR,
    }, deps);
    expect(result).toMatchObject({
      result: RESULTS.SUFFICIENT,
      reason: 'pubmed_multi_work_author_bound',
      providerState: 'complete',
      evidence: {
        fullForenameWorkCount: 3,
        groundedWorkCount: 3,
        clusterWorkCount: 3,
        authorCluster: { openAlexAuthorId: 'A100' },
      },
    });
    expect(result.evidence.works).toHaveLength(3);
    expect(deps.providers.searchPubmed).toHaveBeenCalledWith(
      'Alice Example[Author]',
      30,
      { signal: undefined, throwOnError: true },
    );
  });

  test('same-name works split across author clusters are insufficient', async () => {
    const deps = dependencies(
      { sourceWork: { pmid: '401' } },
      {
        searchPubmed: jest.fn(async () => pubmedResult([
          article('401'), article('402'), article('403'),
        ])),
        getWorkByExternalId: jest.fn(async (_kind, value) => ({
          totalCount: 1,
          records: [work(value, 'Alice Example', value === '403' ? 'A200' : 'A100')],
        })),
      },
    );
    const result = await evaluateIndependentReviewerIdentity({
      ...BINDING,
      method: METHODS.PUBMED_MULTI_WORK_AUTHOR,
    }, deps);
    expect(result).toMatchObject({
      result: RESULTS.INSUFFICIENT,
      reason: 'multi_work_cluster_insufficient',
      evidence: { clusterWorkCount: 2 },
    });
  });

  test('three matching works cannot outvote a fourth full-forename work in another cluster', async () => {
    const deps = dependencies(
      { sourceWork: { pmid: '451' } },
      {
        searchPubmed: jest.fn(async () => pubmedResult([
          article('451'), article('452'), article('453'), article('454'),
        ])),
        getWorkByExternalId: jest.fn(async (_kind, value) => ({
          totalCount: 1,
          records: [work(value, 'Alice Example', value === '454' ? 'A200' : 'A100')],
        })),
      },
    );
    const result = await evaluateIndependentReviewerIdentity({
      ...BINDING,
      method: METHODS.PUBMED_MULTI_WORK_AUTHOR,
    }, deps);
    expect(result).toMatchObject({
      result: RESULTS.INSUFFICIENT,
      reason: 'multi_work_cluster_insufficient',
      evidence: { clusterWorkCount: 3, groundedWorkCount: 4 },
    });
  });

  test('the eleventh full-forename work remains part of the cluster gate', async () => {
    const articles = Array.from({ length: 11 }, (_, index) => article(460 + index));
    const deps = dependencies(
      { sourceWork: { pmid: '460' } },
      {
        searchPubmed: jest.fn(async () => pubmedResult(articles)),
        getWorkByExternalId: jest.fn(async (_kind, value) => ({
          totalCount: 1,
          records: [work(value, 'Alice Example', value === '470' ? 'A200' : 'A100')],
        })),
      },
    );
    const result = await evaluateIndependentReviewerIdentity({
      ...BINDING,
      method: METHODS.PUBMED_MULTI_WORK_AUTHOR,
    }, deps);
    expect(result).toMatchObject({
      result: RESULTS.INSUFFICIENT,
      reason: 'multi_work_cluster_insufficient',
      evidence: { fullForenameWorkCount: 11, groundedWorkCount: 11, clusterWorkCount: 10 },
    });
  });

  test('an incomplete OpenAlex pool makes the PubMed method not evaluable', async () => {
    const deps = dependencies(
      { sourceWork: { pmid: '471' } },
      {
        searchPubmed: jest.fn(async () => pubmedResult([
          article('471'), article('472'), article('473'), article('474'),
        ])),
        getWorkByExternalId: jest.fn(async (_kind, value) => ({
          totalCount: value === '474' ? 2 : 1,
          records: [work(value)],
        })),
      },
    );
    const result = await evaluateIndependentReviewerIdentity({
      ...BINDING,
      method: METHODS.PUBMED_MULTI_WORK_AUTHOR,
    }, deps);
    expect(result).toMatchObject({
      result: RESULTS.NOT_EVALUABLE,
      reason: 'pmid_pool_incomplete',
    });
  });

  test('one failed provider operation makes an otherwise sufficient PubMed run not evaluable', async () => {
    const deps = dependencies(
      { sourceWork: { pmid: '501' } },
      {
        searchPubmed: jest.fn(async () => pubmedResult([
          article('501'), article('502'), article('503'), article('504'),
        ])),
        getWorkByExternalId: jest.fn(async (_kind, value) => {
          if (value === '504') throw new Error('OpenAlex unavailable');
          return { totalCount: 1, records: [work(value)] };
        }),
      },
    );
    const result = await evaluateIndependentReviewerIdentity({
      ...BINDING,
      method: METHODS.PUBMED_MULTI_WORK_AUTHOR,
    }, deps);
    expect(result).toMatchObject({
      result: RESULTS.NOT_EVALUABLE,
      reason: 'provider_failure',
      providerState: 'partial',
    });
  });

  test('a failed exact-work provider call is not evaluable rather than insufficient', async () => {
    const deps = dependencies(
      { sourceWork: { pmid: '505' } },
      { getWorkByExternalId: jest.fn(async () => { throw new Error('offline'); }) },
    );
    const result = await evaluateIndependentReviewerIdentity({
      ...BINDING,
      method: METHODS.EXACT_WORK_UNIQUE_AUTHOR,
    }, deps);
    expect(result).toMatchObject({
      result: RESULTS.NOT_EVALUABLE,
      reason: 'provider_failure',
      providerState: 'failed',
    });
  });

  test('forename grounding abstains before work lookup when the author pool is incomplete', async () => {
    const deps = dependencies(
      { sourceWork: { pmid: '601' } },
      {
        searchAuthors: jest.fn(async () => ({
          totalCount: 40,
          records: [{ openAlexId: 'https://openalex.org/A100', displayName: 'Alice Example' }],
        })),
      },
    );
    const result = await evaluateIndependentReviewerIdentity({
      ...BINDING,
      method: METHODS.FORENAME_WORK_GROUNDING,
    }, deps);
    expect(result).toMatchObject({
      result: RESULTS.NOT_EVALUABLE,
      reason: 'author_pool_incomplete',
      providerState: 'partial',
      evidence: { authorPoolSize: 1, authorTotalCount: 40 },
    });
    expect(deps.providers.getWorkByExternalId).not.toHaveBeenCalled();
  });

  test('malformed author-pool metadata is not evaluable', async () => {
    const deps = dependencies(
      { sourceWork: { pmid: '6011' } },
      {
        searchAuthors: jest.fn(async () => ({
          totalCount: 'unknown',
          records: [{ openAlexId: 'https://openalex.org/A100', displayName: 'Alice Example' }],
        })),
      },
    );
    const result = await evaluateIndependentReviewerIdentity({
      ...BINDING,
      method: METHODS.FORENAME_WORK_GROUNDING,
    }, deps);
    expect(result).toMatchObject({
      result: RESULTS.NOT_EVALUABLE,
      reason: 'author_provider_contract_invalid',
    });
  });

  test('forename grounding abstains when a complete pool contains a namesake cluster', async () => {
    const deps = dependencies(
      { sourceWork: { pmid: '602' } },
      {
        searchAuthors: jest.fn(async () => ({
          totalCount: 2,
          records: [
            { openAlexId: 'https://openalex.org/A100', displayName: 'Alice Example' },
            { openAlexId: 'https://openalex.org/A200', displayName: 'Alice Example' },
          ],
        })),
      },
    );
    const result = await evaluateIndependentReviewerIdentity({
      ...BINDING,
      method: METHODS.FORENAME_WORK_GROUNDING,
    }, deps);
    expect(result).toMatchObject({
      result: RESULTS.INSUFFICIENT,
      reason: 'grounded_author_collision',
      evidence: { authorPoolSize: 2, authorTotalCount: 2 },
    });
  });

  test('forename grounding succeeds for one exact name in a complete pool', async () => {
    const result = await evaluateIndependentReviewerIdentity({
      ...BINDING,
      method: METHODS.FORENAME_WORK_GROUNDING,
    }, dependencies(
      { sourceWork: { pmid: '603' } },
      { searchAuthors: jest.fn(async () => ({
        totalCount: 1,
        records: [{ openAlexId: 'https://openalex.org/A100', displayName: 'Alice Example' }],
      })) },
    ));
    expect(result).toMatchObject({
      result: RESULTS.SUFFICIENT,
      reason: 'forename_work_grounded',
    });
  });

  test('hard-ID joins require independent source and CRM ORCID lineage', async () => {
    const sufficient = await evaluateIndependentReviewerIdentity({
      ...BINDING,
      method: METHODS.HARD_ID_JOIN,
    }, dependencies({
      sourceWork: { pmid: '901' },
      sourceOrcid: '0000-0002-1825-0097',
      sourceOrcidLineage: 'byline_asserted',
      crmOrcid: 'https://orcid.org/0000-0002-1825-0097',
      crmOrcidLineage: 'staff_entered',
    }));
    expect(sufficient).toMatchObject({
      result: RESULTS.SUFFICIENT,
      reason: 'hard_id_join',
      providerState: 'complete',
    });

    const unavailable = await evaluateIndependentReviewerIdentity({
      ...BINDING,
      method: METHODS.HARD_ID_JOIN,
    }, dependencies({
      sourceEmail: 'author@example.org',
      crmEmail: 'author@example.org',
    }));
    expect(unavailable).toMatchObject({
      result: RESULTS.NOT_EVALUABLE,
      reason: 'hard_id_lineage_missing',
    });
  });

  test('different independently sourced ORCIDs are contradicted', async () => {
    const result = await evaluateIndependentReviewerIdentity({
      ...BINDING,
      method: METHODS.HARD_ID_JOIN,
    }, dependencies({
      sourceWork: { pmid: '902' },
      sourceOrcid: '0000-0002-1825-0097',
      sourceOrcidLineage: 'byline_asserted',
      crmOrcid: '0000-0001-5109-3700',
      crmOrcidLineage: 'staff_entered',
    }));
    expect(result).toMatchObject({
      result: RESULTS.CONTRADICTED,
      reason: 'orcid_contradiction',
    });
  });

  test('different ORCIDs without independent source lineage are not evaluable', async () => {
    const result = await evaluateIndependentReviewerIdentity({
      ...BINDING,
      method: METHODS.HARD_ID_JOIN,
    }, dependencies({
      sourceOrcid: '0000-0002-1825-0097',
      sourceOrcidLineage: 'affiliation_selected',
      crmOrcid: '0000-0001-5109-3700',
      crmOrcidLineage: 'staff_entered',
    }));
    expect(result).toMatchObject({
      result: RESULTS.NOT_EVALUABLE,
      reason: 'hard_id_lineage_missing',
    });
  });

  test('an unverified prior receipt cannot serve as CRM ORCID lineage', async () => {
    const result = await evaluateIndependentReviewerIdentity({
      ...BINDING,
      method: METHODS.HARD_ID_JOIN,
    }, dependencies({
      sourceWork: { pmid: '903' },
      sourceOrcid: '0000-0002-1825-0097',
      sourceOrcidLineage: 'byline_asserted',
      crmOrcid: '0000-0002-1825-0097',
      crmOrcidLineage: 'independent_receipt',
    }));
    expect(result).toMatchObject({
      result: RESULTS.NOT_EVALUABLE,
      reason: 'hard_id_receipt_lineage_unverified',
    });
  });

  test('a coauthor ORCID cannot satisfy the hard-ID join for the candidate', async () => {
    const candidateWork = work(
      '904',
      'Alice Example',
      'A100',
      '0000-0001-5109-3700',
    );
    candidateWork.authorships.push(authorship(
      'Bob Other',
      'A200',
      '0000-0002-1825-0097',
    ));
    const result = await evaluateIndependentReviewerIdentity({
      ...BINDING,
      method: METHODS.HARD_ID_JOIN,
    }, dependencies(
      {
        sourceWork: { pmid: '904' },
        sourceOrcid: '0000-0002-1825-0097',
        sourceOrcidLineage: 'byline_asserted',
        crmOrcid: '0000-0002-1825-0097',
        crmOrcidLineage: 'staff_entered',
      },
      { getWorkByExternalId: jest.fn(async () => ({ totalCount: 1, records: [candidateWork] })) },
    ));
    expect(result).toMatchObject({
      result: RESULTS.NOT_EVALUABLE,
      reason: 'source_orcid_not_bound_to_candidate_authorship',
    });
  });

  test('ORCID works lineage must contain the exact server-held work', async () => {
    const deps = dependencies(
      {
        sourceWork: { doi: '10.1000/bound-work' },
        sourceOrcid: '0000-0002-1825-0097',
        sourceOrcidLineage: 'orcid_works_exact_work',
        crmOrcid: '0000-0002-1825-0097',
        crmOrcidLineage: 'staff_entered',
      },
      {
        getOrcidWorkReferences: jest.fn(async () => ({
          totalCount: 1,
          examinedCount: 1,
          records: [{ doi: 'https://doi.org/10.1000/bound-work' }],
        })),
      },
      { orcidCredentials: { clientId: 'client', clientSecret: 'secret' } },
    );
    const result = await evaluateIndependentReviewerIdentity({
      ...BINDING,
      method: METHODS.HARD_ID_JOIN,
    }, deps);
    expect(result).toMatchObject({
      result: RESULTS.SUFFICIENT,
      reason: 'hard_id_join',
      providerState: 'complete',
    });
    expect(deps.providers.getOrcidWorkReferences).toHaveBeenCalledWith(
      '0000-0002-1825-0097',
      'client',
      'secret',
      { signal: undefined, limit: 50 },
    );
  });

  test('an incomplete ORCID works pool cannot prove or disprove the exact work', async () => {
    const result = await evaluateIndependentReviewerIdentity({
      ...BINDING,
      method: METHODS.HARD_ID_JOIN,
    }, dependencies(
      {
        sourceWork: { doi: '10.1000/bound-work' },
        sourceOrcid: '0000-0002-1825-0097',
        sourceOrcidLineage: 'orcid_works_exact_work',
        crmOrcid: '0000-0002-1825-0097',
        crmOrcidLineage: 'staff_entered',
      },
      {
        getOrcidWorkReferences: jest.fn(async () => ({
          totalCount: 120,
          examinedCount: 50,
          records: [],
        })),
      },
      { orcidCredentials: { clientId: 'client', clientSecret: 'secret' } },
    ));
    expect(result).toMatchObject({
      result: RESULTS.NOT_EVALUABLE,
      reason: 'orcid_work_pool_incomplete',
      providerState: 'partial',
      evidence: { workTotalCount: 120, workPoolSize: 50 },
    });
  });

  test('an exact ORCID work match is positive proof even when the remaining pool is truncated', async () => {
    const result = await evaluateIndependentReviewerIdentity({
      ...BINDING,
      method: METHODS.HARD_ID_JOIN,
    }, dependencies(
      {
        sourceWork: { doi: '10.1000/bound-work' },
        sourceOrcid: '0000-0002-1825-0097',
        sourceOrcidLineage: 'orcid_works_exact_work',
        crmOrcid: '0000-0002-1825-0097',
        crmOrcidLineage: 'staff_entered',
      },
      {
        getOrcidWorkReferences: jest.fn(async () => ({
          totalCount: 120,
          examinedCount: 50,
          records: [{ doi: '10.1000/bound-work' }],
        })),
      },
      { orcidCredentials: { clientId: 'client', clientSecret: 'secret' } },
    ));
    expect(result).toMatchObject({ result: RESULTS.SUFFICIENT, reason: 'hard_id_join' });
  });

  test('ORCID work proof compares identifiers from the resolved work, not a shared title', async () => {
    const resolvedWork = work(
      '905',
      'Alice Example',
      'A100',
      '0000-0002-1825-0097',
    );
    resolvedWork.title = 'Shared work title';
    resolvedWork.pmid = null;
    resolvedWork.doi = '10.1000/right-work';
    const result = await evaluateIndependentReviewerIdentity({
      ...BINDING,
      method: METHODS.HARD_ID_JOIN,
    }, dependencies(
      {
        sourceWork: { title: 'Shared work title' },
        sourceOrcid: '0000-0002-1825-0097',
        sourceOrcidLineage: 'orcid_works_exact_work',
        crmOrcid: '0000-0002-1825-0097',
        crmOrcidLineage: 'staff_entered',
      },
      {
        getWorkByTitle: jest.fn(async () => ({ totalCount: 1, records: [resolvedWork] })),
        getOrcidWorkReferences: jest.fn(async () => ({
          totalCount: 1,
          examinedCount: 1,
          records: [{ title: 'Shared work title', doi: '10.1000/wrong-work' }],
        })),
      },
      { orcidCredentials: { clientId: 'client', clientSecret: 'secret' } },
    ));
    expect(result).toMatchObject({
      result: RESULTS.INSUFFICIENT,
      reason: 'orcid_exact_work_not_found',
    });
  });

  test('missing ORCID credentials fail closed before the provider call', async () => {
    const deps = dependencies({
      sourceWork: { doi: '10.1000/bound-work' },
      sourceOrcid: '0000-0002-1825-0097',
      sourceOrcidLineage: 'orcid_works_exact_work',
      crmOrcid: '0000-0002-1825-0097',
      crmOrcidLineage: 'staff_entered',
    });
    const result = await evaluateIndependentReviewerIdentity({
      ...BINDING,
      method: METHODS.HARD_ID_JOIN,
    }, deps);
    expect(result).toMatchObject({
      result: RESULTS.NOT_EVALUABLE,
      reason: 'orcid_credentials_unavailable',
      providerState: 'partial',
    });
    expect(deps.providers.getOrcidWorkReferences).not.toHaveBeenCalled();
  });

  test('staff confirmation cannot feed back as independent identity evidence', async () => {
    const deps = dependencies({
      staffIdentityConfirmed: true,
      sourceWork: { pmid: '701' },
    });
    const result = await evaluateIndependentReviewerIdentity({
      ...BINDING,
      method: METHODS.EXACT_WORK_UNIQUE_AUTHOR,
    }, deps);
    expect(result).toMatchObject({
      result: RESULTS.NOT_EVALUABLE,
      reason: 'staff_confirmation_not_independent',
    });
    expect(deps.providers.getWorkByExternalId).not.toHaveBeenCalled();
  });

  test('an incomplete exact-work result pool is not evaluable', async () => {
    const deps = dependencies(
      { sourceWork: { pmid: '7011' } },
      {
        getWorkByExternalId: jest.fn(async () => ({
          totalCount: 2,
          records: [work('7011')],
        })),
      },
    );
    const result = await evaluateIndependentReviewerIdentity({
      ...BINDING,
      method: METHODS.EXACT_WORK_UNIQUE_AUTHOR,
    }, deps);
    expect(result).toMatchObject({
      result: RESULTS.NOT_EVALUABLE,
      reason: 'pmid_pool_incomplete',
      providerState: 'partial',
    });
  });

  test('a server loader row with the wrong request or candidate binding fails closed', async () => {
    const deps = dependencies({
      requestBinding: 'wrong-request',
      sourceWork: { pmid: '702' },
    });
    const result = await evaluateIndependentReviewerIdentity({
      ...BINDING,
      method: METHODS.EXACT_WORK_UNIQUE_AUTHOR,
    }, deps);
    expect(result).toMatchObject({
      result: RESULTS.NOT_EVALUABLE,
      reason: 'server_input_binding_mismatch',
      providerState: 'failed',
    });
    expect(deps.providers.getWorkByExternalId).not.toHaveBeenCalled();
  });

  test('the server loader must authorize the requested closed method', async () => {
    const deps = dependencies({
      allowedMethods: [METHODS.PUBMED_MULTI_WORK_AUTHOR],
      sourceWork: { pmid: '7021' },
    });
    const result = await evaluateIndependentReviewerIdentity({
      ...BINDING,
      method: METHODS.EXACT_WORK_UNIQUE_AUTHOR,
    }, deps);
    expect(result).toMatchObject({
      result: RESULTS.NOT_EVALUABLE,
      reason: 'method_not_server_authorized',
      providerState: 'failed',
    });
    expect(deps.providers.getWorkByExternalId).not.toHaveBeenCalled();
  });

  test.each([
    [{ ...BINDING }, 'invalid_binding'],
    [{ ...BINDING, method: 'future_method' }, 'invalid_binding'],
  ])('invalid or unknown method fails closed', async (binding, reason) => {
    const deps = dependencies({ sourceWork: { pmid: '801' } });
    const result = await evaluateIndependentReviewerIdentity(binding, deps);
    expect(result).toMatchObject({
      result: RESULTS.NOT_EVALUABLE,
      reason,
      providerState: 'failed',
    });
    expect(deps.loadServerInputs).not.toHaveBeenCalled();
  });

  test('the server loader is mandatory', async () => {
    const result = await evaluateIndependentReviewerIdentity({
      ...BINDING,
      method: METHODS.EXACT_WORK_UNIQUE_AUTHOR,
    }, { now: () => NOW });
    expect(result).toMatchObject({
      result: RESULTS.NOT_EVALUABLE,
      reason: 'server_loader_required',
      providerState: 'failed',
    });
  });
});
