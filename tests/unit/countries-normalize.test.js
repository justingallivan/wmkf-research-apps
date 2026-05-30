/**
 * Tests for the country list + ISO-2 normalizer used by the Stage 2a reviewer
 * accept form (payment-address country picker) and the context endpoint's
 * address prefill.
 *
 * @jest-environment node
 */

import { COUNTRIES, normalizeCountryToIso2, isIso2Country } from '../../shared/config/countries.js';

describe('countries config', () => {
  describe('COUNTRIES list integrity', () => {
    it('has unique uppercase 2-char codes', () => {
      const codes = COUNTRIES.map((c) => c.code);
      expect(new Set(codes).size).toBe(codes.length);
      for (const code of codes) {
        expect(code).toMatch(/^[A-Z]{2}$/);
      }
    });

    it('has a non-empty name for every entry', () => {
      for (const c of COUNTRIES) {
        expect(typeof c.name).toBe('string');
        expect(c.name.trim().length).toBeGreaterThan(0);
      }
    });

    it('includes the common reviewer countries', () => {
      const codes = new Set(COUNTRIES.map((c) => c.code));
      for (const expected of ['US', 'GB', 'CA', 'AU', 'DE', 'FR', 'CN', 'JP', 'IN']) {
        expect(codes.has(expected)).toBe(true);
      }
    });
  });

  describe('normalizeCountryToIso2', () => {
    it('passes through a valid code, uppercasing', () => {
      expect(normalizeCountryToIso2('US')).toBe('US');
      expect(normalizeCountryToIso2('us')).toBe('US');
      expect(normalizeCountryToIso2(' gb ')).toBe('GB');
    });

    it('maps a canonical full name to its code (case/space-insensitive)', () => {
      expect(normalizeCountryToIso2('United States')).toBe('US');
      expect(normalizeCountryToIso2('  united states  ')).toBe('US');
      expect(normalizeCountryToIso2('United Kingdom')).toBe('GB');
      expect(normalizeCountryToIso2('Canada')).toBe('CA');
    });

    it('maps known aliases', () => {
      expect(normalizeCountryToIso2('USA')).toBe('US');
      expect(normalizeCountryToIso2('U.S.A.')).toBe('US');
      expect(normalizeCountryToIso2('America')).toBe('US');
      expect(normalizeCountryToIso2('UK')).toBe('GB');
      expect(normalizeCountryToIso2('Great Britain')).toBe('GB');
      expect(normalizeCountryToIso2('England')).toBe('GB');
      expect(normalizeCountryToIso2('South Korea')).toBe('KR');
      expect(normalizeCountryToIso2('Czech Republic')).toBe('CZ');
      expect(normalizeCountryToIso2('Turkey')).toBe('TR');
    });

    it('returns "" for unmappable or empty input (caller defaults to picker)', () => {
      expect(normalizeCountryToIso2('Freedonia')).toBe('');
      expect(normalizeCountryToIso2('')).toBe('');
      expect(normalizeCountryToIso2('   ')).toBe('');
      expect(normalizeCountryToIso2(undefined)).toBe('');
      expect(normalizeCountryToIso2(null)).toBe('');
      expect(normalizeCountryToIso2(42)).toBe('');
    });

    it('does not coerce a 2-char string that is not a real code', () => {
      expect(normalizeCountryToIso2('ZZ')).toBe('');
      expect(normalizeCountryToIso2('XX')).toBe('');
    });

    it('every alias resolves to a code present in COUNTRIES', () => {
      // Guards against an alias pointing at a code we forgot to list.
      const aliasInputs = ['USA', 'UK', 'South Korea', 'Russia', 'UAE', 'Holland', 'Burma'];
      for (const a of aliasInputs) {
        const code = normalizeCountryToIso2(a);
        expect(code).not.toBe('');
        expect(isIso2Country(code)).toBe(true);
      }
    });
  });

  describe('isIso2Country', () => {
    it('recognizes listed codes case-insensitively and rejects others', () => {
      expect(isIso2Country('US')).toBe(true);
      expect(isIso2Country('us')).toBe(true);
      expect(isIso2Country('ZZ')).toBe(false);
      expect(isIso2Country('USA')).toBe(false);
      expect(isIso2Country(undefined)).toBe(false);
    });
  });
});
