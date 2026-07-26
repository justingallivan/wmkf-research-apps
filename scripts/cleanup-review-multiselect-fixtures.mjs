#!/usr/bin/env node
/**
 * One-shot cleanup for the two production review-form multiselect fixtures
 * authorized for removal on 2026-07-26.
 *
 * Dry-run is the default. The execute path requires both an exact confirmation
 * token and the Dataverse production-write interlock acknowledgement. Every
 * mutable target is exact-match checked before the first write. CRM contacts
 * are deliberately preserved (`deleteContact: false`).
 *
 * Usage:
 *   node --import ./scripts/lib/use-extensionless.mjs \
 *     scripts/cleanup-review-multiselect-fixtures.mjs
 *
 *   DATAVERSE_PROD_WRITE_ACK="review-form-fixture-cleanup 2026-07-26" \
 *   node --import ./scripts/lib/use-extensionless.mjs \
 *     scripts/cleanup-review-multiselect-fixtures.mjs \
 *     --execute \
 *     --confirm=REMOVE_REVIEW_MULTISELECT_FIXTURES_2026_07_26
 */

import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { loadEnvLocal } = require('../lib/dataverse/client.js');
loadEnvLocal();

const { sql } = require('@vercel/postgres');
const { DynamicsService } = await import('../lib/services/dynamics-service.js');
const { enterDynamicsBypassForScript } = await import('../lib/services/dynamics-context.js');
const { GraphService } = await import('../lib/services/graph-service.js');
const { describeRemoval, removeCandidateEntirely } = await import(
  '../lib/services/reviewer-finder/remove-candidate-service.js'
);
const suggestionAdapter = await import('../lib/dataverse/adapters/reviewer-suggestion.js');
const answerAdapter = await import('../lib/dataverse/adapters/review-answer.js');
const potentialReviewerAdapter = await import('../lib/dataverse/adapters/potential-reviewer.js');
const ReviewDraftService = (await import('../lib/services/review-draft-service.js')).default;

enterDynamicsBypassForScript('cleanup-review-multiselect-fixtures');

const EXECUTE = process.argv.includes('--execute');
const CONFIRM_TOKEN = 'REMOVE_REVIEW_MULTISELECT_FIXTURES_2026_07_26';
const EXPECTED_ACK = 'review-form-fixture-cleanup 2026-07-26';
const ACTING_USER_SYSTEM_ID = '29b0de0d-4ff7-ee11-a1fd-000d3a3621c7';
const REVIEW_LIBRARY = 'akoya_request';
const DEFAULT_OUTPUT = resolve(
  'outputs/review-form-multiselect',
  EXECUTE
    ? 'fixture-cleanup-evidence-2026-07-26.json'
    : 'fixture-cleanup-preflight-2026-07-26.json',
);
let pendingEvidence = null;
let pendingOutputPath = null;

const FIXTURES = Object.freeze([
  Object.freeze({
    label: 'EICAR fixture',
    suggestionId: '6ad328b4-f044-f111-88b5-000d3a306d45',
    potentialReviewerId: '62d328b4-f044-f111-88b5-000d3a306d45',
    potentialReviewerName: 'Justin Gallivan Test',
    email: 'justingallivan@me.com',
    contactId: '59e9f7e0-9242-f111-88b4-000d3a306da2',
    requestId: '54e2b88b-04b9-f011-bbd3-6045bd02b4cc',
    requestNumber: '1002379',
    answerIds: Object.freeze([
      '2505a211-ff73-f111-ab0f-000d3a306da2',
      '2605a211-ff73-f111-ab0f-000d3a306da2',
      '2705a211-ff73-f111-ab0f-000d3a306da2',
    ]),
    answerKeys: Object.freeze(['impact', 'overallRating', 'risk']),
    draftId: null,
    folder:
      '1002379_54E2B88B04B9F011BBD36045BD02B4CC/Reviewer_Uploads/GallivanTest_6ad328b4',
    filenames: Object.freeze(['eicar-test-bytes.pdf']),
  }),
  Object.freeze({
    label: 'Gallivan_test fixture',
    suggestionId: '3c4bb952-e061-f111-a826-000d3a306da2',
    potentialReviewerId: '5416f619-6660-f111-a826-000d3a3064b7',
    potentialReviewerName: 'Justin_test Gallivan',
    email: 'polar.bitmaps0y@icloud.com',
    contactId: 'ad799aca-6d6f-f111-ab0d-000d3a306da2',
    requestId: 'feabe26f-dc1b-f111-8341-000d3a306da2',
    requestNumber: '1002788',
    answerIds: Object.freeze([]),
    answerKeys: Object.freeze([]),
    draftId: '1',
    folder: null,
    filenames: Object.freeze([]),
  }),
]);

