/**
 * @jest-environment node
 *
 * /api/workbench/manual-reviewer — sparse staff-entered candidate add.
 */
jest.mock('../../lib/utils/auth', () => ({
  requireAppAccess: jest.fn(async () => ({ profileId: 7, session: { user: { dynamicsSystemuserId: 'u-1' } } })),
}));

jest.mock('../../lib/services/dynamics-context', () => ({
  bypassDynamicsRestrictions: (_label, fn) => fn(),
}));

const getRecord = jest.fn(async () => ({
  akoya_requestid: '11111111-1111-1111-1111-111111111111',
  akoya_title: 'Manual add proposal',
  wmkf_meetingdate: '2026-06-01',
  _wmkf_programareaserved_value_formatted: 'Science',
}));
jest.mock('../../lib/services/dynamics-service', () => ({
  DynamicsService: { getRecord: (...a) => getRecord(...a) },
}));

const upsertByEmail = jest.fn(async () => ({ id: 'pr-1', created: true }));
jest.mock('../../lib/dataverse/adapters/potential-reviewer', () => ({
  upsertByEmail: (...a) => upsertByEmail(...a),
}));

const updateById = jest.fn(async () => {});
const upsertByPotentialReviewer = jest.fn(async () => ({ id: 'pr-1', created: false }));
jest.mock('../../lib/dataverse/adapters/researcher', () => ({
  updateById: (...a) => updateById(...a),
  upsertByPotentialReviewer: (...a) => upsertByPotentialReviewer(...a),
}));

const ensureStaffManualCandidate = jest.fn(async () => ({ id: 'sug-1', created: true, selected: true }));
jest.mock('../../lib/dataverse/adapters/reviewer-suggestion', () => ({
  ensureStaffManualCandidate: (...a) => ensureStaffManualCandidate(...a),
}));

jest.mock('../../lib/utils/cycle-code', () => ({ meetingDateToCycleCode: () => 'J26' }));

import handler from '../../pages/api/workbench/manual-reviewer';
import { requireAppAccess } from '../../lib/utils/auth';

const REQ = '11111111-1111-1111-1111-111111111111';

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

function post(body) {
  return { method: 'POST', body };
}

beforeEach(() => {
  jest.clearAllMocks();
  requireAppAccess.mockResolvedValue({ profileId: 7, session: { user: { dynamicsSystemuserId: 'u-1' } } });
  getRecord.mockResolvedValue({
    akoya_requestid: REQ,
    akoya_title: 'Manual add proposal',
    wmkf_meetingdate: '2026-06-01',
    _wmkf_programareaserved_value_formatted: 'Science',
  });
  upsertByEmail.mockResolvedValue({ id: 'pr-1', created: true });
  ensureStaffManualCandidate.mockResolvedValue({ id: 'sug-1', created: true, selected: true });
});

describe('validation', () => {
  it('405s on non-POST', async () => {
    const r = res();
    await handler({ method: 'GET' }, r);
    expect(r.statusCode).toBe(405);
    expect(r.headers.Allow).toBe('POST');
  });

  it('short-circuits when auth fails', async () => {
    requireAppAccess.mockResolvedValueOnce(null);
    const r = res();
    await handler(post({ requestId: REQ, name: 'Ada Lovelace' }), r);
    expect(getRecord).not.toHaveBeenCalled();
  });

  it('rejects a bad requestId, missing name, and malformed email', async () => {
    let r = res();
    await handler(post({ requestId: 'not-a-guid', name: 'Ada Lovelace' }), r);
    expect(r.statusCode).toBe(400);

    r = res();
    await handler(post({ requestId: REQ, name: '' }), r);
    expect(r.statusCode).toBe(400);

    r = res();
    await handler(post({ requestId: REQ, name: 'Ada Lovelace', email: 'ada@bad' }), r);
    expect(r.statusCode).toBe(400);
  });
});

