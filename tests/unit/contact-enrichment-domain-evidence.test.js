/**
 * Characterization suite for the domain-evidence cluster of ContactEnrichmentService
 * (Stage 2 of docs/CONTACT_ENRICHMENT_SERVICE_DECOMPOSITION_PLAN.md).
 *
 * Pins the 10 pure domain/institution helpers that had no direct unit coverage
 * before the decomposition (the async `_buildInstitutionDomainEvidence` is already
 * covered by contact-leads-slice2a). Baselined green pre-extraction, mutation-proven,
 * so the Stage-2 move to lib/services/contact-enrichment/domain-evidence.js is a
 * verified behavior-freeze.
 */

const { ContactEnrichmentService: S } = require('../../lib/services/contact-enrichment-service');
const { OpenAlexService } = require('../../lib/services/openalex-service');
const { projectInstitutionDomainsEvidence } = require('../../lib/services/workbench/reviewer-stage-producers/institution-domains');

afterEach(() => jest.restoreAllMocks());

describe('ContactEnrichmentService domain-evidence cluster (characterization)', () => {
  describe('_normalizeDomain', () => {
    it('extracts host, lowercases, strips hyphens (Scholar hint quirk)', () => {
      expect(S._normalizeDomain('https://Sub.MBI-Berlin.de/x')).toBe('sub.mbiberlin.de');
    });
    it('returns null for non-domains and falsy', () => {
      expect(S._normalizeDomain('nope')).toBeNull();
      expect(S._normalizeDomain(null)).toBeNull();
      expect(S._normalizeDomain('')).toBeNull();
    });
  });

  describe('_emailDomain', () => {
    it('normalizes the domain part of an email', () => { expect(S._emailDomain('a@Foo.Edu')).toBe('foo.edu'); });
    it('returns null without an @', () => { expect(S._emailDomain('noat')).toBeNull(); expect(S._emailDomain(null)).toBeNull(); });
  });

  describe('_domainRelated', () => {
    it('treats hyphen-stripped equal domains as related', () => { expect(S._domainRelated('mbi-berlin.de', 'mbiberlin.de')).toBe(true); });
    it('treats subdomain as related to parent', () => { expect(S._domainRelated('cs.mit.edu', 'mit.edu')).toBe(true); });
    it('unrelated domains are false; null-normalizing input is false', () => {
      expect(S._domainRelated('a.com', 'b.com')).toBe(false);
      expect(S._domainRelated('nope', 'mit.edu')).toBe(false);
    });
  });

  describe('_emailDomainRelatedToAny', () => {
    it('is true when the email domain relates to any candidate domain', () => {
      expect(S._emailDomainRelatedToAny('x@mit.edu', ['harvard.edu', 'mit.edu'])).toBe(true);
    });
    it('is false when it relates to none, or the email has no domain', () => {
      expect(S._emailDomainRelatedToAny('x@x.com', ['mit.edu'])).toBe(false);
      expect(S._emailDomainRelatedToAny('noat', ['mit.edu'])).toBe(false);
    });
  });

  describe('_institutionTokens', () => {
    it('keeps tokens ≥4 chars, drops stopwords (department/university/…)', () => {
      expect(S._institutionTokens('Department of Biology, Harvard University')).toEqual(['biology', 'harvard']);
    });
    it('short tokens like "MIT" (<4 chars) produce no tokens', () => {
      expect(S._institutionTokens('MIT')).toEqual([]);
    });
  });

  describe('_institutionsContradict', () => {
    it('is false when either side yields no comparable tokens (e.g. "MIT")', () => {
      expect(S._institutionsContradict('Harvard University', 'MIT')).toBe(false);
    });
    it('is false when they share a token', () => {
      expect(S._institutionsContradict('Harvard University', 'Harvard Medical')).toBe(false);
    });
    it('is true when both tokenize and share nothing', () => {
      expect(S._institutionsContradict('Harvard University', 'Stanford College')).toBe(true);
    });
    it('is false when either institution is missing', () => {
      expect(S._institutionsContradict(null, 'Harvard')).toBe(false);
    });
  });

  describe('_resultContradictsAnchor', () => {
    it('is true when a differing normalized ORCID conflicts with the anchor', () => {
      expect(S._resultContradictsAnchor({ orcidId: '0000-0002-1825-0097' }, { orcid: '0000-0002-0000-0000', institution: 'X' })).toBe(true);
    });
    it('falls back to institution contradiction (false when result yields no tokens)', () => {
      expect(S._resultContradictsAnchor({ affiliation: 'MIT' }, { institution: 'Harvard University' })).toBe(false);
    });
    it('is false with no anchor', () => {
      expect(S._resultContradictsAnchor({ affiliation: 'MIT' }, null)).toBe(false);
    });
  });

  describe('_addInstitutionDomain', () => {
    it('adds a trimmed lowercased dotted domain; ignores non-dotted/falsy', () => {
      const set = new Set();
      S._addInstitutionDomain(set, '  Foo.EDU ');
      S._addInstitutionDomain(set, 'nodot');
      S._addInstitutionDomain(set, null);
      expect([...set]).toEqual(['foo.edu']);
    });
  });

  describe('_currentOrcidInstitutionRefs', () => {
    it('returns only current affiliations with an id and ROR source (case-insensitive)', () => {
      const ce = { tierResults: { orcid: { affiliations: [
        { current: true, disambiguatedOrganizationId: 'R1', disambiguationSource: 'ror' },
        { current: false, disambiguatedOrganizationId: 'R2', disambiguationSource: 'ROR' },
      ] } } };
      expect(S._currentOrcidInstitutionRefs(ce)).toEqual([{ id: 'R1', source: 'ror' }]);
    });
    it('returns [] when affiliations are absent/not an array', () => {
      expect(S._currentOrcidInstitutionRefs({})).toEqual([]);
    });
  });

  describe('_currentOrcidInstitutionNames', () => {
    it('returns every unique current ORCID employment, including non-ROR affiliations', () => {
      const ce = { tierResults: { orcid: { affiliations: [
        { current: true, organization: 'Ames Laboratory', disambiguationSource: 'RINGGOLD' },
        { current: true, organization: 'Iowa State University' },
        { current: false, organization: 'Former University' },
        { current: true, organization: 'Iowa State University' },
      ] } } };
      expect(S._currentOrcidInstitutionNames(ce))
        .toEqual(['Ames Laboratory', 'Iowa State University']);
    });
  });

  describe('_strongInstitutionDisplayMatch', () => {
    it('matches on normalized equality/inclusion, false otherwise', () => {
      expect(S._strongInstitutionDisplayMatch('MIT', 'mit')).toBe(true);
      expect(S._strongInstitutionDisplayMatch('MIT', 'Harvard')).toBe(false);
      expect(S._strongInstitutionDisplayMatch('', 'x')).toBe(false);
    });
  });

  describe('_buildInstitutionDomainEvidence', () => {
    it('anchors every strongly resolved current ORCID co-affiliation', async () => {
      jest.spyOn(OpenAlexService, 'searchInstitutions').mockImplementation(async (name) => {
        if (name === 'Iowa State University') {
          return [{ displayName: 'Iowa State University', domain: 'iastate.edu' }];
        }
        if (name === 'University of Saskatchewan') {
          return [{ displayName: 'University of Saskatchewan', domain: 'usask.ca' }];
        }
        return [{ displayName: 'Ames National Laboratory', domain: 'ameslab.gov' }];
      });
      const result = {
        contactEnrichment: {
          identity: { status: 'probable' },
          verifiedInstitutionDomain: 'usask.ca',
          orcidAffiliation: 'Ames Laboratory',
          openAlexAffiliation: 'University of Saskatchewan',
          tierResults: {
            orcid: {
              affiliations: [
                { current: true, organization: 'Ames Laboratory', disambiguationSource: 'RINGGOLD' },
                { current: true, organization: 'Iowa State University' },
              ],
            },
          },
        },
      };

      await S._buildInstitutionDomainEvidence(
        { affiliation: 'University of Saskatchewan' },
        result,
      );

      expect(result.contactEnrichment.anchoredInstitutionDomains)
        .toEqual(expect.arrayContaining(['usask.ca', 'iastate.edu']));
      expect(result.contactEnrichment.plausibleInstitutionDomains)
        .toEqual(expect.arrayContaining(['usask.ca', 'iastate.edu']));
      expect(OpenAlexService.searchInstitutions).toHaveBeenCalledTimes(3);
      expect(result.contactEnrichment.institutionDomainEvidence).toMatchObject({
        outcome: 'current',
        lookups: expect.arrayContaining([
          expect.objectContaining({ kind: 'name', key: 'Ames Laboratory', state: 'no_domain' }),
          expect.objectContaining({ kind: 'name', key: 'Iowa State University', state: 'resolved' }),
          expect.objectContaining({ kind: 'name', key: 'University of Saskatchewan', state: 'resolved' }),
        ]),
      });
    });

    it('records an existing failed lookup as incomplete without retrying it', async () => {
      const getInstitution = jest.spyOn(OpenAlexService, 'getInstitution')
        .mockRejectedValue(Object.assign(new Error('upstream unavailable'), { code: 'openalex_error' }));
      const searchInstitutions = jest.spyOn(OpenAlexService, 'searchInstitutions')
        .mockResolvedValue([{ displayName: 'Example University', domain: 'example.edu' }]);
      const result = {
        contactEnrichment: {
          identity: { status: 'probable' },
          tierResults: {
            orcid: {
              affiliations: [{
                current: true,
                organization: 'Example University',
                disambiguatedOrganizationId: 'https://ror.org/01abc1234',
                disambiguationSource: 'ROR',
              }],
            },
          },
        },
      };

      await S._buildInstitutionDomainEvidence({}, result);

      expect(getInstitution).toHaveBeenCalledTimes(1);
      expect(searchInstitutions).toHaveBeenCalledTimes(1);
      expect(result.contactEnrichment.institutionDomainEvidence).toMatchObject({
        outcome: 'incomplete',
        reasonCode: 'institution_lookup_failed',
        lookups: expect.arrayContaining([
          { kind: 'ror', key: 'https://ror.org/01abc1234', state: 'error' },
          { kind: 'name', key: 'Example University', state: 'resolved' },
        ]),
      });
    });

    it('seals a completed zero-domain lookup set as current', async () => {
      const searchInstitutions = jest.spyOn(OpenAlexService, 'searchInstitutions')
        .mockResolvedValue([{ displayName: 'Unrelated Organization', domain: 'elsewhere.example' }]);
      const result = {
        contactEnrichment: {
          identity: { status: 'probable' },
          openAlexAffiliation: 'No Domain Institute',
        },
      };

      await S._buildInstitutionDomainEvidence({}, result);

      expect(searchInstitutions).toHaveBeenCalledTimes(1);
      expect(result.contactEnrichment.institutionDomainEvidence).toEqual({
        outcome: 'current',
        reasonCode: 'no_trusted_domains',
        anchoredDomains: [],
        plausibleDomains: [],
        institutions: ['Unrelated Organization'],
        lookups: [{ kind: 'name', key: 'No Domain Institute', state: 'no_domain' }],
        lookupCount: 1,
        coverageTruncated: false,
      });
    });

    it('keeps the ninth batch lookup but closes the bounded receipt coverage', async () => {
      const names = [
        'Current One University',
        'Current Two University',
        'Current Three University',
        'Current Four University',
        'ORCID Affiliation University',
        'OpenAlex Affiliation University',
        'Candidate Affiliation University',
        'Candidate Institution University',
        'Candidate Primary University',
      ];
      const searchInstitutions = jest.spyOn(OpenAlexService, 'searchInstitutions')
        .mockImplementation(async (name) => {
          if (name === names[8]) throw Object.assign(new Error('late provider failure'), { code: 'openalex_error' });
          return [{ displayName: name, domain: null }];
        });
      const result = {
        contactEnrichment: {
          identity: { status: 'probable' },
          orcidAffiliation: names[4],
          openAlexAffiliation: names[5],
          tierResults: {
            orcid: {
              affiliations: names.slice(0, 4).map((organization) => ({ current: true, organization })),
            },
          },
        },
      };

      await S._buildInstitutionDomainEvidence({
        affiliation: names[6],
        institution: names[7],
        primaryAffiliation: names[8],
      }, result);

      expect(searchInstitutions).toHaveBeenCalledTimes(9);
      expect(result.contactEnrichment.institutionDomainEvidence).toMatchObject({
        outcome: 'incomplete',
        reasonCode: 'institution_lookup_failed',
        lookupCount: 9,
        coverageTruncated: true,
      });
      expect(result.contactEnrichment.institutionDomainEvidence.lookups).toHaveLength(9);
      expect(result.contactEnrichment.institutionDomainEvidence.lookups[8]).toEqual({
        kind: 'name', key: names[8], state: 'error',
      });
      expect(result.contactEnrichment.institutionDomainEvidence.lookups.every((lookup) => lookup.state !== 'started')).toBe(true);

      const domainEnvelope = projectInstitutionDomainsEvidence({
        candidate: {
          candidateKey: 'suggestion:33333333-3333-3333-3333-333333333333',
          contactEnrichment: result.contactEnrichment,
        },
        identityReceipt: { state: 'current', contractVersion: 4, resultVersion: 'a'.repeat(64) },
        identityEvidence: { status: 'probable' },
        identityResult: { status: 'probable' },
        domainResult: result.contactEnrichment.institutionDomainEvidence,
        expectedSourceVersion: 'b'.repeat(64),
        completedAt: '2026-08-02T12:00:00.000Z',
      });
      expect(domainEnvelope).toMatchObject({
        outcome: 'incomplete',
        receipt: { state: 'incomplete' },
      });
    });
  });
});
