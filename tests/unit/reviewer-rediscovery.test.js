/**
 * reviewer-rediscovery — identity-anchor matching of fresh Find candidates
 * against the saved pool's ENGAGED rows (S401, Kwong confusion 2026-08-04:
 * a fresh search re-surfaced already-invited people as fully invitable cards
 * because discovery's exact normalized-name filter missed name variants).
 */
const {
  reviewerIdentityMatchKeys,
  buildEngagedSavedIndex,
  partitionRediscoveredCandidates,
  REDISCOVERED_STAGE_LABELS,
} = require('../../shared/utils/reviewer-rediscovery');

const savedInvited = {
  suggestionId: 'sug-1',
  potentialReviewerId: 'person-1',
  name: 'Christopher K. Kwong',
  affiliation: 'UCSF',
  orcid: null,
  orcidUrl: 'https://orcid.org/0000-0001-2345-678X',
  invited: true,
  accepted: false,
  declined: false,
};

test('an ORCID match collapses a re-discovered candidate even under a different name spelling', () => {
  const index = buildEngagedSavedIndex([savedInvited]);
  // The name filter would MISS "C. Kwong" (different normalized name); the
  // ORCID anchor must not.
  const fresh = { name: 'C. Kwong', orcid: '0000-0001-2345-678x', affiliation: 'University of California, San Francisco' };
  const { kept, rediscovered } = partitionRediscoveredCandidates([fresh], index);
  expect(kept).toHaveLength(0);
  expect(rediscovered).toHaveLength(1);
  expect(rediscovered[0].saved).toMatchObject({ suggestionId: 'sug-1', stage: 'invited', name: 'Christopher K. Kwong' });
});

test('a diacritic name variant matches via the normalized-name fallback key', () => {
  const index = buildEngagedSavedIndex([{ ...savedInvited, name: 'Jens Hör', orcidUrl: null }]);
  const fresh = { name: 'Jens Hor' };
  const { kept, rediscovered } = partitionRediscoveredCandidates([fresh], index);
  expect(kept).toHaveLength(0);
  expect(rediscovered).toHaveLength(1);
});

test('a merely-saved (selected, not yet engaged) row does NOT collapse its twin', () => {
  const merelySaved = { ...savedInvited, invited: false, selected: true };
  const index = buildEngagedSavedIndex([merelySaved]);
  const fresh = { name: 'Christopher K. Kwong' };
  const { kept, rediscovered } = partitionRediscoveredCandidates([fresh], index);
  expect(kept).toHaveLength(1);
  expect(rediscovered).toHaveLength(0);
});

test('a different person with no shared keys is kept', () => {
  const index = buildEngagedSavedIndex([savedInvited]);
  const fresh = { name: 'Maria Alvarez', orcid: '0000-0002-9999-9999' };
  const { kept, rediscovered } = partitionRediscoveredCandidates([fresh], index);
  expect(kept).toHaveLength(1);
  expect(rediscovered).toHaveLength(0);
});

test('declined stage collapses too and carries its label', () => {
  const declined = { ...savedInvited, invited: true, declined: true };
  const index = buildEngagedSavedIndex([declined]);
  const { rediscovered } = partitionRediscoveredCandidates([{ name: 'Christopher K Kwong' }], index);
  expect(rediscovered[0].saved.stage).toBe('declined');
  expect(REDISCOVERED_STAGE_LABELS.declined).toBe('already declined');
});

test('match keys include every anchor plus the normalized name', () => {
  const keys = reviewerIdentityMatchKeys({
    potentialReviewerId: 'P-1',
    orcidUrl: 'https://orcid.org/0000-0001-2345-678X',
    googleScholarId: 'AbC123',
    openAlexId: 'A50000001',
    name: 'Dr. Jens Hör',
    contactEnrichment: {},
  });
  expect(keys).toEqual([
    'person:p-1',
    'orcid:0000-0001-2345-678X',
    'scholar:abc123',
    'openalex:a50000001',
    'name:jens hor',
  ]);
});

test('an empty or unengaged pool partitions everything into kept', () => {
  expect(partitionRediscoveredCandidates([{ name: 'A' }], buildEngagedSavedIndex([])).kept).toHaveLength(1);
  expect(partitionRediscoveredCandidates([{ name: 'A' }], undefined).kept).toHaveLength(1);
});
