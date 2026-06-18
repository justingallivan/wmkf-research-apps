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
const { OpenAlexService } = require('../../lib/services/openalex-service');
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
    // Slice 1b: bibliometrics + the affiliation candidate + verified domain come from
    // OpenAlex now. Default the lookups to "no author" / "no institution"; each test
    // overrides getAuthorByOrcid when it wants an accepted (strong-anchor) author.
    jest.spyOn(OpenAlexService, 'getAuthorByOrcid').mockResolvedValue(null);
    jest.spyOn(OpenAlexService, 'getAuthorById').mockResolvedValue(null);
    jest.spyOn(OpenAlexService, 'getInstitution').mockResolvedValue(null);
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

  // An ACCEPTED OpenAlex author (ORCID path, strong anchor) carrying a current
  // last-known institution. `orcid` MUST equal the ORCID enrichment looks up by
  // (the candidate's resolved orcidId), or the resolver rejects the anchor.
  function mockOpenAlexAuthor(orcid, { institution = null, institutionId = null } = {}) {
    OpenAlexService.getAuthorByOrcid.mockResolvedValue({
      openAlexId: 'https://openalex.org/A777', displayName: 'Author', orcid,
      lastKnownInstitution: institution, lastKnownInstitutionId: institutionId, lastKnownInstitutionRor: null,
      hIndex: 30, i10Index: 50, citedByCount: 4000, topics: [], worksCount: 10,
    });
  }

  test('ORCID current affiliation wins over the OpenAlex candidate on a trusted verdict', async () => {
    // Institution-corroborated public ORCID → STRONG anchor → probable.
    jest.spyOn(ORCIDService, 'findContact').mockResolvedValue({
      status: 'resolved', orcidId: '0000-0002-1825-0097', orcidUrl: 'https://orcid.org/0000-0002-1825-0097',
      name: 'Jane Roe', email: null, affiliation: 'Harvard University',
      institutionCorroborated: true, matchedInstitution: 'Harvard University', source: 'orcid_profile',
    });
    mockOpenAlexAuthor('0000-0002-1825-0097', { institution: 'Stanford University (OpenAlex says)' });

    const out = await ContactEnrichmentService.enrichCandidate(
      { name: 'Jane Roe', affiliation: 'Old Postdoc Institute', publications: [] },
      baseOpts,
    );
    const ce = out.contactEnrichment;
    expect(ce.identity.status).toBe('probable');
    expect(ce.affiliation).toBe('Harvard University');     // ORCID wins over OpenAlex
    expect(ce.affiliationSource).toBe('orcid_current');
    expect(ce.priorAffiliation).toBe('Old Postdoc Institute');
    expect(out.affiliation).toBe('Harvard University');    // promoted to top-level
  });

  test('OpenAlex current affiliation pins when ORCID has none but the verdict is probable', async () => {
    // ORCID weak (name-match, NOT institution-corroborated, no affiliation) + an
    // ACCEPTED OpenAlex author (strong) → probable. OpenAlex affiliation wins.
    jest.spyOn(ORCIDService, 'findContact').mockResolvedValue({
      status: 'resolved', orcidId: '0000-0001-5109-3700', orcidUrl: 'https://orcid.org/0000-0001-5109-3700',
      name: 'John Doe', email: null, affiliation: null,
      institutionCorroborated: false, matchedInstitution: null, source: 'orcid_profile',
    });
    mockOpenAlexAuthor('0000-0001-5109-3700', { institution: 'MIT (current, per OpenAlex)' });

    const out = await ContactEnrichmentService.enrichCandidate(
      { name: 'John Doe', affiliation: 'Grad School U', publications: [] },
      baseOpts,
    );
    const ce = out.contactEnrichment;
    expect(ce.identity.status).toBe('probable');           // strong OpenAlex anchor
    expect(ce.affiliation).toBe('MIT (current, per OpenAlex)');
    expect(ce.affiliationSource).toBe('openalex_current');
  });

  test('NO override on an unresolved verdict — keeps PubMed-recency affiliation', async () => {
    // No ORCID and no accepted OpenAlex author → no anchors → unresolved. The
    // affiliation candidate only exists on acceptance, so nothing can "correct" it.
    jest.spyOn(ORCIDService, 'findContact').mockResolvedValue(null);

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

  test('_applyAffiliationOverride does NOT pin an OpenAlex candidate under an unresolved verdict', () => {
    // Direct guard coverage: even if an openAlexAffiliation candidate were present,
    // an unresolved/ambiguous verdict must keep the discovery affiliation.
    const result = {
      affiliation: 'PubMed Recency Institute',
      contactEnrichment: {
        affiliation: 'PubMed Recency Institute',
        affiliationSource: 'pubmed_recency',
        orcidAffiliation: null,
        openAlexAffiliation: 'Wrong Person University',
        identity: { status: 'unresolved' },
      },
    };
    ContactEnrichmentService._applyAffiliationOverride(result);
    expect(result.contactEnrichment.affiliation).toBe('PubMed Recency Institute');
    expect(result.contactEnrichment.affiliationSource).toBe('pubmed_recency');
  });

  test('default provenance is pubmed_recency when no current source is collected', async () => {
    // ORCID corroborated (probable) but exposes no affiliation; OpenAlex author
    // accepted but its last-known institution is null → nothing to pin → keep
    // discovery affiliation, tagged pubmed_recency.
    jest.spyOn(ORCIDService, 'findContact').mockResolvedValue({
      status: 'resolved', orcidId: '0000-0003-1419-2405', orcidUrl: 'https://orcid.org/0000-0003-1419-2405',
      name: 'Pat Lee', email: null, affiliation: null,
      institutionCorroborated: true, matchedInstitution: 'Discovery Institute', source: 'orcid_profile',
    });
    mockOpenAlexAuthor('0000-0003-1419-2405', { institution: null });

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

    const out = await ContactEnrichmentService.enrichCandidate(
      { name: 'Counted Person', affiliation: 'Some U', publicationCount5yr: 4, publications: [] },
      baseOpts,
    );
    expect(out.contactEnrichment.publicationCount5yr).toBe(4);
  });

  test('anchored ORCID candidate fetches profile directly and skips name search', async () => {
    const findSpy = jest.spyOn(ORCIDService, 'findContact').mockResolvedValue(null);
    jest.spyOn(ORCIDService, 'getProfile').mockResolvedValue({
      orcidId: '0000-0002-1825-0097',
      orcidUrl: 'https://orcid.org/0000-0002-1825-0097',
      givenNames: 'Jane',
      familyName: 'Roe',
      creditName: '',
      primaryEmail: 'jane@example.edu',
      primaryUrl: 'https://example.edu/jane',
      currentAffiliation: 'Example University',
    });
    mockOpenAlexAuthor('0000-0002-1825-0097', { institution: 'Example University' });

    const out = await ContactEnrichmentService.enrichCandidate(
      { name: 'Jane Roe', affiliation: 'Example University', orcid: '0000-0002-1825-0097', publications: [] },
      { ...baseOpts, useSerpSearch: false },
    );

    expect(findSpy).not.toHaveBeenCalled();
    expect(ORCIDService.getProfile).toHaveBeenCalledWith('0000-0002-1825-0097', 'c', 's', {});
    expect(out.contactEnrichment.email).toBe('jane@example.edu');
    expect(out.contactEnrichment.tierResults.orcid.source).toBe('orcid_anchor');
  });

  test('anchored Tier 3 and Tier 4 reject institution contradictions', async () => {
    jest.spyOn(ContactEnrichmentService, 'claudeWebSearch').mockResolvedValue({
      email: 'wrong@example.edu',
      affiliation: 'Different University',
    });
    jest.spyOn(SerpContactService, 'findContact').mockResolvedValue({
      email: 'also-wrong@example.edu',
      institution: 'Different University',
    });
    mockOpenAlexAuthor('0000-0002-1825-0097', { institution: 'Example University' });

    const out = await ContactEnrichmentService.enrichCandidate(
      { name: 'Jane Roe', affiliation: 'Example University', orcid: '0000-0002-1825-0097', publications: [] },
      {
        credentials: { claudeApiKey: 'ck', serpApiKey: 'sk' },
        usePubmed: false,
        useOrcid: false,
        useClaudeSearch: true,
        useSerpSearch: true,
      },
    );

    expect(out.contactEnrichment.email).toBeNull();
    expect(out.contactEnrichment.tierResults.claude_search.rejectedReason).toBe('identity_anchor_contradiction');
    expect(out.contactEnrichment.tierResults.serp_search.rejectedReason).toBe('identity_anchor_contradiction');
  });

  test('effective ORCID affiliation flows to the contact searches without mutating the input candidate', async () => {
    const input = { name: 'Olga Smirnova', affiliation: null, orcid: '0000-0002-7746-5733', publications: [] };
    jest.spyOn(ORCIDService, 'getProfile').mockResolvedValue({
      orcidId: '0000-0002-7746-5733',
      orcidUrl: 'https://orcid.org/0000-0002-7746-5733',
      givenNames: 'Olga',
      familyName: 'Smirnova',
      primaryEmail: null,
      primaryUrl: null,
      currentAffiliation: 'Max-Born-Institute',
    });
    const claudeSpy = jest.spyOn(ContactEnrichmentService, 'claudeWebSearch').mockResolvedValue(null);
    const contactSpy = jest.spyOn(SerpContactService, 'findContact').mockResolvedValue(null);
    mockOpenAlexAuthor('0000-0002-7746-5733', { institution: 'Max-Born-Institute' });

    await ContactEnrichmentService.enrichCandidate(input, {
      credentials: { orcidClientId: 'c', orcidClientSecret: 's', claudeApiKey: 'ck', serpApiKey: 'sk' },
      usePubmed: false,
      useOrcid: true,
      useClaudeSearch: true,
      useSerpSearch: true,
    });

    expect(claudeSpy.mock.calls[0][0].affiliation).toBe('Max-Born-Institute');
    expect(contactSpy.mock.calls[0][0].affiliation).toBe('Max-Born-Institute');
    expect(input.affiliation).toBeNull();
  });

  test('OpenAlex-verified domain confirms a real institutional email (mbi-berlin recovery)', async () => {
    // The live regression: olga.smirnova@mbi-berlin.de IS her email; the old lexical
    // guard rejected it because mbi-berlin.de (MBI acronym + city) is not in the
    // verbose official name. Slice 1b re-sources the verified domain from the OpenAlex
    // author's institution homepage (web → mbi-berlin.de), corroborating it.
    jest.spyOn(ContactEnrichmentService, 'claudeWebSearch').mockResolvedValue(null);
    jest.spyOn(SerpContactService, 'findContact').mockResolvedValue({
      email: 'olga.smirnova@mbi-berlin.de',
      website: 'https://mbi-berlin.de/p/olgasmirnova',
    });
    mockOpenAlexAuthor('0000-0002-7746-5733', { institution: 'Max-Born-Institute', institutionId: 'https://openalex.org/I4210117284' });
    OpenAlexService.getInstitution.mockResolvedValue({
      openAlexId: 'https://openalex.org/I4210117284', displayName: 'Max Born Institute',
      ror: null, homepageUrl: 'https://mbi-berlin.de', domain: 'mbi-berlin.de',
    });

    const out = await ContactEnrichmentService.enrichCandidate(
      { name: 'Olga Smirnova', affiliation: 'Max-Born-Institute for Nonlinear Optics and Short Pulse Spectroscopy', orcid: '0000-0002-7746-5733', publications: [] },
      {
        credentials: { claudeApiKey: 'ck', serpApiKey: 'sk' },
        usePubmed: false,
        useOrcid: false,
        useClaudeSearch: true,
        useSerpSearch: true,
      },
    );

    expect(out.contactEnrichment.email).toBe('olga.smirnova@mbi-berlin.de');
    expect(out.contactEnrichment.emailPersistAllowed).toBe(true);
    expect(out.contactEnrichment.verifiedInstitutionDomain).toBe('mbi-berlin.de');
  });

  test('no institution anchor and no ORCID abstains from bare-name contact and metrics', async () => {
    const claudeSpy = jest.spyOn(ContactEnrichmentService, 'claudeWebSearch').mockResolvedValue({
      email: 'nickchenyj@gmail.com',
      website: 'https://www.cliburn.org/yanjun-chen',
    });
    const contactSpy = jest.spyOn(SerpContactService, 'findContact').mockResolvedValue({
      email: 'nickchenyj@gmail.com',
      website: 'https://www.cliburn.org/yanjun-chen',
    });

    const out = await ContactEnrichmentService.enrichCandidate(
      {
        name: 'Yanjun Chen',
        affiliation: null,
        orcid: null,
        identityNote: 'Identity needs review',
        publications: [{ title: 'Attoclock physics', year: 2023 }],
      },
      {
        credentials: { claudeApiKey: 'ck', serpApiKey: 'sk' },
        usePubmed: false,
        useOrcid: false,
        useClaudeSearch: true,
        useSerpSearch: true,
      },
    );

    expect(claudeSpy).not.toHaveBeenCalled();
    expect(contactSpy).not.toHaveBeenCalled();
    expect(OpenAlexService.getAuthorByOrcid).not.toHaveBeenCalled();
    expect(OpenAlexService.getAuthorById).not.toHaveBeenCalled();
    expect(out.contactEnrichment.email).toBeNull();
    expect(out.contactEnrichment.website).toBeNull();
    expect(out.contactEnrichment.googleScholarId).toBeNull();
    expect(out.contactEnrichment.hIndex).toBeNull();
    expect(out.contactEnrichment.contactStatus).toBe('unresolved');
    expect(out.contactEnrichment.contactStatusReason).toBe('identity_anchor_required');
    expect(out.identityNote).toBe('Identity needs review');
    expect(out.publications).toHaveLength(1);
  });

  test('Claude document facultyPageUrl is nulled at capture', async () => {
    jest.spyOn(ContactEnrichmentService, 'claudeWebSearch').mockResolvedValue({
      email: null,
      facultyPageUrl: 'https://mit.edu/faculty/example-cv.pdf',
      website: null,
    });

    const out = await ContactEnrichmentService.enrichCandidate(
      { name: 'Jane Roe', affiliation: 'MIT', publications: [] },
      {
        credentials: { claudeApiKey: 'ck' },
        usePubmed: false,
        useOrcid: false,
        useClaudeSearch: true,
        useSerpSearch: false,
        persist: false,
      },
    );

    expect(out.contactEnrichment.facultyPageUrl).toBeNull();
  });
});

