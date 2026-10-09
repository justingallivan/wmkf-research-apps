#!/usr/bin/env python3
"""Local generated-media experiment, NOT a production privacy verifier.

No network/credentials/input-media arguments. Creates a fresh /tmp directory.
Run: python3 scripts/benchmarks/stage4-synthetic.py [--long]
JSON receipts and all generated media stay in that directory. No automatic deletion.
"""
import argparse, array, hashlib, json, math, os, platform, random, subprocess, tempfile, time, wave
from pathlib import Path

ROOT = Path(tempfile.mkdtemp(prefix='wmkf-stage4-synthetic-'))
RUNS = []
SR, FPS, W, H = 48000, 30, 320, 180

def run(args, label):
    start = time.monotonic()
    with (ROOT / (label + '.log')).open('w') as log:
        p = subprocess.run([str(a) for a in args], stdout=log, stderr=subprocess.STDOUT)
    receipt = {'label': label, 'seconds': round(time.monotonic()-start, 3), 'exit': p.returncode,
               'argv': [str(a).replace(str(ROOT), '$SCRATCH') for a in args]}
    RUNS.append(receipt)
    if p.returncode:
        raise RuntimeError(f'{label}: {(ROOT / (label + ".log")).read_text()[-3000:]}')
    return receipt

def ff(args, label):
    return run(['ffmpeg', '-hide_banner', '-nostdin', '-y', '-loglevel', 'warning', *args], label)

def probe(path, frames=False, packets=False, ignore=False):
    args = ['ffprobe','-v','error']
    if ignore: args += ['-ignore_editlist','1']
    args += ['-show_streams','-show_format']
    if frames: args += ['-show_frames']
    if packets: args += ['-show_packets']
    return json.loads(subprocess.check_output(args+['-of','json',str(path)]))

def digest(path):
    h=hashlib.sha256()
    with path.open('rb') as f:
        for b in iter(lambda:f.read(1024*1024),b''): h.update(b)
    return h.hexdigest()

def endpoint(boundary, uncertainty):
    if not math.isfinite(uncertainty) or uncertainty < 0 or uncertainty > 2:
        return None
    return max(0, boundary-uncertainty)

