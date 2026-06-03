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
    const out = await ORCIDService.findContact({ name: 'Li-Huei Tsai', affiliation: 'MIT', ...creds });
    expect(out.orcidId).toBe('0000-0000-0000-0003');
    expect(out.email).toBe('tsai@mit.edu');
    expect(out.identityStatus).toBe('probable');
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

  test('_nameMatchesTarget matches via creditName / otherNames', () => {
    expect(ORCIDService._nameMatchesTarget(
      { givenNames: 'Elizabeth', familyName: 'Smith', creditName: '', otherNames: ['Beth Smith'] }, 'Beth Smith')).toBe(true);
    expect(ORCIDService._nameMatchesTarget(
      { givenNames: 'Masayuki', familyName: 'Nakano', otherNames: [] }, 'Li-Huei Tsai')).toBe(false);
  });
});
