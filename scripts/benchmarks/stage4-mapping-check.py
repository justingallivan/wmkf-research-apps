#!/usr/bin/env python3
"""Local synthetic M4A->MP4 clock experiment; requires bundled NumPy.
No external media/credentials/network. Generated ground truth is NOT passed to mapper.
This is a bounded experiment, not production ASR mapping or a privacy certificate.
"""
import hashlib
import json
import math
import subprocess
import tempfile
import time
from pathlib import Path
import numpy as np

ROOT=Path(tempfile.mkdtemp(prefix='wmkf-stage4-mapping-'))
SR=16000
COMMANDS=[]
TOL=.005  # Experimental model residual ceiling, not disclosure tolerance.
ANCHORS=list(range(5,116,10))

def ff(args,label):
    cmd=['ffmpeg','-hide_banner','-nostdin','-y','-loglevel','error',*map(str,args)]
    start=time.monotonic()
    p=subprocess.run(cmd,capture_output=True,text=True)
    COMMANDS.append({'label':label,'argv':[s.replace(str(ROOT),'$SCRATCH') for s in cmd],
                     'seconds':time.monotonic()-start,'exit':p.returncode})
    if p.returncode:raise RuntimeError(p.stderr)

def sha(p):
    h=hashlib.sha256()
    with p.open('rb') as f:
        for data in iter(lambda:f.read(1048576),b''):h.update(data)
    return h.hexdigest()

def decode(p):
    return np.frombuffer(subprocess.check_output(['ffmpeg','-v','error','-i',str(p),'-map','0:a:0',
       '-f','f32le','-ac','2','-ar',str(SR),'-']),dtype='<f4').reshape(-1,2).copy()

def clock_check(p):
    data=json.loads(subprocess.check_output(['ffprobe','-v','error','-select_streams','a:0',
        '-show_frames','-of','json',str(p)]))
    n=0;error=0.
    for f in data['frames']:
        error=max(error,abs(float(f['pts_time'])-n/SR));n+=int(f['nb_samples'])
    assert error<=1/SR
    return {'decoded_samples':n,'max_contiguous_clock_error_seconds':error}

def normalized_match(query, search):
    query=query.astype(float);query-=query.mean();search=search.astype(float)
    n=len(query);size=1<<(len(search)+n-2).bit_length()
    conv=np.fft.irfft(np.fft.rfft(search,size)*np.fft.rfft(query[::-1],size),size)
    dots=conv[n-1:len(search)]
    sums=np.r_[0,np.cumsum(search)];squares=np.r_[0,np.cumsum(search*search)]
    energy=squares[n:]-squares[:-n]-(sums[n:]-sums[:-n])**2/n
    corr=dots/np.sqrt(np.maximum(energy,1e-20)*np.sum(query*query))
    peak=int(np.argmax(corr));exclusion=round(.02*SR)
    alternatives=corr.copy();alternatives[max(0,peak-exclusion):peak+exclusion+1]=-1
    return peak,float(corr[peak]),float(np.max(alternatives))

def discover(mp4,m4a,times=ANCHORS):
    found=[];half=round(.125*SR)
    for t in times:
        estimates=[];qualities=[]
        for ch in range(2):
            center=round(t*SR);q=m4a[center-half:center+half,ch]
            left=max(0,round((t-4)*SR));right=min(len(mp4),round((t+4)*SR))
            if len(q)!=2*half or np.std(q)<.001:return {'blocked':'insufficient or silent anchor','anchors':found}
            lag,score,other=normalized_match(q,mp4[left:right,ch])
            if score<.75 or score-other<.2:return {'blocked':'weak or ambiguous anchor','anchors':found}
            estimates.append((left+lag+half)/SR);qualities.append({'correlation':score,'second_peak':other})
        if abs(estimates[0]-estimates[1])>2/SR:return {'blocked':'channels disagree','anchors':found}
        found.append({'m4a_seconds':t,'mp4_seconds':sum(estimates)/2,'channels':qualities,
                      'role':'fit' if len(found)%2==0 else 'validation'})
    return {'anchors':found}

def fit(points,constant=False):
    x=np.array([p['m4a_seconds'] for p in points]);y=np.array([p['mp4_seconds'] for p in points])
    if constant:a=1.;intercept=float(np.median(y-x))
    else:a,intercept=np.linalg.lstsq(np.column_stack([x,np.ones(len(x))]),y,rcond=None)[0]
    return {'slope':float(a),'offset':float(intercept)}

