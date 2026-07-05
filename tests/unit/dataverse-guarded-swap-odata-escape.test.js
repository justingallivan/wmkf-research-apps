/**
 * @jest-environment node
 *
 * Stage 0 GUARDED-SWAP rejection pins (OData Escape Consolidation Plan, owner
 * ruling S331) for the two sites reclassified from mechanical to guarded:
 *   #8 lib/services/dataverse-app-access-service.js findRow(client, sid, appKey)
 *  #10 lib/services/dataverse-prefs-service.js       findRow(client, sid, key)
 *
 * A non-string key must FAIL CLOSED — the service throws and issues NO adapter
 * call — rather than silently coercing (which a bare odata.escape would do).
 * The pin is behavior-level (asserts a TypeError + no client.get), so it is
 * green on the pre-swap code (a non-string `.replace` throws) and stays green
 * once the explicit `typeof … !== 'string'` guard replaces it.
 */
const appAccess = require('../../lib/services/dataverse-app-access-service');
const prefs = require('../../lib/services/dataverse-prefs-service');

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

test("prefs findRow throws on a non-string key and issues no client.get", async () => {
  const client = spyClient();
  await expect(prefs.findRow(client, 'sys-guid', 123)).rejects.toThrow(/key must be a string/);
  expect(client.get).not.toHaveBeenCalled();
});
