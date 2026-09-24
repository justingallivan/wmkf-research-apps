/**
 * schema-apply: global option sets, multiselect picklists and file columns.
 */

const { ensureAttribute, ensureGlobalOptionSet } = require('../../lib/dataverse/schema-apply');

const GOS_ID = '11111111-2222-3333-4444-555555555555';

function fakeClient({ attributeExists = false, globalOptionSet = null, dryRun = false } = {}) {
  const posts = [];
  let gos = globalOptionSet;
  return {
    posts,
    get: async (path) => {
      if (path.includes('/GlobalOptionSetDefinitions(')) {
        return gos ? { ok: true, status: 200, body: gos } : { ok: false, status: 404, text: 'not found' };
      }
      if (path.includes('/Attributes?$filter=')) {
        return { ok: true, status: 200, body: { value: attributeExists ? [{ LogicalName: 'x' }] : [] } };
      }
      throw new Error(`unexpected GET ${path}`);
    },
    post: async (path, body) => {
      posts.push({ path, body });
      if (dryRun) return { ok: true, status: 0, text: '', body: null, dryRun: true };
      if (path === '/GlobalOptionSetDefinitions') gos = { MetadataId: GOS_ID, Name: body.Name };
      return { ok: true, status: 204, text: '' };
    },
  };
}

const OPTIONS = [{ value: 100000000, label: 'Draft' }, { value: 100000001, label: 'Published' }];

describe('schema-apply option sets and file columns', () => {
  test('binds a picklist to an existing global option set without recreating it', async () => {
    const client = fakeClient({ globalOptionSet: { MetadataId: GOS_ID, Name: 'wmkf_status' } });
    const r = await ensureAttribute(client, 'wmkf_thing', {
      type: 'Picklist', schemaName: 'wmkf_Status', globalOptionSet: { name: 'wmkf_status' }, options: OPTIONS,
    });
    expect(r.created).toBe(true);
    expect(client.posts).toHaveLength(1);
    const { body } = client.posts[0];
    expect(body['@odata.type']).toBe('Microsoft.Dynamics.CRM.PicklistAttributeMetadata');
    expect(body['GlobalOptionSet@odata.bind']).toBe(`/GlobalOptionSetDefinitions(${GOS_ID})`);
    expect(body.OptionSet).toBeUndefined();
  });

  test('creates a missing global option set, then binds the attribute to it', async () => {
    const client = fakeClient();
    await ensureAttribute(client, 'wmkf_thing', {
      type: 'Picklist', schemaName: 'wmkf_Status', globalOptionSet: { name: 'wmkf_status', displayName: 'Status' }, options: OPTIONS,
    });
    expect(client.posts.map((p) => p.path)).toEqual([
      '/GlobalOptionSetDefinitions',
      "/EntityDefinitions(LogicalName='wmkf_thing')/Attributes",
    ]);
    expect(client.posts[0].body).toMatchObject({ Name: 'wmkf_status', IsGlobal: true, OptionSetType: 'Picklist' });
    expect(client.posts[0].body.Options.map((o) => o.Value)).toEqual([100000000, 100000001]);
    expect(client.posts[1].body['GlobalOptionSet@odata.bind']).toBe(`/GlobalOptionSetDefinitions(${GOS_ID})`);
  });

  test('retries the read-back while a just-created global option set is not yet visible', async () => {
    jest.useFakeTimers();
    const client = fakeClient();
    const realGet = client.get;
    let misses = 2;
    client.get = async (p) => {
      if (p.includes('/GlobalOptionSetDefinitions(') && client.posts.length && misses > 0) {
        misses -= 1;
        return { ok: false, status: 404, text: '0x80040217' };
      }
      return realGet(p);
    };
    const pending = ensureGlobalOptionSet(client, { name: 'wmkf_status' }, OPTIONS);
    await jest.runAllTimersAsync();
    await expect(pending).resolves.toBe(GOS_ID);
    expect(misses).toBe(0);
    jest.useRealTimers();
  });

  test('gives up on the read-back after the attempt limit', async () => {
    const client = fakeClient();
    client.get = async () => ({ ok: false, status: 404, text: '0x80040217' });
    await expect(ensureGlobalOptionSet(client, { name: 'wmkf_status' }, OPTIONS, { readBackAttempts: 1 }))
      .rejects.toThrow(/could not read it back/);
  });

  test('retries the attribute create while the new global option set is not yet bindable', async () => {
    jest.useFakeTimers();
    const client = fakeClient({ globalOptionSet: { MetadataId: GOS_ID, Name: 'wmkf_status' } });
    const realPost = client.post;
    let refusals = 2;
    client.post = async (p, b) => {
      if (p.endsWith('/Attributes') && refusals > 0) {
        refusals -= 1;
        return { ok: false, status: 400, text: '{"error":{"code":"0x80048403","message":"IsGlobal is not specified."}}' };
      }
      return realPost(p, b);
    };
    const pending = ensureAttribute(client, 'wmkf_thing', {
      type: 'Picklist', schemaName: 'wmkf_Status', globalOptionSet: { name: 'wmkf_status' }, options: OPTIONS,
    });
    await jest.runAllTimersAsync();
    await expect(pending).resolves.toMatchObject({ created: true });
    expect(refusals).toBe(0);
    jest.useRealTimers();
  });

  test('does not retry other attribute-create failures', async () => {
    const client = fakeClient();
    let calls = 0;
    client.post = async () => { calls += 1; return { ok: false, status: 400, text: 'some other error' }; };
    await expect(ensureAttribute(client, 'account', { type: 'File', schemaName: 'wmkf_BoardList' })).rejects.toThrow(/Failed to create attribute/);
    expect(calls).toBe(1);
  });

  test('dry run of a missing global option set binds a placeholder id', async () => {
    const client = fakeClient({ dryRun: true });
    const id = await ensureGlobalOptionSet(client, { name: 'wmkf_status' }, OPTIONS);
    expect(id).toBe('00000000-0000-0000-0000-000000000000');
  });

  test('multiselect picklist with a local option set declares its options inline', async () => {
    const client = fakeClient();
    await ensureAttribute(client, 'akoya_request', {
      type: 'MultiSelectPicklist', schemaName: 'wmkf_PopulationServed2', options: OPTIONS,
    });
    const { body } = client.posts[0];
    expect(body['@odata.type']).toBe('Microsoft.Dynamics.CRM.MultiSelectPicklistAttributeMetadata');
    expect(body.OptionSet.IsGlobal).toBe(false);
    expect(body.OptionSet.Options).toHaveLength(2);
  });

  test('file column carries its maximum size', async () => {
    const client = fakeClient();
    await ensureAttribute(client, 'account', { type: 'File', schemaName: 'wmkf_BoardList', maxSizeInKB: 32768 });
    expect(client.posts[0].body).toMatchObject({
      '@odata.type': 'Microsoft.Dynamics.CRM.FileAttributeMetadata',
      MaxSizeInKB: 32768,
    });
  });

  test('an existing attribute is left alone', async () => {
    const client = fakeClient({ attributeExists: true });
    const r = await ensureAttribute(client, 'account', { type: 'File', schemaName: 'wmkf_BoardList' });
    expect(r.created).toBe(false);
    expect(client.posts).toHaveLength(0);
  });
});
