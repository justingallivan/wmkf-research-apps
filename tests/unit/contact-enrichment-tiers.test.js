/**
 * @jest-environment node
 *
 * Stage 9 (Checkpoint D) characterization suite — docs/CONTACT_ENRICHMENT_SERVICE_DECOMPOSITION_PLAN.md
 * C9/C10/C12. Baselined GREEN against the pre-extraction facade (enrichCandidate/_finalize/
 * _applyAffiliationOverride still live on lib/services/contact-enrichment-service.js). Pins:
 *
 *  - Every tier's found/not-found/stale/abort/non-abort-error/skip branch (C9).
 *  - The inter-tier short-circuit boundaries: Tier 0 finalizes early; Tier 1 continues
 *    through structured corroboration; Tier 2/3/4 always fall through; Tier 3's abort THROWS instead of
 *    finalizing.
 *  - `_finalize`'s fixed step order (C12): OpenAlex metrics -> identity resolve ->
 *    institution-domain evidence -> resolved-page email -> domain validation ->
 *    name-mismatch readjudication -> contact-lead collection -> affiliation override -> persist.
 *  - `_finalize` arg fidelity (C9): early-return tiers pass the default `scholarCandidate = candidate`;
 *    the final catch-all return passes `scholarCandidate: searchCandidate` (a distinct object when an
 *    effective institution was found).
 *
 * Mutation-proof: see the Session build report for the specific line flipped per assertion group
 * and the resulting failures (reverted after confirming).
 */
const { ContactEnrichmentService } = require('../../lib/services/contact-enrichment-service');
const { ContactParser } = require('../../lib/utils/contact-parser');
const { ORCIDService } = require('../../lib/services/orcid-service');
const { SerpContactService } = require('../../lib/services/serp-contact-service');
const { OpenAlexService } = require('../../lib/services/openalex-service');
const openAlexMetrics = require('../../lib/services/contact-enrichment/openalex-metrics');
const domainEvidence = require('../../lib/services/contact-enrichment/domain-evidence');
const pageEmail = require('../../lib/services/contact-enrichment/page-email');
const emailAdjudication = require('../../lib/services/contact-enrichment/email-adjudication');
const scholarlyEmail = require('../../lib/services/contact-enrichment/scholarly-email');

afterEach(() => jest.restoreAllMocks());

// Baseline stub of every downstream network-touching lookup used inside _finalize /
// Tier 2-4, so a test only needs to override what it cares about.
function stubFinalizeDeps() {
  jest.spyOn(ContactEnrichmentService, 'saveToDatabase').mockResolvedValue(undefined);
  jest.spyOn(OpenAlexService, 'getAuthorByOrcid').mockResolvedValue(null);
  jest.spyOn(OpenAlexService, 'getRichestAuthorByOrcid').mockResolvedValue(null);
  jest.spyOn(OpenAlexService, 'getAuthorById').mockResolvedValue(null);
  jest.spyOn(OpenAlexService, 'getInstitution').mockResolvedValue(null);
  jest.spyOn(OpenAlexService, 'searchInstitutions').mockResolvedValue([]);
  jest.spyOn(scholarlyEmail, 'findScholarlyEmail').mockResolvedValue({
    status: 'not_found',
    candidates: [],
    providerErrors: [],
  });
}

describe('Tier 0 — affiliation-embedded email', () => {
  beforeEach(stubFinalizeDeps);

  test('found -> finalizes immediately; later tiers never run', async () => {
    const claudeSpy = jest.spyOn(ContactEnrichmentService, 'claudeWebSearch');
    const serpSpy = jest.spyOn(SerpContactService, 'findContact');
    const orcidSpy = jest.spyOn(ORCIDService, 'findContact');

    const out = await ContactEnrichmentService.enrichCandidate(
      { name: 'Dr. Tier0', affiliation: 'Dept of X. Electronic address: tier0@example.edu', publications: [] },
      { usePubmed: true, useOrcid: true, useClaudeSearch: true, useSerpSearch: true,
        credentials: { claudeApiKey: 'k', serpApiKey: 'k' } },
    );

    expect(out.contactEnrichment.email).toBe('tier0@example.edu');
    expect(out.contactEnrichment.emailSource).toBe('affiliation');
    expect(out.contactEnrichment.tiersUsed).toEqual(['affiliation']);
    expect(orcidSpy).not.toHaveBeenCalled();
    expect(claudeSpy).not.toHaveBeenCalled();
    expect(serpSpy).not.toHaveBeenCalled();
  });

  test('not found (no affiliation) -> falls through to Tier 1', async () => {
    const out = await ContactEnrichmentService.enrichCandidate(
      { name: 'Dr. NoAffil', affiliation: 'Some Lab', publications: [{ year: 2024, authors: [{ name: 'Dr. NoAffil', affiliation: 'Some Lab, joe@pubmed.edu (2024)' }] }] },
      { usePubmed: true, useOrcid: false },
    );
    expect(out.contactEnrichment.emailSource).toBe('pubmed');
  });
});

