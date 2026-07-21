/**
 * @jest-environment node
 *
 * Producer contract for lib/services/reviewer-identity-lookup.js: every lookup
 * outcome declares the complete reviewer identity set surfaced by adapter inputs
 * so save-time COI screening cannot lose rows hidden by branch-specific shapes.
 */

jest.mock('../../lib/dataverse/adapters/potential-reviewer', () => ({
  findByOrcidCandidates: jest.fn(),
  findByEmailCandidates: jest.fn(),
  findByContactId: jest.fn(),
  searchByName: jest.fn(),
}));
jest.mock('../../lib/dataverse/adapters/contact', () => ({
  findByOrcidCandidates: jest.fn(),
  findByEmailCandidates: jest.fn(),
  searchByName: jest.fn(),
}));

const potentialReviewerAdapter = require('../../lib/dataverse/adapters/potential-reviewer');
const contactAdapter = require('../../lib/dataverse/adapters/contact');
const { lookupReviewerIdentity } = require('../../lib/services/reviewer-identity-lookup');

const REVIEWER_A = '11111111-1111-4111-8111-111111111111';
const REVIEWER_B = '22222222-2222-4222-8222-222222222222';
const CONTACT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CONTACT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ORCID = '0000-0002-1825-0097';
const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function none() {
  return { none: true };
}

function reviewerRow(id, overrides = {}) {
  return {
    wmkf_potentialreviewersid: id,
    wmkf_name: 'Ada Lovelace',
    wmkf_emailaddress: 'ada@example.edu',
    wmkf_primaryaffiliation: 'Applicant University',
    _wmkf_contact_value: null,
    statecode: 0,
    ...overrides,
  };
}

function contactRow(id, overrides = {}) {
  return {
    contactid: id,
    fullname: 'Ada Lovelace',
    emailaddress1: 'ada@example.edu',
    statecode: 0,
    ...overrides,
  };
}

function fixtureRows(result) {
  if (!result) return [];
  if (Array.isArray(result)) return result.filter(Boolean);
  if (result.none) return [];
  if (result.one) return result.row ? [result.row] : [];
  if (result.ambiguous) return Array.isArray(result.rows) ? result.rows.filter(Boolean) : [];
  return typeof result === 'object' ? [result] : [];
}

function affiliationFromReviewerRow(row) {
  return row?.wmkf_primaryaffiliation || row?.wmkf_organizationname || null;
}

function institutionEvidenceFromReviewerRow(row) {
  const entries = [
    { value: row?.wmkf_maininstitution, source: 'staff_confirmed' },
    { value: row?.wmkf_primaryaffiliation, source: 'primary_affiliation' },
    { value: row?.wmkf_organizationname, source: 'organization' },
  ];
  const seen = new Set();
  return entries.flatMap((entry) => {
    const value = typeof entry.value === 'string' ? entry.value.trim() : '';
    const key = value.toLowerCase();
    if (!value || seen.has(key)) return [];
    seen.add(key);
    return [{ value, source: entry.source }];
  });
}

function nameOnly(signals) {
  return signals.size > 0 && [...signals].every((signal) => signal === 'name');
}

function addExpected(map, id, signal, row = null) {
  const clean = typeof id === 'string' ? id.trim() : '';
  if (!clean) return;
  const key = clean.toLowerCase();
  let entry = map.get(key);
  if (!entry) {
    entry = { id: clean, row: null, signals: new Set() };
    map.set(key, entry);
  }
  entry.signals.add(signal);
  if (row && (!entry.row || (!affiliationFromReviewerRow(entry.row) && affiliationFromReviewerRow(row)))) {
    entry.row = row;
  }
}

function expectedRefsFromFixtures(fixtures = []) {
  const reviewers = new Map();
  const contacts = new Map();
  for (const { entity, signal, result } of fixtures) {
    for (const row of fixtureRows(result)) {
      if (entity === 'reviewer') {
        addExpected(reviewers, row.wmkf_potentialreviewersid, signal, row);
        addExpected(contacts, row._wmkf_contact_value, signal);
      }
      if (entity === 'contact') addExpected(contacts, row.contactid, signal, row);
    }
  }
  return {
    referencedReviewers: [...reviewers.values()].map((entry) => ({
      reviewerId: entry.id,
      affiliation: affiliationFromReviewerRow(entry.row),
      institutions: institutionEvidenceFromReviewerRow(entry.row),
      viaNameMatch: nameOnly(entry.signals),
    })),
    referencedContacts: [...contacts.values()].map((entry) => ({
      contactId: entry.id,
      viaNameMatch: nameOnly(entry.signals),
    })),
  };
}