describe('ContactEnrichmentService._validateEmailAgainstVerifiedDomain — verified-domain contact validation', () => {
  const run = (email, verifiedInstitutionDomain) => {
    const ce = {
      email, emailSource: 'serp_search', emailPersistAllowed: true, verifiedInstitutionDomain,
      website: 'https://example.org/x', websiteSource: 'serp_search', websitePersistAllowed: true,
      facultyPageUrl: 'https://example.org/fac',
    };
    ContactEnrichmentService._validateEmailAgainstVerifiedDomain(ce);
    return ce;
  };

  test('KEEPS an email whose domain matches the verified domain (mbi-berlin vs mbiberlin)', () => {
    const ce = run('olga.smirnova@mbi-berlin.de', 'mbiberlin.de');
    expect(ce.email).toBe('olga.smirnova@mbi-berlin.de');
    expect(ce.emailPersistAllowed).toBe(true);
  });

  test('KEEPS a subdomain email (phys.ethz.ch confirmed by ethz.ch)', () => {
    const ce = run('keller@phys.ethz.ch', 'ethz.ch');
    expect(ce.email).toBe('keller@phys.ethz.ch');
    expect(ce.emailPersistAllowed).toBe(true);
  });

  test('DROPS a namesake email that contradicts the verified domain (ifmo vs mbiberlin)', () => {
    const ce = run('olga.smirnova@metalab.ifmo.ru', 'mbiberlin.de');
    expect(ce.email).toBeNull();
    expect(ce.website).toBeNull();
    expect(ce.emailPersistAllowed).toBe(false);
    expect(ce.contactStatusReason).toBe('verified_domain_contradiction');
  });

  test('NO-OP when there is no verified domain (trusts the institution-scoped search)', () => {
    const ce = run('someone@unverifiable.edu', null);
    expect(ce.email).toBe('someone@unverifiable.edu');
    expect(ce.emailPersistAllowed).toBe(true);
  });

  test('boundary match only — does NOT treat summit.edu as matching verified mit.edu (drops the namesake)', () => {
    const ce = run('prof@summit.edu', 'mit.edu');
    expect(ce.email).toBeNull();
    expect(ce.contactStatusReason).toBe('verified_domain_contradiction');
  });

  test('boundary match only — does NOT treat notred.ac.uk.evil as matching verified ed.ac.uk', () => {
    const ce = run('x@notred.ac.uk.evil', 'ed.ac.uk');
    expect(ce.email).toBeNull();
  });

  test('NEVER drops a researcher-maintained ORCID email on a verified-domain mismatch (trusted source)', () => {
    const ce = {
      email: 'olga@personal-domain.org', emailSource: 'orcid', emailPersistAllowed: true,
      verifiedInstitutionDomain: 'mbiberlin.de',
      website: null, websiteSource: null, facultyPageUrl: null,
    };
    ContactEnrichmentService._validateEmailAgainstVerifiedDomain(ce);
    expect(ce.email).toBe('olga@personal-domain.org');
    expect(ce.emailPersistAllowed).toBe(true);
  });

  test('NO-OP when there is no email to validate', () => {
    const ce = run(null, 'ethz.ch');
    expect(ce.email).toBeNull();
  });
});
