const { ORCIDService } = require('../../lib/services/orcid-service');

describe('ORCIDService.getWorkReferences', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('preserves DOI and PMID identifiers, skips title-only rows, and deduplicates', async () => {
    jest.spyOn(ORCIDService, 'getAccessToken').mockResolvedValue('token');
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        group: [
          {
            'work-summary': [{
              title: { title: { value: 'First work' } },
              'external-ids': {
                'external-id': [
                  { 'external-id-type': 'doi', 'external-id-value': '10.1000/ONE' },
                  { 'external-id-type': 'pmid', 'external-id-value': '12345' },
                ],
              },
            }],
          },
          {
            'work-summary': [{
              title: { title: { value: 'Duplicate DOI' } },
              'external-ids': {
                'external-id': [
                  { 'external-id-type': 'doi', 'external-id-value': '10.1000/one' },
                ],
              },
            }],
          },
          {
            'work-summary': [{
              title: { title: { value: 'Title only' } },
              'external-ids': { 'external-id': [] },
            }],
          },
        ],
      }),
    });

    await expect(ORCIDService.getWorkReferences(
      '0000-0002-1825-0097',
      'client',
      'secret',
      { limit: 10 },
    )).resolves.toEqual({
      totalCount: 3,
      examinedCount: 3,
      records: [{
        title: 'First work',
        doi: '10.1000/ONE',
        pmid: '12345',
      }],
    });
  });

  test('returns an empty list for a missing ORCID record', async () => {
    jest.spyOn(ORCIDService, 'getAccessToken').mockResolvedValue('token');
    jest.spyOn(global, 'fetch').mockResolvedValue({ ok: false, status: 404 });
    await expect(ORCIDService.getWorkReferences(
      '0000-0002-1825-0097',
      'client',
      'secret',
    )).resolves.toEqual({ totalCount: 0, examinedCount: 0, records: [] });
  });

  test('reports the complete provider count when the bounded work pool is truncated', async () => {
    jest.spyOn(ORCIDService, 'getAccessToken').mockResolvedValue('token');
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        group: [
          { 'work-summary': [] },
          { 'work-summary': [] },
          { 'work-summary': [] },
        ],
      }),
    });

    await expect(ORCIDService.getWorkReferences(
      '0000-0002-1825-0097',
      'client',
      'secret',
      { limit: 2 },
    )).resolves.toEqual({ totalCount: 3, examinedCount: 2, records: [] });
  });

  test('ignores container identifiers whose relationship is not self', async () => {
    jest.spyOn(ORCIDService, 'getAccessToken').mockResolvedValue('token');
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        group: [{
          'work-summary': [{
            title: { title: { value: 'Chapter' } },
            'external-ids': {
              'external-id': [{
                'external-id-type': 'doi',
                'external-id-value': '10.1000/container',
                'external-id-relationship': 'part-of',
              }],
            },
          }],
        }],
      }),
    });

    await expect(ORCIDService.getWorkReferences(
      '0000-0002-1825-0097',
      'client',
      'secret',
    )).resolves.toEqual({ totalCount: 1, examinedCount: 1, records: [] });
  });
});
