/**
 * @jest-environment node
 *
 * Reviewer identity-resolution Phase 1 (docs/REVIEWER_IDENTITY_RESOLUTION_PLAN.md).
 * Locks in the Scholar displayed-name guard + ORCID name-scoring that stop a
 * different person's bibliometrics/ORCID from attaching to a reviewer. The
 * canonical failure this prevents: target "Li-Huei Tsai" (MIT PI) matched the
 * Google Scholar profile of "Masayuki Nakano", a postdoc in her MIT lab —
 * institution matched, but the displayed profile name did not.
 */
const { ContactEnrichmentService } = require('../../lib/services/contact-enrichment-service');
const { SerpContactService } = require('../../lib/services/serp-contact-service');
const { ORCIDService } = require('../../lib/services/orcid-service');
const { ContactParser } = require('../../lib/utils/contact-parser');

describe('SerpContactService.extractScholarDisplayName', () => {
  test('pulls the owner name out of a "Name - Inst - Google Scholar" title', () => {
    expect(SerpContactService.extractScholarDisplayName('Masayuki Nakano - MIT - Google Scholar'))
      .toBe('Masayuki Nakano');
  });

  test('strips Unicode bidi marks SerpAPI passes through', () => {
    // U+202A ... U+202C wrap each segment in real SerpAPI titles.
    expect(SerpContactService.extractScholarDisplayName('‪Li-Huei Tsai‬ - ‪Google Scholar‬'))
      .toBe('Li-Huei Tsai');
  });

  test('returns the bare name when the title is just the name', () => {
    expect(SerpContactService.extractScholarDisplayName('Jane Q Researcher')).toBe('Jane Q Researcher');
  });

  test('returns empty for a boilerplate-only or empty title (keep-biased)', () => {
    expect(SerpContactService.extractScholarDisplayName('Google Scholar')).toBe('');
    expect(SerpContactService.extractScholarDisplayName('')).toBe('');
    expect(SerpContactService.extractScholarDisplayName(null)).toBe('');
  });
});

describe('SerpContactService.scholarNameMismatch', () => {
  test('flags the Tsai → Nakano lab-member case', () => {
    expect(SerpContactService.scholarNameMismatch('Li-Huei Tsai', 'Masayuki Nakano - MIT - Google Scholar'))
      .toBe(true);
  });

  test('does not flag the same person', () => {
    expect(SerpContactService.scholarNameMismatch('Li-Huei Tsai', 'Li-Huei Tsai - MIT - Google Scholar'))
      .toBe(false);
  });

  test('tolerates honorifics and first-initial forms (no false reject)', () => {
    expect(SerpContactService.scholarNameMismatch('Dr. Li-Huei Tsai', 'L Tsai - MIT - Google Scholar'))
      .toBe(false);
  });

  test('keep-biased: unextractable displayed name does not reject', () => {
    expect(SerpContactService.scholarNameMismatch('Li-Huei Tsai', 'Google Scholar')).toBe(false);
    expect(SerpContactService.scholarNameMismatch('Li-Huei Tsai', '')).toBe(false);
  });
});

