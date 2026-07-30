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
  expect(pickVettedEmail({
    email: 'ava.mercer@example.org',
    emailSource: 'claude_search',
    emailPersistAllowed: true,
    identityStatus: 'probable',
  }))
    .toEqual({ email: 'ava.mercer@example.org', source: 'claude_search' });
});

test('reads email/flags from contactEnrichment when top-level is absent', () => {
  expect(pickVettedEmail({
    contactEnrichment: {
      email: 'fixture@example.org',
      emailSource: 'affiliation',
      emailPersistAllowed: true,
      identity: { status: 'confirmed' },
    },
  }))
    .toEqual({ email: 'fixture@example.org', source: 'affiliation' });
});

test('null when not persistable (emailPersistAllowed !== true)', () => {
  expect(pickVettedEmail({
    email: 'fixture@example.org',
    emailSource: 'serp_search',
    emailPersistAllowed: false,
    identityStatus: 'probable',
  })).toBeNull();
});

test('null when identity is unresolved even if persistable', () => {
  expect(pickVettedEmail({
    email: 'fixture@example.org',
    emailSource: 'serp_search',
    emailPersistAllowed: true,
    needsIdentification: true,
  })).toBeNull();
  expect(pickVettedEmail({
    email: 'fixture@example.org',
    emailSource: 'serp_search',
    emailPersistAllowed: true,
    identityStatus: 'unresolved',
  })).toBeNull();
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
      expect(pickVettedEmail({
        email,
        emailSource: 'serp_search',
        emailPersistAllowed: true,
        identityStatus: 'probable',
      })).toBeNull();
    });
  }
  test('does NOT reject a legitimate address', () => {
    expect(pickVettedEmail({
      email: 'ava.mercer@example.org',
      emailSource: 'affiliation',
      emailPersistAllowed: true,
      identityStatus: 'probable',
    }))
      .toEqual({ email: 'ava.mercer@example.org', source: 'affiliation' });
  });
});

// S387 (second adversarial review). pickAssertedEmailPair answers a DIFFERENT question
// from pickVettedEmail: not "may this address be persisted" but "does this blob vouch for
// this address having this provenance". The distinction matters because a pruned roster row
// is not internally coherent — pruneCandidateForRoster stores `email: c.email || e.email`
// but `emailSource: e.emailSource`, so a top-level address that did NOT come from
// enrichment carries a top-level source describing the enrichment address instead.
describe('pickAssertedEmailPair', () => {
  const { pickAssertedEmailPair } = require('../../lib/utils/reviewer-vetted-email');
  const { pruneCandidateForRoster } = require('../../shared/components/reviewers/reviewer-search-logic');

  test('pairs a coherent blob (both addresses agree)', () => {
    expect(pickAssertedEmailPair({
      email: 'ava.mercer@example.org',
      contactEnrichment: { email: 'ava.mercer@example.org', emailSource: 'institution_page' },
    })).toEqual({ email: 'ava.mercer@example.org', source: 'institution_page' });
  });

  test('pairs when only one side carries an address', () => {
    expect(pickAssertedEmailPair({ email: 'a@x.edu', emailSource: 'affiliation' }))
      .toEqual({ email: 'a@x.edu', source: 'affiliation' });
    expect(pickAssertedEmailPair({ contactEnrichment: { email: 'a@x.edu', emailSource: 'orcid' } }))
      .toEqual({ email: 'a@x.edu', source: 'orcid' });
  });

  // THE REGRESSION. Built from real prune output so it fails if prune's field derivation
  // ever changes underneath this reasoning: the pruned row ends up with the manual
  // top-level address and enrichment's institution_page source, which describes the OTHER
  // address. Pairing those would assert provenance that was never evidence for it.
  test('rejects a pruned blob whose two addresses disagree', () => {
    const pruned = pruneCandidateForRoster({
      name: 'Ava Mercer',
      email: 'new@school.edu', // e.g. a hand-correction or promoted lead
      contactEnrichment: { email: 'old@lab.edu', emailSource: 'institution_page' },
    });
    // Prune really does produce the contaminated shape this guards against.
    expect(pruned.email).toBe('new@school.edu');
    expect(pruned.emailSource).toBe('institution_page');
    expect(pruned.contactEnrichment.email).toBe('old@lab.edu');

    expect(pickAssertedEmailPair(pruned)).toBeNull();
  });

  test('rejects a blob with no source at all, and a non-object', () => {
    expect(pickAssertedEmailPair({ email: 'a@x.edu' })).toBeNull();
    expect(pickAssertedEmailPair({ email: 'a@x.edu', contactEnrichment: { email: 'a@x.edu' } })).toBeNull();
    expect(pickAssertedEmailPair(null)).toBeNull();
    expect(pickAssertedEmailPair('nope')).toBeNull();
  });

  test('address comparison ignores case and surrounding whitespace', () => {
    expect(pickAssertedEmailPair({
      email: ' Ava.Mercer@Example.org ',
      contactEnrichment: { email: 'ava.mercer@example.org', emailSource: 'pubmed' },
    })).toEqual({ email: 'Ava.Mercer@Example.org', source: 'pubmed' });
  });
});
