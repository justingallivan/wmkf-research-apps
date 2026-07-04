/**
 * Stage-2 characterization tests: lock the CURRENT behavior of adapter public
 * methods that had no direct coverage, BEFORE they are refactored onto the core
 * toolkit. Each asserts the exact DynamicsService call (entity set, `$select`,
 * `$filter`, `top`) and/or the exact return contract, so the conversion is
 * provably behavior-preserving (Stage 2 behavior freeze).
 *
 * @jest-environment node
 */

import { jest } from '@jest/globals';
import { DynamicsService } from '../../lib/services/dynamics-service.js';
import * as contact from '../../lib/dataverse/adapters/contact.js';
import * as pr from '../../lib/dataverse/adapters/potential-reviewer.js';
import * as researcher from '../../lib/dataverse/adapters/researcher.js';
import * as suggestion from '../../lib/dataverse/adapters/reviewer-suggestion.js';
import { selectFields } from '../../lib/dataverse/core/entity-registry.js';

afterEach(() => jest.restoreAllMocks());

// Exact primary $select strings (verified equal to the adapters' FIELD_SELECT).
const CONTACT_SELECT =
  'contactid,firstname,lastname,fullname,emailaddress1,wmkf_orcid,statecode';
const PR_SELECT =
  'wmkf_potentialreviewersid,wmkf_name,wmkf_firstname,wmkf_lastname,wmkf_emailaddress,' +
  'wmkf_orcid,wmkf_organizationname,wmkf_primaryaffiliation,wmkf_areaofexpertise,' +
  'wmkf_whyreviewerwaschosen,wmkf_academicrank,wmkf_primarydepartment,wmkf_maininstitution,' +
  '_wmkf_contact_value,statecode';

const GUID_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const GUID_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const PD_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

// PD-scope request $select strings (Codex S329 review: pin select/top too, not
// just filters). findAcceptedByPD adds wmkf_organizationname — a real, deliberate
// divergence between the two request queries.
const PD_REQUEST_SELECT =
  'akoya_requestid,akoya_requestnum,akoya_title,wmkf_meetingdate,wmkf_abstract,' +
  '_akoya_applicantid_value,_wmkf_projectleader_value,_wmkf_grantprogram_value,' +
  '_wmkf_programareaserved_value';
const PD_ACCEPTED_REQUEST_SELECT =
  'akoya_requestid,akoya_requestnum,akoya_title,wmkf_meetingdate,wmkf_abstract,' +
  'wmkf_organizationname,_akoya_applicantid_value,_wmkf_projectleader_value,' +
  '_wmkf_grantprogram_value,_wmkf_programareaserved_value';
const SUGGESTION_SELECT = selectFields('wmkf_appreviewersuggestions').join(',');

// ───────────────────────── contact ─────────────────────────

describe('contact.findByEmail (characterization)', () => {
  test('golden: queries contacts top:1 with quoted email filter, returns records[0]', async () => {
    const q = jest.spyOn(DynamicsService, 'queryRecords').mockResolvedValue({ records: [{ contactid: GUID_A }] });
    const out = await contact.findByEmail('a@b.org');
    expect(out).toEqual({ contactid: GUID_A });
    expect(q).toHaveBeenCalledWith('contacts', {
      select: CONTACT_SELECT,
      filter: "emailaddress1 eq 'a@b.org'",
      top: 1,
    });
  });
  test('escapes single quotes in the email filter', async () => {
    const q = jest.spyOn(DynamicsService, 'queryRecords').mockResolvedValue({ records: [] });
    await contact.findByEmail("o'brien@x.org");
    expect(q.mock.calls[0][1].filter).toBe("emailaddress1 eq 'o''brien@x.org'");
  });
  test('failure/edge: falsy email short-circuits to null, no query', async () => {
    const q = jest.spyOn(DynamicsService, 'queryRecords').mockResolvedValue({ records: [] });
    expect(await contact.findByEmail('')).toBeNull();
    expect(q).not.toHaveBeenCalled();
  });
  test('no match returns null', async () => {
    jest.spyOn(DynamicsService, 'queryRecords').mockResolvedValue({ records: [] });
    expect(await contact.findByEmail('a@b.org')).toBeNull();
  });
});

describe('contact.getById (characterization)', () => {
  test('golden: getRecord with primary select', async () => {
    const g = jest.spyOn(DynamicsService, 'getRecord').mockResolvedValue({ contactid: GUID_A });
    const out = await contact.getById(GUID_A);
    expect(out).toEqual({ contactid: GUID_A });
    expect(g).toHaveBeenCalledWith('contacts', GUID_A, { select: CONTACT_SELECT });
  });
  test('failure/edge: falsy id short-circuits to null WITHOUT calling getRecord', async () => {
    const g = jest.spyOn(DynamicsService, 'getRecord').mockResolvedValue(null);
    expect(await contact.getById(undefined)).toBeNull();
    expect(g).not.toHaveBeenCalled();
  });
});

