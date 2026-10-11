#!/usr/bin/env python3
"""Run independent Apple decoding on an existing generated integration receipt.
Usage: python stage4-native-check.py <printed integration scratch directory>
Only hashes recorded by that generated test are read; no cloud or real media.
"""
import hashlib,json,subprocess,sys
from pathlib import Path
import numpy as np

def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def audio_markers(data):
    counts=[];peaks=[]
    for ch,freq in enumerate((3500,4100)):
        count=0;peak=0
        for start in range(0,len(data),960):
            v=data[start:start+960,ch].astype(float);n=len(v)
            if not n:continue
            energy=float(v@v);power=abs(np.sum(v*np.exp(-2j*np.pi*freq*np.arange(n)/48000)))**2
            ratio=power/max(1e-20,energy*n);peak=max(peak,ratio)
            count+=int(ratio>.05 and energy/n>10000/32768**2)
        counts.append(count);peaks.append(peak)
    return {'blocks':counts,'peak_ratios':peaks}

def main():
    root=Path(sys.argv[1]).resolve();receipt=json.loads((root/'integrated-results.json').read_text())
    assert receipt['scope']=='Local generated integration only' and receipt.get('bounded_integrated_checks_passed')
    executable=root/'native-decode'
    subprocess.run(['swiftc','-parse-as-library',str(Path(__file__).with_name('stage4-native-decode.swift')),'-o',str(executable)],check=True,capture_output=True)
    result={'scope':'Apple AVFoundation full independent decode, not interactive browser playback','cases':[],
            'stage_a_status':'NOT PASSED: matrix incomplete'}
    tests=[(c['case'],root/(c['case']+'-presentation.mp4'),c['checks']['normal']['sha256'],c['E'],False,c['checks']['normal']) for c in receipt['cases']]
    late=next(c for c in receipt['controls'] if c['fault']=='bypassed mapping with late cut')
    tests.append(('late-control',root/'late.mp4',late['checks']['normal']['sha256'],receipt['cases'][0]['E'],'private',late['checks']['normal']))
    truncated=root/'native-truncated-control.mp4'
    subprocess.run(['ffmpeg','-v','error','-y','-i',str(root/'offset-presentation.mp4'),'-t','5','-c','copy',str(truncated)],check=True,capture_output=True)
    tests.append(('truncated-control',truncated,digest(truncated),receipt['cases'][0]['E'],'truncated',receipt['cases'][0]['checks']['normal']))
    tests=[(name+f'-trial-{trial+1}',path,expected,end,bad,normal) for trial in range(3) for name,path,expected,end,bad,normal in tests]
    for name,path,expected,end,bad,normal in tests:
        print('NATIVE',name,flush=True);assert digest(path)==expected
        meta=root/(name+'-native.json');raw=root/(name+'-native.f32')
        subprocess.run([str(executable),str(path),str(meta),str(raw)],check=True,capture_output=True)
        check=json.loads(meta.read_text());audio=np.fromfile(raw,dtype='<f4').reshape(-1,2)
        check['private_audio']=audio_markers(audio)
        check['E']=end;check['sha256']=expected;check['case']=name
        check['expected_audio_samples']=round(normal['audio_end']*48000)
        check['expected_video_frames']=normal['frames']
        check['negative_control']=bool(bad)
        check['complete']=check['video_frames']==normal['frames']>0 and check['audio_samples']==round(normal['audio_end']*48000)>0
        check['bounded_pass']=check['complete'] and check['valid_video_intervals'] and check['private_video_frames']==0 and not any(check['private_audio']['blocks']) and check['video_end']<=end+1e-5 and check['audio_end']<=end+1/48000 and check['video_clock_error']<=.001 and check['audio_clock_error']<=1/48000
        if bad=='private':assert not check['bounded_pass'] and check['private_video_frames']>0 and all(check['private_audio']['blocks'])
        if bad=='truncated':assert not check['bounded_pass'] and not check['complete']
        result['cases'].append(check)
    result['all_positive_native_checks_passed']=all(c['bounded_pass'] for c in result['cases'] if not c['negative_control'])
    (root/'native-results.json').write_text(json.dumps(result,indent=2))
    print('RESULT',root/'native-results.json',flush=True)
if __name__=='__main__':main()