function argValue(name) {
  const prefix = `--${name}=`;
  const arg = process.argv.find((value) => value.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : null;
}

function invariant(condition, message) {
  if (!condition) throw new Error(`Safety invariant failed: ${message}`);
}

function sorted(values) {
  return [...values].sort();
}

function sameStrings(actual, expected) {
  return JSON.stringify(sorted(actual.map(String))) === JSON.stringify(sorted(expected.map(String)));
}

function sha256(value) {
  return createHash('sha256').update(value == null ? '' : String(value)).digest('hex');
}

function targetHostname() {
  try {
    return new URL(process.env.DYNAMICS_URL).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function assertInvocationSafety() {
  invariant(
    process.env.DATAVERSE_ALLOW_PROD_READS === 'yes',
    'DATAVERSE_ALLOW_PROD_READS must equal "yes"',
  );
  invariant(
    targetHostname() === 'wmkf.crm.dynamics.com',
    'DYNAMICS_URL must target wmkf.crm.dynamics.com',
  );
  if (!EXECUTE) return;
  invariant(argValue('confirm') === CONFIRM_TOKEN, `--confirm must equal ${CONFIRM_TOKEN}`);
  invariant(
    process.env.DATAVERSE_PROD_WRITE_ACK === EXPECTED_ACK,
    `DATAVERSE_PROD_WRITE_ACK must equal "${EXPECTED_ACK}"`,
  );
}

async function readRequest(fixture) {
  const request = await DynamicsService.getRecord('akoya_requests', fixture.requestId, {
    select: 'akoya_requestid,akoya_requestnum,akoya_title,wmkf_reviewsynthesisjson,modifiedon',
  });
  return {
    id: request.akoya_requestid,
    number: String(request.akoya_requestnum),
    title: request.akoya_title || null,
    modifiedOn: request.modifiedon || null,
    reviewSynthesisJson: request.wmkf_reviewsynthesisjson ?? null,
    reviewSynthesisSha256: sha256(request.wmkf_reviewsynthesisjson),
  };
}

async function listFixtureFiles(fixture) {
  if (!fixture.folder) return [];
  return GraphService.listFiles(REVIEW_LIBRARY, fixture.folder, { recursive: false });
}

async function preflightFixture(fixture) {
  const [suggestion, disclosure, answersBySuggestion, draft, person, files, request] =
    await Promise.all([
      suggestionAdapter.findById(fixture.suggestionId),
      describeRemoval({ suggestionId: fixture.suggestionId }),
      answerAdapter.fetchAnswersBySuggestion([fixture.suggestionId]),
      ReviewDraftService.getBySuggestion(fixture.suggestionId),
      potentialReviewerAdapter.getById(fixture.potentialReviewerId),
      listFixtureFiles(fixture),
      readRequest(fixture),
    ]);

  const answers = answersBySuggestion[fixture.suggestionId] || [];
  invariant(
    suggestion.wmkf_appreviewersuggestionid === fixture.suggestionId,
    `${fixture.label}: suggestion ID drift`,
  );
  invariant(
    suggestion._wmkf_potentialreviewer_value === fixture.potentialReviewerId,
    `${fixture.label}: potential-reviewer link drift`,
  );
  invariant(
    suggestion._wmkf_request_value === fixture.requestId,
    `${fixture.label}: request link drift`,
  );
  invariant(
    !suggestion._wmkf_honorariumrequest_value && disclosure.honorarium === null,
    `${fixture.label}: unexpected honorarium link`,
  );
  invariant(
    (suggestion.wmkf_reviewsharepointfolder || null) === fixture.folder,
    `${fixture.label}: review folder drift`,
  );
  invariant(
    (suggestion.wmkf_reviewfilename || null) === (fixture.filenames[0] || null),
    `${fixture.label}: review filename drift`,
  );
  invariant(
    disclosure.contactId === fixture.contactId,
    `${fixture.label}: removal disclosure contact drift`,
  );
  invariant(
    person.wmkf_potentialreviewersid === fixture.potentialReviewerId,
    `${fixture.label}: person ID drift`,
  );
  invariant(person.wmkf_name === fixture.potentialReviewerName, `${fixture.label}: person name drift`);
  invariant(
    String(person.wmkf_emailaddress).toLowerCase() === fixture.email.toLowerCase(),
    `${fixture.label}: person email drift`,
  );
  invariant(
    person._wmkf_contact_value === fixture.contactId,
    `${fixture.label}: CRM contact link drift`,
  );
  invariant(request.id === fixture.requestId, `${fixture.label}: request ID drift`);
  invariant(request.number === fixture.requestNumber, `${fixture.label}: request number drift`);
  invariant(
    sameStrings(answers.map((row) => row.answerId), fixture.answerIds),
    `${fixture.label}: answer-row ID allowlist drift`,
  );
  invariant(
    sameStrings(answers.map((row) => row.questionKey), fixture.answerKeys),
    `${fixture.label}: answer-key allowlist drift`,
  );
  invariant(
    (draft == null && fixture.draftId == null) ||
      (draft != null && String(draft.id) === fixture.draftId),
    `${fixture.label}: Postgres draft drift`,
  );
  invariant(
    sameStrings(files.map((file) => file.name), fixture.filenames),
    `${fixture.label}: SharePoint file allowlist drift; expected=${JSON.stringify(
      fixture.filenames,
    )} actual=${JSON.stringify(files.map((file) => file.name))}`,
  );

  return {
    fixture: { ...fixture },
    suggestion,
    disclosure,
    answers,
    draft,
    potentialReviewer: person,
    sharePointFiles: files,
    request,
  };
}

async function readSuggestionById(suggestionId) {
  const { records } = await DynamicsService.queryRecords('wmkf_appreviewersuggestions', {
    select: 'wmkf_appreviewersuggestionid',
    filter: `wmkf_appreviewersuggestionid eq ${suggestionId}`,
    top: 1,
  });
  return records[0] || null;
}

async function postVerifyFixture(fixture, before) {
  const [suggestion, answersBySuggestion, draft, person, files, request] = await Promise.all([
    readSuggestionById(fixture.suggestionId),
    answerAdapter.fetchAnswersBySuggestion([fixture.suggestionId]),
    ReviewDraftService.getBySuggestion(fixture.suggestionId),
    potentialReviewerAdapter.getById(fixture.potentialReviewerId),
    listFixtureFiles(fixture),
    readRequest(fixture),
  ]);
  const answers = answersBySuggestion[fixture.suggestionId] || [];

  invariant(suggestion === null, `${fixture.label}: suggestion still exists`);
  invariant(answers.length === 0, `${fixture.label}: answer rows still exist`);
  invariant(draft === null, `${fixture.label}: Postgres draft still exists`);
  invariant(
    person.wmkf_potentialreviewersid === fixture.potentialReviewerId,
    `${fixture.label}: potential-reviewer person was removed`,
  );
  invariant(
    person._wmkf_contact_value === fixture.contactId,
    `${fixture.label}: CRM contact link was removed or changed`,
  );
  invariant(files.length === 0, `${fixture.label}: SharePoint review file still exists`);
  invariant(
    request.reviewSynthesisSha256 === before.request.reviewSynthesisSha256,
    `${fixture.label}: request synthesis changed`,
  );
  invariant(
    request.modifiedOn === before.request.modifiedOn,
    `${fixture.label}: parent request modified timestamp changed`,
  );

  return {
    suggestion,
    answers,
    draft,
    potentialReviewer: person,
    sharePointFiles: files,
    request,
  };
}

async function readAuditAlert(id) {
  const result = await sql`
    SELECT id, alert_type, severity, title, message, metadata, source, created_at
      FROM system_alerts
     WHERE id = ${id}
     LIMIT 1
  `;
  return result.rows[0] || null;
}

function verifyOperationResult(fixture, result) {
  invariant(result.success === true, `${fixture.label}: service did not report success`);
  invariant(result.suggestionId === fixture.suggestionId, `${fixture.label}: result ID drift`);
  invariant(result.honorariumDeleted === false, `${fixture.label}: unexpected honorarium deletion`);
  invariant(result.contactDeleteAttempted === false, `${fixture.label}: contact deletion was attempted`);
  invariant(result.contactDeleted === false, `${fixture.label}: contact was deleted`);
  invariant(
    result.answerRowsDeleted === fixture.answerIds.length,
    `${fixture.label}: unexpected answer-row delete count`,
  );
  invariant(
    result.draftDeleted === Boolean(fixture.draftId),
    `${fixture.label}: unexpected draft delete result`,
  );
  invariant(result.warnings.length === 0, `${fixture.label}: cleanup returned warnings`);
  invariant(result.partialFailure === null, `${fixture.label}: cleanup returned partial failure`);
  if (fixture.folder) {
    invariant(result.sharePointCleanupAttempted === true, `${fixture.label}: file cleanup not attempted`);
    invariant(
      result.sharePointReviewFilesDeletedCount === fixture.filenames.length,
      `${fixture.label}: unexpected file delete count`,
    );
  } else {
    invariant(
      result.sharePointCleanupAttempted === false,
      `${fixture.label}: unexpected SharePoint cleanup attempt`,
    );
  }
  invariant(Number.isInteger(result.auditAlertId), `${fixture.label}: missing audit alert ID`);
}

function verifyAuditAlert(fixture, alert) {
  invariant(alert != null, `${fixture.label}: audit alert missing`);
  invariant(
    alert.alert_type === 'reviewer_candidate_removed_entirely',
    `${fixture.label}: audit alert type drift`,
  );
  invariant(
    alert.source === 'reviewer-finder.remove-candidate-entirely',
    `${fixture.label}: audit alert source drift`,
  );
  invariant(
    alert.metadata?.suggestionId === fixture.suggestionId,
    `${fixture.label}: audit metadata suggestion drift`,
  );
  invariant(alert.metadata?.deleteContact === false, `${fixture.label}: audit says contact deletion`);
  invariant(alert.metadata?.result?.status === 'success', `${fixture.label}: audit result is not success`);
  invariant(
    Array.isArray(alert.metadata?.result?.warnings) &&
      alert.metadata.result.warnings.length === 0,
    `${fixture.label}: audit result contains warnings`,
  );
}

async function writeEvidence(outputPath, evidence) {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
}

async function main() {
  assertInvocationSafety();
  const outputPath = resolve(argValue('output') || DEFAULT_OUTPUT);
  const evidence = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    mode: EXECUTE ? 'execute' : 'dry-run',
    authorization:
      'User authorized removal of both exact test engagements and linked test artifacts; CRM contacts must be preserved.',
    actingUserSystemId: ACTING_USER_SYSTEM_ID,
    targetHostname: targetHostname(),
    deleteContact: false,
    before: [],
    operations: [],
    after: [],
    audits: [],
    success: false,
  };
  pendingEvidence = evidence;
  pendingOutputPath = outputPath;

  console.log(`Mode: ${evidence.mode}`);
  console.log('Preflighting both exact fixture allowlists before any write...');
  for (const fixture of FIXTURES) {
    evidence.before.push(await preflightFixture(fixture));
    console.log(
      `  ${fixture.label}: ${fixture.suggestionId}; answers=${fixture.answerIds.length}; ` +
        `draft=${fixture.draftId || 'none'}; files=${fixture.filenames.join(',') || 'none'}; contact=preserve`,
    );
  }

  if (!EXECUTE) {
    evidence.success = true;
    await writeEvidence(outputPath, evidence);
    console.log(`Dry-run preflight passed. Evidence: ${outputPath}`);
    return;
  }

  console.log('Executing audited removal with deleteContact=false...');
  for (const fixture of FIXTURES) {
    const operation = { suggestionId: fixture.suggestionId };
    evidence.operations.push(operation);
    try {
      const result = await removeCandidateEntirely({
        suggestionId: fixture.suggestionId,
        deleteContact: false,
        actingUserSystemId: ACTING_USER_SYSTEM_ID,
      });
      operation.result = result;
      verifyOperationResult(fixture, result);
      console.log(`  removed ${fixture.label}; audit alert ${result.auditAlertId}`);
    } catch (error) {
      operation.error = error?.stack || error?.message || String(error);
      console.error(`  FAILED ${fixture.label}: ${error?.message || String(error)}`);
    }
  }

  for (let index = 0; index < FIXTURES.length; index += 1) {
    const fixture = FIXTURES[index];
    evidence.after.push(await postVerifyFixture(fixture, evidence.before[index]));
    const operation = evidence.operations.find((row) => row.suggestionId === fixture.suggestionId);
    invariant(operation?.result, `${fixture.label}: removal operation failed`);
    const alert = await readAuditAlert(operation.result.auditAlertId);
    verifyAuditAlert(fixture, alert);
    evidence.audits.push(alert);
  }

  evidence.success = true;
  await writeEvidence(outputPath, evidence);
  console.log(`Cleanup and post-verification passed. Evidence: ${outputPath}`);
}

main().catch(async (error) => {
  if (pendingEvidence && pendingOutputPath) {
    pendingEvidence.failure = error?.stack || error?.message || String(error);
    pendingEvidence.success = false;
    try {
      await writeEvidence(pendingOutputPath, pendingEvidence);
      console.error(`Failure evidence: ${pendingOutputPath}`);
    } catch (evidenceError) {
      console.error(`Could not write failure evidence: ${evidenceError?.message || String(evidenceError)}`);
    }
  }
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
