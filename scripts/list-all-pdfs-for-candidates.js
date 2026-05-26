/**
 * Enumerate every PDF for each candidate's SharePoint buckets so we can
 * pick a better default than "first PDF alphabetically."
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

const CANDIDATES = [
  '1002464', '1002466', '1002468', '1002473', '1002477',
  '1002478', '1002486', '1002495', '1002503', '1002509',
  '1002513', '1002518', '1002531', '1002543', '1002548',
  '1002549', '1002550', '1002555', '1002558', '1002559', '1002564',
];

(async () => {
  const { DynamicsService } = await import('../lib/services/dynamics-service.js');
  const { enterDynamicsBypassForScript } = await import('../lib/services/dynamics-context.js');
  const { GraphService } = await import('../lib/services/graph-service.js');
  const { getRequestSharePointBuckets } = await import('../lib/utils/sharepoint-buckets.js');

  enterDynamicsBypassForScript('list-pdfs');

  for (const requestNum of CANDIDATES) {
    const lookup = await DynamicsService.queryRecords('akoya_requests', {
      select: 'akoya_requestnum,akoya_requestid,_akoya_applicantid_value',
      filter: `akoya_requestnum eq '${requestNum}'`,
      top: 1,
    });
    if (lookup.records.length === 0) continue;
    const req = lookup.records[0];
    const applicant = (req._akoya_applicantid_value_formatted || '').slice(0, 35);

    const buckets = await getRequestSharePointBuckets(req.akoya_requestid, requestNum);
    const allPdfs = [];
    for (const b of buckets) {
      try {
        const files = await GraphService.listFiles(b.library, b.folder, { recursive: true, totalTimeoutMs: 8000 });
        for (const f of files) {
          if ((f.name || '').toLowerCase().endsWith('.pdf')) {
            allPdfs.push({ name: f.name, size: f.size, library: b.library });
          }
        }
      } catch {}
    }

    console.log(`\n${requestNum} — ${applicant.padEnd(35)}`);
    for (const p of allPdfs) {
      const sizeKb = p.size ? (p.size / 1024).toFixed(0) + ' KB' : '?';
      console.log(`  ${sizeKb.padStart(8)}  ${p.name}`);
    }
  }
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
