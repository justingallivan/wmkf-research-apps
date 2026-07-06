/**
 * @jest-environment node
 *
 * Stage 0 GUARDED-SWAP rejection pins (OData Escape Consolidation Plan, owner
 * ruling S331) for the two sites reclassified from mechanical to guarded:
 *   #8 lib/services/dataverse-app-access-service.js findRow(client, sid, appKey)
 *  #10 lib/dataverse/adapters/user-preference.js     findByOwnerAndKey(sid, key)
 *
 * A non-string key must FAIL CLOSED — the service/adapter throws and issues NO
 * transport call — rather than silently coercing (which a bare odata.escape
 * would do). The prefs pin moved to the adapter during Q9 Stage 3.
 */
jest.mock('../../lib/services/dynamics-service', () => ({
  DynamicsService: { queryRecords: jest.fn() },
}));

const appAccess = require('../../lib/services/dataverse-app-access-service');
const userPreferenceAdapter = require('../../lib/dataverse/adapters/user-preference');
const { DynamicsService } = require('../../lib/services/dynamics-service');

function spyClient() {
  return { get: jest.fn() };
}

test("app-access findRow throws on a non-string appKey and issues no client.get", async () => {
  const client = spyClient();
  await expect(appAccess.findRow(client, 'sys-guid', 123)).rejects.toThrow(
    /appKey must be a string/,
  );
  expect(client.get).not.toHaveBeenCalled();
});

test("prefs adapter findByOwnerAndKey throws on a non-string key and issues no DynamicsService query", async () => {
  await expect(userPreferenceAdapter.findByOwnerAndKey('sys-guid', 123)).rejects.toThrow(/key must be a string/);
  expect(DynamicsService.queryRecords).not.toHaveBeenCalled();
});
