#!/usr/bin/env python3
"""Generated-media follow-up. Requires numpy (available in bundled workspace Python).
No input-media argument/network access. Imports the local fixture harness, making fresh scratch.
Proof is confined to synthetic, known pretrimmed PCM and the pinned AAC encoder.
"""
import hashlib
import importlib.util
import json
import math
import subprocess
import struct
from pathlib import Path
import numpy as np

spec=importlib.util.spec_from_file_location('fixture_harness',Path(__file__).with_name('stage4-synthetic.py'))
b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)
ROOT=b.ROOT

def pcm(path, ignore=False):
    opts=['-ignore_editlist','1'] if ignore else []
    return np.frombuffer(subprocess.check_output(['ffmpeg','-v','error',*opts,'-i',str(path),'-map','0:a:0',
            '-f','f32le','-ac','2','-ar',str(b.SR),'-']),dtype='<f4').reshape(-1,2).copy()

def packet_hashes(path):
    d=json.loads(subprocess.check_output(['ffprobe','-v','error','-select_streams','a:0','-show_packets',
            '-show_data_hash','sha256','-of','json',str(path)]))
    return [p['data_hash'] for p in d['packets']]

def encode_audio(raw,out,label):
    b.ff(['-f','f32le','-ar',str(b.SR),'-ac','2','-i',raw,'-c:a','aac','-b:a','128k',out],label)

def elementary_pcm(path):
    # ADTS has no MP4 edit lists or skip/discard-padding metadata.
    adts=subprocess.check_output(['ffmpeg','-v','error','-i',str(path),'-map','0:a:0','-c','copy','-f','adts','-'])
    decoded=subprocess.check_output(['ffmpeg','-v','error','-f','aac','-i','pipe:0','-f','f32le','-ac','2','-ar',str(b.SR),'-'],input=adts)
    return np.frombuffer(decoded,dtype='<f4').reshape(-1,2).copy()

def align(reference, candidate):
    # Both channels, three separated anchors, strong seeded nonperiodic pilot.
    records=[]
    for ch in range(2):
        for t in (1.5,6.5,10.5):
            center=round(t*b.SR); n=4096; radius=2048
            ref=reference[center:center+n,ch].astype(float);ref-=ref.mean()
            search=candidate[center-radius:center+n+radius,ch].astype(float)
            dots=np.correlate(search,ref,'valid')
            sums=np.convolve(search,np.ones(n),'valid')
            energy=np.convolve(search*search,np.ones(n),'valid')-sums*sums/n
            corr=dots/np.sqrt(np.maximum(energy,1e-20)*np.sum(ref*ref))
            peak=int(np.argmax(corr))
            records.append({'channel':ch,'anchor_seconds':t,'lag_samples':peak-radius,'correlation':float(corr[peak])})
    return records

def make_output(src,raw,out,end,label):
    frames=[f for f in b.probe(src,frames=True)['frames'] if f['media_type']=='video']
    eligible=[float(f['pts_time']) for f in frames if float(f['pts_time'])+float(f.get('duration_time',1/b.FPS))<=end+1e-9]
    vend=max(eligible)+1e-7
    b.ff(['-i',src,'-f','f32le','-ar',str(b.SR),'-ac','2','-i',raw,
          '-filter_complex',f'[0:v:0]trim=end={vend}[v]','-map','[v]','-map','1:a:0',
          '-map_metadata','-1','-map_chapters','-1','-c:v','libx264','-threads','2','-preset','veryfast',
          '-crf','23','-c:a','aac','-b:a','128k','-movflags','+faststart',out],label)

