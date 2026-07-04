/**
 * Wave-3 characterization tests: lock the exact DynamicsService calls the new
 * policy + review-question adapters issue, so a later conversion commit can swap
 * the live callers (`lib/external/policy-fetcher.js`,
 * `pages/api/admin/policies.js`, `lib/external/review-question-fetcher.js`) onto
 * these adapters and PROVE the entity set / `$select` / `$filter` / `$orderby` /
 * `$top` / `$expand` / write bodies are byte-identical to today.
 *
 * Contracts derived from the live callers:
 *   - policy-fetcher.js:53 (queryActiveSlotByCode)
 *   - pages/api/admin/policies.js:100 (querySlotByCode), :124 (getSlotForAdmin),
 *     :130 (queryVersionsByPolicy), :289 (queryVersionByLabel),
 *     :364 (createVersion), :394 (getSlotEtagRow), :401 (setActiveVersion),
 *     :433 (updateVersionState), :458 (getSlotCodeRow)
 *   - review-question-fetcher.js:157 (queryActiveQuestions)
 *
 * @jest-environment node
 */

import { jest } from '@jest/globals';
import { DynamicsService } from '../../lib/services/dynamics-service.js';
import * as policy from '../../lib/dataverse/adapters/policy.js';
import * as reviewQuestion from '../../lib/dataverse/adapters/review-question.js';

afterEach(() => jest.restoreAllMocks());

const POLICY_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const VERSION_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

// Exact $select strings (byte-equal to the live callers' select literals).
const POLICY_SLOT_SELECT =
  'wmkf_policyid,wmkf_code,wmkf_displayname,_wmkf_activeversion_value,statecode';
const POLICY_ADMIN_SELECT =
  'wmkf_policyid,wmkf_code,wmkf_displayname,_wmkf_activeversion_value';
const POLICY_VERSION_SELECT =
  'wmkf_policyversionid,wmkf_versionlabel,wmkf_policytitle,wmkf_policybody,wmkf_effectivedate,statecode,statuscode';
const ACTIVE_VERSION_EXPAND =
  'wmkf_ActiveVersion($select=wmkf_policyversionid,wmkf_versionlabel,wmkf_policytitle,wmkf_policybody,wmkf_effectivedate,statecode,_wmkf_policy_value)';
const QUESTION_SELECT =
  'wmkf_reviewquestionid,wmkf_questionkey,wmkf_questionorder,wmkf_questiontext,' +
  'wmkf_questiontype,wmkf_required,wmkf_maxlength,wmkf_hint,wmkf_options';

// ──────────────────────── policy — wmkf_policies reads ────────────────────────

describe('policy.queryActiveSlotByCode (characterization: policy-fetcher.js:53)', () => {
  test('golden: slot select + expand, code+statecode filter, top:1, passes result through', async () => {
    const q = jest
      .spyOn(DynamicsService, 'queryRecords')
      .mockResolvedValue({ records: [{ wmkf_policyid: POLICY_ID }] });
    const out = await policy.queryActiveSlotByCode('reviewer-coi');
    expect(out).toEqual({ records: [{ wmkf_policyid: POLICY_ID }] });
    expect(q).toHaveBeenCalledWith('wmkf_policies', {
      select: POLICY_SLOT_SELECT,
      filter: "wmkf_code eq 'reviewer-coi' and statecode eq 0",
      expand: ACTIVE_VERSION_EXPAND,
      top: 1,
    });
  });
  test('escapes single quotes in the code filter', async () => {
    const q = jest.spyOn(DynamicsService, 'queryRecords').mockResolvedValue({ records: [] });
    await policy.queryActiveSlotByCode("o'brien");
    expect(q.mock.calls[0][1].filter).toBe("wmkf_code eq 'o''brien' and statecode eq 0");
  });
});

describe('policy.querySlotByCode (characterization: policies.js:100)', () => {
  test('golden: admin select, quoted code filter, top:2', async () => {
    const q = jest.spyOn(DynamicsService, 'queryRecords').mockResolvedValue({ records: [] });
    await policy.querySlotByCode('reviewer-ai-use');
    expect(q).toHaveBeenCalledWith('wmkf_policies', {
      select: POLICY_ADMIN_SELECT,
      filter: "wmkf_code eq 'reviewer-ai-use'",
      top: 2,
    });
  });
});

describe('policy.getSlotForAdmin (characterization: policies.js:124)', () => {
  test('golden: getRecord with admin select', async () => {
    const g = jest.spyOn(DynamicsService, 'getRecord').mockResolvedValue({ wmkf_policyid: POLICY_ID });
    const out = await policy.getSlotForAdmin(POLICY_ID);
    expect(out).toEqual({ wmkf_policyid: POLICY_ID });
    expect(g).toHaveBeenCalledWith('wmkf_policies', POLICY_ID, { select: POLICY_ADMIN_SELECT });
  });
});

describe('policy.getSlotEtagRow (characterization: policies.js:394)', () => {
  test('golden: getRecord projecting only wmkf_policyid', async () => {
    const g = jest.spyOn(DynamicsService, 'getRecord').mockResolvedValue({ wmkf_policyid: POLICY_ID, _etag: 'W/"1"' });
    await policy.getSlotEtagRow(POLICY_ID);
    expect(g).toHaveBeenCalledWith('wmkf_policies', POLICY_ID, { select: 'wmkf_policyid' });
  });
});