describe('Tier 1 — PubMed', () => {
  beforeEach(stubFinalizeDeps);

  test('recent legacy email continues through ORCID and structured corroboration', async () => {
    const orcidSpy = jest.spyOn(ORCIDService, 'findContact').mockResolvedValue(null);
    const out = await ContactEnrichmentService.enrichCandidate(
      { name: 'Dr. Recent', affiliation: 'Recent University', publications: [{ year: new Date().getFullYear(), authors: [{ name: 'Dr. Recent', affiliation: 'Recent University. recent@pubmed.edu' }] }] },
      { useOrcid: true, credentials: { orcidClientId: 'c', orcidClientSecret: 's' } },
    );
    expect(out.contactEnrichment.emailSource).toBe('pubmed');
    expect(out.contactEnrichment.emailIsRecent).toBe(true);
    expect(orcidSpy).toHaveBeenCalled();
    expect(scholarlyEmail.findScholarlyEmail).toHaveBeenCalled();
  });

  test('stale (non-recent) email -> falls through, Tier 2 still runs', async () => {
    jest.spyOn(ORCIDService, 'findContact').mockResolvedValue(null);
    const out = await ContactEnrichmentService.enrichCandidate(
      { name: 'Dr. Stale', affiliation: 'Stale University', publications: [{ year: 2010, authors: [{ name: 'Dr. Stale', affiliation: 'Lab. stale@pubmed.edu' }] }] },
      { useOrcid: true, credentials: { orcidClientId: 'c', orcidClientSecret: 's' } },
    );
    expect(out.contactEnrichment.emailSource).toBe('pubmed');
    expect(out.contactEnrichment.emailIsRecent).toBe(false);
    expect(ORCIDService.findContact).toHaveBeenCalled();
  });

  test('no email in PubMed -> not_found, falls through', async () => {
    const out = await ContactEnrichmentService.enrichCandidate(
      { name: 'Dr. NoPubmed', publications: [{ year: 2024, authors: [{ name: 'Dr. NoPubmed', affiliation: 'Lab with no email' }] }] },
      { useOrcid: false },
    );
    expect(out.contactEnrichment.tierResults.pubmed.email).toBeNull();
    expect(out.contactEnrichment.email).toBeNull();
  });

  test('usePubmed=false -> Tier 1 entirely skipped (implicit continue)', async () => {
    const out = await ContactEnrichmentService.enrichCandidate(
      { name: 'Dr. Skip', publications: [{ year: 2024, authors: [{ name: 'Dr. Skip', affiliation: 'x@y.edu' }] }] },
      { usePubmed: false, useOrcid: false },
    );
    expect(out.contactEnrichment.tierResults.pubmed).toBeUndefined();
    expect(out.contactEnrichment.tiersUsed).not.toContain('pubmed');
  });

  test('two-work scholarly evidence becomes invite-ready with bounded provenance', async () => {
    scholarlyEmail.findScholarlyEmail.mockResolvedValue({
      status: 'found',
      email: 'jane@stanford.edu',
      publicationCount: 2,
      latestYear: 2026,
      providers: ['ncbi_pubmed', 'europe_pmc'],
      publications: [
        { pmid: '1', title: 'One', year: 2026, url: 'https://pubmed.ncbi.nlm.nih.gov/1/', providers: ['ncbi_pubmed', 'europe_pmc'] },
        { pmid: '2', title: 'Two', year: 2025, url: 'https://pubmed.ncbi.nlm.nih.gov/2/', providers: ['europe_pmc'] },
      ],
      providerErrors: [],
    });
    const out = await ContactEnrichmentService.enrichCandidate(
      { name: 'Dr. Jane Roe', affiliation: 'Stanford University', publications: [] },
      { usePubmed: true, useOrcid: false },
    );
    expect(out.contactEnrichment).toMatchObject({
      email: 'jane@stanford.edu',
      emailSource: 'scholarly_multi',
      emailAction: 'ready',
      emailEvidence: {
        publicationCount: 2,
        providers: ['ncbi_pubmed', 'europe_pmc'],
        deliverabilityChecked: false,
      },
    });
  });

  test('structured address conflict clears an earlier legacy PubMed quick-check address', async () => {
    scholarlyEmail.findScholarlyEmail.mockResolvedValue({
      status: 'conflict',
      candidates: [
        { email: 'jane@old.edu', publicationCount: 2 },
        { email: 'jane@new.edu', publicationCount: 2 },
      ],
      providerErrors: [],
    });
    const year = new Date().getFullYear();
    const out = await ContactEnrichmentService.enrichCandidate(
      {
        name: 'Dr. Jane Roe',
        affiliation: 'Stanford University',
        publications: [{
          year,
          authors: [{
            name: 'Dr. Jane Roe',
            affiliation: `Stanford University. jane@old.edu`,
          }],
        }],
      },
      { usePubmed: true, useOrcid: false },
    );

    expect(out.contactEnrichment.tierResults.pubmed.email).toBe('jane@old.edu');
    expect(out.contactEnrichment.tierResults.scholarly_email.status).toBe('conflict');
    expect(out.contactEnrichment).toMatchObject({
      email: null,
      emailSource: null,
      emailPersistAllowed: false,
      emailAction: 'missing',
    });
  });

  test('total structured-provider failure is surfaced as an error, not a definitive miss', async () => {
    scholarlyEmail.findScholarlyEmail.mockResolvedValue({
      status: 'provider_error',
      candidates: [],
      providerErrors: [
        { provider: 'ncbi_pubmed', error: 'NCBI unavailable' },
        { provider: 'europe_pmc', error: 'Europe PMC unavailable' },
      ],
    });
    const progress = [];
    const out = await ContactEnrichmentService.enrichCandidate(
      { name: 'Dr. Jane Roe', affiliation: 'Stanford University', publications: [] },
      { usePubmed: true, useOrcid: false, onProgress: (event) => progress.push(event) },
    );

    expect(out.contactEnrichment.tierResults.scholarly_email.status).toBe('provider_error');
    expect(progress).toContainEqual(expect.objectContaining({
      tier: 'scholarly',
      status: 'error',
      message: expect.stringMatching(/services unavailable/i),
    }));
  });
});

