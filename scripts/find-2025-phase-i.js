/**
 * Find 2025 Phase I test candidates.
 *
 * Searches requests submitted ±45 days around the two 2025 Phase I deadlines
 * (May 1 and November 1), probes SharePoint, and surfaces those with a real
 * Phase I Application PDF. Excludes any "concept" files.
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

// May 2025 only — Nov 2025 was the new Concepts stage per Session 105 finding.
const WINDOWS = [
  { label: 'May 2025',  start: '2025-03-15', end: '2025-06-15' },
];

const PHASE_I_FILE_REGEX = /research.phase.?i|phase.?i.application|phase.?i.proposal|phase.?1/i;
const CONCEPT_EXCLUDE_REGEX = /concept/i;

(async () => {
  const { DynamicsService } = await import('../lib/services/dynamics-service.js');
  const { enterDynamicsBypassForScript } = await import('../lib/services/dynamics-context.js');
  const { GraphService } = await import('../lib/services/graph-service.js');
  const { getRequestSharePointBuckets } = await import('../lib/utils/sharepoint-buckets.js');

  enterDynamicsBypassForScript('find-2025-phase-i');

  const allHits = [];
  for (const w of WINDOWS) {
    console.log(`\n=== ${w.label} window (${w.start} to ${w.end}) ===`);
    const result = await DynamicsService.queryRecords('akoya_requests', {
      select: 'akoya_requestnum,akoya_requestid,akoya_title,akoya_submitdate,_akoya_applicantid_value,wmkf_ai_summary',
      filter: `akoya_submitdate ge ${w.start}T00:00:00Z and akoya_submitdate le ${w.end}T23:59:59Z`,
      orderBy: 'akoya_submitdate asc',
      top: 100,
    });
    console.log(`  ${result.records.length} requests in window`);

    let phaseIHits = 0, conceptOnly = 0, noFiles = 0, checked = 0;
    // Probe in parallel batches of 8 so an in-flight 8s timeout doesn't block the others
    const BATCH = 8;
    for (let i = 0; i < result.records.length; i += BATCH) {
      await Promise.all(result.records.slice(i, i + BATCH).map(async r => {
      checked++;
      if (r.wmkf_ai_summary && r.wmkf_ai_summary.trim()) return;

      try {
        const buckets = await getRequestSharePointBuckets(r.akoya_requestid, r.akoya_requestnum);
        const bucketResults = await Promise.all(buckets.map(async b => {
          try {
            const files = await GraphService.listFiles(b.library, b.folder, { recursive: true, totalTimeoutMs: 8000 });
            return files.map(f => ({ ...f, library: b.library }));
          } catch { return []; }
        }));
        const allFiles = bucketResults.flat().filter(f => (f.name || '').toLowerCase().endsWith('.pdf'));
        if (allFiles.length === 0) { noFiles++; return; }

        const phaseI = allFiles.filter(f => PHASE_I_FILE_REGEX.test(f.name) && !CONCEPT_EXCLUDE_REGEX.test(f.name));
        if (phaseI.length > 0) {
          phaseIHits++;
          phaseI.sort((a, b) => (b.size || 0) - (a.size || 0));
          allHits.push({
            window: w.label,
            requestNum: r.akoya_requestnum,
            applicant: (r._akoya_applicantid_value_formatted || '').slice(0, 40),
            submitDate: r.akoya_submitdate?.slice(0, 10),
            file: phaseI[0].name,
            sizeKb: Math.round((phaseI[0].size || 0) / 1024),
            library: phaseI[0].library,
          });
        } else {
          const conceptFiles = allFiles.filter(f => CONCEPT_EXCLUDE_REGEX.test(f.name));
          if (conceptFiles.length > 0) conceptOnly++;
        }
      } catch {}
      }));
      process.stdout.write(`.`);
    }
    console.log(`\n  → checked=${checked} phaseI=${phaseIHits} concept-only=${conceptOnly} no-files=${noFiles}`);
  }

  console.log(`\n\nPHASE I CANDIDATES:\n`);
  for (const h of allHits) {
    console.log(`  ${h.requestNum} | ${h.window} | ${h.submitDate} | ${h.applicant.padEnd(40)} | ${h.sizeKb} KB | ${h.library} | ${h.file.slice(0, 60)}`);
  }
  console.log(`\nTotal: ${allHits.length}`);
  if (allHits.length > 0) {
    const sample = [...allHits.slice(0, 4), ...allHits.slice(-2)].map(h => h.requestNum);
    console.log(`Suggested test set: ${JSON.stringify([...new Set(sample)])}`);
  }
})().catch(e => { console.error('FATAL:', e.message); console.error(e.stack); process.exit(1); });
