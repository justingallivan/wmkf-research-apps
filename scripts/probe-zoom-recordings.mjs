#!/usr/bin/env node
/**
 * Read-only Stage 0 pilot (docs/plans/MEETING_RECORDING_WORKFLOW_PLAN_2026-10-07.md):
 * prove the internal Server-to-Server OAuth app can list one approved host's
 * cloud recordings and download one chosen meeting's files.
 *
 *   node scripts/probe-zoom-recordings.mjs --host <email> [--days 30]
 *   node scripts/probe-zoom-recordings.mjs --host <email> [--days 30] --download <meetingUUID> --out <empty dir>
 *
 * Reads ZOOM_S2S_ACCOUNT_ID / ZOOM_S2S_CLIENT_ID / ZOOM_S2S_CLIENT_SECRET from
 * .env.local. Never prints the token or download URLs. Never deletes, writes to
 * Zoom, or stores anything outside --out. The download target must come from the
 * host's own listing, so the probe cannot reach another host's recordings.
 */

import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = {};
for (const line of fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (!m) continue;
  let [, k, v] = m; env[k] = v.trim().replace(/^"(.*)"$/, '$1');
}

const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; };
const HOST = arg('host');
const DAYS = Number(arg('days') || 30);
const DOWNLOAD = arg('download');
const OUT = arg('out');
if (!HOST) { console.error('--host <email> is required'); process.exit(2); }
if (DOWNLOAD && !OUT) { console.error('--download requires --out <empty dir>'); process.exit(2); }
for (const k of ['ZOOM_S2S_ACCOUNT_ID', 'ZOOM_S2S_CLIENT_ID', 'ZOOM_S2S_CLIENT_SECRET']) {
  if (!env[k]) { console.error(`${k} missing from .env.local`); process.exit(2); }
}

async function fail(step, res) {
  const body = await res.text();
  let detail = body.slice(0, 300);
  try { const j = JSON.parse(body); detail = `code=${j.code ?? j.error} message=${j.message ?? j.reason ?? j.error_description}`; } catch {}
  console.error(`${step} failed: HTTP ${res.status} ${detail}`);
  process.exit(1);
}

// --- token -----------------------------------------------------------------
const basic = Buffer.from(`${env.ZOOM_S2S_CLIENT_ID}:${env.ZOOM_S2S_CLIENT_SECRET}`).toString('base64');
const tokRes = await fetch(`https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(env.ZOOM_S2S_ACCOUNT_ID)}`, {
  method: 'POST', headers: { Authorization: `Basic ${basic}` },
});
if (!tokRes.ok) await fail('Token', tokRes);
const tok = await tokRes.json();
console.log(`Token OK (expires_in=${tok.expires_in}s)\nGranted scopes: ${tok.scope}\n`);
const H = { Authorization: `Bearer ${tok.access_token}`, Accept: 'application/json' };

// --- list (Zoom caps from/to at one month per request) ---------------------
const ymd = (d) => d.toISOString().slice(0, 10);
const meetings = [];
const end = new Date();
for (let windowEnd = end; windowEnd > new Date(end.getTime() - DAYS * 864e5);) {
  const windowStart = new Date(Math.max(windowEnd.getTime() - 30 * 864e5, end.getTime() - DAYS * 864e5));
  let next = '';
  do {
    const q = new URLSearchParams({ from: ymd(windowStart), to: ymd(windowEnd), page_size: '300' });
    if (next) q.set('next_page_token', next);
    const res = await fetch(`https://api.zoom.us/v2/users/${encodeURIComponent(HOST)}/recordings?${q}`, { headers: H });
    if (!res.ok) await fail(`List ${ymd(windowStart)}..${ymd(windowEnd)}`, res);
    const j = await res.json();
    meetings.push(...(j.meetings || []));
    next = j.next_page_token || '';
  } while (next);
  windowEnd = new Date(windowStart.getTime() - 864e5);
}
// Windows are inclusive by date, so de-duplicate on the occurrence UUID.
const byUuid = new Map(meetings.map((m) => [m.uuid, m]));
console.log(`${byUuid.size} recorded meeting(s) for ${HOST} in the last ${DAYS} days\n`);

const mb = (n) => `${(n / 1048576).toFixed(1)} MB`;
const secs = (f) => (f.recording_start && f.recording_end ? (Date.parse(f.recording_end) - Date.parse(f.recording_start)) / 1000 : null);