describe('contact.normalizeEmail (characterization)', () => {
  test('golden: trims + lowercases', () => {
    expect(contact.normalizeEmail('  A@B.Org  ')).toBe('a@b.org');
  });
  test('failure/edge: null/undefined → empty string', () => {
    expect(contact.normalizeEmail(null)).toBe('');
    expect(contact.normalizeEmail(undefined)).toBe('');
  });
});

// ──────────────────── potential-reviewer ────────────────────

describe('potential-reviewer.getByEmail (characterization)', () => {
  test('golden: queries top:1 with quoted email filter, returns records[0]', async () => {
    const q = jest.spyOn(DynamicsService, 'queryRecords').mockResolvedValue({
      records: [{ wmkf_potentialreviewersid: GUID_A }],
    });
    const out = await pr.getByEmail('a@b.org');
    expect(out).toEqual({ wmkf_potentialreviewersid: GUID_A });
    expect(q).toHaveBeenCalledWith('wmkf_potentialreviewerses', {
      select: PR_SELECT,
      filter: "wmkf_emailaddress eq 'a@b.org'",
      top: 1,
    });
  });
  test('failure/edge: falsy email → null, no query', async () => {
    const q = jest.spyOn(DynamicsService, 'queryRecords').mockResolvedValue({ records: [] });
    expect(await pr.getByEmail('')).toBeNull();
    expect(q).not.toHaveBeenCalled();
  });
});

describe('potential-reviewer.getById (characterization)', () => {
  test('golden: getRecord with primary select', async () => {
    const g = jest.spyOn(DynamicsService, 'getRecord').mockResolvedValue({ wmkf_potentialreviewersid: GUID_A });
    const out = await pr.getById(GUID_A);
    expect(out).toEqual({ wmkf_potentialreviewersid: GUID_A });
    expect(g).toHaveBeenCalledWith('wmkf_potentialreviewerses', GUID_A, { select: PR_SELECT });
  });
  test('behavior lock: UNLIKE contact.getById, no falsy-id guard — still calls getRecord', async () => {
    const g = jest.spyOn(DynamicsService, 'getRecord').mockResolvedValue(null);
    await pr.getById(undefined);
    expect(g).toHaveBeenCalledWith('wmkf_potentialreviewerses', undefined, { select: PR_SELECT });
  });
});

// ─────────────────────── researcher ───────────────────────

describe('researcher.getByPotentialReviewer (characterization)', () => {
  const BIBLIO_SELECT =
    'wmkf_potentialreviewersid,wmkf_primaryaffiliation,wmkf_department,wmkf_orcid,wmkf_orcidurl,' +
    'wmkf_googlescholarid,wmkf_googlescholarurl,wmkf_hindex,wmkf_i10index,wmkf_totalcitations,' +
    'wmkf_website,wmkf_facultypageurl,wmkf_keywords,wmkf_emailsource,wmkf_lastchecked,' +
    'wmkf_metricsupdatedat,wmkf_contactenrichedat,wmkf_contactenrichmentsource';
  test('golden: getRecord with the bibliometric select', async () => {
    const g = jest.spyOn(DynamicsService, 'getRecord').mockResolvedValue({ wmkf_potentialreviewersid: GUID_A });
    const out = await researcher.getByPotentialReviewer(GUID_A);
    expect(out).toEqual({ wmkf_potentialreviewersid: GUID_A });
    expect(g).toHaveBeenCalledWith('wmkf_potentialreviewerses', GUID_A, { select: BIBLIO_SELECT });
  });
  test('failure/edge: falsy id → null, no read', async () => {
    const g = jest.spyOn(DynamicsService, 'getRecord').mockResolvedValue(null);
    expect(await researcher.getByPotentialReviewer('')).toBeNull();
    expect(g).not.toHaveBeenCalled();
  });
  test('behavior lock: getRecord throwing is SWALLOWED → null (not propagated)', async () => {
    jest.spyOn(DynamicsService, 'getRecord').mockRejectedValue(new Error('boom'));
    expect(await researcher.getByPotentialReviewer(GUID_A)).toBeNull();
  });
});

// ─────────────────── reviewer-suggestion PD scope ───────────────────

