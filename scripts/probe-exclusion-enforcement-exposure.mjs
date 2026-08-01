/**
 * Read-only exposure scan for Finding D of the Session 393 Fable assessment
 * (`outputs/reviewer-workflow-stabilization-fable-assessment.md`).
 *
 * THE QUESTION: how many requests have an applicant exclusion that the search
 * can never enforce?
 *
 * Exclusion enforcement is exact normalized-NAME set membership
 * (`lib/utils/reviewer-name-match.js` `partitionByExcluded`). An applicant
 * answer that states a CATEGORY rather than people ("direct competitors",
 * "anyone at my former institution") parses to zero names, so the excluded set
 * is empty and NOTHING is filtered — while the applicant reasonably believes
 * they excluded someone. That is fail-open, and it is invisible from the UI.
 *
 * This script classifies every request's stored `wmkf_excludedreviewers` into:
 *   - not_substantive : blank / "N/A" style. No exposure, no LLM call spent.
 *   - names_extracted : the parser found names → the soft-block can act.
 *   - ZERO_NAMES      : substantive text that yielded NO names → FAIL-OPEN.
 *   - parse_failed    : the LLM ran but its output was unusable → also unenforced.
 *
 * For each fail-open request it then reports whether reviewers were actually
 * selected on that request — the difference between "an applicant said
 * something vague" and "we picked reviewers while an exclusion went unenforced".
 *
 * READ-ONLY. Dataverse GETs only; no create/update/delete, no Postgres writes.
 * Safe against Production. It DOES spend one Haiku call per substantive answer
 * (same model namespace the live path uses), so it is bounded by --limit.
 *
 * Usage:
 *   DATAVERSE_ALLOW_PROD_READS=yes node --import ./scripts/lib/use-extensionless.mjs \
 *     scripts/probe-exclusion-enforcement-exposure.mjs [--limit 200] [--since 2026-01-01] [--show-text]
 *
 *   --limit N      max requests with a non-empty exclusion field (default 200)
 *   --since DATE   only requests created on/after DATE (default: no floor)
 *   --show-text    print the applicant's raw text (PII; redacted by default)
 *   --no-impact    skip the "were reviewers selected anyway?" follow-up query
 *   --include-test include AkoyaGO test records (applicant = the Foundation
 *                  itself). Excluded by default — they carry synthetic
 *                  exclusion text that would otherwise inflate every count.
 */
import { readFileSync } from 'node:fs';

try {
  const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !(m[1] in process.env)) {
      process.env[m[1]] = m[2].trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
    }
  }
} catch {}

const args = process.argv.slice(2);
const showText = args.includes('--show-text');
const skipImpact = args.includes('--no-impact');
const includeTest = args.includes('--include-test');
const argVal = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
};
const limit = Math.min(Math.max(Number(argVal('--limit')) || 200, 1), 2000);
const since = argVal('--since');
if (since && !/^\d{4}-\d{2}-\d{2}$/.test(since)) {
  console.error('--since must be YYYY-MM-DD');
  process.exit(2);
}

const { DynamicsService } = await import('../lib/services/dynamics-service.js');
const { enterDynamicsBypassForScript } = await import('../lib/services/dynamics-context.js');
enterDynamicsBypassForScript('probe-exclusion-enforcement-exposure');
const { extractExcludedReviewers, isSubstantiveExclusionText } = await import('../lib/services/reviewer-exclusion-parser.js');
const { loadModelOverrides } = await import('../lib/services/model-override-loader.js');

// Mirror the live route: the parser resolves its model through the override
// registry, so warm it before the first call or the script could silently
// exercise a different model than production does.
await loadModelOverrides();

function preview(text) {
  const flat = String(text).replace(/\s+/g, ' ').trim();
  if (showText) return flat.slice(0, 300);
  // Keep the SHAPE legible (length, whether it looks like names or prose)
  // without printing applicant-authored PII by default.
  const words = flat.split(' ').length;
  return `[redacted — ${flat.length} chars, ${words} word(s); pass --show-text to read]`;
}

