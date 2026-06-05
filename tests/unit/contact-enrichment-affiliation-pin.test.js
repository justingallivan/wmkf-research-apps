/**
 * @jest-environment node
 *
 * S224, Topic #2 (recency-weighting) pieces #14 + #15: current-affiliation pinning.
 *
 *  - fetchScholarMetrics now also returns the author block's current
 *    `scholarAffiliations` + verified-email-domain `scholarEmail` hint (#14).
 *  - ContactEnrichmentService collects ORCID/Scholar current-affiliation
 *    CANDIDATES during the tiers WITHOUT mutating candidate.affiliation, then
 *    applies an identity-gated override at the END of _finalize (#15):
 *      authority ORCID > Scholar > PubMed-recency, only when the resolver
 *      verdict is trustable (probable/confirmed). An unresolved/ambiguous
 *      candidate keeps its PubMed-recency affiliation — never "corrected" to a
 *      possibly-wrong same-named person's current job (the Tsai→Nakano class).
 */
const { ContactEnrichmentService } = require('../../lib/services/contact-enrichment-service');
const { SerpContactService } = require('../../lib/services/serp-contact-service');
const { ORCIDService } = require('../../lib/services/orcid-service');
const { ContactParser } = require('../../lib/utils/contact-parser');

describe('SerpContactService.fetchScholarMetrics — author block (#14)', () => {
  afterEach(() => jest.restoreAllMocks());

  test('returns scholarAffiliations + scholarEmail alongside the bibliometrics', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        author: {
          affiliations: 'Professor of Biology, Stanford University',
          email: 'Verified email at stanford.edu',
        },
        cited_by: { table: [
          { citations: { all: 9999 } },
          { h_index: { all: 42 } },
          { i10_index: { all: 88 } },
        ] },
      }),
    });
    const m = await SerpContactService.fetchScholarMetrics('XYZ', 'k');
    expect(m.hIndex).toBe(42);
    expect(m.totalCitations).toBe(9999);
    expect(m.scholarAffiliations).toBe('Professor of Biology, Stanford University');
    expect(m.scholarEmail).toBe('Verified email at stanford.edu');
  });

  test('null author block → affiliation/email null, metrics still parsed', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ cited_by: { table: [{ h_index: { all: 7 } }] } }),
    });
    const m = await SerpContactService.fetchScholarMetrics('XYZ', 'k');
    expect(m.hIndex).toBe(7);
    expect(m.scholarAffiliations).toBeNull();
    expect(m.scholarEmail).toBeNull();
  });

  test('returns scholarAffiliations even when cited_by.table is missing (Codex MEDIUM)', async () => {
    // A profile that carries a current affiliation but no metrics table must NOT
    // drop the affiliation just because the bibliometrics are absent.
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ author: { affiliations: 'Professor, MIT', email: 'Verified email at mit.edu' } }),
    });
    const m = await SerpContactService.fetchScholarMetrics('XYZ', 'k');
    expect(m).not.toBeNull();
    expect(m.scholarAffiliations).toBe('Professor, MIT');
    expect(m.scholarEmail).toBe('Verified email at mit.edu');
    expect(m.hIndex).toBeNull();
    expect(m.totalCitations).toBeNull();
  });
});

describe('ORCIDService.getProfile — currentAffiliation strictly current (Codex HIGH)', () => {
  afterEach(() => jest.restoreAllMocks());

  const recordPayload = (employmentSummary) => ({
    person: {
      emails: { email: [] },
      'researcher-urls': { 'researcher-url': [] },
      name: { 'given-names': { value: 'Jane' }, 'family-name': { value: 'Roe' } },
    },
    'activities-summary': {
      employments: { 'affiliation-group': [{ summaries: [{ 'employment-summary': employmentSummary }] }] },
    },
  });

  test('only-ended employments → currentAffiliation null (no stale postdoc pin)', async () => {
    jest.spyOn(ORCIDService, 'getAccessToken').mockResolvedValue('tok');
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => recordPayload({ organization: { name: 'Old Postdoc Lab' }, 'end-date': { year: { value: '2019' } } }),
    });
    const profile = await ORCIDService.getProfile('0000-0000-0000-0099', 'c', 's');
    expect(profile.affiliations).toHaveLength(1);
    expect(profile.affiliations[0].current).toBe(false);
    expect(profile.currentAffiliation).toBeNull();   // would have been 'Old Postdoc Lab' before the fix
  });

  test('a current (no end-date) employment → currentAffiliation set', async () => {
    jest.spyOn(ORCIDService, 'getAccessToken').mockResolvedValue('tok');
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => recordPayload({ organization: { name: 'Current University' } }),
    });
    const profile = await ORCIDService.getProfile('0000-0000-0000-0100', 'c', 's');
    expect(profile.currentAffiliation).toBe('Current University');
  });
});

