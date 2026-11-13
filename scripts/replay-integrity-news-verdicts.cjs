#!/usr/bin/env node
/**
 * Re-judges the stored news results of every person the old news rule flagged
 * (`hasConcerns` true) with the structured news rule from 318f9642c/35a445bec,
 * through the real `IntegrityService.searchNews` path. No new search is made:
 * `serpSearch` returns the stored results (at most the 5 kept per person).
 *
 * Prints case numbers, dates and outcomes only: no names, headlines or links.
 *
 * Costs and side effects (owner-run):
 * - One model call per flagged person, with the app's CLAUDE_API_KEY.
 * - Each call writes a usage row to `api_usage_log` in POSTGRES_URL's database
 *   (the normal LLM client accounting).
 * - Model overrides are read from Dataverse settings, as the app does.
 * The screenings themselves are read inside a READ ONLY transaction and are
 * not changed.
 *
 * Limits: old flags came from a substring rule ("no concerns found"), so they
 * are not ground truth, and the article behind an old flag may not be among
 * the 5 stored results.
 *
 * Usage:
 *   node scripts/replay-integrity-news-verdicts.cjs
 */
const path = require('node:path');
const dotenv = require('dotenv');
const { Client } = require('pg');
const { withVerifyFullSslmode } = require('../lib/db/pg-connection-string');

dotenv.config({ path: path.join(__dirname, '..', '.env.local'), quiet: true });

async function readFlaggedCases() {
  const client = new Client({ connectionString: withVerifyFullSslmode(process.env.POSTGRES_URL) });
  await client.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const { rows } = await client.query(`
      SELECT s.created_at::date AS screened_on, p.person ->> 'name' AS name,
             p.person ->> 'institution' AS institution,
             p.person -> 'sources' -> 'news' -> 'rawResults' AS raw_results,
             (p.person -> 'sources' -> 'news' ->> 'resultCount')::int AS result_count
      FROM integrity_screenings s
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(s.results) = 'array' THEN s.results ELSE '[]'::jsonb END
      ) WITH ORDINALITY AS p(person, ord)
      WHERE (p.person -> 'sources' -> 'news' ->> 'searched') = 'true'
        AND (p.person -> 'sources' -> 'news' ->> 'hasConcerns') = 'true'
      ORDER BY s.created_at, s.id, p.ord
    `);
    await client.query('ROLLBACK');
    return rows;
  } finally {
    await client.end();
  }
}

function modelOutcome(text) {
  if (typeof text !== 'string') return 'no response';
  try {
    const fenced = text.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    const parsed = JSON.parse(fenced?.[1] ?? text);
    // Print only fixed labels: a malformed response may carry names or links.
    const outcome = ['flag_for_review', 'clear', 'inconclusive'].includes(parsed?.outcome) ? parsed.outcome : 'unrecognized outcome';
    const findings = Array.isArray(parsed?.findings) ? String(parsed.findings.length) : '?';
    return `${outcome} (${findings} findings)`;
  } catch {
    return 'not JSON';
  }
}

async function main() {
  if (process.env.VERCEL_ENV === 'production') throw new Error('Run locally: the structured rule is held in Production.');
  if (!process.env.POSTGRES_URL) throw new Error('POSTGRES_URL is not set');
  if (!process.env.CLAUDE_API_KEY) throw new Error('CLAUDE_API_KEY is not set');
  console.log(`database host: ${new URL(process.env.POSTGRES_URL).hostname}`);

  const { loadModelOverrides } = require('../lib/services/model-override-loader');
  const { getModelForApp } = require('../shared/config/baseConfig');
  const { IntegrityService } = require('../lib/services/integrity-service');
  await loadModelOverrides();
  console.log(`model: ${getModelForApp('integrity-screener')}`);

  const cases = await readFlaggedCases();
  console.log(`old-rule flags: ${cases.length}\n`);

  let stored = [];
  IntegrityService.serpSearch = async () => { const items = stored; stored = []; return items; };
  let rawText = null;
  const analyze = IntegrityService.analyzeWithHaiku.bind(IntegrityService);
  IntegrityService.analyzeWithHaiku = async (...args) => { rawText = await analyze(...args); return rawText; };

  const tally = {};
  for (const [index, row] of cases.entries()) {
    stored = Array.isArray(row.raw_results) ? row.raw_results : [];
    const storedCount = stored.length;
    rawText = null;
    let verdict;
    try {
      const news = await IntegrityService.searchNews(row.name, row.institution || '', 'stored-results', process.env.CLAUDE_API_KEY, {});
      verdict = news.analysisOutcome;
    } catch (error) {
      // No model answer means setup or provider trouble, not a verdict: stop.
      if (rawText === null) throw new Error(`case ${index + 1}: the model was not reached (${error.message}); stopping.`);
      verdict = 'rejected by the evidence check';
    }
    tally[verdict] = (tally[verdict] || 0) + 1;
    const screenedOn = row.screened_on instanceof Date ? row.screened_on.toISOString().slice(0, 10) : row.screened_on;
    console.log(`case ${index + 1} (${screenedOn}): ${storedCount} of ${row.result_count ?? '?'} results stored; model: ${rawText === null ? 'not called' : modelOutcome(rawText)}; new verdict: ${verdict}`);
  }

  console.log('\nnew verdicts:');
  for (const [verdict, count] of Object.entries(tally)) console.log(`  ${verdict}: ${count}`);
}

main().catch((error) => { console.error(error.message); process.exit(1); });
