/**
 * @jest-environment node
 */

const { buildScholarSearchUrl, isRealScholarProfileUrl } = require('../../lib/utils/scholar-url');

describe('isRealScholarProfileUrl', () => {
  test('true only for a real author profile (citations?user=<id>)', () => {
    expect(isRealScholarProfileUrl('https://scholar.google.com/citations?user=ABC123')).toBe(true);
    expect(isRealScholarProfileUrl('https://scholar.google.com/citations?hl=en&user=ABC123')).toBe(true);
  });

  test('false for an author SEARCH url (what enrichment stores by default)', () => {
    // The exact shape produced by buildGoogleScholarUrl / buildScholarSearchUrl.
    const search = buildScholarSearchUrl('Andreas Becker', 'University of Colorado Boulder');
    expect(search).toMatch(/view_op=search_authors/);
    expect(isRealScholarProfileUrl(search)).toBe(false);
    expect(isRealScholarProfileUrl(
      'https://scholar.google.com/citations?view_op=search_authors&mauthors=Tom%20Weinacht',
    )).toBe(false);
  });

  test('false for empty / malformed / non-scholar input', () => {
    expect(isRealScholarProfileUrl(null)).toBe(false);
    expect(isRealScholarProfileUrl('')).toBe(false);
    expect(isRealScholarProfileUrl('not a url')).toBe(false);
    expect(isRealScholarProfileUrl('https://example.com/citations?user=ABC123')).toBe(false);
    // a search_authors url that *also* happens to carry a user param is still a search
    expect(isRealScholarProfileUrl(
      'https://scholar.google.com/citations?view_op=search_authors&user=ABC123',
    )).toBe(false);
  });
});
