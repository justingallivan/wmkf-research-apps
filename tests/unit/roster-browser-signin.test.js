/** @jest-environment node */
jest.mock('@vercel/postgres',()=>({sql:jest.fn()}));
jest.mock('../../lib/services/expertise-finder/roster-sql.cjs',()=>({browserSql:jest.fn()}));
jest.mock('../../lib/services/app-access-service',()=>({grantApps:jest.fn()}));
jest.mock('../../lib/services/notification-service',()=>({notifyNewUser:jest.fn()}));
jest.mock('../../lib/services/dynamics-identity-service',()=>({reconcileProfile:jest.fn()}));
jest.mock('next-auth',()=>jest.fn(()=>({})));
jest.mock('next-auth/providers/azure-ad',()=>jest.fn(()=>({})));
const {browserSql}=require('../../lib/services/expertise-finder/roster-sql.cjs');
const {grantApps}=require('../../lib/services/app-access-service');
const {notifyNewUser}=require('../../lib/services/notification-service');
const {reconcileProfile}=require('../../lib/services/dynamics-identity-service');
const {authOptions}=require('../../pages/api/auth/[...nextauth].js');
const original=process.env,oid='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const url='postgres://roster_rehearsal:synthetic@127.0.0.1:55439/roster_rehearsal';
const identity={user:{id:oid,email:'synthetic@example.invalid'},account:{provider:'azure-ad'},profile:{oid}};
beforeEach(()=>{jest.clearAllMocks();process.env={...original,EXPERTISE_ROSTER_REHEARSAL:'on',EXPERTISE_ROSTER_BROWSER_REHEARSAL:'on',EXPERTISE_ROSTER_BROWSER_SCHEMA:'roster_rehearsal_'+'a'.repeat(32),DYNAMICS_URL:'https://orgd9e66399.crm.dynamics.com',DYNAMICS_SANDBOX_URL:'https://orgd9e66399.crm.dynamics.com',DATAVERSE_TARGET_INTERLOCK:'on',DATAVERSE_DAL_ENFORCEMENT:'on',POSTGRES_URL:url,DATABASE_URL:url,POSTGRES_URL_NON_POOLING:url,POSTGRES_PRISMA_URL:url,AUTH_REQUIRED:'true',NODE_ENV:'production',NEXTAUTH_URL:'http://localhost:3000',NEXTAUTH_SECRET:'synthetic-test-secret-with-sufficient-length',AZURE_AD_CLIENT_ID:'synthetic',AZURE_AD_CLIENT_SECRET:'synthetic',AZURE_AD_TENANT_ID:'synthetic'};delete process.env.VERCEL;delete process.env.VERCEL_ENV;});
afterAll(()=>{process.env=original;});
test.each([['unknown',[]],['disabled',[{id:9,is_active:false,needs_linking:false,azure_email:identity.user.email}]],['unlinked',[{id:9,is_active:true,needs_linking:true,azure_email:identity.user.email}]],['duplicate',[{id:9,is_active:true,needs_linking:false,azure_email:identity.user.email},{id:10,is_active:true,needs_linking:false,azure_email:identity.user.email}]]])('%s identity cannot provision or grant access',async(_label,rows)=>{
 browserSql.mockResolvedValueOnce({rows});expect(await authOptions.callbacks.signIn(identity)).toBe(false);
 expect(browserSql).toHaveBeenCalledTimes(1);expect(grantApps).not.toHaveBeenCalled();expect(notifyNewUser).not.toHaveBeenCalled();expect(reconcileProfile).not.toHaveBeenCalled();
});
test('one active linked identity is admitted',async()=>{
 browserSql.mockResolvedValueOnce({rows:[{id:9,is_active:true,needs_linking:false,azure_email:identity.user.email}]}).mockResolvedValueOnce({rows:[{id:9}]});
 expect(await authOptions.callbacks.signIn(identity)).toBe(true);expect(grantApps).not.toHaveBeenCalled();expect(notifyNewUser).not.toHaveBeenCalled();expect(reconcileProfile).not.toHaveBeenCalled();
});
