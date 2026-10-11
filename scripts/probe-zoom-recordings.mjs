#!/usr/bin/env node
/**
 * Read-only Stage 0 pilot (docs/plans/MEETING_RECORDING_WORKFLOW_PLAN_2026-10-07.md):
 * prove the internal Server-to-Server OAuth app can list one approved host's
 * cloud recordings and download one chosen meeting's files.
 *
 *   node scripts/probe-zoom-recordings.mjs --host <email> [--days 30]
 *   node scripts/probe-zoom-recordings.mjs --host <email> [--days 30] --download <meetingUUID> --out <empty dir> [--only <recording_type>]
 *   node scripts/probe-zoom-recordings.mjs --host <email> [--days 30] --range <meetingUUID>
 *   node scripts/probe-zoom-recordings.mjs --host <email> [--days 30] --lifetime <meetingUUID> [--minutes 0,15,60]
 *   node scripts/probe-zoom-recordings.mjs --host <email> [--days 30] --moov <meetingUUID>
 *   node scripts/probe-zoom-recordings.mjs --host <email> [--days 30] --attendance <meetingUUID>
 *
 * --range (Stage 3b probe 1, docs/plans/ZOOM_VIDEO_SHAREPOINT_COPY_PLAN_2026-10-08.md):
 * for each completed MP4 of the meeting, follow download_url hop by hop with
 * `Range` requests (bearer on the first hop only, as zoom-client.js does) and print
 * each hop's status, host and range headers. Response bodies are cancelled
 * unread; nothing is saved.
 *
 * --lifetime (probe 2): resolve the first MP4's download_url once, then re-request
 * the resolved URL without the bearer at each listed minute mark (1 KiB range),
 * printing only status and content-range. The URL is held in memory only.
 *
 * --moov (probe 5): read the first and last MiB of each MP4 with Range requests
 * (in memory, never saved), list the top-level boxes found there, and report where
 * `moov` sits and the `mvhd` duration versus Zoom's recording start/end.
 *
 * --attendance (attendance slice): read the participants report and the past-meeting
 * participants list for one listed occurrence and print SHAPES ONLY: root keys, pagination,
 * per-field value classes and distinct counts, identifier grouping counts, status counts and
 * whether duration is seconds or minutes. No names, emails, ids or times are printed.
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
const RANGE = arg('range');
const LIFETIME = arg('lifetime');
const MOOV = arg('moov');
const ATTENDANCE = arg('attendance');
const ONLY = arg('only'); // --download: fetch only files of this recording_type (e.g. audio_only)
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

const resolveUrl = async (downloadUrl) => {
  let url = downloadUrl;
  for (let hop = 0; hop < 6; hop += 1) {
    const headers = { Range: 'bytes=0-0' };
    if (hop === 0) headers.Authorization = `Bearer ${tok.access_token}`;
    const res = await fetch(url, { headers, redirect: 'manual' });
    await res.body?.cancel();
    const loc = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && loc) { url = new URL(loc, url).href; continue; }
    return res.status === 206 ? url : null;
  }
  return null;
};
const rangedBytes = async (url, start, end) => {
  const res = await fetch(url, { headers: { Range: `bytes=${start}-${end}` } });
  if (res.status !== 206) { await res.body?.cancel(); return { status: res.status }; }
  return { status: 206, total: Number(String(res.headers.get('content-range')).split('/')[1]), buf: Buffer.from(await res.arrayBuffer()) };
};

if (ATTENDANCE) {
  const meeting = byUuid.get(ATTENDANCE);
  if (!meeting) { console.error(`uuid ${ATTENDANCE} is not in ${HOST}'s listing for the last ${DAYS} days`); process.exit(1); }
  const enc = /^\/|\/\//.test(ATTENDANCE) ? encodeURIComponent(encodeURIComponent(ATTENDANCE)) : encodeURIComponent(ATTENDANCE);
  const shape = (v) => {
    if (v === null || v === undefined) return 'null';
    if (typeof v !== 'string') return typeof v;
    if (v === '') return 'empty';
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) return 'uuid';
    if (/^[^@\s]+@[^@\s]+$/.test(v)) return 'email';
    if (/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/.test(v)) return `iso${v.includes('.') ? '-fractional' : '-seconds'}`;
    if (/^\+?[\d\s()-]{7,}$/.test(v)) return 'phone-like';
    if (/^\d+$/.test(v)) return `digits(${v.length})`;
    if (/^[A-Za-z0-9+/_=-]{16,}$/.test(v)) return `token(${v.length})`;
    return 'text';
  };
  const describe = async (label, base, extra = {}) => {
    console.log(`--- ${label} ---`);
    const first = await fetch(`${base}?${new URLSearchParams({ page_size: '2', ...extra })}`, { headers: H });
    if (!first.ok) { const b = await first.text(); let d = b.slice(0, 200); try { const j = JSON.parse(b); d = `code=${j.code} message=${j.message}`; } catch {} console.log(`HTTP ${first.status} ${d}\n`); return; }
    const fj = await first.json();
    console.log(`root keys: ${Object.keys(fj).sort().join(', ')}`);
    console.log(`page_size=2 probe: page_count=${fj.page_count ?? '-'} total_records=${fj.total_records ?? '-'} next_page_token=${fj.next_page_token ? 'present' : 'absent'}`);
    const rows = []; let next = ''; let pages = 0;
    do {
      const q = new URLSearchParams({ page_size: '300', ...extra }); if (next) q.set('next_page_token', next);
      const res = await fetch(`${base}?${q}`, { headers: H });
      if (!res.ok) await fail(`${label} page ${pages + 1}`, res);
      const j = await res.json(); pages += 1; rows.push(...(j.participants || [])); next = j.next_page_token || '';
    } while (next && pages < 20);
    console.log(`page_size=300: ${pages} page(s), ${rows.length} row(s)${next ? ', STOPPED at 20 pages' : ''}`);
    const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))].sort();
    for (const k of keys) {
      const hist = {}; const distinct = new Set();
      for (const r of rows) { const s = shape(r[k]); hist[s] = (hist[s] || 0) + 1; if (r[k] !== '' && r[k] != null) distinct.add(JSON.stringify(r[k])); }
      console.log(`  ${k}: ${Object.entries(hist).map(([s, n]) => `${s}×${n}`).join(' ')}  distinct=${distinct.size}`);
    }
    const names = new Set(rows.map((r) => r.name));
    console.log(`distinct names=${names.size}; rows with phone-like name=${rows.filter((r) => shape(r.name) === 'phone-like').length}; rows whose user_email is the host=${rows.filter((r) => r.user_email && r.user_email.toLowerCase() === HOST.toLowerCase()).length}`);
    for (const k of ['id', 'user_id', 'participant_user_id', 'participant_uuid', 'registrant_id', 'user_email', 'customer_key']) {
      if (!keys.includes(k)) continue;
      const byId = new Map();
      for (const r of rows) if (r[k]) byId.set(r[k], [...(byId.get(r[k]) || []), r]);
      const multi = [...byId.values()].filter((g) => g.length > 1).length;
      const multiName = [...byId.values()].filter((g) => new Set(g.map((r) => r.name)).size > 1).length;
      const nameMultiId = [...names].filter((n) => new Set(rows.filter((r) => r.name === n && r[k]).map((r) => r[k])).size > 1).length;
      console.log(`  grouping by ${k}: ${byId.size} value(s), ${multi} with >1 row, ${multiName} spanning >1 name, ${nameMultiId} name(s) spanning >1 value, ${rows.filter((r) => !r[k]).length} row(s) without it`);
    }
    const st = {}; for (const r of rows) st[r.status ?? '(none)'] = (st[r.status ?? '(none)'] || 0) + 1;
    console.log(`status: ${Object.entries(st).map(([s, n]) => `${s}×${n}`).join(' ')}`);
    let secMatch = 0; let minMatch = 0; let timed = 0;
    for (const r of rows) {
      const diff = (Date.parse(r.leave_time) - Date.parse(r.join_time)) / 1000;
      if (!Number.isFinite(diff) || typeof r.duration !== 'number') continue;
      timed += 1; if (Math.abs(r.duration - diff) <= 1) secMatch += 1; if (Math.abs(r.duration - diff / 60) <= 1) minMatch += 1;
    }
    console.log(`duration vs leave-join: ${timed} timed row(s); matches seconds=${secMatch}, minutes=${minMatch}`);
    const firstJoin = rows.map((r) => Date.parse(r.join_time)).filter(Number.isFinite).sort((a, b) => a - b)[0];
    const audio = (meeting.recording_files || []).filter((f) => f.recording_type === 'audio_only');
    if (firstJoin && audio[0]) console.log(`audio_only files=${audio.length}; first join is ${((Date.parse(audio[0].recording_start) - firstJoin) / 1000).toFixed(0)} s before the first audio recording_start`);
    console.log('');
  };
  console.log(`Meeting ended ${meeting.start_time ? `(started ${meeting.start_time}, ${meeting.duration} min)` : ''}; report requested ${new Date().toISOString()}\n`);
  await describe('report participants', `https://api.zoom.us/v2/report/meetings/${enc}/participants`, { include_fields: 'registrant_id' });
  await describe('past_meetings participants', `https://api.zoom.us/v2/past_meetings/${enc}/participants`);
  process.exit(0);
}

if (LIFETIME) {
  const meeting = byUuid.get(LIFETIME);
  if (!meeting) { console.error(`uuid ${LIFETIME} is not in ${HOST}'s listing`); process.exit(1); }
  const f = (meeting.recording_files || []).find((x) => String(x.file_extension).toUpperCase() === 'MP4' && x.status === 'completed');
  if (!f) { console.error('no completed MP4'); process.exit(1); }
  const marks = String(arg('minutes') || '0,15,60').split(',').map(Number);
  const url = await resolveUrl(f.download_url);
  if (!url) { console.error('could not resolve download_url to a 206'); process.exit(1); }
  const t0 = Date.now();
  console.log(`${f.recording_type}  resolved at ${new Date(t0).toISOString()}`);
  for (const m of marks) {
    const wait = t0 + m * 60000 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    const res = await fetch(url, { headers: { Range: 'bytes=0-1023' } });
    await res.body?.cancel();
    console.log(`  +${m} min (${new Date().toISOString()}): HTTP ${res.status}  content-range=${res.headers.get('content-range')}`);
  }
  process.exit(0);
}

if (MOOV) {
  const meeting = byUuid.get(MOOV);
  if (!meeting) { console.error(`uuid ${MOOV} is not in ${HOST}'s listing`); process.exit(1); }
  const MIB = 1048576;
  const boxes = (buf, base) => {
    const out = [];
    for (let pos = 0; pos + 8 <= buf.length;) {
      let len = buf.readUInt32BE(pos); const type = buf.toString('latin1', pos + 4, pos + 8); let hdr = 8;
      if (len === 1 && pos + 16 <= buf.length) { len = Number(buf.readBigUInt64BE(pos + 8)); hdr = 16; }
      if (!/^[a-z0-9 ]{4}$/i.test(type) || len < hdr) break;
      out.push({ type, offset: base + pos, len, hdr, pos });
      pos += len;
    }
    return out;
  };
  const mvhdSeconds = (buf, moovPos, moovHdr, moovLen) => {
    const end = Math.min(buf.length, moovPos + moovLen);
    for (let pos = moovPos + moovHdr; pos + 8 <= end;) {
      const len = buf.readUInt32BE(pos); const type = buf.toString('latin1', pos + 4, pos + 8);
      if (type === 'mvhd') {
        const v1 = buf[pos + 8] === 1; const b = pos + 8;
        const scale = buf.readUInt32BE(v1 ? b + 20 : b + 12);
        const dur = v1 ? Number(buf.readBigUInt64BE(b + 24)) : buf.readUInt32BE(b + 16);
        return scale ? dur / scale : null;
      }
      if (len < 8) break; pos += len;
    }
    return null;
  };
  for (const f of (meeting.recording_files || []).filter((x) => String(x.file_extension).toUpperCase() === 'MP4' && x.status === 'completed')) {
    const url = await resolveUrl(f.download_url);
    if (!url) { console.log(`${f.recording_type}: could not resolve`); continue; }
    const head = await rangedBytes(url, 0, MIB - 1);
    if (head.status !== 206) { console.log(`${f.recording_type}: head HTTP ${head.status}`); continue; }
    const headBoxes = boxes(head.buf, 0);
    console.log(`${f.recording_type}  total=${head.total}  zoom duration=${secs(f) ?? '?'}s`);
    console.log(`  first MiB top-level boxes: ${headBoxes.map((b) => `${b.type}@${b.offset}(${b.len})`).join(' ')}`);
    const moovHead = headBoxes.find((b) => b.type === 'moov');
    if (moovHead) {
      const fits = moovHead.pos + moovHead.len <= head.buf.length;
      console.log(`  moov starts in first MiB: offset ${moovHead.offset}, length ${moovHead.len}, fully inside=${fits}, mvhd=${mvhdSeconds(head.buf, moovHead.pos, moovHead.hdr, moovHead.len)?.toFixed(1) ?? 'not in first MiB'}s`);
      continue;
    }
    const mdat = headBoxes.find((b) => b.type === 'mdat');
    const afterMdat = mdat ? mdat.offset + mdat.len : null;
    console.log(`  moov not in first MiB; box after mdat starts at ${afterMdat ?? '?'} (${afterMdat ? head.total - afterMdat : '?'} bytes from end)`);
    if (afterMdat && head.total - afterMdat <= 8 * MIB) {
      const tail = await rangedBytes(url, afterMdat, head.total - 1);
      const tailBoxes = tail.buf ? boxes(tail.buf, afterMdat) : [];
      console.log(`  tail boxes: ${tailBoxes.map((b) => `${b.type}@${b.offset}(${b.len})`).join(' ')}`);
      const moovTail = tailBoxes.find((b) => b.type === 'moov');
      if (moovTail) console.log(`  mvhd=${mvhdSeconds(tail.buf, moovTail.pos, moovTail.hdr, moovTail.len)?.toFixed(1)}s`);
    }
  }
  process.exit(0);
}

if (RANGE) {
  const meeting = byUuid.get(RANGE);
  if (!meeting) { console.error(`uuid ${RANGE} is not in ${HOST}'s listing for the last ${DAYS} days`); process.exit(1); }
  const probe = async (url, range, bearer) => {
    const hops = [];
    for (let hop = 0; hop < 6; hop += 1) {
      const headers = { Range: range };
      if (bearer && hop === 0) headers.Authorization = `Bearer ${tok.access_token}`;
      const res = await fetch(url, { headers, redirect: 'manual' });
      const h = (k) => res.headers.get(k);
      hops.push(`    hop${hop} ${new URL(url).host} -> HTTP ${res.status}  accept-ranges=${h('accept-ranges')}  content-range=${h('content-range')}  content-length=${h('content-length')}  content-type=${h('content-type')}`);
      await res.body?.cancel();
      const loc = h('location');
      if (res.status >= 300 && res.status < 400 && loc) { url = new URL(loc, url).href; continue; }
      return { hops, final: url, status: res.status };
    }
    return { hops, final: null, status: null };
  };
  for (const f of (meeting.recording_files || []).filter((x) => String(x.file_extension).toUpperCase() === 'MP4')) {
    console.log(`${f.recording_type}  ${mb(f.file_size || 0)}  status=${f.status}`);
    if (f.status !== 'completed') continue;
    const first = await probe(f.download_url, 'bytes=0-1023', true);
    console.log(`  Range bytes=0-1023 from download_url:\n${first.hops.join('\n')}`);
    if (first.final && f.file_size > 2 * 1048576) {
      const mid = `bytes=${1048576}-${1048576 + 1023}`;
      const again = await probe(first.final, mid, false);
      console.log(`  Range ${mid} on the resolved final URL, no bearer:\n${again.hops.join('\n')}`);
    }
  }
  process.exit(0);
}

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
  if (ONLY && f.recording_type !== ONLY) { console.log(`SKIP ${name}: not --only ${ONLY}`); continue; }
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
