// Profile the SEQUENTIAL Track-A verify loop (verifyClaudeSuggestions).
// Uses the real 1002878 Arm-A names (Claude's actual suggestions for a microbial
// gene-transfer-agent proposal). onProgress fires per candidate → per-candidate stopwatch.
// One run of 15 yields the 12-count time, the 15-count time, and the marginal +3.
// Run unsandboxed (PubMed/OpenAlex network). Verify-only — analyze + ranking + enrichment are additional.
import { readFileSync } from 'node:fs';

try {
  const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* no env file */ }

const { DiscoveryService } = await import('../lib/services/discovery-service.js');

const names = [
  'Evangeline Christina', 'Sherwood Casjens', 'S K Girisha', 'Mao Lin', 'Christoph Dehio',
  'Zhe Zhao', 'Anca Segall', 'Jingxue Wang', 'Tung Le', 'Qiang Li',
  'Kimberley Seed', 'Luciano Marraffini', 'Forest Rohwer', 'Eduardo Rocha', 'Partho Ghosh',
];
const expertiseAreas = ['bacteriophage', 'gene transfer agent', 'microbial genomics', 'horizontal gene transfer'];
const suggestions = names.map((n) => ({ name: n, expertiseAreas, suggestedInstitution: '', source: 'claude', reasoning: '' }));
const proposalInfo = { primaryResearchArea: 'Microbiology', keywords: ['bacteriophage', 'gene transfer agent', 'horizontal gene transfer', 'microbial virus'] };

const ac = new AbortController();
const marks = [];
const onProgress = (ev) => { if (ev?.status === 'verifying') marks.push(Date.now()); };

const t0 = Date.now();
const res = await DiscoveryService.verifyClaudeSuggestions(suggestions, onProgress, { proposalInfo, searchPubmed: true, signal: ac.signal });
const tEnd = Date.now();

console.log('\nper-candidate verify time (sequential loop):');
for (let i = 0; i < marks.length; i++) {
  const end = i + 1 < marks.length ? marks[i + 1] : tEnd;
  console.log(`  ${String(i + 1).padStart(2)}. ${(names[i] || '?').padEnd(22)} ${String(end - marks[i]).padStart(6)} ms`);
}

const loopStart = marks[0] ?? t0;
const total = tEnd - loopStart;
const t12 = (marks[12] ?? tEnd) - loopStart; // start of #13 = end of #12
console.log(`\nverified: ${res.verified.length}  unresolved: ${res.unverified.length}  (of ${names.length})`);
console.log(`verify loop, 12 candidates: ${(t12 / 1000).toFixed(1)}s`);
console.log(`verify loop, 15 candidates: ${(total / 1000).toFixed(1)}s`);
console.log(`marginal 12→15 (+3):        ${((total - t12) / 1000).toFixed(1)}s`);
console.log(`avg per candidate:          ${Math.round(total / marks.length)} ms`);
console.log(`\nbudget: default 600s (maxDuration 800s). This is VERIFY-ONLY; analyze (~50s) + ranking + enrichment add on top.`);
