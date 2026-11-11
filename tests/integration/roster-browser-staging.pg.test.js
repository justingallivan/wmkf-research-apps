/** @jest-environment node */
jest.mock('@vercel/blob',()=>({del:jest.fn(async()=>{}),get:jest.fn(),head:jest.fn()}));
jest.mock('@vercel/blob/client',()=>({generateClientTokenFromReadWriteToken:jest.fn(async()=> 'synthetic-client-token')}));
const fs=require('node:fs'),path=require('node:path');
const {parse}=require('dotenv');
const {createRosterPgFixture}=require('../helpers/roster-pg-fixture.cjs');
const {seed}=require('../../scripts/run-roster-browser-venue.cjs');
jest.setTimeout(30000);
const envFile=process.env.ROSTER_LIVE_SQL_TEST_ENV,live=envFile?test:test.skip;
live('browser staging uses only disposable schema with actor-bound claim and terminal transitions',async()=>{
 const fixture=await createRosterPgFixture(envFile),original=process.env;
 try{
  const env=parse(fs.readFileSync(envFile));process.env={...env,NODE_ENV:'production',AUTH_REQUIRED:'true',NEXTAUTH_URL:'http://localhost:3000',NEXTAUTH_SECRET:'synthetic-secret',AZURE_AD_CLIENT_ID:'synthetic',AZURE_AD_CLIENT_SECRET:'synthetic',AZURE_AD_TENANT_ID:'synthetic',EXPERTISE_ROSTER_BROWSER_REHEARSAL:'on',EXPERTISE_ROSTER_BROWSER_SCHEMA:fixture.schema,UPLOADS_BLOB_RW_TOKEN:'synthetic-test-token'};
  await seed(fixture,{azureactivedirectoryobjectid:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',internalemailaddress:'synthetic@example.invalid',systemuserid:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'});
  for(const migration of ['031_portal_upload_staging.sql','049_consultant_feedback_attachments.sql'])await fixture.primary.query(fs.readFileSync(path.join(process.cwd(),'lib/db/migrations',migration),'utf8'));
  jest.resetModules();const staging=require('../../lib/services/portal-upload-staging.js'),{del}=require('@vercel/blob');
  const scope=staging.PORTAL_UPLOAD_SCOPES.CONSULTANT_FEEDBACK,resourceId='11111111-1111-4111-8111-111111111111',actorBinding='profile:900001';
  async function create(){return staging.createPortalUpload({scope,resourceId,actorBinding,filename:'synthetic.pdf',contentType:'application/pdf',maxBytes:1024,allowedContentTypes:['application/pdf']});}
  const first=await create();await expect(staging.claimPortalUpload({stagingId:first.stagingId,scope,resourceId,actorBinding:'profile:wrong'})).rejects.toMatchObject({code:'staging_not_found'});
  const claimed=await staging.claimPortalUpload({stagingId:first.stagingId,scope,resourceId,actorBinding});
  expect(await staging.completePortalUpload({stagingId:first.stagingId,leaseToken:claimed.leaseToken,resultPayload:{ok:true}})).toEqual({ok:true});
  expect(del).toHaveBeenCalledWith(first.pathname,expect.any(Object));
  const second=await create(),other=await staging.claimPortalUpload({stagingId:second.stagingId,scope,resourceId,actorBinding});
  await staging.rejectPortalUpload({stagingId:second.stagingId,leaseToken:other.leaseToken,resultCode:'synthetic_rejection'});
  expect(del).toHaveBeenCalledWith(second.pathname,expect.any(Object));
  expect((await fixture.primary.query('SELECT status FROM portal_upload_staging ORDER BY created_at')).rows.map(r=>r.status)).toEqual(['consumed','rejected']);
 }finally{process.env=original;await fixture.cleanup();}
});

live('retained cleanup preserves owned schema and evidence while public fingerprint remains unchanged',async()=>{
 const {Client}=require('pg');const {assertTarget}=require('../../lib/services/expertise-finder/roster-rehearsal-target.cjs');
 const fixture=await createRosterPgFixture(envFile);let oid,retained=false;const env=parse(fs.readFileSync(envFile));const {connectionString}=assertTarget(env);
 try{
  oid=(await fixture.primary.query('SELECT oid::text AS oid FROM pg_namespace WHERE nspname=$1',[fixture.schema])).rows[0].oid;
  await fixture.primary.query('CREATE TABLE retention_evidence(value text NOT NULL)');await fixture.primary.query("INSERT INTO retention_evidence VALUES('synthetic evidence')");
  const result=await fixture.cleanup({retainSchema:true});retained=true;
  expect(result).toMatchObject({removed:false,before:fixture.before,after:fixture.before});
  const inspect=new Client({connectionString});await inspect.connect();
  try{
   const namespace=(await inspect.query('SELECT oid::text AS oid,nspowner=(SELECT oid FROM pg_roles WHERE rolname=current_user) AS owned FROM pg_namespace WHERE nspname=$1',[fixture.schema])).rows[0];
   expect(namespace).toEqual({oid,owned:true});
   expect((await inspect.query(`SELECT value FROM "${fixture.schema}".retention_evidence`)).rows).toEqual([{value:'synthetic evidence'}]);
  }finally{await inspect.end();}
 }finally{
  if(!retained)await fixture.cleanup();
  else{
   const cleanup=new Client({connectionString});await cleanup.connect();
   try{
    const ns=(await cleanup.query('SELECT oid::text AS oid,nspowner=(SELECT oid FROM pg_roles WHERE rolname=current_user) AS owned FROM pg_namespace WHERE nspname=$1',[fixture.schema])).rows[0];
    if(ns){if(!/^roster_rehearsal_[a-f0-9]{32}$/.test(fixture.schema)||!ns.owned||ns.oid!==oid)throw Error('Refusing to remove replaced or unowned test schema');await cleanup.query(`DROP SCHEMA "${fixture.schema}" CASCADE`);}
   }finally{await cleanup.end();}
  }
 }
});
