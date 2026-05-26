/**
 * Export a CSV of every Research subject area (wmkf_programareaserved_research)
 * actually used in akoya_request, with usage counts.
 *
 * Splits multi-select records into individual values so each option gets its
 * own row (option (a) interpretation).
 *
 * Output: scripts/program-area-research-usage.csv
 */
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const [rawKey, ...valueParts] = trimmed.split('=');
      const key = rawKey.trim();
      if (key && valueParts.length > 0) {
        let value = valueParts.join('=').trim();
        if (value.startsWith('"')) {
          const endQuote = value.indexOf('"', 1);
          if (endQuote > 0) value = value.slice(1, endQuote);
        }
        process.env[key] = value;
      }
    }
  });
}

const { DynamicsService } = require('../lib/services/dynamics-service');
const { enterDynamicsBypassForScript } = require('../lib/services/dynamics-context');

async function main() {
  enterDynamicsBypassForScript('export-program-area-research');

  console.log('Fetching all akoya_request records with wmkf_programareaserved_research populated...');
  const { records, totalCount, capped } = await DynamicsService.queryAllRecords('akoya_requests', {
    select: 'akoya_requestnum,wmkf_programareaserved_research',
    filter: 'wmkf_programareaserved_research ne null',
  });

  console.log(`  Got ${records.length} records (Dynamics reported ${totalCount} total${capped ? ', export CAPPED' : ''})`);

  // optionId -> { label, count }
  const usage = new Map();

  for (const r of records) {
    const ids = String(r.wmkf_programareaserved_research || '').split(',').map(s => s.trim()).filter(Boolean);
    const labels = String(r.wmkf_programareaserved_research_formatted || '').split(';').map(s => s.trim()).filter(Boolean);
    // Dynamics returns formatted as semicolon-separated label list paired by index with the IDs.
    ids.forEach((id, i) => {
      const label = labels[i] || '(unknown)';
      const cur = usage.get(id) || { label, count: 0 };
      cur.count += 1;
      // Prefer the first non-empty label seen
      if (cur.label === '(unknown)' && label) cur.label = label;
      usage.set(id, cur);
    });
  }

  const rows = Array.from(usage.entries()).map(([id, v]) => ({
    option_id: id,
    label: v.label,
    record_count: v.count,
  }));
  rows.sort((a, b) => b.record_count - a.record_count || a.label.localeCompare(b.label));

  const csvEscape = (s) => {
    const str = String(s ?? '');
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };

  const csv = [
    'option_id,label,record_count',
    ...rows.map(r => `${csvEscape(r.option_id)},${csvEscape(r.label)},${csvEscape(r.record_count)}`),
  ].join('\n') + '\n';

  const outPath = path.join(__dirname, 'program-area-research-usage.csv');
  fs.writeFileSync(outPath, csv);

  console.log(`\nWrote ${rows.length} unique options to ${outPath}`);
  console.log(`Top 10:`);
  rows.slice(0, 10).forEach(r => console.log(`  ${r.record_count.toString().padStart(5)}  ${r.label} (${r.option_id})`));
}

main().catch(err => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
