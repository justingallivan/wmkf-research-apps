/** @jest-environment node */
const { IntegrityMatchingService: M } = require('../../lib/services/integrity-matching-service');
const { integrityIdentityLabel } = require('../../shared/utils/integrity-evidence');

test.each([
  ['Anthony Leung', 'Robert A Leung'], ['Scott Bailey', 'Aileen M Bailey'],
  ['John Smith', 'James Smith'], ['John A Smith', 'John B Smith'],
  ['John Alice Smith', 'John Amanda Smith'], ['', ''], [null, null],
  ['Leung', 'Anthony Leung'], ['Aileen M Bailey', 'Scott Bailey'],
])('rejects conflicting or unusable names: %s / %s', (a, b) => {
  expect(M.calculateNameMatch(a, b).matches).toBe(false);
});

test.each([
  ['Yuan He', 'Yuan He', 'exact_name'],
  ['Anthony Leung', 'A Leung', 'compatible_initials'],
  ['Robert Smith', 'Bob Smith', 'recognized_variant'],
  ['Yu He', 'Yuan He', 'ambiguous_name'],
  ['Wei Zhang', 'Zhang Wei', 'ambiguous_name'],
  ['Robert A Leung', 'RA Leung', 'compatible_initials'],
  ['Robert A Leung', 'R.A. Leung', 'compatible_initials'],
  ['John A Smith', 'John Smith', 'ambiguous_name'],
  ['José Smith-Jones', 'Jose Smith-Jones', 'exact_name'],
  ['Smith, John', 'John Smith', 'exact_name'],
  ['John Smith, Jr.', 'John Smith', 'exact_name'],
  ['Leung', 'Leung', 'ambiguous_name'],
])('retains candidate without asserting identity: %s / %s', (a, b, nameEvidence) => {
  const result = M.calculateNameMatch(a, b);
  expect(result).toMatchObject({ matches: true, matchingVersion: 2, identityStatus: 'unverified', nameEvidence });
  expect(integrityIdentityLabel(result)).toMatch(/identity unverified/);
  expect(integrityIdentityLabel(result)).not.toMatch(/%|high/i);
});

test('unknown and legacy evidence is never a positive identity claim', () => {
  expect(integrityIdentityLabel({ confidence: 100 })).toBe('Earlier matching rules · identity not established');
  expect(integrityIdentityLabel({ matchingVersion: 2, identityStatus: 'verified', nameEvidence: 'exact_name' })).toBe('Identity unverified');
  expect(integrityIdentityLabel({ matchingVersion: 2, identityStatus: 'unverified', nameEvidence: 'toString' })).toBe('Identity unverified');
});
