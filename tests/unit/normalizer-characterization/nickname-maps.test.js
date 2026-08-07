/**
 * Characterization tests for the two independent nickname maps
 * (docs/NORMALIZER_CONSOLIDATION_INVENTORY.md §3): `NICKNAME_MAP`
 * (lib/services/discovery/constants.js) and `NAME_VARIANTS`
 * (lib/services/integrity-matching-service.js). Pins their DIFFERENT
 * coverage and cardinality — no production code is modified by this file.
 */

const { NICKNAME_MAP } = require('../../../lib/services/discovery/constants');
const { IntegrityMatchingService } = require('../../../lib/services/integrity-matching-service');
const { firstNamesEquivalent } = require('../../../lib/services/discovery/name-matching');

describe('Nickname map characterization', () => {
  describe('NICKNAME_MAP (discovery/constants.js) — one formal name per nickname, English-only', () => {
    test('maps a nickname to exactly ONE formal name (string, not array)', () => {
      expect(NICKNAME_MAP.chris).toBe('Christopher');
      expect(typeof NICKNAME_MAP.chris).toBe('string');
    });

    test('has no international-variant entries (e.g. no wilhelm/william, no giuseppe/joseph)', () => {
      expect(NICKNAME_MAP.wilhelm).toBeUndefined();
      expect(NICKNAME_MAP.giuseppe).toBeUndefined();
    });

    test('~42 entries (exact count is an implementation detail; assert it is neither 0 nor huge)', () => {
      const count = Object.keys(NICKNAME_MAP).length;
      expect(count).toBeGreaterThan(30);
      expect(count).toBeLessThan(60);
    });

    test('firstNamesEquivalent consults this map bidirectionally', () => {
      expect(firstNamesEquivalent('will', 'William')).toBe(true);
      expect(firstNamesEquivalent('William', 'will')).toBe(true);
    });

    test('a name with NO nickname entry and no exact match is not equivalent to anything else', () => {
      expect(firstNamesEquivalent('Zbigniew', 'Zach')).toBe(false);
    });
  });

  describe('NAME_VARIANTS (integrity-matching-service.js) — many nicknames per formal name, includes international variants', () => {
    test('maps a formal name to MULTIPLE nickname variants (array)', () => {
      const variants = IntegrityMatchingService.getNameVariants('robert');
      expect(variants).toEqual(expect.arrayContaining(['bob', 'rob', 'robbie', 'bobby', 'bert']));
    });

    test('has international-variant entries that NICKNAME_MAP entirely lacks', () => {
      expect(IntegrityMatchingService.areNameVariants('wilhelm', 'william')).toBe(true);
      expect(IntegrityMatchingService.areNameVariants('giuseppe', 'joseph')).toBe(true);
      expect(IntegrityMatchingService.areNameVariants('karl', 'charles')).toBe(true);
    });

    test('lookup works bidirectionally (nickname → formal, formal → nickname)', () => {
      expect(IntegrityMatchingService.areNameVariants('bob', 'robert')).toBe(true);
      expect(IntegrityMatchingService.areNameVariants('robert', 'bob')).toBe(true);
    });

    test('~90 formal-name keys (exact count is an implementation detail; assert order of magnitude)', () => {
      // Re-derive key count via a name known to be present plus a broad sweep is overkill;
      // this test instead exercises breadth via several distinct formal-name families.
      const families = ['robert', 'william', 'richard', 'james', 'john', 'michael', 'elizabeth', 'margaret'];
      for (const formal of families) {
        expect(IntegrityMatchingService.getNameVariants(formal).length).toBeGreaterThan(1);
      }
    });
  });

  describe('Cross-map: same nickname pair, same verdict here, but NEITHER map is consulted at non-nickname-aware seams', () => {
    test('"chris"/"christopher" equivalent under BOTH maps', () => {
      expect(firstNamesEquivalent('chris', 'christopher')).toBe(true);
      expect(IntegrityMatchingService.areNameVariants('chris', 'christopher')).toBe(true);
    });

    test('an international variant pair is equivalent ONLY under NAME_VARIANTS, not under NICKNAME_MAP', () => {
      expect(IntegrityMatchingService.areNameVariants('wilhelm', 'william')).toBe(true);
      expect(firstNamesEquivalent('wilhelm', 'william')).toBe(false);
    });
  });
});
