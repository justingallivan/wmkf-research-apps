/** @jest-environment node */
/**
 * Runs the shipped Python cut recipe against tiny ffmpeg-generated fixtures (Stage 4 slice 3a).
 * Marker technique: presentation = light frame + 440 Hz tone, post-cut = red frame + 3 kHz tone,
 * switching exactly at the boundary, so any leaked post-cut content is visible in the output tail.
 */
import { spawn, spawnSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { CUT_SCRIPT_PY, CUT_SCRIPT_VERSION } from '@/lib/services/meeting-tracker-recordings/presentation-video-cut-script';

const have = (bin) => spawnSync(bin, [bin === 'python3' ? '--version' : '-version'], { stdio: 'ignore' }).status === 0;
const hasTools = have('ffmpeg') && have('ffprobe') && have('python3');
const d = hasTools ? describe : describe.skip;
if (!hasTools) {
  // eslint-disable-next-line no-console
  console.warn('presentation-video-cut-script tests skipped: ffmpeg, ffprobe and python3 must be on PATH');
}

jest.setTimeout(120000);

let root;
let scriptPath;
let n = 0;
const sandbox = (name) => {
  const dir = path.join(root, `${name}-${n++}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

function exec(cmd, args, env = {}) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (c) => { stdout += c; });
    p.stderr.on('data', (c) => { stderr += c; });
    p.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}
const ff = async (...args) => {
  const r = await exec('ffmpeg', ['-hide_banner', '-nostdin', '-y', '-loglevel', 'error', ...args]);
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr}`);
};
const script = (cmd, env, py = scriptPath) => exec('python3', [py, cmd], env);

const SR = 48000;
// Marker fixture: [0, priv) light + 440 Hz, [priv, dur) red + 3 kHz.
async function makeSource(out, { fps = 25, dur = 15, priv, vcodec = [], vf = '' }) {
  const red = `drawbox=x=0:y=0:w=320:h=180:c=red:t=fill:enable='gte(t,${priv})'`;
  const aud = `aevalsrc='if(lt(t,${priv}),0.3*sin(2*PI*440*t),0.3*sin(2*PI*3000*t))|if(lt(t,${priv}),0.3*sin(2*PI*440*t),0.3*sin(2*PI*3000*t))':s=${SR}:d=${dur}`;
  await ff('-f', 'lavfi', '-i', `color=c=0xf6f8fc:s=320x180:r=${fps}:d=${dur}`, '-f', 'lavfi', '-i', aud,
    '-vf', vf ? `${red},${vf}` : red, '-fps_mode', 'passthrough', '-c:v', 'libx264', '-preset', 'ultrafast', '-bf', '0',
    '-pix_fmt', 'yuv420p', '-g', '50', ...vcodec, '-c:a', 'aac', '-b:a', '64k', out);
}
const probeJson = (file, ...extra) => JSON.parse(spawnSync('ffprobe', ['-v', 'error', ...extra, '-of', 'json', file]).stdout.toString());
const streamTimes = (file) => Object.fromEntries(
  probeJson(file, '-show_streams').streams.map((s) => [s.codec_type, s.start_time]));

async function cut(src, cutMs, extra = {}, py = scriptPath) {
  const work = sandbox('work');
  const r = await script('cut', {
    SOURCE_PATH: src, SOURCE_SIZE: String(fs.statSync(src).size), CUT_MS: String(cutMs), WORK_DIR: work, ...extra,
  }, py);
  const receipt = JSON.parse(fs.readFileSync(path.join(work, 'receipt.json'), 'utf8'));
  return { ...r, work, receipt, outPath: path.join(work, 'presentation.mp4') };
}

function goertzel(samples, freq) {
  const k = 2 * Math.cos((2 * Math.PI * freq) / SR);
  let s1 = 0; let s2 = 0;
  for (const x of samples) { const s0 = x + k * s1 - s2; s2 = s1; s1 = s0; }
  return Math.sqrt(Math.max(s1 * s1 + s2 * s2 - k * s1 * s2, 0)) / Math.max(samples.length, 1);
}
// No post-cut marker in the tail of an accepted output: last frame not red, tail tone is not 3 kHz.
function assertCleanTail(file) {
  const rgb = spawnSync('ffmpeg', ['-hide_banner', '-nostdin', '-loglevel', 'error', '-sseof', '-0.2', '-i', file,
    '-frames:v', '1', '-vf', 'scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']).stdout;
  expect(rgb.length).toBeGreaterThanOrEqual(3);
  expect(rgb[1]).toBeGreaterThan(150); // light frame, not red (red has low green)
  const pcm = spawnSync('ffmpeg', ['-hide_banner', '-nostdin', '-loglevel', 'error', '-sseof', '-0.5', '-i', file,
    '-map', '0:a:0', '-ac', '1', '-f', 's16le', '-'], { maxBuffer: 1 << 26 }).stdout;
  const s = [];
  for (let i = 0; i + 1 < pcm.length; i += 2) s.push(pcm.readInt16LE(i) / 32768);
  expect(goertzel(s, 440)).toBeGreaterThan(goertzel(s, 3000) * 10);
}

// Independent QuickXorHash (reference cell algorithm: 64+64+32 bit cells, shift 11).
function quickXorReference(buf) {
  const widths = [64n, 64n, 32n];
  const cells = [0n, 0n, 0n];
  let shift = 0;
  for (const byte of buf) {
    const idx = Math.floor(shift / 64);
    const off = BigInt(shift % 64);
    const bits = widths[idx];
    const mask = (1n << bits) - 1n;
    const b = BigInt(byte);
    cells[idx] ^= (b << off) & mask;
    if (off > bits - 8n) {
      const next = idx + 1 === 3 ? 0 : idx + 1;
      cells[next] ^= (b >> (bits - off)) & ((1n << widths[next]) - 1n);
    }
    shift = (shift + 11) % 160;
  }
  const out = Buffer.alloc(20);
  out.writeBigUInt64LE(cells[0], 0);
  out.writeBigUInt64LE(cells[1], 8);
  out.writeUInt32LE(Number(cells[2]), 16);
  const len = Buffer.alloc(8);
  len.writeBigUInt64LE(BigInt(buf.length));
  for (let i = 0; i < 8; i += 1) out[12 + i] ^= len[i];
  return out.toString('base64');
}

d('presentation-video-cut-script', () => {
  let src25;
  let srcPlain;
  beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'cutscript-'));
    scriptPath = path.join(root, 'cut.py');
    fs.writeFileSync(scriptPath, CUT_SCRIPT_PY);
    src25 = path.join(root, 'src-12437.mp4');
    await makeSource(src25, { priv: 12.437 });
    srcPlain = path.join(root, 'src-10010.mp4');
    await makeSource(srcPlain, { priv: 10.01 });
  });
  afterAll(() => { fs.rmSync(bframeSrc, { force: true }); fs.rmSync(root, { recursive: true, force: true }); });

  const expectRejected = (r, code) => {
    expect(r.status).toBe(3);
    expect(r.receipt.ok).toBe(false);
    expect(r.receipt.code).toBe(code);
    expect(fs.existsSync(r.outPath)).toBe(false);
    expect(fs.existsSync(path.join(r.work, 'presentation.partial.mp4'))).toBe(false);
  };

  test('1. 25 fps cut at 12.437 s is accepted with 310 frames and a clean tail', async () => {
    const t0 = Date.now();
    const r = await cut(src25, 12437);
    expect(r.status).toBe(0);
    const c = r.receipt;
    expect(c).toMatchObject({ ok: true, code: 'ok', scriptVersion: CUT_SCRIPT_VERSION, cutMs: 12437, fps: '25/1',
      sampleRate: SR, channels: 2, framesKept: 310, samplesKept: Math.floor(12.437 * SR), audioPacketsEqual: true,
      lastKeptFrameEndMs: 12400, firstOmittedFrameEndMs: 12440 });
    expect(c.outputSize).toBe(fs.statSync(r.outPath).size);
    expect(c.outputSha256).toBe(crypto.createHash('sha256').update(fs.readFileSync(r.outPath)).digest('hex'));
    expect(c.outputQuickXorHash).toBe(quickXorReference(fs.readFileSync(r.outPath)));
    expect(Object.keys(c.timingsMs)).toEqual(expect.arrayContaining(['probe', 'audio', 'video', 'mux', 'accept']));
    // content-free: no paths in the receipt
    expect(JSON.stringify(c)).not.toContain(root);
    expect(probeJson(r.outPath, '-show_streams').streams.map((s) => s.codec_name).sort()).toEqual(['aac', 'h264']);
    assertCleanTail(r.outPath);
    // eslint-disable-next-line no-console
    console.log(`fixture 1 total ${Date.now() - t0} ms, script timings ${JSON.stringify(c.timingsMs)}`);
  });

  test('2. 25 fps cut at 10.010 s keeps 250 frames (first omitted frame straddles T)', async () => {
    const r = await cut(srcPlain, 10010);
    expect(r.status).toBe(0);
    expect(r.receipt).toMatchObject({ ok: true, framesKept: 250, lastKeptFrameEndMs: 10000, firstOmittedFrameEndMs: 10040 });
    assertCleanTail(r.outPath);
  });

  test('3. video start_time offset is rejected as unsupported_timeline', async () => {
    const out = path.join(root, 'vid-offset.mp4');
    await ff('-itsoffset', '0.5', '-i', src25, '-i', src25, '-map', '0:v', '-map', '1:a', '-c', 'copy', out);
    expect(Number(streamTimes(out).video)).toBeGreaterThan(0.4);
    expectRejected(await cut(out, 12437), 'unsupported_timeline');
  });

  test('4. audio start_time offset is rejected as unsupported_timeline', async () => {
    const out = path.join(root, 'aud-offset.mp4');
    await ff('-i', src25, '-itsoffset', '0.4', '-i', src25, '-map', '0:v', '-map', '1:a', '-c', 'copy', out);
    expect(Number(streamTimes(out).audio)).toBeGreaterThan(0.3);
    expectRejected(await cut(out, 12437), 'unsupported_timeline');
  });

  // Edit list: x264 B-frames make the mp4 muxer write an elst that hides the decoder delay, so the
  // ignore_editlist decode starts later than the normal decode (stream start_time still reads 0).
  const firstVideoPts = (file, extra) => JSON.parse(spawnSync('ffprobe', ['-v', 'error', ...extra, '-select_streams', 'v:0',
    '-show_entries', 'frame=pts', '-read_intervals', '%+#2', '-of', 'json', file]).stdout.toString()).frames[0].pts;
  const bframeSrc = path.join(os.tmpdir(), `cutscript-bf-${process.pid}.mp4`);
  test('5. B-frame codec-delay edit list is tolerated: accepted, tail clean, delay recorded', async () => {
    await makeSource(bframeSrc, { priv: 12.437, vcodec: ['-preset', 'veryfast', '-bf', '3', '-movflags', '+faststart'] });
    expect(firstVideoPts(bframeSrc, [])).not.toBe(firstVideoPts(bframeSrc, ['-ignore_editlist', '1']));
    const r = await cut(bframeSrc, 12437);
    expect(r.status).toBe(0);
    expect(r.receipt).toMatchObject({ ok: true, framesKept: 310 });
    expect(r.receipt.videoEditDelayMs).toBeGreaterThan(0);
    assertCleanTail(r.outPath);
  });

  test('5b. an edit list that shifts the presentation (start 1 s into the media) is rejected', async () => {
    const buf = fs.readFileSync(bframeSrc);
    const at = buf.indexOf('elst');
    expect(at).toBeGreaterThan(0);
    expect(buf[at + 4]).toBe(0); // version 0
    const mediaTimeOffset = at + 4 + 4 + 4 + 4; // type, version/flags, entry count, segment duration
    const shifted = Buffer.from(buf);
    shifted.writeInt32BE(shifted.readInt32BE(mediaTimeOffset) + 12800, mediaTimeOffset);
    const out = path.join(root, 'shifted-elst.mp4');
    fs.writeFileSync(out, shifted);
    expectRejected(await cut(out, 12437), 'unsupported_timeline');
  });

  test('5c. standard AAC priming edit list is accepted and the priming is recorded', async () => {
    const r = await cut(src25, 12437);
    expect(r.status).toBe(0);
    expect(typeof r.receipt.audioPrimingMs).toBe('number');
    expect(r.receipt.audioPrimingMs).toBeLessThanOrEqual(44);
    // eslint-disable-next-line no-console
    console.log(`audioPrimingMs ${r.receipt.audioPrimingMs}`);
  });

  test('6. variable frame rate is rejected as unsupported_timeline', async () => {
    const out = path.join(root, 'vfr.mp4');
    await makeSource(out, { priv: 12.437, vf: "select='not(eq(n,30))'" });
    expectRejected(await cut(out, 12437), 'unsupported_timeline');
  });

  test('7. two audio streams are rejected as unsupported_streams', async () => {
    const out = path.join(root, 'two-audio.mp4');
    await ff('-i', src25, '-i', src25, '-map', '0:v', '-map', '0:a', '-map', '1:a', '-c', 'copy', out);
    expectRejected(await cut(out, 12437), 'unsupported_streams');
  });

  test('8. wrong SOURCE_SIZE is rejected as source_size_mismatch', async () => {
    const work = sandbox('work');
    const r = await script('cut', { SOURCE_PATH: src25, SOURCE_SIZE: String(fs.statSync(src25).size + 1), CUT_MS: '12437', WORK_DIR: work });
    expect(r.status).toBe(3);
    expect(JSON.parse(fs.readFileSync(path.join(work, 'receipt.json'), 'utf8')).code).toBe('source_size_mismatch');
    expect(fs.existsSync(path.join(work, 'presentation.mp4'))).toBe(false);
  });

  describe('install', () => {
    const fakeTarball = () => {
      const dir = sandbox('fake');
      fs.mkdirSync(path.join(dir, 'top', 'bin'), { recursive: true });
      for (const b of ['ffmpeg', 'ffprobe']) {
        fs.writeFileSync(path.join(dir, 'top', 'bin', b), '#!/bin/sh\necho "ffmpeg version fake-9"\n', { mode: 0o755 });
      }
      const tar = path.join(dir, 'ff.tar.xz');
      expect(spawnSync('tar', ['-cJf', tar, '-C', dir, 'top']).status).toBe(0);
      return { tar, sha: crypto.createHash('sha256').update(fs.readFileSync(tar)).digest('hex') };
    };
    test('9a. wrong sha256 exits 3 with ffmpeg_checksum_mismatch and extracts nothing', async () => {
      const { tar } = fakeTarball();
      const dest = path.join(sandbox('inst'), 'ffmpeg');
      const rec = path.join(sandbox('inst'), 'install.json');
      const r = await script('install', { FFMPEG_TAR: tar, FFMPEG_SHA256: '0'.repeat(64), FFMPEG_DIR: dest, INSTALL_RECEIPT: rec });
      expect(r.status).toBe(3);
      expect(JSON.parse(fs.readFileSync(rec, 'utf8'))).toMatchObject({ ok: false, code: 'ffmpeg_checksum_mismatch' });
      expect(fs.existsSync(dest)).toBe(false);
    });
    test('9b. matching sha256 extracts with the top directory stripped', async () => {
      const { tar, sha } = fakeTarball();
      const dest = path.join(sandbox('inst'), 'ffmpeg');
      const rec = path.join(sandbox('inst'), 'install.json');
      const r = await script('install', { FFMPEG_TAR: tar, FFMPEG_SHA256: sha, FFMPEG_DIR: dest, INSTALL_RECEIPT: rec });
      expect(r.status).toBe(0);
      expect(JSON.parse(fs.readFileSync(rec, 'utf8'))).toMatchObject({ ok: true, ffmpegVersionLine: 'ffmpeg version fake-9' });
      expect(fs.existsSync(path.join(dest, 'bin', 'ffprobe'))).toBe(true);
    });
  });

  describe('10. quickXorHash', () => {
    const qxh = async (file) => JSON.parse((await script('qxh', { FILE: file })).stdout).quickXorHash;
    test('empty file is 20 zero bytes', async () => {
      const f = path.join(root, 'empty.bin');
      fs.writeFileSync(f, '');
      expect(await qxh(f)).toBe('AAAAAAAAAAAAAAAAAAAAAAAAAAA=');
      expect(quickXorReference(Buffer.alloc(0))).toBe('AAAAAAAAAAAAAAAAAAAAAAAAAAA=');
    });
    test('python matches the independent reference on small, aligned-boundary and 1 MiB inputs', async () => {
      const sizes = [1, 7, 159, 160, 161, 1 << 20, (1 << 20) + 13];
      for (const size of sizes) {
        const buf = crypto.createHash('sha512').update(String(size)).digest();
        const data = Buffer.alloc(size);
        for (let i = 0; i < size; i += 1) data[i] = (buf[i % 64] * 31 + i * 7 + (i >> 8)) & 0xff;
        const f = path.join(root, `qx-${size}.bin`);
        fs.writeFileSync(f, data);
        // eslint-disable-next-line no-await-in-loop
        expect(await qxh(f)).toBe(quickXorReference(data));
      }
    });
    test('hash spans multiple fold blocks (10 MiB + tail)', async () => {
      const data = crypto.randomBytes(160 * 65536 + 1234);
      const f = path.join(root, 'qx-big.bin');
      fs.writeFileSync(f, data);
      expect(await qxh(f)).toBe(quickXorReference(data));
    });
  });

  test('11. mutation: with the timeline rejection neutralised the offset fixture is no longer caught as unsupported_timeline', async () => {
    const needle = "raise Fail('unsupported_timeline', step)";
    expect(CUT_SCRIPT_PY).toContain(needle);
    const mutant = path.join(root, 'cut-mutant.py');
    fs.writeFileSync(mutant, CUT_SCRIPT_PY.replace(needle, 'return'));
    const out = path.join(root, 'vid-offset.mp4'); // created by test 3
    expect(fs.existsSync(out)).toBe(true);
    const real = await cut(out, 12437);
    const mut = await cut(out, 12437, {}, mutant);
    expect(real.receipt.code).toBe('unsupported_timeline');
    // eslint-disable-next-line no-console
    console.log(`mutant outcome on video-offset fixture: status ${mut.status}, ok ${mut.receipt.ok}, code ${mut.receipt.code}`);
    expect(mut.receipt.code).not.toBe('unsupported_timeline');
  });

  test('11b. mutation: with the output correspondence check removed and the encode mistimed (-r 30) the cut is accepted, the real script rejects it', async () => {
    const needle = "raise Fail('frame_timestamp_mismatch', step)";
    const enc = "'-fps_mode', 'passthrough',";
    expect(CUT_SCRIPT_PY).toContain(needle);
    expect(CUT_SCRIPT_PY).toContain(enc);
    const bad = CUT_SCRIPT_PY.replace(enc, "'-fps_mode', 'cfr', '-r', '30',");
    const mutantNoCheck = path.join(root, 'cut-mutant2.py');
    fs.writeFileSync(mutantNoCheck, bad.replace(needle, 'pass'));
    const onlyBadEncode = path.join(root, 'cut-mutant3.py');
    fs.writeFileSync(onlyBadEncode, bad);
    const rejected = await cut(src25, 12437, {}, onlyBadEncode);
    expect(rejected.receipt.code).toBe('frame_timestamp_mismatch');
    const accepted = await cut(src25, 12437, {}, mutantNoCheck);
    expect(accepted.receipt.ok).toBe(true);
  });

  describe('audio continuity (gap before the boundary)', () => {
    let gapSrc;
    const audioGaps = (file) => JSON.parse(spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries',
      'frame=pts,nb_samples', '-of', 'json', file]).stdout.toString()).frames
      .filter((f, i, all) => i > 0 && Number(all[i - 1].pts) + Number(all[i - 1].nb_samples) !== Number(f.pts));
    beforeAll(async () => {
      // 1.5 s of 440 Hz, a 50 ms timestamp gap, then 3 kHz marker audio; video from the marker fixture.
      const a1 = path.join(root, 'gap-a1.m4a');
      const a2 = path.join(root, 'gap-a2.m4a');
      await ff('-f', 'lavfi', '-i', `sine=f=440:r=${SR}:d=1.5`, '-ac', '2', '-c:a', 'aac', a1);
      await ff('-f', 'lavfi', '-i', `sine=f=3000:r=${SR}:d=5`, '-ac', '2', '-c:a', 'aac', a2);
      const list = path.join(root, 'gap-list.txt');
      fs.writeFileSync(list, `file '${a1}'\nduration 1.55\nfile '${a2}'\n`);
      const joined = path.join(root, 'gap-joined.m4a');
      await ff('-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', joined);
      gapSrc = path.join(root, 'gap-source.mp4');
      await ff('-i', src25, '-i', joined, '-map', '0:v', '-map', '1:a', '-c', 'copy', '-t', '10', gapSrc);
    });
    test('fixture really has a timestamp gap', () => {
      expect(audioGaps(gapSrc).length).toBeGreaterThan(0);
    });
    test('12. cut after the gap is rejected as unsupported_timeline at audio_timeline', async () => {
      const r = await cut(gapSrc, 2000);
      expectRejected(r, 'unsupported_timeline');
      expect(r.receipt.step).toBe('audio_timeline');
    });
    test('12b. mutation: with the continuity check patched out the gap fixture is accepted', async () => {
      const needle = "        if not covered:\n            timeline_fail(step)";
      const hit = "            if f.get('pts') is None or f.get('nb_samples') is None or int(f['pts']) != pos:\n                timeline_fail(step)";
      expect(CUT_SCRIPT_PY).toContain(needle);
      expect(CUT_SCRIPT_PY).toContain(hit);
      const mutant = path.join(root, 'cut-mutant-gap.py');
      fs.writeFileSync(mutant, CUT_SCRIPT_PY.replace(needle, '        pass').replace(hit, '            pass'));
      const r = await cut(gapSrc, 2000, {}, mutant);
      expect(r.receipt.ok).toBe(true);
    });
    test('continuous sources record audioFramesChecked', async () => {
      const r = await cut(src25, 12437);
      expect(r.receipt.audioFramesChecked).toBeGreaterThan(500);
    });
  });

  describe('upload (local server)', () => {
    test('chunks sequentially, resumes after a 503 via nextExpectedRanges, parses the item id, sends no Authorization', async () => {
      const work = sandbox('up');
      const size = 25 * 1024 * 1024 + 123;
      fs.writeFileSync(path.join(work, 'presentation.mp4'), crypto.randomBytes(size));
      let received = 0;
      let failedOnce = false;
      const seen = [];
      const server = http.createServer((req, res) => {
        if (req.headers.authorization) seen.push('AUTH');
        if (req.method === 'GET') {
          res.end(JSON.stringify({ nextExpectedRanges: [`${received}-`] }));
          return;
        }
        const m = /bytes (\d+)-(\d+)\/(\d+)/.exec(req.headers['content-range'] || '');
        const bytes = [];
        req.on('data', (c) => bytes.push(c));
        req.on('end', () => {
          const len = Buffer.concat(bytes).length;
          seen.push(`${m[1]}-${m[2]}/${m[3]}:${len}`);
          if (!failedOnce && Number(m[1]) > 0) { failedOnce = true; res.statusCode = 503; res.end(); return; }
          expect(Number(m[1])).toBe(received);
          received = Number(m[2]) + 1;
          res.statusCode = received >= size ? 201 : 202;
          res.end(received >= size ? JSON.stringify({ id: 'ITEM-1' }) : '{}');
        });
      });
      await new Promise((r) => server.listen(0, '127.0.0.1', r));
      try {
        const r = await script('upload', { WORK_DIR: work, UPLOAD_URL: `http://127.0.0.1:${server.address().port}/s`, UPLOAD_BACKOFF_S: '0,0,0' });
        expect(r.status).toBe(0);
        const up = JSON.parse(fs.readFileSync(path.join(work, 'upload.json'), 'utf8'));
        expect(up).toMatchObject({ ok: true, itemId: 'ITEM-1', size, httpStatus: 201 });
        expect(JSON.stringify(up)).not.toContain('127.0.0.1');
        expect(seen).not.toContain('AUTH');
        expect(seen.filter((s) => s.endsWith(`:${10 * 1024 * 1024}`)).length).toBeGreaterThanOrEqual(2);
        expect(r.stdout + r.stderr).not.toContain('127.0.0.1');
      } finally {
        server.close();
      }
    });
    test('a 400 is upload_rejected', async () => {
      const work = sandbox('up');
      fs.writeFileSync(path.join(work, 'presentation.mp4'), Buffer.alloc(1000));
      const server = http.createServer((req, res) => { req.resume(); req.on('end', () => { res.statusCode = 400; res.end('{}'); }); });
      await new Promise((r) => server.listen(0, '127.0.0.1', r));
      try {
        const r = await script('upload', { WORK_DIR: work, UPLOAD_URL: `http://127.0.0.1:${server.address().port}/s`, UPLOAD_BACKOFF_S: '0' });
        expect(r.status).toBe(3);
        expect(JSON.parse(fs.readFileSync(path.join(work, 'upload.json'), 'utf8'))).toMatchObject({ ok: false, code: 'upload_rejected', httpStatus: 400 });
      } finally {
        server.close();
      }
    });
  });
});
