#!/usr/bin/env node
/** Build/inspect a disabled signed preparation artifact. No deployment/login mode. */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),sdk=path.join(root,'dataverse/prompt-publication');
function main(args){
 if(![4,6].includes(args.length)||args[0]!=='--key'||args[2]!=='--out'||args.length===6&&args[4]!=='--bindings')throw new Error('Use --key ABSOLUTE_PRIVATE_SNK --out NEW_ABSOLUTE_DIRECTORY [--bindings ABSOLUTE_DISABLED_BINDINGS]; no deployment mode.');
 const key=args[1],out=args[3];let bindings=args[5]||null;if(bindings&&!path.isAbsolute(bindings))throw new Error('Absolute disabled bindings file required.');if(!path.isAbsolute(key)||!path.isAbsolute(out)||fs.existsSync(out))throw new Error('Absolute key and new output directory required.');
 const stat=fs.lstatSync(key);if(!stat.isFile()||stat.isSymbolicLink()||process.platform!=='win32'&&(stat.mode&0o077))throw new Error('Signing key must be a private regular file.');
 const dotnet=process.env.PR553_DOTNET||'dotnet';
 const env={...process.env,DOTNET_CLI_HOME:path.join(process.env.TMPDIR||'/tmp','wmkf-prompt-package-cli'),NUGET_PACKAGES:process.env.PR553_NUGET_CACHE||path.join(process.env.TMPDIR||'/tmp','wmkf-prompt-sdk-nuget'),DOTNET_CLI_TELEMETRY_OPTOUT:'1',DOTNET_GENERATE_ASPNET_CERTIFICATE:'false',DOTNET_NOLOGO:'1'};
 const run=(cmd,argv,options={})=>execFileSync(cmd,argv,{cwd:root,env,stdio:'inherit',...options});
 run(process.execPath,[path.join(root,'scripts/build-prompt-publication-rehearsal.cjs'),'--check']);
 for(const project of ['Transport/Transport.csproj','PackagingTool/PackagingTool.csproj','Package/Package.csproj'])run(dotnet,['restore',path.join(sdk,project),'--locked-mode','--configfile',path.join(sdk,'NuGet.Config')]);
 run(dotnet,['build',path.join(sdk,'PackagingTool/PackagingTool.csproj'),'--no-restore','--configuration','Release','--no-incremental']);
 if(bindings)run(dotnet,[path.join(sdk,'PackagingTool/bin/Release/net8.0/PackagingTool.dll'),'validate-bound-disabled',bindings]);
 fs.mkdirSync(out,{recursive:true});if(bindings){const copy=path.join(out,'disabled-bindings.json');fs.copyFileSync(bindings,copy,fs.constants.COPYFILE_EXCL);bindings=copy;}const build=path.join(out,'build');
 run(dotnet,['build',path.join(sdk,'Transport/Transport.csproj'),'--no-restore','--configuration','Release','--framework','net48','--no-incremental','--output',build,'-p:PR553SourcePacketHash='+crypto.createHash('sha256').update(fs.readFileSync(path.join(sdk,'rehearsal/packet.json'))).digest('hex'),'-p:PR553SigningKeyFile='+key,'-p:DebugType=None','-p:PathMap='+root+'=/src',...(bindings?['-p:PR553BindingsFile='+bindings]:[])]);
 run(dotnet,['pack',path.join(sdk,'Package/Package.csproj'),'--no-restore','--configuration','Release','--output',out,'-p:PR553PackageInput='+build]);
 const tool=path.join(sdk,'PackagingTool/bin/Release/net8.0/PackagingTool.dll'),nupkg=path.join(out,'WMKF.PromptPublication.1.0.0.nupkg');
 run(process.execPath,[path.join(root,'scripts/build-prompt-publication-rehearsal.cjs'),'--check']);
 const receipt=run(dotnet,bindings?[tool,'inspect-bound-disabled',root,nupkg,bindings]:[tool,'inspect',root,nupkg],{stdio:['ignore','pipe','inherit']});fs.writeFileSync(path.join(out,'preparation-receipt.json'),receipt,{flag:'wx'});
 run(dotnet,bindings?[tool,'verify-bound-disabled',root,nupkg,bindings,path.join(out,'preparation-receipt.json')]:[tool,'verify-receipt',root,nupkg,path.join(out,'preparation-receipt.json')]);
 console.log('Signed preparation package built. Bindings disabled; no registration or tenant changes.');
}
module.exports={main};if(require.main===module)main(process.argv.slice(2));
