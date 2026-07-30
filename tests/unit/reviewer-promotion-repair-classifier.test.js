import {
  buildReviewerPromotionRepairManifest,
  classifyReviewerPromotionRepair,
} from '../../lib/services/reviewer-promotion-repair-classifier';

const BASE = {
  requestId: 'REQ-1',
  suggestion: { suggestionId: 'SUG-1', selected: true, etag: 'W/"s1"' },
  person: { personId: 'PERSON-EMPTY', email: null, etag: 'W/"p1"' },
  roster: { candidateKey: 'candidate:one', updatedAt: '2026-07-29T00:00:00Z' },
  contactProjection: {
    decision: 'ready',
    email: 'redacted@example.edu',
    emailSource: 'pubmed',
    emailPersistAllowed: true,
    websitePersistAllowed: true,
    affiliationPersistAllowed: true,
  },
  references: {
    suggestionCount: 1,
    engagedSuggestionCount: 0,
    contactLinked: false,
    applicantSlotCount: 0,
    otherReferenceCount: 0,
    scanComplete: true,
  },
};

test('class D requires a unique active owner, independent same-person evidence, and an ETag-complete merge plan', () => {
  const row = classifyReviewerPromotionRepair({
    ...BASE,
    exactEmailOwners: [{ personId: 'PERSON-KEEPER', statecode: 0, etag: 'W/"k1"' }],
    independentlyConfirmedSamePerson: true,
    mergePlan: { blocked: false, etagComplete: true },
  });
  expect(row).toMatchObject({
    classification: 'D',
    proposedAction: 'human_reviewed_reviewer_merge',
    exactEmailOwners: [{ personId: 'PERSON-KEEPER', statecode: 0, etag: 'W/"k1"' }],
  });
  expect(JSON.stringify(row)).not.toContain('redacted@example.edu');
});

test.each([
  ['different-person proof absent', {
    exactEmailOwners: [{ personId: 'PERSON-KEEPER', statecode: 0 }],
  }, 'U'],
  ['coherent contact with no owner', { exactEmailOwners: [] }, 'C'],
  ['unresolved projection', {
    contactProjection: { decision: 'needs_identity_confirmation' },
    exactEmailOwners: [],
  }, 'U'],
  ['engaged person', {
    references: { ...BASE.references, engagedSuggestionCount: 1 },
    exactEmailOwners: [],
  }, 'E'],
  ['already repaired', {
    person: { ...BASE.person, email: 'present@example.edu' },
    exactEmailOwners: [],
  }, 'N'],
])('%s classifies as %s', (_label, patch, expected) => {
  expect(classifyReviewerPromotionRepair({ ...BASE, ...patch }).classification).toBe(expected);
});

test('manifest ordering/hash are stable and omit personal email values', () => {
  const a = classifyReviewerPromotionRepair({ ...BASE, requestId: 'REQ-B', exactEmailOwners: [] });
  const b = classifyReviewerPromotionRepair({ ...BASE, requestId: 'REQ-A', exactEmailOwners: [] });
  const metadata = { sourceCommit: 'a'.repeat(40), observedAt: '2026-07-29T12:00:00.000Z' };
  const first = buildReviewerPromotionRepairManifest([a, b], metadata);
  const second = buildReviewerPromotionRepairManifest([b, a], metadata);
  expect(first.manifestHash).toBe(second.manifestHash);
  expect(first.rows.map((row) => row.requestId)).toEqual(['REQ-A', 'REQ-B']);
  expect(JSON.stringify(first)).not.toContain('redacted@example.edu');
});
