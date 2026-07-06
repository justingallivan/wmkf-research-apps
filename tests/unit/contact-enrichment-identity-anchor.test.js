/**
 * Characterization suite for the identity-anchor cluster of ContactEnrichmentService
 * (Stage 1 of docs/CONTACT_ENRICHMENT_SERVICE_DECOMPOSITION_PLAN.md).
 *
 * These 8 static methods had NO direct unit coverage before the decomposition
 * (only transitive coverage via enrichCandidate). This suite pins their exact
 * current behavior so the Stage-1 extraction to lib/services/contact-enrichment/
 * identity-anchor.js is a verified behavior-freeze. Baselined green against the
 * pre-extraction facade, then mutation-proven to discriminate.
 */

const ORCID = require('../../lib/services/orcid-service');

const { ContactEnrichmentService: S } = require('../../lib/services/contact-enrichment-service');

describe('ContactEnrichmentService identity-anchor cluster (characterization)', () => {
  describe('_identityAnchorForCandidate', () => {
    it('returns { orcid, institution } from orcid + affiliation', () => {
      expect(S._identityAnchorForCandidate({ orcid: '0000-0002-1825-0097', affiliation: 'MIT' }))
        .toEqual({ orcid: '0000-0002-1825-0097', institution: 'MIT' });
    });
    it('normalizes an ORCID URL to the bare id', () => {
      expect(S._identityAnchorForCandidate({ orcidId: 'https://orcid.org/0000-0002-1825-0097' }))
        .toEqual({ orcid: '0000-0002-1825-0097', institution: null });
    });
    it('reads orcid from contactEnrichment.orcidId as a fallback', () => {
      expect(S._identityAnchorForCandidate({ contactEnrichment: { orcidId: '0000-0002-1825-0097' }, institution: 'Yale' }))
        .toEqual({ orcid: '0000-0002-1825-0097', institution: 'Yale' });
    });
    it('returns null with no resolvable orcid', () => {
      expect(S._identityAnchorForCandidate({ affiliation: 'MIT' })).toBeNull();
      expect(S._identityAnchorForCandidate({ orcid: 'not-an-orcid' })).toBeNull();
      expect(S._identityAnchorForCandidate()).toBeNull();
    });
    it('prefers affiliation, then institution, then primaryAffiliation for institution', () => {
      expect(S._identityAnchorForCandidate({ orcid: '0000-0002-1825-0097', primaryAffiliation: 'PA' }).institution).toBe('PA');
      expect(S._identityAnchorForCandidate({ orcid: '0000-0002-1825-0097', institution: 'I', primaryAffiliation: 'PA' }).institution).toBe('I');
    });
  });

  describe('_cleanInstitution', () => {
    it('trims a non-empty string', () => { expect(S._cleanInstitution('  Harvard ')).toBe('Harvard'); });
    it('returns null for blank/whitespace/non-strings', () => {
      expect(S._cleanInstitution('   ')).toBeNull();
      expect(S._cleanInstitution('')).toBeNull();
      expect(S._cleanInstitution(5)).toBeNull();
      expect(S._cleanInstitution(null)).toBeNull();
      expect(S._cleanInstitution(undefined)).toBeNull();
    });
  });

  describe('_effectiveInstitution', () => {
    it('prefers orcidAffiliation (cleaned) over candidate fields', () => {
      expect(S._effectiveInstitution({ institution: 'Yale' }, { orcidAffiliation: '  Stanford ' })).toBe('Stanford');
    });
    it('falls through orcidAffiliation → affiliation → institution → primaryAffiliation', () => {
      expect(S._effectiveInstitution({ affiliation: 'A' }, {})).toBe('A');
      expect(S._effectiveInstitution({ institution: 'I' }, {})).toBe('I');
      expect(S._effectiveInstitution({ primaryAffiliation: 'PA' }, {})).toBe('PA');
    });
    it('returns null when nothing resolvable', () => {
      expect(S._effectiveInstitution({}, {})).toBeNull();
      expect(S._effectiveInstitution()).toBeNull();
    });
  });

  describe('_searchCandidateWithInstitution', () => {
    it('overrides affiliation with the given institution (immutably)', () => {
      const c = { name: 'A', affiliation: 'X' };
      expect(S._searchCandidateWithInstitution(c, 'Y')).toEqual({ name: 'A', affiliation: 'Y' });
      expect(c.affiliation).toBe('X'); // original untouched
    });
    it('returns the candidate unchanged when institution is falsy', () => {
      const c = { name: 'A', affiliation: 'X' };
      expect(S._searchCandidateWithInstitution(c, null)).toBe(c);
    });
  });

  describe('_anchorWithInstitution', () => {
    it('merges institution onto the anchor', () => {
      expect(S._anchorWithInstitution({ orcid: 'z' }, 'Inst')).toEqual({ orcid: 'z', institution: 'Inst' });
    });
    it('keeps the anchor institution when none passed', () => {
      expect(S._anchorWithInstitution({ orcid: 'z', institution: 'Old' }, null)).toEqual({ orcid: 'z', institution: 'Old' });
    });
    it('returns null when both anchor and institution are falsy', () => {
      expect(S._anchorWithInstitution(null, null)).toBeNull();
    });
    it('builds an anchor from institution alone', () => {
      expect(S._anchorWithInstitution(null, 'Inst')).toEqual({ institution: 'Inst' });
    });
  });

  describe('_hasOrcidAnchor', () => {
    it('is true for a normalizable orcid on candidate or enrichment', () => {
      expect(S._hasOrcidAnchor({ orcidId: '0000-0002-1825-0097' })).toBe(true);
      expect(S._hasOrcidAnchor({}, { orcidId: '0000-0002-1825-0097' })).toBe(true);
    });
    it('is false with no orcid', () => {
      expect(S._hasOrcidAnchor({}, {})).toBe(false);
      expect(S._hasOrcidAnchor({ orcid: 'junk' })).toBe(false);
    });
  });

  describe('_markUnanchoredAbstain', () => {
    it('sets unresolved status and nulls all contact/scholar fields + persist flags', () => {
      const e = { email: 'a@b.com', emailSource: 'pubmed', hIndex: 5, website: 'w' };
      S._markUnanchoredAbstain(e);
      expect(e).toMatchObject({
        contactStatus: 'unresolved',
        contactStatusReason: 'identity_anchor_required',
        email: null, emailSource: null, website: null, websiteSource: null,
        facultyPageUrl: null, googleScholarId: null, googleScholarUrl: null,
        hIndex: null, i10Index: null, totalCitations: null,
        openAlexAffiliation: null, verifiedInstitutionDomain: null,
        emailPersistAllowed: false, websitePersistAllowed: false,
        affiliationPersistAllowed: false, scholarPersistAllowed: false,
      });
    });
  });

  describe('_getAnchoredOrcidProfile', () => {
    afterEach(() => jest.restoreAllMocks());

    it('maps a full ORCID profile', async () => {
      jest.spyOn(ORCID.ORCIDService, 'getProfile').mockResolvedValue({
        orcidId: '0000-0002-1825-0097',
        orcidUrl: 'https://orcid.org/0000-0002-1825-0097',
        creditName: 'Jane Q Researcher',
        primaryEmail: 'jane@uni.edu',
        primaryUrl: 'https://uni.edu/jane',
        currentAffiliation: 'Uni',
        affiliations: [{ org: 'Uni' }],
      });
      const r = await S._getAnchoredOrcidProfile('0000-0002-1825-0097', {});
      expect(r).toMatchObject({
        status: 'resolved', orcidId: '0000-0002-1825-0097', name: 'Jane Q Researcher',
        email: 'jane@uni.edu', website: 'https://uni.edu/jane', affiliation: 'Uni',
        institutionCorroborated: false, matchedInstitution: null,
        source: 'orcid_anchor', identityStatus: 'probable',
      });
    });

    it('returns a minimal resolved anchor when the profile is null', async () => {
      jest.spyOn(ORCID.ORCIDService, 'getProfile').mockResolvedValue(null);
      const r = await S._getAnchoredOrcidProfile('0000-0002-1825-0097', {});
      expect(r).toEqual({
        status: 'resolved', orcidId: '0000-0002-1825-0097',
        orcidUrl: 'https://orcid.org/0000-0002-1825-0097', name: null,
        source: 'orcid_anchor', identityStatus: 'probable',
      });
    });

    it('composes name from givenNames/familyName when creditName is absent', async () => {
      jest.spyOn(ORCID.ORCIDService, 'getProfile').mockResolvedValue({
        orcidId: 'x', orcidUrl: 'u', givenNames: 'Jane', familyName: 'Doe',
      });
      const r = await S._getAnchoredOrcidProfile('x', {});
      expect(r.name).toBe('Jane Doe');
    });
  });
});
