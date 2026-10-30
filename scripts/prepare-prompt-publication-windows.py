#!/usr/bin/env python3
"""Prepare a new, local-only Windows parity bundle; excludes key/env/source secrets."""
import argparse, hashlib, json, os, pathlib, shutil, subprocess, tempfile, zipfile
root = pathlib.Path(__file__).resolve().parents[1]
p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--out', required=True, type=pathlib.Path)
p.add_argument('--package-dir', required=True, type=pathlib.Path)
p.add_argument('--bindings', type=pathlib.Path, help='Explicit reviewed disabled bindings for a bound-disabled package')
a = p.parse_args()
if not a.out.is_absolute() or a.out.exists() or not a.package_dir.is_absolute():
    p.error('Use a new absolute output directory and absolute package directory')
if a.bindings and (not a.bindings.is_absolute() or not a.bindings.is_file()): p.error('Bindings must be an absolute existing file')
sdk = root / 'dataverse/prompt-publication'
dotnet = os.environ.get('PR553_DOTNET', 'dotnet')
subprocess.run(['node', str(root/'scripts/build-prompt-publication-rehearsal.cjs'), '--check'], check=True, cwd=root)
env = dict(os.environ, DOTNET_CLI_HOME=str(pathlib.Path(tempfile.gettempdir())/'wmkf-prompt-package-cli'), NUGET_PACKAGES=os.environ.get('PR553_NUGET_CACHE',str(pathlib.Path(tempfile.gettempdir())/'wmkf-prompt-sdk-nuget')), DOTNET_CLI_TELEMETRY_OPTOUT='1', DOTNET_GENERATE_ASPNET_CERTIFICATE='false', DOTNET_NOLOGO='1')
build_temp = tempfile.TemporaryDirectory(prefix='pr553-windows-checks-')
for project, extra in [('PackagingTool/PackagingTool.csproj',[]),('Checks/Checks.csproj',['--framework','net48','--output',build_temp.name])]:
    subprocess.run([dotnet,'restore',str(sdk/project),'--locked-mode','--configfile',str(sdk/'NuGet.Config')],check=True,cwd=root,env=env)
    subprocess.run([dotnet,'build',str(sdk/project),'--no-restore','--no-incremental','--configuration','Release']+extra,check=True,cwd=root,env=env)
pkg = a.package_dir/'WMKF.PromptPublication.1.0.0.nupkg'
receipt = a.package_dir/'preparation-receipt.json'
verify_args=['verify-bound-disabled',str(root),str(pkg),str(a.bindings),str(receipt)] if a.bindings else ['verify-receipt',str(root),str(pkg),str(receipt)]
subprocess.run([dotnet,str(sdk/'PackagingTool/bin/Release/net8.0/PackagingTool.dll')]+verify_args,check=True)
if a.bindings: copy_bindings=a.bindings.read_bytes()
a.out.mkdir(parents=True)
def copy(source, relative):
    dest=a.out/relative
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, dest)
for source in pathlib.Path(build_temp.name).iterdir():
    if source.is_file() and source.suffix in ('.exe', '.dll', '.config'): copy(source, 'checks/'+source.name)
for name in ['fingerprints-v1.json','sdk-numbers-v1.json','definitions-sdk-v1.json','wire-sdk-v1.json']:
    copy(root/'tests/fixtures/prompt-publication'/name, 'tests/fixtures/prompt-publication/'+name)
copy(sdk/'registration/Run-WindowsChecks.ps1', 'Run-WindowsChecks.ps1')
copy(sdk/'registration/manifest.json', 'dataverse/prompt-publication/registration/manifest.json')
copy(pkg, pkg.name)
copy(receipt, receipt.name)
if a.bindings: (a.out/'disabled-bindings.json').write_bytes(copy_bindings)
with zipfile.ZipFile(pkg) as archive:
    for name in ['Wmkf.PromptPublication.Transport.dll','Newtonsoft.Json.dll']:
        target=a.out/'signed'/name
        target.parent.mkdir(exist_ok=True)
        target.write_bytes(archive.read('lib/net48/'+name))
copied_verify=['verify-bound-disabled',str(root),str(a.out/pkg.name),str(a.out/'disabled-bindings.json'),str(a.out/receipt.name)] if a.bindings else ['verify-receipt',str(root),str(a.out/pkg.name),str(a.out/receipt.name)]
subprocess.run([dotnet,str(sdk/'PackagingTool/bin/Release/net8.0/PackagingTool.dll')]+copied_verify,check=True)
subprocess.run([dotnet,'run','--framework','net8.0','--project',str(sdk/'Checks/Checks.csproj'),'--no-restore','--configuration','Release','--',str(a.out/'tests/fixtures/prompt-publication/fingerprints-v1.json')],check=True,cwd=root,env=env)
r=json.loads(receipt.read_text())
packet = (sdk/'rehearsal/packet.json').read_bytes()
subprocess.run(['node',str(root/'scripts/build-prompt-publication-rehearsal.cjs'),'--check'],check=True,cwd=root)
committed = subprocess.check_output(['git','show','HEAD:dataverse/prompt-publication/rehearsal/packet.json'],cwd=root)
if packet != committed: raise RuntimeError('Package source packet must match HEAD before handoff')
manifest={'status' :'OFFLINE_WINDOWS_HANDOFF_ONLY','packageSourceCommit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip(),'sourcePacketSha256':r['sourcePacketSha256'],'packageSha256':r['packageSha256'],'files':[{'path':f.relative_to(a.out).as_posix(), 'sha256':hashlib.sha256(f.read_bytes()).hexdigest()} for f in sorted(a.out.rglob('*')) if f.is_file()]}
(a.out/'handoff-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print('Prepared offline Windows folder; no private key, environment file or tenant mutation. Windows results are not yet proved.')

build_temp.cleanup()
