/** @jest-environment node */
const {spawnSync}=require('node:child_process');
const path=require('node:path');
const cli=path.resolve(__dirname,'../../scripts/execute-expertise-roster-import.cjs');
test.each([[],['--execute'],['--execute','production'],['--execute','sandbox','--unknown','value']].map(args=>[args]))('CLI refuses incomplete/non-sandbox execution arguments %j',args=>{
 const r=spawnSync(process.execPath,[cli,...args],{encoding:'utf8'});expect(r.status).toBe(1);expect(r.stderr).toContain('Import failed');
});
