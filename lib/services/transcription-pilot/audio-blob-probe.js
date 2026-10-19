/** Provider-free operator probe: Preview-only, explicit opt-in, isolated private store.
 * Generates only repository synthetic AAC, creates no jobs, and deletes exact owned paths.
 */
import crypto from 'node:crypto';
import { cancelAudioBody } from './audio-read.js';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { get } from '@vercel/blob';
import { inspectOwnerInput, writePrivateContent, deletePrivatePath, confirmPrivatePathAbsent } from './runtime';

const SCENARIOS = Object.freeze({ small: [1], large: [199], concurrent: [199, 199], corrupt: [1] });
const fail = code => { throw Object.assign(new Error(code), { code }); };

export function audioBlobProbeEnabled(env = process.env) {
  const store = env.TRANSCRIPTION_AUDIO_BLOB_PROBE_STORE_ID;
  return env.VERCEL_ENV === 'preview' && env.TRANSCRIPTION_AUDIO_BLOB_PROBE_ENABLED === 'on'
    && env.TRANSCRIPTION_PILOT_ENABLED === 'false' && env.TRANSCRIPTION_SUBMISSIONS_ENABLED === 'false'
    && !env.ASSEMBLYAI_API_KEY
    && typeof store === 'string' && /^[A-Za-z0-9]{16}$/.test(store)
    && env.UPLOADS_BLOB_RW_TOKEN?.startsWith(`vercel_blob_rw_${store}_`) === true;
}

function syntheticAudio(seed, mib) {
  const size = mib * 1024 * 1024;
  let moov = -1;
  for (let i = 0; i + 8 <= seed.length;) {
    const n = seed.readUInt32BE(i);
    if (n < 8 || i + n > seed.length) fail('probe_fixture_invalid');
    if (seed.toString('ascii', i + 4, i + 8) === 'moov') { moov = i; break; }
    i += n;
  }
  if (moov < 0 || size < seed.length + 8) fail('probe_fixture_invalid');
  const output = Buffer.alloc(size, 0x5a);
  seed.copy(output, 0, 0, moov);
  const freeSize = size - seed.length;
  output.writeUInt32BE(freeSize, moov); output.write('free', moov + 4);
  seed.copy(output, moov + freeSize, moov);
  return output;
}

export async function runSyntheticAudioBlobProbe(scenario) {
  if (!audioBlobProbeEnabled()) fail('audio_blob_probe_disabled');
  if (!Object.hasOwn(SCENARIOS, scenario)) fail('audio_blob_probe_invalid');
  const seed = await readFile(path.join(process.cwd(), 'tests/fixtures/transcription/synthetic-aac.m4a'));
  const deadline = Date.now() + 240_000;
  const peak = { rss: 0, external: 0, arrayBuffers: 0 };
  const sample = () => {
    const memory = process.memoryUsage();
    for (const key of Object.keys(peak)) peak[key] = Math.max(peak[key], memory[key]);
  };
  sample(); const before = process.memoryUsage(); const started = Date.now();
  const timer = setInterval(sample, 10);
  try {
    // allSettled ensures one failed operation cannot return before sibling cleanup.
    const results = await Promise.allSettled(SCENARIOS[scenario].map(async mib => {
      const pathname = `transcription-pilot/preflight/audio-memory/${crypto.randomUUID()}/synthetic-aac.m4a`;
      let audio = syntheticAudio(seed, mib);
      const expectedSha256 = crypto.createHash('sha256').update(audio).digest('hex');
      const expectedBytes = audio.length;
      if (scenario === 'corrupt') audio[audio.length - 1] ^= 1;
      let putReceived = false;
      let mayOwnPath = false;
      try {
        if (!await confirmPrivatePathAbsent(pathname, Math.min(deadline, Date.now() + 15_000))) fail('probe_path_exists');
        mayOwnPath = true;
        console.info('[audio-blob-probe] owned synthetic path:', pathname);
        await writePrivateContent(pathname, 'audio/mp4', audio, Math.min(deadline, Date.now() + 90_000));
        putReceived = true;
        audio = null; // Match import ownership: release input before private Blob reread.
        // Inspect real SDK headers separately, without retaining/consuming a second body.
        const metadata = await get(pathname, { access: 'private', token: process.env.UPLOADS_BLOB_RW_TOKEN,
          useCache: false, abortSignal: AbortSignal.timeout(15_000) });
        const header = metadata?.headers?.get('content-length');
        const encoding = metadata?.headers?.get('content-encoding');
        await cancelAudioBody(metadata?.stream);
        if (metadata?.statusCode !== 200 || header !== String(expectedBytes) || (encoding && encoding !== 'identity')) fail('probe_length_header_invalid');
        try {
          const inspected = await inspectOwnerInput({ audio_pathname: pathname, verified_bytes: expectedBytes,
            audio_sha256: expectedSha256, audio_etag: null }, deadline);
          if (scenario === 'corrupt') fail('probe_integrity_guard_missing');
          sample();
          return { bytes: expectedBytes, headerMatched: true,
            sha256: crypto.createHash('sha256').update(inspected.buffer).digest('hex'),
            container: inspected.metadata.container, durationSeconds: inspected.metadata.durationSeconds,
            integrityRejected: false };
        } catch (error) {
          if (scenario !== 'corrupt' || error.code !== 'audio_integrity_mismatch') throw error;
          return { bytes: expectedBytes, headerMatched: true, integrityRejected: true };
        }
      } finally {
        audio = null;
        if (mayOwnPath) {
          try {
            await deletePrivatePath(pathname, Date.now() + 15_000);
            if (!await confirmPrivatePathAbsent(pathname, Date.now() + 15_000) || !putReceived) fail('probe_cleanup_unverified');
            console.info('[audio-blob-probe] deleted synthetic path:', pathname);
          } catch (error) {
            // Includes DELETE/absence-check transport failures and late-PUT uncertainty.
            console.error('[audio-blob-probe] unconfirmed cleanup:', pathname);
            throw error;
          }
        }
      }
    }));
    const failed = results.find(r => r.status === 'rejected');
    if (failed) throw failed.reason;
    sample();
    return { ok: true, scenario, runtime: process.version, region: process.env.VERCEL_REGION || null,
      sourceCommit: process.env.VERCEL_GIT_COMMIT_SHA || null, elapsedMs: Date.now() - started,
      samples: results.map(r => r.value), cleanupVerified: true, before, sampledPeak: peak,
      processMaxRssBytes: process.resourceUsage().maxRSS * 1024, providerCalls: 0, jobsCreated: 0 };
  } finally { clearInterval(timer); }
}
