/**
 * Characterization tests for the wmkf_ai_prompts adapter (Wave 3).
 *
 * Locks the EXACT DynamicsService call each adapter method makes — entity set,
 * `$select`, `$filter`, `$orderby`, `top`, PATCH/POST bodies, and options — so a
 * later conversion commit can swap the four live callers onto these methods with
 * a provable behavior freeze (no DTO / filter / error drift). Each method mirrors
 * a specific live call site, cited inline.
 *
 * @jest-environment node
 */

import { jest } from '@jest/globals';
import { DynamicsService } from '../../lib/services/dynamics-service.js';
import * as aiPrompt from '../../lib/dataverse/adapters/ai-prompt.js';

afterEach(() => jest.restoreAllMocks());

const GUID_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const GUID_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

// Exact $select strings, byte-verified against the live callers.
const EXECUTOR_SELECT =
  'wmkf_ai_promptid,wmkf_ai_promptname,wmkf_ai_systemprompt,wmkf_ai_promptbody,' +
  'wmkf_ai_promptvariables,wmkf_ai_promptoutputschema,wmkf_ai_model,' +
  'wmkf_ai_temperature,wmkf_ai_maxtokens,wmkf_promptversion';
const ADMIN_ROW_SELECT =
  'wmkf_ai_promptid,wmkf_ai_promptname,wmkf_promptversion,wmkf_ai_iscurrent,' +
  'wmkf_ai_promptstatus,wmkf_ai_systemprompt,wmkf_ai_promptbody,' +
  'wmkf_ai_promptvariables,wmkf_ai_promptoutputschema,wmkf_ai_model,' +
  'wmkf_ai_temperature,wmkf_ai_maxtokens,' +
  'createdon,modifiedon,_modifiedby_value,wmkf_ai_publisheddatetime';
const SEED_LIST_SELECT =
  'wmkf_ai_promptid,wmkf_ai_promptname,wmkf_promptversion,wmkf_ai_iscurrent';

// ───────────────── getCurrentForExecutor (prompt-store.js:47) ─────────────────

describe('aiPrompt.getCurrentForExecutor (characterization)', () => {
  test('golden: executor select, name+current filter, top:2; returns the single row', async () => {
    const q = jest.spyOn(DynamicsService, 'queryRecords').mockResolvedValue({
      records: [{ wmkf_ai_promptid: GUID_A }],
    });
    const out = await aiPrompt.getCurrentForExecutor('reviewer-summary');
    expect(out).toEqual({ wmkf_ai_promptid: GUID_A });
    expect(q).toHaveBeenCalledWith('wmkf_ai_prompts', {
      select: EXECUTOR_SELECT,
      filter: "wmkf_ai_promptname eq 'reviewer-summary' and wmkf_ai_iscurrent eq true",
      top: 2,
    });
  });

  test('escapes single quotes in the prompt name (OData quote-doubling)', async () => {
    const q = jest.spyOn(DynamicsService, 'queryRecords').mockResolvedValue({
      records: [{ wmkf_ai_promptid: GUID_A }],
    });
    await aiPrompt.getCurrentForExecutor("o'brien");
    expect(q.mock.calls[0][1].filter).toBe(
      "wmkf_ai_promptname eq 'o''brien' and wmkf_ai_iscurrent eq true",
    );
  });

  test('0 rows → typed PROMPT_NOT_FOUND error, verbatim message', async () => {
    jest.spyOn(DynamicsService, 'queryRecords').mockResolvedValue({ records: [] });
    await expect(aiPrompt.getCurrentForExecutor('missing')).rejects.toMatchObject({
      code: 'PROMPT_NOT_FOUND',
      message: 'No current prompt found for name "missing"',
    });
  });

  test('>1 rows → typed PROMPT_DUPLICATE_CURRENT error, verbatim message', async () => {
    jest.spyOn(DynamicsService, 'queryRecords').mockResolvedValue({
      records: [{ wmkf_ai_promptid: GUID_A }, { wmkf_ai_promptid: GUID_B }],
    });
    await expect(aiPrompt.getCurrentForExecutor('dupe')).rejects.toMatchObject({
      code: 'PROMPT_DUPLICATE_CURRENT',
      message: 'Multiple current prompts for name "dupe" — resolve in Dynamics',
    });
  });

  test('transport failure propagates unwrapped (no code)', async () => {
    jest.spyOn(DynamicsService, 'queryRecords').mockRejectedValue(new Error('boom'));
    await expect(aiPrompt.getCurrentForExecutor('x')).rejects.toMatchObject({ message: 'boom' });
    await expect(aiPrompt.getCurrentForExecutor('x')).rejects.not.toHaveProperty('code');
  });

  test('exported error codes are stable', () => {
    expect(aiPrompt.PROMPT_STORE_ERROR_CODES).toEqual({
      NOT_FOUND: 'PROMPT_NOT_FOUND',
      DUPLICATE_CURRENT: 'PROMPT_DUPLICATE_CURRENT',
    });
  });
});

