/**
 * @jest-environment node
 */

const { createClient } = require('../../lib/dataverse/client.js');

describe('dataverse client solution binding', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    global.fetch = jest.fn();
  });

  test('emits the concrete MSCRM.SolutionUniqueName header on PATCH', async () => {
    let request;
    global.fetch = jest.fn(async (url, options) => {
      request = { url, options };
      return {
        ok: true,
        status: 204,
        text: async () => '',
      };
    });

    const client = createClient({
      resourceUrl: 'https://wmkf.crm.dynamics.com',
      token: 'token',
      solutionUniqueName: 'wmkfResearchReviewAppSuite',
    });

    await client.raw('PATCH', '/savedqueries(08b51bf9-47c5-4ef5-a1a5-6af4713bca5b)', {
      fetchxml: '<fetch />',
    });

    expect(request.options.method).toBe('PATCH');
    expect(request.options.headers['MSCRM.SolutionUniqueName']).toBe('wmkfResearchReviewAppSuite');
  });
});
