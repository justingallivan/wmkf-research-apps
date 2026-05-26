/**
 * Probe actual akoya_fiscalyear values and their correlation with
 * wmkf_meetingdate across real requests. Read-only.
 *
 * Verifies:
 *   1. Actual text format of akoya_fiscalyear (J25 vs "June 2025" vs other)
 *   2. How many distinct cycle labels exist
 *   3. Whether each fiscal year maps to a consistent meeting-date month
 *      (sanity-check that our "June→J, December→D" assumption holds)
 */

const fs = require('fs');
const path = require('path');
fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split('\n').forEach(line => {
  const t = line.trim(); if (!t || t.startsWith('#')) return;
  const [k, ...v] = t.split('='); if (!k || v.length === 0) return;
  let val = v.join('=');
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
  process.env[k] = val;
});

(async () => {
  const { DynamicsService } = await import('../lib/services/dynamics-service.js');
  const { enterDynamicsBypassForScript } = await import('../lib/services/dynamics-context.js');
  enterDynamicsBypassForScript('probe-fiscal-year');

  // Sample 200 recent requests that have a fiscal year set
  const result = await DynamicsService.queryRecords('akoya_requests', {
    select: 'akoya_requestnum,akoya_fiscalyear,wmkf_meetingdate,akoya_submitdate,akoya_decisiondate',
    filter: 'akoya_fiscalyear ne null',
    orderby: 'createdon desc',
    top: 200,
  });

  const rows = result.records;
  console.log(`Sampled ${rows.length} recent requests with non-null akoya_fiscalyear\n`);

  // 1. Distinct values + counts
  const byCode = new Map(); // code → { count, meetingMonths: Set, sampleMeetingDates: [] }
  for (const r of rows) {
    const code = r.akoya_fiscalyear;
    if (!byCode.has(code)) byCode.set(code, { count: 0, meetingMonths: new Set(), meetingYears: new Set(), samples: [] });
    const e = byCode.get(code);
    e.count++;
    if (r.wmkf_meetingdate) {
      const d = new Date(r.wmkf_meetingdate);
      e.meetingMonths.add(d.getUTCMonth() + 1);
      e.meetingYears.add(d.getUTCFullYear());
      if (e.samples.length < 3) e.samples.push({ reqnum: r.akoya_requestnum, meeting: r.wmkf_meetingdate.slice(0, 10) });
    }
  }

  const sortedCodes = [...byCode.entries()].sort((a, b) => b[1].count - a[1].count);
  console.log('─── Fiscal-year code distribution ───');
  console.log(`${'Code'.padEnd(16)} ${'Count'.padStart(6)}  ${'Meeting month(s)'.padEnd(18)} ${'Year(s)'.padEnd(14)} Sample meeting dates`);
  for (const [code, info] of sortedCodes) {
    const months = [...info.meetingMonths].sort((a, b) => a - b).join(',');
    const years = [...info.meetingYears].sort().join(',');
    const samples = info.samples.map(s => s.meeting).join('; ');
    console.log(`${(code || '(empty)').padEnd(16)} ${String(info.count).padStart(6)}  ${months.padEnd(18)} ${years.padEnd(14)} ${samples}`);
  }

  // 2. Format classification
  console.log('\n─── Format pattern detection ───');
  const patterns = { short: 0, long: 0, other: 0, examples: { short: null, long: null, other: null } };
  for (const code of byCode.keys()) {
    if (!code) continue;
    if (/^[JD]\d{2}$/.test(code)) { patterns.short++; if (!patterns.examples.short) patterns.examples.short = code; }
    else if (/^(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}$/.test(code)) { patterns.long++; if (!patterns.examples.long) patterns.examples.long = code; }
    else { patterns.other++; if (!patterns.examples.other) patterns.examples.other = code; }
  }
  console.log(`  Short format (e.g., J25, D26):    ${patterns.short} codes  example: ${patterns.examples.short || '-'}`);
  console.log(`  Long format (e.g., "June 2025"):  ${patterns.long} codes  example: ${patterns.examples.long || '-'}`);
  console.log(`  Other:                            ${patterns.other} codes  example: ${patterns.examples.other || '-'}`);

  // 3. Any fiscal year code mapping to >1 meeting month? (would be a data bug)
  console.log('\n─── Consistency check: one cycle should have one meeting month ───');
  const inconsistent = [...byCode.entries()].filter(([, info]) => info.meetingMonths.size > 1);
  if (inconsistent.length === 0) {
    console.log('  ✓ Every fiscal-year code maps to exactly one meeting month (or none)');
  } else {
    console.log(`  ⚠ ${inconsistent.length} fiscal-year code(s) map to multiple meeting months:`);
    for (const [code, info] of inconsistent) {
      console.log(`    ${code}: months ${[...info.meetingMonths].join(',')} — samples ${info.samples.map(s => `${s.reqnum}:${s.meeting}`).join(', ')}`);
    }
  }

  // 4. Null/empty meeting dates
  const nullMeeting = rows.filter(r => !r.wmkf_meetingdate).length;
  console.log(`\n─── Null meeting-date check ───`);
  console.log(`  ${nullMeeting} of ${rows.length} sampled requests have null wmkf_meetingdate`);
})().catch(e => { console.error('FATAL:', e.message); console.error(e.stack); process.exit(1); });
