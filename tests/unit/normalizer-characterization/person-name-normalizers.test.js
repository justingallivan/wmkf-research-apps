/**
 * Characterization tests for the person-name normalizer inventory
 * (docs/NORMALIZER_CONSOLIDATION_INVENTORY.md §1). These PIN today's
 * behavior — including behavior the inventory flags as inconsistent or
 * "wrong" (e.g. missing diacritic folding, missing nickname awareness) —
 * so a later consolidation step has a regression net. Do NOT "fix" any
 * assertion here to make a normalizer behave "better"; if a normalizer's
 * behavior changes, this file changing is a signal that step 1's baseline
 * assumption broke, not that the test was wrong.
 *
 * No production code is modified by this file.
 */

const { normalizeName } = require('../../../lib/utils/name-normalization');
const { DeduplicationService } = require('../../../lib/services/deduplication-service');
const { normalizeReviewerName } = require('../../../lib/utils/reviewer-name-match');
const {
  normalizeNameForMatch,
  firstNamesEquivalent,
  namesMatch,
} = require('../../../lib/services/discovery/name-matching');
const { ContactParser } = require('../../../lib/utils/contact-parser');
const { IntegrityMatchingService } = require('../../../lib/services/integrity-matching-service');
const { stripHonorific: stripHonorificFormatList } = require('../../../lib/utils/format-name-list');

