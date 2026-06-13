/**
 * @jest-environment node
 */

const {
  buildReviewerProvenance,
  saveSourceListForCandidate,
  provenanceGroupOf,
  provenanceLabelForCandidate,
  hasGroundedProvenanceRankingBonus,
  isIdentityReviewExemptProvenance,
  PROVENANCE_KINDS,
} = require('../../lib/utils/reviewer-provenance');

describe('reviewer provenance DTO helper', () => {
  test('maps literature candidates to ordered scholarly sources plus provenance kind for save', () => {
    const candidate = {
      name: 'Ada Reviewer',
      source: 'claude_suggestion',
      verificationSource: 'pubmed',
      publications: [{ pmid: '123', doi: '10.1/example' }],
    };

    expect(buildReviewerProvenance(candidate)).toEqual({
      kind: 'literature_retrieved',
      sources: ['pubmed'],
      seedRole: 'query_seed',
      groundingWorkIds: ['doi:10.1/example', 'pmid:123'],
    });
    expect(saveSourceListForCandidate(candidate)).toEqual(['pubmed', 'literature_retrieved']);
  });

  test('does not infer provenance from legacy Claude flags alone', () => {
    const candidate = { name: 'Parametric Only', isClaudeSuggestion: true, source: 'claude_suggestion' };
    expect(buildReviewerProvenance(candidate).kind).toBe('barred_parametric');
    expect(saveSourceListForCandidate(candidate)).toEqual(['barred_parametric']);
    expect(provenanceGroupOf(candidate)).toBe('needs_identity_review');
  });

  test('maps applicant recommended rows from their actual origin', () => {
    const candidate = { name: 'Applicant Pick', isApplicantRecommended: true };
    expect(buildReviewerProvenance(candidate)).toMatchObject({
      kind: 'applicant_suggested',
      sources: ['applicant_form'],
      seedRole: 'applicant_suggested',
    });
    expect(provenanceGroupOf(candidate)).toBe('applicant_suggested');
  });

  // Slice E (S235) — the BARRED/unknown-kind fallback must not gate a row whose IDENTITY
  // is positively resolved. A BARRED Track-A row upgraded by a shared-ORCID Track-B match
  // keeps the barred kind but gains confirmed identity; it is a legitimate, selectable
  // reviewer, and the server (save-candidates) must NOT 422 it. The genuinely-unresolved
  // BARRED row (no positive identity, covered above at "does not infer…") stays gated.
  test('a positively-resolved BARRED row is selectable, not needs_identity_review', () => {
    const confirmedBarred = {
      name: 'Upgraded By Orcid',
      isClaudeSuggestion: true,
      source: 'claude_suggestion', // → barred_parametric kind (no scholarly source)
      identityStatus: 'confirmed',
      verified: true,
      verificationStatus: 'verified',
      orcid: '0000-0002-1825-0097',
    };
    expect(buildReviewerProvenance(confirmedBarred).kind).toBe('barred_parametric');
    expect(provenanceGroupOf(confirmedBarred)).not.toBe('needs_identity_review');
    expect(provenanceGroupOf(confirmedBarred)).toBe('literature_retrieved');
  });

  test('a probable-identity row is also selectable despite a barred kind', () => {
    const probableBarred = {
      name: 'Probable Person', isClaudeSuggestion: true, source: 'claude_suggestion',
      verificationStatus: 'probable',
    };
    expect(provenanceGroupOf(probableBarred)).toBe('literature_retrieved');
  });

  test('an unresolved row still routes to needs_identity_review (gate intact)', () => {
    const unresolved = {
      name: 'Deferred Person', isClaudeSuggestion: true, source: 'claude_suggestion',
      needsIdentification: true, identityStatus: 'unresolved', verificationStatus: 'unresolved',
    };
    expect(provenanceGroupOf(unresolved)).toBe('needs_identity_review');
  });

  // S235 — PI-named / cited candidates (the proposal author named/cited THIS person) stay
  // SELECTABLE even when the automatic identity match is unresolved; only system-discovered
  // candidates are hard-blocked. (The save path force-nulls their contact until confirmed.)
  test('a PI-named / cited candidate stays selectable (cited_or_proposal_named) when unresolved', () => {
    const proposalNamed = {
      name: 'Olga Smirnova', source: 'proposal_named',
      needsIdentification: true, identityStatus: 'unresolved', verificationStatus: 'unresolved',
    };
    expect(provenanceGroupOf(proposalNamed)).toBe('cited_or_proposal_named');

    const cited = { name: 'Cited Author', source: 'cited_reference', identityStatus: 'unresolved' };
    expect(provenanceGroupOf(cited)).toBe('cited_or_proposal_named');
  });

  test('a system-discovered (literature_retrieved) unresolved candidate stays gated (needs_identity_review)', () => {
    const deferred = {
      name: 'Deferred Track-B', sources: ['openalex'],
      needsIdentification: true, identityStatus: 'unresolved',
    };
    expect(provenanceGroupOf(deferred)).toBe('needs_identity_review');
  });
});

