/**
 * @jest-environment node
 *
 * Stage 0 characterization pin (OData Escape Consolidation Plan) for
 * lib/dataverse/role-apply.js sites 1 (findRoleByName) and 2
 * (resolvePrivilegeIds): the constructed $filter doubles an embedded single
 * quote (`'` → `''`) byte-for-byte. Client is a caller-supplied arg, so no
 * module mock is needed. Survives the odata.escape swap unchanged.
 */
const { findRoleByName, resolvePrivilegeIds } = require('../../lib/dataverse/role-apply');

function okClient() {
  return { get: jest.fn().mockResolvedValue({ ok: true, body: { value: [] } }) };
}

test("findRoleByName doubles single quotes in the role-name filter literal", async () => {
  const client = okClient();
  await findRoleByName(client, "O'Brien", 'BU-GUID');
  const path = client.get.mock.calls[0][0];
  // encodeURIComponent leaves apostrophes unencoded, so the doubled literal survives verbatim
  // (surrounding spaces are %20-encoded, so assert the quoted literal fragment).
  expect(path).toContain("'O''Brien'");
});

test("resolvePrivilegeIds doubles single quotes in each name-eq clause", async () => {
  const client = okClient();
  await resolvePrivilegeIds(client, "Ta'ble", ['Read']);
  const path = client.get.mock.calls[0][0];
  expect(path).toContain("'prvReadTa''ble'");
});
