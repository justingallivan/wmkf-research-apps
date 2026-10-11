#!/usr/bin/env python3
"""Classify omitted native audio against frozen generated PCM and AAC padding.
Usage: NumPy-capable python stage4-tail-forensics.py <integration scratch directory>
Reads only hash-bound synthetic benchmark artifacts. Does not relax acceptance.
"""
import hashlib,json,subprocess,sys,tempfile
from pathlib import Path
import numpy as np

SR=48000

def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def pcm(path):return np.fromfile(path,dtype='<f4').reshape(-1,2)
def stats(a):return {'samples_per_channel':len(a),'rms':float(np.sqrt(np.mean(a.astype(float)**2))),
                     'peak':float(np.max(np.abs(a))),'nonzero_values':int(np.count_nonzero(a))}
def decode(path):
    return np.frombuffer(subprocess.check_output(['ffmpeg','-v','error','-i',str(path),'-map','0:a:0','-f','f32le','-ar',str(SR),'-ac','2','-']),dtype='<f4').reshape(-1,2)
def packets(path):
    return json.loads(subprocess.check_output(['ffprobe','-v','error','-select_streams','a:0','-show_packets','-show_data_hash','sha256','-of','json',str(path)]))['packets']
def raw_aac(path):
    adts=subprocess.check_output(['ffmpeg','-v','error','-i',str(path),'-map','0:a:0','-c','copy','-f','adts','-'])
    data=subprocess.check_output(['ffmpeg','-v','error','-f','aac','-i','pipe:0','-f','f32le','-ar',str(SR),'-ac','2','-'],input=adts)
    return np.frombuffer(data,dtype='<f4').reshape(-1,2)
def classification(input_samples,observed_samples,decoded_samples,prefix_matches):
    # A small duration or low energy is never sufficient for a padding exemption.
    if not prefix_matches or observed_samples>decoded_samples:return 'not_a_tail_only_omission'
    if observed_samples<input_samples:return 'retained_input_missing'
    return 'only_post_input_samples_omitted' if observed_samples<decoded_samples else 'no_omission'