// Test-record predicate (scripts/probe-akoya-test-record-predicate.js): AkoyaGO
// staff mark test rows by making the Foundation its own applicant. Without this
// the counts below are inflated by synthetic data — the first run's single
// "genuine category exclusion" (request 1001931) turned out to be exactly that.
const TEST_ORG_NAME = 'W. M. Keck Foundation';
const { records: testAccounts } = await DynamicsService.queryRecords('accounts', {
  select: 'accountid,name',
  filter: `name eq '${TEST_ORG_NAME.replace(/'/g, "''")}'`,
  top: 10,
});
const testAccountIds = new Set(testAccounts.map((a) => String(a.accountid).toLowerCase()));
const isTestRequest = (r) => testAccountIds.has(String(r._akoya_applicantid_value || '').toLowerCase());

const filters = ['wmkf_excludedreviewers ne null'];
if (since) filters.push(`createdon ge ${since}T00:00:00Z`);

// NB: queryAllRecords paginates to completion — its `top` is the PAGE size, not
// a total cap — so the cap must be applied here. (Caught on the first real run:
// --limit 200 returned 294 rows.)
const { records: allRows } = await DynamicsService.queryAllRecords('akoya_requests', {
  select: 'akoya_requestid,akoya_requestnum,akoya_title,wmkf_excludedreviewers,createdon,_akoya_applicantid_value',
  filter: filters.join(' and '),
  orderby: 'createdon desc',
});
const testRows = allRows.filter(isTestRequest);
const allRequests = includeTest ? allRows : allRows.filter((r) => !isTestRequest(r));
const requests = allRequests.slice(0, limit);
const truncated = allRequests.length - requests.length;

console.log('READ-ONLY exclusion-enforcement exposure scan (Finding D)');
console.log(`limit=${limit}${since ? ` since=${since}` : ''} showText=${showText} includeTest=${includeTest}\n`);
console.log(`Requests with a non-null exclusion field: ${allRows.length}`);
console.log(`  test records (applicant = "${TEST_ORG_NAME}"): ${testRows.length}${includeTest ? ' — INCLUDED (--include-test)' : ' — excluded'}`);
console.log(`  real requests examined: ${allRequests.length}`);
if (truncated > 0) {
  console.log(`  ⚠ scanning the ${requests.length} most recent; ${truncated} NOT examined — raise --limit for full coverage`);
}

const buckets = { not_substantive: [], names_extracted: [], zero_names: [], parse_failed: [], error: [] };

for (const r of requests) {
  const raw = r.wmkf_excludedreviewers;
  const row = { id: r.akoya_requestid, num: r.akoya_requestnum, raw, created: r.createdon };
  if (!isSubstantiveExclusionText(raw)) {
    buckets.not_substantive.push(row);
    continue;
  }
  try {
    const parsed = await extractExcludedReviewers(raw, {});
    row.names = parsed.names || [];
    if (parsed.parseFailed) buckets.parse_failed.push(row);
    else if (row.names.length === 0) buckets.zero_names.push(row);
    else buckets.names_extracted.push(row);
  } catch (err) {
    row.error = err.message;
    buckets.error.push(row);
  }
}

const substantive = requests.length - buckets.not_substantive.length;
const unenforced = buckets.zero_names.length + buckets.parse_failed.length;

console.log(`  ...blank / "N/A" style (no exposure):        ${buckets.not_substantive.length}`);
console.log(`  ...substantive (a real exclusion attempt):   ${substantive}`);
console.log('');
console.log('─'.repeat(78));
console.log('Of the substantive answers:');
console.log(`  ENFORCEABLE — names extracted:              ${buckets.names_extracted.length}`);
console.log(`  FAIL-OPEN  — substantive but ZERO names:    ${buckets.zero_names.length}`);
console.log(`  FAIL-OPEN  — parser output unusable:        ${buckets.parse_failed.length}`);
console.log(`  errored (inconclusive, re-run):             ${buckets.error.length}`);
console.log('');
if (substantive > 0) {
  const pct = ((unenforced / substantive) * 100).toFixed(1);
  console.log(`  → ${unenforced} of ${substantive} substantive exclusions (${pct}%) block nobody.`);
} else {
  console.log('  → no substantive exclusions in this window; nothing to enforce.');
}
console.log('');