describe('Tier 2 — ORCID', () => {
  beforeEach(stubFinalizeDeps);
  const creds = { orcidClientId: 'c', orcidClientSecret: 's' };

  test('found: email/website/affiliation captured, never overwrites an existing email', async () => {
    jest.spyOn(ORCIDService, 'findContact').mockResolvedValue({
      status: 'resolved', orcidId: '0000-0001', orcidUrl: 'https://orcid.org/0000-0001',
      email: 'orcid@example.edu', website: 'https://example.edu/~jane', affiliation: 'Orcid U',
    });
    jest.spyOn(ContactParser, 'isUsefulWebsiteUrl').mockReturnValue(true);
    const out = await ContactEnrichmentService.enrichCandidate(
      { name: 'Dr. Orcid', affiliation: 'Orcid U', publications: [] },
      { useOrcid: true, credentials: creds },
    );
    expect(out.contactEnrichment.orcidId).toBe('0000-0001');
    expect(out.contactEnrichment.email).toBe('orcid@example.edu');
    expect(out.contactEnrichment.emailSource).toBe('orcid');
    expect(out.contactEnrichment.website).toBe('https://example.edu/~jane');
    expect(out.contactEnrichment.orcidAffiliation).toBe('Orcid U');
  });

  test('ambiguous -> not attached, falls through', async () => {
    jest.spyOn(ORCIDService, 'findContact').mockResolvedValue({ status: 'ambiguous', candidateCount: 3 });
    const out = await ContactEnrichmentService.enrichCandidate(
      { name: 'Dr. Ambig', affiliation: 'Some U', publications: [] },
      { useOrcid: true, credentials: creds },
    );
    expect(out.contactEnrichment.orcidId).toBeNull();
    expect(out.contactEnrichment.email).toBeNull();
  });

  test('error is swallowed (falls through, no rethrow even without abort signal)', async () => {
    jest.spyOn(ORCIDService, 'findContact').mockRejectedValue(new Error('orcid down'));
    const out = await ContactEnrichmentService.enrichCandidate(
      { name: 'Dr. OrcidErr', affiliation: 'Some U', publications: [] },
      { useOrcid: true, credentials: creds },
    );
    expect(out.contactEnrichment.tierResults.orcid).toEqual({ error: 'orcid down' });
  });

  test('no credentials -> skipped, falls through (no ORCID call)', async () => {
    const spy = jest.spyOn(ORCIDService, 'findContact');
    const out = await ContactEnrichmentService.enrichCandidate(
      { name: 'Dr. NoCreds', affiliation: 'Some U', publications: [] },
      { useOrcid: true, credentials: {} },
    );
    expect(spy).not.toHaveBeenCalled();
    expect(out.contactEnrichment).toBeTruthy();
  });
});

