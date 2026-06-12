/**
 * origination-sniff-tally — rejoin judged blinded sniff-test sheets to their hidden
 * arm-membership keys and report per-arm pick-rates for the reviewer-finder
 * origination experiment (REVIEWER_FINDER_ORIGINATION_PLAN.md §3).
 *
 * Reads <dir>/<req>.key.json + the judge's marked <dir>/<req>.sheet.md (the "Would
 * pick?" column = yes / no / a disqualifier note like "Died (…)", "Retired",
 * "No (grad student)"). A candidate counts toward EVERY arm it belongs to (a person
 * surfaced by both the current pipeline and the applicant's recommendations counts
 * for arm A and arm C), so per-arm pick-rate is over that arm's own members.
 *
 * Arms: A = current pipeline · B = grounded retrieval (G1+G2) · C = applicant
 * recommended. Disqualifiers (deceased/retired/trainee/wrong-field) count as "not
 * picked" but are tallied separately because WHY an arm misses is itself a verdict.
 *
 * Read-only, no network. Usage:
 *   node scripts/origination-sniff-tally.mjs [--dir tmp/origination-sniff]
 */
import { readFileSync, readdirSync } from 'node:fs';

const dir = (() => {
  const i = process.argv.indexOf('--dir');
  return i >= 0 ? process.argv[i + 1] : 'tmp/origination-sniff';
})();

const ARMS = ['A', 'B', 'C'];
const ARM_LABEL = { A: 'current-pipeline', B: 'grounded-retrieval', C: 'applicant-recommended' };

function parseVerdict(raw) {
  const v = (raw || '').trim();
  if (!v || v === '☐') return { judged: false };
  const low = v.toLowerCase();
  const pick = low.startsWith('yes');
  let reason = null;
  if (/died|deceased/.test(low)) reason = 'deceased';
  else if (/retired/.test(low)) reason = 'retired';
  else if (/grad student|postdoc|\bstudent\b|trainee/.test(low)) reason = 'trainee';
  else if (/wrong[\s-]?field|off[\s-]?field/.test(low)) reason = 'wrong-field';
  return { judged: true, pick, reason, raw: v };
}

function parseSheet(path) {
  const out = {};
  for (const ln of readFileSync(path, 'utf8').split('\n')) {
    const m = ln.match(/^\|\s*(\d{7}-\d+)\s*\|\s*(.+?)\s*\|\s*(.*?)\s*\|\s*$/);
    if (m) out[m[1]] = m[3];
  }
  return out;
}

const blank = () => ({ members: 0, judged: 0, pick: 0, deceased: 0, retired: 0, trainee: 0, wrongfield: 0 });
const rate = (p, n) => (n ? `${Math.round((100 * p) / n)}%` : '—');

const keyFiles = readdirSync(dir).filter((f) => f.endsWith('.key.json')).sort();
const agg = Object.fromEntries(ARMS.map((a) => [a, blank()]));
const perReq = [];

for (const kf of keyFiles) {
  const key = JSON.parse(readFileSync(`${dir}/${kf}`, 'utf8'));
  let verdicts;
  try { verdicts = parseSheet(`${dir}/${key.request}.sheet.md`); } catch { continue; }
  if (!key.candidates.some((c) => parseVerdict(verdicts[c.blindId]).judged)) continue; // unjudged sheet

  const r = { request: key.request, arms: Object.fromEntries(ARMS.map((a) => [a, blank()])), unjudged: 0 };
  for (const c of key.candidates) {
    const pv = parseVerdict(verdicts[c.blindId]);
    if (!pv.judged) r.unjudged += 1;
    for (const a of c.arms) {
      if (!ARMS.includes(a)) continue;
      const cells = [r.arms[a], agg[a]];
      for (const cell of cells) {
        cell.members += 1;
        if (pv.judged) {
          cell.judged += 1;
          if (pv.pick) cell.pick += 1;
          if (pv.reason === 'deceased') cell.deceased += 1;
          if (pv.reason === 'retired') cell.retired += 1;
          if (pv.reason === 'trainee') cell.trainee += 1;
          if (pv.reason === 'wrong-field') cell.wrongfield += 1;
        }
      }
    }
  }
  perReq.push(r);
}

const flags = (c) => {
  const f = [];
  if (c.deceased) f.push(`${c.deceased} deceased`);
  if (c.retired) f.push(`${c.retired} retired`);
  if (c.trainee) f.push(`${c.trainee} trainee`);
  if (c.wrongfield) f.push(`${c.wrongfield} wrong-field`);
  return f.length ? ` [${f.join(', ')}]` : '';
};

console.log(`\nORIGINATION SNIFF-TEST TALLY — ${perReq.length} judged request(s) in ${dir}\n`);
console.log('Arms: A=current-pipeline  B=grounded-retrieval  C=applicant-recommended');
console.log('Per-arm pick-rate = picks / judged members of that arm.\n');

for (const r of perReq) {
  const parts = ARMS.map((a) => {
    const c = r.arms[a];
    return `${a} ${c.pick}/${c.judged} (${rate(c.pick, c.judged)})${flags(c)}`;
  });
  console.log(`${r.request}${r.unjudged ? ` ·(${r.unjudged} unjudged)` : ''}`);
  for (const p of parts) console.log(`   ${p}`);
}

console.log(`\n${'─'.repeat(70)}\nAGGREGATE across ${perReq.length} request(s)`);
for (const a of ARMS) {
  const c = agg[a];
  console.log(`   ${a} ${ARM_LABEL[a].padEnd(22)} ${c.pick}/${c.judged} picked (${rate(c.pick, c.judged)})${flags(c)}`);
}
console.log('');
