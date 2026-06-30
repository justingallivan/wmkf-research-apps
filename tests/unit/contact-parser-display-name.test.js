/**
 * @jest-environment node
 */

const { ContactParser } = require('../../lib/utils/contact-parser');

describe('ContactParser.normalizeDisplayName', () => {
  test('trims a trailing space (the "Dear Name ," bug)', () => {
    expect(ContactParser.normalizeDisplayName('Test Case ')).toBe('Test Case');
  });

  test('trims leading whitespace', () => {
    expect(ContactParser.normalizeDisplayName('  Test Case')).toBe('Test Case');
  });

  test('collapses internal runs of whitespace to a single space', () => {
    expect(ContactParser.normalizeDisplayName('Test  Case')).toBe('Test Case');
    expect(ContactParser.normalizeDisplayName('Test\tCase')).toBe('Test Case');
  });

  test('preserves honorifics and casing (NOT match-normalization)', () => {
    expect(ContactParser.normalizeDisplayName('Dr. Jane  Smith ')).toBe('Dr. Jane Smith');
  });

  test('returns null for empty / whitespace-only / non-string input', () => {
    expect(ContactParser.normalizeDisplayName('')).toBeNull();
    expect(ContactParser.normalizeDisplayName('   ')).toBeNull();
    expect(ContactParser.normalizeDisplayName(null)).toBeNull();
    expect(ContactParser.normalizeDisplayName(undefined)).toBeNull();
    expect(ContactParser.normalizeDisplayName(42)).toBeNull();
  });
});
