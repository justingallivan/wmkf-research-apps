/** @jest-environment node */

import { listActive } from '../../lib/dataverse/adapters/grant-program.js';
import { DynamicsService } from '../../lib/services/dynamics-service.js';

afterEach(() => jest.restoreAllMocks());

test('lists active broad Grant Programs by live name under a bounded query', async () => {
  const query = jest.spyOn(DynamicsService, 'queryRecords').mockResolvedValue({ records: [] });
  await listActive({ top: 26 });
  expect(query).toHaveBeenCalledWith('wmkf_grantprograms', {
    select: 'wmkf_grantprogramid,wmkf_name,statecode',
    filter: 'statecode eq 0',
    orderby: 'wmkf_name asc',
    top: 26,
  });
});

test('caps an excessive caller limit at the shared query ceiling', async () => {
  const query = jest.spyOn(DynamicsService, 'queryRecords').mockResolvedValue({ records: [] });
  await listActive({ top: 500 });
  expect(query).toHaveBeenCalledWith('wmkf_grantprograms', expect.objectContaining({ top: 100 }));
});