describe('Person-name normalizer characterization', () => {
  // ---------------------------------------------------------------------
  // §1.1 / §1.2 — name-normalization.js normalizeName vs
  // DeduplicationService.normalizeName. Inventory claim: byte-identical.
  // ---------------------------------------------------------------------
  describe('normalizeName (name-normalization.js) === DeduplicationService.normalizeName', () => {
    const battery = [
      'John Smith',
      'JOHN SMITH',
      'Dr. Jane Smith',
      'Prof. Reinhard Dörner',
      'Müller, José',
      "O'Brien",
      'Jean-Luc Picard',
      'J. Smith',
      '  Extra   Spaces  ',
      'Smith, John',
      '',
      null,
    ];

    test.each(battery)('%p → identical output from both definitions', (input) => {
      expect(normalizeName(input)).toBe(DeduplicationService.normalizeName(input));
    });

    test('plain ASCII: lowercases, no honorific strip, no diacritic fold', () => {
      expect(normalizeName('John Smith')).toBe('john smith');
    });

    test('honorific is NOT stripped (leading "dr" survives as a token)', () => {
      expect(normalizeName('Dr. Jane Smith')).toBe('dr jane smith');
    });

    test('diacritics are NOT folded — non-ASCII letters are simply dropped', () => {
      // ö/é are not in [a-z], so they disappear entirely rather than folding to "o"/"e".
      expect(normalizeName('Müller, José')).toBe('mller jos');
    });

    test('"Last, First" is NOT reordered — comma is simply stripped', () => {
      expect(normalizeName('Smith, John')).toBe('smith john');
    });

    test("apostrophe and hyphen names lose the punctuation, tokens survive", () => {
      expect(normalizeName("O'Brien")).toBe('obrien');
      expect(normalizeName('Jean-Luc Picard')).toBe('jeanluc picard');
    });

    test('bare initial is preserved as a single-letter token', () => {
      expect(normalizeName('J. Smith')).toBe('j smith');
    });

    test('whitespace runs collapse to one space, ends trimmed', () => {
      expect(normalizeName('  Extra   Spaces  ')).toBe('extra spaces');
    });

    test('empty/null input returns empty string', () => {
      expect(normalizeName('')).toBe('');
      expect(normalizeName(null)).toBe('');
    });
  });

  // ---------------------------------------------------------------------
  // §1.3 — reviewer-name-match.js normalizeReviewerName: the ONE normalizer
  // with diacritic fold + honorific strip + non-alpha strip together.
  // ---------------------------------------------------------------------
  describe('normalizeReviewerName (reviewer-name-match.js)', () => {
    test('plain ASCII', () => {
      expect(normalizeReviewerName('John Smith')).toBe('john smith');
    });

    test('honorific is stripped (dr/prof/professor/mr/mrs/ms)', () => {
      expect(normalizeReviewerName('Dr. Jane Smith')).toBe('jane smith');
      expect(normalizeReviewerName('Professor Bob Brown')).toBe('bob brown');
      expect(normalizeReviewerName('Mrs. Jane Smith')).toBe('jane smith');
    });

    test('honorific set OMITS Sir/Dame/Mx — those survive as name tokens', () => {
      expect(normalizeReviewerName('Sir Elton John')).toBe('sir elton john');
      expect(normalizeReviewerName('Dame Judi Dench')).toBe('dame judi dench');
    });

    test('diacritics FOLD via NFKD + combining-mark strip (ö → o)', () => {
      expect(normalizeReviewerName('Jens Hör')).toBe('jens hor');
      expect(normalizeReviewerName('Müller')).toBe('muller');
      expect(normalizeReviewerName('José')).toBe('jose');
    });

    test('ß folds to "ss" (does not NFKD-decompose on its own)', () => {
      expect(normalizeReviewerName('Straße')).toBe('strasse');
    });

    test('spelled-out transliteration digraphs are NOT folded (documented non-goal)', () => {
      // "oe"/"ue" are left alone — a blanket rule would mangle "Manuel".
      expect(normalizeReviewerName('Manuel')).toBe('manuel');
    });

    test('"Last, First" is NOT reordered', () => {
      expect(normalizeReviewerName('Smith, John')).toBe('smith john');
    });

    test('apostrophe/hyphen names lose punctuation', () => {
      expect(normalizeReviewerName("O'Brien")).toBe('obrien');
      expect(normalizeReviewerName('Jean-Luc Picard')).toBe('jeanluc picard');
    });

    test('stacked honorifics: only ONE leading honorific token is stripped (no repeat loop)', () => {
      // Unlike ContactParser.stripHonorifics (§1.6), this regex is not looped.
      expect(normalizeReviewerName('Prof. Dr. Hans Mueller')).toBe('dr hans mueller');
    });
  });

  // ---------------------------------------------------------------------
  // §1.4 vs §1.5 — discovery/name-matching.js normalizeNameForMatch vs
  // ContactParser.normalizeNameForMatch. Inventory finding: ContactParser's
  // docstring claims to be "copied from discovery-service" but has DIVERGED
  // (no honorific strip). This test asserts the DIVERGENCE explicitly.
  // ---------------------------------------------------------------------
  describe('normalizeNameForMatch (discovery/name-matching.js) vs ContactParser.normalizeNameForMatch — DIVERGED, not identical', () => {
    test('plain ASCII: both lowercase and collapse whitespace the same way', () => {
      expect(normalizeNameForMatch('John Smith')).toBe('john smith');
      expect(ContactParser.normalizeNameForMatch('John Smith')).toBe('john smith');
    });

    test('discovery/name-matching.js STRIPS a leading honorific; ContactParser does NOT', () => {
      expect(normalizeNameForMatch('Dr. Jane Smith')).toBe('jane smith');
      // The docstring says "Copied from discovery-service" — this proves that's stale:
      expect(ContactParser.normalizeNameForMatch('Dr. Jane Smith')).toBe('dr jane smith');
    });

    test('ContactParser strips commas/periods only (no honorific regex, no non-alpha strip beyond . and ,)', () => {
      expect(ContactParser.normalizeNameForMatch('Smith, John.')).toBe('smith john');
      expect(ContactParser.normalizeNameForMatch("O'Brien")).toBe("o'brien");
    });

    test('discovery/name-matching.js does NOT strip apostrophes/hyphens either (only honorific + whitespace)', () => {
      expect(normalizeNameForMatch("O'Brien")).toBe("o'brien");
      expect(normalizeNameForMatch('Jean-Luc Picard')).toBe('jean-luc picard');
    });

    test('neither definition folds diacritics', () => {
      expect(normalizeNameForMatch('José')).toBe('josé');
      expect(ContactParser.normalizeNameForMatch('José')).toBe('josé');
    });
  });

  describe('firstNamesEquivalent + NICKNAME_MAP (discovery/constants.js) — nickname equivalence exists HERE', () => {
    test('Chris/Christopher are equivalent (case-insensitive, either direction)', () => {
      expect(firstNamesEquivalent('Chris', 'Christopher')).toBe(true);
      expect(firstNamesEquivalent('Christopher', 'Chris')).toBe(true);
      expect(firstNamesEquivalent('chris', 'CHRISTOPHER')).toBe(true);
    });

    test('unrelated first names are not equivalent', () => {
      expect(firstNamesEquivalent('Chris', 'David')).toBe(false);
    });

    test('namesMatch: "Chris Cheung" matches "Christopher Cheung" via full-forename nickname evidence', () => {
      expect(namesMatch('chris cheung', 'christopher cheung')).toBe(true);
    });
  });

  // ---------------------------------------------------------------------
  // §1.6 — ContactParser.stripHonorifics: broadest set, includes Sir/Dame,
  // loops to strip stacked titles.
  // ---------------------------------------------------------------------
  describe('ContactParser.stripHonorifics', () => {
    test('single honorific stripped', () => {
      expect(ContactParser.stripHonorifics('Dr. Jane Smith')).toBe('Jane Smith');
    });

    test('stacked honorifics fully removed (loop)', () => {
      expect(ContactParser.stripHonorifics('Prof. Dr. Reinhard Dörner')).toBe('Reinhard Dörner');
    });

    test('Sir/Dame ARE in this set (unlike reviewer-name-match.js, §1.3)', () => {
      expect(ContactParser.stripHonorifics('Sir Elton John')).toBe('Elton John');
      expect(ContactParser.stripHonorifics('Dame Judi Dench')).toBe('Judi Dench');
    });

    test('Mx is NOT in this set (unlike format-name-list.js, §1.7)', () => {
      expect(ContactParser.stripHonorifics('Mx. Sam Lee')).toBe('Mx. Sam Lee');
    });

    test('case preserved, only honorific removed', () => {
      expect(ContactParser.stripHonorifics('PROF. JANE SMITH')).toBe('JANE SMITH');
    });
  });

  // ---------------------------------------------------------------------
  // §1.7 — format-name-list.js stripHonorific: has Mx, lacks Sir/Dame.
  // ---------------------------------------------------------------------
  describe('format-name-list.js stripHonorific — distinct honorific set (has Mx, lacks Sir/Dame)', () => {
    test('Mx IS stripped here', () => {
      expect(stripHonorificFormatList('Mx. Sam Lee')).toBe('Sam Lee');
    });

    test('Sir/Dame are NOT stripped here (survive as name tokens)', () => {
      expect(stripHonorificFormatList('Sir Elton John')).toBe('Sir Elton John');
      expect(stripHonorificFormatList('Dame Judi Dench')).toBe('Dame Judi Dench');
    });

    test('stacked "Prof. Dr." fully removed (loop, same as ContactParser)', () => {
      expect(stripHonorificFormatList('Prof. Dr. Hans Mueller')).toBe('Hans Mueller');
    });

    test('suffixes (Jr., III, PhD) are left intact — not honorifics', () => {
      expect(stripHonorificFormatList('Dr. Jane Smith, PhD')).toBe('Jane Smith, PhD');
    });
  });

  // ---------------------------------------------------------------------
  // §1.14 — IntegrityMatchingService.normalizeName: the ONLY normalizer
  // that reorders "Last, First" and folds diacritics via NFD.
  // ---------------------------------------------------------------------
  describe('IntegrityMatchingService.normalizeName — Last,First reorder + NFD diacritic fold', () => {
    test('plain ASCII', () => {
      expect(IntegrityMatchingService.normalizeName('John Smith')).toBe('john smith');
    });

    test('"Last, First" IS reordered to "First Last" — unique among all normalizers in this inventory', () => {
      expect(IntegrityMatchingService.normalizeName('Smith, John')).toBe('john smith');
    });

    test('diacritics fold via NFD (José → jose, Müller → muller)', () => {
      expect(IntegrityMatchingService.normalizeName('José')).toBe('jose');
      expect(IntegrityMatchingService.normalizeName('Müller')).toBe('muller');
    });

    test('honorific set includes phd/md as mid-string word-boundary matches', () => {
      expect(IntegrityMatchingService.normalizeName('John Smith PhD')).toBe('john smith');
      expect(IntegrityMatchingService.normalizeName('Dr. John Smith MD')).toBe('john smith');
    });

    test('apostrophe/hyphen names lose punctuation', () => {
      expect(IntegrityMatchingService.normalizeName("O'Brien")).toBe('obrien');
      expect(IntegrityMatchingService.normalizeName('Jean-Luc Picard')).toBe('jeanluc picard');
    });
  });

  describe('IntegrityMatchingService nickname map (NAME_VARIANTS) — independent of NICKNAME_MAP (§3.1/§3.2)', () => {
    test('Chris/Christopher are variants (matches discovery/constants.js NICKNAME_MAP coverage)', () => {
      expect(IntegrityMatchingService.areNameVariants('chris', 'christopher')).toBe(true);
    });

    test('international variant coverage NICKNAME_MAP (discovery/constants.js) lacks entirely', () => {
      expect(IntegrityMatchingService.areNameVariants('wilhelm', 'william')).toBe(true);
      expect(IntegrityMatchingService.areNameVariants('giuseppe', 'joseph')).toBe(true);
    });

    test('calculateNameMatch: "Robert Smith" vs "Bob Smith" scores as a name_variant match (tier 2.5)', () => {
      const result = IntegrityMatchingService.calculateNameMatch('Robert Smith', 'Bob Smith');
      expect(result.matches).toBe(true);
      expect(result.matchType).toBe('name_variant');
      expect(result.confidence).toBe(90);
    });
  });

  // ---------------------------------------------------------------------
  // §7 — the cross-seam divergence: "Chris Cheung" vs "Christopher Cheung"
  // is equivalent for nickname-aware seams, NOT for seams with no nickname
  // map at all. This is the load-bearing "same string, different verdict"
  // demonstration the inventory calls out.
  // ---------------------------------------------------------------------
  describe('Cross-seam: nickname equivalence exists at some seams and not others', () => {
    test('PubMed byline confirmation (discovery/name-matching.js + NICKNAME_MAP): Chris == Christopher', () => {
      expect(namesMatch('chris cheung', 'christopher cheung')).toBe(true);
    });

    test('Retraction Watch screening (integrity-matching-service.js + NAME_VARIANTS): Chris == Christopher', () => {
      const result = IntegrityMatchingService.calculateNameMatch('Chris Cheung', 'Christopher Cheung');
      expect(result.matches).toBe(true);
    });

    test('Roster dedup / exclusion key (reviewer-name-match.js, §1.3): Chris != Christopher — no nickname map consulted', () => {
      expect(normalizeReviewerName('Chris Cheung')).not.toBe(normalizeReviewerName('Christopher Cheung'));
    });

    test('Proposal-author COI exclusion key (DeduplicationService.normalizeName, §1.2): Chris != Christopher', () => {
      expect(DeduplicationService.normalizeName('Chris Cheung')).not.toBe(
        DeduplicationService.normalizeName('Christopher Cheung'),
      );
    });
  });

  // ---------------------------------------------------------------------
  // Multi-token / initials / punctuation battery for the byline-evidence
  // engine (discovery/name-matching.js nameMatchEvidence), since it backs
  // several callers (namesMatch, evaluateNameEvidence, filterToMatchingAuthor).
  // ---------------------------------------------------------------------
  describe('discovery/name-matching.js nameMatchEvidence — initials and surname-order battery', () => {
    const { nameMatchEvidence } = require('../../../lib/services/discovery/name-matching');

    test('full forename + surname match', () => {
      const ev = nameMatchEvidence('John Smith', 'John Smith');
      expect(ev.matches).toBe(true);
      expect(ev.fullForenameMatch).toBe(true);
    });

    test('initial-only forename matches a full forename sharing the same initial', () => {
      const ev = nameMatchEvidence('J Smith', 'John Smith');
      expect(ev.matches).toBe(true);
      expect(ev.initialOnly).toBe(true);
    });

    test('different surnames never match regardless of forename', () => {
      const ev = nameMatchEvidence('John Smith', 'John Jones');
      expect(ev.matches).toBe(false);
      expect(ev.reason).toBe('Surnames differ');
    });

    test('two full, different forenames with the same surname do not match', () => {
      const ev = nameMatchEvidence('John Smith', 'James Smith');
      expect(ev.matches).toBe(false);
    });
  });
});
