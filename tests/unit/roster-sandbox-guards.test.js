/** @jest-environment node */
const fs=require('fs'),path=require('path'),os=require('os'),{spawnSync}=require('child_process');
const root=path.resolve(__dirname,'../..');
test('sandbox schema wrapper rejects arbitrary target flags before credential access',()=>{
 const r=spawnSync(process.execPath,[path.join(root,'scripts/apply-roster-sandbox-schema.cjs'),'missing','--target=prod'],{encoding:'utf8'});
 expect(r.status).toBe(1);expect(r.stderr).toContain('--dry-run|--execute required');
});
test.each(['rehearse-roster-sandbox.cjs','rehearse-roster-bridge.cjs'])('%s rejects host overrides before any connection',script=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'roster-sandbox-guard-'));
 try{const file=path.join(dir,'local.env');const url='postgresql://roster_rehearsal:fake@127.0.0.1:55439/roster_rehearsal?host=remote.invalid';fs.writeFileSync(file,['POSTGRES_URL','DATABASE_URL','POSTGRES_URL_NON_POOLING','POSTGRES_PRISMA_URL'].map(k=>`${k}=${url}`).join('\n'));
 const args=script.includes('bridge')?[file]:['missing-credentials',file,path.join(dir,'receipt.json'),'--execute'];
 const r=spawnSync(process.execPath,[path.join(root,'scripts',script),...args],{encoding:'utf8'});expect(r.status).toBe(1);expect(r.stderr).not.toContain('ENOENT');expect(fs.existsSync(path.join(dir,'receipt.json'))).toBe(false);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
