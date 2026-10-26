/** @jest-environment node */
import { DynamicsService } from '../../lib/services/dynamics-service';
import { listByOwnerAndKey } from '../../lib/dataverse/adapters/user-preference';
test('exact-owner/key DAL enumeration requests both predicates and complete read; capped results refuse', async () => {
  const read = jest.spyOn(DynamicsService, 'queryAllRecords').mockResolvedValue({ records: [{ wmkf_appuserpreferenceid: 'own' }], capped: false });
  const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', key = 'reviewer_automatic_acceptance_template';
  expect(await listByOwnerAndKey(owner, key)).toEqual([{ wmkf_appuserpreferenceid: 'own' }]);
  expect(read).toHaveBeenCalledWith('wmkf_appuserpreferences', expect.objectContaining({ filter: `_ownerid_value eq ${owner} and wmkf_preferencekey eq '${key}'`, select: expect.stringContaining('wmkf_isencrypted') }));
  read.mockResolvedValue({ records: [{ wmkf_appuserpreferenceid: 'partial' }], capped: true });
  await expect(listByOwnerAndKey(owner, key)).rejects.toThrow('incomplete'); read.mockRestore();
});
