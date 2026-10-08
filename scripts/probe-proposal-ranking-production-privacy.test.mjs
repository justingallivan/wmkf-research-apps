import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectStaff, parseArgs, readAppRankingCollections } from './probe-proposal-ranking-production-privacy.mjs';

const staffId = '11111111-1111-4111-8111-111111111111';
const objectId = '22222222-2222-4222-8222-222222222222';
const appId = '33333333-3333-4333-8333-333333333333';
const tablePaths = [
  '/wmkf_proposalrankingcycles?$select=wmkf_proposalrankingcycleid&$top=1',
  '/wmkf_proposalrankingrounds?$select=wmkf_proposalrankingroundid&$top=1',
  '/wmkf_proposalrankinglists?$select=wmkf_proposalrankinglistid&$top=1',
];

test('argument parsing rejects multiple staff ID arguments', () => {
  assert.throws(() => parseArgs([
    'node', 'probe',
    '--staff-ids=11111111-1111-4111-8111-111111111111',
    '--staff-ids=22222222-2222-4222-8222-222222222222',
  ]), /exactly one --staff-ids/);
});

function mockClient({ collectionStatus = 403, privileges = true } = {}) {
  const calls = [];
  return {
    calls,
    client: {
      async get(path, headers) {
        calls.push({ path, headers });
        if (path.startsWith('/systemusers(') && path.includes('?$select=')) {
          return { ok: true, status: 200, body: {
            systemuserid: staffId,
            isdisabled: false,
            accessmode: 0,
            applicationid: null,
            azureactivedirectoryobjectid: objectId,
          } };
        }
        if (path.startsWith('/systemusers?')) {
          return { ok: true, status: 200, body: { value: [{ systemuserid: staffId }] } };
        }
        if (path.includes('RetrieveUserPrivileges')) {
          return privileges
            ? { ok: true, status: 200, body: { RolePrivileges: [{ PrivilegeName: 'prvReadaccount' }] } }
            : { ok: false, status: 403, body: {} };
        }
        if (tablePaths.includes(path)) {
          if (collectionStatus === 403) return { ok: false, status: 403, body: {} };
          return { ok: true, status: collectionStatus, body: { value: [] } };
        }
        throw new Error(`Unexpected mocked GET: ${path}`);
      },
    },
  };
}

test('staff proof checks all three exact table collections and accepts only 403', async () => {
  const { client, calls } = mockClient();
  const result = await inspectStaff(client, staffId, 0, appId);
  assert.equal(result.passed, true);
  assert.deepEqual(result.rankingCollectionReads, {
    wmkf_proposalrankingcycle: { status: 403, rowCount: null, denied: true },
    wmkf_proposalrankinground: { status: 403, rowCount: null, denied: true },
    wmkf_proposalrankinglist: { status: 403, rowCount: null, denied: true },
  });
  assert.deepEqual(calls.filter((call) => tablePaths.includes(call.path)).map((call) => call.path), tablePaths);
  assert.ok(calls.filter((call) => tablePaths.includes(call.path)).every((call) => call.headers?.CallerObjectId === objectId));
  assert.equal(JSON.stringify(result).includes(staffId), false);
});

test('200 with an empty table collection does not count as denial', async () => {
  const { client } = mockClient({ collectionStatus: 200 });
  const result = await inspectStaff(client, staffId, 0, appId);
  assert.equal(result.passed, false);
  assert.ok(Object.values(result.rankingCollectionReads).every((entry) => entry.status === 200 && entry.rowCount === 0 && !entry.denied));
});

test('missing complete privilege response fails closed', async () => {
  const { client, calls } = mockClient({ privileges: false });
  const result = await inspectStaff(client, staffId, 0, appId);
  assert.equal(result.passed, false);
  assert.equal(result.privilegeListComplete, false);
  assert.equal(calls.some((call) => tablePaths.includes(call.path)), false);
});

test('application baseline reads only the three table IDs and reports counts', async () => {
  const calls = [];
  const client = {
    async get(path) {
      calls.push(path);
      if (!tablePaths.includes(path)) throw new Error(`Unexpected mocked GET: ${path}`);
      return { ok: true, status: 200, body: { value: [] } };
    },
  };
  const result = await readAppRankingCollections(client);
  assert.deepEqual(calls, tablePaths);
  assert.ok(Object.values(result).every((entry) => entry.status === 200 && entry.rowCount === 0 && entry.noRows));
  assert.equal(JSON.stringify(result).includes('value'), false);
});
