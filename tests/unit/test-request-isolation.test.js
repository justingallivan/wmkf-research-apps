import fs from 'fs';
import path from 'path';
import {
  buildOrdinaryTestRequestFetchXmlFilter,
  buildOrdinaryTestRequestODataFilter,
  assertOrdinaryRequestSnapshot,
  classifyTestRequestSnapshot,
  projectTestRequestVisibilityRecord,
  ordinaryTestRequestODataFilterForNavigation,
  testRequestVisibilityDto,
  TEST_REQUEST_ISOLATION_FIELDS,
  SYNTHETIC_REVIEWER_MARKER_FIELDS,
  assertTestRequestMarkerNotWritten,
  withOrdinaryTestRequestODataFilter,
  withTestRequestIsolationSelect,
} from '../../lib/services/test-requests/isolation';
import { ensureAttribute } from '../../lib/dataverse/schema-apply';

const VALID_RUN = '22222222-2222-4222-8222-222222222222';
const fields = TEST_REQUEST_ISOLATION_FIELDS;

describe('test-request isolation classifier', () => {
  test.each([
    [{ [fields.marker]: true, [fields.runId]: VALID_RUN }, 'synthetic'],
    [{ [fields.marker]: true }, 'anomaly'],
    [{ [fields.marker]: true, [fields.runId]: '' }, 'anomaly'],
    [{ [fields.marker]: true, [fields.runId]: 'bad' }, 'anomaly'],
    [{ [fields.marker]: false, [fields.runId]: null }, 'ordinary'],
    [{ [fields.marker]: false, [fields.runId]: '' }, 'anomaly'],
    [{ [fields.marker]: false, [fields.runId]: VALID_RUN }, 'anomaly'],
    [{ [fields.marker]: null, [fields.runId]: null }, 'ordinary'],
    [{ [fields.marker]: null }, 'unknown'],
    [{ [fields.marker]: 'false', [fields.runId]: null }, 'unknown'],
    [{ [fields.marker]: null, [fields.runId]: VALID_RUN }, 'anomaly'],
    [{ [fields.marker]: false }, 'unknown'],
    [{ [fields.runId]: null }, 'unknown'],
    [{}, 'unknown'],
    [null, 'unknown'],
  ])('classifies %j as %s', (snapshot, expected) => {
    expect(classifyTestRequestSnapshot(snapshot).kind).toBe(expected);
  });

  test('does not mutate a trusted source projection', () => {
    const snapshot = Object.freeze({ [fields.marker]: true, [fields.runId]: VALID_RUN });
    const before = JSON.stringify(snapshot);
    expect(classifyTestRequestSnapshot(snapshot)).toEqual({
      kind: 'synthetic', reason: 'marker_and_run_valid', runId: VALID_RUN,
    });
    expect(JSON.stringify(snapshot)).toBe(before);
  });

  test('classifies selected legacy nulls as ordinary without granting test-operation authorization', () => {
    const result = classifyTestRequestSnapshot({ [fields.marker]: null, [fields.runId]: null });
    expect(result).toEqual({ kind: 'ordinary', reason: 'marker_null_and_run_null' });
    expect(result).not.toHaveProperty('authorized');
    expect(result).not.toHaveProperty('marker');
    expect(result).not.toHaveProperty('runId');
    expect(classifyTestRequestSnapshot({ [fields.marker]: { secret: 'do-not-echo' }, [fields.runId]: { secret: 'also-do-not-echo' } })).toEqual({
      kind: 'unknown', reason: 'marker_value_invalid',
    });
  });

  test('ordinary assertion classifies internally and rejects every nonordinary state', () => {
    expect(assertOrdinaryRequestSnapshot({ [fields.marker]: false, [fields.runId]: null })).toEqual({ ok: true });
    expect(assertOrdinaryRequestSnapshot({ [fields.marker]: true, [fields.runId]: VALID_RUN })).toEqual({
      ok: false, code: 'test_request_not_ordinary',
    });
    expect(assertOrdinaryRequestSnapshot({ [fields.marker]: null, [fields.runId]: null })).toEqual({ ok: true });
    expect(assertOrdinaryRequestSnapshot({ [fields.marker]: null })).toEqual({
      ok: false, code: 'test_request_not_ordinary',
    });
    expect(assertOrdinaryRequestSnapshot({ kind: 'ordinary' })).toEqual({
      ok: false, code: 'test_request_not_ordinary',
    });
  });
});

describe('ordinary-only query fragments', () => {
  test('treats a false or legacy-null marker with no run as ordinary', () => {
    expect(buildOrdinaryTestRequestODataFilter()).toBe('((wmkf_istestrequest eq false or wmkf_istestrequest eq null) and wmkf_testcreationrunid eq null)');
    expect(buildOrdinaryTestRequestFetchXmlFilter()).toBe(
      '<filter type="and"><filter type="or"><condition attribute="wmkf_istestrequest" operator="eq" value="0"/><condition attribute="wmkf_istestrequest" operator="null"/></filter><condition attribute="wmkf_testcreationrunid" operator="null"/></filter>',
    );
  });

  test('fragments accept no caller inputs', () => {
    expect(buildOrdinaryTestRequestODataFilter.length).toBe(0);
    expect(buildOrdinaryTestRequestFetchXmlFilter.length).toBe(0);
  });
});