describe('No-anchor abstain (between Tier 2 and Tier 3)', () => {
  beforeEach(stubFinalizeDeps);

  test('no institution + no ORCID anchor -> abstain mutates, then still finalizes', async () => {
    jest.spyOn(ORCIDService, 'findContact').mockResolvedValue(null);
    const out = await ContactEnrichmentService.enrichCandidate(
      { name: 'Dr. NoAnchor', publications: [{ year: 2010, authors: [{ name: 'Dr. NoAnchor', affiliation: 'stale@pubmed.edu' }] }] },
      { useOrcid: true, credentials: { orcidClientId: 'c', orcidClientSecret: 's' } },
    );
    // markUnanchoredAbstain nulls the non-recent stale email rather than trusting it.
    expect(out.contactEnrichment.email).toBeNull();
    expect(out.contactEnrichment.contactStatus).toBeTruthy();
  });
});

describe('Tier 3 — Claude web search', () => {
  beforeEach(() => {
    stubFinalizeDeps();
    jest.spyOn(ContactParser, 'extractPrimaryEmail').mockReturnValue(null);
  });
  const baseOpts = { usePubmed: false, useOrcid: false, useClaudeSearch: true, credentials: { claudeApiKey: 'k' } };

  test('found: email/facultyPage/website captured', async () => {
    jest.spyOn(ContactEnrichmentService, 'claudeWebSearch').mockResolvedValue({
      email: 'claude@mit.edu', facultyPageUrl: 'https://mit.edu/~x', website: 'https://mit.edu/~x',
    });
    jest.spyOn(ContactParser, 'isDocumentUrl').mockReturnValue(false);
    jest.spyOn(ContactParser, 'isUsefulWebsiteUrl').mockReturnValue(true);
    const out = await ContactEnrichmentService.enrichCandidate(
      { name: 'Dr. Claude', affiliation: 'Example University', publications: [] }, baseOpts,
    );
    expect(out.contactEnrichment.email).toBe('claude@mit.edu');
    expect(out.contactEnrichment.emailSource).toBe('claude_search');
    expect(out.contactEnrichment.facultyPageUrl).toBe('https://mit.edu/~x');
  });

  test('contradicts anchor -> discarded, rejectedReason stamped, falls through', async () => {
    jest.spyOn(ContactEnrichmentService, 'claudeWebSearch').mockResolvedValue({
      email: 'wrong@other.edu', affiliation: 'Totally Different College',
    });
    const out = await ContactEnrichmentService.enrichCandidate(
      { name: 'Dr. Contra', affiliation: 'Example University', publications: [] }, baseOpts,
    );
    expect(out.contactEnrichment.tierResults.claude_search.rejectedReason).toBe('identity_anchor_contradiction');
    expect(out.contactEnrichment.email).toBeNull();
  });

  test('name-mismatch rejected email is recorded via emailRejectedReason', async () => {
    jest.spyOn(ContactEnrichmentService, 'claudeWebSearch').mockResolvedValue({
      email: null, emailRejectedReason: 'name_mismatch',
    });
    const out = await ContactEnrichmentService.enrichCandidate(
      { name: 'Dr. NameMismatch', affiliation: 'Example University', publications: [] }, baseOpts,
    );
    expect(out.contactEnrichment.tierResults.claude_search.emailRejectedReason).toBe('name_mismatch');
  });

  test('non-abort error is swallowed (per-tier error, search continues)', async () => {
    jest.spyOn(ContactEnrichmentService, 'claudeWebSearch').mockRejectedValue(new Error('network blip'));
    const out = await ContactEnrichmentService.enrichCandidate(
      { name: 'Dr. Blip', affiliation: 'Example University', publications: [] }, baseOpts,
    );
    expect(out.contactEnrichment.tierResults.claude_search).toEqual({ error: 'network blip' });
    expect(out.contactEnrichment.email).toBeNull();
  });

  test('abort DOES rethrow instead of finalizing (does not become a tier error)', async () => {
    const controller = new AbortController();
    controller.abort(Object.assign(new Error('reviewer_time_budget_exceeded'), { code: 'reviewer_time_budget_exceeded' }));
    jest.spyOn(ContactEnrichmentService, 'claudeWebSearch').mockRejectedValue(
      Object.assign(new Error('reviewer_time_budget_exceeded'), { code: 'reviewer_time_budget_exceeded' }),
    );
    await expect(
      ContactEnrichmentService.enrichCandidate(
        { name: 'Dr. Abort', affiliation: 'Example University', publications: [] },
        { ...baseOpts, signal: controller.signal },
      ),
    ).rejects.toThrow(/reviewer_time_budget_exceeded/);
  });

  test('skipped when no identity anchor', async () => {
    const claudeSpy = jest.spyOn(ContactEnrichmentService, 'claudeWebSearch');
    const out = await ContactEnrichmentService.enrichCandidate(
      { name: 'Dr. Bare', publications: [] }, baseOpts,
    );
    expect(claudeSpy).not.toHaveBeenCalled();
    expect(out.contactEnrichment.contactStatus).toBeTruthy();
  });

  test('skipped when no Claude API key', async () => {
    const claudeSpy = jest.spyOn(ContactEnrichmentService, 'claudeWebSearch');
    const out = await ContactEnrichmentService.enrichCandidate(
      { name: 'Dr. NoKey', affiliation: 'Example University', publications: [] },
      { ...baseOpts, credentials: {} },
    );
    expect(claudeSpy).not.toHaveBeenCalled();
    expect(out.contactEnrichment).toBeTruthy();
  });

  test('skipped entirely (useClaudeSearch=false) when email already found and recent', async () => {
    jest.spyOn(ContactParser, 'extractPrimaryEmail').mockReturnValue('early@example.edu');
    const claudeSpy = jest.spyOn(ContactEnrichmentService, 'claudeWebSearch');
    const out = await ContactEnrichmentService.enrichCandidate(
      { name: 'Dr. Early', affiliation: 'MIT (has email)', publications: [] }, baseOpts,
    );
    // Tier 0 finalizes before Tier 3 is ever reached.
    expect(claudeSpy).not.toHaveBeenCalled();
    expect(out.contactEnrichment.emailSource).toBe('affiliation');
  });
});

