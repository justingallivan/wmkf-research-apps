/**
 * LIVE contract probe for the Perplexity Search API (Track C) — the on-demand
 * "live contract test" plan §11 calls for (a script, NOT a jest test, so a paid
 * network call never fires during `npm test` / CI). Mirrors the EXACT request
 * lib/services/web-discovery-service.js builds (_perplexitySearch): body
 * { query, max_results: 10, search_after_date_filter } with the date in M/D/YYYY
 * and a 5-year recency window. Validates §5 of docs/REVIEWER_WEB_DISCOVERY_PLAN.md
 * against a real response. Reads the key from env or .env.local; never prints it.
 *
 * VERIFIED LIVE 2026-06-05: HTTP 200 (account entitled to /search, not just sonar
 * chat); M/D/YYYY date filter accepted + honored (no result predated the window);
 * results[] carry { title, url, snippet, date, last_updated } 10/10. Observed:
 * snippets can be ~8KB (faculty/lab pages) — see WEB_RESULTS_MAX_CHARS truncation.
 *
 * Run: node scripts/probe-perplexity-search.mjs
 */
import { readFileSync } from 'node:fs';

function loadKey() {
  if (process.env.PERPLEXITY_API_KEY) return process.env.PERPLEXITY_API_KEY;
  try {
    const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
    const m = env.match(/^PERPLEXITY_API_KEY=(.+)$/m);
    if (m) return m[1].trim().replace(/^["']|["']$/g, '');
  } catch { /* fall through */ }
  return null;
}

// Same constants/format as the service.
const RECENCY_YEARS = 5;
const MAX_RESULTS_PER_QUERY = 10;
const formatDate = (d) => `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;

const key = loadKey();
if (!key) { console.error('No PERPLEXITY_API_KEY found (env or .env.local).'); process.exit(2); }

const after = new Date();
after.setFullYear(after.getFullYear() - RECENCY_YEARS);
const dateFilter = formatDate(after);

const body = {
  query: 'synthetic biology engineered gene circuits research lab faculty',
  max_results: MAX_RESULTS_PER_QUERY,
  search_after_date_filter: dateFilter,
};

console.log('→ POST https://api.perplexity.ai/search');
console.log('  search_after_date_filter =', dateFilter, '(M/D/YYYY)');
console.log('  query =', JSON.stringify(body.query));

const resp = await fetch('https://api.perplexity.ai/search', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
  body: JSON.stringify(body),
});

console.log('\n← HTTP', resp.status, resp.statusText);
const data = await resp.json().catch(() => ({}));

if (!resp.ok) {
  console.log('ERROR body:', JSON.stringify(data).slice(0, 800));
  process.exit(1);
}

console.log('top-level keys:', Object.keys(data));
const results = Array.isArray(data?.results) ? data.results : null;
console.log('results is array:', Array.isArray(results), '· count:', results?.length ?? 'n/a');

if (results?.length) {
  const r0 = results[0];
  console.log('\nresults[0] keys:', Object.keys(r0));
  console.log('sample result[0]:', JSON.stringify({
    title: r0.title,
    url: r0.url,
    snippet_len: (r0.snippet || '').length,
    snippet_preview: (r0.snippet || '').slice(0, 120),
    date: r0.date ?? null,
    last_updated: r0.last_updated ?? null,
  }, null, 2));

  const withTitle = results.filter((r) => typeof r.title === 'string' && r.title).length;
  const withUrl = results.filter((r) => typeof r.url === 'string' && /^https?:\/\//i.test(r.url)).length;
  const withSnippet = results.filter((r) => typeof r.snippet === 'string' && r.snippet).length;
  const withDate = results.filter((r) => r.date).length;
  console.log(`\nshape coverage: title ${withTitle}/${results.length} · http(s) url ${withUrl}/${results.length} · snippet ${withSnippet}/${results.length} · date ${withDate}/${results.length}`);

  // Did the date filter actually constrain results? (None should predate `after`.)
  const older = results.filter((r) => r.date && new Date(r.date) < after).map((r) => r.date);
  console.log(`date filter honored: ${older.length === 0 ? 'YES — no result predates the window' : `NO — ${older.length} predate it`}`, older.slice(0, 3));
}
