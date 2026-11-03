/** @jest-environment node */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Client } from 'pg';
import { createRunLedger } from '../../lib/services/test-requests/run-ledger.js';
import { createReadinessJournal } from '../../lib/services/test-requests/readiness-journal.js';
import { listLedgerMigrationFiles, LEDGER_MIGRATIONS_DIR } from '../../lib/db/ledger-schema.js';
const url = process.env.TEST_REQUEST_LEDGER_TEST_URL || '';
if (url && !['localhost','127.0.0.1','::1'].includes(new URL(url).hostname)) throw Error('Local scratch PostgreSQL required.');
if (!url && process.env.TEST_REQUEST_LEDGER_REQUIRE === '1') throw Error('Required scratch PostgreSQL URL missing.');
const PLAN = {
  runId: '11111111-1111-1111-1111-111111111111',
  recipe: 'basic',
  sourceDataverseHost: 'source.crm.dynamics.com',
  sourceRequestId: '22222222-2222-2222-2222-222222222222',
  sourceRequestNumber: '1003222',
  sourceRevision: 'rev-1',
  bundleSha256: 'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb',
  bundleExportedAt: '2026-09-23T00:00:00.000Z',
  copyPolicyVersion: '1',
  copyPolicyDigest: '3e23e8160039594a33894f6564e1b1348bbd7a0088d42c4acb73eeaed59c009d',
  planDigest: '0649f282d35bcb0d7688e39055d04af4c9ee54ea8ec0c7758ec63f04844a39a8',
  createBodySha256: '2e7d2c03a9507ae265ecf5b5356885a53393a2029d241394997265a1a25aefc6',
  destinationEnvironment: 'production',
  destinationDataverseHost: 'sandbox.crm.dynamics.com',
  destinationRequestId: '33333333-3333-3333-3333-333333333333',
  destinationLocationId: '44444444-4444-4444-4444-444444444444',
  expectedAppUserId: '55555555-5555-5555-5555-555555555555',
  expectedOrganizationId: '66666666-6666-6666-6666-666666666666',
  expectedGraphSiteId: 'appriver3651007194.sharepoint.com,48930e19-0000-4000-8000-000000000000,11111111-1111-4111-8111-111111111111',
  expectedGraphDriveId: 'b!GQ6TSC-650adweD3-KAAAAAAAAAAAA',
  fiscalYear: 'December 2026',
  meetingDate: '2026-10-01',
  testLabel: 'ZZTEST',
};

(url ? describe : describe.skip)('readiness journal PostgreSQL contract', () => {
  let client, journal;
  const schema='readiness_'+crypto.randomBytes(5).toString('hex');
  beforeAll(async () => {
    client=new Client({connectionString:url});await client.connect();await client.query(`CREATE SCHEMA ${schema}`);await client.query(`SET search_path TO ${schema}`);
    for(const file of listLedgerMigrationFiles())await client.query(fs.readFileSync(path.join(LEDGER_MIGRATIONS_DIR,file),'utf8'));
    const db={query:(...args)=>client.query(...args), transaction: async fn=> { await client.query('BEGIN');try{const result=await fn(db);await client.query('COMMIT');return result;}catch(e){await client.query('ROLLBACK');throw e;} }};
    await createRunLedger(db).reserveRun({actorId:'cli:'+'a'.repeat(16),idempotencyKey:'readiness-test',plan:PLAN});
    journal=createReadinessJournal(db);
  });
  afterAll(async()=>{if(client){await client.query('SET search_path TO public');await client.query(`DROP SCHEMA ${schema} CASCADE`);await client.end();}});
  test('uncompleted runs cannot gain a readiness intent', async()=>{expect(await journal.plan(PLAN.runId,'W/"1"',false)).toBeNull();});
  test('ready run has one immutable intent; only one dispatcher wins',async()=>{
    await client.query("UPDATE test_request_runs SET status='ready', destination_request_number='900001', completed_at=NOW() WHERE run_id=$1",[PLAN.runId]);
    const first=await journal.plan(PLAN.runId,'W/"1"',false);const retry=await journal.plan(PLAN.runId,'W/"2"',null);
    expect(retry.etag_before).toBe(first.etag_before);expect(retry.ready_before).toBe(false);
    const results=await Promise.all([journal.dispatch(PLAN.runId),journal.dispatch(PLAN.runId)]);expect(results.filter(Boolean)).toHaveLength(1);
    expect(await journal.dispatch(PLAN.runId)).toBeNull();
  });
  test('completion requires applied true readback and remains terminal',async()=>{
    expect(await journal.complete(PLAN.runId,{kind:'readiness_finalization'})).toBeNull();
    expect(await journal.applied(PLAN.runId)).toMatchObject({status:'applied',ready_after:true});
    expect(await journal.complete(PLAN.runId,{kind:'readiness_finalization',outcome:'complete'})).toMatchObject({status:'complete',ready_after:true});
    expect(await journal.applied(PLAN.runId)).toBeNull();expect(await journal.dispatch(PLAN.runId)).toBeNull();
  });
  test('schema rejects incoherent complete state and unsafe receipt',async()=>{
    await expect(client.query("UPDATE test_request_readiness_finalizations SET ready_after=FALSE WHERE run_id=$1",[PLAN.runId])).rejects.toThrow();
    await expect(client.query("UPDATE test_request_readiness_finalizations SET effects=$2::jsonb WHERE run_id=$1",[PLAN.runId,JSON.stringify({body:'not permitted'})])).rejects.toThrow();
  });
  test('owner recovery retains prior attempt and fences stale dispatchers',async()=>{
    const plan={...PLAN,runId:crypto.randomUUID(),destinationRequestId:crypto.randomUUID(),destinationLocationId:crypto.randomUUID()};
    const db={query:(...args)=>client.query(...args),transaction:async fn=>{await client.query('BEGIN');try{const value=await fn(db);await client.query('COMMIT');return value;}catch(e){await client.query('ROLLBACK');throw e;}}};
    await createRunLedger(db).reserveRun({actorId:'cli:'+'b'.repeat(16),idempotencyKey:'readiness-recovery',plan});
    await client.query("UPDATE test_request_runs SET status='ready',destination_request_number='900002',completed_at=NOW() WHERE run_id=$1",[plan.runId]);
    const store=createReadinessJournal(db);await store.plan(plan.runId,'W/"10"',false);await store.dispatch(plan.runId,1);await store.attention(plan.runId,'readiness_etag_conflict',1);
    const previous=await store.get(plan.runId);const abandoned=await store.recover(plan.runId,previous);
    expect(abandoned).toMatchObject({attempt:1,status:'abandoned',error:'readiness_etag_conflict'});
    expect((await client.query('SELECT count(*)::int AS count FROM test_request_readiness_finalizations WHERE run_id=$1',[plan.runId])).rows[0].count).toBe(1);
    const next=await store.plan(plan.runId,'W/"11"',false);
    expect(next).toMatchObject({attempt:2,status:'planned',etag_before:'W/"11"'});
    expect(await store.recover(plan.runId,previous)).toBeNull();
    expect(await store.applied(plan.runId,1)).toBeNull();expect(await store.dispatch(plan.runId,1)).toBeNull();
    const history=(await client.query('SELECT attempt,status,etag_before FROM test_request_readiness_finalizations WHERE run_id=$1 ORDER BY attempt',[plan.runId])).rows;
    expect(history).toEqual([{attempt:1,status:'abandoned',etag_before:'W/"10"'},{attempt:2,status:'planned',etag_before:'W/"11"'}]);
    expect(await store.dispatch(plan.runId,2)).toMatchObject({status:'dispatched',attempt:2});
  });

});