def residual(model,p):return abs(model['slope']*p['m4a_seconds']+model['offset']-p['mp4_seconds'])

def validate(model,points):
    errors=[residual(model,p) for p in points]
    return {'accepted':len(points)>=3 and max(errors)<=TOL and model['slope']>0,
            'max_residual_seconds':max(errors),'residuals_seconds':errors}

def infer(points):
    train=[p for p in points if p['role']=='fit'];held=[p for p in points if p['role']=='validation']
    for constant in (True,False):
        m=fit(train,constant);v=validate(m,held)
        if v['accepted'] and validate(m,train)['accepted']:
            return {'kind':'constant' if constant else 'affine','segments':[dict(m,lo=points[0]['m4a_seconds'],hi=points[-1]['m4a_seconds'])],
                    'validation':v,'max_residual':max(residual(m,p) for p in points)}
    # One structural break, with >=3 fitting anchors per side and separate model-selection validation.
    for split in range(3,len(train)-2):
        models=[fit(train[:split]),fit(train[split:])]
        if any(m['slope']<=0 for m in models):continue
        groups=[[],[]]
        for p in points:
            matches=[i for i,m in enumerate(models) if residual(m,p)<=TOL]
            if len(matches)!=1:break
            groups[matches[0]].append(p)
        else:
            if any(sum(p['role']=='validation' for p in g)<2 for g in groups):continue
            if max(p['m4a_seconds'] for p in groups[0])>=min(p['m4a_seconds'] for p in groups[1]):continue
            segs=[dict(m,lo=min(p['m4a_seconds'] for p in g),hi=max(p['m4a_seconds'] for p in g)) for m,g in zip(models,groups)]
            join=(segs[0]['hi']+segs[1]['lo'])/2
            if models[1]['slope']*join+models[1]['offset']<=models[0]['slope']*join+models[0]['offset']:continue
            if models[1]['slope']*segs[1]['lo']+models[1]['offset']<=models[0]['slope']*segs[0]['hi']+models[0]['offset']:continue
            return {'kind':'piecewise','segments':segs,'blocked_gap_interval':[segs[0]['hi'],segs[1]['lo']],
                    'max_residual':max(residual(m,p) for m,g in zip(models,groups) for p in g)}
    return {'kind':'blocked','reason':'no validated monotone model'}

def map_boundary(model,t):
    for s in model.get('segments',[]):
        if s['lo']<=t<=s['hi']:
            uncertainty=model['max_residual']+2/SR
            if uncertainty>2:return {'blocked':'uncertainty exceeds owner limit'}
            mapped=s['slope']*t+s['offset']
            return {'mapped':mapped,'empirical_margin':uncertainty,'candidate_end':mapped-uncertainty}
    return {'blocked':'boundary in unanchored gap or outside anchor support'}

