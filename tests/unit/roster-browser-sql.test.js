/** @jest-environment node */
jest.mock('@vercel/postgres',()=>({sql:Object.assign(jest.fn(),{query:jest.fn()}),db:{connect:jest.fn()}}));
jest.mock('pg',()=>({Pool:jest.fn()}));
jest.mock('../../lib/services/expertise-finder/roster-lifecycle.cjs',()=>({verifyNamespace:jest.fn()}));
const old=process.env,url='postgres://roster_rehearsal:synthetic@127.0.0.1:55439/roster_rehearsal',schema='roster_rehearsal_'+'a'.repeat(32);
beforeEach(()=>{jest.resetModules();process.env={...old,EXPERTISE_ROSTER_REHEARSAL:'on',EXPERTISE_ROSTER_BROWSER_REHEARSAL:'on',EXPERTISE_ROSTER_BROWSER_SCHEMA:schema,DYNAMICS_URL:'https://orgd9e66399.crm.dynamics.com',DYNAMICS_SANDBOX_URL:'https://orgd9e66399.crm.dynamics.com',DATAVERSE_TARGET_INTERLOCK:'on',DATAVERSE_DAL_ENFORCEMENT:'on',POSTGRES_URL:url,DATABASE_URL:url,POSTGRES_URL_NON_POOLING:url,POSTGRES_PRISMA_URL:url,AUTH_REQUIRED:'true',NODE_ENV:'production',NEXTAUTH_URL:'http://localhost:3000',NEXTAUTH_SECRET:'synthetic',AZURE_AD_CLIENT_ID:'synthetic',AZURE_AD_CLIENT_SECRET:'synthetic',AZURE_AD_TENANT_ID:'synthetic'};delete process.env.VERCEL;delete process.env.VERCEL_ENV;});
afterAll(()=>{process.env=old;});
test('namespace verification precedes first query and failure destroys client without fallback',async()=>{
 const {Pool}=require('pg'),{verifyNamespace}=require('../../lib/services/expertise-finder/roster-lifecycle.cjs'),vercel=require('@vercel/postgres');
 const client={query:jest.fn().mockResolvedValue({rows:[{n:1}]}),release:jest.fn()},pool={connect:jest.fn().mockResolvedValue(client)};Pool.mockImplementation(()=>pool);
 verifyNamespace.mockRejectedValueOnce(new Error('unowned namespace'));const {browserSql}=require('../../lib/services/expertise-finder/roster-sql.cjs');
 await expect(browserSql`SELECT ${1}`).rejects.toThrow('unowned namespace');expect(client.query).not.toHaveBeenCalled();expect(client.release).toHaveBeenCalledWith(true);expect(vercel.sql).not.toHaveBeenCalled();
 verifyNamespace.mockResolvedValueOnce('1');await browserSql`SELECT ${2}`;
 expect(verifyNamespace).toHaveBeenLastCalledWith(client,schema,{browser:true});expect(verifyNamespace.mock.invocationCallOrder[1]).toBeLessThan(client.query.mock.invocationCallOrder[0]);expect(client.query).toHaveBeenCalledWith('SELECT $1',[2]);expect(client.release).toHaveBeenLastCalledWith();
});
test('browser auth selector delegates normally even when roster-only rehearsal is enabled',async()=>{
 delete process.env.EXPERTISE_ROSTER_BROWSER_REHEARSAL;delete process.env.EXPERTISE_ROSTER_BROWSER_SCHEMA;
 const vercel=require('@vercel/postgres');const {browserSql}=require('../../lib/services/expertise-finder/roster-sql.cjs');await browserSql`SELECT ${1}`;expect(vercel.sql).toHaveBeenCalledTimes(1);expect(require('pg').Pool).not.toHaveBeenCalled();
});
