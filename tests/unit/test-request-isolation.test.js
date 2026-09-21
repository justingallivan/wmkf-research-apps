import fs from 'fs';
import path from 'path';
import {
  buildOrdinaryTestRequestFetchXmlFilter,
  buildOrdinaryTestRequestODataFilter,
  assertOrdinaryRequestSnapshot,
  classifyTestRequestSnapshot,
  TEST_REQUEST_ISOLATION_FIELDS,
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
    [{ [fields.marker]: null, [fields.runId]: null }, 'unknown'],
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

  test('does not provide a legacy-null exemption or test-operation authorization', () => {
    const result = classifyTestRequestSnapshot({ [fields.marker]: null, [fields.runId]: null });
    expect(result.kind).toBe('unknown');
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
    expect(assertOrdinaryRequestSnapshot({ [fields.marker]: null, [fields.runId]: null })).toEqual({
      ok: false, code: 'test_request_not_ordinary',
    });
    expect(assertOrdinaryRequestSnapshot({ kind: 'ordinary' })).toEqual({
      ok: false, code: 'test_request_not_ordinary',
    });
  });
});

describe('ordinary-only query fragments', () => {
  test('uses the exact false + null contract', () => {
    expect(buildOrdinaryTestRequestODataFilter()).toBe('(wmkf_istestrequest eq false and wmkf_testcreationrunid eq null)');
    expect(buildOrdinaryTestRequestFetchXmlFilter()).toBe(
      '<filter type="and"><condition attribute="wmkf_istestrequest" operator="eq" value="0"/><condition attribute="wmkf_testcreationrunid" operator="null"/></filter>',
    );
  });

  test('fragments accept no caller inputs', () => {
    expect(buildOrdinaryTestRequestODataFilter.length).toBe(0);
    expect(buildOrdinaryTestRequestFetchXmlFilter.length).toBe(0);
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
});
