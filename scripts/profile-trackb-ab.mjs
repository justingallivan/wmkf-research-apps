// A/B isolate Track B's latency cost. Both runs: identical Track A (searchPubmed=true,
// same 3 suggestions — its cost cancels in the diff). Run 1: populated searchQueries →
// Track B searches + ≤25 identity resolution. Run 2: empty searchQueries → Track B off.
// diff = Track B's marginal wall-clock. No Claude call. Run unsandboxed.
import { readFileSync } from 'node:fs';
try {
  const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* no env */ }

const { DiscoveryService } = await import('../lib/services/discovery-service.js');

const proposalInfo = { primaryResearchArea: 'Microbiology', keywords: ['bacteriophage', 'gene transfer agent', 'horizontal gene transfer', 'microbial virus'] };
const reviewerSuggestions = ['Sherwood Casjens', 'Anca Segall', 'Graham Hatfull']
  .map((name) => ({ name, expertiseAreas: ['bacteriophage', 'gene transfer agent'], suggestedInstitution: '', source: 'claude' }));

const fullQueries = {
  pubmed: ['bacteriophage gene transfer agent', 'horizontal gene transfer bacteria prophage', 'prophage domestication microbial', 'gene transfer agent Rhodobacter'],
  arxiv: ['bacteriophage evolution'],
  biorxiv: ['gene transfer agent', 'prophage domestication'],
  chemrxiv: [],
};
const emptyQueries = { pubmed: [], arxiv: [], biorxiv: [], chemrxiv: [] };

async function run(label, searchQueries) {
  const ac = new AbortController();
  const t0 = Date.now();
  const res = await DiscoveryService.discover(
    { proposalInfo, reviewerSuggestions, searchQueries },
    { searchPubmed: true, searchArxiv: true, searchBiorxiv: true, searchChemrxiv: true, proposalInfo, signal: ac.signal },
  );
  const ms = Date.now() - t0;
  const s = res.stats;
  console.log(`\n[${label}] ${(ms / 1000).toFixed(1)}s`);
  console.log(`  Track A verified: ${s.claudeSuggestionsVerified}/${s.claudeSuggestionsTotal}`);
  console.log(`  Track B candidates: pubmed=${s.candidatesFromPubmed} arxiv=${s.candidatesFromArxiv} biorxiv=${s.candidatesFromBiorxiv} chemrxiv=${s.candidatesFromChemrxiv}`);
  console.log(`  Track B identity resolved=${s.trackBIdentityResolved} deferred=${s.trackBIdentityDeferred}  discovered=${res.discovered.length}`);
  return ms;
}

const on = await run('Track B ON ', fullQueries);
const off = await run('Track B OFF', emptyQueries);
console.log(`\n=== Track B marginal cost = ${((on - off) / 1000).toFixed(1)}s  (ON ${(on / 1000).toFixed(1)}s − OFF ${(off / 1000).toFixed(1)}s) ===`);
console.log('(Track A is identical in both runs, so the diff isolates Track B: DB searches + ≤25 identity resolution.)');
