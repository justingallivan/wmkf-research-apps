/**
 * Find Phase I v2 test-case candidates by sampling requests across date ranges
 * and probing their SharePoint buckets.
 *
 * Output: a short-list mixing active-only and archive-bearing requests so we
 * can stress the bucket walker.
 *
 * Usage:
 *   node scripts/find-phase-i-test-cases.js
 */

const fs = require('fs');
const path = require('path');

// Load .env.local
const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const t = line.trim();
    if (!t || t.startsWith('#')) return;
    const [k, ...v] = t.split('=');
    if (!k || v.length === 0) return;
    let val = v.join('=');
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    process.env[k] = val;
  });
}

(async () => {
  const { DynamicsService } = await import('../lib/services/dynamics-service.js');
  const { enterDynamicsBypassForScript } = await import('../lib/services/dynamics-context.js');
  const { getRequestSharePointBuckets } = await import('../lib/utils/sharepoint-buckets.js');
  const { GraphService } = await import('../lib/services/graph-service.js');

  enterDynamicsBypassForScript('find-test-cases');

  // Sample by request number ranges. Lower numbers tend to be pre-akoya
  // migrations and often live in RequestArchive1/2/3. Known archive case:
  // 993879 (Carter/UNC-CH). 2022+ grants are all active by sample.
  const ranges = [
    { label: '<=993999', filter: `akoya_requestnum lt '994000'`, top: 20 },
    { label: '994xxx',   filter: `akoya_requestnum ge '994000' and akoya_requestnum lt '995000'`, top: 10 },
    { label: '995xxx',   filter: `akoya_requestnum ge '995000' and akoya_requestnum lt '996000'`, top: 5 },
    { label: '1000xxx+', filter: `akoya_requestnum ge '1000000'`, top: 5 },
  ];

  const candidates = [];
  for (const r of ranges) {
    const result = await DynamicsService.queryRecords('akoya_requests', {
      select: 'akoya_requestnum,akoya_requestid,akoya_title,akoya_submitdate,_akoya_applicantid_value,wmkf_ai_summary',
      filter: r.filter,
      orderBy: 'akoya_requestnum asc',
      top: r.top,
    });
    for (const row of result.records) {
      candidates.push({
        cohort: r.label,
        requestNum: row.akoya_requestnum,
        requestId: row.akoya_requestid,
        title: (row.akoya_title || '').slice(0, 80),
        applicant: row._akoya_applicantid_value_formatted || '',
        submitDate: row.akoya_submitdate?.slice(0, 10),
        hasSummary: !!(row.wmkf_ai_summary && row.wmkf_ai_summary.trim().length > 0),
      });
    }
  }

  console.log(`\nProbing ${candidates.length} candidates for SharePoint bucket distribution...\n`);

  const results = [];
  let done = 0;
  for (const c of candidates) {
    process.stdout.write(`  [${++done}/${candidates.length}] ${c.requestNum}...`);
    try {
      const buckets = await getRequestSharePointBuckets(c.requestId, c.requestNum);
      const perBucket = [];
      for (const b of buckets) {
        try {
          const files = await GraphService.listFiles(b.library, b.folder, { recursive: true, totalTimeoutMs: 10000 });
          if (files.length > 0) perBucket.push({ library: b.library, fileCount: files.length });
        } catch {
          // tolerate — archive 404s are expected misses
        }
      }
      const hasPdf = perBucket.some(b => b.fileCount > 0);
      const libraryNames = perBucket.map(b => `${b.library}(${b.fileCount})`).join(', ');
      results.push({ ...c, perBucket, hasPdf, libraryNames });
      process.stdout.write(` ${libraryNames || '(no files)'}\n`);
    } catch (err) {
      process.stdout.write(` ERROR: ${err.message}\n`);
      results.push({ ...c, error: err.message });
    }
  }

  // Categorize
  const activeOnly = results.filter(r => r.perBucket?.length === 1 && r.perBucket[0].library === 'akoya_request');
  const archiveOnly = results.filter(r => r.perBucket?.length >= 1 && !r.perBucket.some(b => b.library === 'akoya_request'));
  const mixed = results.filter(r => r.perBucket?.length > 1 && r.perBucket.some(b => b.library === 'akoya_request'));
  const empty = results.filter(r => r.perBucket?.length === 0);

  const fmt = (rows) => rows.map(r =>
    `  ${r.requestNum} | ${r.cohort} | ${r.submitDate} | ${r.applicant.slice(0, 30).padEnd(30)} | ${r.hasSummary ? 'HAS-AI' : '      '} | ${r.libraryNames}`
  ).join('\n');

  console.log('\n=========================================');
  console.log('ACTIVE-ONLY (akoya_request only):');
  console.log(fmt(activeOnly));
  console.log('\nMIXED (akoya_request + archive):');
  console.log(fmt(mixed));
  console.log('\nARCHIVE-ONLY (no akoya_request files):');
  console.log(fmt(archiveOnly));
  console.log('\nEMPTY (no files found):');
  console.log(fmt(empty));
  console.log('\n=========================================');
  console.log(`Active-only: ${activeOnly.length} | Mixed: ${mixed.length} | Archive-only: ${archiveOnly.length} | Empty: ${empty.length}`);

  // Suggest 5-10 test cases: prefer WITHOUT existing wmkf_ai_summary (no overwrite prompts)
  const suggest = [
    ...activeOnly.filter(r => !r.hasSummary).slice(0, 3),
    ...mixed.filter(r => !r.hasSummary).slice(0, 3),
    ...archiveOnly.filter(r => !r.hasSummary).slice(0, 4),
  ];
  console.log('\nSUGGESTED TEST SET (prefer un-summarized, mix buckets):');
  console.log(fmt(suggest));
  console.log();
})().catch(e => {
  console.error('FATAL:', e.message);
  console.error(e.stack);
  process.exit(1);
});
