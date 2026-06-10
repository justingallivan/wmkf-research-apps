/**
 * @jest-environment node
 *
 * Unit tests for the structured-PI identity resolver (S240): request → Project
 * Leader contact → wmkf_orcid → exact OpenAlex author, with a mis-entered-ORCID
 * name guard and inert fail-open fallback. Plus the identity-level PI exclusion.
 */

jest.mock('../../lib/services/dynamics-service', () => ({
  DynamicsService: { getRecord: jest.fn() },
}));
jest.mock('../../lib/services/openalex-service', () => ({
  OpenAlexService: { getAuthorByOrcid: jest.fn() },
}));

const { DynamicsService } = require('../../lib/services/dynamics-service');
const { OpenAlexService } = require('../../lib/services/openalex-service');
const { resolveProposalPI, excludePiIdentity } = require('../../lib/services/proposal-pi-identity');

const GUID = '11111111-1111-1111-1111-111111111111';
const PL_ID = '22222222-2222-2222-2222-222222222222';
const ORCID = '0000-0002-1825-0097'; // valid checksum
const OTHER_ORCID = '0000-0003-4234-5923'; // valid checksum, different person

// Wire DynamicsService.getRecord to return per-table fixtures.
function mockDynamics({ request, contact }) {
  DynamicsService.getRecord.mockImplementation(async (table) => {
    if (table === 'akoya_requests') return request;
    if (table === 'contacts') return contact;
    throw new Error(`unexpected table ${table}`);
  });
}

describe('resolveProposalPI', () => {
  beforeEach(() => jest.clearAllMocks());

  test('rejects a missing / non-GUID requestId without touching Dynamics', async () => {
    expect(await resolveProposalPI(null)).toEqual({ resolved: false, reason: 'no_request_id' });
    expect(await resolveProposalPI('not-a-guid')).toEqual({ resolved: false, reason: 'no_request_id' });
    expect(DynamicsService.getRecord).not.toHaveBeenCalled();
  });

  test('inert when the request has no Project/Research Leader', async () => {
    mockDynamics({ request: { akoya_requestid: GUID }, contact: null });
    expect(await resolveProposalPI(GUID)).toEqual({ resolved: false, reason: 'no_project_leader' });
  });

  test('falls back to Research Leader when Project Leader is absent', async () => {
    mockDynamics({
      request: { _wmkf_researchleader_value: PL_ID },
      contact: { fullname: 'Wen Li', wmkf_orcid: ORCID },
    });
    OpenAlexService.getAuthorByOrcid.mockResolvedValue({
      openAlexId: 'https://openalex.org/A1', displayName: 'Wen Li', lastKnownInstitution: 'Wayne State University',
    });
    const out = await resolveProposalPI(GUID);
    expect(out.resolved).toBe(true);
    expect(DynamicsService.getRecord).toHaveBeenCalledWith('contacts', PL_ID, expect.anything());
  });

  test('inert (no_orcid) when the contact carries no ORCID — does NOT call OpenAlex', async () => {
    mockDynamics({
      request: { _wmkf_projectleader_value: PL_ID },
      contact: { fullname: 'Wen Li', emailaddress1: 'wen.li@wayne.edu' },
    });
    const out = await resolveProposalPI(GUID);
    expect(out).toMatchObject({ resolved: false, reason: 'no_orcid', contactName: 'Wen Li', emailDomain: 'wayne.edu' });
    expect(OpenAlexService.getAuthorByOrcid).not.toHaveBeenCalled();
  });

  test('inert (orcid_malformed) on a checksum-invalid ORCID', async () => {
    mockDynamics({
      request: { _wmkf_projectleader_value: PL_ID },
      contact: { fullname: 'Wen Li', wmkf_orcid: '1234567' },
    });
    const out = await resolveProposalPI(GUID);
    expect(out).toMatchObject({ resolved: false, reason: 'orcid_malformed' });
    expect(OpenAlexService.getAuthorByOrcid).not.toHaveBeenCalled();
  });

  test('inert (orcid_not_in_openalex) when the ORCID resolves to no author', async () => {
    mockDynamics({
      request: { _wmkf_projectleader_value: PL_ID },
      contact: { fullname: 'Wen Li', wmkf_orcid: ORCID },
    });
    OpenAlexService.getAuthorByOrcid.mockResolvedValue(null);
    const out = await resolveProposalPI(GUID);
    expect(out).toMatchObject({ resolved: false, reason: 'orcid_not_in_openalex', orcid: ORCID });
  });

  test('ABSTAINS (name_mismatch) when the OpenAlex author full-forename contradicts the contact (mis-entered ORCID)', async () => {
    mockDynamics({
      request: { _wmkf_projectleader_value: PL_ID },
      contact: { firstname: 'John', lastname: 'Smith', wmkf_orcid: ORCID },
    });
    OpenAlexService.getAuthorByOrcid.mockResolvedValue({ openAlexId: 'A9', displayName: 'Jane Smith' });
    const out = await resolveProposalPI(GUID);
    expect(out).toMatchObject({ resolved: false, reason: 'name_mismatch', openAlexName: 'Jane Smith' });
  });

  test('ABSTAINS (name_mismatch) on a surname disagreement', async () => {
    mockDynamics({
      request: { _wmkf_projectleader_value: PL_ID },
      contact: { fullname: 'John Smith', wmkf_orcid: ORCID },
    });
    OpenAlexService.getAuthorByOrcid.mockResolvedValue({ openAlexId: 'A9', displayName: 'John Doe' });
    const out = await resolveProposalPI(GUID);
    expect(out).toMatchObject({ resolved: false, reason: 'name_mismatch' });
  });

  test('accepts an initial-only OpenAlex name (cannot contradict a full forename)', async () => {
    mockDynamics({
      request: { _wmkf_projectleader_value: PL_ID },
      contact: { fullname: 'Ursula Keller', wmkf_orcid: ORCID },
    });
    OpenAlexService.getAuthorByOrcid.mockResolvedValue({ openAlexId: 'A2', displayName: 'U. Keller' });
    const out = await resolveProposalPI(GUID);
    expect(out.resolved).toBe(true);
  });

  test('resolves: returns canonical identity from the OpenAlex author', async () => {
    mockDynamics({
      request: { _wmkf_projectleader_value: PL_ID },
      contact: { fullname: 'Wen Li', wmkf_orcid: ORCID, emailaddress1: 'wen.li@WAYNE.edu' },
    });
    OpenAlexService.getAuthorByOrcid.mockResolvedValue({
      openAlexId: 'https://openalex.org/A5060668110', displayName: 'Wen Li', lastKnownInstitution: 'Wayne State University',
    });
    const out = await resolveProposalPI(GUID);
    expect(out).toEqual({
      resolved: true,
      orcid: ORCID,
      openAlexAuthorId: 'https://openalex.org/A5060668110',
      canonicalName: 'Wen Li',
      contactName: 'Wen Li',
      institution: 'Wayne State University',
      emailDomain: 'wayne.edu',
    });
  });

  test('propagates an abort/timeout error from OpenAlex (does NOT swallow as inert)', async () => {
    mockDynamics({
      request: { _wmkf_projectleader_value: PL_ID },
      contact: { fullname: 'Wen Li', wmkf_orcid: ORCID },
    });
    OpenAlexService.getAuthorByOrcid.mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    await expect(resolveProposalPI(GUID)).rejects.toThrow('aborted');
  });

  test('fails open (request_read_failed) when Dynamics read throws a non-abort error', async () => {
    DynamicsService.getRecord.mockRejectedValue(new Error('dataverse 500'));
    const out = await resolveProposalPI(GUID);
    expect(out).toMatchObject({ resolved: false, reason: 'request_read_failed' });
  });
});

