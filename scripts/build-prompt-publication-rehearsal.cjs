#!/usr/bin/env node
/** Offline rehearsal PREPARATION only. No env/auth/SDK client or tenant calls. */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const parser=require('@babel/parser');
const root=path.resolve(__dirname,'..');
const files=[
 'scripts/build-prompt-publication-package.cjs','scripts/prepare-prompt-publication-registration.cjs',
 'dataverse/prompt-publication/PackagingTool/PackagingTool.csproj','dataverse/prompt-publication/PackagingTool/packages.lock.json','dataverse/prompt-publication/PackagingTool/Program.cs','dataverse/prompt-publication/PackagingTool/SelfTests.cs','dataverse/prompt-publication/PackagingTool/StrongNames.cs',
 'dataverse/prompt-publication/Package/Package.csproj','dataverse/prompt-publication/Package/packages.lock.json','dataverse/prompt-publication/Package/README.md','dataverse/prompt-publication/registration/signing-identity.json',
 'scripts/build-prompt-publication-rehearsal.cjs','scripts/check-prompt-publication-sdk.sh','scripts/build-prompt-publication-wire-vectors.cjs','scripts/build-prompt-publication-definition-vectors.cjs',
 'dataverse/prompt-publication/global.json','dataverse/prompt-publication/NuGet.Config',
 'dataverse/prompt-publication/Transport/Transport.csproj','dataverse/prompt-publication/Transport/packages.lock.json',
 'dataverse/prompt-publication/Transport/CanonicalJson.cs','dataverse/prompt-publication/Transport/TransactionSdk.cs',
 'dataverse/prompt-publication/Transport/PinnedPolicy.cs','dataverse/prompt-publication/Transport/DefinitionRules.cs','dataverse/prompt-publication/Transport/BudgetRules.cs',
 'dataverse/prompt-publication/Transport/ProductionPublicationRules.cs','dataverse/prompt-publication/Transport/PublicationSchema.cs','dataverse/prompt-publication/Transport/SettingsWriteGuard.cs',
 'dataverse/prompt-publication/Transport/ReleaseBindings.cs','dataverse/prompt-publication/Transport/Plugins.cs',
 'dataverse/prompt-publication/registration/bindings.json','dataverse/prompt-publication/registration/manifest.json','dataverse/prompt-publication/Checks/ProductionChecks.cs',
 'dataverse/prompt-publication/Transport/PublicationWire.cs','dataverse/prompt-publication/Transport/PublisherAuthorization.cs',
 'dataverse/prompt-publication/Transport/PublicationWriteGuard.cs','dataverse/prompt-publication/Transport/PublicationPublisher.cs','dataverse/prompt-publication/Transport/PublicationSdkStore.cs',
 'dataverse/prompt-publication/Checks/PublisherChecks.cs',
 'dataverse/prompt-publication/Transport/PromptRows.cs','dataverse/prompt-publication/Transport/PromptSchemaPreflight.cs',
 'dataverse/prompt-publication/Checks/Checks.csproj','dataverse/prompt-publication/Checks/packages.lock.json','dataverse/prompt-publication/Checks/Program.cs',
 'dataverse/prompt-publication/rehearsal/cases.json','tests/fixtures/prompt-publication/fingerprints-v1.json','tests/fixtures/prompt-publication/sdk-numbers-v1.json','tests/fixtures/prompt-publication/wire-sdk-v1.json','tests/fixtures/prompt-publication/definitions-sdk-v1.json',
 'lib/dataverse/core/target-registry.js','lib/prompt-publication/policy-v1.json','lib/prompt-publication/transaction-core.js',
];
const digest=v=>crypto.createHash('sha256').update(v).digest('hex');
function assertPreparation(cases,registrySource) {
 if(cases.deploymentAuthorized!==false||cases.liveWritesAuthorized!==false||cases.expectedOrganizationId!==null||cases.customApiUniqueName!==null||cases.headTable!==null||cases.receiptTable!==null)throw new Error('Rehearsal preparation must remain non-executable; approved live bindings belong in a separately reviewed release manifest.');
 const registry=parser.parse(registrySource,{sourceType:'module'});
 const hosts=registry.program.body.flatMap(n=>n.type==='ExportNamedDeclaration'&&n.declaration?.type==='VariableDeclaration'?n.declaration.declarations:[]).find(n=>n.id.name==='SANDBOX_HOSTS')?.init;
 if(hosts?.type!=='ArrayExpression'||hosts.elements.some(n=>n?.type!=='StringLiteral')||cases.targetClass!=='sandbox-only'||!hosts.elements.some(n=>n.value===cases.requiredTargetHost))throw new Error('Rehearsal target must match the tracked sandbox registry.');
}
function assertRegistrationPreparation(manifest,bindings) {
 if(manifest.status!=='PREPARED_NOT_REGISTERED'||manifest.deploymentAuthorized!==false||manifest.liveWritesAuthorized!==false||bindings.enabled!==false||bindings.organizationId!==null||bindings.publisherExtensionId!==null||bindings.executePrivilege!==null||!Array.isArray(bindings.publisherIds)||bindings.publisherIds.length||!Array.isArray(bindings.initiatingPrincipalIds)||bindings.initiatingPrincipalIds.length)throw new Error('Registration preparation must have no live authority or bindings.');
 if(manifest.customApi.stage!==30||manifest.customApi.mode!=='Synchronous'||manifest.customApi.runAs!=='CallingUser'||manifest.customApi.allowedCustomProcessingStepType!=='None'||manifest.guard.stage!==20||manifest.guard.mode!=='Synchronous'||manifest.guard.runAs!=='CallingUser'||manifest.guard.filteringAttributes!==null)throw new Error('Registration must preserve synchronous calling-user main/guard boundaries.');
 if(manifest.guard.denyIfSupportedExceptTables?.length!==1||manifest.guard.denyIfSupportedExceptTables[0]!=='wmkf_appsystemsetting'||typeof manifest.guard.settingsAlternateCoverage!=='string')throw new Error('Settings alternate coverage must preserve unrelated writers.');
}
function main(args) {
 if(args.length>1||args[0]&&args[0]!=='--check')throw new Error('Only --check is supported; no live execution mode.');
 const policy=JSON.parse(fs.readFileSync(path.join(root,'lib/prompt-publication/policy-v1.json'),'utf8'));
 const cases=JSON.parse(fs.readFileSync(path.join(root,'dataverse/prompt-publication/rehearsal/cases.json'),'utf8'));
 assertRegistrationPreparation(JSON.parse(fs.readFileSync(path.join(root,'dataverse/prompt-publication/registration/manifest.json'),'utf8')),JSON.parse(fs.readFileSync(path.join(root,'dataverse/prompt-publication/registration/bindings.json'),'utf8')));
 assertPreparation(cases,fs.readFileSync(path.join(root,'lib/dataverse/core/target-registry.js'),'utf8'));
const sourceHashes=Object.fromEntries(files.map(file=>[file,digest(fs.readFileSync(path.join(root,file)))]));
const packet={packetVersion:1,status:'PREPARED_NOT_REHEARSED',deploymentAuthorized:false,liveWritesAuthorized:false,policyRevision:policy.policy.policyVersion,policyArtifactHash:policy.hash,sourceHashes,sourceDigest:digest(JSON.stringify(sourceHashes)),cases};
const target=path.join(root,'dataverse/prompt-publication/rehearsal/packet.json');
const text=JSON.stringify(packet,null,2)+'\n';
if(args[0]==='--check') {if(fs.readFileSync(target,'utf8')!==text)throw new Error('Rehearsal packet drift; review sources and regenerate.');console.log('Rehearsal preparation packet matches source.');}
else {fs.writeFileSync(target,text);console.log('Prepared offline rehearsal packet; no deployment or live-write authority.');}
}
module.exports={assertPreparation,assertRegistrationPreparation,main};
if(require.main===module)main(process.argv.slice(2));
