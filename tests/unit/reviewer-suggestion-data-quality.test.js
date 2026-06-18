/**
 * @jest-environment node
 *
 * S266 candidate data-quality fixes: at the single suggestion-ingestion chokepoint
 * (DiscoveryService.normalizeSuggestionSource) an unverified honorific is stripped
 * from the display name and a non-page (document) website is nulled, so BOTH the
 * verify path and the display/roster path see cleaned values. Also covers the
 * shared document gate on SerpContactService.isFacultyPageUrl.
 */

const { DiscoveryService } = require('../../lib/services/discovery-service');
const { SerpContactService } = require('../../lib/services/serp-contact-service');

const PDF = 'https://repositum.tuwien.at/bitstream/123/Treiber-2022-foo-vor.pdf';
const PROFILE = 'https://chem.x.edu/faculty/markus-kitzler-zeiler';

describe('normalizeSuggestionSource — honorific strip (Fix 3)', () => {
  test('strips an unverified honorific from the display name', () => {
    const out = DiscoveryService.normalizeSuggestionSource({ name: 'Prof. Markus Kitzler-Zeiler' });
    expect(out.name).toBe('Markus Kitzler-Zeiler');
    expect(out.source).toBe('claude_suggestion');
  });

  test('strips stacked honorifics ("Prof. Dr. …")', () => {
    const out = DiscoveryService.normalizeSuggestionSource({ name: 'Prof. Dr. Reinhard Dörner' });
    expect(out.name).toBe('Reinhard Dörner');
  });

  test('leaves a title-less name untouched and preserves an absent name', () => {
    expect(DiscoveryService.normalizeSuggestionSource({ name: 'Jane Doe' }).name).toBe('Jane Doe');
    expect(DiscoveryService.normalizeSuggestionSource({}).name).toBeUndefined();
  });
});

describe('normalizeSuggestionSource — website sanitize (Fix 2)', () => {
  test('nulls a document-file website', () => {
    const out = DiscoveryService.normalizeSuggestionSource({ name: 'Markus Kitzler-Zeiler', website: PDF });
    expect(out.website).toBeNull();
  });

  test('keeps a real profile-page website', () => {
    const out = DiscoveryService.normalizeSuggestionSource({ name: 'Markus Kitzler-Zeiler', website: PROFILE });
    expect(out.website).toBe(PROFILE);
  });

  test('leaves an absent website absent (not coerced to null)', () => {
    expect(DiscoveryService.normalizeSuggestionSource({ name: 'Jane Doe' })).not.toHaveProperty('website');
  });
});

describe('normalizeSuggestionSource — cleaning applies across all source branches', () => {
  test('applicant-recommended suggestions are also cleaned', () => {
    const out = DiscoveryService.normalizeSuggestionSource({
      name: 'Prof. Jane Doe', website: PDF, isApplicantRecommended: true,
    });
    expect(out.name).toBe('Jane Doe');
    expect(out.website).toBeNull();
    expect(out.source).toBe('applicant_recommended');
  });

  test('proposal-named suggestions are also cleaned', () => {
    const out = DiscoveryService.normalizeSuggestionSource({
      name: 'Dr. Jane Doe', website: PDF, source: 'Mentioned in proposal',
    });
    expect(out.name).toBe('Jane Doe');
    expect(out.website).toBeNull();
    expect(out.source).toBe('proposal_named');
  });
});

describe('SerpContactService.isFacultyPageUrl rejects document URLs (Fix 4)', () => {
  test('a name-matching faculty-pattern PDF is still rejected', () => {
    // /people/ + surname would otherwise pass; the document gate must win.
    expect(SerpContactService.isFacultyPageUrl(
      'https://chem.x.edu/people/kitzler/kitzler-2022.pdf',
      'Markus Kitzler-Zeiler',
    )).toBe(false);
  });

  test('a real faculty page still passes', () => {
    expect(SerpContactService.isFacultyPageUrl(
      'https://chem.x.edu/faculty/markus-kitzler-zeiler',
      'Markus Kitzler-Zeiler',
    )).toBe(true);
  });
});