describe('Stage 1d gated visibility helpers', () => {
  const on = { TEST_REQUEST_ISOLATION: 'on' };
  const off = { TEST_REQUEST_ISOLATION: 'off' };
  const synthetic = { id: 'r1', [fields.marker]: true, [fields.runId]: VALID_RUN };

  test('switch off preserves selects, filters and DTOs without naming marker fields', () => {
    expect(withTestRequestIsolationSelect('id,name', off)).toBe('id,name');
    expect(withOrdinaryTestRequestODataFilter('statecode eq 0', off)).toBe('statecode eq 0');
    expect(testRequestVisibilityDto(synthetic, off)).toEqual({});
    expect(projectTestRequestVisibilityRecord(synthetic, off)).toBe(synthetic);
  });

  test('switch on adds trusted projection, ordinary filter and badge-only DTO', () => {
    expect(withTestRequestIsolationSelect('id,name', on)).toBe(
      'id,name,wmkf_istestrequest,wmkf_testcreationrunid',
    );
    expect(withOrdinaryTestRequestODataFilter('statecode eq 0', on)).toBe(
      '(statecode eq 0) and ((wmkf_istestrequest eq false or wmkf_istestrequest eq null) and wmkf_testcreationrunid eq null)',
    );
    expect(ordinaryTestRequestODataFilterForNavigation('akoya_requestlookup')).toBe(
      '((akoya_requestlookup/wmkf_istestrequest eq false or akoya_requestlookup/wmkf_istestrequest eq null) and akoya_requestlookup/wmkf_testcreationrunid eq null)',
    );
    expect(testRequestVisibilityDto(synthetic, on)).toEqual({ isTestRequest: true });
    expect(projectTestRequestVisibilityRecord(synthetic, on)).toEqual({ id: 'r1', isTestRequest: true });
  });

  test('legacy null and false rows both project as ordinary', () => {
    expect(testRequestVisibilityDto({ [fields.marker]: null, [fields.runId]: null }, on)).toEqual({ isTestRequest: false });
    expect(testRequestVisibilityDto({ [fields.marker]: false, [fields.runId]: null }, on)).toEqual({ isTestRequest: false });
  });
});

describe('slice 6c-i: synthetic-reviewer person marker (D-R1) is a write-guard-only fold-in', () => {
  test('TEST_REQUEST_ISOLATION_FIELDS (request filters/select) is unchanged: exactly the two akoya_request fields', () => {
    expect(Object.keys(fields)).toEqual(['marker', 'runId']);
    expect(Object.values(fields)).toEqual(['wmkf_istestrequest', 'wmkf_testcreationrunid']);
  });

  test('SYNTHETIC_REVIEWER_MARKER_FIELDS names only the person-entity marker', () => {
    expect(SYNTHETIC_REVIEWER_MARKER_FIELDS).toEqual({ marker: 'wmkf_issyntheticreviewer' });
  });

  test('assertTestRequestMarkerNotWritten refuses the synthetic-reviewer marker at any depth', () => {
    for (const data of [
      { wmkf_issyntheticreviewer: true },
      { wmkf_issyntheticreviewer: false },
      { WMKF_IsSyntheticReviewer: null },
      { name: 'x', wmkf_PotentialReviewer: { wmkf_name: 'TEST · x', wmkf_issyntheticreviewer: true } },
      { related: [{ ok: 1 }, { wmkf_issyntheticreviewer: true }] },
    ]) {
      expect(() => assertTestRequestMarkerNotWritten(data))
        .toThrow(expect.objectContaining({ code: 'test_request_marker_immutable' }));
    }
  });

  test('assertTestRequestMarkerNotWritten refuses a URL naming the synthetic-reviewer marker property', () => {
    const guid = '33333333-3333-4333-8333-333333333333';
    expect(() => assertTestRequestMarkerNotWritten(undefined, `wmkf_potentialreviewers(${guid})/wmkf_issyntheticreviewer`))
      .toThrow(expect.objectContaining({ code: 'test_request_marker_immutable' }));
  });
});

