/**
 * Characterization tests for the akoya_requests READ adapter
 * (lib/dataverse/adapters/grant-request.js, Wave 5(a)+(b)).
 *
 * Each test asserts the EXACT DynamicsService call the raw callers make — entity
 * set, `$select`, `$filter`, `top`, `$orderby` — plus the pass-through return
 * contract, so the later in-place conversion is provably behavior-preserving
 * (Wave 5 behavior freeze). No write methods exist on this adapter and none are
 * exercised here.
 *
 * @jest-environment node
 */

import { jest } from '@jest/globals';
import { DynamicsService } from '../../lib/services/dynamics-service.js';
import * as grantRequest from '../../lib/dataverse/adapters/grant-request.js';

afterEach(() => jest.restoreAllMocks());

const GUID_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const GUID_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const PD_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

// ───────────────────────── SELECT_PROFILES ─────────────────────────

describe('grant-request.SELECT_PROFILES', () => {
  test('names only the verbatim cross-file recurring select shapes', () => {
    expect(grantRequest.SELECT_PROFILES).toEqual({
      ID_ONLY: ['akoya_requestid'],
      IDENTITY: ['akoya_requestid', 'akoya_requestnum'],
      DOCUMENT_SCOPE: ['akoya_requestid', 'akoya_requestnum', 'wmkf_meetingdate'],
    });
  });
  test('is frozen (a shared const, never mutated by a caller)', () => {
    expect(Object.isFrozen(grantRequest.SELECT_PROFILES)).toBe(true);
  });
});

// ───────────────────────────── getById ─────────────────────────────

describe('grant-request.getById (characterization)', () => {
  test('golden: with an array select → joined $select, returns the record', async () => {
    const g = jest.spyOn(DynamicsService, 'getRecord').mockResolvedValue({ akoya_requestid: GUID_A });
    const out = await grantRequest.getById(GUID_A, { select: ['akoya_requestid', 'akoya_requestnum'] });
    expect(out).toEqual({ akoya_requestid: GUID_A });
    expect(g).toHaveBeenCalledWith('akoya_requests', GUID_A, { select: 'akoya_requestid,akoya_requestnum' });
  });

  test('accepts a comma-string select unchanged (byte-for-byte)', async () => {
    const g = jest.spyOn(DynamicsService, 'getRecord').mockResolvedValue({});
    await grantRequest.getById(GUID_A, { select: 'wmkf_ai_summary,modifiedon' });
    expect(g).toHaveBeenCalledWith('akoya_requests', GUID_A, { select: 'wmkf_ai_summary,modifiedon' });
  });

  test('accepts a SELECT_PROFILES value', async () => {
    const g = jest.spyOn(DynamicsService, 'getRecord').mockResolvedValue({});
    await grantRequest.getById(GUID_A, { select: grantRequest.SELECT_PROFILES.DOCUMENT_SCOPE });
    expect(g).toHaveBeenCalledWith('akoya_requests', GUID_A, {
      select: 'akoya_requestid,akoya_requestnum,wmkf_meetingdate',
    });
  });

  test('behavior lock: NO select → full-record read, called with only two args', async () => {
    const g = jest.spyOn(DynamicsService, 'getRecord').mockResolvedValue({ akoya_requestid: GUID_A });
    await grantRequest.getById(GUID_A);
    // Mirrors lib/services/execute-prompt.js:104 — no options object at all.
    expect(g).toHaveBeenCalledWith('akoya_requests', GUID_A);
    expect(g.mock.calls[0]).toHaveLength(2);
  });

  test('behavior lock: {} (no select key) also produces the two-arg full read', async () => {
    const g = jest.spyOn(DynamicsService, 'getRecord').mockResolvedValue({});
    await grantRequest.getById(GUID_A, {});
    expect(g.mock.calls[0]).toHaveLength(2);
  });

  test('behavior lock: no falsy-id guard — a falsy id still calls getRecord', async () => {
    const g = jest.spyOn(DynamicsService, 'getRecord').mockResolvedValue(null);
    await grantRequest.getById(undefined, { select: grantRequest.SELECT_PROFILES.ID_ONLY });
    expect(g).toHaveBeenCalledWith('akoya_requests', undefined, { select: 'akoya_requestid' });
  });
});

// ──────────────────────── findByRequestNumber ────────────────────────