describe('_attachScholarMetrics — identity gate before persisting metrics', () => {
  beforeEach(() => {
    jest.spyOn(ContactEnrichmentService, 'saveToDatabase').mockResolvedValue(undefined);
    jest.spyOn(ContactParser, 'extractPrimaryEmail').mockReturnValue('x@mit.edu');
  });
  afterEach(() => jest.restoreAllMocks());

  const enrich = (name) => ContactEnrichmentService.enrichCandidate(
    { name, affiliation: 'MIT' },
    { credentials: { serpApiKey: 'k' }, useSerpSearch: true, usePubmed: false, useOrcid: false, useClaudeSearch: false },
  );

  test('name mismatch → metrics NOT attached, skip reason recorded', async () => {
    jest.spyOn(SerpContactService, 'findScholarProfile').mockResolvedValue({
      scholarProfileUrl: 'https://scholar.google.com/citations?user=NAK',
      scholarId: 'NAK',
      scholarDisplayName: 'Masayuki Nakano',
      nameMismatch: true,
      institutionMismatch: false,
    });
    const metricsSpy = jest.spyOn(SerpContactService, 'fetchScholarMetrics').mockResolvedValue({ hIndex: 99, i10Index: 50, totalCitations: 12345 });

    const out = await enrich('Li-Huei Tsai');

    expect(metricsSpy).not.toHaveBeenCalled();
    expect(out.contactEnrichment.hIndex == null).toBe(true);
    expect(out.contactEnrichment.googleScholarId == null).toBe(true);
    expect(out.contactEnrichment.tierResults.scholar_profile.skipped).toBe('name_mismatch');
    expect(out.contactEnrichment.scholarIdentityStatus).toBe('unverified');
  });

  test('institution mismatch still skips (regression)', async () => {
    jest.spyOn(SerpContactService, 'findScholarProfile').mockResolvedValue({
      scholarProfileUrl: 'https://scholar.google.com/citations?user=OTH',
      scholarId: 'OTH',
      nameMismatch: false,
      institutionMismatch: true,
    });
    const metricsSpy = jest.spyOn(SerpContactService, 'fetchScholarMetrics').mockResolvedValue({ hIndex: 1, i10Index: 1, totalCitations: 1 });

    const out = await enrich('Li-Huei Tsai');

    expect(metricsSpy).not.toHaveBeenCalled();
    expect(out.contactEnrichment.tierResults.scholar_profile.skipped).toBe('institution_mismatch');
  });

  test('clean match → metrics attach + status probable', async () => {
    jest.spyOn(SerpContactService, 'findScholarProfile').mockResolvedValue({
      scholarProfileUrl: 'https://scholar.google.com/citations?user=TSAI',
      scholarId: 'TSAI',
      nameMismatch: false,
      institutionMismatch: false,
    });
    jest.spyOn(SerpContactService, 'fetchScholarMetrics').mockResolvedValue({ hIndex: 120, i10Index: 200, totalCitations: 80000 });

    const out = await enrich('Li-Huei Tsai');

    expect(out.contactEnrichment.hIndex).toBe(120);
    expect(out.contactEnrichment.googleScholarId).toBe('TSAI');
    expect(out.contactEnrichment.scholarIdentityStatus).toBe('probable');
  });

  test('enrichCandidate attaches the resolver verdict (contactEnrichment.identity)', async () => {
    jest.spyOn(SerpContactService, 'findScholarProfile').mockResolvedValue({
      scholarProfileUrl: 'https://scholar.google.com/citations?user=TSAI',
      scholarId: 'TSAI', nameMismatch: false, institutionMismatch: false,
    });
    jest.spyOn(SerpContactService, 'fetchScholarMetrics').mockResolvedValue({ hIndex: 120, i10Index: 200, totalCitations: 80000 });

    const out = await enrich('Li-Huei Tsai');
    // ORCID off in this block → lone Scholar weak anchor → unresolved.
    expect(out.contactEnrichment.identity).toBeTruthy();
    expect(out.contactEnrichment.identity.status).toBe('unresolved');
    expect(out.contactEnrichment.identity.resolverVersion).toBeTruthy();
  });
});

