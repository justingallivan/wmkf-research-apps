#!/usr/bin/env node
/** Bounded synthetic cloud recipe proof. Uses only the isolated rehearsal Blob store and Vercel project. */
import fs from 'node:fs';
import crypto from 'node:crypto';
import {get,put,del} from '@vercel/blob';
import {Sandbox} from '@vercel/sandbox';
import {CUT_SCRIPT_PY} from '../lib/services/meeting-tracker-recordings/presentation-video-cut-script.js';
const env=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const resultPath=process.argv[3];
if(!resultPath||process.argv[4]!=='--execute'||!env.UPLOADS_BLOB_RW_TOKEN?.startsWith('vercel_blob_rw_Q4GFCvXEuzRiQbhY_'))throw Error('isolated_target_or_execute_required');
const receipt={source:'shipped recipe v3',startedAt:new Date().toISOString(),project:'wmkf-meeting-rehearsal-20261023',syntheticOnly:true,cases:[],stopped:false,deleted:false};
const save=()=>fs.writeFileSync(resultPath,JSON.stringify(receipt,null,2),{mode:0o600});save();
let sbx,roundtrip;
try{
 const r=await get(env.PRESENTATION_VIDEO_FFMPEG_BLOB_PATHNAME,{access:'private',token:env.UPLOADS_BLOB_RW_TOKEN});
 if(!r||r.statusCode!==200)throw Error('pinned_archive_unavailable');
 const tar=Buffer.from(await new Response(r.stream).arrayBuffer());
 const sha=crypto.createHash('sha256').update(tar).digest('hex');
 if(sha!=='14020417ff8ef01470e8cb771355e65c37aff62b80fb0be41eeb7611d1360902')throw Error('pinned_archive_mismatch');
 sbx=await Sandbox.create({name:'meeting-rehearsal-'+crypto.randomUUID(),persistent:false,resources:{vcpus:2},timeout:300000,networkPolicy:'deny-all',region:'iad1'});
 receipt.sandboxId=sbx.sandboxId;receipt.sdkCwd=sbx.cwd;save();
 await sbx.writeFiles([{path:'/vercel/sandbox/ffmpeg.tar.xz',content:tar},{path:'/vercel/sandbox/cut.py',content:Buffer.from(CUT_SCRIPT_PY)}]);
 async function run(cmd,args,env={}){const r=await sbx.runCommand({cmd,args,env,cwd:'/vercel/sandbox'});if(r.exitCode!==0)throw Error('cloud_command_failed_'+r.exitCode);return r;}
 await run('python3',['/vercel/sandbox/cut.py','install'],{FFMPEG_TAR:'/vercel/sandbox/ffmpeg.tar.xz',FFMPEG_SHA256:sha,FFMPEG_DIR:'/vercel/sandbox/tools',INSTALL_RECEIPT:'/vercel/sandbox/install.json'});
 const generator=String.raw`import os,subprocess,json,hashlib
root='/vercel/sandbox'
# The production installer flattens the pinned ffmpeg and ffprobe into tools/bin.
ff=root+'/tools/bin/ffmpeg'
if not os.path.exists(ff):
 matches=[]
 for d,_,files in os.walk(root+'/tools'):
  if 'ffmpeg' in files: matches.append(d+'/ffmpeg')
 if len(matches)!=1: raise RuntimeError('ffmpeg_binary_missing')
 ff=matches[0]
base=[ff,'-hide_banner','-nostdin','-y','-loglevel','error']
v=root+'/source.mp4';a=root+'/original.m4a';bad=root+'/reencoded.m4a'
subprocess.run(base+['-f','lavfi','-i','color=c=white:s=320x180:r=25:d=15','-f','lavfi','-i',"aevalsrc=if(lt(t\\,12.437)\\,0.3*sin(2*PI*440*t)\\,0.3*sin(2*PI*3000*t)):s=48000:d=15",'-vf',"drawbox=x=0:y=0:w=320:h=180:c=red:t=fill:enable='gte(t,12.437)'",'-c:v','libx264','-preset','ultrafast','-bf','0','-pix_fmt','yuv420p','-g','50','-c:a','aac','-b:a','64k',v],check=True)
subprocess.run(base+['-i',v,'-vn','-c:a','copy',a],check=True)
subprocess.run(base+['-i',v,'-vn','-c:a','aac','-b:a','32k',bad],check=True)
cases=[]
for name,audio,ok in [('matching',a,True),('mismatching',bad,False)]:
 data=open(audio,'rb').read();work=root+'/'+name
 env=dict(os.environ,FFMPEG_BIN_DIR=os.path.dirname(ff),SOURCE_PATH=v,SOURCE_SIZE=str(os.path.getsize(v)),CUT_MS='12437',WORK_DIR=work,MANUAL_AUDIO_PATH=audio,MANUAL_AUDIO_BYTES=str(len(data)),MANUAL_AUDIO_SHA256=hashlib.sha256(data).hexdigest())
 p=subprocess.run(['python3',root+'/cut.py','cut'],env=env)
 r=json.load(open(work+'/receipt.json'));out=work+'/presentation.mp4'
 if ok:
  assert p.returncode==0 and r['ok'] and r['manualPcmSamples']==240000
  # Independent marker check on every decoded output frame and the private audio tone.
  rgb=subprocess.check_output(base+['-i',out,'-vf','scale=1:1','-f','rawvideo','-pix_fmt','rgb24','-'])
  assert not any(rgb[i]>rgb[i+1]+80 and rgb[i]>rgb[i+2]+80 for i in range(0,len(rgb),3)), 'private_red_frame_leak'
  cases.append(dict(case=name,accepted=True,frameMarkerClean=True,receipt=r))
 else:
  assert p.returncode==3 and not r['ok'] and r['code']=='manual_video_audio_mismatch' and not os.path.exists(out)
  cases.append(dict(case=name,rejected=True,noOutput=True,receipt=r))
json.dump(cases,open(root+'/cases.json','w'))
`;
 await sbx.writeFiles([{path:'/vercel/sandbox/generate-and-check.py',content:Buffer.from(generator)}]);
 await run('python3',['/vercel/sandbox/generate-and-check.py']);
 receipt.cases=JSON.parse((await sbx.readFileToBuffer({path:'/vercel/sandbox/cases.json'})).toString());
 const bytes=await sbx.readFileToBuffer({path:'/vercel/sandbox/matching/presentation.mp4'});
 const pathname='meeting-rehearsal/'+crypto.randomUUID()+'/presentation.mp4';
 roundtrip=await put(pathname,bytes,{access:'private',token:env.UPLOADS_BLOB_RW_TOKEN,addRandomSuffix:false,allowOverwrite:false,contentType:'video/mp4'});
 const download=await get(roundtrip.pathname,{access:'private',token:env.UPLOADS_BLOB_RW_TOKEN});
 const check=Buffer.from(await new Response(download.stream).arrayBuffer());
 if(!bytes.equals(check))throw Error('private_blob_roundtrip_mismatch');
 receipt.privateBlobRoundtrip={bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),verified:true};
 receipt.passed=true;save();
}catch(error){receipt.passed=false;receipt.errorCode=error?.code||error?.message||error?.name;save();process.exitCode=1;}
finally{
 if(roundtrip){await del(roundtrip.pathname,{token:env.UPLOADS_BLOB_RW_TOKEN});receipt.syntheticBlobDeleted=true;save();}
 if(sbx){await sbx.stop();receipt.stopped=true;save();await sbx.delete({deleteOrphanSnapshots:true});receipt.deleted=true;save();}
 receipt.finishedAt=new Date().toISOString();save();console.log(JSON.stringify({passed:receipt.passed,cases:receipt.cases.map(c=>c.case),stopped:receipt.stopped,deleted:receipt.deleted,errorCode:receipt.errorCode}));
}