describe('reviewer-suggestion.findByPD (characterization)', () => {
  test('golden: two-step (akoya_requests → suggestions) with selected+notExcluded filter', async () => {
    const qAll = jest.spyOn(DynamicsService, 'queryAllRecords').mockResolvedValue({
      records: [{ akoya_requestid: GUID_A, akoya_requestnum: 'REQ-1' }],
    });
    const q = jest.spyOn(DynamicsService, 'queryRecords').mockResolvedValue({
      records: [{ wmkf_appreviewersuggestionid: GUID_B }],
    });

    const out = await suggestion.findByPD(PD_ID);

    // Step 1: request scope by PD.
    expect(qAll).toHaveBeenCalledTimes(1);
    expect(qAll.mock.calls[0][0]).toBe('akoya_requests');
    expect(qAll.mock.calls[0][1].select).toBe(PD_REQUEST_SELECT);
    expect(qAll.mock.calls[0][1].filter).toBe(`_wmkf_programdirector_value eq ${PD_ID}`);

    // Step 2: suggestions for those requests, selected + not-excluded.
    expect(q).toHaveBeenCalledTimes(1);
    expect(q.mock.calls[0][0]).toBe('wmkf_appreviewersuggestions');
    expect(q.mock.calls[0][1].select).toBe(SUGGESTION_SELECT);
    expect(q.mock.calls[0][1].filter).toBe(
      `(_wmkf_request_value eq ${GUID_A}) and wmkf_selected eq true and ` +
        '(wmkf_applicantdisposition eq null or wmkf_applicantdisposition ne 100000001)',
    );
    expect(q.mock.calls[0][1].orderby).toBe('createdon desc');
    expect(q.mock.calls[0][1].top).toBe(500);

    expect(out.suggestions).toEqual([{ wmkf_appreviewersuggestionid: GUID_B }]);
    expect(out.requestById[GUID_A]).toMatchObject({ requestId: GUID_A, requestNumber: 'REQ-1' });
  });

  test('failure/edge: no PD id → empty result, no queries', async () => {
    const qAll = jest.spyOn(DynamicsService, 'queryAllRecords').mockResolvedValue({ records: [] });
    const out = await suggestion.findByPD('');
    expect(out).toEqual({ suggestions: [], requestById: {} });
    expect(qAll).not.toHaveBeenCalled();
  });

  test('edge: PD has no requests → empty suggestions, second step skipped', async () => {
    jest.spyOn(DynamicsService, 'queryAllRecords').mockResolvedValue({ records: [] });
    const q = jest.spyOn(DynamicsService, 'queryRecords').mockResolvedValue({ records: [] });
    const out = await suggestion.findByPD(PD_ID);
    expect(out).toEqual({ suggestions: [], requestById: {} });
    expect(q).not.toHaveBeenCalled();
  });

  test('edge: selectedOnly:false drops the wmkf_selected clause but keeps notExcluded', async () => {
    jest.spyOn(DynamicsService, 'queryAllRecords').mockResolvedValue({
      records: [{ akoya_requestid: GUID_A, akoya_requestnum: 'REQ-1' }],
    });
    const q = jest.spyOn(DynamicsService, 'queryRecords').mockResolvedValue({ records: [] });
    await suggestion.findByPD(PD_ID, { selectedOnly: false });
    expect(q.mock.calls[0][1].filter).toBe(
      `(_wmkf_request_value eq ${GUID_A}) and ` +
        '(wmkf_applicantdisposition eq null or wmkf_applicantdisposition ne 100000001)',
    );
  });

  test('edge: cycleCode J26 appends the June-2026 wmkf_meetingdate window to the request filter', async () => {
    const qAll = jest.spyOn(DynamicsService, 'queryAllRecords').mockResolvedValue({ records: [] });
    await suggestion.findByPD(PD_ID, { cycleCode: 'J26' });
    expect(qAll.mock.calls[0][1].filter).toBe(
      `_wmkf_programdirector_value eq ${PD_ID} and ` +
        'wmkf_meetingdate ge 2026-06-01T00:00:00Z and wmkf_meetingdate lt 2026-07-01T00:00:00Z',
    );
  });
});

describe('reviewer-suggestion.findAcceptedByPD (characterization)', () => {
  test('golden: adds wmkf_accepted eq true to the selected+notExcluded filter', async () => {
    jest.spyOn(DynamicsService, 'queryAllRecords').mockResolvedValue({
      records: [{ akoya_requestid: GUID_A, akoya_requestnum: 'REQ-1' }],
    });
    const q = jest.spyOn(DynamicsService, 'queryRecords').mockResolvedValue({
      records: [{ wmkf_appreviewersuggestionid: GUID_B }],
    });

    const out = await suggestion.findAcceptedByPD(PD_ID);

    expect(q.mock.calls[0][0]).toBe('wmkf_appreviewersuggestions');
    expect(q.mock.calls[0][1].select).toBe(SUGGESTION_SELECT);
    expect(q.mock.calls[0][1].filter).toBe(
      `(_wmkf_request_value eq ${GUID_A}) and wmkf_selected eq true and wmkf_accepted eq true and ` +
        '(wmkf_applicantdisposition eq null or wmkf_applicantdisposition ne 100000001)',
    );
    expect(q.mock.calls[0][1].orderby).toBe('createdon desc');
    expect(q.mock.calls[0][1].top).toBe(500);
    expect(out.suggestions).toEqual([{ wmkf_appreviewersuggestionid: GUID_B }]);
  });

  test('failure/edge: no PD id → empty result, no queries', async () => {
    const qAll = jest.spyOn(DynamicsService, 'queryAllRecords').mockResolvedValue({ records: [] });
    const out = await suggestion.findAcceptedByPD('');
    expect(out).toEqual({ suggestions: [], requestById: {} });
    expect(qAll).not.toHaveBeenCalled();
  });
});