function reviewerFixture(fixtures, signal, result) {
  fixtures.push({ entity: 'reviewer', signal, result });
  return result;
}

function contactFixture(fixtures, signal, result) {
  fixtures.push({ entity: 'contact', signal, result });
  return result;
}

function reviewerIdFieldsOutsideDeclaration(value) {
  const ids = new Set();
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      if (key === 'referencedReviewers' || key === 'referencedContacts') continue;
      if (
        key.toLowerCase().endsWith('reviewerid')
        && key !== 'reviewerContactId'
        && typeof child === 'string'
        && GUID_RE.test(child)
      ) {
        ids.add(child);
      }
      visit(child);
    }
  };
  visit(value);
  return [...ids].sort();
}

function contactIdFieldsOutsideDeclaration(value) {
  const ids = new Set();
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      if (key === 'referencedContacts') continue;
      if (
        key.toLowerCase().endsWith('contactid')
        && typeof child === 'string'
        && GUID_RE.test(child)
      ) {
        ids.add(child);
      }
      visit(child);
    }
  };
  visit(value);
  return [...ids].sort();
}

function referencedReviewerIds(outcome) {
  return (outcome.referencedReviewers || [])
    .map((entry) => entry.reviewerId)
    .filter(Boolean)
    .sort();
}

function referencedContactIds(outcome) {
  return (outcome.referencedContacts || [])
    .map((entry) => entry.contactId)
    .filter(Boolean)
    .sort();
}

function expectDeclaredIds(outcome, expectedReviewerRefs, expectedContactRefs) {
  expect(Array.isArray(outcome.referencedReviewers)).toBe(true);
  for (const id of reviewerIdFieldsOutsideDeclaration(outcome)) {
    expect(referencedReviewerIds(outcome)).toContain(id);
  }
  expect(outcome.referencedReviewers).toEqual(expectedReviewerRefs);
  expect(Array.isArray(outcome.referencedContacts)).toBe(true);
  for (const id of contactIdFieldsOutsideDeclaration(outcome)) {
    expect(referencedContactIds(outcome)).toContain(id);
  }
  expect(outcome.referencedContacts).toEqual(expectedContactRefs);
}

function expectDeclaredFixtureRefs(outcome, fixtures = []) {
  const expected = expectedRefsFromFixtures(fixtures);
  expectDeclaredIds(outcome, expected.referencedReviewers, expected.referencedContacts);
}

beforeEach(() => {
  jest.clearAllMocks();
  potentialReviewerAdapter.findByOrcidCandidates.mockResolvedValue(none());
  potentialReviewerAdapter.findByEmailCandidates.mockResolvedValue(none());
  potentialReviewerAdapter.findByContactId.mockResolvedValue(null);
  potentialReviewerAdapter.searchByName.mockResolvedValue([]);
  contactAdapter.findByOrcidCandidates.mockResolvedValue(none());
  contactAdapter.findByEmailCandidates.mockResolvedValue(none());
  contactAdapter.searchByName.mockResolvedValue([]);
});

