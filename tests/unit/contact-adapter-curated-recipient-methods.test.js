/** @jest-environment node */

import { DynamicsService } from '../../lib/services/dynamics-service.js';
import { getByIds } from '../../lib/dataverse/adapters/contact.js';

const CONTACT_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_CONTACT_ID = '22222222-2222-4222-8222-222222222222';

afterEach(() => jest.restoreAllMocks());

test('contact.getByIds resolves unique GUIDs in one bounded collection query', async () => {
  const records = [{ contactid: CONTACT_ID }, { contactid: OTHER_CONTACT_ID }];
  const query = jest.spyOn(DynamicsService, 'queryRecords').mockResolvedValue({ records });

  await expect(getByIds([CONTACT_ID.toUpperCase(), OTHER_CONTACT_ID, CONTACT_ID]))
    .resolves.toEqual(records);
  expect(query).toHaveBeenCalledTimes(1);
  expect(query).toHaveBeenCalledWith('contacts', expect.objectContaining({
    filter: `(contactid eq ${CONTACT_ID} or contactid eq ${OTHER_CONTACT_ID})`,
    top: 2,
  }));
});

test('contact.getByIds skips an empty set and rejects invalid or over-cap input before Dataverse', async () => {
  const query = jest.spyOn(DynamicsService, 'queryRecords').mockResolvedValue({ records: [] });
  await expect(getByIds([])).resolves.toEqual([]);
  await expect(getByIds(['not-a-guid'])).rejects.toThrow(/every ID must be a GUID/);
  const tooMany = Array.from({ length: 51 }, (_, index) => (
    `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`
  ));
  await expect(getByIds(tooMany)).rejects.toThrow(/at most 50 IDs/);
  expect(query).not.toHaveBeenCalled();
});
