#!/usr/bin/env python3
"""Local generated-media integration experiment, not a production verifier.
Requires NumPy and FFmpeg. No external media argument, network, credentials or publication.
Imports historical fixture checkers without changing their default behavior.
"""
import copy
import importlib.util
import json
import math
import struct
import subprocess
import sys
from pathlib import Path
import numpy as np
sys.dont_write_bytecode=True

def load(name,file):
    spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(file))
    mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod);return mod
p=load('padding','stage4-padding-check.py');b=p.b
m=load('mapping','stage4-mapping-check.py')
ROOT=b.ROOT
DURATION=120
PRIVATE=92.35
REVIEWED=92.25  # Known synthetic quiet-side review point, not a production margin.

def input_clock(path):
    meta=b.probe(path,frames=True)
    rate=int(next(s['sample_rate'] for s in meta['streams'] if s['codec_type']=='audio'))
    count=0;error=0.
    for f in meta['frames']:
        if f['media_type']!='audio':continue
        error=max(error,abs(float(f['pts_time'])-count/rate));count+=int(f['nb_samples'])
    assert count>0 and error<=1/rate
    return {'sample_rate':rate,'decoded_samples':count,'maximum_clock_error_seconds':error}

def alignment_audio(path):
    data=subprocess.check_output(['ffmpeg','-v','error','-i',str(path),'-map','0:a:0','-af','lowpass=f=1000',
        '-f','f32le','-ar',str(m.SR),'-ac','2','-'])
    return np.frombuffer(data,dtype='<f4').reshape(-1,2).copy()

def source():
    rng=np.random.default_rng(619);n=DURATION*b.SR
    audio=np.empty((n,2),dtype='<f4')
    for ch in range(2):
        z=rng.normal(size=n);f=np.fft.rfft(z);freq=np.fft.rfftfreq(n,1/b.SR)
        f[(freq<150)|(freq>800)]=0
        z=np.fft.irfft(f,n);audio[:,ch]=z/max(abs(z))*.55
        t=np.arange(n)/b.SR
        audio[t>=PRIVATE,ch]+=(.5*np.sin(2*np.pi*(3500+600*ch)*t[t>=PRIVATE])).astype(np.float32)
    raw=ROOT/'integrated-source.f32';audio.tofile(raw)
    rgb=ROOT/'integrated-source.rgb'
    with rgb.open('wb') as f:
        for n in range(DURATION*b.FPS):
            frame=np.empty((b.H,b.W,3),np.uint8);frame[:]=(210,20,20) if n/b.FPS>=PRIVATE else (20,160,20)
            for bit in range(12):frame[8:24,bit*24+8:bit*24+24]=(240,240,240) if n&(1<<bit) else (0,0,0)
            f.write(frame.tobytes())
    src=ROOT/'integrated-source.mp4'
    b.ff(['-f','rawvideo','-pixel_format','rgb24','-video_size',f'{b.W}x{b.H}','-framerate',b.FPS,'-i',rgb,
          '-f','f32le','-ar',b.SR,'-ac','2','-i',raw,'-c:v','libx264','-threads','2','-preset','veryfast','-crf','18',
          '-g','60','-sc_threshold','0','-bf','3','-c:a','aac','-b:a','192k',src],'integrated-source')
    rgb.unlink()
    return src,audio

def container_check(path):
    """Reject unexpected streams/top-level boxes and uncovered bytes in mdat.
    Bounded structural test; does not interpret every nested box or codec side payload.
    """
    reasons=[];meta=b.probe(path,packets=True)
    if [(s['codec_type'],s.get('codec_name','unknown')) for s in meta['streams']]!=[('video','h264'),('audio','aac')]:reasons.append('stream_allowlist')
    data=path.read_bytes();at=0;mdats=[];types=[]
    while at<len(data):
        if len(data)-at<8:reasons.append('trailing_bytes');break
        size,kind=struct.unpack_from('>I4s',data,at);header=8
        if size==1:
            if len(data)-at<16:reasons.append('invalid_box');break
            size=struct.unpack_from('>Q',data,at+8)[0];header=16
        if size<header or at+size>len(data):reasons.append('invalid_box');break
        types.append(kind.decode('ascii',errors='replace'))
        if kind not in (b'ftyp',b'moov',b'mdat',b'free'):reasons.append('unexpected_box')
        if kind==b'free' and size!=header:reasons.append('nonempty_free_box')
        if kind==b'mdat':mdats.append((at+header,at+size))
        at+=size
    packets=sorted((int(q['pos']),int(q['pos'])+int(q['size'])) for q in meta['packets'] if 'pos' in q)
    uncovered=0
    for lo,hi in mdats:
        cursor=lo
        for start,end in packets:
            if lo<=start<hi:
                if start!=cursor or end>hi:reasons.append('packet_extent_gap_or_overlap')
                uncovered+=max(0,start-cursor);cursor=max(cursor,end)
        uncovered+=max(0,hi-cursor)
    if uncovered:reasons.append('unreferenced_mdat_bytes')
    return {'accepted':not reasons,'reasons':sorted(set(reasons)),'top_level_boxes':types,'unreferenced_mdat_bytes':uncovered,
            'streams':[s['codec_type'] for s in meta['streams']]}

