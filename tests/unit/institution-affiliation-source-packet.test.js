const {
  scrub,
  pmidsFor,
  orcidFor,
  profileUrlFor,
  pubmedEvidence,
  orcidEvidence,
  triage,
} = require('../../scripts/collect-institution-affiliation-source-packet');
const {
  selectCases,
  looksLikeDecisionText,
} = require('../../scripts/select-institution-affiliation-adjudication-queue');

describe('institution affiliation source packet', () => {
  test('accepts only exact PubMed and ORCID references already on the roster', () => {
    const candidate = {
      publications: [
        { url: 'https://pubmed.ncbi.nlm.nih.gov/12345/' },
        { url: 'https://pubmed.ncbi.nlm.nih.gov/12345/' },
        { url: 'https://example.com/12345' },
      ],
      orcid: 'https://orcid.org/0000-0002-1825-0097',
    };
    expect(pmidsFor(candidate)).toEqual(['12345']);
    expect(orcidFor(candidate)).toBe('0000-0002-1825-0097');
    expect(orcidFor({ orcid: 'https://example.com/0000-0002-1825-0097' })).toBeNull();
    expect(profileUrlFor({ website: 'https://example.edu/profile?tracking=1#bio' }))
      .toBe('https://example.edu/profile');
    expect(profileUrlFor({ website: 'http://localhost/admin' })).toBeNull();
  });

  test('retains author-specific affiliation only for a unique full-name byline', () => {
    const article = {
      pmid: '12345', publicationDate: new Date('2025-01-02T00:00:00Z'),
      authors: [
        { name: 'J Doe', allAffiliations: ['Other Institute'] },
        { name: 'Jane Doe', allAffiliations: ['Department, Same University; jane@example.org'] },
      ],
    };
    const exact = pubmedEvidence({ name: 'Jane Doe' }, article);
    expect(exact.bylineMatch).toBe('unique_full_forename_surname');
    expect(exact.authorAffiliations).toEqual(['Department, Same University; [email removed]']);
    expect(exact.publicationDate).toBe('2025-01-02');
    expect(pubmedEvidence({ name: 'J Doe' }, article).authorAffiliations).toEqual([]);
    expect(pubmedEvidence({ name: 'Janet Doe' }, article).authorAffiliations).toEqual([]);
    expect(scrub('Contact x@example.org')).toBe('Contact [email removed]');
  });

  test('a current ORCID profile is an observed snapshot, not a historical-currentness label', () => {
    const source = orcidEvidence({ name: 'Jane Doe' }, {
      orcidUrl: 'https://orcid.org/0000-0002-1825-0097',
      givenNames: 'Jane', familyName: 'Doe',
      affiliations: [{ organization: 'Same University', department: 'Physics', startYear: 2024, current: true }],
    });
    expect(source.profileNameMatch).toBe('full_forename_surname');
    expect(source.employments[0].noEndDateInCurrentProfile).toBe(true);
    expect(triage([source], [], '0000-0002-1825-0097', null, [])).toBe('source_candidate_for_adjudication');
    expect(triage([], [], null, 'https://example.edu/profile', [])).toBe('profile_url_requires_verification');
    expect(triage([], [], null, null, [])).toBe('no_retained_pubmed_orcid_or_website');
  });

  test('selection uses replay only for varied sampling and never carries predictions into case records', () => {
    const sourceCases = [
      { caseId: 'a', triage: 'source_candidate_for_adjudication', labels: { institutionOnlyClearance: null } },
      { caseId: 'b', triage: 'source_candidate_for_adjudication', labels: { institutionOnlyClearance: null } },
      { caseId: 'c', triage: 'no_retained_public_source_reference', labels: { institutionOnlyClearance: null } },
    ];
    const replayCases = [
      { caseId: 'a', status: 'replayed', relationship: 'same' },
      { caseId: 'b', status: 'replayed', relationship: 'distinct' },
      { caseId: 'c', status: 'replayed', relationship: 'same' },
    ];
    const { selected } = selectCases(sourceCases, replayCases);
    expect(selected.map((row) => row.caseId)).toEqual(['a', 'b']);
    expect(selected[0]).not.toHaveProperty('relationship');
    expect(selected[0].labels.institutionOnlyClearance).toBeNull();
  });

  test('a slash inside decision text cannot enter the institution review queue', () => {
    expect(looksLikeDecisionText('(biotech, adhesion/receptor therapeutics)')).toBe(true);
    const sourceCases = [
      { caseId: 'a', triage: 'source_candidate_for_adjudication', storedSuggestedInstitution: '(biotech, adhesion/receptor therapeutics)' },
      { caseId: 'b', triage: 'source_candidate_for_adjudication', storedSuggestedInstitution: 'University A / University B' },
    ];
    const replayCases = sourceCases.map((row) => ({
      caseId: row.caseId, status: 'skipped', reason: 'unparsed_slash_affiliations',
    }));
    expect(selectCases(sourceCases, replayCases).selected.map((row) => row.caseId)).toEqual(['b']);
  });
});
