#!/usr/bin/env python3
"""Local generated-media byte-cap experiments. No real inputs/network.
Produces ~2GB valid MP4, intentionally larger output. Requires >=8GB free scratch.
Limits here are experimental acceptance/OS controls, not deployed application policy.
"""
import hashlib
import json
import re
import resource
import shutil
import subprocess
import tempfile
import time
from pathlib import Path

ROOT=Path(tempfile.mkdtemp(prefix='wmkf-stage4-capacity-'))
CAP=2_000_000_000
RUNS=[]

def owned_bytes():return sum(p.stat().st_size for p in ROOT.rglob('*') if p.is_file())

def run(args,label,file_limit=None):
    cmd=['/usr/bin/time','-l','ffmpeg','-hide_banner','-nostdin','-y','-loglevel','error',*map(str,args)]
    def restrict():resource.setrlimit(resource.RLIMIT_FSIZE,(file_limit,file_limit))
    start=time.monotonic();peak=owned_bytes()
    with (ROOT/(label+'.log')).open('w') as log:
        p=subprocess.Popen(cmd,stdout=log,stderr=subprocess.STDOUT,preexec_fn=restrict if file_limit else None)
        while p.poll() is None:
            peak=max(peak,owned_bytes());time.sleep(.05)
    elapsed=time.monotonic()-start;peak=max(peak,owned_bytes())
    logtext=(ROOT/(label+'.log')).read_text();m=re.search(r'(\d+)\s+maximum resident set size',logtext)
    rec={'label':label,'exit':p.returncode,'seconds':elapsed,'peak_sampled_owned_bytes':peak,
         'maximum_resident_set_bytes':int(m.group(1)) if m else None,'file_limit':file_limit,
         'argv':[s.replace(str(ROOT),'$SCRATCH') for s in cmd]}
    RUNS.append(rec)
    print('FINISHED',label,rec['exit'],round(elapsed,2),flush=True)
    return rec

def probe(p):return json.loads(subprocess.check_output(['ffprobe','-v','error','-show_format','-show_streams','-of','json',str(p)]))
def sha(p):
    h=hashlib.sha256()
    with p.open('rb') as f:
        for chunk in iter(lambda:f.read(8*1048576),b''):h.update(chunk)
    return h.hexdigest()

def admission(size,free,required):
    if size>CAP:return 'reject_input_cap'
    if free<required:return 'reject_insufficient_scratch'
    return 'admit'

def output_args(src,out):
    return ['-i',src,'-t','3600','-map','0:v:0','-map','0:a:0','-c:v','libx264','-threads','2','-preset','ultrafast',
        '-b:v','4800k','-minrate','4800k','-maxrate','4800k','-bufsize','9600k','-x264-params','nal-hrd=cbr:force-cfr=1',
        '-c:a','aac','-b:a','64k','-movflags','+faststart',out]

def acceptable(path,exit_code,expected=3600):
    if exit_code!=0:return {'accepted':False,'reason':'encoder_failed'}
    size=path.stat().st_size
    if size>CAP:return {'accepted':False,'reason':'output_cap_exceeded','bytes':size}
    duration=float(probe(path)['format']['duration'])
    return {'accepted':abs(duration-expected)<=.05,'reason':'duration_complete' if abs(duration-expected)<=.05 else 'truncated_duration',
            'bytes':size,'duration':duration}

