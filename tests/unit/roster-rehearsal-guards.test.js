/** @jest-environment node */
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'../..');
const run=(script,args)=>spawnSync(process.execPath,[path.join(root,'scripts',script),...args],{encoding:'utf8'});
test('rehearsal rejects effective-host overrides before connecting',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'roster-guard-'));
 try{const url='postgresql://roster_rehearsal:fake@127.0.0.1:55439/roster_rehearsal?host=remote.example';
 const f=path.join(dir,'env');fs.writeFileSync(f,['POSTGRES_URL','POSTGRES_URL_NON_POOLING','POSTGRES_PRISMA_URL','DATABASE_URL'].map(k=>`${k}=${url}`).join('\n'));
 const result=run('prepare-roster-rehearsal.cjs',[f]);expect(result.status).toBe(1);expect(result.stderr).toContain('URL options are forbidden');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('inventory requires a stable lineage and refuses Git destinations before connecting',()=>{
 const noId=run('inventory-expertise-roster.cjs',['missing','/tmp/unused']);expect(noId.status).toBe(1);expect(noId.stderr).toContain('Stable source-lineage UUID required');
 const inGit=run('inventory-expertise-roster.cjs',['missing',path.join(root,'private-export-must-not-exist'),'11111111-1111-4111-8111-111111111111']);expect(inGit.status).toBe(1);expect(inGit.stderr).toContain('outside every Git worktree');expect(fs.existsSync(path.join(root,'private-export-must-not-exist'))).toBe(false);
});
