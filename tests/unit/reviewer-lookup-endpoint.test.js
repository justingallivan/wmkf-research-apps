/**
 * @jest-environment node
 *
 * /api/workbench/reviewer-lookup — read-only manual-add dedup preflight.
 */
jest.mock('../../lib/utils/auth', () => ({
  requireAppAccess: jest.fn(async () => ({ profileId: 7, session: { user: {} } })),
}));

jest.mock('../../lib/services/dynamics-context', () => ({
  bypassDynamicsRestrictions: (_label, fn) => fn(),
}));

// Inline jest.fn() factories (the factory can't reference an outer const under
// this repo's transform), then import the mocked modules to drive them.
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

import handler from '../../pages/api/workbench/reviewer-lookup';
import { requireAppAccess } from '../../lib/utils/auth';
import * as mockPr from '../../lib/dataverse/adapters/potential-reviewer';
import * as mockContacts from '../../lib/dataverse/adapters/contact';

const ORCID = '0000-0002-1825-0097';
const PR = '11111111-2222-3333-4444-555555555555';
const CONTACT = '22222222-3333-4444-5555-666666666666';

function res() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}
const post = (body) => ({ method: 'POST', body });

beforeEach(() => {
  jest.clearAllMocks();
  requireAppAccess.mockResolvedValue({ profileId: 7, session: { user: {} } });
  mockPr.findByOrcidCandidates.mockResolvedValue({ none: true });
  mockPr.findByEmailCandidates.mockResolvedValue({ none: true });
  mockPr.findByContactId.mockResolvedValue(null);
  mockPr.searchByName.mockResolvedValue([]);
  mockContacts.findByOrcidCandidates.mockResolvedValue({ none: true });
  mockContacts.findByEmailCandidates.mockResolvedValue({ none: true });
  mockContacts.searchByName.mockResolvedValue([]);
});

describe('guards', () => {
  it('405s on non-POST and short-circuits on auth failure', async () => {
    let r = res();
    await handler({ method: 'GET' }, r);
    expect(r.statusCode).toBe(405);

    requireAppAccess.mockResolvedValueOnce(null);
    r = res();
    await handler(post({ name: 'Ada Lovelace' }), r);
    expect(mockPr.searchByName).not.toHaveBeenCalled();
  });

  it('validates name, email, and ORCID', async () => {
    let r = res();
    await handler(post({ email: 'ada@example.edu' }), r);
    expect(r.statusCode).toBe(400);
    r = res();
    await handler(post({ name: 'Ada Lovelace', email: 'bad' }), r);
    expect(r.statusCode).toBe(400);
    r = res();
    await handler(post({ name: 'Ada Lovelace', orcid: 'not-orcid' }), r);
    expect(r.statusCode).toBe(400);
  });
});

describe('outcomes', () => {
  it('ambiguous same-key rows return candidates, not conflict', async () => {
    mockPr.findByEmailCandidates.mockResolvedValueOnce({
      ambiguous: true,
      count: 2,
      rows: [
        { wmkf_potentialreviewersid: 'r1', wmkf_name: 'Ada Lovelace', wmkf_emailaddress: 'ada@example.edu', statecode: 0 },
        { wmkf_potentialreviewersid: 'r2', wmkf_name: 'Ada Lovelace', wmkf_emailaddress: 'ADA@example.edu', statecode: 0 },
      ],
    });
    const r = res();
    await handler(post({ name: 'Ada Lovelace', email: 'ada@example.edu' }), r);
    expect(r.statusCode).toBe(200);
    expect(r.body.outcome).toBe('candidates');
    expect(r.body.reason).toBeUndefined();
  });

  it('cross-store ORCID/email split returns conflict', async () => {
    mockPr.findByOrcidCandidates.mockResolvedValueOnce({
      one: true,
      id: PR,
      row: { wmkf_potentialreviewersid: PR, wmkf_name: 'Ada Lovelace', wmkf_orcid: ORCID, _wmkf_contact_value: null, statecode: 0 },
    });
    mockContacts.findByEmailCandidates.mockResolvedValueOnce({
      one: true,
      id: CONTACT,
      row: { contactid: CONTACT, fullname: 'Ada Lovelace', emailaddress1: 'ada@example.edu', statecode: 0 },
    });
    const r = res();
    await handler(post({ name: 'Ada Lovelace', email: 'ada@example.edu', orcid: ORCID }), r);
    expect(r.statusCode).toBe(200);
    expect(r.body).toMatchObject({ outcome: 'conflict', reason: 'orcid_email_split' });
    expect(r.body.referencedReviewers).toEqual([{
      reviewerId: PR,
      affiliation: null,
      institutions: [],
      viaNameMatch: false,
    }]);
    expect(r.body.referencedContacts).toEqual([{ contactId: CONTACT, viaNameMatch: false }]);
  });

  it('reverse-link collision returns conflict', async () => {
    mockContacts.findByEmailCandidates.mockResolvedValueOnce({
      one: true,
      id: CONTACT,
      row: { contactid: CONTACT, fullname: 'Ada Lovelace', emailaddress1: 'ada@example.edu', statecode: 0 },
    });
    mockPr.findByContactId.mockResolvedValueOnce({ wmkf_potentialreviewersid: PR, _wmkf_contact_value: CONTACT });
    const r = res();
    await handler(post({ name: 'Ada Lovelace', email: 'ada@example.edu' }), r);
    expect(r.statusCode).toBe(200);
    expect(r.body).toMatchObject({ outcome: 'conflict', reason: 'contact_linked_elsewhere' });
  });

  it('returns confident only after both stores are checked', async () => {
    mockPr.findByEmailCandidates.mockResolvedValueOnce({
      one: true,
      id: PR,
      row: { wmkf_potentialreviewersid: PR, wmkf_name: 'Ada Lovelace', wmkf_emailaddress: 'ada@example.edu', statecode: 0 },
    });
    const r = res();
    await handler(post({ name: 'Ada Lovelace', email: 'ada@example.edu' }), r);
    expect(r.body).toMatchObject({ outcome: 'confident', match: { reviewerId: PR, matchKey: 'email' } });
    expect(mockContacts.findByEmailCandidates).toHaveBeenCalledWith('ada@example.edu');
  });

  it('name-only hits return candidates', async () => {
    mockContacts.searchByName.mockResolvedValueOnce([
      { contactid: CONTACT, fullname: 'Ada Lovelace', emailaddress1: 'ada@example.edu', statecode: 1 },
    ]);
    const r = res();
    await handler(post({ name: 'Ada Lovelace' }), r);
    expect(r.body).toMatchObject({ outcome: 'candidates' });
    expect(r.body.candidates[0]).toMatchObject({ source: 'contact', matchKey: 'name', contactId: CONTACT });
  });

  it('returns none when no key or name match exists', async () => {
    const r = res();
    await handler(post({ name: 'Nobody Atall' }), r);
    expect(r.body).toEqual({ outcome: 'none', referencedReviewers: [], referencedContacts: [] });
  });
});