describe('ORCIDService.findContact — name-scored selection', () => {
  afterEach(() => jest.restoreAllMocks());

  const creds = { clientId: 'c', clientSecret: 's' };

  test('abstains (null) when no result name matches the target', async () => {
    jest.spyOn(ORCIDService, 'searchByName').mockResolvedValue([
      { orcidId: '0000-0000-0000-0001', orcidUrl: 'u1', givenNames: 'Masayuki', familyName: 'Nakano', otherNames: [], emails: ['nak@mit.edu'] },
    ]);
    const out = await ORCIDService.findContact({ name: 'Li-Huei Tsai', affiliation: 'MIT', ...creds });
    expect(out).toBeNull();
  });

  test('selects the name-matching record even when a non-matching one has the email', async () => {
    jest.spyOn(ORCIDService, 'searchByName').mockResolvedValue([
      { orcidId: '0000-0000-0000-0002', orcidUrl: 'u2', givenNames: 'Wei', familyName: 'Zhang', otherNames: [], emails: ['wrong@x.edu'] },
      { orcidId: '0000-0000-0000-0003', orcidUrl: 'u3', givenNames: 'Li-Huei', familyName: 'Tsai', otherNames: [], emails: ['tsai@mit.edu'] },
    ]);
    // S224 #13: the profile is now ALWAYS fetched (no public-email fast-path) so
    // currentAffiliation is captured — assert it's fetched for the SELECTED
    // (name-matched) record, not the homonym with the email.
    const profileSpy = jest.spyOn(ORCIDService, 'getProfile').mockResolvedValue({
      orcidId: '0000-0000-0000-0003', orcidUrl: 'u3', givenNames: 'Li-Huei', familyName: 'Tsai',
      creditName: '', primaryEmail: 'tsai@mit.edu', primaryUrl: null, currentAffiliation: 'MIT',
    });
    const out = await ORCIDService.findContact({ name: 'Li-Huei Tsai', affiliation: 'MIT', ...creds });
    expect(profileSpy).toHaveBeenCalledWith('0000-0000-0000-0003', 'c', 's');
    expect(out.orcidId).toBe('0000-0000-0000-0003');
    expect(out.email).toBe('tsai@mit.edu');
    expect(out.affiliation).toBe('MIT');
    expect(out.source).toBe('orcid_profile');
    expect(out.identityStatus).toBe('probable');
  });

  test('falls back to the search-record email when the always-fetched profile exposes none (S224 #13)', async () => {
    jest.spyOn(ORCIDService, 'searchByName').mockResolvedValue([
      { orcidId: '0000-0000-0000-0033', orcidUrl: 'u33', givenNames: 'Li-Huei', familyName: 'Tsai', otherNames: [], emails: ['tsai@mit.edu'] },
    ]);
    // Profile is fetched (for affiliation) but its /record endpoint omits the
    // email — the search-record public email must still be returned.
    jest.spyOn(ORCIDService, 'getProfile').mockResolvedValue({
      orcidId: '0000-0000-0000-0033', orcidUrl: 'u33', givenNames: 'Li-Huei', familyName: 'Tsai',
      creditName: '', primaryEmail: null, primaryUrl: null, currentAffiliation: 'MIT',
    });
    const out = await ORCIDService.findContact({ name: 'Li-Huei Tsai', affiliation: 'MIT', ...creds });
    expect(out.email).toBe('tsai@mit.edu');
    expect(out.affiliation).toBe('MIT');
  });

  test('returns structured ambiguous when two distinct name-matching records cannot be disambiguated', async () => {
    jest.spyOn(ORCIDService, 'searchByName').mockResolvedValue([
      { orcidId: '0000-0000-0000-0004', orcidUrl: 'u4', givenNames: 'Wei', familyName: 'Zhang', otherNames: [], emails: [] },
      { orcidId: '0000-0000-0000-0005', orcidUrl: 'u5', givenNames: 'Wei', familyName: 'Zhang', otherNames: [], emails: [] },
    ]);
    const out = await ORCIDService.findContact({ name: 'Wei Zhang', affiliation: null, ...creds });
    expect(out.status).toBe('ambiguous');
    expect(out.orcidId).toBeNull();
    expect(out.candidateCount).toBe(2);
  });

  test('flags institutionCorroborated when the matched record institution contains the affiliation (S215)', async () => {
    jest.spyOn(ORCIDService, 'searchByName').mockResolvedValue([
      { orcidId: '0000-0000-0000-0009', orcidUrl: 'u9', givenNames: 'Li-Huei', familyName: 'Tsai', otherNames: [], emails: ['tsai@mit.edu'], institutions: ['Massachusetts Institute of Technology'] },
    ]);
    // Profile now always fetched (S224 #13); corroboration is computed from the
    // search record, so the profile content doesn't affect this assertion.
    jest.spyOn(ORCIDService, 'getProfile').mockResolvedValue({
      orcidId: '0000-0000-0000-0009', orcidUrl: 'u9', givenNames: 'Li-Huei', familyName: 'Tsai',
      creditName: '', primaryEmail: 'tsai@mit.edu', primaryUrl: null, currentAffiliation: 'Massachusetts Institute of Technology',
    });
    const out = await ORCIDService.findContact({ name: 'Li-Huei Tsai', affiliation: 'Massachusetts Institute of Technology', ...creds });
    expect(out.status).toBe('resolved');
    expect(out.institutionCorroborated).toBe(true);
    expect(out.matchedInstitution).toMatch(/Massachusetts Institute/);
  });

  test('institutionCorroborated is false when the matched record institution differs from the affiliation', async () => {
    jest.spyOn(ORCIDService, 'searchByName').mockResolvedValue([
      { orcidId: '0000-0000-0000-0010', orcidUrl: 'u10', givenNames: 'Li-Huei', familyName: 'Tsai', otherNames: [], emails: ['tsai@x.edu'], institutions: ['Stanford University'] },
    ]);
    jest.spyOn(ORCIDService, 'getProfile').mockResolvedValue({
      orcidId: '0000-0000-0000-0010', orcidUrl: 'u10', givenNames: 'Li-Huei', familyName: 'Tsai',
      creditName: '', primaryEmail: 'tsai@x.edu', primaryUrl: null, currentAffiliation: 'Stanford University',
    });
    const out = await ORCIDService.findContact({ name: 'Li-Huei Tsai', affiliation: 'Massachusetts Institute of Technology', ...creds });
    expect(out.status).toBe('resolved');
    expect(out.institutionCorroborated).toBe(false);
    expect(out.matchedInstitution).toBeNull();
  });

  test('institutionCorroborated is false (no crash) when no affiliation is provided', async () => {
    jest.spyOn(ORCIDService, 'searchByName').mockResolvedValue([
      { orcidId: '0000-0000-0000-0011', orcidUrl: 'u11', givenNames: 'Li-Huei', familyName: 'Tsai', otherNames: [], emails: ['t@mit.edu'], institutions: ['Massachusetts Institute of Technology'] },
    ]);
    jest.spyOn(ORCIDService, 'getProfile').mockResolvedValue({
      orcidId: '0000-0000-0000-0011', orcidUrl: 'u11', givenNames: 'Li-Huei', familyName: 'Tsai',
      creditName: '', primaryEmail: 't@mit.edu', primaryUrl: null, currentAffiliation: 'Massachusetts Institute of Technology',
    });
    const out = await ORCIDService.findContact({ name: 'Li-Huei Tsai', affiliation: null, ...creds });
    expect(out.status).toBe('resolved');
    expect(out.institutionCorroborated).toBe(false);
    expect(out.matchedInstitution).toBeNull();
  });

  test('institutionCorroborated propagates on the profile-null return path (record has no public email)', async () => {
    jest.spyOn(ORCIDService, 'searchByName').mockResolvedValue([
      { orcidId: '0000-0000-0000-0012', orcidUrl: 'u12', givenNames: 'Li-Huei', familyName: 'Tsai', otherNames: [], emails: [], institutions: ['Massachusetts Institute of Technology'] },
    ]);
    jest.spyOn(ORCIDService, 'getProfile').mockResolvedValue(null);
    const out = await ORCIDService.findContact({ name: 'Li-Huei Tsai', affiliation: 'Massachusetts Institute of Technology', ...creds });
    expect(out.source).toBe('orcid_search');     // profile-null branch
    expect(out.email).toBeNull();
    expect(out.institutionCorroborated).toBe(true);
    expect(out.matchedInstitution).toMatch(/Massachusetts Institute/);
  });

  test('institutionCorroborated propagates on the full-profile return path', async () => {
    jest.spyOn(ORCIDService, 'searchByName').mockResolvedValue([
      { orcidId: '0000-0000-0000-0013', orcidUrl: 'u13', givenNames: 'Li-Huei', familyName: 'Tsai', otherNames: [], emails: [], institutions: ['Massachusetts Institute of Technology'] },
    ]);
    jest.spyOn(ORCIDService, 'getProfile').mockResolvedValue({
      orcidId: '0000-0000-0000-0013', orcidUrl: 'u13', givenNames: 'Li-Huei', familyName: 'Tsai',
      creditName: '', primaryEmail: 'lh@mit.edu', primaryUrl: null, currentAffiliation: 'MIT',
    });
    const out = await ORCIDService.findContact({ name: 'Li-Huei Tsai', affiliation: 'Massachusetts Institute of Technology', ...creds });
    expect(out.source).toBe('orcid_profile');    // full-profile branch
    expect(out.institutionCorroborated).toBe(true);
    expect(out.matchedInstitution).toMatch(/Massachusetts Institute/);
  });

  test('_nameMatchesTarget matches via creditName / otherNames', () => {
    expect(ORCIDService._nameMatchesTarget(
      { givenNames: 'Elizabeth', familyName: 'Smith', creditName: '', otherNames: ['Beth Smith'] }, 'Beth Smith')).toBe(true);
    expect(ORCIDService._nameMatchesTarget(
      { givenNames: 'Masayuki', familyName: 'Nakano', otherNames: [] }, 'Li-Huei Tsai')).toBe(false);
  });
});

