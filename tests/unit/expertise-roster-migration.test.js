/** @jest-environment node */
const { planImport } = require('../../scripts/lib/expertise-roster-import-plan.cjs');
const { executeImport } = require('../../scripts/lib/expertise-roster-import-execute.cjs');
const contract = require('../../lib/services/expertise-finder/roster-contract.cjs');
const DATASET = '11111111-1111-4111-8111-111111111111';
const CONTACT = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';
const PROFILE = '44444444-4444-4444-8444-444444444444';
const host = 'wmkf.crm.dynamics.com';
const row = { id: 1, name: 'Linked consultant', role_type: 'Consultant', is_active: true, dataverse_contact_id: CONTACT, ...Object.fromEntries(contract.TEXT.map(k => [k, k === 'expertise' ? '  Preserve this\nexactly  ' : null])) };
function fixtures() { return [ { version: 1, datasetId: DATASET, rows: [row] }, { version: 1, complete: true, targetHost: host, profiles: [] },
  { version: 1, datasetId: DATASET, targetHost: host, rows: [{ legacyId: 1, staffUserGuid: USER, contactGuid: CONTACT, leadPdEligible: true, active: true, roleType: 'Research Program Staff', confirmed: true }] }, [host] ]; }
test('Consultant to Staff preserves Contact and exact optional text alongside User', () => {
  const p = planImport(...fixtures()); expect(p.blocked).toBe(false);
  expect(p.rows[0].values).toMatchObject({ wmkf_contactguid: CONTACT, wmkf_staffuser: USER, wmkf_category: 100000000, wmkf_expertise: row.expertise });
});
test.each([null, USER])('Contact mapping cannot clear or replace source Contact (%s)', contactGuid => {
  const f = fixtures(); f[2].rows[0].contactGuid = contactGuid;
  expect(planImport(...f).rows[0]).toMatchObject({ action: 'blocked', errors: [expect.stringContaining('exactly preserve')] });
});
test('linked exclusion blocks, duplicate inactive link blocks both rows', () => {
  const f = fixtures(); Object.assign(f[2].rows[0], { exclude: true, active: false, leadPdEligible: false, staffUserGuid: null });
  expect(planImport(...f).blocked).toBe(true);
  delete f[2].rows[0].exclude;
  f[0].rows.push({ ...row, id: 2, is_active: false }); f[2].rows.push({ ...f[2].rows[0], legacyId: 2 });
  expect(planImport(...f).rows.map(r => r.action)).toEqual(['blocked', 'blocked']);
});
test('keyed rows with any changed field block rather than overwrite', () => {
  const f = fixtures(); const p = planImport(...f);
  f[1].profiles = [{ profileGuid: PROFILE, values: { ...p.rows[0].values, wmkf_keywords: 'changed' } }];
  expect(planImport(...f).blocked).toBe(true);
});
test('no side effect for blocked plan, even with apply', async () => {
  const store = { prepareIdentities: jest.fn() };
  await expect(executeImport({ blocked: true }, store, { apply: true })).rejects.toThrow('blocked');
  expect(store.prepareIdentities).not.toHaveBeenCalled();
});
test('lost create response plus failed binding retries same row without duplicate', async () => {
  const p = planImport(...fixtures()); let persisted = null;
  const store = { prepareIdentities: jest.fn(), saveReceipt: jest.fn(),
    byKey: jest.fn(async () => persisted),
    create: jest.fn(async values => { persisted = { profileGuid: PROFILE, values }; throw Error('lost response'); }),
    bind: jest.fn().mockRejectedValueOnce(Error('binding unavailable')).mockResolvedValueOnce(1),
  };
  const first = await executeImport(p, store, { apply: true }); expect(first.verified).toBe(false); expect(first.rows[0].status).toBe('failed');
  const next = await executeImport(p, store, { apply: true }); expect(next.verified).toBe(true); expect(next.rows[0].rosterId).toBe(1);
  expect(store.create).toHaveBeenCalledTimes(1);
});
test('ordinary updates and deactivation retain staff Contact', () => {
  const current = contract.normalize({ name: 'Person', dataverse_contact_id: CONTACT });
  const changed = contract.normalize({ role_type: 'Research Program Staff', dataverse_user_id: USER, is_active: false }, current);
  expect(contract.encode(changed)).toMatchObject({ wmkf_contactguid: CONTACT, statecode: 1, 'wmkf_StaffUser@odata.bind': `/systemusers(${USER})` });
});

test('inactive/missing Contact requires explicit retention on import but verification preserves history',()=>{
 const {applyContactHealth}=require('../../scripts/lib/expertise-roster-import-plan.cjs');
 for(const contact of [{ok:true,status:200,statecode:1},{ok:false,status:404}]){
  const f=fixtures();let row=planImport(...f).rows[0]; applyContactHealth(row,contact);expect(row.action).toBe('blocked');expect(row.values.wmkf_contactguid).toBe(CONTACT);
  f[2].rows[0].retainUnavailableContact=true;row=planImport(...f).rows[0];applyContactHealth(row,contact);expect(row.action).toBe('create');expect(row.values.wmkf_contactguid).toBe(CONTACT);
  row=planImport(...fixtures()).rows[0];applyContactHealth(row,contact,{verify:true});expect(row.action).toBe('create');expect(row.warnings.join(' ')).toContain('unavailable');
 }
 const row=planImport(...fixtures()).rows[0];expect(()=>applyContactHealth(row,{ok:false,status:503})).toThrow('health read failed');
});
