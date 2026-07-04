/**
 * probe-review-rehearsal-state.mjs — READ-ONLY. Before/after snapshot for a
 * reviewer-rehearsal cycle: given a request (number or GUID) and a reviewer
 * email, prints the request's identity + AI review-synthesis memo state
 * (`akoya_request.wmkf_reviewsynthesisjson`), the matching
 * wmkf_appreviewersuggestion row(s) (status, reviewreceivedat, external-token
 * hash presence/revoked), and the submitted-answer row count
 * (wmkf_appreviewanswer). Companion to reset-reviewer-for-testing.js's
 * --clear-synthesis: run this before and after a reset/clear to confirm the
 * intended state actually changed.
 *
 * No writes, ever. Same .env.local + Dynamics-bypass pattern as the other
 * scripts/probe-*.mjs tools.
 *
 *   node scripts/probe-review-rehearsal-state.mjs --requestNumber 1002788 --email x@y.org
 *   node scripts/probe-review-rehearsal-state.mjs --requestId <guid> --email x@y.org
 */

import fs from 'fs';

try {
  const env = fs.readFileSync('.env.local', 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !(m[1] in process.env)) {
      process.env[m[1]] = m[2].trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
    }
  }
} catch {
  console.error('Could not read .env.local — run from the repo root.');
  process.exit(2);
}

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const REQUEST_NUMBER = arg('requestNumber');
const REQUEST_ID = arg('requestId');
const EMAIL = arg('email');
const isGuid = (s) => typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

if (!EMAIL || (!REQUEST_NUMBER && !REQUEST_ID)) {
  console.error('Usage: node scripts/probe-review-rehearsal-state.mjs --email x@y.org (--requestNumber <num> | --requestId <guid>)');
  process.exit(2);
}

const { DynamicsService } = await import('../lib/services/dynamics-service.js');
const { enterDynamicsBypassForScript } = await import('../lib/services/dynamics-context.js');
const potentialReviewerAdapter = await import('../lib/dataverse/adapters/potential-reviewer.js');
const suggestionAdapter = await import('../lib/dataverse/adapters/reviewer-suggestion.js');
const { RESPONSE_TYPE_BY_VALUE } = suggestionAdapter;

enterDynamicsBypassForScript('probe-review-rehearsal-state');

const REQUESTS_ENTITY = 'akoya_requests';

console.log('\n=== probe-review-rehearsal-state (READ-ONLY) ===\n');

// ── Resolve the request ──
let request;
if (REQUEST_ID) {
  if (!isGuid(REQUEST_ID)) throw new Error('--requestId must be a GUID');
  request = await DynamicsService.getRecord(REQUESTS_ENTITY, REQUEST_ID, {
    select: 'akoya_requestid,akoya_title,akoya_requestnum,wmkf_reviewsynthesisjson',
  });
} else {
  const { records } = await DynamicsService.queryRecords(REQUESTS_ENTITY, {
    select: 'akoya_requestid,akoya_title,akoya_requestnum,wmkf_reviewsynthesisjson',
    filter: `akoya_requestnum eq '${REQUEST_NUMBER}'`,
    top: 2,
  });
  if (records.length === 0) throw new Error(`No request with number ${REQUEST_NUMBER}`);
  if (records.length > 1) throw new Error(`Ambiguous: ${records.length} requests match number ${REQUEST_NUMBER}`);
  request = records[0];
}

const synthesisPopulated = request.wmkf_reviewsynthesisjson != null && request.wmkf_reviewsynthesisjson !== '';
console.log('Request:');
console.log(`  guid=${request.akoya_requestid}`);
console.log(`  number=${request.akoya_requestnum ?? '(none)'}`);
console.log(`  title="${request.akoya_title ?? '(none)'}"`);
console.log(`  synthesis populated? ${synthesisPopulated ? `YES (${request.wmkf_reviewsynthesisjson.length} chars)` : 'no'}`);

// ── Resolve the reviewer ──
const person = await potentialReviewerAdapter.getByEmail(EMAIL);
if (!person) throw new Error(`No potential reviewer with email ${EMAIL}`);
console.log(`\nReviewer: "${person.wmkf_name}" (person=${person.wmkf_potentialreviewersid})`);

// ── Matching suggestion row(s) for this (person, request) ──
const suggestion = await suggestionAdapter.findByPotentialReviewerAndRequest(
  person.wmkf_potentialreviewersid, request.akoya_requestid,
);

if (!suggestion) {
  console.log('\nSuggestion: none found for this (reviewer, request) pair.');
} else {
  const responseType = RESPONSE_TYPE_BY_VALUE[suggestion.wmkf_responsetype] ?? (suggestion.wmkf_responsetype ?? 'null');
  console.log('\nSuggestion:');
  console.log(`  id=${suggestion.wmkf_appreviewersuggestionid}`);
  console.log(`  selected=${suggestion.wmkf_selected} invited=${suggestion.wmkf_invited} accepted=${suggestion.wmkf_accepted} declined=${suggestion.wmkf_declined}`);
  console.log(`  reviewstatus=${suggestion.wmkf_reviewstatus ?? 'null'}  responsetype=${responseType}`);
  console.log(`  reviewreceivedat=${suggestion.wmkf_reviewreceivedat ?? 'null'}`);
  console.log(`  externaltokenhash present? ${suggestion.wmkf_externaltokenhash ? 'yes' : 'no'}`);
  console.log(`  externaltokenexpires=${suggestion.wmkf_externaltokenexpires ?? 'null'}`);
  console.log(`  externaltokenrevoked=${suggestion.wmkf_externaltokenrevoked}`);

  // ── Submitted-answer row count for this suggestion ──
  const answerSet = await DynamicsService.resolveEntitySetName('wmkf_appreviewanswer');
  const answerPk = await DynamicsService.getPrimaryIdAttribute(answerSet);
  const { records: answers } = await DynamicsService.queryAllRecords(answerSet, {
    select: answerPk,
    filter: `_wmkf_appreviewersuggestion_value eq ${suggestion.wmkf_appreviewersuggestionid}`,
  });
  console.log(`\nAnswer rows (wmkf_appreviewanswer): ${answers.length}`);
}

console.log('\n=== done (no writes) ===\n');
process.exit(0);