describe('grant-request.findByRequestNumber (characterization)', () => {
  test('golden: quoted requestnum filter, top:1, returns the raw queryRecords result', async () => {
    const q = jest.spyOn(DynamicsService, 'queryRecords').mockResolvedValue({
      records: [{ akoya_requestid: GUID_A }],
      count: 1,
      totalCount: 1,
      hasMore: false,
    });
    const out = await grantRequest.findByRequestNumber('2025-1234', { select: ['akoya_requestid', 'akoya_requestnum'] });
    expect(out.records).toEqual([{ akoya_requestid: GUID_A }]);
    expect(q).toHaveBeenCalledWith('akoya_requests', {
      select: 'akoya_requestid,akoya_requestnum',
      filter: "akoya_requestnum eq '2025-1234'",
      top: 1,
    });
  });

  test('escapes single quotes in the request number (OData doubling)', async () => {
    const q = jest.spyOn(DynamicsService, 'queryRecords').mockResolvedValue({ records: [] });
    await grantRequest.findByRequestNumber("O'Hara-1", { select: 'akoya_requestid' });
    expect(q.mock.calls[0][1].filter).toBe("akoya_requestnum eq 'O''Hara-1'");
  });

  test('honors an explicit top override', async () => {
    const q = jest.spyOn(DynamicsService, 'queryRecords').mockResolvedValue({ records: [] });
    await grantRequest.findByRequestNumber('2025-1234', { select: 'akoya_requestid', top: 5 });
    expect(q.mock.calls[0][1].top).toBe(5);
  });
});

// ──────────────────────────── findByIds ────────────────────────────

describe('grant-request.findByIds (characterization)', () => {
  test('golden: OR-chain over akoya_requestid (no wrapping parens), top defaults to id count', async () => {
    const q = jest.spyOn(DynamicsService, 'queryRecords').mockResolvedValue({
      records: [{ akoya_requestid: GUID_A }, { akoya_requestid: GUID_B }],
    });
    const out = await grantRequest.findByIds([GUID_A, GUID_B], {
      select: ['akoya_requestid', 'wmkf_meetingdate'],
    });
    expect(out.records).toHaveLength(2);
    expect(q).toHaveBeenCalledWith('akoya_requests', {
      select: 'akoya_requestid,wmkf_meetingdate',
      filter: `akoya_requestid eq ${GUID_A} or akoya_requestid eq ${GUID_B}`,
      top: 2,
    });
  });

  test('honors an explicit top cap (the contact-history CHUNK_SIZE shape)', async () => {
    const q = jest.spyOn(DynamicsService, 'queryRecords').mockResolvedValue({ records: [] });
    await grantRequest.findByIds([GUID_A], { select: 'akoya_requestid', top: 50 });
    expect(q.mock.calls[0][1].top).toBe(50);
  });

  test('behavior/edge: empty id list short-circuits — NO query issued', async () => {
    const q = jest.spyOn(DynamicsService, 'queryRecords').mockResolvedValue({ records: [] });
    const out = await grantRequest.findByIds([], { select: 'akoya_requestid' });
    expect(out).toEqual({ records: [], count: 0, totalCount: 0, hasMore: false });
    expect(q).not.toHaveBeenCalled();
  });

  test('behavior/edge: nullish id list short-circuits too', async () => {
    const q = jest.spyOn(DynamicsService, 'queryRecords').mockResolvedValue({ records: [] });
    const out = await grantRequest.findByIds(undefined, { select: 'akoya_requestid' });
    expect(out).toEqual({ records: [], count: 0, totalCount: 0, hasMore: false });
    expect(q).not.toHaveBeenCalled();
  });
});

// ──────────────── findMeetingDatesByProgramDirector ────────────────

describe('grant-request.findMeetingDatesByProgramDirector (characterization)', () => {
  test('golden: PD lookup + meetingdate-not-null, id+date select, desc order', async () => {
    const qAll = jest.spyOn(DynamicsService, 'queryAllRecords').mockResolvedValue({
      records: [{ akoya_requestid: GUID_A, wmkf_meetingdate: '2026-01-15' }],
    });
    const out = await grantRequest.findMeetingDatesByProgramDirector(PD_ID);
    expect(out.records).toHaveLength(1);
    expect(qAll).toHaveBeenCalledWith('akoya_requests', {
      select: 'akoya_requestid,wmkf_meetingdate',
      filter: `_wmkf_programdirector_value eq ${PD_ID} and wmkf_meetingdate ne null`,
      orderby: 'wmkf_meetingdate desc',
    });
  });

  test('returns the raw queryAllRecords result object (pass-through)', async () => {
    const result = { records: [], capped: false, totalCount: 0, hasMore: false };
    jest.spyOn(DynamicsService, 'queryAllRecords').mockResolvedValue(result);
    expect(await grantRequest.findMeetingDatesByProgramDirector(PD_ID)).toBe(result);
  });
});
