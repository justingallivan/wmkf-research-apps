/** @jest-environment node */
jest.mock('node:fs/promises', () => ({ readFile: jest.fn() }));
jest.mock('@vercel/blob', () => ({ get: jest.fn() }));
jest.mock('../../lib/services/transcription-pilot/runtime', () => ({ inspectOwnerInput: jest.fn(), writePrivateContent: jest.fn(), deletePrivatePath: jest.fn(), confirmPrivatePathAbsent: jest.fn() }));
import fs from 'node:fs';
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { get } from '@vercel/blob';
import * as runtime from '../../lib/services/transcription-pilot/runtime';
import { audioBlobProbeEnabled, runSyntheticAudioBlobProbe } from '../../lib/services/transcription-pilot/audio-blob-probe';

const safe={VERCEL_ENV:'preview',TRANSCRIPTION_AUDIO_BLOB_PROBE_ENABLED:'on',TRANSCRIPTION_PILOT_ENABLED:'false',TRANSCRIPTION_SUBMISSIONS_ENABLED:'false',TRANSCRIPTION_AUDIO_BLOB_PROBE_STORE_ID:'1234567890abcdef',UPLOADS_BLOB_RW_TOKEN:'vercel_blob_rw_1234567890abcdef_synthetic'};
let saved;
beforeEach(()=>{
 saved={...process.env}; Object.assign(process.env,safe);delete process.env.ASSEMBLYAI_API_KEY;jest.resetAllMocks();
 readFile.mockResolvedValue(fs.readFileSync('tests/fixtures/transcription/synthetic-aac.m4a'));
 runtime.confirmPrivatePathAbsent.mockResolvedValue(true);
});
afterEach(()=>{process.env=saved;});

test.each([{VERCEL_ENV:'production'},{VERCEL_ENV:'development'},{TRANSCRIPTION_AUDIO_BLOB_PROBE_ENABLED:'off'},
 {TRANSCRIPTION_SUBMISSIONS_ENABLED:'true'},{TRANSCRIPTION_PILOT_ENABLED:'true'},
 {ASSEMBLYAI_API_KEY:'present'},{UPLOADS_BLOB_RW_TOKEN:'vercel_blob_rw_wrong_store'},
 {TRANSCRIPTION_AUDIO_BLOB_PROBE_STORE_ID:'bad'}])('refuses unsafe target %p before files or storage',async over=>{
 Object.assign(process.env,over);expect(audioBlobProbeEnabled()).toBe(false);
 await expect(runSyntheticAudioBlobProbe('small')).rejects.toMatchObject({code:'audio_blob_probe_disabled'});
 expect(readFile).not.toHaveBeenCalled();expect(runtime.writePrivateContent).not.toHaveBeenCalled();
});
test('caller cannot choose a size, pathname or scenario',async()=>{
 await expect(runSyntheticAudioBlobProbe('https://evil.example/audio')).rejects.toMatchObject({code:'audio_blob_probe_invalid'});
 expect(readFile).not.toHaveBeenCalled();
});
test.each(['small','corrupt'])('real synthetic AAC padding, hash verification and exact cleanup (%s)',async scenario=>{
 let bytes;
 runtime.writePrivateContent.mockImplementation(async(_p,_t,b)=>{bytes=Buffer.from(b);});
 get.mockImplementation(async()=>({statusCode:200,headers:new Headers({'content-length':String(bytes.length)}),stream:new ReadableStream({start(c){c.close();}})}));
 runtime.inspectOwnerInput.mockImplementation(async row=>{
  expect(row.audio_pathname).toMatch(/^transcription-pilot\/preflight\/audio-memory\/[a-f0-9-]+\/synthetic-aac.m4a$/);
  const actual=crypto.createHash('sha256').update(bytes).digest('hex');
  if(actual!==row.audio_sha256)throw Object.assign(new Error('audio_integrity_mismatch'),{code:'audio_integrity_mismatch'});
  return {buffer:bytes,metadata:{container:'M4A',durationSeconds:3.065}};
 });
 const proof=await runSyntheticAudioBlobProbe(scenario);
 expect(proof).toMatchObject({ok:true,providerCalls:0,jobsCreated:0,cleanupVerified:true});
 expect(proof.samples[0]).toMatchObject({bytes:1048576,headerMatched:true,integrityRejected:scenario==='corrupt'});
 const pathname=runtime.writePrivateContent.mock.calls[0][0];
 expect(runtime.deletePrivatePath).toHaveBeenCalledWith(pathname,expect.any(Number));
 expect(runtime.confirmPrivatePathAbsent).toHaveBeenNthCalledWith(2,pathname,expect.any(Number));
});
test('a failed write still deletes its owned path and reports uncertain completion',async()=>{
 runtime.writePrivateContent.mockRejectedValue(new Error('write timeout'));
 await expect(runSyntheticAudioBlobProbe('small')).rejects.toMatchObject({code:'probe_cleanup_unverified'});
 expect(runtime.deletePrivatePath).toHaveBeenCalledTimes(1);
});

test('a failed deletion retains the exact opaque recovery target and cannot report success',async()=>{
 runtime.writePrivateContent.mockRejectedValue(new Error('write failed'));
 runtime.deletePrivatePath.mockRejectedValue(new Error('delete failed'));
 const log=jest.spyOn(console,'error').mockImplementation(()=>{});
 try {
  await expect(runSyntheticAudioBlobProbe('small')).rejects.toThrow('delete failed');
  expect(log).toHaveBeenCalledWith('[audio-blob-probe] unconfirmed cleanup:',runtime.writePrivateContent.mock.calls[0][0]);
 }finally{log.mockRestore();}
});