def fixture(name, boundary, offset=0, vfr=False, extras=False, pilot=False):
    # Uncompressed reference: frame number encoded as 12 high-contrast blocks.
    raw=ROOT/(name+'.rgb'); wav=ROOT/(name+'.wav')
    with raw.open('wb') as f:
        for n in range(24*FPS):
            color=bytes((210,20,20) if n/FPS>=boundary else (20,160,20))
            row=color*W
            frame=bytearray(row*H)
            for bit in range(12):
                pix=bytes((240,240,240) if n & (1<<bit) else (0,0,0))
                for y in range(8,24):
                    at=(y*W+bit*24+8)*3
                    frame[at:at+16*3]=pix*16
            f.write(frame)
    # Distinct changing pre-boundary tones; 3.5/4.1kHz private markers per channel.
    samples=array.array('h')
    pilot_rng=random.Random(1909)
    for i in range(24*SR):
        t=i/SR+offset
        for ch in range(2):
            freq=(3500+600*ch) if t>=boundary else (330+110*ch+55*int(t//2))
            samples.append(int(7000*math.sin(2*math.pi*freq*t)) + (pilot_rng.randint(-5000,5000) if pilot and t<boundary else 0))
    with wave.open(str(wav),'wb') as f:
        f.setparams((2,2,SR,0,'NONE','not compressed'));f.writeframes(samples.tobytes())
    ref=ROOT/(name+'-reference.mkv')
    ff(['-f','rawvideo','-pixel_format','rgb24','-video_size',f'{W}x{H}','-framerate',str(FPS),'-i',raw,
        '-itsoffset',str(offset),'-i',wav,'-map','0:v:0','-map','1:a:0','-c:v','ffv1','-c:a','pcm_s16le',ref],name+'-reference')
    src=ROOT/(name+'.mp4')
    args=['-i',ref,'-map','0:v:0','-map','0:a:0']
    if extras: args+=['-map','0:a:0']
    if vfr: args+=['-vf',"select='if(lt(t,6),1,not(mod(n,2)))'",'-fps_mode','vfr']
    args+=['-c:v','libx264','-threads','2','-preset','veryfast','-crf','18','-g','60','-keyint_min','60','-sc_threshold','0','-bf','3',
           '-c:a','aac','-b:a','128k','-movflags','+faststart',src]
    ff(args,name+'-source')
    raw.unlink()  # exact generated scratch file only; lossless reference retained
    return src

def cut(src, out, end, label):
    # Whole video-frame intervals rounded down; audio samples rounded down.
    # Common origin preserved: no separate STARTPTS resets on offset streams.
    data=probe(src,frames=True)
    frames=[f for f in data['frames'] if f['media_type']=='video']
    eligible=[float(f['pts_time']) for f in frames if float(f['pts_time'])+float(f.get('duration_time',1/FPS))<=end+1e-9]
    vend=(max(eligible)+1e-7) if eligible else 0
    ff(['-i',src,'-filter_complex',f'[0:v:0]trim=end={vend}[v];[0:a:0]atrim=end={math.floor(end*SR)/SR}[a]',
        '-map','[v]','-map','[a]','-map_metadata','-1','-map_chapters','-1',
        '-c:v','libx264','-threads','2','-preset','veryfast','-crf','23','-c:a','aac','-b:a','128k',
        '-movflags','+faststart',out],label)

def verify(path, end, boundary, label, ignore=False):
    # Independent fixture-specific signal detector. Not generic speech/privacy proof.
    meta=probe(path,frames=True,ignore=ignore)
    reasons=[]
    if [s['codec_type'] for s in meta['streams']] != ['video','audio']: reasons.append('stream_allowlist')
    vf=[f for f in meta['frames'] if f['media_type']=='video']
    af=[f for f in meta['frames'] if f['media_type']=='audio']
    video_end=max((float(f['pts_time'])+float(f.get('duration_time',1/FPS)) for f in vf),default=0)
    audio_end=max((float(f['pts_time'])+int(f['nb_samples'])/SR for f in af),default=0)
    if video_end>end+1e-5: reasons.append('video_interval_after_E')
    # Report decoded AAC padding as a failure until independently proved harmless.
    if audio_end>end+1/SR: reasons.append('audio_interval_after_E_unproved_padding')
    opts=['-ignore_editlist','1'] if ignore else []
    rgb=ROOT/(label+'.rgb')
    ff([*opts,'-i',path,'-map','0:v:0','-fps_mode','passthrough','-f','rawvideo','-pix_fmt','rgb24',rgb],label+'-video')
    private=0; provenance=[]
    with rgb.open('rb') as f:
        while frame:=f.read(W*H*3):
            at=(100*W+100)*3;r,g,b=frame[at:at+3]
            private+=int(r>g*2 and r>100)
            n=0
            for bit in range(12):
                x=(16*W+bit*24+16)*3
                if sum(frame[x:x+3])>384:n|=1<<bit
            provenance.append(n)
    rgb.unlink()
    if private: reasons.append('private_video_marker')
    if any(n/FPS+1/FPS>end+1e-5 for n in provenance):reasons.append('source_frame_after_E')
    pcm=ROOT/(label+'.pcm')
    ff([*opts,'-i',path,'-map','0:a:0','-f','s16le','-ac','2','-ar',str(SR),pcm],label+'-audio')
    samples=array.array('h');samples.frombytes(pcm.read_bytes());pcm.unlink()
    # Goertzel detector over nonoverlapping 20 ms blocks across the entire output.
    max_ratio=[0.,0.];marker_blocks=[0,0];N=960
    for ch,freq in enumerate((3500,4100)):
        coeff=2*math.cos(2*math.pi*freq/SR)
        for frame_start in range(0,len(samples)//2,N):
            count=min(N,len(samples)//2-frame_start)
            start=frame_start*2+ch
            q1=q2=energy=0.
            for i in range(start,start+count*2,2):
                x=samples[i];q0=x+coeff*q1-q2;q2=q1;q1=q0;energy+=x*x
            ratio=(q1*q1+q2*q2-coeff*q1*q2)/max(1,energy*count)
            max_ratio[ch]=max(max_ratio[ch],ratio)
            marker_blocks[ch]+=int(ratio>.05 and energy/count>10000)
    if any(marker_blocks):reasons.append('private_audio_marker')
    return {'accepted':not reasons,'reasons':reasons,'video_end':video_end,'audio_end':audio_end,
            'private_frames':private,'private_audio_blocks':marker_blocks,'max_audio_marker_ratio':max_ratio,
            'frames':len(vf),'first_source_frame':provenance[0] if provenance else None,
            'last_source_frame':provenance[-1] if provenance else None,'sha256':digest(path),
            'bytes':path.stat().st_size,'ignore_editlist':ignore}

def short_stage():
    results=[]
    cases=[('mid_gop',12.35,0,False,False),('cut_before_keyframe',12.066,0,False,False),
           ('cut_at_keyframe',12.1,0,False,False),('cut_after_keyframe',12.133,0,False,False),
           ('offset',12.35,.35,False,False),('vfr_extra_audio',12.35,0,True,True)]
    for name,b,offset,vfr,extra in cases:
        print('CASE',name,flush=True)
        src=fixture(name,b,offset,vfr,extra);e=endpoint(b,.1);out=ROOT/(name+'-cut.mp4')
        keyframes=[float(f['pts_time']) for f in probe(src,frames=True)['frames'] if f['media_type']=='video' and f.get('key_frame')==1]
        cut(src,out,e,name+'-cut')
        result={'case':name,'boundary':b,'E':e,'source_sha256':digest(src),'source_bytes':src.stat().st_size,'actual_keyframes':keyframes,'fixture_uncertainty_seconds':.1,
                'normal':verify(out,e,b,name+'-normal'),
                'ignore_editlist':verify(out,e,b,name+'-ignore',True)}
        results.append(result)
        if name=='mid_gop':
            for kind,length,copy in [('leaky_remux',b+.5,True),('wrong_offset',b+.5,False),('naive_copy',e,True)]:
                bad=ROOT/(kind+'.mp4')
                if copy:ff(['-i',src,'-t',str(length),'-map','0:v:0','-map','0:a:0','-c','copy',bad],kind)
                else:cut(src,bad,length,kind)
                results.append({'case':kind,'expected':'reject' if kind!='naive_copy' else 'candidate only',
                                'normal':verify(bad,e,b,kind+'-verify')})
        (ROOT/'short-results.json').write_text(json.dumps(results,indent=2))
    policy=[{'uncertainty':u,'endpoint':endpoint(12.35,u)} for u in (0,.1,2,2.001)]
    for control in results:
        if control.get('expected')=='reject':
            assert {'private_video_marker','private_audio_marker'}.issubset(control['normal']['reasons']), 'content detector failed independently of timing checks'
    assert policy[-1]['endpoint'] is None and policy[-2]['endpoint']==10.35
    return {'fixtures':results,'uncertainty_policy':policy,
            'limitations':['Fixture-specific marker detection, not a generic privacy verifier.',
            'No automated waveform alignment, separate M4A-origin or pause-mapping solver implemented.',
            'No browser/VLC playback, arbitrary unreferenced-container-payload proof, or cloud lifecycle tests.']}

def long_stage():
    # Repeated minute with static slide-like bars and moving speaker tile; no real content.
    seed=ROOT/'screen-minute.mp4'
    graph="[0:v]drawgrid=w=iw:h=100:t=3:c=gray,drawbox=x=90:y=130:w=1000:h=20:c=white:t=fill[slide];[slide][1:v]overlay=x=1550:y=800:shortest=1[v]"
    ff(['-f','lavfi','-i','color=c=0x203040:s=1920x1080:r=30:d=60',
        '-f','lavfi','-i','testsrc2=s=320x180:r=30:d=60',
        '-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=60',
        '-filter_complex',graph,'-map','[v]','-map','2:a','-c:v','libx264','-threads','2',
        '-preset','veryfast','-b:v','650k','-minrate','650k','-maxrate','650k','-bufsize','1300k',
        '-x264-params','nal-hrd=cbr:force-cfr=1','-g','60','-c:a','aac','-b:a','128k',seed],'long-seed')
    src=ROOT/'screen-85min.mp4'
    ff(['-stream_loop','84','-i',seed,'-t','5100','-c','copy','-movflags','+faststart',src],'long-assemble')
    out=ROOT/'screen-presentation-60min.mp4'
    timing=ff(['-benchmark','-loglevel','info','-i',src,'-t','3600','-map','0:v:0','-map','0:a:0',
        '-c:v','libx264','-threads','2','-preset','veryfast','-crf','23','-c:a','aac','-b:a','128k',
        '-movflags','+faststart',out],'long-encode')
    decode=ff(['-i',out,'-map','0:v:0','-map','0:a:0','-f','null','-'],'long-full-decode')
    return {'source_bytes':src.stat().st_size,'source_sha256':digest(src),'source':probe(src),
            'output_bytes':out.stat().st_size,'output_sha256':digest(out),'output':probe(out),
            'encode_seconds':timing['seconds'],'realtime_factor':3600/timing['seconds'],
            'decode_seconds':decode['seconds'],
            'limitations':['Repeated 60-second pattern, no slide-text legibility or motion-heavy variant.',
            'Two encoder threads are not a two-vCPU allocation; local Apple silicon only.',
            'Long fixture has no private tail: performance only, not a privacy acceptance case.',
            '2 GB capacity fixture and quota failure not exercised.']}

if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('--long',action='store_true');args=ap.parse_args()
    print('SCRATCH',ROOT,flush=True)
    result={'scratch':str(ROOT),'platform':platform.platform(),'ffmpeg':subprocess.check_output(['ffmpeg','-version'],text=True),
            'started_utc':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())}
    try:
        result['short']=short_stage()
        result['stage_a_acceptance']='NOT PASSED: unresolved clock/padding checks and unimplemented coverage; exit zero only means experiment completed'
        if args.long:result['long']=long_stage()
    finally:
        result['commands']=RUNS
        (ROOT/'results.json').write_text(json.dumps(result,indent=2))
        print('RESULT',ROOT/'results.json',flush=True)
