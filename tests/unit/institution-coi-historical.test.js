/**
 * @jest-environment node
 *
 * Institution COI is CURRENT-affiliation only (S240, Chunk 2a). Former/historical
 * shared institution no longer counts — reviewers self-disclose relationship
 * conflicts, and a PD-unverifiable flag adds manual-search burden
 * (project-reviewer-coi-rely-on-self-disclosure). This file is the regression guard
 * that the historical scan is GONE, plus coverage of the multi-institution (union)
 * form. `affiliationHistory` is still aggregated by dedup (producer kept) but is no
 * longer a COI input.
 */
const { DeduplicationService } = require('../../lib/services/deduplication-service');

describe('markInstitutionCOI — current-only (historical removed, S240)', () => {
  const PI_INST = 'Johns Hopkins University';

  test('current shared institution flags COI (no historical field)', () => {
    const [r] = DeduplicationService.markInstitutionCOI(
      [{ name: 'A', affiliation: 'Department of Biophysics, Johns Hopkins University, Baltimore, MD' }],
      PI_INST
    );
    expect(r.hasInstitutionCOI).toBe(true);
    expect(r.institutionCOIDetails).toEqual({
      piInstitution: PI_INST,
      reviewerInstitution: 'Department of Biophysics, Johns Hopkins University, Baltimore, MD',
    });
    expect(r.institutionCOIDetails).not.toHaveProperty('historical');
  });

  test('former shared institution (moved away) is NO LONGER flagged', () => {
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
    expect(r.hasInstitutionCOI).toBe(false);
    expect(r.institutionCOIDetails).toBeNull();
  });

  test('no shared institution anywhere → no COI', () => {
    const [r] = DeduplicationService.markInstitutionCOI(
      [{ name: 'B', affiliation: 'Stanford University', affiliationHistory: ['Stanford University', 'UC Berkeley'] }],
      PI_INST
    );
    expect(r.hasInstitutionCOI).toBe(false);
    expect(r.institutionCOIDetails).toBeNull();
  });

  test('UNION (array): flags a match against ANY institution in the set', () => {
    const union = ['MIT', 'Johns Hopkins University'];
    const [r] = DeduplicationService.markInstitutionCOI(
      [{ name: 'C', affiliation: 'Johns Hopkins University' }],
      union
    );
    expect(r.hasInstitutionCOI).toBe(true);
    expect(r.institutionCOIDetails.piInstitution).toBe('Johns Hopkins University');
  });

  test('empty institution / empty union → no-op', () => {
    expect(DeduplicationService.markInstitutionCOI([{ name: 'D', affiliation: 'X' }], null)[0].hasInstitutionCOI).toBeUndefined();
    expect(DeduplicationService.markInstitutionCOI([{ name: 'D', affiliation: 'X' }], [])[0].hasInstitutionCOI).toBeUndefined();
  });
});

describe('filterConflicts — hard drop on the institution union (S240)', () => {
  test('drops candidates at ANY union institution; keeps the rest', () => {
    const researchers = [
      { name: 'Same-A', affiliation: 'Johns Hopkins University' },
      { name: 'Same-B', primaryAffiliation: 'MIT' },
      { name: 'Clean', affiliation: 'Stanford University' },
    ];
    const kept = DeduplicationService.filterConflicts(researchers, ['Johns Hopkins University', 'MIT']);
    expect(kept.map((r) => r.name)).toEqual(['Clean']);
  });

  test('single-string form still works (back-compat)', () => {
    const kept = DeduplicationService.filterConflicts(
      [{ name: 'X', affiliation: 'Stanford University' }, { name: 'Y', affiliation: 'MIT' }],
      'MIT'
    );
    expect(kept.map((r) => r.name)).toEqual(['X']);
  });

  test('empty institution set → no drop', () => {
    const researchers = [{ name: 'X', affiliation: 'MIT' }];
    expect(DeduplicationService.filterConflicts(researchers, [])).toEqual(researchers);
    expect(DeduplicationService.filterConflicts(researchers, null)).toEqual(researchers);
  });
});

describe('deduplicateAndStore — affiliationHistory producer kept (COI-inert)', () => {
  test('still aggregates distinct affiliations across same-author rows', async () => {
    const merged = await DeduplicationService.deduplicateAndStore([
      { name: 'Jane Smith', affiliation: 'Johns Hopkins University', publications: [{ title: 'a' }], source: 'pubmed' },
      { name: 'Jane Smith', affiliation: 'Harvard Medical School', publications: [{ title: 'b' }], source: 'pubmed' },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].affiliationHistory).toEqual(
      expect.arrayContaining(['Johns Hopkins University', 'Harvard Medical School'])
    );
  });

  test('a former-only institution tie is NOT flagged (historical retired)', async () => {
    const merged = await DeduplicationService.deduplicateAndStore([
      { name: 'Jane Smith', affiliation: 'Harvard Medical School', publications: [{ title: 'a' }], source: 'pubmed' },
      { name: 'Jane Smith', affiliation: 'Johns Hopkins University', publications: [{ title: 'b' }], source: 'pubmed' },
    ]);
    // dedup keeps the most-recent affiliation as current; JHU is only in history now.
    const [withCOI] = DeduplicationService.markInstitutionCOI(merged, 'Johns Hopkins University');
    // If the recency-best current affiliation is Harvard, JHU-in-history must NOT flag.
    if ((withCOI.affiliation || withCOI.primaryAffiliation) !== 'Johns Hopkins University') {
      expect(withCOI.hasInstitutionCOI).toBe(false);
    }
  });
});
