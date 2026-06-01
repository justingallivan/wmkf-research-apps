/**
 * @jest-environment node
 *
 * Regression guard for the S211 Codex catch: early-email candidates must STILL
 * get Google Scholar bibliometrics. enrichCandidate used to `return` early once a
 * recent email was found (Tier 0 affiliation email, Tier 1 recent PubMed email),
 * skipping the SerpAPI Scholar profile + h-index/citations fetch. The fix routes
 * every exit through `_finalize`, which always runs `_attachScholarMetrics` when
 * SerpAPI is enabled. These tests lock that in.
 */
const { ContactEnrichmentService } = require('../../lib/services/contact-enrichment-service');
const { SerpContactService } = require('../../lib/services/serp-contact-service');
const { ContactParser } = require('../../lib/utils/contact-parser');

describe('enrichCandidate — Scholar metrics fetched even for early-email candidates', () => {
  let profileSpy;
  let metricsSpy;

  beforeEach(() => {
    jest.spyOn(ContactEnrichmentService, 'saveToDatabase').mockResolvedValue(undefined);
    profileSpy = jest.spyOn(SerpContactService, 'findScholarProfile').mockResolvedValue({
      scholarProfileUrl: 'https://scholar.google.com/citations?user=XYZ',
      scholarId: 'XYZ',
    });
    metricsSpy = jest.spyOn(SerpContactService, 'fetchScholarMetrics').mockResolvedValue({
      hIndex: 42,
      i10Index: 88,
      totalCitations: 9999,
    });
  });

  afterEach(() => jest.restoreAllMocks());

  test('Tier 0 (email embedded in affiliation) still fetches bibliometrics', async () => {
    jest.spyOn(ContactParser, 'extractPrimaryEmail').mockReturnValue('x@mit.edu');

    const out = await ContactEnrichmentService.enrichCandidate(
      { name: 'Dr. X', affiliation: 'Dept of Biology, MIT' },
      { credentials: { serpApiKey: 'k' }, useSerpSearch: true, usePubmed: false, useOrcid: false, useClaudeSearch: false },
    );

    expect(out.contactEnrichment.email).toBe('x@mit.edu');
    expect(profileSpy).toHaveBeenCalled();
    expect(metricsSpy).toHaveBeenCalledWith('XYZ', 'k');
    expect(out.contactEnrichment.hIndex).toBe(42);
    expect(out.contactEnrichment.totalCitations).toBe(9999);
  });

  test('Tier 1 (recent PubMed email) still fetches bibliometrics', async () => {
    jest.spyOn(ContactParser, 'extractPrimaryEmail').mockReturnValue(null); // no Tier-0 email
    jest.spyOn(ContactParser, 'extractContactFromPublications').mockReturnValue({
      email: 'y@stanford.edu',
      emailYear: 2024,
      isRecent: true,
    });

    const out = await ContactEnrichmentService.enrichCandidate(
      { name: 'Dr. Y', affiliation: 'Stanford', publications: [{ title: 'A paper', year: 2024 }] },
      { credentials: { serpApiKey: 'k' }, useSerpSearch: true, usePubmed: true, useOrcid: false, useClaudeSearch: false },
    );

    expect(out.contactEnrichment.email).toBe('y@stanford.edu');
    expect(metricsSpy).toHaveBeenCalledWith('XYZ', 'k');
    expect(out.contactEnrichment.hIndex).toBe(42);
  });

  test('persist:false skips saveToDatabase (caller owns the writeback); default persists', async () => {
    jest.spyOn(ContactParser, 'extractPrimaryEmail').mockReturnValue('p@x.edu');
    const saveSpy = ContactEnrichmentService.saveToDatabase;

    await ContactEnrichmentService.enrichCandidate(
      { name: 'Dr. P', affiliation: 'X' },
      { credentials: { serpApiKey: 'k' }, useSerpSearch: true, persist: false, usePubmed: false, useOrcid: false, useClaudeSearch: false },
    );
    expect(saveSpy).not.toHaveBeenCalled();

    await ContactEnrichmentService.enrichCandidate(
      { name: 'Dr. Q', affiliation: 'X' },
      { credentials: { serpApiKey: 'k' }, useSerpSearch: true, usePubmed: false, useOrcid: false, useClaudeSearch: false },
    );
    expect(saveSpy).toHaveBeenCalled(); // default persist:true
  });

  test('no Scholar fetch when SerpAPI is disabled', async () => {
    jest.spyOn(ContactParser, 'extractPrimaryEmail').mockReturnValue('z@x.edu');

    const out = await ContactEnrichmentService.enrichCandidate(
      { name: 'Dr. Z', affiliation: 'X' },
      { credentials: { serpApiKey: 'k' }, useSerpSearch: false, usePubmed: false, useOrcid: false, useClaudeSearch: false },
    );

    expect(out.contactEnrichment.email).toBe('z@x.edu');
    expect(profileSpy).not.toHaveBeenCalled();
    expect(metricsSpy).not.toHaveBeenCalled();
    expect(out.contactEnrichment.hIndex == null).toBe(true);
  });
});