// ───────────────── listCurrent / listNonCurrent (admin index.js:64,67) ─────────

describe('aiPrompt.listCurrent (characterization)', () => {
  test('golden: admin select, iscurrent eq true, name asc, top:200; passes {records} through', async () => {
    const q = jest.spyOn(DynamicsService, 'queryRecords').mockResolvedValue({ records: [{ x: 1 }] });
    const out = await aiPrompt.listCurrent();
    expect(out).toEqual({ records: [{ x: 1 }] });
    expect(q).toHaveBeenCalledWith('wmkf_ai_prompts', {
      select: ADMIN_ROW_SELECT,
      filter: 'wmkf_ai_iscurrent eq true',
      orderby: 'wmkf_ai_promptname asc',
      top: 200,
    });
  });
});

describe('aiPrompt.listNonCurrent (characterization)', () => {
  test('golden: admin select, iscurrent eq false, version desc, top:200', async () => {
    const q = jest.spyOn(DynamicsService, 'queryRecords').mockResolvedValue({ records: [] });
    await aiPrompt.listNonCurrent();
    expect(q).toHaveBeenCalledWith('wmkf_ai_prompts', {
      select: ADMIN_ROW_SELECT,
      filter: 'wmkf_ai_iscurrent eq false',
      orderby: 'wmkf_promptversion desc',
      top: 200,
    });
  });
});

// ───────────────── listVersions (admin [name].js:68 handleGet) ─────────────────

describe('aiPrompt.listVersions (characterization)', () => {
  test('golden: admin select, name filter, version desc, top:50', async () => {
    const q = jest.spyOn(DynamicsService, 'queryRecords').mockResolvedValue({ records: [] });
    await aiPrompt.listVersions('my-prompt');
    expect(q).toHaveBeenCalledWith('wmkf_ai_prompts', {
      select: ADMIN_ROW_SELECT,
      filter: "wmkf_ai_promptname eq 'my-prompt'",
      orderby: 'wmkf_promptversion desc',
      top: 50,
    });
  });
  test('escapes the name', async () => {
    const q = jest.spyOn(DynamicsService, 'queryRecords').mockResolvedValue({ records: [] });
    await aiPrompt.listVersions("a'b");
    expect(q.mock.calls[0][1].filter).toBe("wmkf_ai_promptname eq 'a''b'");
  });
});

// ───────────────── queryCurrentRows (admin [name].js:111 publish load) ─────────

describe('aiPrompt.queryCurrentRows (characterization)', () => {
  test('golden: admin select, name+current filter, top:3', async () => {
    const q = jest.spyOn(DynamicsService, 'queryRecords').mockResolvedValue({ records: [] });
    await aiPrompt.queryCurrentRows('p');
    expect(q).toHaveBeenCalledWith('wmkf_ai_prompts', {
      select: ADMIN_ROW_SELECT,
      filter: "wmkf_ai_promptname eq 'p' and wmkf_ai_iscurrent eq true",
      top: 3,
    });
  });
});

// ───────────────── queryCurrentIdVersions (admin [name].js:213 verify) ─────────

describe('aiPrompt.queryCurrentIdVersions (characterization)', () => {
  test('golden: slim id+version select, name+current filter, top:3', async () => {
    const q = jest.spyOn(DynamicsService, 'queryRecords').mockResolvedValue({ records: [] });
    await aiPrompt.queryCurrentIdVersions('p');
    expect(q).toHaveBeenCalledWith('wmkf_ai_prompts', {
      select: 'wmkf_ai_promptid,wmkf_promptversion',
      filter: "wmkf_ai_promptname eq 'p' and wmkf_ai_iscurrent eq true",
      top: 3,
    });
  });
});

// ───────────────── listSeedRows (prompt-seed.js:40 loadRows) ────────────────────

