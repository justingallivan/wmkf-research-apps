#!/usr/bin/env node
/**
 * TEST TOOL — reset a reviewer to pre-invite pristine so the full PD→reviewer
 * E2E (invite → accept/decline → materials → submit review) can be re-run on a
 * reusable test reviewer without creating a new person + email each time.
 *
 * Scope (one suggestion = one reviewer on one request):
 *   1. DELETE all wmkf_appreviewanswer child rows (the submitted review snapshot).
 *   2. DELETE the review draft (ReviewDraftService.deleteBySuggestion).
 *   3. PATCH the suggestion row back to { selected:true, invited:false } with every
 *      lifecycle/response/token/review field cleared.
 *   4. PATCH the person row to clear the 3 board-identity fields (rank/dept/institution).
 * Leaves the core person + contact identity (name/email) intact so it's reusable.
 * Clears the honorarium-request LOOKUP on the suggestion (so a live-mode test row
 * isn't treated as already-onboarded) but does NOT delete an akoya_request row —
 * accept is capture-only in prod, so normally there is none.
 *
 * Target:  --email <addr> --requestNumber <num>   (or --suggestionId <guid>)
 * DRY-RUN by default; --commit to write. Idempotent. Refuses ambiguous targets,
 * applicant-disposition rows, and reviewers whose name lacks "test" (override
 * with --force). Parent PATCH runs before the child deletes (crash-safe order).
 *
 *   node scripts/reset-reviewer-for-testing.js --email x@y.org --requestNumber 1002788
 *   node scripts/reset-reviewer-for-testing.js --email x@y.org --requestNumber 1002788 --commit
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, '..', '.env.local');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (!m) continue;
    let [, k, v] = m; v = v.trim().replace(/^"(.*)"$/, '$1'); if (!process.env[k]) process.env[k] = v;
  }
}

function arg(name) { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : undefined; }
const COMMIT = process.argv.includes('--commit');
const FORCE = process.argv.includes('--force'); // override the test-row heuristic
const EMAIL = arg('email');
const REQUEST_NUMBER = arg('requestNumber');
const SUGGESTION_ID = arg('suggestionId');

const { DynamicsService } = await import('../lib/services/dynamics-service.js');
const { bypassDynamicsRestrictions } = await import('../lib/services/dynamics-context.js');
const suggestionAdapter = await import('../lib/dataverse/adapters/reviewer-suggestion.js');
const potentialReviewerAdapter = await import('../lib/dataverse/adapters/potential-reviewer.js');
const draftMod = await import('../lib/services/review-draft-service.js');
const ReviewDraftService = draftMod.default || draftMod;

const SUGG_ENTITY = 'wmkf_appreviewersuggestions';
const PERSON_ENTITY = 'wmkf_potentialreviewerses';
const isGuid = (s) => typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

// Pristine suggestion state: selected + not-yet-invited, everything downstream cleared.
const RESET_PATCH = {
  wmkf_selected: true,
  wmkf_invited: false,
  wmkf_accepted: false,
  wmkf_declined: false,
  wmkf_externaltokenrevoked: false,
  wmkf_reviewuploadedbystaff: false,
  wmkf_honorariumoptout: false,
  wmkf_responsetype: null,
  wmkf_emailsentat: null,
  wmkf_responsereceivedat: null,
  wmkf_materialssentat: null,
  wmkf_remindersentat: null,
  wmkf_remindercount: null,
  wmkf_respondremindersentat: null,
  wmkf_reviewreceivedat: null,
  wmkf_thankyousentat: null,
  wmkf_reviewfilename: null,
  wmkf_reviewstatus: null,
  wmkf_heldat: null,
  wmkf_externaltokenhash: null,
  wmkf_externaltokenissued: null,
  wmkf_externaltokenexpires: null,
  wmkf_proposalfirstaccessed: null,
  wmkf_reviewsharepointfolder: null,
  wmkf_summarybloburl: null,
  wmkf_withdrawnsufficientat: null,
  wmkf_coiackedat: null,
  wmkf_aiuseackedat: null,
  wmkf_declinereason: null,
  wmkf_declinereasonpicklist: null,
  wmkf_declinereferral: null,
  wmkf_reviewerfirstname: null,
  wmkf_reviewerlastname: null,
  wmkf_reviewernickname: null,
  wmkf_reviewertitle: null,
  wmkf_revieweremail: null,
  wmkf_reviewerorcid: null,
  wmkf_revieweraffiliation: null,
  wmkf_completedat: null,                     // PD-closeout stamp (Codex P1)
  wmkf_reviewbloburl: null,                   // legacy Vercel-Blob URL (retired)
  // NOTE: the honorarium lookup (_wmkf_honorariumrequest_value) is cleared by a
  // separate disassociate() call below — a `<NavProp>@odata.bind: null` PATCH is
  // NOT accepted by Dataverse (dynamics-service.js:956).
};
// Single-valued nav property for the honorarium lookup (matches the @odata.bind
// used by setHonorariumRequest); cleared via $ref DELETE, idempotent on absence.
const HONORARIUM_NAV_PROP = 'wmkf_HonorariumRequest';
const PERSON_PATCH = { wmkf_academicrank: null, wmkf_primarydepartment: null, wmkf_maininstitution: null };

console.log('# reset-reviewer-for-testing');
console.log(`Mode: ${COMMIT ? 'COMMIT (writing)' : 'DRY-RUN (no writes)'}\n`);

await bypassDynamicsRestrictions('reset-reviewer-for-testing', async () => {
  // ── Resolve the target suggestion ──
  let suggestion;
  if (SUGGESTION_ID) {
    if (!isGuid(SUGGESTION_ID)) throw new Error('--suggestionId must be a GUID');
    suggestion = await DynamicsService.getRecord(SUGG_ENTITY, SUGGESTION_ID, {
      select: 'wmkf_appreviewersuggestionid,_wmkf_potentialreviewer_value,_wmkf_request_value,wmkf_invited,wmkf_accepted,wmkf_declined,wmkf_responsetype,wmkf_reviewreceivedat,wmkf_applicantdisposition',
    });
  } else {
    if (!EMAIL || !REQUEST_NUMBER) throw new Error('Provide --email AND --requestNumber (or --suggestionId)');
    const person = await potentialReviewerAdapter.getByEmail(EMAIL);
    if (!person) throw new Error(`No potential reviewer with email ${EMAIL}`);
    const { records: reqs } = await DynamicsService.queryRecords('akoya_requests', {
      select: 'akoya_requestid,akoya_title', filter: `akoya_requestnum eq '${REQUEST_NUMBER}'`, top: 2,
    });
    if (reqs.length === 0) throw new Error(`No request with number ${REQUEST_NUMBER}`);
    if (reqs.length > 1) throw new Error(`Ambiguous: ${reqs.length} requests match number ${REQUEST_NUMBER}`);
    suggestion = await suggestionAdapter.findByPotentialReviewerAndRequest(
      person.wmkf_potentialreviewersid, reqs[0].akoya_requestid,
    );
    if (!suggestion) throw new Error(`${EMAIL} is not a candidate on request ${REQUEST_NUMBER}`);
  }
  const suggestionId = suggestion.wmkf_appreviewersuggestionid;
  const personId = suggestion._wmkf_potentialreviewer_value;
  const person = await DynamicsService.getRecord(PERSON_ENTITY, personId, { select: 'wmkf_name' }).catch(() => null);
  const personName = person?.wmkf_name || '(unknown)';
  console.log(`Target suggestion: ${suggestionId}`);
  console.log(`  reviewer="${personName}"  person=${personId}  request=${suggestion._wmkf_request_value}`);
  console.log(`  current: invited=${suggestion.wmkf_invited} accepted=${suggestion.wmkf_accepted} declined=${suggestion.wmkf_declined} responseType=${suggestion.wmkf_responsetype ?? 'null'} reviewReceivedAt=${suggestion.wmkf_reviewreceivedat ?? 'null'}\n`);

  // ── Safety guards (Codex P1) ──
  // 1. Never touch an applicant-sourced row (recommended/excluded). The adapter's
  //    restore() refuses these; this script bypasses the adapter, so guard here too.
  if (suggestion.wmkf_applicantdisposition !== null && suggestion.wmkf_applicantdisposition !== undefined) {
    throw new Error(`Refusing: applicant-disposition row (disposition=${suggestion.wmkf_applicantdisposition}). Not a normal test candidate.`);
  }
  // 2. Test-row heuristic: test reviewers are named with "test". Refuse a real-looking
  //    reviewer unless --force is passed, so a mistargeted email/GUID can't wipe a
  //    genuine reviewer's response state.
  if (!/test/i.test(personName) && !FORCE) {
    throw new Error(`Refusing: reviewer "${personName}" does not look like a test row (name lacks "test"). Re-run with --force if you are certain.`);
  }

  // ── Review-answer snapshot rows ──
  const answerSet = await DynamicsService.resolveEntitySetName('wmkf_appreviewanswer');
  const answerPk = await DynamicsService.getPrimaryIdAttribute(answerSet);
  const { records: answers } = await DynamicsService.queryAllRecords(answerSet, {
    select: answerPk, filter: `_wmkf_appreviewersuggestion_value eq ${suggestionId}`,
  });
  console.log(`Review-answer rows to delete: ${answers.length}`);

  if (!COMMIT) {
    console.log(`Review draft: would delete via ReviewDraftService.deleteBySuggestion`);
    console.log(`Suggestion PATCH: ${Object.keys(RESET_PATCH).length} field(s) → pristine (selected:true, invited:false)`);
    console.log(`Honorarium lookup: would clear via disassociate (${HONORARIUM_NAV_PROP}/$ref DELETE)`);
    console.log(`Person PATCH: clear ${Object.keys(PERSON_PATCH).join(', ')}`);
    console.log('\nDRY-RUN complete. Re-run with --commit to apply.');
    return;
  }

  // ── Writes ──
  // Parent PATCH FIRST (Codex P1): un-submit the suggestion before deleting the
  // answer snapshot/draft, so a PATCH failure can't leave a "submitted" parent with
  // its children already gone. If a later delete fails, the parent is already
  // pristine and re-running the script cleans the remainder (idempotent).
  await DynamicsService.updateRecord(SUGG_ENTITY, suggestionId, RESET_PATCH);
  console.log('Suggestion reset to pristine.');

  await DynamicsService.updateRecord(PERSON_ENTITY, personId, PERSON_PATCH);
  console.log('Board-identity cleared on person.');

  // Clear the honorarium lookup via $ref DELETE (idempotent; 404 = already empty),
  // so a live-mode test row isn't treated as already-onboarded on the next accept.
  await DynamicsService.disassociate(SUGG_ENTITY, suggestionId, HONORARIUM_NAV_PROP);
  console.log('Honorarium lookup cleared (disassociate).');

  for (const a of answers) {
    await DynamicsService.deleteRecord(answerSet, a[answerPk]);
  }
  console.log(`Deleted ${answers.length} answer row(s).`);

  const draftDeleted = await ReviewDraftService.deleteBySuggestion(suggestionId).catch((e) => {
    console.warn(`  draft delete non-fatal: ${e.message || e}`); return null;
  });
  console.log(`Draft deleted: ${draftDeleted ?? 'n/a'}`);

  console.log('\nDone. Reviewer is back in Invite Reviewers (selected, uninvited) — start the E2E from the PD side.');
});
