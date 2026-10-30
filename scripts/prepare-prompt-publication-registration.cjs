#!/usr/bin/env node
/** Signed artifact -> reviewable sandbox bootstrap plan, never executes it. */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),sdk=path.join(root,'dataverse/prompt-publication');
function main(args){
 if(args.length!==2||args[0]!=='--package-dir'||!path.isAbsolute(args[1]))throw new Error('Use --package-dir ABSOLUTE_DIRECTORY; no execute mode.');
 const dir=args[1],receiptFile=path.join(dir,'preparation-receipt.json'),receipt=JSON.parse(fs.readFileSync(receiptFile,'utf8'));
 const manifest=require('../dataverse/prompt-publication/registration/manifest.json'),bindings=require('../dataverse/prompt-publication/registration/bindings.json');
 require('./build-prompt-publication-rehearsal.cjs').assertRegistrationPreparation(manifest,bindings);
 const cases=require('../dataverse/prompt-publication/rehearsal/cases.json');require('./build-prompt-publication-rehearsal.cjs').assertPreparation(cases,fs.readFileSync(path.join(root,'lib/dataverse/core/target-registry.js'),'utf8'));
 const dotnet=process.env.PR553_DOTNET||'dotnet',toolProject=path.join(sdk,'PackagingTool/PackagingTool.csproj');
 const env={...process.env,DOTNET_CLI_HOME:path.join(process.env.TMPDIR||'/tmp','wmkf-prompt-package-cli'),NUGET_PACKAGES:process.env.PR553_NUGET_CACHE||path.join(process.env.TMPDIR||'/tmp','wmkf-prompt-sdk-nuget'),DOTNET_CLI_TELEMETRY_OPTOUT:'1',DOTNET_GENERATE_ASPNET_CERTIFICATE:'false',DOTNET_NOLOGO:'1'};
 execFileSync(dotnet,['restore',toolProject,'--locked-mode','--configfile',path.join(sdk,'NuGet.Config')],{cwd:root,env,stdio:'inherit'});
 execFileSync(dotnet,['build',toolProject,'--no-restore','--no-incremental','--configuration','Release'],{cwd:root,env,stdio:'inherit'});
 const pkg=path.join(dir,'WMKF.PromptPublication.1.0.0.nupkg');execFileSync(dotnet,[path.join(sdk,'PackagingTool/bin/Release/net8.0/PackagingTool.dll'),'verify-receipt',root,pkg,receiptFile],{stdio:'inherit'});
 const plan={preparationVersion:1,status:'SIGNED_SANDBOX_PREPARATION_ONLY',deploymentAuthorized:false,liveWritesAuthorized:false,target:{host:cases.requiredTargetHost,organizationId:null,independentWhoAmIMatchRequired:true},package:{id:receipt.packageId,version:receipt.packageVersion,sha256:receipt.packageSha256,publicKeyToken:receipt.publicKeyToken,nugetCertificateSignature:receipt.nugetCertificateSignature},receiptSha256:crypto.createHash('sha256').update(fs.readFileSync(receiptFile)).digest('hex'),sourcePacketSha256:receipt.sourcePacketSha256,operator:'Connor',unresolved:{solutionUniqueName:null,publisherPrefix:null,registeredPackageName:null,organizationId:null,pluginPackageId:null,publisherPluginTypeId:null,guardPluginTypeId:null,publisherOwningExtensionId:null,executePrivilege:null,publisherIds:[],initiatingPrincipalIds:[]},phases:[
 {id:'read-only-preflight',mutations:false,approved:false,prove:['explicit sandbox connection and independent organization identity','operator privileges/tool versions and actual net48 dependent-package support before registration','solution unique name, publisher prefix and resulting registered package name','actual metadata and existing writer inventory']},
 {id:'additive-schema-before-api',mutations:true,approved:false,prove:['review and provision additive schema/Active keys without guards','resolve actual receipt Create privilege from published metadata before API registration']},
 {id:'disabled-bootstrap',mutations:true,approved:false,install:['signed dependent-assembly package','disabled Custom API publisher only'],installGuards:false,prove:['content-free PR553_BOOTSTRAP_CONTEXT on unbound denial; actual OwningExtension and transaction context, never infer GUID/type','package/assembly identity stable across update']},
 {id:'bound-disabled-rebuild',mutations:false,approved:false,prove:['review populated bindings with enabled=false','retain SAME signing key/package ID/package version/assembly identity','use bound-disabled inspection with separately reviewed observed bindings; enabled=true remains rejected']},
 {id:'roles-seed-and-writer-freeze',mutations:true,approved:false,prove:['separately approve additive schema/keys/roles and exact seed records','seed groups and budget control BEFORE guards; no synthesized values','freeze existing prompt/seed/budget/catalog writers']},
 {id:'guards-and-proof',mutations:true,approved:false,prove:['calling-user synchronous guards with complete preimages','merged bulk coverage with no double execution','settings alternate paths protected without blocking unrelated settings','original target RowVersion, immutable history, rollback and same-value CAS advance']},
 {id:'enable-and-rehearse',mutations:true,approved:false,prove:['separate enablement approval and reviewed enabled package','actual Windows Framework parity','same UUID recovery and receipt/current readback','two-client and Pre-Site coordinated cutover gates']}
 ]};
 fs.writeFileSync(path.join(dir,'sandbox-registration-preparation.json'),JSON.stringify(plan,null,2)+'\n',{flag:'wx'});console.log('Prepared sandbox registration review plan; every mutation phase remains unapproved.');
}
module.exports={main};if(require.main===module)main(process.argv.slice(2));
