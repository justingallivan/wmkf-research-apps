/**
 * @jest-environment node
 *
 * /api/workbench/orcid-lookup — read-only ORCID iD lookup for the manual add form.
 */
jest.mock('../../lib/utils/auth', () => ({
  requireAppAccess: jest.fn(async () => ({ profileId: 7, session: { user: {} } })),
}));

const findContact = jest.fn();
jest.mock('../../lib/services/orcid-service', () => ({
  ORCIDService: { findContact: (...a) => findContact(...a) },
}));

import handler from '../../pages/api/workbench/orcid-lookup';
import { requireAppAccess } from '../../lib/utils/auth';

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
  process.env.ORCID_CLIENT_ID = 'cid';
  process.env.ORCID_CLIENT_SECRET = 'secret';
});

describe('guards', () => {
  it('405s on non-POST', async () => {
    const r = res();
    await handler({ method: 'GET' }, r);
    expect(r.statusCode).toBe(405);
  });

  it('short-circuits when auth fails (no ORCID call)', async () => {
    requireAppAccess.mockResolvedValueOnce(null);
    const r = res();
    await handler(post({ name: 'Ada Lovelace' }), r);
    expect(findContact).not.toHaveBeenCalled();
  });

  it('400s without a name', async () => {
    const r = res();
    await handler(post({ affiliation: 'MIT' }), r);
    expect(r.statusCode).toBe(400);
  });

  it('degrades (200 found:false) when ORCID creds are absent', async () => {
    delete process.env.ORCID_CLIENT_ID;
    delete process.env.ORCID_CLIENT_SECRET;
    const r = res();
    await handler(post({ name: 'Ada Lovelace' }), r);
    expect(r.statusCode).toBe(200);
    expect(r.body.found).toBe(false);
    expect(findContact).not.toHaveBeenCalled();
  });
});

describe('lookup results', () => {
  it('returns a confident match', async () => {
    findContact.mockResolvedValueOnce({
      status: 'resolved',
      orcidId: '0000-0002-1825-0097',
      orcidUrl: 'https://orcid.org/0000-0002-1825-0097',
      name: 'Josiah Carberry',
      matchedInstitution: 'Brown University',
      institutionCorroborated: true,
      email: 'jc@brown.edu',
    });
    const r = res();
    await handler(post({ name: 'Josiah Carberry', affiliation: 'Brown', email: 'jc@brown.edu' }), r);
    expect(r.statusCode).toBe(200);
    expect(r.body).toMatchObject({
      found: true,
      orcid: '0000-0002-1825-0097',
      matchedName: 'Josiah Carberry',
      matchedInstitution: 'Brown University',
      institutionCorroborated: true,
      emailMatches: true,
    });
  });

  it('reports ambiguous without attaching an ORCID', async () => {
    findContact.mockResolvedValueOnce({ status: 'ambiguous', orcidId: null, candidateCount: 3 });
    const r = res();
    await handler(post({ name: 'John Smith' }), r);
    expect(r.body).toMatchObject({ found: false, ambiguous: true, candidateCount: 3 });
  });

  it('reports no match on null', async () => {
    findContact.mockResolvedValueOnce(null);
    const r = res();
    await handler(post({ name: 'Nobody Atall' }), r);
    expect(r.body).toEqual(expect.objectContaining({ found: false }));
  });

  it('502s (found:false) on an ORCID error', async () => {
    findContact.mockRejectedValueOnce(new Error('orcid down'));
    const r = res();
    await handler(post({ name: 'Ada Lovelace' }), r);
    expect(r.statusCode).toBe(502);
    expect(r.body.found).toBe(false);
  });
});
