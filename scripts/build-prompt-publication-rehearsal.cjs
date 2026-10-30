#!/usr/bin/env node
/** Offline rehearsal PREPARATION only. No env/auth/SDK client or tenant calls. */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const parser=require('@babel/parser');
const root=path.resolve(__dirname,'..');
const files=[
 'scripts/build-prompt-publication-rehearsal.cjs','scripts/check-prompt-publication-sdk.sh',
 'dataverse/prompt-publication/global.json','dataverse/prompt-publication/NuGet.Config',
 'dataverse/prompt-publication/Transport/Transport.csproj','dataverse/prompt-publication/Transport/packages.lock.json',
 'dataverse/prompt-publication/Transport/CanonicalJson.cs','dataverse/prompt-publication/Transport/TransactionSdk.cs',
 'dataverse/prompt-publication/Transport/PromptRows.cs','dataverse/prompt-publication/Transport/PromptSchemaPreflight.cs',
 'dataverse/prompt-publication/Checks/Checks.csproj','dataverse/prompt-publication/Checks/packages.lock.json','dataverse/prompt-publication/Checks/Program.cs',
 'dataverse/prompt-publication/rehearsal/cases.json','tests/fixtures/prompt-publication/fingerprints-v1.json','tests/fixtures/prompt-publication/sdk-numbers-v1.json',
 'lib/dataverse/core/target-registry.js','lib/prompt-publication/policy-v1.json','lib/prompt-publication/transaction-core.js',
];
const digest=v=>crypto.createHash('sha256').update(v).digest('hex');
function assertPreparation(cases,registrySource) {
 if(cases.deploymentAuthorized!==false||cases.liveWritesAuthorized!==false||cases.expectedOrganizationId!==null||cases.customApiUniqueName!==null||cases.headTable!==null||cases.receiptTable!==null)throw new Error('Rehearsal preparation must remain non-executable; approved live bindings belong in a separately reviewed release manifest.');
 const registry=parser.parse(registrySource,{sourceType:'module'});
 const hosts=registry.program.body.flatMap(n=>n.type==='ExportNamedDeclaration'&&n.declaration?.type==='VariableDeclaration'?n.declaration.declarations:[]).find(n=>n.id.name==='SANDBOX_HOSTS')?.init;
 if(hosts?.type!=='ArrayExpression'||hosts.elements.some(n=>n?.type!=='StringLiteral')||cases.targetClass!=='sandbox-only'||!hosts.elements.some(n=>n.value===cases.requiredTargetHost))throw new Error('Rehearsal target must match the tracked sandbox registry.');
}
function main(args) {
 if(args.length>1||args[0]&&args[0]!=='--check')throw new Error('Only --check is supported; no live execution mode.');
 const policy=JSON.parse(fs.readFileSync(path.join(root,'lib/prompt-publication/policy-v1.json'),'utf8'));
 const cases=JSON.parse(fs.readFileSync(path.join(root,'dataverse/prompt-publication/rehearsal/cases.json'),'utf8'));
 assertPreparation(cases,fs.readFileSync(path.join(root,'lib/dataverse/core/target-registry.js'),'utf8'));
const sourceHashes=Object.fromEntries(files.map(file=>[file,digest(fs.readFileSync(path.join(root,file)))]));
const packet={packetVersion:1,status:'PREPARED_NOT_REHEARSED',deploymentAuthorized:false,liveWritesAuthorized:false,policyRevision:policy.policy.policyVersion,policyArtifactHash:policy.hash,sourceHashes,sourceDigest:digest(JSON.stringify(sourceHashes)),cases};
const target=path.join(root,'dataverse/prompt-publication/rehearsal/packet.json');
const text=JSON.stringify(packet,null,2)+'\n';
if(args[0]==='--check') {if(fs.readFileSync(target,'utf8')!==text)throw new Error('Rehearsal packet drift; review sources and regenerate.');console.log('Rehearsal preparation packet matches source.');}
else {fs.writeFileSync(target,text);console.log('Prepared offline rehearsal packet; no deployment or live-write authority.');}
}
module.exports={assertPreparation,main};
if(require.main===module)main(process.argv.slice(2));
