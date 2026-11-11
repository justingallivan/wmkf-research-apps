/** @jest-environment node */
const fs=require('node:fs');
const {parse}=require('dotenv');
const {createRosterPgFixture}=require('../helpers/roster-pg-fixture.cjs');
const {seed}=require('../../scripts/run-roster-browser-venue.cjs');
jest.setTimeout(30000);
const envFile=process.env.ROSTER_LIVE_SQL_TEST_ENV;
const live=envFile?test:test.skip;
live('browser SQL verifies owned local relations before every query and never falls back',async()=>{
 const fixture=await createRosterPgFixture(envFile),original=process.env;
 try{
  const env=parse(fs.readFileSync(envFile));process.env={...env,NODE_ENV:'production',AUTH_REQUIRED:'true',NEXTAUTH_URL:'http://localhost:3000',NEXTAUTH_SECRET:'synthetic-secret',AZURE_AD_CLIENT_ID:'synthetic',AZURE_AD_CLIENT_SECRET:'synthetic',AZURE_AD_TENANT_ID:'synthetic',EXPERTISE_ROSTER_BROWSER_REHEARSAL:'on',EXPERTISE_ROSTER_BROWSER_SCHEMA:fixture.schema};
  await seed(fixture,{azureactivedirectoryobjectid:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',internalemailaddress:'synthetic@example.invalid',systemuserid:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'});
  expect((await fixture.primary.query('SELECT count(*)::int AS n FROM expertise_matches')).rows[0].n).toBe(2);
  expect((await fixture.primary.query('SELECT count(*)::int AS n FROM dynamics_user_roles')).rows[0].n).toBe(0);
  jest.resetModules();const {sql,browserSql,db}=require('../../lib/services/expertise-finder/roster-sql.cjs');
  expect((await browserSql`SELECT current_schema() AS name`).rows[0].name).toBe(fixture.schema);
  expect((await sql`SELECT current_schema() AS name`).rows[0].name).toBe(fixture.schema);
  const transaction=await db.connect();
  try{await transaction.query('BEGIN');await transaction.query("INSERT INTO expertise_matches(user_profile_id,proposal_title) VALUES(900001,'Rollback transaction')");await transaction.query('ROLLBACK');}
  finally{transaction.release();}
  expect((await fixture.primary.query("SELECT count(*)::int AS n FROM expertise_matches WHERE proposal_title='Rollback transaction'")).rows[0].n).toBe(0);
  await fixture.primary.query('DROP TABLE dynamics_user_roles');
  await expect(browserSql`SELECT 1`).rejects.toMatchObject({status:503});
  await expect(db.connect()).rejects.toMatchObject({status:503});
 }finally{process.env=original;await fixture.cleanup();}
});
