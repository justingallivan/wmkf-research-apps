/**
 * @jest-environment node
 *
 * Guards the S211 affiliation-aware Scholar disambiguation: the Scholar lookup
 * must reject a profile whose snippet names a DIFFERENT institution than the
 * candidate's known affiliation (wrong-person match), while keeping correct
 * matches and staying keep-biased when the snippet is ambiguous.
 *
 * Fixtures include the 4 real request-1002794 cases that motivated the fix.
 */
const { SerpContactService } = require('../../lib/services/serp-contact-service');

describe('SerpContactService.extractInstitution', () => {
  test('pulls the institution from a messy affiliation', () => {
    expect(SerpContactService.extractInstitution('Department of Physics, University of Ottawa, Ottawa, ON, Canada'))
      .toMatch(/University of Ottawa/i);
  });
  test('passes a clean applicant org through', () => {
    expect(SerpContactService.extractInstitution('Ohio State University')).toBe('Ohio State University');
  });
  test('empty → empty', () => {
    expect(SerpContactService.extractInstitution('')).toBe('');
    expect(SerpContactService.extractInstitution(null)).toBe('');
  });
});

describe('SerpContactService.institutionConflicts — real 1002794 cases', () => {
  // KEEP (correct matches): distinctive-word overlap with the snippet.
  test('Corkum: Ottawa vs Ottawa snippet → keep', () => {
    expect(SerpContactService.institutionConflicts(
      'University of Ottawa',
      'Professor, Department of Physics, University of Ottawa - Cited by 77,000')).toBe(false);
  });
  test('Weinacht: Stony Brook vs Stony Brook snippet → keep', () => {
    expect(SerpContactService.institutionConflicts(
      'Stony Brook University',
      'Stony Brook University, Department of Physics and Astronomy - Cited by 6,000')).toBe(false);
  });
  test('Le: Connecticut vs Connecticut snippet → keep', () => {
    expect(SerpContactService.institutionConflicts(
      'University of Connecticut',
      'University of Connecticut - Cited by 7,000 - atomic physics')).toBe(false);
  });

  // REJECT (wrong person): no distinctive overlap + snippet names another institution.
  test('Landsman: Ohio State vs Harvard/MGH snippet → reject', () => {
    expect(SerpContactService.institutionConflicts(
      'Ohio State University',
      'Massachusetts General Hospital, Harvard Medical School - Cited by 46')).toBe(true);
  });
  test('Becker: U. Colorado vs Göttingen medical center snippet → reject', () => {
    expect(SerpContactService.institutionConflicts(
      'University of Colorado',
      'University Medical Center, Göttingen, Germany - Child Psychiatry - Cited by 14,000')).toBe(true);
  });
});

describe('SerpContactService.institutionConflicts — keep-biased edge cases', () => {
  test('empty snippet → keep (cannot judge)', () => {
    expect(SerpContactService.institutionConflicts('Ohio State University', '')).toBe(false);
  });
  test('empty known affiliation → keep', () => {
    expect(SerpContactService.institutionConflicts('', 'Harvard University - Cited by 9000')).toBe(false);
  });
  test('snippet has no institution keyword → keep', () => {
    expect(SerpContactService.institutionConflicts('Ohio State University', 'Physicist - Cited by 1200 - quantum optics')).toBe(false);
  });
  test('MIT acronym snippet vs full-name known → keep (no false reject)', () => {
    // snippet "MIT" alone has no institution keyword → keep-biased, not rejected.
    expect(SerpContactService.institutionConflicts('Massachusetts Institute of Technology', 'MIT - Cited by 5000')).toBe(false);
  });
});