describe('write contract', () => {
  it('creates/reuses a person, stamps manual email source, and creates staff-manual suggestion', async () => {
    const r = res();
    await handler(post({
      requestId: REQ,
      name: 'Ada Lovelace',
      email: 'Ada@Example.edu',
      affiliation: 'Example University',
      note: 'Prior panelist.',
    }), r);

    expect(r.statusCode).toBe(200);
    expect(upsertByEmail).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Ada Lovelace',
      email: 'ada@example.edu',
      affiliation: 'Example University',
      whyChosen: 'Prior panelist.',
    }), { actingUserSystemId: 'u-1' });
    // emailSource is now fill-only via upsertByPotentialReviewer, not an
    // unconditional updateById overwrite (finding 5).
    expect(updateById).not.toHaveBeenCalled();
    expect(upsertByPotentialReviewer).toHaveBeenCalledWith(
      'pr-1',
      expect.objectContaining({ emailSource: 'manual' }),
      { actingUserSystemId: 'u-1' },
    );
    expect(ensureStaffManualCandidate).toHaveBeenCalledWith(expect.objectContaining({
      potentialReviewerId: 'pr-1',
      requestId: REQ,
      suggestionLabel: 'Manual add proposal — Ada Lovelace',
      grantCycleCode: 'J26',
      programArea: 'Science',
      matchReason: 'Prior panelist.',
    }), { actingUserSystemId: 'u-1' });
    expect(r.body.candidate.manualAdded).toBe(true);
    expect(r.body.candidate.sources).toEqual(['staff_manual']);
  });

  it('does not stamp email source for a name-only add', async () => {
    const r = res();
    await handler(post({ requestId: REQ, name: 'Grace Hopper' }), r);
    expect(r.statusCode).toBe(200);
    expect(updateById).not.toHaveBeenCalled();
    expect(upsertByPotentialReviewer).not.toHaveBeenCalled();
    expect(r.body.candidate.invitable).toBe(false);
  });

  it('409s when an excluded row wins, without any identity-bearing person write', async () => {
    ensureStaffManualCandidate.mockResolvedValueOnce({
      id: 'sug-excluded',
      created: false,
      selected: false,
      skippedExcluded: true,
    });
    const r = res();
    // Include email + ORCID so the test proves the exclusion gate fires BEFORE
    // those writes (finding 4): a rejected re-add must not relabel emailSource
    // or fill ORCID on the global person row.
    await handler(post({
      requestId: REQ,
      name: 'Ada Lovelace',
      email: 'ada@example.edu',
      orcid: '0000-0002-1825-0097',
    }), r);
    expect(r.statusCode).toBe(409);
    expect(r.body.code).toBe('applicant_excluded');
    expect(upsertByPotentialReviewer).not.toHaveBeenCalled();
    expect(updateById).not.toHaveBeenCalled();
  });
});

describe('orcid', () => {
  it('persists a valid ORCID fill-only and returns it', async () => {
    const r = res();
    await handler(post({ requestId: REQ, name: 'Ada Lovelace', orcid: '0000-0002-1825-0097' }), r);
    expect(r.statusCode).toBe(200);
    expect(upsertByPotentialReviewer).toHaveBeenCalledWith(
      'pr-1',
      { orcid: '0000-0002-1825-0097', orcidUrl: 'https://orcid.org/0000-0002-1825-0097' },
      { actingUserSystemId: 'u-1' },
    );
    expect(r.body.candidate.orcid).toBe('0000-0002-1825-0097');
    expect(r.body.candidate.orcidUrl).toBe('https://orcid.org/0000-0002-1825-0097');
  });

  it('rejects an invalid ORCID with 400 and writes nothing', async () => {
    const r = res();
    await handler(post({ requestId: REQ, name: 'Ada Lovelace', orcid: 'not-an-orcid' }), r);
    expect(r.statusCode).toBe(400);
    expect(upsertByPotentialReviewer).not.toHaveBeenCalled();
    expect(upsertByEmail).not.toHaveBeenCalled();
  });

  it('no ORCID → no ORCID persist, response orcid is null', async () => {
    const r = res();
    await handler(post({ requestId: REQ, name: 'Ada Lovelace' }), r);
    expect(r.statusCode).toBe(200);
    expect(upsertByPotentialReviewer).not.toHaveBeenCalled();
    expect(r.body.candidate.orcid).toBeNull();
  });
});
