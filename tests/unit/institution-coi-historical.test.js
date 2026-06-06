/**
 * @jest-environment node
 *
 * Former-institution COI: a reviewer who shared an institution with the PI in the
 * PAST and has since moved is a genuine conflict the recency-best current
 * affiliation hides. markInstitutionCOI scans the affiliation HISTORY to catch it.
 * (S229 — surfaced by Taekjip Ha: ex-Johns Hopkins, now Harvard, on a JHU proposal.)
 */
const { DeduplicationService } = require('../../lib/services/deduplication-service');

describe('markInstitutionCOI — current + historical', () => {
  const PI_INST = 'Johns Hopkins University';

  test('current shared institution flags COI (not marked historical)', () => {
    const [r] = DeduplicationService.markInstitutionCOI(
      [{ name: 'A', affiliation: 'Department of Biophysics, Johns Hopkins University, Baltimore, MD' }],
      PI_INST
    );
    expect(r.hasInstitutionCOI).toBe(true);
    expect(r.institutionCOIDetails.historical).toBe(false);
  });

  test('former shared institution (moved away) flags COI as historical', () => {
    const [r] = DeduplicationService.markInstitutionCOI(
      [{
        name: 'Taekjip Ha',
        affiliation: 'Department of Pediatrics, Harvard Medical School, Boston, MA', // current ≠ PI
        affiliationHistory: [
          'Department of Pediatrics, Harvard Medical School, Boston, MA',
          'TC Jenkins Department of Biophysics, Johns Hopkins University, Baltimore, MD', // former == PI
        ],
      }],
      PI_INST
    );
    expect(r.hasInstitutionCOI).toBe(true);
    expect(r.institutionCOIDetails.historical).toBe(true);
    expect(r.institutionCOIDetails.reviewerInstitution).toMatch(/Johns Hopkins/);
  });

  test('no shared institution anywhere → no COI', () => {
    const [r] = DeduplicationService.markInstitutionCOI(
      [{
        name: 'B',
        affiliation: 'Stanford University',
        affiliationHistory: ['Stanford University', 'UC Berkeley'],
      }],
      PI_INST
    );
    expect(r.hasInstitutionCOI).toBe(false);
    expect(r.institutionCOIDetails).toBeNull();
  });

  test('current match short-circuits the history scan (stays non-historical)', () => {
    const [r] = DeduplicationService.markInstitutionCOI(
      [{
        name: 'C',
        affiliation: 'Johns Hopkins University',
        affiliationHistory: ['Johns Hopkins University', 'MIT'],
      }],
      PI_INST
    );
    expect(r.hasInstitutionCOI).toBe(true);
    expect(r.institutionCOIDetails.historical).toBe(false);
  });

  test('no affiliationHistory present → behaves exactly as the current-only check', () => {
    const [r] = DeduplicationService.markInstitutionCOI(
      [{ name: 'D', affiliation: 'Harvard Medical School' }],
      PI_INST
    );
    expect(r.hasInstitutionCOI).toBe(false);
  });
});

describe('deduplicateAndStore — affiliationHistory for Track B (Codex P2)', () => {
  test('aggregates distinct affiliations across same-author rows', async () => {
    const merged = await DeduplicationService.deduplicateAndStore([
      { name: 'Jane Smith', affiliation: 'Johns Hopkins University', publications: [{ title: 'a' }], source: 'pubmed' },
      { name: 'Jane Smith', affiliation: 'Harvard Medical School', publications: [{ title: 'b' }], source: 'pubmed' },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].affiliationHistory).toEqual(
      expect.arrayContaining(['Johns Hopkins University', 'Harvard Medical School'])
    );
  });

  test('Track B former-institution tie is flagged historical once history is present', async () => {
    const merged = await DeduplicationService.deduplicateAndStore([
      { name: 'Jane Smith', affiliation: 'Harvard Medical School', publications: [{ title: 'a' }], source: 'pubmed' },
      { name: 'Jane Smith', affiliation: 'Johns Hopkins University', publications: [{ title: 'b' }], source: 'pubmed' },
    ]);
    const [withCOI] = DeduplicationService.markInstitutionCOI(merged, 'Johns Hopkins University');
    expect(withCOI.hasInstitutionCOI).toBe(true);
  });
});