def main():
    rng=np.random.default_rng(592);n=120*SR
    reference=np.empty((n,2),np.float32)
    for ch in range(2):
        noise=rng.normal(size=n);f=np.fft.rfft(noise);freq=np.fft.rfftfreq(n,1/SR)
        f[(freq<150)|(freq>1000)]=0
        v=np.fft.irfft(f,n);reference[:,ch]=(v/max(abs(v))*.7).astype(np.float32)
    raw=ROOT/'source.f32';reference.tofile(raw)
    mp4=ROOT/'source.mp4'
    ff(['-f','f32le','-ar',SR,'-ac',2,'-i',raw,'-f','lavfi','-i','testsrc2=s=320x180:r=10:d=120',
        '-map','1:v','-map','0:a','-t','120','-c:v','libx264','-threads','2','-preset','ultrafast','-crf','23',
        '-c:a','aac','-b:a','96k',mp4],'source-mp4')
    decoded=decode(mp4)
    result={'scope':'Generated source; MP4 audio clock checked against sample origin; no production guarantee',
            'clock':clock_check(mp4),'source_sha256':sha(mp4),'cases':[],'controls':[],'sample_rate':SR,
            'anchor_search_seconds':4,'residual_ceiling_seconds':TOL}
    try:
        # Ground truth is used to synthesize and audit, never supplied to discover/infer.
        for name,slope,offset,gap in [('offset',1.,.731,False),('pause_gap',1.,.731,True),('slow_drift',1.0008,.731,False),('hidden_local_warp',1.,.731,False)]:
            print('MAPPING',name,flush=True)
            duration=(120-offset-(2 if gap else 0))/slope
            tm=np.arange(int(duration*SR))/SR;tv=tm*slope+offset
            if gap:tv=tv+np.where(tm>=50-offset,2,0)
            if name=='hidden_local_warp':tv=tv+np.where((tm>=107)&(tm<=113),.1,0)
            audio=np.column_stack([np.interp(tv*SR,np.arange(n),reference[:,ch]) for ch in range(2)]).astype('<f4')
            ar=ROOT/(name+'.f32');audio.tofile(ar);m4a=ROOT/(name+'.m4a')
            ff(['-f','f32le','-ar',SR,'-ac',2,'-i',ar,'-c:a','aac','-b:a','96k',m4a],name+'-m4a')
            separate=decode(m4a);obs=discover(decoded,separate)
            assert not obs.get('blocked'),obs
            model=infer(obs['anchors']);mapped=map_boundary(model,110)
            audit=discover(decoded,separate,times=[109,110,111])
            audit_errors=[]
            if not audit.get('blocked'):
                for pt in audit['anchors']:
                    pt['role']='untouched_boundary_audit'
                    pred=map_boundary(model,pt['m4a_seconds'])
                    audit_errors.append(abs(pred['mapped']-pt['mp4_seconds']) if 'mapped' in pred else float('inf'))
            audit_pass=bool(audit_errors) and max(audit_errors)<=TOL
            if name=='hidden_local_warp':
                assert model['kind']=='constant' and not audit_pass
                result['controls'].append({'fault':'100ms local warp between model anchors','observations':obs,'model':model,
                    'final_boundary_audit':audit,'audit_errors':audit_errors,'rejected':True})
                continue
            assert audit_pass
            model['max_residual']=max(model['max_residual'],max(audit_errors))
            mapped=map_boundary(model,110)
            expected=slope*110+offset+(2 if gap else 0)
            assert 'blocked' not in mapped and abs(mapped['mapped']-expected)<=1/SR
            assert mapped['candidate_end']<=expected
            entry={'case':name,'truth':{'slope':slope,'offset':offset,'removed_source_interval':[50,52] if gap else None},
                   'final_boundary_audit':audit,'final_boundary_errors':audit_errors,'m4a_sha256':sha(m4a),'m4a_clock':clock_check(m4a),'observations':obs,'model':model,
                   'boundary_m4a':110,'boundary_result':mapped,'truth_boundary_mp4':expected}
            if gap:
                entry['gap_boundary_result']=map_boundary(model,50)
                assert 'blocked' in entry['gap_boundary_result'] and model['kind']=='piecewise'
            result['cases'].append(entry)
            held=[p for p in obs['anchors'] if p['role']=='validation']
            if name=='offset':bad={'slope':1.,'offset':model['segments'][0]['offset']+.1}
            else:bad={'slope':1.,'offset':obs['anchors'][0]['mp4_seconds']-obs['anchors'][0]['m4a_seconds']}
            check=validate(bad,held);assert not check['accepted']
            result['controls'].append({'case':name,'wrong_model':bad,'validation':check,
                'fault':'offset off by 100ms' if name=='offset' else 'gap ignored' if gap else 'drift ignored'})
        # Silence/ambiguous material is rejected instead of producing a confident mapping.
        silent=discover(decoded,np.zeros_like(separate));assert silent.get('blocked')
        result['controls'].append({'fault':'silent unmatched input','result':silent})
        tone=np.sin(2*np.pi*440*np.arange(len(decoded))/SR).astype(np.float32)
        periodic=discover(np.column_stack([tone,tone]),np.column_stack([tone,tone]))
        assert periodic.get('blocked')
        result['controls'].append({'fault':'repetitive ambiguous waveform (matcher-level)','result':periodic})
        result['bounded_mapping_tests_passed']=True
        result['stage_a_status']='NOT PASSED: complete matrix outstanding'
    finally:
        result['commands']=COMMANDS
        (ROOT/'mapping-results.json').write_text(json.dumps(result,indent=2));print('RESULT',ROOT/'mapping-results.json',flush=True)

if __name__=='__main__':
    print('SCRATCH',ROOT,flush=True);main()