def assess(out,reference_audio,end,boundary,label):
    normal=b.verify(out,end,boundary,label+'-normal')
    ignored=b.verify(out,end,boundary,label+'-ignored',True)
    a=pcm(out);raw=elementary_pcm(out);expected_raw=elementary_pcm(reference_audio)
    # Trust only the independently encoded, isolated pre-E PCM, not self-reported duration.
    payload_match=packet_hashes(out)==packet_hashes(reference_audio)
    raw_match=np.array_equal(raw,expected_raw)
    packets=b.probe(out,packets=True)['packets']
    audio=[p for p in packets if p['codec_type']=='audio']
    skip=sum(int(v.get('skip_samples',0)) for v in audio[0].get('side_data_list',[]))
    tail=len(raw)-skip-len(a)
    decoded_match=tail>=0 and np.array_equal(raw[skip:skip+len(a)],a)
    # Video origin shifts are harmless only if complete decoded pixel bytes agree,
    # normal source-frame provenance passes, and the independent audio sync test passes.
    def video_hash(ignore):
        opts=['-ignore_editlist','1'] if ignore else []
        data=subprocess.check_output(['ffmpeg','-v','error',*opts,'-i',str(out),'-map','0:v:0',
                                     '-fps_mode','passthrough','-f','rawvideo','-pix_fmt','rgb24','-'])
        frames=np.frombuffer(data,dtype=np.uint8).reshape(-1,b.H,b.W,3)
        ids=[]
        for frame in frames:
            ids.append(sum((1<<bit) for bit in range(12) if int(frame[16,bit*24+16].sum())>384))
        return hashlib.sha256(data).hexdigest(),ids
    normal_hash,ids=video_hash(False)
    raw_hash,raw_ids=video_hash(True)
    same_video=normal_hash==raw_hash and ids==raw_ids
    vf=[f for f in b.probe(out,frames=True)['frames'] if f['media_type']=='video']
    clock_error=max((abs(float(f['pts_time'])-n/b.FPS) for f,n in zip(vf,ids)),default=float('inf'))
    video_clock_pass=len(vf)==len(ids) and clock_error<=.001  # FFV1 reference clock is milliseconds
    af=[f for f in b.probe(out,frames=True)['frames'] if f['media_type']=='audio']
    cumulative=0;audio_clock_error=0.
    for frame in af:
        audio_clock_error=max(audio_clock_error,abs(float(frame['pts_time'])-cumulative/b.SR))
        cumulative+=int(frame['nb_samples'])
    audio_clock_pass=bool(af) and cumulative==len(a) and audio_clock_error<=1/b.SR
    ignored_content_reasons=[r for r in ignored['reasons'] if r not in ('video_interval_after_E','audio_interval_after_E_unproved_padding')]
    passed=normal['accepted'] and payload_match and raw_match and decoded_match and same_video and video_clock_pass and audio_clock_pass and not ignored_content_reasons and 0<=tail<1024 and skip==1024
    return {'bounded_payload_check_passed':passed,'normal':normal,'ignore_editlist':ignored,
            'matches_isolated_safe_AAC_payload':payload_match,'raw_decode_matches_safe_reference':raw_match,
            'normal_equals_raw_after_priming_removal':decoded_match,'same_decoded_video_pixels':same_video,
            'video_source_clock_passed':video_clock_pass,'max_video_clock_error_seconds':clock_error,
            'audio_contiguous_clock_passed':audio_clock_pass,'max_audio_clock_error_seconds':audio_clock_error,
            'priming_samples':skip,'trailing_padding_samples':tail,
            'tail_peak':float(np.max(np.abs(raw[-tail:]))) if tail>0 else 0,
            'tail_rms':float(np.sqrt(np.mean(raw[-tail:]**2))) if tail>0 else 0}

def hide_tail_metadata(source, destination, end):
    # Deliberately dishonest synthetic MP4: shorten movie/track/edit durations,
    # retain every AAC packet. Restricted to this encoder's version-0 boxes.
    data=bytearray(source.read_bytes()); boxes=[]
    def walk(start,stop):
        at=start
        while at<stop:
            size,kind=struct.unpack_from('>I4s',data,at)
            assert size>=8 and at+size<=stop
            payload=at+8;boxes.append((kind,payload))
            if kind in (b'moov',b'trak',b'edts'):walk(payload,at+size)
            at+=size
    walk(0,len(data))
    movie=next(at for kind,at in boxes if kind==b'mvhd')
    assert data[movie]==0
    scale=struct.unpack_from('>I',data,movie+12)[0]
    limit=round(end*scale)
    for kind,at in boxes:
        if kind not in (b'mvhd',b'tkhd',b'elst'):continue
        assert data[at]==0
        if kind==b'mvhd':pos=at+16
        elif kind==b'tkhd':pos=at+20
        else:
            assert struct.unpack_from('>I',data,at+4)[0]==1
            pos=at+8
        current=struct.unpack_from('>I',data,pos)[0]
        struct.pack_into('>I',data,pos,min(current,limit))
    destination.write_bytes(data)