describe('ORCIDService.searchByName — response field mapping', () => {
  afterEach(() => jest.restoreAllMocks());

  // Regression: ORCID's /expanded-search response uses `family-names` (PLURAL).
  // Reading the singular `family-name` left every record's familyName undefined,
  // so the downstream name-match gate (_nameMatchesTarget) rejected even correct
  // records and findContact ALWAYS abstained — ORCID never contributed an anchor,
  // making the resolver's `probable` status (Scholar+ORCID) unreachable in practice.
  // The prior tests mocked searchByName above this mapping, so CI never caught it.
  test('maps family-names (plural) from the raw expanded-search payload', async () => {
    jest.spyOn(ORCIDService, 'getAccessToken').mockResolvedValue('tok');
    const rawPayload = {
      'expanded-result': [
        {
          'orcid-id': '0000-0001-7564-8010',
          'given-names': 'Ram',
          'family-names': 'Madabhushi',
          'credit-name': null,
          'other-name': [],
          'email': [],
          'institution-name': ['The University of Texas Southwestern Medical Center Medical School'],
        },
      ],
    };
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => rawPayload,
    });

    const out = await ORCIDService.searchByName({ name: 'Ram Madabhushi', clientId: 'c', clientSecret: 's' });
    fetchSpy.mockRestore();

    expect(out).toHaveLength(1);
    expect(out[0].givenNames).toBe('Ram');
    expect(out[0].familyName).toBe('Madabhushi'); // ← was undefined before the fix
    // The mapped record must now pass the identity name-match gate.
    expect(ORCIDService._nameMatchesTarget(out[0], 'Ram Madabhushi')).toBe(true);
  });
});