describe('isolated schema body', () => {
  test('tracked JSON schema produces the expected Dataverse attribute payloads', async () => {
    const schemaPath = path.resolve(process.cwd(), 'lib/dataverse/schema/wave29-test-request-isolation/akoya_request-test-request-isolation.json');
    const fileSchema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
    expect(fileSchema.kind).toBe('extensions-on-existing');
    expect(fileSchema.entityLogicalName).toBe('akoya_request');
    expect(fileSchema.attributes).toHaveLength(2);
    expect(fileSchema.attributes[0]).toEqual(expect.objectContaining({
      type: 'Boolean', schemaName: 'wmkf_IsTestRequest', default: false, requiredLevel: 'None',
    }));
    expect(fileSchema.attributes[1]).toEqual(expect.objectContaining({
      type: 'String', schemaName: 'wmkf_TestCreationRunId', maxLength: 36, requiredLevel: 'None',
    }));
    expect(fileSchema.attributes.map((attribute) => attribute.schemaName)).toEqual([
      'wmkf_IsTestRequest', 'wmkf_TestCreationRunId',
    ]);
    const posts = [];
    const client = {
      get: async () => ({ ok: true, body: { value: [] } }),
      post: async (_url, body) => { posts.push(body); return { ok: true }; },
    };
    for (const attribute of fileSchema.attributes) {
      await ensureAttribute(client, fileSchema.entityLogicalName, attribute);
    }
    expect(posts).toHaveLength(2);
    expect(posts[0]).toEqual(expect.objectContaining({
      '@odata.type': 'Microsoft.Dynamics.CRM.BooleanAttributeMetadata',
      SchemaName: 'wmkf_IsTestRequest',
      DefaultValue: false,
      RequiredLevel: { Value: 'None' },
    }));
    expect(posts[0].OptionSet.TrueOption.Label.LocalizedLabels[0].Label).toBe('Test request');
    expect(posts[0].OptionSet.FalseOption.Label.LocalizedLabels[0].Label).toBe('Ordinary request');
    expect(posts[1]).toEqual(expect.objectContaining({
      '@odata.type': 'Microsoft.Dynamics.CRM.StringAttributeMetadata',
      SchemaName: 'wmkf_TestCreationRunId',
      MaxLength: 36,
      RequiredLevel: { Value: 'None' },
    }));
  });

  test('sandbox reminder parity wave contains only the two existing disable controls', async () => {
    const schemaPath = path.resolve(process.cwd(), 'lib/dataverse/schema/wave29-test-request-reminder-controls/akoya_request-test-request-reminder-controls.json');
    const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
    expect(schema.kind).toBe('extensions-on-existing');
    expect(schema.entityLogicalName).toBe('akoya_request');
    expect(schema.attributes).toHaveLength(2);
    expect(schema.attributes.map((attribute) => attribute.schemaName)).toEqual([
      'wmkf_RespondReminderEnabled', 'wmkf_ReviewDueReminderEnabled',
    ]);
    expect(schema.attributes.every((attribute) => attribute.type === 'Boolean' && attribute.default === true)).toBe(true);
    expect(schema).not.toHaveProperty('relationships');

    const posts = [];
    const client = {
      get: async () => ({ ok: true, body: { value: [] } }),
      post: async (_url, body) => { posts.push(body); return { ok: true }; },
    };
    for (const attribute of schema.attributes) {
      await ensureAttribute(client, schema.entityLogicalName, attribute);
    }
    expect(posts).toHaveLength(2);
    expect(posts.map((body) => body.SchemaName)).toEqual([
      'wmkf_RespondReminderEnabled', 'wmkf_ReviewDueReminderEnabled',
    ]);
    expect(posts.every((body) => body.DefaultValue === true)).toBe(true);
  });

  test('schema body does not smuggle reminder, triage, or relationship changes', () => {
    const schemaPath = path.resolve(process.cwd(), 'lib/dataverse/schema/wave29-test-request-isolation/akoya_request-test-request-isolation.json');
    const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
    const text = JSON.stringify(schema).toLowerCase();
    expect(text).not.toContain('respondreminder');
    expect(text).not.toContain('reviewduereminder');
    expect(text).not.toContain('triagestatus');
    expect(schema).not.toHaveProperty('relationships');
  });

  test('wave30 synthetic-reviewer-marker wave: tracked JSON schema is creation-only, Boolean, on the person entity (D-R1)', async () => {
    const schemaPath = path.resolve(process.cwd(), 'lib/dataverse/schema/wave30-synthetic-reviewer-marker/wmkf_potentialreviewer-synthetic-reviewer-marker.json');
    const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
    expect(schema.kind).toBe('extensions-on-existing');
    expect(schema.entityLogicalName).toBe('wmkf_potentialreviewers');
    expect(schema.attributes).toHaveLength(1);
    expect(schema.attributes[0]).toEqual(expect.objectContaining({
      type: 'Boolean', schemaName: 'wmkf_IsSyntheticReviewer', default: false, requiredLevel: 'None',
    }));
    expect(schema).not.toHaveProperty('relationships');
    expect(schema).not.toHaveProperty('triggers');

    const posts = [];
    const client = {
      get: async () => ({ ok: true, body: { value: [] } }),
      post: async (_url, body) => { posts.push(body); return { ok: true }; },
    };
    for (const attribute of schema.attributes) {
      await ensureAttribute(client, schema.entityLogicalName, attribute);
    }
    expect(posts).toHaveLength(1);
    expect(posts[0]).toEqual(expect.objectContaining({
      '@odata.type': 'Microsoft.Dynamics.CRM.BooleanAttributeMetadata',
      SchemaName: 'wmkf_IsSyntheticReviewer',
      DefaultValue: false,
      RequiredLevel: { Value: 'None' },
    }));
    expect(posts[0].OptionSet.TrueOption.Label.LocalizedLabels[0].Label).toBe('Synthetic reviewer');
    expect(posts[0].OptionSet.FalseOption.Label.LocalizedLabels[0].Label).toBe('Ordinary reviewer');
  });
});
