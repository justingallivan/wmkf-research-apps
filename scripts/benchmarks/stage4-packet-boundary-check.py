#!/usr/bin/env python3
"""Hash-bound generated-media packet-boundary experiment; no cloud or real inputs.
Usage: bundled-python stage4-packet-boundary-check.py generated-integration-scratch
Existing strict acceptance remains unchanged. No Stage A pass is emitted.
"""
import sys
sys.dont_write_bytecode=True
import importlib.util,json,subprocess
from pathlib import Path
import numpy as np
HERE=Path(__file__).parent

def load(name,file):
    spec=importlib.util.spec_from_file_location(name,HERE/file)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
p=load('padding','stage4-padding-check.py');b=p.b
native=load('native','stage4-native-check.py')
ROOT=p.ROOT

def anchors(ref,candidate):
    records=[]
    for ch in range(2):
        for t in (1.5,45,91.5):
            at=round(t*b.SR);n=4096;r=600
            a=ref[at:at+n,ch].astype(float);a-=a.mean()
            v=candidate[at-r:at+n+r,ch].astype(float)
            dot=np.correlate(v,a,'valid');s=np.convolve(v,np.ones(n),'valid')
            energy=np.convolve(v*v,np.ones(n),'valid')-s*s/n
            corr=dot/np.sqrt(np.maximum(energy,1e-20)*sum(a*a));peak=int(np.argmax(corr))
            records.append(dict(channel=ch,seconds=t,lag_samples=peak-r,correlation=float(corr[peak])))
    return records

def sync_pass(a):return all(abs(x['lag_samples'])<=1 and x['correlation']>.85 for x in a)

