#!/usr/bin/env python3
"""Generated 1080p slides/motion quality and local resource experiment; no real media/network.
Requires Pillow. Two-minute variants, not a full-meeting/cloud performance forecast.
"""
import importlib.util
import json
import subprocess
import sys
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
sys.dont_write_bytecode=True
spec=importlib.util.spec_from_file_location('capacity',Path(__file__).with_name('stage4-capacity-check.py'))
c=importlib.util.module_from_spec(spec);spec.loader.exec_module(c)
ROOT=c.ROOT
FONT='/System/Library/Fonts/Supplemental/Arial.ttf'

def main():
    result={'scope':'Generated two-minute 1080p visual/resource probes; no cloud forecast','cases':[],
            'stage_a_status':'NOT PASSED: full matrix outstanding'}
    try:
        slide=Image.new('RGB',(1920,1080),'#f6f8fc');d=ImageDraw.Draw(slide)
        for text,y,size in [('SYNTHETIC SITE VISIT — GENERATED MEDIA',55,44),('Research presentation: slide 01',145,36),
             ('Budget: $125,000 / Year 2: $250,000',250,32),('Milestones: 12 samples, 48 experiments, 96 observations',320,28),
             ('Small text: ABCDEFGHIJKLMNOPQRSTUVWXYZ 0123456789',410,20),('No people or real meeting content.',475,24)]:
            d.text((70,y),text,font=ImageFont.truetype(FONT,size),fill='#12213c')
        slide.save(ROOT/'slide.png')
        scroll=Image.new('RGB',(1000,1600),'#e8eef7');d=ImageDraw.Draw(scroll)
        for i in range(32):d.text((20,15+i*48),f'Generated row {i+1:02}:    Result {i*17:04}    Progress {i%9+1}/10',font=ImageFont.truetype(FONT,27),fill='#193457')
        scroll.save(ROOT/'scroll.png')
        for kind in ('static','motion'):
            print('QUALITY',kind,flush=True)
            src=ROOT/(kind+'-source.mp4');out=ROOT/(kind+'-output.mp4')
            if kind=='static':graph='[0:v][1:v]overlay=x=1450:y=730:shortest=1[v]'
            else:graph='[2:v]crop=1000:440:0:mod(n*3\\,1160)[scroll];[0:v][scroll]overlay=x=70:y=600[base];[base][1:v]overlay=x=1100:y=600:shortest=1[v]'
            args=['-loop','1','-framerate','30','-i',ROOT/'slide.png','-f','lavfi','-i',f'testsrc2=s={"320x180" if kind=="static" else "800x440"}:r=30:d=120']
            if kind=='motion':args+=['-loop','1','-framerate','30','-i',ROOT/'scroll.png']
            args+=['-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=120',
                 '-filter_complex',graph,'-map','[v]','-map',f'{2 if kind=="static" else 3}:a','-t','120',
                 '-c:v','libx264','-threads','2','-preset','veryfast','-crf','18','-pix_fmt','yuv420p','-c:a','aac','-b:a','128k',src]
            assert c.run(args,kind+'-source')['exit']==0
            timings=[]
            for repeat in range(3):
                rec=c.run(['-i',src,'-map','0:v','-map','0:a','-c:v','libx264','-threads','2','-preset','veryfast',
                     '-crf','23','-c:a','aac','-b:a','128k','-movflags','+faststart',out],kind+f'-encode-{repeat}')
                assert rec['exit']==0;timings.append(rec['seconds'])
            assert c.run(['-i',out,'-f','null','-'],kind+'-decode')['exit']==0
            ssim=subprocess.run(['ffmpeg','-hide_banner','-i',str(src),'-i',str(out),'-lavfi','ssim','-an','-f','null','-'],capture_output=True,text=True)
            assert ssim.returncode==0
            ssimline=next(line for line in reversed(ssim.stderr.splitlines()) if 'SSIM Y:' in line)
            for label,path in [('source',src),('output',out)]:
                assert c.run(['-ss','60','-i',path,'-frames:v','1',ROOT/(kind+'-'+label+'.png')],kind+'-'+label+'-frame')['exit']==0
            result['cases'].append({'case':kind,'duration_seconds':120,'source_bytes':src.stat().st_size,'output_bytes':out.stat().st_size,
                 'source_sha256':c.sha(src),'output_sha256':c.sha(out),'encode_seconds':timings,'ssim':ssimline,
                 'output_probe':c.probe(out)})
        result['bounded_resource_runs_completed']=True
    finally:
        result['runs']=c.RUNS
        (ROOT/'quality-results.json').write_text(json.dumps(result,indent=2).replace(str(ROOT),'$SCRATCH'))
        print('RESULT',ROOT/'quality-results.json',flush=True)
if __name__=='__main__':print('SCRATCH',ROOT,flush=True);main()