if (!DOWNLOAD) {
  for (const m of [...byUuid.values()].sort((a, b) => b.start_time.localeCompare(a.start_time))) {
    console.log(`${m.start_time}  ${m.duration}min  "${m.topic}"`);
    console.log(`  uuid=${m.uuid}  meeting_id=${m.id}  files=${m.recording_count}  total=${mb(m.total_size || 0)}`);
    for (const f of m.recording_files || []) {
      console.log(`    ${f.file_type}/${f.file_extension}  ${f.recording_type}  ${mb(f.file_size || 0)}  ${secs(f) ?? '?'}s  status=${f.status}`);
    }
  }
  process.exit(0);
}

// --- download one meeting --------------------------------------------------
const meeting = byUuid.get(DOWNLOAD);
if (!meeting) { console.error(`uuid ${DOWNLOAD} is not in ${HOST}'s listing for the last ${DAYS} days`); process.exit(1); }
fs.mkdirSync(OUT, { recursive: true });
if (fs.readdirSync(OUT).length) { console.error(`--out ${OUT} is not empty`); process.exit(2); }

// MP4/M4A duration from moov/mvhd; cross-check only, so any parse problem returns null.
function mp4Duration(file) {
  try {
    const fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const read = (pos, len) => { const b = Buffer.alloc(len); fs.readSync(fd, b, 0, len, pos); return b; };
    const findBox = (start, stop, type) => {
      for (let pos = start; pos + 8 <= stop;) {
        const h = read(pos, 16);
        let len = h.readUInt32BE(0); const t = h.toString('latin1', 4, 8); let hdr = 8;
        if (len === 1) { len = Number(h.readBigUInt64BE(8)); hdr = 16; } else if (len === 0) len = stop - pos;
        if (len < hdr) return null;
        if (t === type) return { pos, hdr, len };
        pos += len;
      }
      return null;
    };
    const moov = findBox(0, size, 'moov'); if (!moov) return null;
    const mvhd = findBox(moov.pos + moov.hdr, moov.pos + moov.len, 'mvhd'); if (!mvhd) return null;
    const b = read(mvhd.pos + mvhd.hdr, 32);
    const v1 = b[0] === 1;
    const scale = b.readUInt32BE(v1 ? 20 : 12);
    const dur = v1 ? Number(b.readBigUInt64BE(24)) : b.readUInt32BE(16);
    fs.closeSync(fd);
    return scale ? dur / scale : null;
  } catch { return null; }
}
function vttDuration(file) {
  const stamps = [...fs.readFileSync(file, 'utf8').matchAll(/--> *(\d+):(\d{2}):(\d{2})\.(\d{3})/g)];
  const last = stamps.at(-1); if (!last) return null;
  return +last[1] * 3600 + +last[2] * 60 + +last[3] + +last[4] / 1000;
}

console.log(`Downloading "${meeting.topic}" (${meeting.start_time}) to ${OUT}\n`);
for (const f of meeting.recording_files || []) {
  const name = `${f.recording_type}-${f.id}.${(f.file_extension || 'bin').toLowerCase()}`;
  const dest = path.join(OUT, name);
  if (f.status !== 'completed') { console.log(`SKIP ${name}: status=${f.status}`); continue; }
  const res = await fetch(f.download_url, { headers: { Authorization: `Bearer ${tok.access_token}` } });
  if (!res.ok) await fail(`Download ${name}`, res);
  // An unauthenticated download still answers 200 with an HTML sign-in page.
  if ((res.headers.get('content-type') || '').includes('text/html')) { console.error(`Download ${name} returned HTML, not the file`); process.exit(1); }
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(dest));
  const bytes = fs.statSync(dest).size;
  const ext = name.split('.').pop();
  const measured = ['mp4', 'm4a'].includes(ext) ? mp4Duration(dest) : ext === 'vtt' ? vttDuration(dest) : null;
  console.log(`${name}`);
  console.log(`  content-type=${res.headers.get('content-type')}  bytes=${bytes} (zoom file_size=${f.file_size}${bytes === f.file_size ? ', match' : ', MISMATCH'})`);
  console.log(`  zoom duration=${secs(f) ?? '?'}s  measured=${measured == null ? '?' : measured.toFixed(1) + 's'}`);
}
