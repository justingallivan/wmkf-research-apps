/** Private media bytes and exact-path cleanup, separate from staff/API hydration. */
import crypto from 'node:crypto';
import {get,del} from '@vercel/blob';
import {manualVideoPairStore} from './manual-video-pair-store.js';
const fail=(code,message)=>{const error=new Error(message);error.code=code;throw error;};
const privatePath=path=>typeof path==='string'&&/^manual-video-pairs\/[1-9][0-9]*\/[a-f0-9-]{36}\/audio\.(mp3|m4a)$/.test(path);
const token=()=>{if(!process.env.UPLOADS_BLOB_RW_TOKEN)fail('manual_video_upload_unavailable','Private recording uploads are not configured.');return process.env.UPLOADS_BLOB_RW_TOKEN;};
/** Bound the stream before buffering; only audio bytes, never a storage credential, enter the media Sandbox. */
export async function readManualVideoAudio(row,{deadlineMs=Date.now()+90000}={}){
 const budget=Math.min(90000,deadlineMs-Date.now());if(budget<=0)fail('manual_video_audio_deadline','Insufficient time to verify original audio.');
 if(!privatePath(row?.audio_pathname))fail('manual_video_audio_missing','The original audio upload is unavailable.');
 const response=await get(row.audio_pathname,{token:token(),access:'private',useCache:false,abortSignal:AbortSignal.timeout(budget)});
 if(response?.statusCode!==200||!response.stream)fail('manual_video_audio_missing','The original audio upload is unavailable.');
 const chunks=[];let size=0;for await(const chunk of response.stream){size+=chunk.length;if(size>Number(row.audio_bytes)||size>209715200)fail('manual_video_audio_mismatch','The original audio differs from the transcript source.');chunks.push(Buffer.from(chunk));}
 const buffer=Buffer.concat(chunks);if(size!==Number(row.audio_bytes)||crypto.createHash('sha256').update(buffer).digest('hex')!==row.audio_sha256)fail('manual_video_audio_mismatch','Choose the exact original audio used for this transcript.');return buffer;
}
export async function cleanupManualVideoAudio(d={store:manualVideoPairStore}){try{return await d.store.cleanup(async path=>{if(!privatePath(path))throw new Error('invalid_manual_video_cleanup_path');await del(path,{token:token(),abortSignal:AbortSignal.timeout(15000)});});}catch(e){if(e?.code==='42P01')return {skipped:'schema_not_ready',cleaned:0};throw e;}}