def main():
    result={'scope':'Synthetic known-input padding and A/V sync only; not full Stage A acceptance',
            'ffmpeg':subprocess.check_output(['ffmpeg','-version'],text=True).splitlines()[0],
            'numpy':np.__version__,'cases':[],'controls':[]}
    cases=[('mid_gop',12.35,0,False,False),('cut_before_keyframe',12.066,0,False,False),
           ('cut_at_keyframe',12.1,0,False,False),('cut_after_keyframe',12.133,0,False,False),
           ('offset',12.35,.35,False,False),('vfr_extra_audio',12.35,0,True,True)]
    try:
        for name,boundary,offset,vfr,extras in cases:
            print('CASE',name,flush=True)
            src=b.fixture(name,boundary,offset,vfr,extras,pilot=True);end=b.endpoint(boundary,.1)
            raw=ROOT/(name+'-safe.f32')
            # Pad beginning on the common clock, then physically isolate pre-E samples.
            b.ff(['-i',src,'-map','0:a:0','-af',f'aresample=first_pts=0,atrim=end={end}',
                  '-f','f32le','-ac','2','-ar',str(b.SR),raw],name+'-isolate')
            isolated=np.fromfile(raw,dtype='<f4').reshape(-1,2)
            assert len(isolated)<=math.floor(end*b.SR), 'encoder input extends past E'
            safe=ROOT/(name+'-safe.m4a');encode_audio(raw,safe,name+'-safe-reference')
            out=ROOT/(name+'-fixed.mp4');make_output(src,raw,out,end,name+'-fixed')
            observed=assess(out,safe,end,boundary,name)
            # Known original PCM starts at offset; insert silence without moving its markers.
            truth=pcm(ROOT/(name+'-reference.mkv'))
            truth=np.pad(truth,((round(offset*b.SR),0),(0,0)))
            decoded=pcm(out)
            anchors=align(truth,decoded)
            sync_pass=all(abs(a['lag_samples'])<=1 and a['correlation']>.85 for a in anchors)
            case={'case':name,'E':end,'encoder_input_frames':len(isolated),'encoder_input_sha256':b.digest(raw),
                  'input_source_sha256':b.digest(src),'checks':observed,'sync_anchors':anchors,'sync_passed':sync_pass,
                  'bounded_followup_passed':observed['bounded_payload_check_passed'] and sync_pass}
            result['cases'].append(case)
            if name=='offset':
                # Reproduce the old offset path from a physically isolated PCM file.
                legacy=ROOT/'legacy-cut.mp4';b.cut(src,legacy,end,'legacy-cut')
                oldraw=ROOT/'legacy-input.f32'
                b.ff(['-i',src,'-map','0:a:0','-af',f'atrim=end={end}','-f','f32le','-ac','2',oldraw],'legacy-isolate')
                oldref=ROOT/'legacy-safe.m4a';encode_audio(oldraw,oldref,'legacy-reference')
                oldnormal=b.verify(legacy,end,boundary,'legacy-normal')
                oldpcm=pcm(legacy);extra=round((oldnormal['audio_end']-end)*b.SR)
                result['legacy_offset']={'normal':oldnormal,'same_payload_as_isolated_trimmed_PCM':packet_hashes(legacy)==packet_hashes(oldref),
                   'extra_decoded_samples':extra,'tail_peak':float(np.max(np.abs(oldpcm[-extra:]))),
                   'tail_rms':float(np.sqrt(np.mean(oldpcm[-extra:]**2)))}
            if name=='mid_gop':
                # 4ms of private tone placed INSIDE nominal E: timestamps alone cannot reject it.
                leak=isolated.copy();n=192
                t=np.arange(n)/b.SR
                for ch,f in enumerate((3500,4100)):leak[-n:,ch]=.8*np.sin(2*np.pi*f*t)
                badraw=ROOT/'leak-input.f32';leak.astype('<f4').tofile(badraw)
                bad=ROOT/'leak-correct-duration.mp4';make_output(src,badraw,bad,end,'leak-correct-duration')
                control=assess(bad,safe,end,boundary,'leak-correct-duration')
                result['controls'].append({'name':'4ms private audio inside correct duration','checks':control})
                assert not control['matches_isolated_safe_AAC_payload'] and not control['bounded_payload_check_passed']
                assert control['normal']['reasons']==['private_audio_marker'], 'control must pass endpoint checks'
                # Explicitly hide a PRIVATE tail beyond E with MP4 packet-duration trimming.
                appended=np.concatenate([isolated,leak[-n:]])
                appendraw=ROOT/'append-private.f32';appended.astype('<f4').tofile(appendraw)
                appendout=ROOT/'append-private.mp4';make_output(src,appendraw,appendout,end,'append-private')
                hidden=ROOT/'hidden-tail.mp4'
                hide_tail_metadata(appendout,hidden,end)
                hidden_check=assess(hidden,safe,end,boundary,'hidden-tail')
                duration=float(b.probe(hidden)['format']['duration'])
                assert duration<=end+1/b.SR and not hidden_check['bounded_payload_check_passed']
                assert not hidden_check['matches_isolated_safe_AAC_payload']
                result['controls'].append({'name':'private tail hidden after E','reported_duration':duration,'checks':hidden_check})
                # Video shifted by 20ms without exceeding E must fail source-clock proof.
                shifted=ROOT/'shifted-video.mp4'
                b.ff(['-i',out,'-itsoffset','0.02','-i',out,'-map','1:v:0','-map','0:a:0','-c','copy',shifted],'shift-video')
                shifted_check=assess(shifted,safe,end,boundary,'shifted-video')
                assert not shifted_check['video_source_clock_passed'] and not shifted_check['bounded_payload_check_passed']
                assert shifted_check['normal']['accepted']
                result['controls'].append({'name':'video shifted 20ms with safe endpoint','checks':shifted_check})
                # Shift just the right audio channel to falsify the both-channel assertion.
                shifted_audio=isolated.copy();shifted_audio[:,1]=np.concatenate([np.zeros(480),isolated[:-480,1]])
                channelraw=ROOT/'right-shift.f32';shifted_audio.astype('<f4').tofile(channelraw)
                channelout=ROOT/'right-shift.mp4';make_output(src,channelraw,channelout,end,'right-shift')
                channel_anchors=align(truth,pcm(channelout))
                assert all(a['lag_samples']==480 for a in channel_anchors if a['channel']==1)
                assert all(a['lag_samples']==0 for a in channel_anchors if a['channel']==0)
                result['controls'].append({'name':'right channel shifted 10ms','anchors':channel_anchors,'sync_rejected':True})
                # Same decoded samples, shifted audio PTS: waveform-only checks would miss it.
                ptsout=ROOT/'shifted-audio-pts.mp4'
                b.ff(['-i',out,'-itsoffset','0.05','-i',out,'-map','0:v:0','-map','1:a:0','-c','copy',ptsout],'shift-audio-pts')
                pts_check=assess(ptsout,safe,end,boundary,'shifted-audio-pts')
                assert not pts_check['audio_contiguous_clock_passed'] and not pts_check['bounded_payload_check_passed']
                result['controls'].append({'name':'audio timestamps shifted with 50ms mux offset','checks':pts_check})
        result['all_six_bounded_checks_passed']=all(c['bounded_followup_passed'] for c in result['cases'])
        assert result['all_six_bounded_checks_passed'], 'bounded synthetic checks failed'
    finally:
        result['commands']=b.RUNS
        (ROOT/'padding-results.json').write_text(json.dumps(result,indent=2))
        print('RESULT',ROOT/'padding-results.json',flush=True)

if __name__=='__main__':
    print('SCRATCH',ROOT,flush=True);main()
