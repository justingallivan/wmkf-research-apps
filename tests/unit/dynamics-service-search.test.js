/**
 * @jest-environment node
 */

import { DynamicsService } from '../../lib/services/dynamics-service.js';

beforeEach(() => {
  jest.restoreAllMocks();
  fetch.mockReset();
  process.env.DYNAMICS_URL = 'https://example.crm.dynamics.com';
});

afterAll(() => {
  jest.restoreAllMocks();
});

test('Dataverse Search forwards native skip and stable orderby fields', async () => {
  jest.spyOn(DynamicsService, 'checkRestriction').mockImplementation(() => {});
  jest.spyOn(DynamicsService, 'getAccessToken').mockResolvedValue('token');
  jest.spyOn(DynamicsService, 'processAnnotations').mockImplementation((row) => row);
  fetch.mockResolvedValue({
    ok: true,
    json: async () => ({
      value: [{
        '@search.entityname': 'akoya_request',
        '@search.objectid': '11111111-1111-1111-1111-111111111111',
        '@search.score': 1,
      }],
      totalrecordcount: 31,
    }),
  });

  const output = await DynamicsService.searchRecords('university', {
    entities: ['akoya_request'],
    top: 25,
    skip: 25,
    orderby: ['@search.score desc', 'modifiedon desc', 'createdon desc', 'akoya_requestnum asc'],
    filter: "akoya_request:(akoya_requeststatus eq 'Active')",
  });

  const [url, init] = fetch.mock.calls[0];
  expect(String(url)).toBe('https://example.crm.dynamics.com/api/search/v1.0/query');
  expect(JSON.parse(init.body)).toEqual({
    search: 'university',
    top: 25,
    returntotalrecordcount: true,
    entities: ['akoya_request'],
    filter: "akoya_request:(akoya_requeststatus eq 'Active')",
    skip: 25,
    orderby: ['@search.score desc', 'modifiedon desc', 'createdon desc', 'akoya_requestnum asc'],
  });
  expect(output.totalCount).toBe(31);
});
