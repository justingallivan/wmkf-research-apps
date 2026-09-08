/** @jest-environment node */
jest.mock('@vercel/postgres', () => ({ db: { connect: jest.fn() }, sql: { query: jest.fn() } }));
import { db, sql } from '@vercel/postgres';
import { assertDossierActor, mutateDossierRun, publishDossierEdition, claimDossierRun, releaseDossierRun } from '../../lib/services/cycle-dossier-store';

let client;
beforeEach(() => {
  jest.clearAllMocks();
  client = { query: jest.fn().mockResolvedValue({ rows: [] }), release: jest.fn() };
  db.connect.mockResolvedValue(client);
});
test('active profile AND live superuser role are required even with a real profile ID', async () => {
  sql.query.mockResolvedValue({ rows: [] });
  await expect(assertDossierActor(7)).rejects.toMatchObject({ httpStatus: 403 });
  expect(sql.query).toHaveBeenCalledWith(expect.stringContaining("p.is_active=TRUE"), [7]);
  expect(sql.query.mock.calls[0][0]).toContain("r.role='superuser'");
});
test.each([
  ['foreign owner', { owner: 8 }, { owner_profile_id: 7 }, 404],
  ['old token', { leaseToken: 'old' }, { lease_token: 'new', locked_until: new Date(Date.now()+10000) }, 409],
  ['expired lease', { leaseToken: 'same' }, { lease_token: 'same', locked_until: new Date(0) }, 409],
])('%s cannot mutate even when the target row exists', async (_name, guard, values, httpStatus) => {
  client.query.mockImplementation(async query => ({ rows: query.startsWith('SELECT * FROM cycle_dossier_runs') ? [{ id:'run', data:{items:[]}, ...values }] : [] }));
  const write = jest.fn();
  await expect(mutateDossierRun('run', write, guard)).rejects.toMatchObject({ httpStatus });
  expect(write).not.toHaveBeenCalled();
  expect(client.query).toHaveBeenCalledWith('ROLLBACK');
  expect(client.release).toHaveBeenCalled();
});
test('mutation locks the run, verifies actor and commits updated data on the same connection', async () => {
  client.query.mockImplementation(async query => ({ rows: query.startsWith('SELECT * FROM cycle_dossier_runs')
    ? [{ id:'run',owner_profile_id:7,status:'running',data:{spentUsd:0},lease_token:'t',locked_until:new Date(Date.now()+10000) }]
    : query.includes('FROM user_profiles') ? [{ id:7 }] : [] }));
  const result = await mutateDossierRun('run', row => { row.data.spentUsd=2; }, { leaseToken:'t' });
  expect(result.data.spentUsd).toBe(2);
  expect(client.query).toHaveBeenCalledWith(expect.stringContaining('FOR UPDATE'), ['run']);
  expect(client.query).toHaveBeenCalledWith('COMMIT');
});
test('old already-published edition replay never moves latest pointer backward', async () => {
  client.query.mockResolvedValue({ rows: [] });
  await publishDossierEdition({id:'old',dossier_id:'d',owner_profile_id:7}, {files:{}}, client);
  expect(client.query).toHaveBeenCalledTimes(1);
  expect(client.query.mock.calls[0][0]).toContain('ready=FALSE RETURNING id');
});
test('first publication also compares persisted edition order before moving latest', async () => {
  client.query.mockResolvedValueOnce({rows:[{id:'new'}]}).mockResolvedValue({rows:[]});
  await publishDossierEdition({id:'new',dossier_id:'d',owner_profile_id:7},{files:{}},client);
  expect(client.query.mock.calls[1][0]).toContain('SELECT created_at FROM cycle_dossier_editions');
});
test('a concurrent worker with a live global lease prevents any new run claim', async () => {
  client.query.mockImplementation(async query => ({ rows: query.startsWith('SELECT id FROM cycle_dossier_runs') ? [{id:'active'}] : [] }));
  expect(await claimDossierRun()).toBeNull();
  expect(client.query.mock.calls.some(([q])=>q.includes('FOR UPDATE SKIP LOCKED'))).toBe(false);
});
test('expired paid attempts stay failed and retain their possible charge on reclaim', async () => {
  const expired = { id:'run',status:'running',lease_token:'expired',data:{ reservedUsd:7,items:[
    {requestId:'paid',status:'running',paidInFlight:true,reserved:true,reservationUsd:5},
    {requestId:'unpaid',status:'running',paidInFlight:false,reserved:true,reservationUsd:2},
  ]}};
  client.query.mockImplementation(async q => ({ rows:q.includes('ORDER BY created_at LIMIT 1') ? [expired] : [] }));
  const row = await claimDossierRun();
  expect(row.lease_token).not.toBe('expired');
  expect(row.data.reservedUsd).toBe(5);
  expect(row.data.items[0]).toMatchObject({status:'failed',reservationUsd:5});
  expect(row.data.items[1]).toMatchObject({status:'failed',reservationUsd:0,reserved:false});
});
test('unexpected in-flight exits keep the lease marker for expiry recovery', async () => {
  sql.query.mockResolvedValue({rows:[]});
  await releaseDossierRun('run','token');
  expect(sql.query.mock.calls[0][0]).toContain("i->>'status'='running'");
});