describe('aiPrompt.listSeedRows (characterization)', () => {
  test('golden: seed select, name filter, version desc, top:50', async () => {
    const q = jest.spyOn(DynamicsService, 'queryRecords').mockResolvedValue({ records: [] });
    await aiPrompt.listSeedRows('p');
    expect(q).toHaveBeenCalledWith('wmkf_ai_prompts', {
      select: SEED_LIST_SELECT,
      filter: "wmkf_ai_promptname eq 'p'",
      orderby: 'wmkf_promptversion desc',
      top: 50,
    });
  });
});

// ───────────────── getIdOnly (admin [name].js:168,238; seed:111) ────────────────

describe('aiPrompt.getIdOnly (characterization)', () => {
  test('golden: getRecord by id with id-only select; returns the record (with _etag)', async () => {
    const g = jest.spyOn(DynamicsService, 'getRecord').mockResolvedValue({ wmkf_ai_promptid: GUID_A, _etag: 'W/"1"' });
    const out = await aiPrompt.getIdOnly(GUID_A);
    expect(out).toEqual({ wmkf_ai_promptid: GUID_A, _etag: 'W/"1"' });
    expect(g).toHaveBeenCalledWith('wmkf_ai_prompts', GUID_A, { select: 'wmkf_ai_promptid' });
  });
});

// ───────────────── create (admin [name].js:176; seed:101) ───────────────────────

describe('aiPrompt.create (characterization)', () => {
  test('golden: createRecord with the caller-assembled body verbatim, default opts {}', async () => {
    const c = jest.spyOn(DynamicsService, 'createRecord').mockResolvedValue({ wmkf_ai_promptid: GUID_A });
    const body = { wmkf_ai_promptname: 'p', wmkf_ai_promptbody: 'x', wmkf_ai_iscurrent: true, wmkf_promptversion: 2 };
    const out = await aiPrompt.create(body);
    expect(out).toEqual({ wmkf_ai_promptid: GUID_A });
    expect(c).toHaveBeenCalledWith('wmkf_ai_prompts', body, {});
  });
  test('forwards opts (e.g. actingUserSystemId) unchanged', async () => {
    const c = jest.spyOn(DynamicsService, 'createRecord').mockResolvedValue({ wmkf_ai_promptid: GUID_A });
    await aiPrompt.create({ a: 1 }, { actingUserSystemId: GUID_B });
    expect(c).toHaveBeenCalledWith('wmkf_ai_prompts', { a: 1 }, { actingUserSystemId: GUID_B });
  });
});

// ───────────────── setIsCurrent (admin [name].js:200,239; seed:112) ─────────────

describe('aiPrompt.setIsCurrent (characterization)', () => {
  test('golden: PATCH {wmkf_ai_iscurrent:false} with ifMatch guard', async () => {
    const u = jest.spyOn(DynamicsService, 'updateRecord').mockResolvedValue(undefined);
    await aiPrompt.setIsCurrent(GUID_A, false, { ifMatch: 'W/"7"' });
    expect(u).toHaveBeenCalledWith('wmkf_ai_prompts', GUID_A, { wmkf_ai_iscurrent: false }, { ifMatch: 'W/"7"' });
  });
  test('forwards opts verbatim (null ifMatch preserved, matching the live flip call)', async () => {
    const u = jest.spyOn(DynamicsService, 'updateRecord').mockResolvedValue(undefined);
    await aiPrompt.setIsCurrent(GUID_A, false, { ifMatch: null });
    expect(u).toHaveBeenCalledWith('wmkf_ai_prompts', GUID_A, { wmkf_ai_iscurrent: false }, { ifMatch: null });
  });
  test('default opts {} when none supplied', async () => {
    const u = jest.spyOn(DynamicsService, 'updateRecord').mockResolvedValue(undefined);
    await aiPrompt.setIsCurrent(GUID_A, true);
    expect(u).toHaveBeenCalledWith('wmkf_ai_prompts', GUID_A, { wmkf_ai_iscurrent: true }, {});
  });
});

// ───────────────── entity-set guard ────────────────────────────────────────────

describe('aiPrompt entity set', () => {
  test('resolves to the canonical wmkf_ai_prompts set (registry-validated)', () => {
    expect(aiPrompt.ENTITY_SET_NAME).toBe('wmkf_ai_prompts');
  });
});
