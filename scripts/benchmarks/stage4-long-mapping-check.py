#!/usr/bin/env python3
"""Local generated 85-minute slow-drift mapping and two-gap rejection. NumPy required.
No real-media input, credentials or network. Does not certify uncertainty between anchors.
"""
import importlib.util,json,subprocess,sys
from pathlib import Path
import numpy as np
sys.dont_write_bytecode=True
spec=importlib.util.spec_from_file_location('mapping',Path(__file__).with_name('stage4-mapping-check.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
ROOT=m.ROOT
SR=m.SR
DURATION=5100

def create_m4a(ref,name,duration,slope,offset,two_gaps=False):
    raw=ROOT/(name+'.f32')
    with raw.open('wb') as f:
        for start in range(0,duration,60):
            t=np.arange(start*SR,min(start+60,duration)*SR)/SR
            tv=t*slope+offset
            if two_gaps:tv+=np.where(t>=35,1.,0)+np.where(t>=75,1.5,0)
            first=max(0,int(np.floor(tv[0]*SR))-1);last=min(len(ref),int(np.ceil(tv[-1]*SR))+2)
            block=np.asarray(ref[first:last]);x=np.arange(first,last)
            out=np.column_stack([np.interp(tv*SR,x,block[:,ch],left=0,right=0) for ch in range(2)]).astype('<f4')
            f.write(out.tobytes())
    path=ROOT/(name+'.m4a')
    m.ff(['-f','f32le','-ar',SR,'-ac','2','-i',raw,'-c:a','aac','-b:a','64k',path],name)
    raw.unlink();return path

def main():
    result={'scope':'Generated 85-minute drift and short multiple-gap mapping only','stage_a_status':'NOT PASSED: full matrix outstanding'}
    try:
        raw=ROOT/'source.f32';rng=np.random.default_rng(819)
        with raw.open('wb') as f:
            for start in range(0,DURATION,60):
                n=min(60,DURATION-start)*SR;block=np.empty((n,2),'<f4')
                for ch in range(2):
                    z=rng.normal(size=n);freq=np.fft.rfftfreq(n,1/SR);v=np.fft.rfft(z);v[(freq<150)|(freq>800)]=0
                    z=np.fft.irfft(v,n);block[:,ch]=z/max(abs(z))*.7
                f.write(block.tobytes())
        ref=np.memmap(raw,dtype='<f4',mode='r',shape=(DURATION*SR,2));src=ROOT/'source.mp4'
        m.ff(['-f','f32le','-ar',SR,'-ac','2','-i',raw,'-f','lavfi','-i','color=c=green:s=160x90:r=1:d=5100',
              '-map','1:v','-map','0:a','-c:v','libx264','-threads','2','-preset','ultrafast','-c:a','aac','-b:a','64k',src],'long-source')
        drift=create_m4a(ref,'drift',5099,1.00008,.431)
        # Decode to mmap files to avoid keeping multiple full 85-minute arrays in RAM.
        def decoded(path,label):
            out=ROOT/(label+'-decoded.f32');m.ff(['-i',path,'-map','0:a:0','-f','f32le','-ar',SR,'-ac','2',out],label+'-decode')
            return np.memmap(out,dtype='<f4',mode='r',shape=(out.stat().st_size//8,2))
        target=decoded(src,'source');other=decoded(drift,'drift')
        times=list(range(35,5076,420));obs=m.discover(target,other,times);assert not obs.get('blocked'),obs
        model=m.infer(obs['anchors']);assert model['kind']=='affine',model
        audit=m.discover(target,other,[4799,4800,4801]);assert not audit.get('blocked')
        errors=[abs(m.map_boundary(model,p['m4a_seconds'])['mapped']-p['mp4_seconds']) for p in audit['anchors']]
        assert max(errors)<=1/SR
        model['max_residual']=max(model['max_residual'],max(errors))
        mapped=m.map_boundary(model,4800);truth=4800*1.00008+.431
        assert abs(mapped['mapped']-truth)<=1/SR
        bad={'slope':1.,'offset':obs['anchors'][0]['mp4_seconds']-obs['anchors'][0]['m4a_seconds']}
        reject=m.validate(bad,[p for p in obs['anchors'] if p['role']=='validation']);assert not reject['accepted']
        result['long_drift']={'source_clock':m.clock_check(src),'m4a_clock':m.clock_check(drift),'source_sha256':m.sha(src),'m4a_sha256':m.sha(drift),'duration_seconds':DURATION,
             'true_slope':1.00008,'true_offset':.431,'observations':obs,'model':model,'boundary_audit':audit,'boundary_errors':errors,
             'mapped_4800':mapped,'truth_4800':truth,'ignored_drift_rejection':reject}
        gaps=create_m4a(ref,'two-gaps',117,1.,.431,True);other=m.decode(gaps)
        straddling=m.discover(target,other);assert straddling.get('blocked')
        obs=m.discover(target,other,[t-2 for t in m.ANCHORS]);assert not obs.get('blocked'),obs
        model=m.infer(obs['anchors']);assert model['kind']=='blocked',model
        result['two_gap_control']={'straddling_anchor_rejected':straddling,'observations':obs,'model':model,'rejected':True}
        result['bounded_long_mapping_passed']=True
    finally:
        result['commands']=m.COMMANDS
        (ROOT/'long-mapping-results.json').write_text(json.dumps(result,indent=2));print('RESULT',ROOT/'long-mapping-results.json',flush=True)
if __name__=='__main__':print('SCRATCH',ROOT,flush=True);main()
