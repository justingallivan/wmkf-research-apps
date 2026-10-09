#!/usr/bin/env python3
"""Bounded nested-box and metadata controls on generated integration media only.
Does not parse codec bitstreams, arbitrary sample-entry extensions or all MP4 forms.
"""
import importlib.util,json,struct,subprocess,sys,hashlib
from pathlib import Path
sys.dont_write_bytecode=True
spec=importlib.util.spec_from_file_location('integration',Path(__file__).with_name('stage4-integrated-check.py'))
i=importlib.util.module_from_spec(spec);spec.loader.exec_module(i)
ALLOWED={b'moov':{b'mvhd',b'trak',b'udta'},b'trak':{b'tkhd',b'edts',b'mdia'},b'edts':{b'elst'},
 b'mdia':{b'mdhd',b'hdlr',b'minf'},b'minf':{b'vmhd',b'smhd',b'dinf',b'stbl'},b'dinf':{b'dref'},
 b'stbl':{b'stsd',b'stts',b'stss',b'ctts',b'stsc',b'stsz',b'stco',b'co64',b'sgpd',b'sbgp'},b'udta':{b'meta'},
 b'meta':{b'hdlr',b'ilst'},b'ilst':{b'\xa9too'},b'\xa9too':{b'data'}}

def nested_check(path):
    check=i.container_check(path);reasons=list(check['reasons']);data=path.read_bytes()
    def walk(start,stop,parent):
        at=start
        while at<stop:
            if stop-at<8:reasons.append('malformed_nested_box');return
            size,kind=struct.unpack_from('>I4s',data,at)
            if size<8 or at+size>stop:reasons.append('unsupported_or_malformed_nested_box');return
            if parent in ALLOWED and kind not in ALLOWED[parent]:reasons.append('unexpected_nested_box')
            if kind in ALLOWED:walk(at+8+(4 if kind==b'meta' else 0),at+size,kind)
            at+=size
    walk(0,len(data),b'root')
    meta=i.b.probe(path)
    if set(meta['format'].get('tags',{})) - {'major_brand','minor_version','compatible_brands','encoder'}:reasons.append('unexpected_format_metadata')
    return {'accepted':not reasons,'reasons':sorted(set(reasons)),'base':check}

def main():
    root=Path(sys.argv[1]).resolve();source=json.loads((root/'integrated-results.json').read_text())
    assert source['scope']=='Local generated integration only' and source.get('bounded_integrated_checks_passed')
    result={'scope':'Generated nested-box/metadata controls; codec internals not parsed','cases':[],
            'stage_a_status':'NOT PASSED: full matrix outstanding'}
    for case in source['cases']:
        out=root/(case['case']+'-presentation.mp4');assert i.b.digest(out)==case['checks']['normal']['sha256']
        check=nested_check(out);assert check['accepted'],check
        result['cases'].append({'case':case['case'],'sha256':i.b.digest(out),'check':check})
    original=root/'offset-presentation.mp4'
    meta=root/'private-metadata.mp4'
    i.b.ff(['-i',original,'-map','0','-c','copy','-metadata','comment=SYNTHETIC PRIVATE METADATA',meta],'private-metadata')
    check=nested_check(meta);assert not check['accepted'] and 'unexpected_format_metadata' in check['reasons']
    result['cases'].append({'case':'private nested metadata','check':check})
    base=root/'moov-last.mp4';i.b.ff(['-i',original,'-map','0','-c','copy','-map_metadata','-1',base],'moov-last')
    assert nested_check(base)['accepted']
    data=bytearray(base.read_bytes());at=0
    while at<len(data):
        size,kind=struct.unpack_from('>I4s',data,at)
        if kind==b'moov':break
        at+=size
    assert kind==b'moov' and at+size==len(data)
    tail=struct.pack('>I4s',15,b'free')+b'PRIVATE';struct.pack_into('>I',data,at,size+len(tail));data+=tail
    hidden=root/'nested-free-private.mp4';hidden.write_bytes(data)
    # Ordinary stream probes and top-level/mdat checks still pass; nested scan must reject.
    ordinary=i.container_check(hidden);assert ordinary['accepted'],ordinary
    assert i.b.probe(hidden)['format']['duration']==i.b.probe(base)['format']['duration']
    check=nested_check(hidden);assert not check['accepted'] and 'unexpected_nested_box' in check['reasons']
    result['cases'].append({'case':'private bytes in nested moov/free','base_check_passed':True,'check':check})
    result['bounded_container_checks_passed']=True;result['commands']=i.b.RUNS
    (root/'container-results.json').write_text(json.dumps(result,indent=2).replace(str(root),'$SCRATCH'))
    print('RESULT',root/'container-results.json',flush=True)
if __name__=='__main__':main()
