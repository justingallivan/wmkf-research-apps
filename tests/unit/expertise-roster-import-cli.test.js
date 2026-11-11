/** @jest-environment node */
const {spawnSync}=require('node:child_process');
const path=require('node:path');
const cli=path.resolve(__dirname,'../../scripts/execute-expertise-roster-import.cjs');
test.each([[],['--execute'],['--execute','production'],['--execute','sandbox','--unknown','value']].map(args=>[args]))('CLI refuses incomplete/non-sandbox execution arguments %j',args=>{
 const r=spawnSync(process.execPath,[cli,...args],{encoding:'utf8'});expect(r.status).toBe(1);expect(r.stderr).toContain('Import failed');
});

// Full argument fixtures and inert I/O make these guard tests fail for the
// intended reason. No network or database connection occurs if a guard breaks.
jest.mock('../../lib/dataverse/client.js',()=>({getAccessToken:jest.fn(),createClient:jest.fn(()=>({raw:jest.fn()}))}));
jest.mock('pg',()=>({Client:jest.fn(()=>({connect:jest.fn(),end:jest.fn()}))}));
jest.mock('../../scripts/lib/expertise-roster-import-executor.cjs',()=>({executeImport:jest.fn()}));
const fs=require('node:fs'),os=require('node:os');
const {main}=require('../../scripts/execute-expertise-roster-import.cjs');
const {getAccessToken}=require('../../lib/dataverse/client.js');
const {executeImport}=require('../../scripts/lib/expertise-roster-import-executor.cjs');
const originalEnv={...process.env};
let dir,args,receipt,envFile;
beforeEach(()=>{
 jest.clearAllMocks();delete process.env.VERCEL_ENV;process.env.NODE_ENV='test';
 jest.spyOn(console,'log').mockImplementation(()=>{});
 getAccessToken.mockResolvedValue('synthetic');executeImport.mockResolvedValue({version:2,success:true,bridgeCommitted:true,rows:[]});
 dir=fs.mkdtempSync(path.join(os.tmpdir(),'roster-import-cli-'));receipt=path.join(dir,'receipt.json');envFile=path.join(dir,'env');
 const url='postgres://roster_rehearsal:synthetic@127.0.0.1:55439/roster_rehearsal';
 const env={EXPERTISE_ROSTER_REHEARSAL:'on',DYNAMICS_URL:'https://orgd9e66399.crm.dynamics.com',DYNAMICS_SANDBOX_URL:'https://orgd9e66399.crm.dynamics.com',DATAVERSE_TARGET_INTERLOCK:'on',DATAVERSE_DAL_ENFORCEMENT:'on',POSTGRES_URL:url,DATABASE_URL:url,POSTGRES_URL_NON_POOLING:url,POSTGRES_PRISMA_URL:url,DYNAMICS_TENANT_ID:'synthetic',DYNAMICS_CLIENT_ID:'synthetic',DYNAMICS_CLIENT_SECRET:'synthetic'};
 fs.writeFileSync(envFile,Object.entries(env).map(([k,v])=>`${k}=${v}`).join('\n'));
 args=[];for(const key of ['source','mapping','reviewed-plan']){const file=path.join(dir,key+'.json');fs.writeFileSync(file,'{}');args.push('--'+key,file);}
 args.push('--env',envFile,'--receipt',receipt,'--execute','sandbox');
});
afterEach(()=>{console.log.mockRestore();fs.rmSync(dir,{recursive:true,force:true});process.env={...originalEnv};});
test('six valid arguments with production execution refuse before receipt or I/O',async()=>{
 args[args.length-1]='production';
 await expect(main(args)).rejects.toThrow('Explicit sandbox execution arguments required');
 expect(fs.existsSync(receipt)).toBe(false);expect(getAccessToken).not.toHaveBeenCalled();expect(executeImport).not.toHaveBeenCalled();
});
test('otherwise valid sandbox arguments reach the mocked executor and write private receipt',async()=>{
 await expect(main(args)).resolves.toBe(0);
 expect(executeImport).toHaveBeenCalledTimes(1);expect(fs.statSync(receipt).mode&0o777).toBe(0o600);
 expect(JSON.parse(fs.readFileSync(receipt,'utf8')).bridgeCommitted).toBe(true);
});
test('existing receipt is preserved and no authentication or execution occurs',async()=>{
 fs.writeFileSync(receipt,'preserved');await expect(main(args)).rejects.toMatchObject({code:'EEXIST'});
 expect(fs.readFileSync(receipt,'utf8')).toBe('preserved');expect(getAccessToken).not.toHaveBeenCalled();
});
test('private file with production URL is refused before receipt creation',async()=>{
 fs.appendFileSync(envFile,'\nDYNAMICS_URL=https://wmkf.crm.dynamics.com\n');
 await expect(main(args)).rejects.toThrow(/registered sandbox/);expect(fs.existsSync(receipt)).toBe(false);expect(getAccessToken).not.toHaveBeenCalled();
});
