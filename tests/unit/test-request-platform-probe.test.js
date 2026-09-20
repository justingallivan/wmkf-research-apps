/** @jest-environment node */
const {
  all,
  flowFacts
} = require('../../scripts/probe-test-request-platform');
const origin = 'https://wmkf.crm.dynamics.com';
const path = '/api/data/v9.2/workflows';
test('follows same-collection pages and does not mistake errors for empty success', async () => {
  const get = jest.fn().mockResolvedValueOnce({
    ok: true,
    body: {
      value: [{
        id: 1
      }],
      '@odata.nextLink': origin + path + '?$skiptoken=2'
    }
  }).mockResolvedValueOnce({
    ok: true,
    body: {
      value: [{
        id: 2
      }]
    }
  });
  expect(await all({
    get
  }, origin, path)).toEqual({
    status: 200,
    complete: true,
    rows: [{
      id: 1
    }, {
      id: 2
    }]
  });
  expect(await all({
    get: jest.fn().mockResolvedValue({
      ok: false,
      status: 403
    })
  }, origin, path)).toEqual({
    status: 403,
    complete: false,
    rows: []
  });
});
test.each(['https://other.example/api/data/v9.2/workflows', origin + '/api/data/v9.2/akoya_requests'])('rejects unsafe continuation %s', async next => {
  const get = jest.fn().mockResolvedValue({
    ok: true,
    body: {
      value: [],
      '@odata.nextLink': next
    }
  });
  await expect(all({
    get
  }, origin, path)).rejects.toThrow('untrusted continuation');
  expect(get).toHaveBeenCalledTimes(1);
});
test('rejects malformed results and bounds cyclic paging', async () => {
  await expect(all({
    get: async () => ({
      ok: true,
      body: {}
    })
  }, origin, path)).rejects.toThrow('malformed');
  const get = jest.fn().mockResolvedValue({
    ok: true,
    body: {
      value: [],
      '@odata.nextLink': origin + path
    }
  });
  await expect(all({
    get
  }, origin, path)).rejects.toThrow('pagination bound');
  expect(get).toHaveBeenCalledTimes(30);
});
test('extracts nested/flattened trigger fields without exporting inputs, definitions or credentials', () => {
  const secret = 'fixture-secret-must-not-be-exported';
  const clientdata = JSON.stringify({
    properties: {
      definition: {
        triggers: {
          flat: {
            type: 'OpenApiConnectionWebhook',
            inputs: {
              parameters: {
                'subscriptionRequest/entityname': 'akoya_requests',
                'subscriptionRequest/message': 4,
                'subscriptionRequest/filterexpression': secret
              }
            }
          },
          nested: {
            inputs: {
              parameters: {
                subscriptionRequest: {
                  entityname: 'akoya_requests',
                  message: 1
                }
              }
            }
          }
        },
        actions: {
          send: {
            type: 'Http',
            inputs: {
              uri: 'https://example.test/?key=' + secret,
              headers: {
                Authorization: secret
              },
              body: secret
            }
          }
        }
      }
    }
  });
  const result = flowFacts({
    workflowid: 'id',
    name: 'fixture',
    category: 5,
    clientdata
  });
  expect(result.triggers.map(t => t.entity)).toEqual(['akoya_requests', 'akoya_requests']);
  expect(result.triggers.map(t => t.message)).toEqual([4, 1]);
  expect(result.triggers[0].hasFilterExpression).toBe(true);
  expect(result.definitionPresent).toBe(true);
  expect(result.definitionSha256).toMatch(/^[a-f0-9]{64}$/);
  expect(JSON.stringify(result)).not.toContain(secret);
  expect(JSON.stringify(result)).not.toContain('example.test');
  expect(flowFacts({
    clientdata: 'invalid'
  }).definitionPresent).toBe(false);
});

test('exports only selected registered owner metadata and requests formatted labels', async () => {
  const result = flowFacts({
    _ownerid_value: 'owner-id',
    '_ownerid_value@OData.Community.Display.V1.FormattedValue': 'Owner name',
    unrelatedAnnotation: 'must-not-export',
  });
  expect(result.registeredOwnerId).toBe('owner-id');
  expect(result.registeredOwnerName).toBe('Owner name');
  expect(JSON.stringify(result)).not.toContain('must-not-export');
  expect(flowFacts({}).registeredOwnerName).toBeNull();
  const get = jest.fn().mockResolvedValue({ ok: true, body: { value: [] } });
  await all({ get }, origin, path);
  expect(get).toHaveBeenCalledWith(origin + path, {
    Prefer: 'odata.include-annotations="OData.Community.Display.V1.FormattedValue"',
  });
});