def main():
    free=shutil.disk_usage(ROOT).free
    assert free>=8_000_000_000,'Need 8GB free to avoid pressuring host storage'
    result={'scope':'Local synthetic capacity only; no published artifacts','free_bytes_before':free,'input_and_experimental_output_cap':CAP}
    try:
        seed=ROOT/'seed.mp4'
        rec=run(['-f','lavfi','-i','testsrc2=s=320x180:r=25:d=60','-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=60',
             '-c:v','libx264','-threads','2','-preset','ultrafast','-b:v','3000k','-minrate','3000k','-maxrate','3000k','-bufsize','6000k',
             '-x264-params','nal-hrd=cbr:force-cfr=1','-c:a','aac','-b:a','64k','-movflags','+faststart',seed],'seed')
        assert rec['exit']==0
        source=ROOT/'near-cap-85min.mp4'
        rec=run(['-stream_loop','84','-i',seed,'-t','5100','-c','copy','-movflags','+faststart',source],'near-cap-source')
        assert rec['exit']==0
        size=source.stat().st_size
        assert 1_900_000_000<=size<CAP,(size,'fixture must be a physically written near-cap MP4')
        result['source']={'bytes':size,'sha256':sha(source),'probe':probe(source),'allocated_bytes':source.stat().st_blocks*512}
        assert admission(size,free,6_000_000_000)=='admit'
        full=ROOT/'oversized-presentation.mp4'
        rec=run(output_args(source,full),'full-output')
        assert rec['exit']==0 and full.stat().st_size>size and full.stat().st_size>CAP
        result['full_output']={'bytes':full.stat().st_size,'sha256':sha(full),'probe':probe(full),'decision':acceptable(full,rec['exit'])}
        assert not result['full_output']['decision']['accepted']
        decoded=run(['-i',full,'-map','0:v:0','-map','0:a:0','-f','null','-'],'full-output-decode')
        assert decoded['exit']==0
        # The actual oversized output is also a real >2GB input-admission negative case.
        result['oversized_input_decision']=admission(full.stat().st_size,free,6_000_000_000)
        assert result['oversized_input_decision']=='reject_input_cap'
        full.unlink();result['full_output']['exact_file_cleanup_verified']=not full.exists()
        # FFmpeg can return success when -fs has intentionally truncated its output.
        limited=ROOT/'fs-limited.mp4';args=output_args(source,limited);args[-1:-1]=['-fs','64000000']
        rec=run(args,'ffmpeg-fs-limit')
        result['fs_limit']={'exit':rec['exit'],'decision':acceptable(limited,rec['exit'])}
        assert rec['exit']==0 and not result['fs_limit']['decision']['accepted']
        limited.unlink();result['fs_limit']['exact_file_cleanup_verified']=not limited.exists()
        # A real OS per-file limit, without filling the user's volume.
        hard=ROOT/'os-limit.mp4';rec=run(output_args(source,hard),'os-file-limit',file_limit=32*1048576)
        result['os_limit']={'exit':rec['exit'],'bytes':hard.stat().st_size if hard.exists() else 0,'decision':acceptable(hard,rec['exit'])}
        assert rec['exit']!=0 and not result['os_limit']['decision']['accepted']
        if hard.exists():hard.unlink()
        result['os_limit']['exact_file_cleanup_verified']=not hard.exists()
        result['preflight_controls']={'exact_cap':admission(CAP,free,6_000_000_000),
            'cap_plus_one':admission(CAP+1,free,6_000_000_000),
            'mock_insufficient_scratch':admission(size,100,6_000_000_000)}
        assert result['preflight_controls']=={'exact_cap':'admit','cap_plus_one':'reject_input_cap','mock_insufficient_scratch':'reject_insufficient_scratch'}
        result['bounded_capacity_tests_passed']=True
        result['stage_a_status']='NOT PASSED: complete matrix outstanding'
    finally:
        result['runs']=RUNS;result['scratch_bytes_remaining']=owned_bytes()
        result['limits']=['320x180 CBR filler stresses bytes, not representative 1080p encoding quality or memory',
            'Disk peak sampled every50ms, not exact instantaneous peak; macOS time reports RSS bytes',
            'OS per-file quota is real; insufficient-volume-space branch mocked; actual ENOSPC not induced',
            'Output 2GB cap is experimental, not an owner-approved production output cap',
            'No cloud quota, transfer, retries, Board publication or production cleanup exercised']
        (ROOT/'capacity-results.json').write_text(json.dumps(result,indent=2).replace(str(ROOT),'$SCRATCH'))
        print('RESULT',ROOT/'capacity-results.json',flush=True)

if __name__=='__main__':print('SCRATCH',ROOT,flush=True);main()
