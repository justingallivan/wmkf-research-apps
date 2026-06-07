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
