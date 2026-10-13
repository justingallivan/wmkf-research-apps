#!/usr/bin/env node
/** Saved synthetic peer scores for the six dedicated ranking rehearsal requests.
 * Uses the existing sandbox reviewer seeder. No invitations, contacts, or email.
 * Default is read-only. Receipt ownership and exact readback fence every retry.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { RANKING_TEST_DATAVERSE as TARGET, RANKING_TEST_REQUESTS as IDS, RANKING_TEST_RUN as RUN } from '../lib/services/proposal-ranking/test-policy.js';
import { RATING_SCALE } from '../lib/services/proposal-ranking/calculations.js';
import { withDalContext } from '../lib/dataverse/core/context.js';
import { createReviewsSandboxDeps } from '../lib/services/test-requests/reviews-sandbox-deps.js';
import { syntheticPersonProjection, buildSuggestionCreateBody, buildCompletionWrite } from '../lib/services/reviewer-engagement/seed-synthetic-review.js';
const require = createRequire(import.meta.url);
const { loadEnvLocal, getAccessToken, createClient } = require('../lib/dataverse/client.js');
loadEnvLocal();
Object.assign(process.env, { DYNAMICS_URL: TARGET, DYNAMICS_SANDBOX_URL: TARGET, DATAVERSE_TARGET_INTERLOCK: 'on', DATAVERSE_DAL_ENFORCEMENT: 'on', DATAVERSE_ALLOW_PROD_READS: 'no', SYNTHETIC_REVIEWER_ISOLATION: 'on' });
const execute = process.argv.includes('--execute');
assert(process.argv.slice(2).every(arg => arg === '--execute'));
const PERSON = 'c31bc841-e260-4a14-9041-8d765ddcc410';
const FILE = '/private/tmp/ranking-d97-review-setup.json';
const client = createClient({ resourceUrl: TARGET, token: await getAccessToken(TARGET) });
const deps = createReviewsSandboxDeps({ resourceUrl: TARGET });
let receipt = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : null;
if (receipt) assert(receipt.target === TARGET && receipt.runId === RUN);
const save = () => fs.writeFileSync(FILE, JSON.stringify(receipt, null, 2), { mode: 0o600 });
await withDalContext('ranking-test-review-setup', async () => {
  for (const id of IDS) {
    const r = await client.get(`/akoya_requests(${id})?$select=wmkf_istestrequest,wmkf_testcreationrunid`);
    assert(r.ok && r.body.wmkf_istestrequest === true && r.body.wmkf_testcreationrunid === RUN);
  }
  const person = await deps.getPersonById(PERSON);
  assert(!person || (receipt?.personAttempted && person.wmkf_issyntheticreviewer === true), 'Reviewer is not receipt-owned');
  console.log(JSON.stringify({ target: TARGET, requests: IDS.length, execute }));
  if (!execute) return;
  if (!receipt) { receipt = { target: TARGET, runId: RUN, reviews: {} }; fs.writeFileSync(FILE, JSON.stringify(receipt), { mode: 0o600, flag: 'wx' }); }
  if (!person) {
    assert(!receipt.personAttempted, 'Resolve ambiguous reviewer create before retry');
    receipt.personAttempted = true; save();
    await deps.createPerson({ wmkf_potentialreviewersid: PERSON,
      ...syntheticPersonProjection({ person: { wmkf_firstname: 'Ranking', wmkf_lastname: 'Rehearsal' } }, null) });
  }
  for (let i = 0; i < IDS.length; i++) {
    const suggestionId = `c31bc841-e260-4a14-9041-8d765ddcc42${i + 1}`;
    const rating = [5,4,3,5,2,3][i];
    const label = RATING_SCALE.find(x => x.value === rating).label;
    const fixture = { reviewForm: 'received_no_file', suggestion: {
      wmkf_suggestionlabel: 'TEST: Ranking rehearsal', wmkf_selected: false, wmkf_invited: false,
      wmkf_accepted: false, wmkf_declined: false, wmkf_reviewreceivedat: '2026-10-13T22:00:00Z',
    }, answers: [{ wmkf_questionkey: 'overallAssessment', wmkf_questionorder: 1,
      wmkf_questiontext: 'Synthetic rehearsal overall assessment', wmkf_questiontype: 'picklist',
      wmkf_answervalue: rating, wmkf_answertext: label, wmkf_questionoptions: RATING_SCALE }] };
    let row = await deps.getSuggestionById(suggestionId, { select: ['wmkf_appreviewersuggestionid','_wmkf_request_value','_wmkf_potentialreviewer_value','wmkf_reviewreceivedat'] });
    if (!row) {
      assert(!receipt.reviews[suggestionId]?.attempted, 'Resolve ambiguous suggestion create before retry');
      receipt.reviews[suggestionId] = { attempted: true }; save();
      await deps.createSuggestion({ wmkf_appreviewersuggestionid: suggestionId,
        ...buildSuggestionCreateBody(fixture, { destinationRequestId: IDS[i], destinationPersonId: PERSON, grantCycleCode: 'D97' }) });
      row = await deps.getSuggestionById(suggestionId, { select: ['wmkf_appreviewersuggestionid','_wmkf_request_value','_wmkf_potentialreviewer_value','wmkf_reviewreceivedat'] });
    }
    assert(receipt.reviews[suggestionId]?.attempted && row._wmkf_request_value === IDS[i] && row._wmkf_potentialreviewer_value === PERSON, 'Suggestion ownership mismatch');
    if (!row.wmkf_reviewreceivedat) {
      const write = buildCompletionWrite(fixture, { suggestionId, ifMatch: row._etag || row['@odata.etag'] });
      assert(write.operations[0].ifMatch || row._etag || row['@odata.etag'], 'Missing concurrency token');
      await deps.runChangeset(write.operations);
    }
    const answers = await deps.getAnswersBySuggestion(suggestionId);
    assert(answers.some(a => a.wmkf_questionkey === 'overallAssessment' && Number(a.wmkf_answervalue) === rating), 'Saved score differs');
    receipt.reviews[suggestionId].verifiedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ requestId: IDS[i], rating, verified: true }));
  }
});
