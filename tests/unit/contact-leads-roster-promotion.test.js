/**
 * @jest-environment node
 *
 * Slice 5 (roster persistence) + Slice 4 (staff promotion invariant) for the
 * contact-leads layer (docs/REVIEWER_CONTACT_LEADS_SPEC.md §6).
 *  - Slice 5: pruneContactLeads / pruneCandidateForRoster persist a compact,
 *    bounded, payload-free leads array so the section survives a roster reload.
 *  - Slice 4: a promoted lead is stamped emailSource:'manual', and the live
 *    invite gate (emailConfidence) classifies 'manual' as quick_check — so a
 *    promoted lead still requires explicit acknowledgement (the safety invariant).
 */

const {
  pruneContactLeads,
  pruneCandidateForRoster,
  MAX_ROSTER_CONTACT_LEADS,
} = require('../../shared/components/reviewers/reviewer-search-logic');
const { emailConfidence } = require('../../lib/utils/reviewer-invite');

describe('Slice 5 — pruneContactLeads', () => {
  test('keeps render fields, drops warnings/evidence, forces persistable:false', () => {
    const out = pruneContactLeads([
      { type: 'email', value: 'a@x.edu', sourceUrl: 'https://x.edu/p', source: 'serp_search',
        confidence: 'rejected', rejectedReason: 'verified_domain_contradiction',
        persistable: true, warnings: ['noise'], evidence: { nameMatched: true } },
    ]);
    expect(out).toEqual([{
      type: 'email', value: 'a@x.edu', sourceUrl: 'https://x.edu/p', source: 'serp_search',
      confidence: 'rejected', rejectedReason: 'verified_domain_contradiction', persistable: false,
    }]);
    expect(out[0]).not.toHaveProperty('warnings');
    expect(out[0]).not.toHaveProperty('evidence');
  });

  test('caps the lead count and drops valueless entries', () => {
    const many = Array.from({ length: MAX_ROSTER_CONTACT_LEADS + 5 }, (_, i) => ({ type: 'email', value: `a${i}@x.edu` }));
    expect(pruneContactLeads(many)).toHaveLength(MAX_ROSTER_CONTACT_LEADS);
    expect(pruneContactLeads([{ type: 'email', value: '' }, { type: 'email' }])).toEqual([]);
  });

  test('truncates oversized strings', () => {
    const [lead] = pruneContactLeads([{ type: 'email', value: 'x'.repeat(500) }]);
    expect(lead.value).toHaveLength(320);
  });

  test('non-array input is safe', () => {
    expect(pruneContactLeads(undefined)).toEqual([]);
  });
});

describe('Slice 5 — pruneCandidateForRoster carries compact leads', () => {
  test('roster DTO contactEnrichment includes the pruned leads', () => {
    const dto = pruneCandidateForRoster({
      name: 'Dr X',
      contactEnrichment: {
        email: null,
        contactLeads: [
          { type: 'email', value: 'withheld@ifmo.ru', source: 'serp_search', confidence: 'rejected', rejectedReason: 'verified_domain_contradiction', persistable: false },
        ],
      },
    });
    expect(dto.contactEnrichment.contactLeads).toEqual([
      expect.objectContaining({ value: 'withheld@ifmo.ru', confidence: 'rejected', persistable: false }),
    ]);
  });

  test('no leads → empty array (never undefined), keeps the card render-safe', () => {
    const dto = pruneCandidateForRoster({ name: 'Dr Y', contactEnrichment: { email: 'y@y.edu' } });
    expect(dto.contactEnrichment.contactLeads).toEqual([]);
  });
});

describe('Slice 4 — promoted lead stays low-confidence for invites', () => {
  test("emailSource:'manual' (the promotion stamp) classifies LOW", () => {
    expect(emailConfidence({ emailSource: 'manual' })).toMatchObject({ level: 'low' });
  });

  test('an ORCID/PubMed email is HIGH — so promotion genuinely tightens, not loosens', () => {
    expect(emailConfidence({ emailSource: 'orcid' }).level).toBe('high');
  });

  test('a manual email stays LOW even on a confirmed identity (provenance, not identity, governs the send gate)', () => {
    expect(emailConfidence({ emailSource: 'manual', identityStatus: 'confirmed' }).level).toBe('low');
  });
});
