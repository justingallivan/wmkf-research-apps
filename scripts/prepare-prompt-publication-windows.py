#!/usr/bin/env python3
"""Prepare a new, local-only Windows parity bundle; excludes key/env/source secrets."""
import argparse, hashlib, json, os, pathlib, shutil, subprocess, tempfile, zipfile
root = pathlib.Path(__file__).resolve().parents[1]
p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--out', required=True, type=pathlib.Path)
p.add_argument('--package-dir', required=True, type=pathlib.Path)
a = p.parse_args()
if not a.out.is_absolute() or a.out.exists() or not a.package_dir.is_absolute():
    p.error('Use a new absolute output directory and absolute package directory')
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
subprocess.run([dotnet, str(sdk/'PackagingTool/bin/Release/net8.0/PackagingTool.dll'), 'verify-receipt', str(root), str(pkg), str(receipt)], check=True)
a.out.mkdir(parents=True)
def copy(source, relative):
    dest=a.out/relative
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, dest)
for source in pathlib.Path(build_temp.name).iterdir():
    if source.is_file() and source.suffix in ('.exe', '.dll', '.config'): copy(source, 'checks/'+source.name)
for name in ['fingerprints-v1.json','sdk-numbers-v1.json','definitions-sdk-v1.json','wire-sdk-v1.json']:
    copy(root/'tests/fixtures/prompt-publication'/name, 'fixtures/'+name)
copy(sdk/'registration/Run-WindowsChecks.ps1', 'Run-WindowsChecks.ps1')
copy(pkg, pkg.name)
copy(receipt, receipt.name)
with zipfile.ZipFile(pkg) as archive:
    for name in ['Wmkf.PromptPublication.Transport.dll','Newtonsoft.Json.dll']:
        target=a.out/'signed'/name
        target.parent.mkdir(exist_ok=True)
        target.write_bytes(archive.read('lib/net48/'+name))
r=json.loads(receipt.read_text())
packet = (sdk/'rehearsal/packet.json').read_bytes()
subprocess.run(['node',str(root/'scripts/build-prompt-publication-rehearsal.cjs'),'--check'],check=True,cwd=root)
committed = subprocess.check_output(['git','show','HEAD:dataverse/prompt-publication/rehearsal/packet.json'],cwd=root)
if packet != committed: raise RuntimeError('Package source packet must match HEAD before handoff')
manifest={'status' :'OFFLINE_WINDOWS_HANDOFF_ONLY','packageSourceCommit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip(),'sourcePacketSha256':r['sourcePacketSha256'],'packageSha256':r['packageSha256'],'files':[{'path':f.relative_to(a.out).as_posix(), 'sha256':hashlib.sha256(f.read_bytes()).hexdigest()} for f in sorted(a.out.rglob('*')) if f.is_file()]}
(a.out/'handoff-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print('Prepared offline Windows folder; no private key, environment file or tenant mutation. Windows results are not yet proved.')

build_temp.cleanup()
