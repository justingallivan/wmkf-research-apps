#!/usr/bin/env node
/**
 * Read-only diagnostic for Zoom speaker alignment on a Meeting Tracker transcription job.
 *
 * Loads the job row, its stored transcript and Zoom VTT from private Blob, and re-runs the
 * DETERMINISTIC part of the alignment pipeline locally (no model call, no writes): cue
 * attribution statistics, per-speaker name support at the live thresholds, and the same
 * support at relaxed thresholds so a threshold change can be judged before it is made.
 * Prints names and counts only; never prints transcript or caption text.
 *
 * Usage:
 *   node scripts/probe-meeting-speaker-alignment.js                 # newest job that has a VTT
 *   node scripts/probe-meeting-speaker-alignment.js --job <uuid>
 *
 * Reads production Postgres and private Blob through .env.local; owner-run only.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

for (const envFile of ['.env', '.env.local']) {
  try {
    for (const line of readFileSync(resolve(process.cwd(), envFile), 'utf8').split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const i = t.indexOf('=');
      if (i === -1) continue;
      const k = t.slice(0, i).trim();
      const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
      if (!process.env[k]) process.env[k] = v;
    }
  } catch {}
}

const { sql } = await import('@vercel/postgres');
const { get } = await import('@vercel/blob');
const zoom = await import('../lib/services/transcription-pilot/zoom-vtt.js');
// Mirrors shared/config/prompts/meeting-speaker-alignment.js speaker_samples maxChars.
const SPEAKER_SAMPLES_MAX_CHARS = 160_000;

// Same read as runtime.js readPrivateContentIfPresent, inlined because runtime.js uses
// bundler-only extensionless imports that plain Node ESM cannot resolve.
async function readPrivateContentIfPresent(pathname, maxBytes) {
  const token = process.env.UPLOADS_BLOB_RW_TOKEN;
  if (!token) throw new Error('UPLOADS_BLOB_RW_TOKEN is not set');
  const result = await get(pathname, { access: 'private', token, useCache: false });
  if (!result || result.statusCode === 404) return null;
  if (result.statusCode !== 200 || !result.stream) throw new Error(`blob read failed (${result.statusCode})`);
  const chunks = []; let length = 0;
  for await (const chunk of result.stream) {
    const buffer = Buffer.from(chunk); length += buffer.length;
    if (length > maxBytes) throw new Error('content too large');
    chunks.push(buffer);
  }
  return { buffer: Buffer.concat(chunks, length) };
}

const jobArg = process.argv.indexOf('--job');
const jobId = jobArg !== -1 ? process.argv[jobArg + 1] : null;
const { rows } = jobId
  ? await sql`SELECT id, status, version, speaker_names, speaker_alignment, output_pathname, zoom_transcript_pathname, created_at FROM transcription_jobs WHERE id = ${jobId}`
  : await sql`SELECT id, status, version, speaker_names, speaker_alignment, output_pathname, zoom_transcript_pathname, created_at FROM transcription_jobs WHERE zoom_transcript_pathname IS NOT NULL ORDER BY created_at DESC LIMIT 1`;
if (!rows.length) { console.error('No matching job.'); process.exit(1); }
const job = rows[0];
console.log(`Job ${job.id}  status=${job.status}  version=${job.version}  created=${job.created_at?.toISOString?.() ?? job.created_at}`);
console.log('speaker_names   :', JSON.stringify(job.speaker_names));
console.log('speaker_alignment:', JSON.stringify(job.speaker_alignment));

const transcript = await readPrivateContentIfPresent(job.output_pathname, 32 * 1024 * 1024);
const vtt = await readPrivateContentIfPresent(job.zoom_transcript_pathname, 4_000_000);
if (!transcript?.buffer || !vtt?.buffer) { console.error('Transcript or VTT blob missing.'); process.exit(1); }
const content = JSON.parse(transcript.buffer.toString('utf8'));
const parsed = zoom.parseZoomVtt(vtt.buffer.toString('utf8'));
const utterances = Array.isArray(content?.utterances) ? content.utterances : [];
const D = zoom.ZOOM_ALIGNMENT_DEFAULTS;
const tok = zoom.tokenizeTranscriptText;
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };

// Per-speaker utterance shape.
console.log('\n== Provider utterances ==');
const bySpeaker = new Map();
for (const u of utterances) { if (!bySpeaker.has(u.speaker)) bySpeaker.set(u.speaker, []); bySpeaker.get(u.speaker).push(u); }
for (const [id, list] of bySpeaker) {
  const words = list.map(u => String(u.text || '').split(/\s+/).filter(Boolean).length);
  const cw = list.map(u => tok(u.text).size);
  const dur = list.reduce((s, u) => s + (u.end - u.start), 0) / 60000;
  console.log(`  ${id}: ${list.length} utterances, ${dur.toFixed(1)} min, median words ${median(words)}, median content words ${median(cw)}, >1500 chars: ${list.filter(u => String(u.text || '').length > 1500).length}`);
}

// Cue shape.
console.log('\n== Zoom cues ==');
const named = parsed.cues.filter(c => c.name);
const cueCw = named.map(c => tok(c.text).size);
console.log(`  cues ${parsed.cues.length}, named ${named.length}, names ${parsed.names.length}: ${parsed.names.join(' | ')}`);
console.log(`  content words per cue: median ${median(cueCw)}, < ${D.minContentWords}: ${cueCw.filter(n => n < D.minContentWords).length} (${Math.round(100 * cueCw.filter(n => n < D.minContentWords).length / Math.max(1, named.length))}%)`);
const perName = new Map();
for (const c of named) perName.set(c.name, (perName.get(c.name) || 0) + 1);
console.log('  cues per name:', [...perName].map(([n, k]) => `${n}=${k}`).join(', '));

// Best-candidate statistics per cue at the live window, full utterance text sliced like the live code.
console.log('\n== Cue -> utterance matching (window ±' + D.windowMs / 1000 + ' s, text slice ' + D.maxSampleUtteranceChars + ') ==');
const sliced = utterances.map(u => ({ ...u, tokens: tok(String(u.text || '').slice(0, D.maxSampleUtteranceChars)) }));
const hist = { none: 0, '1-2': 0, '3-5': 0, '6+': 0 };
let eligible = 0; let ambiguous = 0; let bothOverlapFail = 0;
const bestOverlaps = [];
for (const c of named) {
  const ct = tok(c.text);
  const cands = sliced.filter(u => u.end >= c.start - D.windowMs && u.start <= c.end + D.windowMs)
    .map(u => { let shared = 0; for (const w of u.tokens) if (ct.has(w)) shared += 1; const smaller = Math.min(u.tokens.size, ct.size); return { u, shared, overlap: smaller ? shared / smaller : 0 }; })
    .sort((a, b) => b.shared - a.shared || b.overlap - a.overlap);
  const best = cands[0];
  const s = best?.shared || 0;
  hist[s === 0 ? 'none' : s <= 2 ? '1-2' : s <= 5 ? '3-5' : '6+'] += 1;
  if (best) bestOverlaps.push(best.overlap);
  const matched = cands.filter(x => x.shared >= D.minContentWords && x.overlap >= D.minTokenOverlap);
  if (matched.length) {
    eligible += 1;
    const rivals = matched.filter(x => x.u.speaker !== matched[0].u.speaker && x.shared >= D.ambiguityShareRatio * matched[0].shared - 1e-9);
    if (rivals.length) {
      ambiguous += 1;
      const overlapping = matched.filter(x => x.u.start < c.end && x.u.end > c.start);
      if (new Set(overlapping.map(x => x.u.speaker)).size !== 1) bothOverlapFail += 1;
    }
  }
}
console.log(`  best shared content words per cue: none=${hist.none} 1-2=${hist['1-2']} 3-5=${hist['3-5']} 6+=${hist['6+']}`);
console.log(`  median best overlap ${median(bestOverlaps).toFixed(2)}; cues with an ELIGIBLE candidate (>=${D.minContentWords} shared, overlap>=${D.minTokenOverlap}): ${eligible}/${named.length}; of those ambiguous ${ambiguous}, unresolved by time ${bothOverlapFail}`);

// Clock calibration from wording anchors: for every cue with exactly one eligible speaker, the
// offset is cue.start - utterance.start. A tight cluster means the Zoom caption clock and the
// audio clock agree; a linear fit over time exposes drift; a step in the residuals exposes a pause.
console.log('\n== Clock calibration from wording anchors ==');
const anchors = [];
for (const c of named) {
  const ct = tok(c.text);
  const matched = sliced.filter(u => u.end >= c.start - D.windowMs && u.start <= c.end + D.windowMs)
    .map(u => { let shared = 0; for (const w of u.tokens) if (ct.has(w)) shared += 1; const smaller = Math.min(u.tokens.size, ct.size); return { u, shared, overlap: smaller ? shared / smaller : 0 }; })
    .filter(x => x.shared >= D.minContentWords && x.overlap >= D.minTokenOverlap)
    .sort((a, b) => b.shared - a.shared || b.overlap - a.overlap);
  if (!matched.length || new Set(matched.map(x => x.u.speaker)).size !== 1) continue;
  // Anchor on the containing utterance's START only when the cue is the utterance's first words;
  // otherwise measure "cue lies inside utterance" as the signed distance to the nearest edge.
  const u = matched[0].u;
  const inside = c.start >= u.start && c.end <= u.end;
  const edge = inside ? 0 : (c.start < u.start ? c.start - u.start : c.end - u.end);
  anchors.push({ t: c.start, speaker: u.speaker, inside, edge, shared: matched[0].shared });
}
const edges = anchors.map(a => a.edge).sort((a, b) => a - b);
const q = (p) => edges.length ? edges[Math.min(edges.length - 1, Math.floor(p * edges.length))] / 1000 : NaN;
console.log(`  anchors ${anchors.length}; cue fully inside its utterance: ${anchors.filter(a => a.inside).length}; edge distance (s) p10 ${q(0.1).toFixed(2)} median ${q(0.5).toFixed(2)} p90 ${q(0.9).toFixed(2)} min ${q(0).toFixed(2)} max ${q(1).toFixed(2)}`);
// Drift / step check: edge distance by meeting quarter.
const tMax = Math.max(...anchors.map(a => a.t), 1);
for (let k = 0; k < 4; k += 1) {
  const part = anchors.filter(a => a.t >= k * tMax / 4 && a.t < (k + 1) * tMax / 4).map(a => a.edge / 1000).sort((a, b) => a - b);
  if (part.length) console.log(`  quarter ${k + 1}: ${part.length} anchors, edge median ${part[Math.floor(part.length / 2)].toFixed(2)} s, p90 ${part[Math.floor(part.length * 0.9)].toFixed(2)} s`);
}

// Timing-only recovery: cues the floor discards (< minContentWords content words) that lie, within
// a tolerance, inside exactly one speaker's utterance span. Report how many, per name, and whether
// they would point at the dominant wording name for that speaker or at a different one.
console.log('\n== Timing-only recovery of sub-floor cues (tolerance 1.0 s, >= 1 content word) ==');
const liveSupport = zoom.computeNameSupport(zoom.sampleAlignmentPairs(utterances, parsed.cues, { maxChars: SPEAKER_SAMPLES_MAX_CHARS }).samples, utterances, parsed.names, D);
const dominant = Object.fromEntries(Object.entries(liveSupport).map(([id, e]) => [id, Object.entries(e).sort((a, b) => b[1].count - a[1].count)[0]?.[0] ?? null]));
const tol = 1000;
let recovered = 0; let agree = 0; let disagree = 0; let multi = 0; let noSpan = 0; let zeroWords = 0;
const disagreeByName = new Map();
for (const c of named) {
  const ct = tok(c.text);
  if (ct.size >= D.minContentWords) continue;
  if (ct.size === 0) { zeroWords += 1; continue; }
  const spanning = utterances.filter(u => u.start - tol <= c.start && u.end + tol >= c.end);
  const speakers = new Set(spanning.map(u => u.speaker));
  if (speakers.size === 0) { noSpan += 1; continue; }
  if (speakers.size > 1) { multi += 1; continue; }
  const [sp] = speakers;
  recovered += 1;
  if (dominant[sp] === c.name) agree += 1; else { disagree += 1; disagreeByName.set(`${sp}<-${c.name}`, (disagreeByName.get(`${sp}<-${c.name}`) || 0) + 1); }
}
console.log(`  sub-floor cues ${named.filter(c => tok(c.text).size < D.minContentWords).length}: zero content words ${zeroWords}, no spanning utterance ${noSpan}, two or more speakers span ${multi}, recoverable ${recovered}`);
console.log(`  recoverable cues agreeing with the dominant wording name: ${agree}; disagreeing: ${disagree}` + (disagree ? '  (' + [...disagreeByName].map(([k, v]) => `${k}×${v}`).join(', ') + ')' : ''));

// Live support (full set vs visible set), then relaxed counterfactuals.
const sampled = zoom.sampleAlignmentPairs(utterances, parsed.cues, { maxChars: SPEAKER_SAMPLES_MAX_CHARS });
// The live run also trims samples that do not fit the rendered prompt; the sampler's own
// char budget is the same number, so when truncated=false the visible set equals the sampled set.
const visible = sampled.samples;
console.log(`\n== Sampling == samples ${sampled.samples.length}, truncated=${sampled.truncated}, reservedOverBudget=${sampled.reservedOverBudget}; cues carried by samples: ${sampled.samples.reduce((n, s) => n + s.cues.length, 0)}`);
console.log('  samples per speaker: ' + [...bySpeaker.keys()].map(id => `${id}=${sampled.samples.filter(s => s.speakerId === id).length}`).join(', '));
const table = (support) => Object.entries(support).map(([id, entries]) => `${id}: ${Object.entries(entries).map(([n, e]) => `${n}×${e.count}`).join(', ') || '—'}`).join('\n    ');
console.log('\n== Support at LIVE thresholds (minContentWords ' + D.minContentWords + ', overlap ' + D.minTokenOverlap + ', ratio ' + D.ambiguityShareRatio + ') ==');
console.log('  full set:\n    ' + table(zoom.computeNameSupport(sampled.samples, utterances, parsed.names, D)));
// What the CURRENT verifier code would decide for this job if the model abstained on every speaker
// (the strictest honest case under the veto rule), and if it agreed with every dominant name.
console.log('\n== Verifier outcome under current code ==');
const fullSupport = zoom.computeNameSupport(sampled.samples, utterances, parsed.names, D);
const visibleSupport = zoom.computeNameSupport(visible, utterances, parsed.names, D);
const decide = (verdict, label) => {
  const { names: applied, alignment } = zoom.verifyAlignmentVerdict(visible, visibleSupport, verdict, { zoomNames: parsed.names, content, conflictSupport: fullSupport });
  console.log(`  ${label}: status=${alignment.status}; applied ${Object.entries(applied).map(([id, n]) => `${id}=${n}`).join(', ') || '—'}`);
  if (Object.keys(alignment.reasons || {}).length) console.log(`    reasons: ${JSON.stringify(alignment.reasons)}`);
  console.log(`    confidence/basis: ${Object.entries(alignment.speakers).map(([id, v]) => `${id}=${v.confidence}/${v.basis}`).join(', ') || '—'}`);
};
decide({}, 'model abstains on all');
decide(Object.fromEntries(Object.entries(fullSupport).map(([id, e]) => { const top = Object.entries(e).sort((a, b) => b[1].count - a[1].count)[0]; return [id, top ? { name: top[0], confidence: 0.9, pairIds: top[1].pairIds.slice(0, 1) } : null]; })), 'model agrees with each dominant name at 0.9');

for (const [mcw, ov] of [[4, 0.5], [3, 0.5], [3, 0.4], [2, 0.5]]) {
  console.log(`\n== Counterfactual support (minContentWords ${mcw}, overlap ${ov}) ==\n    ` + table(zoom.computeNameSupport(visible, utterances, parsed.names, { ...D, minContentWords: mcw, minTokenOverlap: ov })));
}
process.exit(0);
