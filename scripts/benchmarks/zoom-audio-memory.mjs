#!/usr/bin/env node
/**
 * Synthetic, local-only comparison. No .env loading, credentials, real provider,
 * database, deployment or runtime edits. Baseline calls current runtime/import
 * functions with storage/policy/store edges replaced. Candidate source rewrites
 * exist only in the child module loader; they are experiments, not fixes.
 * Usage: node scripts/benchmarks/zoom-audio-memory.mjs [--quick] [--repeats 2]
 * Output: JSON at --output PATH (default /tmp/zoom-audio-memory-results.json).
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { fork, execFileSync } from 'node:child_process';
import { createReadStream, readFileSync, statSync } from 'node:fs';
import { mkdtemp, open, rm, writeFile, statfs } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import http from 'node:http';
import '../../scripts/lib/use-extensionless.mjs';

const SCRIPT = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(SCRIPT), '../..');
const MIB = 1024 * 1024, CAP = 200 * MIB;
const ID = '11111111-1111-4111-8111-111111111111';
const VISIT = '22222222-2222-4222-8222-222222222222';
const OWNER = 42;
const audioPath = `transcription-pilot/${OWNER}/${ID}/input/audio.mp3`;
const arg = (key, fallback) => { const i = process.argv.indexOf(key); return i < 0 ? fallback : process.argv[i + 1]; };
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
async function fileHash(filename) { const h = crypto.createHash('sha256'); for await (const b of createReadStream(filename)) h.update(b); return h.digest('hex'); }
function sample(c) {
  const m = process.memoryUsage();
  for (const key of ['rss', 'heapUsed', 'external', 'arrayBuffers']) c.peak[key] = Math.max(c.peak[key] || 0, m[key]);
  // getrusage catches synchronous-copy peaks that a JS timer cannot sample.
  c.maxRSS = process.resourceUsage().maxRSS * 1024;
}
async function* chunks(filename, slow = false) {
  for await (const b of createReadStream(filename, { highWaterMark: 64 * 1024 })) {
    if (slow) await new Promise(r => setTimeout(r, 1));
    yield b;
  }
}
async function* source(c) {
  let count = 0;
  for await (let b of chunks(c.filename, c.slowSource)) {
    count += b.length;
    if (c.corruptLastByte && count === c.size) { b = Buffer.from(b); b[b.length - 1] ^= 1; c.mutated = true; }
    yield b;
  }
}
async function preallocate(stream, expected, max = CAP) {
  assert(expected > 0 && expected <= max);
  const output = Buffer.allocUnsafe(expected); let length = 0;
  for await (const chunk of stream) {
    length += chunk.length;
    assert(length <= expected && length <= max, 'length_overflow');
    output.set(chunk, length - chunk.length);
  }
  assert.equal(length, expected, 'length_underflow');
  return output;
}
async function inspectCandidate(input, validate) {
  let worker;
  const result = await new Promise((resolve, reject) => {
    worker = new Worker(path.join(ROOT, 'scripts/benchmarks/zoom-audio-inspector-worker.cjs'), {
      workerData: typeof input === 'string' ? { filename: input }
        : { audioBuffer: input.buffer, __turbopack_globals__: {} },
      transferList: typeof input === 'string' ? [] : [input.buffer],
      resourceLimits: { maxOldGenerationSizeMb: 96, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 },
    });
    const timer = setTimeout(() => { worker.terminate().catch(() => {}); reject(Error('inspection_timeout')); }, 10000);
    worker.once('message', value => { clearTimeout(timer); value.error ? reject(Error(value.error)) : resolve(value); });
    worker.once('error', e => { clearTimeout(timer); reject(e); });
    worker.once('exit', code => { clearTimeout(timer); if (code) reject(Error(`worker_exit_${code}`)); });
  }).finally(async () => { await worker?.terminate(); });
  return { metadata: validate(result.format), buffer: result.audioBuffer ? Buffer.from(result.audioBuffer) : null };
}

async function fixture(dir, format, mib) {
  const filename = path.join(dir, `${format}-${mib}`);
  const f = await open(filename, 'wx', 0o600);
  try {
    if (format === 'mp3') {
      const frame = Buffer.alloc(417); Buffer.from([0xff, 0xfb, 0x90, 0x64]).copy(frame);
      const block = Buffer.alloc(417 * 2048);
      for (let i = 0; i < block.length; i += 417) frame.copy(block, i);
      let remaining = Math.floor(mib * MIB / 417) * 417;
      while (remaining) { const n = Math.min(block.length, remaining); await f.write(block.subarray(0, n)); remaining -= n; }
    } else {
      const seed = readFileSync(path.join(ROOT, 'tests/fixtures/transcription/synthetic-aac.m4a'));
      let moov = -1;
      for (let i = 0; i < seed.length;) { const n = seed.readUInt32BE(i); assert(n >= 8); if (seed.toString('ascii', i + 4, i + 8) === 'moov') { moov = i; break; } i += n; }
      assert(moov >= 0);
      // Valid three-second AAC plus inert free-box padding before moov. This
      // tests late metadata/byte size, NOT a 200 MiB decoded AAC recording.
      const freeSize = mib * MIB - seed.length;
      const header = Buffer.alloc(8); header.writeUInt32BE(freeSize); header.write('free', 4);
      await f.write(seed.subarray(0, moov)); await f.write(header);
      const block = Buffer.alloc(1024 * 1024, 0x5a); let left = freeSize - 8;
      while (left) { const n = Math.min(left, block.length); await f.write(block.subarray(0, n)); left -= n; }
      await f.write(seed.subarray(moov));
    }
  } finally { await f.close(); }
  return { filename, format, mib, bytes: statSync(filename).size, sha256: await fileHash(filename) };
}

function installEdges(c) {
  const stubs = new Map();
  const runtimeFile = path.join(ROOT, 'lib/services/transcription-pilot/runtime.js');
  const importFile = path.join(ROOT, 'lib/services/meeting-tracker-recordings/import-service.js');
  const stubSpecs = new Map([
    [runtimeFile, new Set(['@vercel/blob', '@vercel/blob/client', './crypto', './model', './store'])],
    [importFile, new Set(['../meeting-tracker-transcription/binding.js', '../meeting-tracker-transcription/service.js',
      '../transcription-pilot/store.js', '../../utils/zoom-video-copy-access.js', './video-copy-store.js', './import-store.js'])],
  ]);
  for (const [parent, specs] of stubSpecs) {
    const source = readFileSync(parent, 'utf8');
    for (const match of source.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g)) {
      if (!specs.has(match[2])) continue;
      const names = match[1].split(',').map(n => n.trim()).filter(Boolean);
      const url = `audio-bench:${parent}:${match[2]}`;
      stubs.set(url, names.map(name => name === 'FALLBACK_FAILURE_CODE' ? `export const ${name}='zoom_import_failed';`
        : `export const ${name}=(...a)=>globalThis.__audioBench.api.${name}(...a);`).join('\n'));
    }
  }
  registerHooks({
    resolve(specifier, context, next) {
      const parent = context.parentURL?.startsWith('file:') ? fileURLToPath(context.parentURL) : '';
      const url = `audio-bench:${parent}:${specifier}`;
      if (stubs.has(url)) return { url, format: 'module', shortCircuit: true };
      return next(specifier, context);
    },
    load(url, context, next) {
      if (stubs.has(url)) return { format: 'module', source: stubs.get(url), shortCircuit: true };
      if (url === pathToFileURL(runtimeFile).href && ['prealloc', 'stream', 'transfer'].includes(c.mode)) {
        let source = readFileSync(runtimeFile, 'utf8');
        for (const [name, prefix] of [['readPrivateBlob', 'async function'], ['readPrivateContentIfPresent', 'export async function']]) {
          const start = source.indexOf(`${prefix} ${name}(`);
          const end = source.indexOf('\nexport async function', start + 1);
          assert(start >= 0 && end > start);
          source = source.slice(0, start) + `${prefix} ${name}(pathname,maxBytes=209715200){return globalThis.__audioBench.read(pathname,maxBytes);}\n` + source.slice(end);
        }
        if (c.mode === 'transfer') {
          source = source.replaceAll('const { buffer, blob } =', 'let { buffer, blob } =');
          source = source.replaceAll('const metadata = await inspectAudioBuffer(buffer);',
            'const moved = await globalThis.__audioBench.inspect(buffer); buffer = moved.buffer; const metadata = moved.metadata;');
          source = source.replace('return { buffer, blob, metadata: await inspectAudioBuffer(buffer, { timeoutMs }) };',
            'const moved = await globalThis.__audioBench.inspect(buffer); return { buffer:moved.buffer, blob, metadata:moved.metadata };');
        }
        return { source, format: 'module', shortCircuit: true };
      }
      if (url === pathToFileURL(importFile).href && ['drop', 'prealloc', 'transfer'].includes(c.mode)) {
        let source = readFileSync(importFile, 'utf8').replace('const audioBytes = await', 'let audioBytes = await');
        source = source.replace('started = await startMeetingTranscription(', 'audioBytes = null;\n    started = await startMeetingTranscription(');
        return { source, format: 'module', shortCircuit: true };
      }
      if (url.endsWith('/meeting-tracker-recordings/zoom-client.js') && ['prealloc', 'transfer'].includes(c.mode)) {
        let source = readFileSync(fileURLToPath(url), 'utf8');
        const start = source.indexOf('async function readBounded('), end = source.indexOf('\n/**', start);
        source = source.slice(0, start) + 'async function readBounded(res,maxBytes){return globalThis.__audioBench.preallocate(res.body,globalThis.__audioBench.size,maxBytes);}\n' + source.slice(end);
        return { source, format: 'module', shortCircuit: true };
      }
      return next(url, context);
    },
  });
}

async function scenario(config) {
  const c = globalThis.__audioBench = { ...config, size: config.bytes, api: {}, peak: {}, stages: {}, wire: [], bytesSent: 0 };
  const dir = await mkdtemp(path.join(os.tmpdir(), 'audio-case-'));
  const nativeFetch = globalThis.fetch;
  let sink;
  try {
    installEdges(c);
    process.env.TRANSCRIPTION_PILOT_ENABLED = 'true'; process.env.TRANSCRIPTION_SUBMISSIONS_ENABLED = 'true';
    process.env.UPLOADS_BLOB_RW_TOKEN = 'synthetic-local-only'; process.env.ASSEMBLYAI_API_KEY = 'synthetic-local-only';
    process.env.MEETING_TRACKER_TRANSCRIPTION_ACCESS = 'on'; process.env.MEETING_TRACKER_TRANSCRIPTION_SCHEMA_READY = 'on';
    process.env.ZOOM_S2S_ACCOUNT_ID = 'synthetic'; process.env.ZOOM_S2S_CLIENT_ID = 'synthetic'; process.env.ZOOM_S2S_CLIENT_SECRET = 'synthetic';
    process.env.ZOOM_RECORDING_HOSTS = 'synthetic@example.invalid';
    let row = { id: ID, owner_profile_id: OWNER, status: 'uploading', version: 1,
      input_cleanup_pathname: audioPath, audio_pathname: audioPath, declared_bytes: c.size,
      declared_content_type: 'audio/mp4', verified_bytes: c.size, audio_sha256: c.sha256,
      audio_etag: 'synthetic-etag', expires_at: new Date(Date.now() + 3600000), options_snapshot: {} };
    const blob = pathname => ({ pathname, contentType: 'audio/mp4', etag: 'synthetic-etag' });
    c.api.get = async pathname => ({ statusCode: 200, stream: Readable.toWeb(Readable.from(source(c))), blob: blob(pathname) });
    c.api.put = async (pathname, body) => { assert.equal(hash(body), c.sha256); return blob(pathname); };
    c.api.generateClientTokenFromReadWriteToken = async () => 'synthetic-token';
    c.api.projectOwnerTranscriptionJob = r => r;
    c.api.getOwnerTranscriptionJob = c.api.getMeetingTranscriptionJob = async () => row;
    c.api.createMeetingTranscriptionJob = async a => { row = { ...row, id: a.id, input_cleanup_pathname: a.inputPathname }; return { job: row, created: true }; };
    c.api.reserveMeetingTranscriptionUploadWindow = async () => (row = { ...row, version: 2 });
    c.api.queueMeetingTranscriptionJob = c.api.queueTranscriptionJob = async a => {
      assert.equal(a.sha256, c.sha256); assert.equal(a.verifiedBytes, c.size); assert(a.durationMs > 0 && a.durationMs <= 14400000);
      c.queueDigest = a.sha256; c.durationMs = a.durationMs; return (row = { ...row, ...a, status: 'queued' });
    };
    c.api.loadMeetingTranscriptionBinding = async () => ({ requestId: ID, siteVisitActivityId: VISIT });
    c.api.claimZoomImport = async () => ({ id: VISIT, state: 'importing', lease_token: ID });
    c.api.captureZoomImportFiles = async a => { assert.equal(a.capture.audioFile.sha256, c.sha256); return true; };
    c.api.markZoomImportStarted = async () => ({ id: VISIT, state: 'started' });
    c.preallocate = preallocate;
    c.read = async (pathname, maxBytes) => ({ buffer: await preallocate(source(c), c.size, maxBytes), blob: blob(pathname) });
    const runtime = await import(pathToFileURL(path.join(ROOT, 'lib/services/transcription-pilot/runtime.js')));
    const media = await import(pathToFileURL(path.join(ROOT, 'lib/services/transcription-pilot/media-inspector.js')));
    c.inspect = async input => { const result = await inspectCandidate(input, media.validateAudioMetadata); c.durationMs = Math.round(result.metadata.durationSeconds * 1000); return result; };
    const provider = await import(pathToFileURL(path.join(ROOT, 'lib/services/transcription-pilot/provider.js')));
    const meetingArgs = { ownerProfileId: OWNER, requestId: ID, siteVisitActivityId: VISIT, jobId: ID, expectedVersion: 1, acknowledged: true };
    const meeting = { uuid: 'synthetic-occurrence', host_id: 'synthetic-host', start_time: '2026-10-19T12:00:00.000Z', recording_files: [
      { id: 'synthetic-audio', status: 'completed', recording_type: 'audio_only', file_extension: 'M4A', file_size: c.size,
        download_url: 'https://synthetic.zoom.us/audio', recording_start: '2026-10-19T12:00:00.000Z', recording_end: '2026-10-19T13:00:00.000Z' }] };
    // Receiver runs separately so its parser/socket buffers are not counted as
    // application sender memory. Its hash/count are returned on the actual wire.
    sink = fork(SCRIPT, ['--sink', JSON.stringify({ bytes: c.size, sha256: c.sha256, slow: c.slowSink })], {
      cwd: ROOT, env: { PATH: process.env.PATH, TMPDIR: os.tmpdir(), LANG: 'C' },
      stdio: ['ignore', 'ignore', 'inherit', 'ipc'], execArgv: ['--no-warnings'],
    });
    const port = await new Promise((resolve, reject) => { sink.once('message', m => resolve(m.port)); sink.once('error', reject); sink.once('exit', code => reject(Error(`sink_exit_${code}`))); });
    const sinkUrl = `http://127.0.0.1:${port}/upload`;
    async function send(init) {
      c.uploadRequests = (c.uploadRequests || 0) + 1;
      const res = await nativeFetch(sinkUrl, init);
      const receipt = await res.clone().json();
      assert.equal(receipt.receivedBytes, c.size); assert.equal(receipt.sha256, c.sha256);
      c.bytesSent += receipt.receivedBytes; c.bytesReceived = receipt.receivedBytes; c.wire.push(receipt.wire);
      return res;
    }
    globalThis.fetch = async (url, init) => {
      const u = new URL(url);
      if (u.hostname === 'api.assemblyai.com') return send(init);
      if (u.hostname === 'zoom.us') return Response.json({ access_token: 'synthetic', expires_in: 3600 });
      if (u.hostname === 'api.zoom.us') return Response.json(u.pathname.includes('/users/') ? { meetings: [meeting], next_page_token: '' } : meeting);
      if (u.hostname === 'synthetic.zoom.us') return new Response(Readable.toWeb(Readable.from(chunks(c.filename, c.slowSource))), { headers: { 'content-type': 'audio/mp4', 'content-length': String(c.size) } });
      throw Error('external_network_blocked');
    };
    async function spoolQueue() {
      const filename = path.join(dir, 'audio'); let count = 0; const h = crypto.createHash('sha256');
      await pipeline(Readable.from(source(c)), new Transform({ transform(b, _, cb) {
        count += b.length; if (count > c.size || count > CAP) return cb(Error('length_overflow'));
        h.update(b); cb(null, b);
      } }), (await import('node:fs')).createWriteStream(filename, { flags: 'wx', mode: 0o600 }));
      c.scratchBytes = count; assert.equal(count, c.size); assert.equal(h.digest('hex'), c.sha256);
      const inspected = await c.inspect(filename);
      return { filename, metadata: inspected.metadata };
    }
    c.api.uploadMeetingTranscription = a => runtime.createMeetingTranscriptionUpload({ ...meetingArgs, body: a.body });
    c.api.startMeetingTranscription = async a => {
      if (c.mode === 'spool') { const f = await spoolQueue(); await rm(f.filename); return { job: { ...row, status: 'queued' } }; }
      return { job: await runtime.queueMeetingTranscription({ ...meetingArgs, jobId: a.jobId, expectedVersion: row.version }) };
    };
    const importer = await import(pathToFileURL(path.join(ROOT, 'lib/services/meeting-tracker-recordings/import-service.js')));
    // Imports/warmup are outside timed region, identical per case. Fixture bytes
    // are generated by the parent, never preallocated in the measured child.
    global.gc?.(); c.before = process.memoryUsage(); sample(c); const start = performance.now();
    const timer = setInterval(() => sample(c), 5);
    try {
      if (c.flow === 'zoom') {
        await importer.importZoomRecording({ requestId: ID, ownerProfileId: OWNER, actingUserSystemId: ID, meetingUuid: meeting.uuid, acknowledged: true });
      } else if (c.mode === 'spool') {
        const f = await spoolQueue();
        if (c.flow === 'submit') {
          const stream = createReadStream(f.filename, { highWaterMark: 64 * 1024 });
          try { const res = await send({ method: 'POST', body: stream, duplex: 'half', headers: { 'content-length': String(c.size) } }); assert(res.ok); await res.json(); }
          finally { stream.destroy(); }
        }
        await rm(f.filename);
      } else if (c.flow === 'submit') {
        const result = await runtime.inspectOwnerInput(row, Date.now() + 90000); c.durationMs = Math.round(result.metadata.durationSeconds * 1000); sample(c);
        if (['stream', 'transfer'].includes(c.mode)) {
          async function* body() { for (let i = 0; i < result.buffer.length; i += 65536) yield result.buffer.subarray(i, i + 65536); }
          const res = await send({ method: 'POST', body: body(), duplex: 'half', headers: { 'content-length': String(c.size) } }); assert(res.ok); await res.json();
        } else await provider.uploadAssemblyAIAudio({ region: 'us', audio: result.buffer, contentType: 'audio/mp4' });
      } else if (c.flow === 'owner') await runtime.validateAndQueueOwnerJob({ ownerProfileId: OWNER, jobId: ID, expectedVersion: 1, acknowledged: true });
      else await runtime.queueMeetingTranscription(meetingArgs);
    } finally { sample(c); clearInterval(timer); }
    assert.equal(c.bytesSent, c.flow === 'submit' ? c.size : 0);
    const result = { mode: c.mode, flow: c.flow, format: c.format, mib: c.mib, bytes: c.size, repeat: c.repeat,
      elapsedMs: performance.now() - start, before: c.before, sampledPeak: c.peak, processMaxRSS: c.maxRSS,
      bytesSent: c.bytesSent, wire: c.wire, scratchBytes: c.scratchBytes || 0, slowSource: !!c.slowSource, slowSink: !!c.slowSink,
      integrity: 'passed', durationMs: c.durationMs, runtime: process.version };
    process.send?.(result);
  } catch (error) {
    if (!c.corruptLastByte) throw error;
    assert.equal(c.mutated, true, 'control_did_not_reach_last_byte');
    assert.equal(c.uploadRequests || 0, 0, 'upload_attempted_before_integrity_check');
    assert.equal(c.bytesReceived || 0, 0, 'unverified_bytes_sent');
    assert.equal(c.wire.length, 0, 'upload_started_before_integrity_check');
    process.send?.({ mode: c.mode, flow: c.flow, control: 'last_byte_mutation', rejected: true,
      error: error.code || error.message, bytesReceived: c.bytesReceived || 0, uploadRequests: c.wire.length });
  } finally {
    globalThis.fetch = nativeFetch;
    if (sink && sink.exitCode === null) await new Promise(r => { sink.once('exit', r); sink.kill('SIGTERM'); });
    await rm(dir, { recursive: true, force: true });
  }
}

async function child(config) {
  return new Promise((resolve, reject) => {
    const p = fork(SCRIPT, ['--child', JSON.stringify(config)], {
      execArgv: ['--expose-gc', '--no-warnings'], cwd: ROOT,
      env: { PATH: process.env.PATH, TMPDIR: os.tmpdir(), LANG: 'C' }, stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    });
    let result, err = ''; p.stderr.on('data', b => { err = (err + b).slice(-6000); });
    p.on('message', r => { result = r; });
    const timer = setTimeout(() => p.kill('SIGKILL'), 90000);
    p.on('exit', code => { clearTimeout(timer); code === 0 && result ? resolve(result) : reject(Error(`${config.mode}/${config.flow}: ${err || code}`)); });
  });
}

if (process.argv.includes('--sink')) {
  const config = JSON.parse(arg('--sink'));
  const server = http.createServer(async (req, res) => {
    try {
      const h = crypto.createHash('sha256'); let bytes = 0;
      const wire = { contentLength: req.headers['content-length'] || null, transferEncoding: req.headers['transfer-encoding'] || null };
      for await (const b of req) { bytes += b.length; h.update(b); if (config.slow) await new Promise(r => setTimeout(r, 1)); }
      const sha256 = h.digest('hex'); assert.equal(bytes, config.bytes); assert.equal(sha256, config.sha256);
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ upload_url: 'https://cdn.assemblyai.com/upload/synthetic', receivedBytes: bytes, sha256, wire }));
    } catch { res.destroy(); }
  });
  server.listen(0, '127.0.0.1', () => process.send({ port: server.address().port }));
} else if (process.argv.includes('--child')) {
  await scenario(JSON.parse(arg('--child')));
} else {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'audio-fixtures-'));
  const results = [], repeats = Number(arg('--repeats', '2'));
  assert(Number.isInteger(repeats) && repeats >= 1 && repeats <= 5);
  try {
    const quick = process.argv.includes('--quick');
    for (const mib of quick ? [4] : [40, 199]) for (const format of ['mp3', 'm4a-late']) {
      const f = await fixture(dir, format, mib);
      for (let repeat = 1; repeat <= repeats; repeat++) for (const flow of ['owner', 'meeting', 'zoom', 'submit']) {
        for (const mode of ['baseline', ...(flow === 'zoom' ? ['drop'] : []), 'prealloc', ...(flow === 'submit' ? ['stream'] : []), 'transfer', 'spool']) {
          const r = await child({ ...f, flow, mode, repeat }); results.push(r);
          console.log(`${format} ${mib}MiB ${flow}/${mode} #${repeat}: peak ${(r.processMaxRSS / MIB).toFixed(1)} MiB, ${(r.elapsedMs / 1000).toFixed(2)} s`);
        }
      }
    }
    if (!quick) {
      const f = await fixture(dir, 'mp3', 8);
      for (const mode of ['baseline', 'transfer', 'spool']) results.push(await child({ ...f, flow: 'submit', mode, repeat: 1, slowSource: true, slowSink: true }));
    }
    const controls = [];
    const controlFixture = await fixture(dir, 'mp3', 2);
    for (const mode of ['baseline', 'prealloc', 'stream', 'transfer', 'spool']) {
      const r = await child({ ...controlFixture, flow: 'submit', mode, repeat: 1, corruptLastByte: true });
      assert.equal(r.rejected, true); controls.push(r);
    }
    await assert.rejects(preallocate(Readable.from([Buffer.alloc(3)]), 2), /length_overflow/);
    await assert.rejects(preallocate(Readable.from([Buffer.alloc(1)]), 2), /length_underflow/);
    const output = { sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(),
      measuredAt: new Date().toISOString(), platform: `${os.platform()}/${os.arch()}`, runtime: process.version,
      fetchUndici: process.versions.undici,
      receiverIsolation: 'separate child process; receiver RSS excluded',
      tmpFilesystem: await statfs(os.tmpdir()), scope: 'Local synthetic source/storage mocks and loopback upload; no hosted/cloud/provider measurement.', results, controls };
    await writeFile(arg('--output', '/tmp/zoom-audio-memory-results.json'), JSON.stringify(output, null, 2) + '\n');
  } finally { await rm(dir, { recursive: true, force: true }); }
}