def binding(src,m4a,revision,boundary,model):
    return {'source_hash':b.digest(src),'audio_hash':b.digest(m4a),'revision':revision,'boundary':boundary,'mapping':copy.deepcopy(model)}

def eligible(receipt,current,out):
    # Every input and output binding must match at review eligibility time.
    return receipt.get('acceptance') is True and receipt.get('binding')==current and receipt.get('output_hash')==b.digest(out)

def main():
    result={'scope':'Local generated integration only','stage_a_status':'NOT PASSED: remaining matrix and uncertainty proof outstanding',
            'ffmpeg':subprocess.check_output(['ffmpeg','-version'],text=True).splitlines()[0],'cases':[],'controls':[]}
    try:
        src,audio=source();target=alignment_audio(src)
        result['source_clock']=input_clock(src)
        # Show that source really contains both private markers before testing removal.
        source_check=b.verify(src,120,PRIVATE,'source-marker-presence')
        assert source_check['private_frames']>0 and all(x>0 for x in source_check['private_audio_blocks'])
        result['source_marker_presence']=source_check
        for name,slope,offset,gap,rate in [('offset',1.,.731,False,48000),('pause_gap',1.,.731,True,48000),
                    ('drift',1.0008,.731,False,44100),('negative_offset',1.,-.517,False,44100)]:
            print('CASE',name,flush=True)
            t=np.arange(int((120-max(0,offset)-(2 if gap else 0))/slope*b.SR))/b.SR
            tv=t*slope+offset
            if gap:tv+=np.where(t>=50-offset,2,0)
            separate=np.column_stack([np.interp(tv*b.SR,np.arange(len(audio)),audio[:,ch],left=0,right=0) for ch in range(2)]).astype('<f4')
            raw=ROOT/(name+'-m4a.f32');separate.tofile(raw);m4a=ROOT/(name+'.m4a')
            b.ff(['-f','f32le','-ar',b.SR,'-ac','2','-i',raw,'-ar',rate,'-c:a','aac','-b:a','128k',m4a],name+'-m4a')
            separate=alignment_audio(m4a);observed=m.discover(target,separate)
            assert not observed.get('blocked'),observed
            model=m.infer(observed['anchors']);boundary=(REVIEWED-offset-(2 if gap else 0))/slope
            audit=m.discover(target,separate,[boundary-.75,boundary-.5,boundary-.25])
            assert not audit.get('blocked'),audit
            errors=[abs(m.map_boundary(model,a['m4a_seconds'])['mapped']-a['mp4_seconds']) for a in audit['anchors']]
            assert max(errors)<=m.TOL
            model['max_residual']=max(model['max_residual'],max(errors));mapped=m.map_boundary(model,boundary)
            assert abs(mapped['mapped']-REVIEWED)<=1/m.SR
            end=math.floor(mapped['candidate_end']*b.SR)/b.SR
            assert end<=REVIEWED
            frozen=binding(src,m4a,1,boundary,model)
            safe_raw=ROOT/(name+'-safe.f32')
            b.ff(['-i',src,'-map','0:a:0','-af',f'aresample=first_pts=0,atrim=end={end}',
                  '-f','f32le','-ar',b.SR,'-ac','2',safe_raw],name+'-isolate')
            assert safe_raw.stat().st_size//8<=math.floor(end*b.SR)
            safe=ROOT/(name+'-safe.m4a');p.encode_audio(safe_raw,safe,name+'-reference')
            out=ROOT/(name+'-presentation.mp4');p.make_output(src,safe_raw,out,end,name+'-cut')
            checks=p.assess(out,safe,end,PRIVATE,name);container=container_check(out)
            assert checks['bounded_payload_check_passed'] and container['accepted'],checks
            receipt={'acceptance':True,'binding':frozen,'output_hash':b.digest(out)}
            assert eligible(receipt,binding(src,m4a,1,boundary,model),out)
            result['cases'].append({'case':name,'mapping':model,'anchors':observed,'boundary_audit':audit,'boundary_errors':errors,
                 'm4a_clock':input_clock(m4a),'reviewed_m4a_boundary':boundary,'mapped':mapped,'E':end,'source_hash':b.digest(src),'m4a_hash':b.digest(m4a),
                 'safe_pcm_hash':b.digest(safe_raw),'output':str(out).replace(str(ROOT),'$SCRATCH'),'checks':checks,'container':container})
            for key,new in [('source_hash','changed-source'),('audio_hash','changed-audio'),('revision',2),('boundary',boundary+.1),('mapping',{})]:
                current=copy.deepcopy(frozen);current[key]=new
                assert not eligible(receipt,current,out)
                result['controls'].append({'case':name,'fault':'stale '+key,'rejected':True})
            denied=dict(receipt,acceptance=False);assert not eligible(denied,frozen,out)
            if name=='offset':
                # Actual bytes changed after validation, not only a mocked hash field.
                changed=ROOT/'changed-output.mp4';changed.write_bytes(out.read_bytes()+b'changed')
                assert not eligible(receipt,frozen,changed)
                result['controls'].append({'fault':'output bytes changed after acceptance','rejected':True})
                badmodel=copy.deepcopy(model);badmodel['segments'][0]['offset']+=.1
                validation=m.validate(badmodel['segments'][0],[a for a in observed['anchors'] if a['role']=='validation'])
                assert not validation['accepted']
                result['controls'].append({'fault':'100ms wrong mapping rejected before encoding','validation':validation})
                # Bypass mapping gate deliberately to prove the downstream content check.
                badraw=ROOT/'late.f32';late=PRIVATE+.2
                b.ff(['-i',src,'-map','0:a:0','-af',f'atrim=end={late}','-f','f32le','-ac','2',badraw],'late-isolate')
                bad=ROOT/'late.mp4';p.make_output(src,badraw,bad,late,'late-output')
                rejected=p.assess(bad,safe,end,PRIVATE,'late')
                assert not rejected['bounded_payload_check_passed'] and rejected['normal']['private_frames']>0 and all(rejected['normal']['private_audio_blocks'])
                result['controls'].append({'fault':'bypassed mapping with late cut','checks':rejected})
                # Contaminated source includes two audio tracks, captions and a tmcd data track.
                srt=ROOT/'private.srt';srt.write_text('1\n00:00:01,000 --> 00:01:59,000\nSYNTHETIC PRIVATE CAPTION\n')
                extras=ROOT/'extras.mp4'
                b.ff(['-i',src,'-i',srt,'-map','0:v','-map','0:a','-map','0:a','-map','1:0','-c','copy',
                      '-c:s','mov_text','-metadata','comment=SYNTHETIC PRIVATE METADATA','-timecode','00:00:00:00',extras],'extra-streams')
                extra_check=container_check(extras)
                assert not extra_check['accepted'] and {'subtitle','data'}.issubset(extra_check['streams'])
                cleaned=ROOT/'stripped-presentation.mp4';p.make_output(extras,safe_raw,cleaned,end,'strip-extras')
                clean_check=container_check(cleaned);clean_payload=p.assess(cleaned,safe,end,PRIVATE,'stripped')
                assert clean_check['accepted'] and clean_payload['bounded_payload_check_passed']
                assert 'SYNTHETIC PRIVATE' not in json.dumps(b.probe(cleaned))
                result['controls'].append({'fault':'caption/data/extra audio/metadata source','source':extra_check,'cleaned':clean_check,'payload_pass':True})
                for label,tail in [('trailing',b'PRIVATE'),('uuid',struct.pack('>I4s',31,b'uuid')+b'0'*16+b'PRIVATE'),
                                   ('mdat',struct.pack('>I4s',15,b'mdat')+b'PRIVATE'),('free',struct.pack('>I4s',15,b'free')+b'PRIVATE')]:
                    path=ROOT/(label+'-payload.mp4');path.write_bytes(out.read_bytes()+tail)
                    check=container_check(path);assert not check['accepted']
                    result['controls'].append({'fault':label+' hidden payload','container':check})
        # Broader mapper complements: noise and channel-mix mismatch fail closed.
        rng=np.random.default_rng(100)
        noisy=target+rng.normal(0,.4,target.shape)
        for label,other in [('heavy_noise',noisy),('channel_swap',target[:,::-1])]:
            check=m.discover(target,other);assert check.get('blocked')
            result['controls'].append({'fault':label,'mapping':check})
        result['bounded_integrated_checks_passed']=True
    finally:
        result['commands']=b.RUNS
        (ROOT/'integrated-results.json').write_text(json.dumps(result,indent=2))
        print('RESULT',ROOT/'integrated-results.json',flush=True)
if __name__=='__main__':print('SCRATCH',ROOT,flush=True);main()