def main():
    old=Path(sys.argv[1]).resolve()
    authority=json.loads((HERE.parent.parent/'docs/plans/STAGE4_LOCAL_MATRIX_EVIDENCE_2026-10-09.json').read_text())
    # Committed hashes, not an arbitrary caller-supplied receipt, bind all media.
    integrated=authority['integration']
    result={'scope':'Local hash-bound synthetic packet-boundary diagnostic','stage_a_status':'NOT PASSED','cases':[],'controls':[], 'scratch':str(ROOT)}
    binaries={}
    for key,source in [('reader','stage4-native-decode.swift'),('audiofile','stage4-audiofile-decode.swift')]:
        binary=ROOT/key
        subprocess.run(['swiftc','-parse-as-library',str(HERE/source),'-o',str(binary)],check=True,capture_output=True)
        binaries[key]=binary
    for name in ('offset','drift'):
        case=next(c for c in integrated['cases'] if c['case']==name)
        original=old/(name+'-presentation.mp4');raw=old/(name+'-safe.f32');src=old/'integrated-source.mp4'
        assert b.digest(original)==case['checks']['normal']['sha256']
        assert b.digest(raw)==case['safe_pcm_hash']
        assert b.digest(src)==case['source_hash']
        truth=np.fromfile(raw,dtype='<f4').reshape(-1,2);n=len(truth)//1024*1024;end=n/b.SR
        isolated=ROOT/(name+'-aligned.f32');truth[:n].tofile(isolated)
        safe=ROOT/(name+'-reference.m4a');p.encode_audio(isolated,safe,name+'-reference')
        out=ROOT/(name+'-aligned.mp4');p.make_output(src,isolated,out,end,name+'-aligned')
        checks=p.assess(out,safe,end,92.35,name+'-aligned');decoded=p.pcm(out)
        sync=anchors(truth,decoded)
        probe=b.probe(out,packets=True)
        packets=[x for x in probe['packets'] if x['codec_type']=='audio']
        audio_stream=next(x for x in probe['streams'] if x['codec_type']=='audio')
        assert audio_stream['time_base']=='1/48000' and packets[-1]['duration']==1024
        assert packets[-1]['pts']+packets[-1]['duration']==n and checks['trailing_padding_samples']==0
        assert end<=case['E'] and isolated.read_bytes()==raw.read_bytes()[:n*8]
        record={'case':name,'original_sha256':b.digest(original),'input_sha256':b.digest(raw),'aligned_input_sha256':b.digest(isolated),'aligned_sha256':b.digest(out),'original_samples':len(truth),'aligned_samples':n,'earlier_by_samples':len(truth)-n,'E':end,'audio_time_base':audio_stream['time_base'],'complete_packet_endpoint_proved':True,'last_audio_packet':packets[-1],'checks':checks,'sync_anchors':sync,'sync_passed':sync_pass(sync),'native':[]}
        result['cases'].append(record)
        assert len(decoded)==n and checks['bounded_payload_check_passed'] and sync_pass(sync)
        for variant,path,expected in [('original',original,len(truth)),('aligned',out,n)]:
            for trial in range(4):
                for api,binary in binaries.items():
                    label=f'{name}-{variant}-{api}-{trial+1}'
                    meta=ROOT/(label+'.json');pcm=ROOT/(label+'.f32')
                    subprocess.run([str(binary),str(path),str(meta),str(pcm)],check=True,capture_output=True)
                    info=json.loads(meta.read_text());audio=np.fromfile(pcm,dtype='<f4').reshape(-1,2)
                    info.update(variant=variant,trial=trial+1,api=api,expected_samples=expected,actual_samples=len(audio),pcm_sha256=b.digest(pcm),private_audio=native.audio_markers(audio),sync_anchors=anchors(truth,audio))
                    info['complete']=len(audio)==expected
                    info['privacy_and_sync_passed']=not any(info['private_audio']['blocks']) and sync_pass(info['sync_anchors'])
                    if api=='reader':
                        info['privacy_and_sync_passed'] &= info['private_video_frames']==0 and info['valid_video_intervals'] and info['video_frames']==(checks['normal']['frames'] if variant=='aligned' else case['checks']['normal']['frames']) and info['video_clock_error']<=.001 and info['audio_clock_error']<=1/b.SR and info['audio_end']<=expected/b.SR+1/b.SR and info['video_end']<=expected/b.SR+1e-5
                    # AVAudioFile is diagnostic only: do not waive its recorded terminal errors.
                    info['strict_pass']=info['complete'] and info['privacy_and_sync_passed'] and not info.get('terminal_error')
                    record['native'].append(info)
                    print(label,len(audio),expected,flush=True)
        if name=='offset':
            leak=truth[:n].copy();t=np.arange(192)/b.SR
            for ch,freq in enumerate((3500,4100)):leak[-192:,ch]=.8*np.sin(2*np.pi*freq*t)
            badraw=ROOT/'private.f32';leak.tofile(badraw);bad=ROOT/'private.mp4';p.make_output(src,badraw,bad,end,'private-control')
            badcheck=p.assess(bad,safe,end,92.35,'private-control')
            assert not badcheck['bounded_payload_check_passed'] and 'private_audio_marker' in badcheck['normal']['reasons']
            result['controls'].append({'fault':'4 ms private audio inside aligned endpoint','checks':badcheck})
            shifted=truth[:n].copy();shifted[:,1]=np.concatenate([np.zeros(480),shifted[:-480,1]])
            shiftedraw=ROOT/'shifted.f32';shifted.tofile(shiftedraw);shiftedout=ROOT/'shifted.mp4';p.make_output(src,shiftedraw,shiftedout,end,'shifted-control')
            a=anchors(truth,p.pcm(shiftedout));assert not sync_pass(a) and all(x['lag_samples']==480 for x in a if x['channel']==1)
            result['controls'].append({'fault':'right channel shifted 10 ms','anchors':a,'rejected':True})
            ptsout=ROOT/'pts.mp4';b.ff(['-i',out,'-itsoffset','0.05','-i',out,'-map','0:v:0','-map','1:a:0','-c','copy',ptsout],'pts-control')
            check=p.assess(ptsout,safe,end,92.35,'pts-control');assert not check['audio_contiguous_clock_passed'] and not check['bounded_payload_check_passed']
            result['controls'].append({'fault':'audio PTS shifted 50 ms','checks':check})
    result['all_aligned_reader_checks_passed']=all(x['strict_pass'] for c in result['cases'] for x in c['native'] if x['variant']=='aligned' and x['api']=='reader')
    result['commands']=b.RUNS
    result['harness_sha256']={f:b.digest(HERE/f) for f in ('stage4-packet-boundary-check.py','stage4-audiofile-decode.swift','stage4-native-decode.swift','stage4-padding-check.py','stage4-synthetic.py','stage4-native-check.py')}
    (ROOT/'packet-boundary-results.json').write_text(json.dumps(result,indent=2))
    print('RESULT',ROOT/'packet-boundary-results.json',flush=True)
if __name__=='__main__':
    print('SCRATCH',ROOT,flush=True);main()