async function selectedReviewerCount(requestId) {
  const { records } = await DynamicsService.queryRecords('wmkf_appreviewersuggestions', {
    select: 'wmkf_appreviewersuggestionid,wmkf_invited',
    filter: `_wmkf_request_value eq ${requestId} and wmkf_selected eq true`,
    top: 200,
  });
  return {
    selected: records.length,
    invited: records.filter((x) => x.wmkf_invited === true).length,
  };
}

const failOpen = [...buckets.zero_names, ...buckets.parse_failed];
if (failOpen.length) {
  console.log('─'.repeat(78));
  console.log('FAIL-OPEN REQUESTS (applicant stated an exclusion; search blocked nobody)');
  if (!skipImpact) console.log('with the reviewers actually selected on each — impact, not just presence:');
  console.log('');
  for (const row of failOpen) {
    let impact = '';
    if (!skipImpact) {
      try {
        const c = await selectedReviewerCount(row.id);
        impact = `  selected=${c.selected} invited=${c.invited}`;
        if (c.invited > 0) impact += '  ← reviewers were INVITED under an unenforced exclusion';
      } catch (err) {
        impact = `  [impact query failed: ${err.message}]`;
      }
    }
    console.log(`  request ${row.num || row.id}  created=${(row.created || '').slice(0, 10)}${impact}`);
    console.log(`      ${preview(row.raw)}`);
  }
  console.log('');
  console.log('Each line is a request where the applicant named an exclusion the system');
  console.log('could not act on. Staff MAY have hand-entered names into the editable');
  console.log('exclusion box at search time — that is not recorded on the request, so');
  console.log('these are leads to review, not confirmed unhonored exclusions.');
} else {
  console.log('No fail-open exclusions found in this window.');
}

// Base rate. "Every fail-open request had zero reviewers" is only reassuring if
// comparable requests normally DO have reviewers — otherwise the impact column
// is measuring "this request never went to review", not "the exclusion was
// harmless". Sample the ENFORCEABLE bucket to get that comparison denominator.
if (!skipImpact && failOpen.length && buckets.names_extracted.length) {
  const sample = buckets.names_extracted.slice(0, 20);
  let withReviewers = 0;
  let sampled = 0;
  for (const row of sample) {
    try {
      const c = await selectedReviewerCount(row.id);
      sampled += 1;
      if (c.selected > 0) withReviewers += 1;
    } catch { /* skip; reported via `sampled` */ }
  }
  console.log('');
  console.log('─'.repeat(78));
  console.log('BASE RATE (how to read the impact column above)');
  console.log(`  of ${sampled} sampled requests whose exclusion WAS enforceable, ${withReviewers} have selected reviewers.`);
  if (sampled > 0 && withReviewers === 0) {
    console.log('  → comparable requests also have no reviewers, so the zero-impact reading');
    console.log('    above is WEAK: it likely reflects requests that never reached reviewer');
    console.log('    selection at all, not that the unenforced exclusions were harmless.');
  } else if (sampled > 0) {
    const pct = ((withReviewers / sampled) * 100).toFixed(0);
    console.log(`  → ${pct}% of comparable requests do reach reviewer selection, so a fail-open`);
    console.log('    request with zero selected reviewers is meaningfully unharmed.');
  }
}

if (buckets.error.length) {
  console.log('');
  console.log(`${buckets.error.length} request(s) errored and are UNCLASSIFIED — the counts above`);
  console.log('exclude them, so treat this run as a lower bound until they are re-run.');
}

console.log('');
console.log('─'.repeat(78));
console.log('Scan complete. No records were modified.');