describe('excludePiIdentity', () => {
  const pi = { resolved: true, orcid: ORCID, openAlexAuthorId: 'https://openalex.org/A100' };

  test('no-op when the PI is unresolved', () => {
    const cands = [{ name: 'X', identityStatus: 'confirmed', orcid: ORCID }];
    expect(excludePiIdentity(cands, { resolved: false })).toEqual({ kept: cands, removed: [] });
  });

  test('drops a confirmed candidate sharing the PI ORCID', () => {
    const cands = [{ name: 'PI', identityStatus: 'confirmed', orcid: ORCID }, { name: 'Other', identityStatus: 'confirmed', orcid: OTHER_ORCID }];
    const { kept, removed } = excludePiIdentity(cands, pi);
    expect(removed.map((c) => c.name)).toEqual(['PI']);
    expect(kept.map((c) => c.name)).toEqual(['Other']);
  });

  test('drops a confirmed candidate sharing the PI OpenAlex author id (short or URL form)', () => {
    const cands = [{ name: 'PI', identityStatus: 'probable', openAlexId: 'A100' }];
    expect(excludePiIdentity(cands, pi).removed).toHaveLength(1);
  });

  test('GATE: does NOT drop an unresolved candidate even if its orcid field matches (namesake risk)', () => {
    const cands = [{ name: 'Maybe-PI', identityStatus: 'unresolved', orcid: ORCID }];
    expect(excludePiIdentity(cands, pi)).toEqual({ kept: cands, removed: [] });
  });

  test('does NOT drop a same-name candidate with no matching identity field', () => {
    const cands = [{ name: 'Wen Li', identityStatus: 'confirmed', orcid: OTHER_ORCID }];
    expect(excludePiIdentity(cands, pi).removed).toHaveLength(0);
  });
});
