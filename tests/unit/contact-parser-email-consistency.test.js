/**
 * Unit tests for ContactParser.isNameConsistentEmail — the grounding guard that
 * rejects hallucinated / wrong-person emails from the Tier-3 (Claude web search)
 * and Tier-4 (SerpAPI) contact-enrichment lookups before they can be used to
 * send a reviewer invitation. Regression cases come from the S220 bug where the
 * Workbench "Enrich recommended" flow attached `justin@gmail.com` to a
 * 0-publication fake reviewer and `SarahRose888@boisestate.edu` to a different
 * same-named person.
 */

const { ContactParser } = require('../../lib/utils/contact-parser');

describe('ContactParser.isNameConsistentEmail', () => {
  describe('rejects fabricated / wrong-person emails (the S220 bug)', () => {
    test.each([
      ['justin@gmail.com', 'Justin Test3'],                 // fabricated, surname absent
      ['justin@gmail.com', 'Justin Test4'],
      ['SarahRose888@boisestate.edu', 'Justin_test Gallivan'], // different same-search person
      ['someone.else@stanford.edu', 'Li-Huei Tsai'],
      ['labmanager@mit.edu', 'Michael Greenberg'],
    ])('rejects %s for "%s"', (email, name) => {
      expect(ContactParser.isNameConsistentEmail(email, name)).toBe(false);
    });
  });

  describe('accepts name-consistent emails', () => {
    test.each([
      ['jgallivan@queensu.ca', 'Justin Gallivan'],          // first-initial + surname
      ['justin.gallivan@mit.edu', 'Dr. Justin Gallivan'],   // first.surname
      ['justingallivan@me.com', 'Justin Gallivan'],         // firstsurname, free webmail OK when surname present
      ['gallivanj@uw.edu', 'Justin Gallivan'],              // surname + first-initial
      ['lhtsai@mit.edu', 'Li-Huei Tsai'],                   // surname embedded
      ['madabhushi@utsouthwestern.edu', 'Ram Madabhushi'],
    ])('accepts %s for "%s"', (email, name) => {
      expect(ContactParser.isNameConsistentEmail(email, name)).toBe(true);
    });
  });

  describe('defensive inputs', () => {
    test('null / empty / malformed return false', () => {
      expect(ContactParser.isNameConsistentEmail(null, 'Justin Gallivan')).toBe(false);
      expect(ContactParser.isNameConsistentEmail('jgallivan@x.edu', null)).toBe(false);
      expect(ContactParser.isNameConsistentEmail('', 'Justin Gallivan')).toBe(false);
      expect(ContactParser.isNameConsistentEmail('not-an-email', 'Justin Gallivan')).toBe(false);
      expect(ContactParser.isNameConsistentEmail('@nolocal.edu', 'Justin Gallivan')).toBe(false);
    });
  });
});