describe('policy.getSlotCodeRow (characterization: policies.js:458)', () => {
  test('golden: getRecord projecting only wmkf_code', async () => {
    const g = jest.spyOn(DynamicsService, 'getRecord').mockResolvedValue({ wmkf_code: 'reviewer-coi' });
    await policy.getSlotCodeRow(POLICY_ID);
    expect(g).toHaveBeenCalledWith('wmkf_policies', POLICY_ID, { select: 'wmkf_code' });
  });
});

// ─────────────────── policy — wmkf_policyversions reads ───────────────────

describe('policy.queryVersionsByPolicy (characterization: policies.js:130)', () => {
  test('golden: version select, raw lookup filter, createdon desc, top:50', async () => {
    const q = jest.spyOn(DynamicsService, 'queryRecords').mockResolvedValue({ records: [] });
    await policy.queryVersionsByPolicy(POLICY_ID);
    expect(q).toHaveBeenCalledWith('wmkf_policyversions', {
      select: POLICY_VERSION_SELECT,
      filter: `_wmkf_policy_value eq ${POLICY_ID}`,
      orderby: 'createdon desc',
      top: 50,
    });
  });
});

describe('policy.queryVersionByLabel (characterization: policies.js:289)', () => {
  test('golden: raw lookup + quoted label filter, top:2', async () => {
    const q = jest.spyOn(DynamicsService, 'queryRecords').mockResolvedValue({ records: [] });
    await policy.queryVersionByLabel(POLICY_ID, 'v2');
    expect(q).toHaveBeenCalledWith('wmkf_policyversions', {
      select: POLICY_VERSION_SELECT,
      filter: `_wmkf_policy_value eq ${POLICY_ID} and wmkf_versionlabel eq 'v2'`,
      top: 2,
    });
  });
  test('escapes single quotes in the version label', async () => {
    const q = jest.spyOn(DynamicsService, 'queryRecords').mockResolvedValue({ records: [] });
    await policy.queryVersionByLabel(POLICY_ID, "v'2");
    expect(q.mock.calls[0][1].filter).toBe(
      `_wmkf_policy_value eq ${POLICY_ID} and wmkf_versionlabel eq 'v''2'`,
    );
  });
});

// ──────────────────── policy — writes (create / update) ────────────────────

describe('policy.createVersion (characterization: policies.js:364)', () => {
  test('golden: createRecord with the exact publish body + parent bind', async () => {
    const c = jest
      .spyOn(DynamicsService, 'createRecord')
      .mockResolvedValue({ wmkf_policyversionid: VERSION_ID });
    const out = await policy.createVersion(POLICY_ID, {
      versionLabel: 'v2',
      title: 'COI Policy',
      body: 'body text',
      effectiveDate: '2026-07-04',
    });
    expect(out).toEqual({ wmkf_policyversionid: VERSION_ID });
    expect(c).toHaveBeenCalledWith('wmkf_policyversions', {
      wmkf_versionlabel: 'v2',
      wmkf_policytitle: 'COI Policy',
      wmkf_policybody: 'body text',
      wmkf_effectivedate: '2026-07-04',
      'wmkf_Policy@odata.bind': `/wmkf_policies(${POLICY_ID})`,
    });
  });
});

describe('policy.setActiveVersion (characterization: policies.js:401)', () => {
  test('golden: PATCH parent active-version bind, conditional on ifMatch', async () => {
    const u = jest.spyOn(DynamicsService, 'updateRecord').mockResolvedValue(undefined);
    await policy.setActiveVersion(POLICY_ID, VERSION_ID, { ifMatch: 'W/"7"' });
    expect(u).toHaveBeenCalledWith(
      'wmkf_policies',
      POLICY_ID,
      { 'wmkf_ActiveVersion@odata.bind': `/wmkf_policyversions(${VERSION_ID})` },
      { ifMatch: 'W/"7"' },
    );
  });
});

describe('policy.updateVersionState (characterization: policies.js:433)', () => {
  test('golden: PATCH version statecode/statuscode from caller-owned values', async () => {
    const u = jest.spyOn(DynamicsService, 'updateRecord').mockResolvedValue(undefined);
    await policy.updateVersionState(VERSION_ID, { statecode: 1, statuscode: 2 });
    expect(u).toHaveBeenCalledWith('wmkf_policyversions', VERSION_ID, {
      statecode: 1,
      statuscode: 2,
    });
  });
});

// ──────────────── review-question — wmkf_reviewquestions read ────────────────

describe('reviewQuestion.queryActiveQuestions (characterization: review-question-fetcher.js:157)', () => {
  test('golden: question select, active filter, ordered, top:100, passes result through', async () => {
    const q = jest
      .spyOn(DynamicsService, 'queryRecords')
      .mockResolvedValue({ records: [{ wmkf_reviewquestionid: 'q1' }], totalCount: 1, hasMore: false });
    const out = await reviewQuestion.queryActiveQuestions();
    expect(out).toEqual({ records: [{ wmkf_reviewquestionid: 'q1' }], totalCount: 1, hasMore: false });
    expect(q).toHaveBeenCalledWith('wmkf_reviewquestions', {
      select: QUESTION_SELECT,
      filter: 'statecode eq 0',
      orderby: 'wmkf_questionorder',
      top: 100,
    });
  });
});
