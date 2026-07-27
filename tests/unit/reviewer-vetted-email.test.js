/**
 * @jest-environment node
 *
 * pickVettedEmail — the shared persist gate used by promote (B1) and the
 * reconciler (A). Verifies the vetted/persistable/identity envelope AND the
 * anti-scrape munge rejection (S317 review: the reconciler would otherwise
 * auto-persist a `nospam`-munged address).
 */
const { pickVettedEmail } = require('../../lib/utils/reviewer-vetted-email');

test('returns email + vetted source for a persistable, resolved candidate', () => {
  expect(pickVettedEmail({ email: 'ava.mercer@example.org', emailSource: 'claude_search', emailPersistAllowed: true }))
    .toEqual({ email: 'ava.mercer@example.org', source: 'claude_search' });
});

test('reads email/flags from contactEnrichment when top-level is absent', () => {
  expect(pickVettedEmail({ contactEnrichment: { email: 'fixture@example.org', emailSource: 'affiliation', emailPersistAllowed: true } }))
    .toEqual({ email: 'fixture@example.org', source: 'affiliation' });
});

test('null when not persistable (emailPersistAllowed !== true)', () => {
  expect(pickVettedEmail({ email: 'fixture@example.org', emailSource: 'serp_search', emailPersistAllowed: false })).toBeNull();
});

test('null when identity is unresolved even if persistable', () => {
  expect(pickVettedEmail({ email: 'fixture@example.org', emailPersistAllowed: true, needsIdentification: true })).toBeNull();
  expect(pickVettedEmail({ email: 'fixture@example.org', emailPersistAllowed: true, identityStatus: 'unresolved' })).toBeNull();
});

test('null for no email / bad input', () => {
  expect(pickVettedEmail({ emailPersistAllowed: true })).toBeNull();
  expect(pickVettedEmail(null)).toBeNull();
});

describe('anti-scrape munge rejection', () => {
  const cases = [
    'researcher@nospam.example.org',
    'jane@no-spam.example.org',
    'x@no.spam.example.org',
    'removethis-jane@example.org',
    'jane.removeme@example.org',
    'deletethis@example.org',
    'contact@spamfree.example.org',
    'yourname@example.org',
  ];
  for (const email of cases) {
    test(`rejects ${email} even when enrichment blessed it`, () => {
      expect(pickVettedEmail({ email, emailSource: 'serp_search', emailPersistAllowed: true })).toBeNull();
    });
  }
  test('does NOT reject a legitimate address', () => {
    expect(pickVettedEmail({ email: 'ava.mercer@example.org', emailSource: 'affiliation', emailPersistAllowed: true }))
      .toEqual({ email: 'ava.mercer@example.org', source: 'affiliation' });
  });
});
