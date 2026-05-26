/**
 * Find recent research-heavy Phase I test candidates.
 *
 * Filters for university/institute/lab/research applicants with >= 5 files
 * and no existing wmkf_ai_summary. Skips the two already tested.
 */

const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const t = line.trim();
    if (!t || t.startsWith('#')) return;
    const [k, ...v] = t.split('=');
    if (!k || v.length === 0) return;
    let val = v.join('=');
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    process.env[k] = val;
  });
}

const ALREADY_TESTED = new Set(['1002821', '1002794']);
const RESEARCH_KEYWORDS = /university|institute|college of medicine|laboratory|research|hospital|medical center|school of |salk|mit|caltech|stanford|harvard|ucla|berkeley|carnegie|rockefeller|scripps|cold spring|jackson lab|broad institute/i;

(async () => {
  const { DynamicsService } = await import('../lib/services/dynamics-service.js');
  const { enterDynamicsBypassForScript } = await import('../lib/services/dynamics-context.js');
  const { GraphService } = await import('../lib/services/graph-service.js');
  const { getRequestSharePointBuckets } = await import('../lib/utils/sharepoint-buckets.js');

  enterDynamicsBypassForScript('find-research');

  // Pull recent requests
  const result = await DynamicsService.queryRecords('akoya_requests', {
    select: 'akoya_requestnum,akoya_requestid,akoya_title,akoya_submitdate,_akoya_applicantid_value,wmkf_ai_summary',
    filter: `akoya_submitdate ge 2023-01-01T00:00:00Z`,
    orderBy: 'akoya_submitdate desc',
    top: 200,
  });
  console.log(`Got ${result.records.length} recent requests; filtering for research applicants...\n`);

  const candidates = result.records
    .filter(r => !ALREADY_TESTED.has(r.akoya_requestnum))
    .filter(r => !r.wmkf_ai_summary || !r.wmkf_ai_summary.trim())
    .filter(r => RESEARCH_KEYWORDS.test(r._akoya_applicantid_value_formatted || ''))
    .slice(0, 25);

  console.log(`${candidates.length} research candidates, probing SharePoint...\n`);

  const results = [];
  let done = 0;
  for (const c of candidates) {
    process.stdout.write(`  [${++done}/${candidates.length}] ${c.akoya_requestnum} — ${c._akoya_applicantid_value_formatted?.slice(0, 40)}...`);
    try {
      const buckets = await getRequestSharePointBuckets(c.akoya_requestid, c.akoya_requestnum);
      let totalFiles = 0;
      let libraries = [];
      let bestPdf = null;
      for (const b of buckets) {
        try {
          const files = await GraphService.listFiles(b.library, b.folder, { recursive: true, totalTimeoutMs: 10000 });
          if (files.length === 0) continue;
          totalFiles += files.length;
          libraries.push(`${b.library}(${files.length})`);
          const pdfs = files.filter(f => (f.name || '').toLowerCase().endsWith('.pdf'));
          const preferred = pdfs.find(f => /proposal|narrative|phase.?i|application/i.test(f.name));
          const chosen = preferred || pdfs[0];
          if (chosen && (!bestPdf || (preferred && !bestPdf.preferred))) {
            bestPdf = { name: chosen.name, size: chosen.size, library: b.library, preferred: !!preferred };
          }
        } catch {}
      }
      if (totalFiles === 0) { process.stdout.write(` no files\n`); continue; }
      process.stdout.write(` ${libraries.join(', ')} | ${bestPdf?.name?.slice(0, 50) || '(no pdf)'}\n`);
      results.push({
        requestNum: c.akoya_requestnum,
        applicant: c._akoya_applicantid_value_formatted,
        title: (c.akoya_title || '').slice(0, 80),
        submitDate: c.akoya_submitdate?.slice(0, 10),
        totalFiles,
        libraries: libraries.join(', '),
        bestPdf,
      });
    } catch (err) {
      process.stdout.write(` ERR: ${err.message.slice(0, 50)}\n`);
    }
  }

  // Rank: prefer with a preferred-named PDF, then by file count
  results.sort((a, b) => {
    if ((b.bestPdf?.preferred ? 1 : 0) - (a.bestPdf?.preferred ? 1 : 0)) return (b.bestPdf?.preferred ? 1 : 0) - (a.bestPdf?.preferred ? 1 : 0);
    return b.totalFiles - a.totalFiles;
  });

  console.log(`\n\nTOP CANDIDATES:`);
  for (const r of results.slice(0, 10)) {
    console.log(`  ${r.requestNum} | ${r.submitDate} | ${r.applicant.slice(0, 40).padEnd(40)} | ${r.bestPdf?.preferred ? '★' : ' '} ${r.bestPdf?.name?.slice(0, 60)}`);
  }

  // Suggest first 6
  const suggest = results.slice(0, 6).map(r => r.requestNum);
  console.log(`\nTEST_REQUESTS = ${JSON.stringify(suggest)}`);
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