describe('lookupReviewerIdentity referencedReviewers invariant', () => {
  test('confident reviewer outcome declares its reviewer id and in-hand affiliation', async () => {
    const fixtures = [];
    potentialReviewerAdapter.findByEmailCandidates.mockResolvedValueOnce(reviewerFixture(fixtures, 'email', {
      one: true,
      id: REVIEWER_A,
      row: reviewerRow(REVIEWER_A),
    }));

    const out = await lookupReviewerIdentity({ name: 'Ada Lovelace', email: 'ada@example.edu', orcid: null });

    expect(out.outcome).toBe('confident');
    expectDeclaredFixtureRefs(out, fixtures);
  });

  test('confident contact-only outcome declares an empty reviewer set', async () => {
    const fixtures = [];
    contactAdapter.findByEmailCandidates.mockResolvedValueOnce(contactFixture(fixtures, 'email', {
      one: true,
      id: CONTACT_A,
      row: contactRow(CONTACT_A),
    }));

    const out = await lookupReviewerIdentity({ name: 'Ada Lovelace', email: 'ada@example.edu', orcid: null });

    expect(out.outcome).toBe('confident');
    expectDeclaredFixtureRefs(out, fixtures);
  });

  test('candidates outcome declares every reviewer-source candidate and every contact id candidate', async () => {
    const fixtures = [];
    potentialReviewerAdapter.findByEmailCandidates.mockResolvedValueOnce(reviewerFixture(fixtures, 'email', {
      ambiguous: true,
      rows: [
        reviewerRow(REVIEWER_A, { wmkf_primaryaffiliation: 'Applicant University', _wmkf_contact_value: CONTACT_B }),
        reviewerRow(REVIEWER_B, { wmkf_primaryaffiliation: 'Different University' }),
      ],
    }));
    contactAdapter.findByEmailCandidates.mockResolvedValueOnce(contactFixture(fixtures, 'email', {
      ambiguous: true,
      rows: [contactRow(CONTACT_A)],
    }));

    const out = await lookupReviewerIdentity({ name: 'Ada Lovelace', email: 'ada@example.edu', orcid: null });

    expect(out.outcome).toBe('candidates');
    expectDeclaredFixtureRefs(out, fixtures);
  });

  test('name-search fallback candidates are declared with viaNameMatch:true', async () => {
    const fixtures = [];
    potentialReviewerAdapter.searchByName.mockResolvedValueOnce(reviewerFixture(fixtures, 'name', [
      reviewerRow(REVIEWER_A, { wmkf_primaryaffiliation: 'Applicant University' }),
    ]));
    contactAdapter.searchByName.mockResolvedValueOnce(contactFixture(fixtures, 'name', [
      contactRow(CONTACT_A),
    ]));

    const out = await lookupReviewerIdentity({ name: 'Ada Lovelace', email: null, orcid: null });

    expect(out.outcome).toBe('candidates');
    expectDeclaredFixtureRefs(out, fixtures);
  });

  test('email mismatch conflict declares contactId', async () => {
    const fixtures = [];
    contactAdapter.findByEmailCandidates.mockResolvedValueOnce(contactFixture(fixtures, 'email', {
      one: true,
      id: CONTACT_A,
      row: contactRow(CONTACT_A, { emailaddress1: 'crm@example.edu' }),
    }));

    const out = await lookupReviewerIdentity({ name: 'Ada Lovelace', email: 'typed@example.edu', orcid: null });

    expect(out).toMatchObject({ outcome: 'conflict', reason: 'email_mismatch' });
    expectDeclaredFixtureRefs(out, fixtures);
  });

  test('reviewer/contact split conflict declares reviewer and linked contact discoveries', async () => {
    const fixtures = [];
    potentialReviewerAdapter.findByOrcidCandidates.mockResolvedValueOnce(reviewerFixture(fixtures, 'orcid', {
      one: true,
      id: REVIEWER_A,
      row: reviewerRow(REVIEWER_A, { wmkf_orcid: ORCID, _wmkf_contact_value: CONTACT_A }),
    }));
    contactAdapter.findByOrcidCandidates.mockResolvedValueOnce(contactFixture(fixtures, 'orcid', {
      one: true,
      id: CONTACT_B,
      row: contactRow(CONTACT_B, { wmkf_orcid: ORCID }),
    }));

    const out = await lookupReviewerIdentity({ name: 'Ada Lovelace', email: null, orcid: ORCID });

    expect(out).toMatchObject({ outcome: 'conflict', reason: 'orcid_email_split' });
    expectDeclaredFixtureRefs(out, fixtures);
  });

  test('reverse-link conflict declares existingReviewerId', async () => {
    const fixtures = [];
    contactAdapter.findByEmailCandidates.mockResolvedValueOnce(contactFixture(fixtures, 'email', {
      one: true,
      id: CONTACT_A,
      row: contactRow(CONTACT_A),
    }));
    potentialReviewerAdapter.findByContactId.mockResolvedValueOnce(reviewerFixture(fixtures, 'linked', reviewerRow(REVIEWER_B, {
      _wmkf_contact_value: CONTACT_A,
    })));

    const out = await lookupReviewerIdentity({ name: 'Ada Lovelace', email: 'ada@example.edu', orcid: null });

    expect(out).toMatchObject({ outcome: 'conflict', reason: 'contact_linked_elsewhere' });
    expectDeclaredFixtureRefs(out, fixtures);
  });

  test('ORCID/email contact split conflict declares both contact ids', async () => {
    const fixtures = [];
    contactAdapter.findByOrcidCandidates.mockResolvedValueOnce(contactFixture(fixtures, 'orcid', {
      one: true,
      id: CONTACT_A,
      row: contactRow(CONTACT_A, { wmkf_orcid: ORCID, emailaddress1: 'ada@example.edu' }),
    }));
    contactAdapter.findByEmailCandidates.mockResolvedValueOnce(contactFixture(fixtures, 'email', {
      one: true,
      id: CONTACT_B,
      row: contactRow(CONTACT_B, { emailaddress1: 'ada@example.edu' }),
    }));

    const out = await lookupReviewerIdentity({ name: 'Ada Lovelace', email: 'ada@example.edu', orcid: ORCID });

    expect(out).toMatchObject({ outcome: 'conflict', reason: 'orcid_email_split' });
    expectDeclaredFixtureRefs(out, fixtures);
  });

  test('ORCID/email reviewer split declares both reviewer ids', async () => {
    const fixtures = [];
    potentialReviewerAdapter.findByOrcidCandidates.mockResolvedValueOnce(reviewerFixture(fixtures, 'orcid', {
      one: true,
      id: REVIEWER_A,
      row: reviewerRow(REVIEWER_A, { wmkf_orcid: ORCID }),
    }));
    potentialReviewerAdapter.findByEmailCandidates.mockResolvedValueOnce(reviewerFixture(fixtures, 'email', {
      one: true,
      id: REVIEWER_B,
      row: reviewerRow(REVIEWER_B),
    }));

    const out = await lookupReviewerIdentity({ name: 'Ada Lovelace', email: 'ada@example.edu', orcid: ORCID });

    expect(out).toMatchObject({ outcome: 'conflict', reason: 'orcid_email_split' });
    expectDeclaredFixtureRefs(out, fixtures);
  });

  test('finding 7: exact email contact stays declared after non-confident ORCID outcome', async () => {
    const fixtures = [];
    potentialReviewerAdapter.findByOrcidCandidates.mockResolvedValueOnce(reviewerFixture(fixtures, 'orcid', {
      one: true,
      id: REVIEWER_A,
      row: reviewerRow(REVIEWER_A, {
        wmkf_name: 'Grace Hopper',
        wmkf_orcid: ORCID,
        wmkf_primaryaffiliation: 'Different University',
      }),
    }));
    contactAdapter.findByEmailCandidates.mockResolvedValueOnce(contactFixture(fixtures, 'email', {
      one: true,
      id: CONTACT_A,
      row: contactRow(CONTACT_A, { emailaddress1: 'ada@example.edu' }),
    }));

    const out = await lookupReviewerIdentity({ name: 'Ada Lovelace', email: 'ada@example.edu', orcid: ORCID });

    expect(out.outcome).toBe('candidates');
    expect(referencedContactIds(out)).toContain(CONTACT_A);
    expectDeclaredFixtureRefs(out, fixtures);
  });

  test('finding B: email ambiguity does not drop a confident ORCID reviewer discovery', async () => {
    const fixtures = [];
    potentialReviewerAdapter.findByOrcidCandidates.mockResolvedValueOnce(reviewerFixture(fixtures, 'orcid', {
      one: true,
      id: REVIEWER_A,
      row: reviewerRow(REVIEWER_A, { wmkf_orcid: ORCID }),
    }));
    contactAdapter.findByEmailCandidates.mockResolvedValueOnce(contactFixture(fixtures, 'email', {
      ambiguous: true,
      count: 2,
      rows: [
        contactRow(CONTACT_A, { emailaddress1: 'ada@example.edu' }),
        contactRow(CONTACT_B, { emailaddress1: 'ada@example.edu' }),
      ],
    }));

    const out = await lookupReviewerIdentity({ name: 'Ada Lovelace', email: 'ada@example.edu', orcid: ORCID });

    expect(out.outcome).toBe('candidates');
    expect(referencedReviewerIds(out)).toContain(REVIEWER_A);
    expectDeclaredFixtureRefs(out, fixtures);
  });

  test('finding C: contact .one stays declared beside ambiguous reviewer rows', async () => {
    const fixtures = [];
    potentialReviewerAdapter.findByEmailCandidates.mockResolvedValueOnce(reviewerFixture(fixtures, 'email', {
      ambiguous: true,
      count: 2,
      rows: [
        reviewerRow(REVIEWER_A),
        reviewerRow(REVIEWER_B, { wmkf_primaryaffiliation: 'Different University' }),
      ],
    }));
    contactAdapter.findByEmailCandidates.mockResolvedValueOnce(contactFixture(fixtures, 'email', {
      one: true,
      id: CONTACT_A,
      row: contactRow(CONTACT_A),
    }));

    const out = await lookupReviewerIdentity({ name: 'Ada Lovelace', email: 'ada@example.edu', orcid: null });

    expect(out.outcome).toBe('candidates');
    expect(referencedContactIds(out)).toContain(CONTACT_A);
    expectDeclaredFixtureRefs(out, fixtures);
  });

  test('finding C: reviewer .one stays declared beside ambiguous contact rows', async () => {
    const fixtures = [];
    potentialReviewerAdapter.findByEmailCandidates.mockResolvedValueOnce(reviewerFixture(fixtures, 'email', {
      one: true,
      id: REVIEWER_A,
      row: reviewerRow(REVIEWER_A),
    }));
    contactAdapter.findByEmailCandidates.mockResolvedValueOnce(contactFixture(fixtures, 'email', {
      ambiguous: true,
      count: 2,
      rows: [
        contactRow(CONTACT_A),
        contactRow(CONTACT_B),
      ],
    }));

    const out = await lookupReviewerIdentity({ name: 'Ada Lovelace', email: 'ada@example.edu', orcid: null });

    expect(out.outcome).toBe('candidates');
    expect(referencedReviewerIds(out)).toContain(REVIEWER_A);
    expectDeclaredFixtureRefs(out, fixtures);
  });

  test('finding D: ORCID email_mismatch conflict still declares the ORCID reviewer discovery', async () => {
    const fixtures = [];
    potentialReviewerAdapter.findByOrcidCandidates.mockResolvedValueOnce(reviewerFixture(fixtures, 'orcid', {
      one: true,
      id: REVIEWER_A,
      row: reviewerRow(REVIEWER_A, { wmkf_orcid: ORCID }),
    }));
    contactAdapter.findByOrcidCandidates.mockResolvedValueOnce(contactFixture(fixtures, 'orcid', {
      one: true,
      id: CONTACT_A,
      row: contactRow(CONTACT_A, { wmkf_orcid: ORCID, emailaddress1: 'old@example.edu' }),
    }));

    const out = await lookupReviewerIdentity({ name: 'Ada Lovelace', email: 'new@example.edu', orcid: ORCID });

    expect(out).toMatchObject({ outcome: 'conflict', reason: 'email_mismatch' });
    expect(referencedReviewerIds(out)).toContain(REVIEWER_A);
    expectDeclaredFixtureRefs(out, fixtures);
  });

  test('none outcome declares an empty reviewer set', async () => {
    const out = await lookupReviewerIdentity({ name: 'Ada Lovelace', email: null, orcid: null });

    expect(out.outcome).toBe('none');
    expectDeclaredFixtureRefs(out, []);
  });

  test('exact-key-only mode does not fall back to either name search', async () => {
    potentialReviewerAdapter.searchByName.mockResolvedValueOnce([reviewerRow(REVIEWER_A)]);
    contactAdapter.searchByName.mockResolvedValueOnce([contactRow(CONTACT_A)]);

    const out = await lookupReviewerIdentity(
      { name: 'Ada Lovelace', email: 'missing@example.edu', orcid: null },
      { allowNameFallback: false },
    );

    expect(out).toMatchObject({ outcome: 'none' });
    expect(potentialReviewerAdapter.searchByName).not.toHaveBeenCalled();
    expect(contactAdapter.searchByName).not.toHaveBeenCalled();
  });

  test('default mode retains the existing name fallback', async () => {
    potentialReviewerAdapter.searchByName.mockResolvedValueOnce([reviewerRow(REVIEWER_A)]);

    const out = await lookupReviewerIdentity({ name: 'Ada Lovelace', email: null, orcid: null });

    expect(out.outcome).toBe('candidates');
    expect(potentialReviewerAdapter.searchByName).toHaveBeenCalled();
    expect(contactAdapter.searchByName).toHaveBeenCalled();
  });

  test('separate staff, primary, and organization institutions are projected without raw rows', async () => {
    potentialReviewerAdapter.findByEmailCandidates.mockResolvedValueOnce({
      one: true,
      id: REVIEWER_A,
      row: reviewerRow(REVIEWER_A, {
        wmkf_maininstitution: 'Stanford University',
        wmkf_primaryaffiliation: 'Northwestern University',
        wmkf_organizationname: 'Stanford University',
        secretField: 'must-not-leak',
      }),
    });

    const out = await lookupReviewerIdentity(
      { name: 'Ada Lovelace', email: 'ada@example.edu', orcid: null },
      { allowNameFallback: false },
    );

    expect(out.referencedReviewers[0].institutions).toEqual([
      { value: 'Stanford University', source: 'staff_confirmed' },
      { value: 'Northwestern University', source: 'primary_affiliation' },
    ]);
    expect(JSON.stringify(out)).not.toContain('secretField');
  });
});
