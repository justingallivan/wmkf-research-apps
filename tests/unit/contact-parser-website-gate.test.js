/**
 * @jest-environment node
 */

const { ContactParser } = require('../../lib/utils/contact-parser');

describe('ContactParser website name gate', () => {
  test('rejects mismatched personal/profile slugs', () => {
    expect(ContactParser.isUsefulWebsiteUrl(
      'https://www.linkedin.com/in/john-fazakerley',
      'Robert Sang',
    )).toBe(false);
  });

  test('accepts personal/profile slugs containing candidate forename or surname', () => {
    expect(ContactParser.isUsefulWebsiteUrl(
      'https://www.linkedin.com/in/robert-sang-123',
      'Robert Sang',
    )).toBe(true);
    expect(ContactParser.isUsefulWebsiteUrl(
      'https://github.com/sang-lab',
      'Robert Sang',
    )).toBe(true);
  });
});

describe('ContactParser.isDocumentUrl', () => {
  test('flags document/media file paths (any case, query ignored)', () => {
    for (const url of [
      'https://repositum.tuwien.at/bitstream/123/Treiber-2022-foo-vor.pdf',
      'https://x.edu/papers/SLIDES.PPTX',
      'https://x.edu/cv.docx',
      'https://x.edu/data.xlsx',
      'https://x.edu/notes.ppt',
      'https://x.edu/sheet.xls',
      'https://x.edu/file.doc',
      'https://x.edu/figure.ps',
      'https://x.edu/readme.txt',
      'https://x.edu/table.csv',
      'https://x.edu/bundle.zip',
      'https://x.edu/cv.pdf?dl=1#page=2',
    ]) {
      expect(ContactParser.isDocumentUrl(url)).toBe(true);
    }
  });

  test('does not flag navigable pages or malformed/empty input', () => {
    expect(ContactParser.isDocumentUrl('https://chem.x.edu/faculty/jane-doe')).toBe(false);
    expect(ContactParser.isDocumentUrl('https://x.edu/profile.html')).toBe(false);
    expect(ContactParser.isDocumentUrl('not a url')).toBe(false);
    expect(ContactParser.isDocumentUrl('')).toBe(false);
    expect(ContactParser.isDocumentUrl(null)).toBe(false);
  });
});

describe('ContactParser website gate rejects document URLs (S266)', () => {
  test('a paper PDF is never a useful website, even with a name match', () => {
    // The Kitzler-Zeiler case: a co-author Treiber PDF stored as the website.
    expect(ContactParser.isUsefulWebsiteUrl(
      'https://repositum.tuwien.at/bitstream/123/Treiber-2022-foo-vor.pdf',
      'Markus Kitzler-Zeiler',
    )).toBe(false);
    // Even a candidate-named PDF (a CV file) is rejected as a *website*.
    expect(ContactParser.isUsefulWebsiteUrl(
      'https://chem.x.edu/people/jane-doe/jane-doe-cv.pdf',
      'Jane Doe',
    )).toBe(false);
  });

  test('sanitizeWebsiteForCandidate nulls a document URL, keeps a real profile page', () => {
    expect(ContactParser.sanitizeWebsiteForCandidate(
      'https://repositum.tuwien.at/bitstream/123/Treiber-2022-foo-vor.pdf',
      'Markus Kitzler-Zeiler',
    )).toBeNull();
    expect(ContactParser.sanitizeWebsiteForCandidate(
      'https://chem.x.edu/faculty/markus-kitzler-zeiler',
      'Markus Kitzler-Zeiler',
    )).toBe('https://chem.x.edu/faculty/markus-kitzler-zeiler');
  });
});
