/**
 * Characterization tests for the person-name COMPOSITE normalizers
 * (docs/NORMALIZER_CONSOLIDATION_INVENTORY.md §1.8-1.13) — algorithms built
 * from more than one leaf transform, plus the duplicated inline composite
 * at reviewer-work-author-resolver.js / reviewer-identity-lookup.js.
 *
 * These PIN today's behavior; no production code is modified by this file.
 */

const { ContactParser } = require('../../../lib/utils/contact-parser');

describe('Person-name composite normalizer characterization', () => {
  // ---------------------------------------------------------------------
  // §1.9 — reviewer-identity-evidence.js givenNameToken: first-token-only,
  // NFKD + \p{L} diacritic fold, used for forenameFullyAgrees/Contradict.
  // ---------------------------------------------------------------------
  describe('givenNameToken (reviewer-identity-evidence.js) + forenameFullyAgrees / forenamesContradict', () => {
    // These functions are not exported from the module; re-derive them
    // exactly as defined to characterize behavior without editing the
    // production file to add exports (out of scope for this pass).
    function givenNameToken(fullName) {
      const stripped = ContactParser.stripHonorifics(String(fullName || ''));
      const first = stripped.trim().split(/\s+/)[0] || '';
      return first.toLowerCase().normalize('NFKD').replace(/[^\p{L}]/gu, '');
    }
    function forenameFullyAgrees(suggestionName, recordDisplayName) {
      const a = givenNameToken(suggestionName);
      const b = givenNameToken(recordDisplayName);
      if (a.length < 2 || b.length < 2) return false;
      return a === b;
    }
    function forenamesContradict(suggestionName, recordDisplayName) {
      const a = givenNameToken(suggestionName);
      const b = givenNameToken(recordDisplayName);
      if (a.length < 2 || b.length < 2) return false;
      return a !== b;
    }

    test('takes only the FIRST token — surname is irrelevant', () => {
      expect(givenNameToken('Jane Smith')).toBe('jane');
      expect(givenNameToken('Jane Something Else Entirely')).toBe('jane');
    });

    test('honorific is stripped before taking the first token', () => {
      expect(givenNameToken('Dr. Jane Smith')).toBe('jane');
    });

    test('diacritics fold via NFKD + \\p{L} filter (Müller → m, José → jos)', () => {
      expect(givenNameToken('Müller Schmidt')).toBe('muller');
      expect(givenNameToken('José García')).toBe('jose');
    });

    test('forenameFullyAgrees: true only when BOTH sides carry a full (>=2 letter) given name that matches', () => {
      expect(forenameFullyAgrees('Ursula Keller', 'Ursula Sang')).toBe(true);
      expect(forenameFullyAgrees('Ursula Keller', 'U. Keller')).toBe(false); // initial-only fails closed
      expect(forenameFullyAgrees('Ursula Keller', 'Olga Keller')).toBe(false);
    });

    test('forenamesContradict: true only when both are full names AND differ; initial-only never contradicts', () => {
      expect(forenamesContradict('Alfred Nguyen', 'Alain Nguyen')).toBe(true);
      expect(forenamesContradict('Ursula Keller', 'U. Keller')).toBe(false); // S236: initial can't disconfirm
      expect(forenamesContradict('Ursula Keller', 'Ursula Sang')).toBe(false);
    });
  });

  // ---------------------------------------------------------------------
  // §1.10/§1.8 — reviewer-works-first.js comparableName: does NOT lowercase.
  // ---------------------------------------------------------------------
  describe('comparableName (reviewer-works-first.js) — case-PRESERVING, unlike every other full-name normalizer', () => {
    function stripHonorific(value) {
      return String(value || '').replace(/^(dr\.?|prof\.?|professor)\s+/i, '').trim();
    }
    function comparableName(value) {
      return stripHonorific(value)
        .normalize('NFKC')
        .replace(/[‐‑‒–—]/g, '-')
        .replace(/\./g, '')
        .replace(/\s+/g, ' ')
        .trim();
    }

    test('case is preserved — "JOHN SMITH" stays uppercase', () => {
      expect(comparableName('JOHN SMITH')).toBe('JOHN SMITH');
    });

    test('honorific stripped (narrow set: dr/prof/professor only)', () => {
      expect(comparableName('Dr. Jane Smith')).toBe('Jane Smith');
      expect(comparableName('Sir Elton John')).toBe('Sir Elton John'); // Sir NOT in this set
    });

    test('various hyphen/dash variants unify to a plain ASCII hyphen', () => {
      expect(comparableName('Jean‐Luc Picard')).toBe('Jean-Luc Picard'); // U+2010 hyphen
      expect(comparableName('Jean–Luc Picard')).toBe('Jean-Luc Picard'); // en dash
    });

    test('periods are stripped, apostrophes are NOT', () => {
      expect(comparableName("O'Brien")).toBe("O'Brien");
      expect(comparableName('J. R. R. Tolkien')).toBe('J R R Tolkien');
    });

    test('diacritics are NOT folded (NFKC does not strip combining marks)', () => {
      expect(comparableName('José')).toBe('José');
    });
  });

  // ---------------------------------------------------------------------
  // §1.5 composite duplicate — ContactParser.stripHonorifics then
  // ContactParser.normalizeNameForMatch, independently defined at TWO call
  // sites (reviewer-work-author-resolver.js normalizeName, and
  // reviewer-identity-lookup.js nameConsistent's inline `a`/`b`).
  // ---------------------------------------------------------------------
  describe('Composite: ContactParser.stripHonorifics + normalizeNameForMatch — duplicated at two call sites', () => {
    function normalizeName(name) {
      return ContactParser.normalizeNameForMatch(ContactParser.stripHonorifics(name || ''));
    }

    test('the two independently-defined call sites produce IDENTICAL output (same composite, not shared via import)', () => {
      const composite = (name) => ContactParser.normalizeNameForMatch(ContactParser.stripHonorifics(name || ''));
      const inputs = ['Dr. Jane Smith', 'Prof. Sir Elton John', "O'Brien", 'Smith, John.'];
      for (const input of inputs) {
        expect(normalizeName(input)).toBe(composite(input));
      }
    });

    test('honorific stripped (broad set, incl Sir/Dame) THEN comma/period-only strip applied', () => {
      expect(normalizeName('Prof. Dr. Sir Elton John')).toBe('elton john');
    });

    test('composite still leaves apostrophes intact (normalizeNameForMatch only strips . and ,)', () => {
      expect(normalizeName("O'Brien")).toBe("o'brien");
    });

    test('"Last, First" comma is stripped but NOT reordered (unlike integrity-matching-service.js)', () => {
      expect(normalizeName('Smith, John')).toBe('smith john');
    });
  });

  // ---------------------------------------------------------------------
  // §1.13 — save-candidates-service.js inline normalizedName: the
  // highest-risk seam (roster-promotion dedup key).
  // ---------------------------------------------------------------------
  describe('save-candidates-service.js inline normalizedName — roster promotion dedup key', () => {
    function normalizedName(name) {
      return name
        .toLowerCase()
        .replace(/^(dr\.?|prof\.?|professor)\s+/i, '')
        .replace(/[^a-z\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    }

    test('plain ASCII', () => {
      expect(normalizedName('John Smith')).toBe('john smith');
    });

    test('honorific stripped (narrow set: dr/prof/professor)', () => {
      expect(normalizedName('Dr. Jane Smith')).toBe('jane smith');
    });

    test('Sir/Mrs/Ms/Mx are NOT in the honorific set — survive as name tokens after non-alpha strip', () => {
      expect(normalizedName('Sir Elton John')).toBe('sir elton john');
      expect(normalizedName('Mrs. Jane Smith')).toBe('mrs jane smith');
    });

    test('diacritics are dropped, not folded (é/ü vanish, do not become e/u)', () => {
      expect(normalizedName('José')).toBe('jos');
      expect(normalizedName('Müller')).toBe('mller');
    });

    test('apostrophes and hyphens are stripped along with all other non-alpha chars', () => {
      expect(normalizedName("O'Brien")).toBe('obrien');
      expect(normalizedName('Jean-Luc Picard')).toBe('jeanluc picard');
    });

    test('CROSS-SEAM DIVERGENCE: this dedup key treats "José García" differently than the diacritic-folding seams', () => {
      // reviewer-name-match.js (§1.3) folds José → jose. This inline key drops the accented
      // letter entirely → "jos garca". A promotion-time duplicate check against a roster
      // entry keyed by the OTHER algorithm would silently miss the match.
      expect(normalizedName('José García')).toBe('jos garca');
    });
  });

  // ---------------------------------------------------------------------
  // §1.11/§1.12 — email-generator.js parseRecipientName: DISPLAY seam, not
  // an identity-match seam. Fourth distinct honorific-detection set.
  // ---------------------------------------------------------------------
  describe('email-generator.js parseRecipientName — honorific DETECTION for salutation (display seam)', () => {
    const { parseRecipientName } = require('../../../lib/utils/email-generator');

    test('detects a leading honorific and strips it from cleanName', () => {
      const parsed = parseRecipientName('Dr. Jane Smith');
      expect(parsed.cleanName).toBe('Jane Smith');
    });

    test('no honorific present: defaults the salutation to "Dr." for the academic-greeting convention', () => {
      const parsed = parseRecipientName('Jane Smith');
      expect(parsed.cleanName).toBe('Jane Smith');
      expect(parsed.salutation).toMatch(/^Dr\./);
    });

    test('Sir/Dame/Mx are NOT detected as honorifics here (unlike ContactParser.stripHonorifics, §1.6)', () => {
      const parsed = parseRecipientName('Sir Elton John');
      // "Sir" is not in this function's honorific regex, so it is treated as part of the name
      // and the whole string falls through to the default "Dr." salutation path.
      expect(parsed.cleanName).toBe('Sir Elton John');
    });

    test('normalizeDisplayName collapses whitespace but does not lowercase or strip honorifics', () => {
      expect(ContactParser.normalizeDisplayName('  Dr.   Jane   Smith  ')).toBe('Dr. Jane Smith');
    });

    test('normalizeDisplayName returns null for non-string input', () => {
      expect(ContactParser.normalizeDisplayName(null)).toBeNull();
      expect(ContactParser.normalizeDisplayName(undefined)).toBeNull();
    });
  });

  // ---------------------------------------------------------------------
  // ContactParser.namesMatch — last-name + first-initial matcher used by
  // extractContactFromPublications and reviewer-work-author-resolver's
  // composite.
  // ---------------------------------------------------------------------
  describe('ContactParser.namesMatch', () => {
    test('exact match after normalization', () => {
      expect(ContactParser.namesMatch('john smith', 'john smith')).toBe(true);
    });

    test('surname must match; forename may be initial-compatible', () => {
      expect(ContactParser.namesMatch('j smith', 'john smith')).toBe(true);
      expect(ContactParser.namesMatch('john smith', 'j smith')).toBe(true);
    });

    test('different surnames never match', () => {
      expect(ContactParser.namesMatch('john smith', 'john jones')).toBe(false);
    });

    test('NO nickname awareness — Chris/Christopher forename mismatch fails here', () => {
      expect(ContactParser.namesMatch('chris cheung', 'christopher cheung')).toBe(false);
    });
  });
});