// S249 referral capture — a contacted reviewer suggested this person.
describe('referred provenance (S249)', () => {
  const referred = (over = {}) => ({ name: 'Tim Newhouse', referredBy: 'Dr. Abby Doyle', ...over });

  test('a referredBy candidate gets kind=referred + seedRole=referred_by + the referrer passthrough', () => {
    const p = buildReviewerProvenance(referred());
    expect(p.kind).toBe(PROVENANCE_KINDS.REFERRED);
    expect(p.seedRole).toBe('referred_by');
    expect(p.referredBy).toBe('Dr. Abby Doyle');
  });

  test('non-referred provenance objects keep their shape (no referredBy key)', () => {
    const p = buildReviewerProvenance({ name: 'X', source: 'proposal_named' });
    expect(p).not.toHaveProperty('referredBy');
  });

  test('referred is a grounded-ranking-bonus kind (≈ proposal_named)', () => {
    expect(hasGroundedProvenanceRankingBonus(referred())).toBe(true);
  });

  test('referred is identity-review-exempt → selectable-with-verify even when unresolved', () => {
    expect(isIdentityReviewExemptProvenance(PROVENANCE_KINDS.REFERRED)).toBe(true);
    const unresolvedReferral = referred({
      needsIdentification: true, identityStatus: 'unresolved', verificationStatus: 'unresolved',
    });
    expect(provenanceGroupOf(unresolvedReferral)).toBe('cited_or_proposal_named');
  });

  test('the card label names the referrer', () => {
    expect(provenanceLabelForCandidate(referred())).toBe('Referred by Dr. Abby Doyle');
    expect(provenanceLabelForCandidate({ name: 'Y', referredBy: '', provenanceKind: 'referred' })).toBe('Referred');
  });

  test('referredBy survives a roster round-trip (provenance object reload)', () => {
    const first = buildReviewerProvenance(referred());
    // Simulate reload: the candidate now carries the persisted provenance object.
    const reloaded = buildReviewerProvenance({ name: 'Tim Newhouse', provenance: first });
    expect(reloaded.kind).toBe(PROVENANCE_KINDS.REFERRED);
    expect(reloaded.referredBy).toBe('Dr. Abby Doyle');
  });

  test('save-source list carries the referred kind', () => {
    expect(saveSourceListForCandidate(referred())).toContain('referred');
  });

  // Durability (Codex review fix): a my-candidates reload rebuilds the row with
  // sources ['staff_manual','referred'] + referredBy parsed from the match reason.
  // The kind must re-derive to referred, NOT degrade to barred_parametric.
  test('a reloaded referral DTO (sources include referred) re-derives kind referred', () => {
    const reloaded = { name: 'Tim Newhouse', sources: ['staff_manual', 'referred'], referredBy: 'Dr. Abby Doyle' };
    const p = buildReviewerProvenance(reloaded);
    expect(p.kind).toBe(PROVENANCE_KINDS.REFERRED);
    expect(p.referredBy).toBe('Dr. Abby Doyle');
    expect(provenanceGroupOf(reloaded)).toBe('cited_or_proposal_named'); // still selectable-with-verify
  });

  test('sources-plural alone (referredBy parse failed) still re-derives kind referred', () => {
    const p = buildReviewerProvenance({ name: 'X', sources: ['staff_manual', 'referred'] });
    expect(p.kind).toBe(PROVENANCE_KINDS.REFERRED);
  });

  test('early-return path carries a top-level referredBy onto a provenance object that lacks it', () => {
    const provenanceWithoutReferrer = { kind: 'referred', sources: [], seedRole: 'referred_by', groundingWorkIds: [] };
    const p = buildReviewerProvenance({ name: 'X', provenance: provenanceWithoutReferrer, referredBy: 'Dr. Abby Doyle' });
    expect(p.referredBy).toBe('Dr. Abby Doyle');
  });
});
