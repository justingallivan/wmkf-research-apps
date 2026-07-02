/**
 * @jest-environment node
 *
 * pickVettedEmail — the shared persist gate used by promote (B1) and the
 * reconciler (A). Verifies the vetted/persistable/identity envelope AND the
 * anti-scrape munge rejection (S317 review: the reconciler would otherwise
 * auto-persist `pollina@nospam.wustl.edu`).
 */
const { pickVettedEmail } = require('../../lib/utils/reviewer-vetted-email');

test('returns email + vetted source for a persistable, resolved candidate', () => {
  expect(pickVettedEmail({ email: 'jun.ye@colorado.edu', emailSource: 'claude_search', emailPersistAllowed: true }))
    .toEqual({ email: 'jun.ye@colorado.edu', source: 'claude_search' });
});

test('reads email/flags from contactEnrichment when top-level is absent', () => {
  expect(pickVettedEmail({ contactEnrichment: { email: 'a@b.edu', emailSource: 'affiliation', emailPersistAllowed: true } }))
    .toEqual({ email: 'a@b.edu', source: 'affiliation' });
});

test('null when not persistable (emailPersistAllowed !== true)', () => {
  expect(pickVettedEmail({ email: 'a@b.edu', emailSource: 'serp_search', emailPersistAllowed: false })).toBeNull();
});

test('null when identity is unresolved even if persistable', () => {
  expect(pickVettedEmail({ email: 'a@b.edu', emailPersistAllowed: true, needsIdentification: true })).toBeNull();
  expect(pickVettedEmail({ email: 'a@b.edu', emailPersistAllowed: true, identityStatus: 'unresolved' })).toBeNull();
});

test('null for no email / bad input', () => {
  expect(pickVettedEmail({ emailPersistAllowed: true })).toBeNull();
  expect(pickVettedEmail(null)).toBeNull();
});

describe('anti-scrape munge rejection', () => {
  const cases = [
    'pollina@nospam.wustl.edu',
    'jane@no-spam.uni.edu',
    'x@no.spam.edu',
    'removethis-jane@uni.edu',
    'jane.removeme@uni.edu',
    'deletethis@uni.edu',
    'contact@spamfree.uni.edu',
    'yourname@uni.edu',
  ];
  for (const email of cases) {
    test(`rejects ${email} even when enrichment blessed it`, () => {
      expect(pickVettedEmail({ email, emailSource: 'serp_search', emailPersistAllowed: true })).toBeNull();
    });
  }
  test('does NOT reject a legitimate address', () => {
    expect(pickVettedEmail({ email: 'silvaa@mednet.ucla.edu', emailSource: 'affiliation', emailPersistAllowed: true }))
      .toEqual({ email: 'silvaa@mednet.ucla.edu', source: 'affiliation' });
  });
});
