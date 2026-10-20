jest.mock('../../lib/utils/cron-auth', () => ({ verifyTranscriptionCronSecret: jest.fn() }));
jest.mock('../../lib/services/transcription-pilot/preflight', () => ({ runTranscriptionPreflight: jest.fn() }));
jest.mock('../../lib/services/alert-service', () => ({ __esModule: true, default: {} }));
jest.mock('../../lib/services/notification-service', () => ({ __esModule: true, default: {} }));
jest.mock('../../lib/dataverse/core/context', () => ({ withDalContext: (_n, fn) => fn() }));
jest.mock('../../lib/services/transcription-pilot/audio-blob-probe', () => ({ audioBlobProbeEnabled: jest.fn(), runSyntheticAudioBlobProbe: jest.fn() }));
import { verifyTranscriptionCronSecret } from '../../lib/utils/cron-auth';
import { runTranscriptionPreflight } from '../../lib/services/transcription-pilot/preflight';
import { audioBlobProbeEnabled, runSyntheticAudioBlobProbe } from '../../lib/services/transcription-pilot/audio-blob-probe';
import handler from '../../pages/api/cron/drain-transcriptions';
const response=()=>({setHeader:jest.fn(),status(n){this.code=n;return this;},json(b){this.body=b;return this;}});
beforeEach(()=>{jest.resetAllMocks();verifyTranscriptionCronSecret.mockReturnValue(true);audioBlobProbeEnabled.mockReturnValue(true);});
test('strict cron auth precedes probe gate or Blob operations',async()=>{
 verifyTranscriptionCronSecret.mockReturnValue(false);await handler({method:'POST',query:{audio_blob_probe:'large'}},response());
 expect(audioBlobProbeEnabled).not.toHaveBeenCalled();expect(runSyntheticAudioBlobProbe).not.toHaveBeenCalled();
});
test('disabled probe is unavailable and never runs preflight or storage',async()=>{
 audioBlobProbeEnabled.mockReturnValue(false);const res=response();await handler({method:'POST',query:{audio_blob_probe:'large'}},res);
 expect(res.code).toBe(404);expect(runSyntheticAudioBlobProbe).not.toHaveBeenCalled();expect(runTranscriptionPreflight).not.toHaveBeenCalled();
});
test.each([
 {method:'GET',query:{audio_blob_probe:'large'}},
 {method:'POST',query:{audio_blob_probe:'large',recovery:'1'}},
 {method:'POST',query:{audio_blob_probe:['large']}},
 {method:'POST',query:{audio_blob_probe:'arbitrary'}},
])('rejects unsupported method/query without storage: %p',async req=>{
 const res=response();await handler(req,res);expect(res.code).toBe(400);expect(runSyntheticAudioBlobProbe).not.toHaveBeenCalled();
});
test('only the fixed synthetic scenario is passed; no preflight/job drain runs',async()=>{
 runSyntheticAudioBlobProbe.mockResolvedValue({ok:true});const res=response();await handler({method:'POST',query:{audio_blob_probe:'corrupt'},body:{pathname:'evil',bytes:'evil'}},res);
 expect(runSyntheticAudioBlobProbe).toHaveBeenCalledWith('corrupt');expect(runTranscriptionPreflight).not.toHaveBeenCalled();expect(res.code).toBe(200);
});
test('SDK failures cannot leak credentials or content into the response',async()=>{
 runSyntheticAudioBlobProbe.mockRejectedValue(new Error('SECRET_URL_AND_TOKEN'));const res=response();await handler({method:'POST',query:{audio_blob_probe:'small'}},res);
 expect(res.code).toBe(502);expect(res.body).toEqual({ok:false,code:'audio_blob_probe_failed'});
});