describe('Tier 4 — SerpAPI Google search', () => {
  beforeEach(() => {
    stubFinalizeDeps();
    jest.spyOn(ContactParser, 'extractPrimaryEmail').mockReturnValue(null);
  });
  const baseOpts = { usePubmed: false, useOrcid: false, useSerpSearch: true, credentials: { serpApiKey: 'k' } };

  test('found: email/facultyPage/website captured', async () => {
    jest.spyOn(SerpContactService, 'findContact').mockResolvedValue({
      email: 'serp@mit.edu', facultyPageUrl: 'https://mit.edu/~y', website: 'https://mit.edu/~y',
    });
    jest.spyOn(ContactParser, 'isNameConsistentEmail').mockReturnValue(true);
    jest.spyOn(ContactParser, 'isUsefulWebsiteUrl').mockReturnValue(true);
    const out = await ContactEnrichmentService.enrichCandidate(
      { name: 'Dr. Serp', affiliation: 'Example University', publications: [] }, baseOpts,
    );
    expect(out.contactEnrichment.email).toBe('serp@mit.edu');
    expect(out.contactEnrichment.emailSource).toBe('serp_search');
  });

  test('contradicts anchor -> discarded, rejectedReason stamped', async () => {
    jest.spyOn(SerpContactService, 'findContact').mockResolvedValue({
      email: 'wrong@other.edu', institution: 'Totally Different College',
    });
    const out = await ContactEnrichmentService.enrichCandidate(
      { name: 'Dr. SerpContra', affiliation: 'Example University', publications: [] }, baseOpts,
    );
    expect(out.contactEnrichment.tierResults.serp_search.rejectedReason).toBe('identity_anchor_contradiction');
    expect(out.contactEnrichment.email).toBeNull();
  });

  test('name-mismatch email is nulled + rejectedEmail preserved for the lead', async () => {
    jest.spyOn(SerpContactService, 'findContact').mockResolvedValue({ email: 'wrong-person@mit.edu' });
    jest.spyOn(ContactParser, 'isNameConsistentEmail').mockReturnValue(false);
    const out = await ContactEnrichmentService.enrichCandidate(
      { name: 'Dr. SerpMismatch', affiliation: 'Example University', publications: [] }, baseOpts,
    );
    expect(out.contactEnrichment.tierResults.serp_search.emailRejectedReason).toBe('name_mismatch');
    expect(out.contactEnrichment.tierResults.serp_search.rejectedEmail).toBe('wrong-person@mit.edu');
    expect(out.contactEnrichment.email).toBeNull();
  });

  test('error is swallowed even without an abort signal (Tier 4 never rethrows)', async () => {
    jest.spyOn(SerpContactService, 'findContact').mockRejectedValue(new Error('serp down'));
    const out = await ContactEnrichmentService.enrichCandidate(
      { name: 'Dr. SerpErr', affiliation: 'Example University', publications: [] }, baseOpts,
    );
    expect(out.contactEnrichment.tierResults.serp_search).toEqual({ error: 'serp down' });
  });

  test('error is swallowed even WITH a fired abort signal (asymmetric vs. Tier 3)', async () => {
    const controller = new AbortController();
    controller.abort(new Error('reviewer_time_budget_exceeded'));
    jest.spyOn(SerpContactService, 'findContact').mockRejectedValue(new Error('serp down'));
    const out = await ContactEnrichmentService.enrichCandidate(
      { name: 'Dr. SerpErrAbort', affiliation: 'Example University', publications: [] },
      { ...baseOpts, signal: controller.signal },
    );
    expect(out.contactEnrichment.tierResults.serp_search).toEqual({ error: 'serp down' });
  });

  test('skipped when no identity anchor', async () => {
    const serpSpy = jest.spyOn(SerpContactService, 'findContact');
    const out = await ContactEnrichmentService.enrichCandidate(
      { name: 'Dr. SerpBare', publications: [] }, baseOpts,
    );
    expect(serpSpy).not.toHaveBeenCalled();
    expect(out.contactEnrichment).toBeTruthy();
  });

  test('skipped when no SerpAPI key', async () => {
    const serpSpy = jest.spyOn(SerpContactService, 'findContact');
    const out = await ContactEnrichmentService.enrichCandidate(
      { name: 'Dr. SerpNoKey', affiliation: 'Example University', publications: [] },
      { ...baseOpts, credentials: {} },
    );
    expect(serpSpy).not.toHaveBeenCalled();
  });

  test('skipped when an email already exists (any email, not just recent)', async () => {
    jest.spyOn(ORCIDService, 'findContact').mockResolvedValue({
      status: 'resolved', orcidId: '0000-9', email: 'orcid@mit.edu',
    });
    const serpSpy = jest.spyOn(SerpContactService, 'findContact');
    const out = await ContactEnrichmentService.enrichCandidate(
      { name: 'Dr. HasEmail', affiliation: 'Example University', publications: [] },
      { ...baseOpts, useOrcid: true, credentials: { serpApiKey: 'k', orcidClientId: 'c', orcidClientSecret: 's' } },
    );
    expect(serpSpy).not.toHaveBeenCalled();
    expect(out.contactEnrichment.email).toBe('orcid@mit.edu');
  });
});