describe('ContactEnrichmentService — identity-gated affiliation override (#15)', () => {
  beforeEach(() => {
    jest.spyOn(ContactEnrichmentService, 'saveToDatabase').mockResolvedValue(undefined);
    jest.spyOn(ContactParser, 'extractPrimaryEmail').mockReturnValue(null); // no Tier-0 email
    // Tier-4 SerpAPI email search runs (no email found) — stub it offline so the
    // override tests stay deterministic and don't hit the network.
    jest.spyOn(SerpContactService, 'findContact').mockResolvedValue(null);
  });
  afterEach(() => jest.restoreAllMocks());

  const creds = { orcidClientId: 'c', orcidClientSecret: 's', serpApiKey: 'k' };
  const baseOpts = {
    credentials: creds,
    usePubmed: false,
    useOrcid: true,
    useSerpSearch: true,
    useClaudeSearch: false,
  };

  // A non-mismatched Scholar profile (weak anchor) carrying a current affiliation.
  function mockScholar({ affiliations = null } = {}) {
    jest.spyOn(SerpContactService, 'findScholarProfile').mockResolvedValue({
      scholarProfileUrl: 'https://scholar.google.com/citations?user=SCH',
      scholarId: 'SCH', nameMismatch: false, institutionMismatch: false,
    });
    jest.spyOn(SerpContactService, 'fetchScholarMetrics').mockResolvedValue({
      hIndex: 30, i10Index: 50, totalCitations: 4000, scholarAffiliations: affiliations, scholarEmail: null,
    });
  }

  test('ORCID current affiliation wins on a trusted (probable) verdict', async () => {
    // Institution-corroborated public ORCID → STRONG anchor → probable.
    jest.spyOn(ORCIDService, 'findContact').mockResolvedValue({
      status: 'resolved', orcidId: '0000-0001', orcidUrl: 'https://orcid.org/0000-0001',
      name: 'Jane Roe', email: null, affiliation: 'Harvard University',
      institutionCorroborated: true, matchedInstitution: 'Harvard University', source: 'orcid_profile',
    });
    mockScholar({ affiliations: 'Stanford University (Scholar says)' });

    const out = await ContactEnrichmentService.enrichCandidate(
      { name: 'Jane Roe', affiliation: 'Old Postdoc Institute', publications: [] },
      baseOpts,
    );
    const ce = out.contactEnrichment;
    expect(ce.identity.status).toBe('probable');
    expect(ce.affiliation).toBe('Harvard University');     // ORCID wins over Scholar
    expect(ce.affiliationSource).toBe('orcid_current');
    expect(ce.priorAffiliation).toBe('Old Postdoc Institute');
    expect(out.affiliation).toBe('Harvard University');    // promoted to top-level
  });

  test('Scholar current affiliation pins when ORCID has none but the verdict is still probable', async () => {
    // ORCID weak (name-match, NOT institution-corroborated) + Scholar weak →
    // two weak anchors → probable. ORCID carries no affiliation, so Scholar wins.
    jest.spyOn(ORCIDService, 'findContact').mockResolvedValue({
      status: 'resolved', orcidId: '0000-0002', orcidUrl: 'https://orcid.org/0000-0002',
      name: 'John Doe', email: null, affiliation: null,
      institutionCorroborated: false, matchedInstitution: null, source: 'orcid_profile',
    });
    mockScholar({ affiliations: 'MIT (current, per Scholar)' });

    const out = await ContactEnrichmentService.enrichCandidate(
      { name: 'John Doe', affiliation: 'Grad School U', publications: [] },
      baseOpts,
    );
    const ce = out.contactEnrichment;
    expect(ce.identity.status).toBe('probable');           // 2 weak anchors
    expect(ce.affiliation).toBe('MIT (current, per Scholar)');
    expect(ce.affiliationSource).toBe('scholar_current');
  });

  test('NO override on an unresolved verdict — keeps PubMed-recency affiliation', async () => {
    // Lone Scholar weak anchor, no ORCID → unresolved. Even though Scholar
    // surfaced a current affiliation, an untrusted match must not "correct" it.
    jest.spyOn(ORCIDService, 'findContact').mockResolvedValue(null);
    mockScholar({ affiliations: 'Wrong Person University' });

    const out = await ContactEnrichmentService.enrichCandidate(
      { name: 'Ambiguous Name', affiliation: 'PubMed Recency Institute', publications: [] },
      baseOpts,
    );
    const ce = out.contactEnrichment;
    expect(ce.identity.status).toBe('unresolved');
    expect(ce.affiliation).toBe('PubMed Recency Institute');
    expect(ce.affiliationSource).toBe('pubmed_recency');
    expect(ce.priorAffiliation).toBeUndefined();
    expect(out.affiliation).toBe('PubMed Recency Institute');
  });

  test('default provenance is pubmed_recency when no current source is collected', async () => {
    // ORCID corroborated (probable) but exposes no affiliation, Scholar none →
    // nothing to pin → keep discovery affiliation, tagged pubmed_recency.
    jest.spyOn(ORCIDService, 'findContact').mockResolvedValue({
      status: 'resolved', orcidId: '0000-0003', orcidUrl: 'https://orcid.org/0000-0003',
      name: 'Pat Lee', email: null, affiliation: null,
      institutionCorroborated: true, matchedInstitution: 'Discovery Institute', source: 'orcid_profile',
    });
    mockScholar({ affiliations: null });

    const out = await ContactEnrichmentService.enrichCandidate(
      { name: 'Pat Lee', affiliation: 'Discovery Institute', publications: [] },
      baseOpts,
    );
    const ce = out.contactEnrichment;
    expect(ce.identity.status).toBe('probable');
    expect(ce.affiliation).toBe('Discovery Institute');
    expect(ce.affiliationSource).toBe('pubmed_recency');
  });

  test('publicationCount5yr is threaded onto contactEnrichment for the client re-rank', async () => {
    jest.spyOn(ORCIDService, 'findContact').mockResolvedValue(null);
    mockScholar({ affiliations: null });

    const out = await ContactEnrichmentService.enrichCandidate(
      { name: 'Counted Person', affiliation: 'Some U', publicationCount5yr: 4, publications: [] },
      baseOpts,
    );
    expect(out.contactEnrichment.publicationCount5yr).toBe(4);
  });
});
