/**
 * @jest-environment node
 *
 * Regression guard for the S211 Codex catch, ported to Slice 1b (OpenAlex metrics):
 * early-email candidates must STILL get bibliometrics. enrichCandidate used to
 * `return` early once a recent email was found (Tier 0 affiliation email, Tier 1
 * recent PubMed email), skipping the metrics fetch. The fix routes every exit
 * through `_finalize`, which always runs `_attachOpenAlexMetrics` when the candidate
 * carries an identity anchor (ORCID, or a discovery-spine-resolved OpenAlex author id).
 *
 * Slice 1b changes locked here: metrics come from OpenAlex (free), so they are
 * DECOUPLED from the paid `useSerpSearch` toggle; and a candidate with NO identity
 * anchor ABSTAINS (no metrics) rather than name-searching a possible namesake.
 */
const { ContactEnrichmentService } = require('../../lib/services/contact-enrichment-service');
const { OpenAlexService } = require('../../lib/services/openalex-service');
const { ContactParser } = require('../../lib/utils/contact-parser');
const ScholarlyEmail = require('../../lib/services/contact-enrichment/scholarly-email');

const ORCID = '0000-0002-1825-0097';
const AUTHOR = {
  openAlexId: 'https://openalex.org/A5023888391',
  displayName: 'Dr X',
  orcid: ORCID,
  lastKnownInstitution: 'Massachusetts Institute of Technology',
  lastKnownInstitutionId: 'https://openalex.org/I63966007',
  lastKnownInstitutionRor: 'https://ror.org/042nb2s44',
  hIndex: 42,
  i10Index: 88,
  citedByCount: 9999,
  topics: [],
  worksCount: 100,
};