def main():
    root=Path(sys.argv[1]).resolve()
    committed=Path(__file__).resolve().parents[2]/'docs/plans/STAGE4_LOCAL_MATRIX_EVIDENCE_2026-10-09.json'
    evidence=json.loads(committed.read_text())
    history=evidence['native'];integration=evidence['integration']
    assert integration['scope']=='Local generated integration only' and not history['all_positive_native_checks_passed']
    work=Path(tempfile.mkdtemp(prefix='wmkf-stage4-tail-'));print('SCRATCH',work,flush=True)
    result={'scope':'Generated-media end-tail provenance only; no acceptance relaxation','stage_a_status':'NOT PASSED',
            'prior_evidence_sha256':sha(committed),'harness_sha256':sha(Path(__file__)),
            'ffmpeg':subprocess.check_output(['ffmpeg','-version'],text=True).splitlines()[0],'cases':[],'fresh_reads':[]}
    executable=work/'native-decode'
    native_source=Path(__file__).with_name('stage4-native-decode.swift')
    subprocess.run(['swiftc','-parse-as-library',str(native_source),'-o',str(executable)],check=True,capture_output=True)
    result['native_source_sha256']=sha(native_source)
    try:
        # Two distinct output hashes cover all four integrated cases.
        for name in ('offset','drift'):
            print('FORENSICS',name,flush=True)
            case=next(c for c in integration['cases'] if c['case']==name)
            output=root/(name+'-presentation.mp4');isolated=root/(name+'-safe.f32');safe=root/(name+'-safe.m4a')
            assert sha(output)==case['checks']['normal']['sha256'] and sha(isolated)==case['safe_pcm_hash']
            stream=json.loads(subprocess.check_output(['ffprobe','-v','error','-select_streams','a:0','-show_streams','-of','json',str(output)]))['streams'][0]
            assert stream['time_base']=='1/48000' and stream['sample_rate']=='48000'
            safe=work/(name+'-fresh-safe.m4a')
            subprocess.run(['ffmpeg','-v','error','-y','-f','f32le','-ar',str(SR),'-ac','2','-i',str(isolated),'-c:a','aac','-b:a','128k',str(safe)],check=True,capture_output=True)
            source=pcm(isolated);normal=decode(output);elementary=raw_aac(output)
            assert len(source)==len(normal)==round(case['E']*SR)
            pak=packets(output);refpak=packets(safe)
            assert [p['data_hash'] for p in pak]==[p['data_hash'] for p in refpak]
            skip=sum(int(x.get('skip_samples',0)) for x in pak[0].get('side_data_list',[]))
            padding=sum(int(x.get('discard_padding',0)) for x in pak[-1].get('side_data_list',[]))
            assert skip==1024 and len(elementary)==skip+len(source)+padding
            assert np.array_equal(elementary[skip:skip+len(source)],normal)
            assert np.array_equal(elementary,raw_aac(safe))
            prior=[c for c in history['cases'] if c['sha256']==sha(output) and not c['negative_control']]
            full_item=next(c for c in prior if c['complete']);full=pcm(root/(full_item['case']+'-native.f32'))
            assert len(full)==full_item['audio_samples']==len(source)
            comparisons=[]
            for old in prior:
                file=root/(old['case']+'-native.f32');actual=pcm(file)
                assert len(actual)==old['audio_samples']
                same=np.array_equal(actual,full[:len(actual)])
                if len(actual)<len(source):
                    assert same and len(actual)==int(pak[-1]['pts'])
                    assert int(pak[-1]['duration'])==len(source)-len(actual)
                    tail=full[len(actual):];source_tail=source[len(actual):]
                    corr=float(np.corrcoef(tail.ravel(),source_tail.ravel())[0,1])
                    assert corr>.99 and np.count_nonzero(source_tail)==source_tail.size
                    comparisons.append({'prior_case':old['case'],'native_pcm_sha256':sha(file),'native_samples':len(actual),
                         'missing_samples_per_channel':len(source)-len(actual),'shared_prefix_bit_identical':same,
                         'source_tail':stats(source_tail),'native_missing_tail':stats(tail),
                         'native_source_tail_correlation':corr,'classification':classification(len(source),len(actual),len(full),same)})
            assert comparisons and all(c['classification']=='retained_input_missing' for c in comparisons)
            n=len(source)
            controls={'remove_only_actual_padding':classification(n,n,len(elementary)-skip,True),
                      'remove_one_retained_sample':classification(n,n-1,len(elementary)-skip,True),
                      'changed_earlier_audio':classification(n,n,len(elementary)-skip,False)}
            assert controls=={'remove_only_actual_padding':'only_post_input_samples_omitted','remove_one_retained_sample':'retained_input_missing','changed_earlier_audio':'not_a_tail_only_omission'}
            result['cases'].append({'case':name,'output_sha256':sha(output),'isolated_pcm_sha256':sha(isolated),
                 'isolated_samples':n,'normal_decoded_samples':len(normal),'elementary_decoded_samples':len(elementary),
                 'audio_time_base':stream['time_base'],'fresh_safe_AAC_sha256':sha(safe),'priming_samples':skip,'actual_post_input_padding_samples':padding,'final_packet':pak[-1],
                 'complete_native_pcm_sha256':sha(root/(full_item['case']+'-native.f32')),'comparisons':comparisons,
                 'classification_controls':controls})
            for trial in range(4):
                label=f'{name}-{trial+1}';meta=work/(label+'.json');raw=work/(label+'.f32')
                subprocess.run([str(executable),str(output),str(meta),str(raw)],check=True,capture_output=True)
                read=json.loads(meta.read_text());actual=pcm(raw);assert len(actual)==read['audio_samples']
                prefix=np.array_equal(actual,full[:len(actual)])
                result['fresh_reads'].append({'case':label,'output_sha256':sha(output),'native_pcm_sha256':sha(raw),
                    'native_samples':len(actual),'missing_samples':n-len(actual),'shared_prefix_bit_identical':prefix,
                    'classification':classification(n,len(actual),len(full),prefix),'native_probe':read})
        result['conclusion']='Omitted samples overlap retained encoder input; not an end-padding exemption.'
        result['acceptance_check_changed']=False
        result['bounded_forensic_assertions_passed']=True
    finally:
        (work/'tail-forensics-results.json').write_text(json.dumps(result,indent=2))
        print('RESULT',work/'tail-forensics-results.json',flush=True)
if __name__=='__main__':main()
