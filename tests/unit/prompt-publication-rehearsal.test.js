/** @jest-environment node */
const fs=require('node:fs'),path=require('node:path');
const {assertPreparation,main}=require('../../scripts/build-prompt-publication-rehearsal.cjs');
const cases=require('../../dataverse/prompt-publication/rehearsal/cases.json');
const registry=fs.readFileSync(path.resolve(__dirname,'../../lib/dataverse/core/target-registry.js'),'utf8');
const clone=()=>JSON.parse(JSON.stringify(cases));
test('only tracked sandbox and non-executable bindings are admitted',()=>{
 expect(()=>assertPreparation(cases,registry)).not.toThrow();
 expect(()=>assertPreparation({...cases,requiredTargetHost:'wmkf.crm.dynamics.com'},registry)).toThrow('sandbox registry');
 expect(()=>assertPreparation({...cases,targetClass:'production'},registry)).toThrow('sandbox registry');
});
test.each(['deploymentAuthorized','liveWritesAuthorized','expectedOrganizationId','customApiUniqueName','headTable','receiptTable'])('%s cannot turn preparation into a live manifest',field=>{
 const c=clone();c[field]=field.endsWith('Authorized')?true:'10000000-0000-4000-8000-000000000001';
 expect(()=>assertPreparation(c,registry)).toThrow('non-executable');
});
test('execute-like CLI options reject before any write',()=>{
 const spy=jest.spyOn(fs,'writeFileSync').mockImplementation(()=>{throw new Error('unexpected write');});
 try{expect(()=>main(['--execute'])).toThrow('no live execution mode');expect(spy).not.toHaveBeenCalled();}finally{spy.mockRestore();}
});