describe('enrichCandidate — OpenAlex metrics fetched even for early-email candidates', () => {
  let byOrcidSpy;
  let byIdSpy;
  let institutionSpy;

  beforeEach(() => {
    jest.spyOn(ContactEnrichmentService, 'saveToDatabase').mockResolvedValue(undefined);
    // This unit suite exercises the metrics/finalization seam, not live scholarly
    // provider retries. Keep the structured tier deterministic and offline.
    jest.spyOn(ScholarlyEmail, 'findScholarlyEmail').mockResolvedValue({
      status: 'not_found',
      evidence: [],
    });
    byOrcidSpy = jest.spyOn(OpenAlexService, 'getAuthorByOrcid').mockResolvedValue(AUTHOR);
    // S266: ORCID metrics path resolves via getRichestAuthorByOrcid; delegate to the
    // getAuthorByOrcid mock (richest-selection is unit-tested in openalex-service.test.js).
    jest.spyOn(OpenAlexService, 'getRichestAuthorByOrcid')
      .mockImplementation((o, opts) => OpenAlexService.getAuthorByOrcid(o, opts));
    byIdSpy = jest.spyOn(OpenAlexService, 'getAuthorById').mockResolvedValue(AUTHOR);
    institutionSpy = jest.spyOn(OpenAlexService, 'getInstitution').mockResolvedValue({
      openAlexId: AUTHOR.lastKnownInstitutionId,
      displayName: 'Massachusetts Institute of Technology',
      ror: AUTHOR.lastKnownInstitutionRor,
      homepageUrl: 'https://web.mit.edu',
      domain: 'mit.edu',
    });
  });

  afterEach(() => jest.restoreAllMocks());

  test('Tier 0 (email embedded in affiliation) still fetches bibliometrics via ORCID', async () => {
    jest.spyOn(ContactParser, 'extractPrimaryEmail').mockReturnValue('x@mit.edu');

    const out = await ContactEnrichmentService.enrichCandidate(
      { name: 'Dr. X', affiliation: 'Dept of Biology, MIT', orcid: ORCID },
      { credentials: {}, usePubmed: false, useOrcid: false, useClaudeSearch: false },
    );

    expect(out.contactEnrichment.email).toBe('x@mit.edu');
    expect(byOrcidSpy).toHaveBeenCalled();
    expect(out.contactEnrichment.hIndex).toBe(42);
    expect(out.contactEnrichment.i10Index).toBe(88);
    expect(out.contactEnrichment.totalCitations).toBe(9999);
    expect(out.contactEnrichment.tierResults.openalex_author.acceptPath).toBe('orcid');
    // #2 dropped: new candidates carry no exact Scholar deep-link id.
    expect(out.contactEnrichment.googleScholarId).toBeNull();
  });

  test('Tier 1 (recent PubMed email) still fetches bibliometrics', async () => {
    jest.spyOn(ContactParser, 'extractPrimaryEmail').mockReturnValue(null); // no Tier-0 email
    jest.spyOn(ContactParser, 'extractContactFromPublications').mockReturnValue({
      email: 'y@stanford.edu',
      emailYear: 2024,
      isRecent: true,
    });

    const out = await ContactEnrichmentService.enrichCandidate(
      { name: 'Dr. Y', affiliation: 'Stanford', orcid: ORCID, publications: [{ title: 'A paper', year: 2024 }] },
      { credentials: {}, usePubmed: true, useOrcid: false, useClaudeSearch: false },
    );

    expect(out.contactEnrichment.email).toBe('y@stanford.edu');
    expect(byOrcidSpy).toHaveBeenCalled();
    expect(out.contactEnrichment.hIndex).toBe(42);
  });

  test('no-ORCID candidate carrying a discovery-spine OpenAlex author id (openAlexId) uses getAuthorById', async () => {
    jest.spyOn(ContactParser, 'extractPrimaryEmail').mockReturnValue('s@mit.edu');

    const out = await ContactEnrichmentService.enrichCandidate(
      { name: 'Dr. S', affiliation: 'MIT', openAlexId: 'A5023888391', identityStatus: 'probable' },
      { credentials: {}, usePubmed: false, useOrcid: false, useClaudeSearch: false },
    );

    expect(byOrcidSpy).not.toHaveBeenCalled();
    expect(byIdSpy).toHaveBeenCalledWith('A5023888391', expect.anything());
    expect(out.contactEnrichment.hIndex).toBe(42);
    expect(out.contactEnrichment.tierResults.openalex_author.acceptPath).toBe('spine');
  });

  test('Track-B candidate carrying openAlexAuthorId (not openAlexId) also gets metrics (Codex S251 LOW)', async () => {
    jest.spyOn(ContactParser, 'extractPrimaryEmail').mockReturnValue('tb@mit.edu');

    const out = await ContactEnrichmentService.enrichCandidate(
      { name: 'Dr. TB', affiliation: 'MIT', openAlexAuthorId: 'https://openalex.org/A5023888391', identityStatus: 'probable' },
      { credentials: {}, usePubmed: false, useOrcid: false, useClaudeSearch: false },
    );

    expect(byIdSpy).toHaveBeenCalledWith('https://openalex.org/A5023888391', expect.anything());
    expect(out.contactEnrichment.hIndex).toBe(42);
    expect(out.contactEnrichment.tierResults.openalex_author.acceptPath).toBe('spine');
  });

  test('a non-abort OpenAlex outage records skipped=openalex_error (not silently unset)', async () => {
    jest.spyOn(ContactParser, 'extractPrimaryEmail').mockReturnValue('e@mit.edu');
    byOrcidSpy.mockRejectedValue(new Error('503 Service Unavailable'));

    const out = await ContactEnrichmentService.enrichCandidate(
      { name: 'Dr. E', affiliation: 'MIT', orcid: ORCID },
      { credentials: {}, usePubmed: false, useOrcid: false, useClaudeSearch: false },
    );

    expect(out.contactEnrichment.hIndex == null).toBe(true);
    expect(out.contactEnrichment.scholarPersistAllowed).toBe(false);
    expect(out.contactEnrichment.tierResults.openalex_author.skipped).toBe('openalex_error');
  });

  test('persist:false skips saveToDatabase (caller owns the writeback); default persists', async () => {
    jest.spyOn(ContactParser, 'extractPrimaryEmail').mockReturnValue('p@x.edu');
    const saveSpy = ContactEnrichmentService.saveToDatabase;

    await ContactEnrichmentService.enrichCandidate(
      { name: 'Dr. P', affiliation: 'X', orcid: ORCID },
      { credentials: {}, persist: false, usePubmed: false, useOrcid: false, useClaudeSearch: false },
    );
    expect(saveSpy).not.toHaveBeenCalled();

    await ContactEnrichmentService.enrichCandidate(
      { name: 'Dr. Q', affiliation: 'X', orcid: ORCID },
      { credentials: {}, usePubmed: false, useOrcid: false, useClaudeSearch: false },
    );
    expect(saveSpy).toHaveBeenCalled(); // default persist:true
  });

  test('metrics are FREE: fetched even when the paid SerpAPI toggle is OFF', async () => {
    jest.spyOn(ContactParser, 'extractPrimaryEmail').mockReturnValue('z@x.edu');

    const out = await ContactEnrichmentService.enrichCandidate(
      { name: 'Dr. Z', affiliation: 'X', orcid: ORCID },
      { credentials: {}, useSerpSearch: false, usePubmed: false, useOrcid: false, useClaudeSearch: false },
    );

    expect(out.contactEnrichment.email).toBe('z@x.edu');
    expect(byOrcidSpy).toHaveBeenCalled();
    expect(out.contactEnrichment.hIndex).toBe(42);
  });

  test('no identity anchor (no ORCID, no spine id) → ABSTAIN, no metrics', async () => {
    jest.spyOn(ContactParser, 'extractPrimaryEmail').mockReturnValue('n@x.edu');

    const out = await ContactEnrichmentService.enrichCandidate(
      { name: 'Dr. N', affiliation: 'Some University' },
      { credentials: {}, usePubmed: false, useOrcid: false, useClaudeSearch: false },
    );

    expect(byOrcidSpy).not.toHaveBeenCalled();
    expect(byIdSpy).not.toHaveBeenCalled();
    expect(out.contactEnrichment.hIndex == null).toBe(true);
    expect(out.contactEnrichment.tierResults.openalex_author.skipped).toBe('identity_anchor_required');
  });
});