describe('_finalize — step order (C12) + arg fidelity (C9)', () => {
  beforeEach(() => {
    jest.spyOn(ContactEnrichmentService, 'saveToDatabase').mockResolvedValue(undefined);
  });

  test('early-return (Tier 0) passes the DEFAULT scholarCandidate (=== candidate)', async () => {
    const metricsSpy = jest.spyOn(openAlexMetrics, 'attachOpenAlexMetrics').mockResolvedValue(undefined);
    const candidate = { name: 'Dr. ArgFidelity0', affiliation: 'Dept. Electronic address: af0@example.edu', publications: [] };
    await ContactEnrichmentService.enrichCandidate(candidate, {});
    expect(metricsSpy).toHaveBeenCalledTimes(1);
    expect(metricsSpy.mock.calls[0][0]).toBe(candidate);
  });

  test('final catch-all passes scholarCandidate: searchCandidate (distinct object identity)', async () => {
    jest.spyOn(OpenAlexService, 'getAuthorByOrcid').mockResolvedValue(null);
    jest.spyOn(OpenAlexService, 'getRichestAuthorByOrcid').mockResolvedValue(null);
    jest.spyOn(OpenAlexService, 'getAuthorById').mockResolvedValue(null);
    jest.spyOn(OpenAlexService, 'getInstitution').mockResolvedValue(null);
    const metricsSpy = jest.spyOn(openAlexMetrics, 'attachOpenAlexMetrics').mockResolvedValue(undefined);
    const candidate = { name: 'Dr. ArgFidelityFinal', affiliation: 'Plain Affiliation No Email', publications: [] };
    await ContactEnrichmentService.enrichCandidate(candidate, { usePubmed: false, useOrcid: false });
    expect(metricsSpy).toHaveBeenCalledTimes(1);
    // effectiveInstitution derives from candidate.affiliation -> searchCandidate is a
    // NEW `{...candidate, affiliation: institution}` object, not the candidate reference.
    expect(metricsSpy.mock.calls[0][0]).not.toBe(candidate);
    expect(metricsSpy.mock.calls[0][0].affiliation).toBe('Plain Affiliation No Email');
  });

  test('runs the fixed step sequence: metrics -> domain evidence -> page email -> ' +
    'domain validation -> readjudicate -> collect leads -> affiliation override -> persist ' +
    '(identity resolution is pinned via a value check, not a spy — see note below)', async () => {
    // NOTE: `resolveIdentity`/`evidenceFromEnrichment`/`mayPersistIdentity` are destructured
    // (`const { resolveIdentity } = require(...)`) at the top of contact-enrichment-service.js,
    // so a jest.spyOn on the required module object does NOT intercept the facade's already-bound
    // local reference. Rather than build a fragile jest.mock() workaround, this test instead lets
    // the REAL resolveIdentity run and proves it executed BETWEEN the metrics and domain-evidence
    // steps by asserting `result.contactEnrichment.identity` is already populated by the time the
    // domain-evidence step fires — a value-based order proof that survives the extraction (Stage 9
    // switches tiers.js to namespaced `identityResolver.resolveIdentity(...)` calls, which a spy
    // COULD intercept, but the value check remains valid either way so it is kept as the single
    // source of truth for this step's position).
    const order = [];
    const wrap = (obj, method, tag, onCall) => jest.spyOn(obj, method).mockImplementation((...args) => {
      order.push(tag);
      if (onCall) onCall(...args);
      return undefined;
    });

    wrap(openAlexMetrics, 'attachOpenAlexMetrics', 'metrics');
    wrap(domainEvidence, 'buildInstitutionDomainEvidence', 'domain-evidence', (candidate, result) => {
      expect(result.contactEnrichment.identity).toBeTruthy();
    });
    wrap(pageEmail, 'attachEmailFromResolvedPage', 'page-email');
    wrap(emailAdjudication, 'validateEmailAgainstVerifiedDomain', 'validate-domain');
    wrap(emailAdjudication, 'readjudicateNameMismatchRejectedEmail', 'readjudicate');
    wrap(emailAdjudication, 'collectContactLeads', 'collect-leads');
    wrap(ContactEnrichmentService, '_applyAffiliationOverride', 'affiliation-override');
    jest.spyOn(ContactEnrichmentService, 'saveToDatabase').mockImplementation(async () => { order.push('persist'); });

    const candidate = { name: 'Dr. Order', affiliation: 'Order University', publications: [] };
    await ContactEnrichmentService.enrichCandidate(candidate, { usePubmed: false, useOrcid: false });

    expect(order).toEqual([
      'metrics', 'domain-evidence', 'page-email',
      'validate-domain', 'readjudicate', 'collect-leads', 'affiliation-override', 'persist',
    ]);
  });
});
