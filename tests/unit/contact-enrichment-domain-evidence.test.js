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

  describe('_strongInstitutionDisplayMatch', () => {
    it('matches on normalized equality/inclusion, false otherwise', () => {
      expect(S._strongInstitutionDisplayMatch('MIT', 'mit')).toBe(true);
      expect(S._strongInstitutionDisplayMatch('MIT', 'Harvard')).toBe(false);
      expect(S._strongInstitutionDisplayMatch('', 'x')).toBe(false);
    });
  });
});
