/**
 * @jest-environment node
 *
 * Slice 2a — quarantined contact leads (docs/REVIEWER_CONTACT_LEADS_SPEC.md §6).
 * Surfaces already-fetched-but-discarded contacts (anchor/name/domain rejects)
 * and faculty pages found without an email as `contactEnrichment.contactLeads`,
 * with NO new network calls. Locks the safety invariant: a lead is NEVER a
 * sendable/persistable contact and never flips a *_PersistAllowed flag.
 */

const { ContactEnrichmentService } = require('../../lib/services/contact-enrichment-service');

describe('_addContactLead — quarantine guarantee', () => {
  test('force-sets persistable:false even if the caller passes true', () => {
    const ce = { contactLeads: [] };
    ContactEnrichmentService._addContactLead(ce, { type: 'email', value: 'a@b.edu', persistable: true });
    expect(ce.contactLeads).toHaveLength(1);
    expect(ce.contactLeads[0].persistable).toBe(false);
  });

  test('normalizes shape and defaults', () => {
    const ce = { contactLeads: [] };
    ContactEnrichmentService._addContactLead(ce, { value: 'a@b.edu' });
    expect(ce.contactLeads[0]).toMatchObject({
      type: 'email', value: 'a@b.edu', confidence: 'low', persistable: false,
      rejectedReason: null, warnings: [], evidence: {},
    });
  });

  test('dedups by (type, value, source) and ignores empty value', () => {
    const ce = { contactLeads: [] };
    ContactEnrichmentService._addContactLead(ce, { type: 'email', value: 'a@b.edu', source: 'serp_search' });
    ContactEnrichmentService._addContactLead(ce, { type: 'email', value: 'a@b.edu', source: 'serp_search' });
    ContactEnrichmentService._addContactLead(ce, { value: '   ' });
    expect(ce.contactLeads).toHaveLength(1);
  });
});

describe('_validateEmailAgainstVerifiedDomain — withheld_by_gate capture', () => {
  test('captures the wrong-domain email + page as rejected leads before nulling', () => {
    const ce = {
      email: 'someone@ifmo.ru', emailSource: 'serp_search', emailPersistAllowed: true,
      website: null, websiteSource: null, facultyPageUrl: 'https://ifmo.ru/people/someone',
      websitePersistAllowed: true, verifiedInstitutionDomain: 'mbi-berlin.de', contactLeads: [],
    };
    ContactEnrichmentService._validateEmailAgainstVerifiedDomain(ce);
    // existing behavior preserved: email dropped, persist flags off
    expect(ce.email).toBeNull();
    expect(ce.emailPersistAllowed).toBe(false);
    expect(ce.contactStatusReason).toBe('verified_domain_contradiction');
    // new: quarantined leads
    const emailLead = ce.contactLeads.find((l) => l.type === 'email');
    expect(emailLead).toMatchObject({ value: 'someone@ifmo.ru', confidence: 'rejected', rejectedReason: 'verified_domain_contradiction', persistable: false });
    expect(ce.contactLeads.find((l) => l.type === 'faculty_page')).toBeTruthy();
  });

  test('a domain-MATCHED email is NOT turned into a lead (stays the primary contact)', () => {
    const ce = { email: 'olga.smirnova@mbi-berlin.de', emailSource: 'serp_search', verifiedInstitutionDomain: 'mbi-berlin.de', contactLeads: [] };
    ContactEnrichmentService._validateEmailAgainstVerifiedDomain(ce);
    expect(ce.email).toBe('olga.smirnova@mbi-berlin.de');
    expect(ce.emailPersistAllowed).toBe(true);
    expect(ce.contactLeads).toHaveLength(0);
  });

  test('an ORCID/PubMed email is never dropped or leaded on a domain mismatch', () => {
    const ce = { email: 'x@personal.com', emailSource: 'orcid', verifiedInstitutionDomain: 'mit.edu', contactLeads: [] };
    ContactEnrichmentService._validateEmailAgainstVerifiedDomain(ce);
    expect(ce.email).toBe('x@personal.com');
    expect(ce.contactLeads).toHaveLength(0);
  });
});

describe('_collectContactLeads — tier discards + faculty page', () => {
  test('anchor-contradiction surfaces email/page/website as rejected leads', () => {
    const ce = {
      email: null, contactLeads: [],
      tierResults: { claude_search: { email: 'wrong@x.edu', facultyPageUrl: 'https://x.edu/p', website: 'https://lab.x.edu', rejectedReason: 'identity_anchor_contradiction' } },
    };
    ContactEnrichmentService._collectContactLeads(ce);
    expect(ce.contactLeads).toHaveLength(3);
    expect(ce.contactLeads.every((l) => l.confidence === 'rejected' && l.rejectedReason === 'identity_anchor_contradiction' && l.persistable === false)).toBe(true);
    expect(ce.contactLeads.map((l) => l.type).sort()).toEqual(['email', 'faculty_page', 'website']);
  });

  test('serp name-mismatch surfaces the preserved rejectedEmail as a rejected lead', () => {
    const ce = { email: null, contactLeads: [], tierResults: { serp_search: { emailRejectedReason: 'name_mismatch', rejectedEmail: 'someoneelse@x.edu' } } };
    ContactEnrichmentService._collectContactLeads(ce);
    expect(ce.contactLeads).toEqual([
      expect.objectContaining({ type: 'email', value: 'someoneelse@x.edu', source: 'serp_search', confidence: 'rejected', rejectedReason: 'name_mismatch', persistable: false }),
    ]);
  });

  test('claude name-mismatch surfaces the preserved rejectedEmail', () => {
    const ce = { email: null, contactLeads: [], tierResults: { claude_search: { emailRejectedReason: 'name_mismatch', rejectedEmail: 'nope@x.edu' } } };
    ContactEnrichmentService._collectContactLeads(ce);
    expect(ce.contactLeads).toHaveLength(1);
    expect(ce.contactLeads[0]).toMatchObject({ value: 'nope@x.edu', source: 'claude_search', rejectedReason: 'name_mismatch' });
  });

  test('faculty page found with no email becomes a low-confidence lead', () => {
    const ce = { email: null, facultyPageUrl: 'https://u.edu/~prof', website: null, websiteSource: 'serp_search', contactLeads: [], tierResults: {} };
    ContactEnrichmentService._collectContactLeads(ce);
    expect(ce.contactLeads).toEqual([
      expect.objectContaining({ type: 'faculty_page', value: 'https://u.edu/~prof', confidence: 'low', persistable: false }),
    ]);
  });

  test('a page is NOT leaded when a usable email is present (no duplication of the shown contact)', () => {
    const ce = { email: 'prof@u.edu', facultyPageUrl: 'https://u.edu/~prof', contactLeads: [], tierResults: {} };
    ContactEnrichmentService._collectContactLeads(ce);
    expect(ce.contactLeads).toHaveLength(0);
  });

  test('leads never flip persist flags', () => {
    const ce = { email: null, emailPersistAllowed: false, websitePersistAllowed: false, facultyPageUrl: 'https://u.edu/~p', contactLeads: [], tierResults: {} };
    ContactEnrichmentService._collectContactLeads(ce);
    expect(ce.emailPersistAllowed).toBe(false);
    expect(ce.websitePersistAllowed).toBe(false);
  });
});
