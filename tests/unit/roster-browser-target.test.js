/** @jest-environment node */
const {browserRequested,assertBrowserTarget}=require('../../lib/services/expertise-finder/roster-rehearsal-target.cjs');
const url='postgres://roster_rehearsal:synthetic@127.0.0.1:55439/roster_rehearsal';
const schema='roster_rehearsal_'+'a'.repeat(32);
function env(){return {EXPERTISE_ROSTER_REHEARSAL:'on',EXPERTISE_ROSTER_BROWSER_REHEARSAL:'on',EXPERTISE_ROSTER_BROWSER_SCHEMA:schema,DYNAMICS_URL:'https://orgd9e66399.crm.dynamics.com',DYNAMICS_SANDBOX_URL:'https://orgd9e66399.crm.dynamics.com',DATAVERSE_TARGET_INTERLOCK:'on',DATAVERSE_DAL_ENFORCEMENT:'on',POSTGRES_URL:url,DATABASE_URL:url,POSTGRES_URL_NON_POOLING:url,POSTGRES_PRISMA_URL:url,AUTH_REQUIRED:'true',NODE_ENV:'production',NEXTAUTH_URL:'http://localhost:3000',NEXTAUTH_SECRET:'synthetic-test-secret-with-sufficient-length',AZURE_AD_CLIENT_ID:'synthetic',AZURE_AD_CLIENT_SECRET:'synthetic',AZURE_AD_TENANT_ID:'synthetic'};}
test('complete local browser configuration resolves the exact generated schema',()=>{expect(browserRequested(env())).toBe(true);expect(assertBrowserTarget(env())).toMatchObject({schema,host:'orgd9e66399.crm.dynamics.com',connectionString:url});});
test.each([
 ['missing marker',e=>delete e.EXPERTISE_ROSTER_BROWSER_REHEARSAL],['missing schema',e=>delete e.EXPERTISE_ROSTER_BROWSER_SCHEMA],
 ['malformed marker',e=>{e.EXPERTISE_ROSTER_BROWSER_REHEARSAL='true';}],['public schema',e=>{e.EXPERTISE_ROSTER_BROWSER_SCHEMA='public';}],
 ['hosted marker',e=>{e.VERCEL='1';}],['hosted environment',e=>{e.VERCEL_ENV='preview';}],
 ['auth disabled',e=>{e.AUTH_REQUIRED='false';}],['auth bypass',e=>{e.EMERGENCY_AUTH_BYPASS='true';}],
 ['foreign database alias',e=>{e.DATABASE_URL='postgres://remote.invalid/db';}],
])('%s refuses browser admission',(_name,mutate)=>{const e=env();mutate(e);expect(browserRequested(e)).toBe(true);expect(()=>assertBrowserTarget(e)).toThrow();});
test('absent browser settings leave the mode unrequested',()=>{const e=env();delete e.EXPERTISE_ROSTER_BROWSER_REHEARSAL;delete e.EXPERTISE_ROSTER_BROWSER_SCHEMA;expect(browserRequested(e)).toBe(false);});
