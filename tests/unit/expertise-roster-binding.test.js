/** @jest-environment node */
jest.mock('@vercel/postgres', () => ({ db: { connect: jest.fn() } }));
import { db } from '@vercel/postgres';
import { ensureProfileBinding } from '../../lib/services/expertise-finder/roster-binding';
import { rosterMode, rosterTarget } from '../../lib/services/expertise-finder/roster-mode';
const marker = require('../../lib/services/expertise-finder/roster-cutover-marker.cjs');
const id = '11111111-1111-4111-8111-111111111111';
let client;
beforeEach(() => { client = { query: jest.fn(async () => ({ rows: [] })), release: jest.fn() }; db.connect.mockResolvedValue(client); });
test('new Admin profile gets the legacy numeric sequence identity and one binding', async () => {
  client.query.mockImplementation(async q => ({ rows: q.startsWith('INSERT INTO expertise_roster_identity') ? [{ id: 40 }] : [] }));
  expect(await ensureProfileBinding('wmkf.crm.dynamics.com',id,'app_'+id)).toBe(40);
  expect(client.query).toHaveBeenCalledWith(expect.stringContaining("nextval('expertise_roster_id_seq')"));
  expect(client.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO expertise_roster_binding'),[40,'wmkf.crm.dynamics.com',id]);
  expect(client.query).toHaveBeenLastCalledWith('COMMIT'); expect(client.release).toHaveBeenCalled();
});
test.each(['legacy_dataset_1','direct_profile','app_bad',null])('unbound %s never allocates a replacement identity', async key => {
  await expect(ensureProfileBinding('wmkf.crm.dynamics.com',id,key)).rejects.toMatchObject({ code:'roster_binding_requires_reconciliation' });
  expect(client.query.mock.calls.some(([q])=>q.includes('nextval'))).toBe(false);
});
test('existing imported binding survives retries without allocation', async () => {
  client.query.mockImplementation(async q=>({ rows: q.startsWith('SELECT roster_id') ? [{roster_id:1}] : [] }));
  expect(await ensureProfileBinding('wmkf.crm.dynamics.com',id,'legacy_dataset_1')).toBe(1);
  expect(client.query.mock.calls.some(([q])=>q.includes('nextval'))).toBe(false);
});
test('Postgres default, invalid mode/target fail closed',()=>{
  expect(rosterMode({})).toBe('legacy'); expect(rosterMode({EXPERTISE_ROSTER_BACKEND:'postgres'})).toBe('legacy');
  expect(()=>rosterMode({EXPERTISE_ROSTER_BACKEND:'unknown'})).toThrow();
  expect(()=>rosterTarget({EXPERTISE_ROSTER_BACKEND:'dataverse',DYNAMICS_URL:'https://other.crm.dynamics.com'})).toThrow();
});
test('first production binding blocks legacy writes; empty/absent bridge does not', async()=>{
  const query=jest.fn().mockResolvedValueOnce({rows:[{present:false}]}).mockResolvedValueOnce({rows:[{present:true}]}).mockResolvedValueOnce({rows:[]});
  await expect(marker.assertLegacyRosterWritable(query)).resolves.toBeUndefined(); await expect(marker.assertLegacyRosterWritable(query)).resolves.toBeUndefined();
  query.mockResolvedValueOnce({rows:[{present:true}]}).mockResolvedValueOnce({rows:[{one:1}]});
  await expect(marker.assertLegacyRosterWritable(query)).rejects.toMatchObject({status:409,code:'roster_moved'});
});
