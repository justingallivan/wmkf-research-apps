/**
 * @jest-environment node
 *
 * Producer contract for lib/services/reviewer-identity-lookup.js: every lookup
 * outcome declares the complete reviewer identity set it references so save-time
 * COI screening does not rediscover branch-specific shapes.
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

function reviewerIdFieldsOutsideDeclaration(value) {
  const ids = new Set();
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      if (key === 'referencedReviewers') continue;
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

function referencedReviewerIds(outcome) {
  return (outcome.referencedReviewers || [])
    .map((entry) => entry.reviewerId)
    .filter(Boolean)
    .sort();
}

function expectDeclaredReviewerIds(outcome, expectedRefs) {
  expect(Array.isArray(outcome.referencedReviewers)).toBe(true);
  expect(referencedReviewerIds(outcome)).toEqual(reviewerIdFieldsOutsideDeclaration(outcome));
  expect(outcome.referencedReviewers).toEqual(expectedRefs);
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
    potentialReviewerAdapter.findByEmailCandidates.mockResolvedValueOnce({
      one: true,
      id: REVIEWER_A,
      row: reviewerRow(REVIEWER_A),
    });

    const out = await lookupReviewerIdentity({ name: 'Ada Lovelace', email: 'ada@example.edu', orcid: null });

    expect(out.outcome).toBe('confident');
    expectDeclaredReviewerIds(out, [{ reviewerId: REVIEWER_A, affiliation: 'Applicant University' }]);
  });

  test('confident contact-only outcome declares an empty reviewer set', async () => {
    contactAdapter.findByEmailCandidates.mockResolvedValueOnce({
      one: true,
      id: CONTACT_A,
      row: contactRow(CONTACT_A),
    });

    const out = await lookupReviewerIdentity({ name: 'Ada Lovelace', email: 'ada@example.edu', orcid: null });

    expect(out.outcome).toBe('confident');
    expectDeclaredReviewerIds(out, []);
  });

  test('candidates outcome declares every reviewer-source candidate and no contact-only candidate', async () => {
    potentialReviewerAdapter.findByEmailCandidates.mockResolvedValueOnce({
      ambiguous: true,
      rows: [
        reviewerRow(REVIEWER_A, { wmkf_primaryaffiliation: 'Applicant University' }),
        reviewerRow(REVIEWER_B, { wmkf_primaryaffiliation: 'Different University' }),
      ],
    });
    contactAdapter.findByEmailCandidates.mockResolvedValueOnce({
      ambiguous: true,
      rows: [contactRow(CONTACT_A)],
    });

    const out = await lookupReviewerIdentity({ name: 'Ada Lovelace', email: 'ada@example.edu', orcid: null });

    expect(out.outcome).toBe('candidates');
    expectDeclaredReviewerIds(out, [
      { reviewerId: REVIEWER_A, affiliation: 'Applicant University' },
      { reviewerId: REVIEWER_B, affiliation: 'Different University' },
    ]);
  });

  test('reviewer/contact split conflict declares reviewerId but not reviewerContactId', async () => {
    potentialReviewerAdapter.findByOrcidCandidates.mockResolvedValueOnce({
      one: true,
      id: REVIEWER_A,
      row: reviewerRow(REVIEWER_A, { wmkf_orcid: ORCID, _wmkf_contact_value: CONTACT_A }),
    });
    contactAdapter.findByOrcidCandidates.mockResolvedValueOnce({
      one: true,
      id: CONTACT_B,
      row: contactRow(CONTACT_B, { wmkf_orcid: ORCID }),
    });

    const out = await lookupReviewerIdentity({ name: 'Ada Lovelace', email: null, orcid: ORCID });

    expect(out).toMatchObject({ outcome: 'conflict', reason: 'orcid_email_split' });
    expectDeclaredReviewerIds(out, [{ reviewerId: REVIEWER_A, affiliation: null }]);
  });

  test('reverse-link conflict declares existingReviewerId', async () => {
    contactAdapter.findByEmailCandidates.mockResolvedValueOnce({
      one: true,
      id: CONTACT_A,
      row: contactRow(CONTACT_A),
    });
    potentialReviewerAdapter.findByContactId.mockResolvedValueOnce(reviewerRow(REVIEWER_B, {
      _wmkf_contact_value: CONTACT_A,
    }));

    const out = await lookupReviewerIdentity({ name: 'Ada Lovelace', email: 'ada@example.edu', orcid: null });

    expect(out).toMatchObject({ outcome: 'conflict', reason: 'contact_linked_elsewhere' });
    expectDeclaredReviewerIds(out, [{ reviewerId: REVIEWER_B, affiliation: null }]);
  });

  test('ORCID/email reviewer split declares both reviewer ids', async () => {
    potentialReviewerAdapter.findByOrcidCandidates.mockResolvedValueOnce({
      one: true,
      id: REVIEWER_A,
      row: reviewerRow(REVIEWER_A, { wmkf_orcid: ORCID }),
    });
    potentialReviewerAdapter.findByEmailCandidates.mockResolvedValueOnce({
      one: true,
      id: REVIEWER_B,
      row: reviewerRow(REVIEWER_B),
    });

    const out = await lookupReviewerIdentity({ name: 'Ada Lovelace', email: 'ada@example.edu', orcid: ORCID });

    expect(out).toMatchObject({ outcome: 'conflict', reason: 'orcid_email_split' });
    expectDeclaredReviewerIds(out, [
      { reviewerId: REVIEWER_A, affiliation: null },
      { reviewerId: REVIEWER_B, affiliation: null },
    ]);
  });

  test('none outcome declares an empty reviewer set', async () => {
    const out = await lookupReviewerIdentity({ name: 'Ada Lovelace', email: null, orcid: null });

    expect(out.outcome).toBe('none');
    expectDeclaredReviewerIds(out, []);
  });
});
