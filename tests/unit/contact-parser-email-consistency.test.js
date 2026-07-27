/**
 * Unit tests for ContactParser.isNameConsistentEmail — the grounding guard that
 * rejects hallucinated / wrong-person emails from the Tier-3 (Claude web search)
 * and Tier-4 (SerpAPI) contact-enrichment lookups before they can be used to
 * send a reviewer invitation. Regression shapes come from the S220 bug where
 * the Workbench "Enrich recommended" flow attached a given-name-only address
 * to a fake reviewer and an unrelated address to a different same-named person.
 */

const { ContactParser } = require('../../lib/utils/contact-parser');

describe('ContactParser.isNameConsistentEmail', () => {
  describe('rejects fabricated / wrong-person emails (the S220 bug)', () => {
    test.each([
      ['alex@example.org', 'Alex Test3'],                   // fabricated, surname absent
      ['alex@example.org', 'Alex Test4'],
      ['other.person@example.org', 'Alex_test Mercer'],     // different same-search person
      ['someone.else@example.org', 'Amara Ann Khan'],
      ['labmanager@example.org', 'Ava Mercer'],
    ])('rejects %s for "%s"', (email, name) => {
      expect(ContactParser.isNameConsistentEmail(email, name)).toBe(false);
    });
  });

  describe('accepts name-consistent emails', () => {
    test.each([
      ['amercer@example.org', 'Ava Mercer'],                // first-initial + surname
      ['ava.mercer@example.org', 'Dr. Ava Mercer'],         // first.surname
      ['avamercer@example.org', 'Ava Mercer'],              // firstsurname, free webmail OK when surname present
      ['mercera@example.org', 'Ava Mercer'],                // surname + first-initial
      ['aakhan@example.org', 'Amara Ann Khan'],             // multi-initial + surname
      ['mercer@example.org', 'Ava Mercer'],                 // bare surname
    ])('accepts %s for "%s"', (email, name) => {
      expect(ContactParser.isNameConsistentEmail(email, name)).toBe(true);
    });
  });

  describe('surname-first and compound surnames (Codex S220 false-negative fixes)', () => {
    test.each([
      ['mvega@example.org', 'Vega Mira'],                   // surname-first order: initial(Mira) + surname(Vega)
      ['agarcia@example.org', 'Ariana Garcia Marquez'],     // compound surname, first component
      ['marquez@example.org', 'Ariana Garcia Marquez'],     // compound surname, last component (bare)
      ['npatel@example.org', 'Noor Patel'],
    ])('accepts %s for "%s"', (email, name) => {
      expect(ContactParser.isNameConsistentEmail(email, name)).toBe(true);
    });

    test('a lone given-name address is still rejected (does not regress #1)', () => {
      expect(ContactParser.isNameConsistentEmail('alex@example.org', 'Alex Test3')).toBe(false);
      expect(ContactParser.isNameConsistentEmail('ariana@example.org', 'Ariana Garcia Marquez')).toBe(false);
    });
  });

  describe('suffix / credential tokens and accents (Codex S221 false-negative fixes)', () => {
    test.each([
      ['mercer@example.org', 'Ava Mercer Jr'],              // generational suffix not the surname
      ['mercer@example.org', 'Ava Mercer Ph.D.'],           // credential not the surname
      ['mercer@example.org', 'Ava Mercer III'],             // roman-numeral suffix
      ['amercer@example.org', 'Ava Mercer MD'],             // initial+surname survives suffix strip
      ['ana.nunez@example.org', 'Ana Núñez'],               // accented surname normalizes to ASCII
      ['anunez@example.org', 'Ana Núñez'],                  // accented initial+surname
    ])('accepts %s for "%s"', (email, name) => {
      expect(ContactParser.isNameConsistentEmail(email, name)).toBe(true);
    });

    test('a name made only of suffix tokens yields no surname → false', () => {
      expect(ContactParser.isNameConsistentEmail('jr@example.org', 'Jr')).toBe(false);
    });

    test('suffix stripping must NOT collapse a 2-token name to a lone given name (Codex S221 false-accept)', () => {
      // "Alex MD" has no real surname once MD is stripped — a lone given-name
      // address must stay rejected, exactly as "Alex Test3" is.
      expect(ContactParser.isNameConsistentEmail('alex@example.org', 'Alex MD')).toBe(false);
      expect(ContactParser.isNameConsistentEmail('alex@example.org', 'Alex Jr')).toBe(false);
      // …but a real surname alongside the credential still works.
      expect(ContactParser.isNameConsistentEmail('mercer@example.org', 'Ava Mercer MD')).toBe(true);
    });
  });

  describe('defensive inputs', () => {
    test('null / empty / malformed return false', () => {
      expect(ContactParser.isNameConsistentEmail(null, 'Ava Mercer')).toBe(false);
      expect(ContactParser.isNameConsistentEmail('amercer@example.org', null)).toBe(false);
      expect(ContactParser.isNameConsistentEmail('', 'Ava Mercer')).toBe(false);
      expect(ContactParser.isNameConsistentEmail('not-an-email', 'Ava Mercer')).toBe(false);
      expect(ContactParser.isNameConsistentEmail('@example.org', 'Ava Mercer')).toBe(false);
    });
  });
});
