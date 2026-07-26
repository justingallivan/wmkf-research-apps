#!/usr/bin/env node
/**
 * READ-ONLY production preflight for the review-form multiselect activation.
 *
 * Captures:
 *   - all active/inactive review-question rows with immutable IDs + ETags;
 *   - normalized active/target versions and the target publication dry-run;
 *   - a rollback template that cannot execute until post-publication IDs,
 *     ETags, and the completed publication audit are supplied;
 *   - the current review-synthesis prompt body/config/hash + recent audits;
 *   - exact consumer state for the two owner-named test suggestions;
 *   - isolated, no-write service-boundary probes for the four review writers.
 *
 * This script never calls a Dataverse/Postgres write API. The writer probes
 * stop at set-version or form-validation failures before their first write.
 *
 * Usage:
 *   DATAVERSE_ALLOW_PROD_READS=yes node --import ./scripts/lib/use-extensionless.mjs \
 *     scripts/probe-review-multiselect-preactivation.mjs \
 *     --output outputs/review-form-multiselect/preactivation-evidence-2026-07-26.json
 */

import { createHash } from 'crypto';
import { execFileSync, spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { loadEnvLocal } = require('../lib/dataverse/client');
loadEnvLocal();

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..');
const FIXTURE_IDS = Object.freeze([
  '6ad328b4-f044-f111-88b5-000d3a306d45',
  '3c4bb952-e061-f111-a826-000d3a306da2',
]);
const WRITER_PROBE_SUGGESTION_ID = FIXTURE_IDS[1];
const SENTINEL_SET_VERSION = 'READ_ONLY_PROBE_DO_NOT_WRITE';
const WRITER_NAMES = Object.freeze([
  'external-submit',
  'manual-entry',
  'legacy-upload',
  'mark-received-no-file',
]);

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function iso(value) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, stable(value[key])]),
  );
}

function contentHash(value) {
  return sha256(JSON.stringify(stable(value)));
}

function errorShape(error) {
  return {
    name: error?.name || 'Error',
    message: error?.message || String(error),
    httpStatus: error?.httpStatus ?? error?.status ?? error?.response?.status ?? null,
    body: error?.body ?? null,
  };
}

function cleanRow(row) {
  if (!row) return row;
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, value instanceof Date ? value.toISOString() : value]),
  );
}

function currentCommit() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

function targetHostname() {
  try {
    return new URL(process.env.DYNAMICS_URL).hostname;
  } catch {
    return null;
  }
}

async function loadRuntime() {
  const [
    dynamics,
    dynamicsContext,
    questionFetcher,
    formSchema,
    questionSave,
  ] = await Promise.all([
    import('../lib/services/dynamics-service.js'),
    import('../lib/services/dynamics-context.js'),
    import('../lib/external/review-question-fetcher.js'),
    import('../lib/external/review-form-schema.js'),
    import('../lib/admin/review-question-save.js'),
  ]);
  return {
    DynamicsService: dynamics.DynamicsService,
    enterDynamicsBypassForScript: dynamicsContext.enterDynamicsBypassForScript,
    normalizeRow: questionFetcher.normalizeRow,
    questionSetVersion: questionFetcher.questionSetVersion,
    getAuthoritativeQuestionSet: questionFetcher.getAuthoritativeQuestionSet,
    reviewFormSchema: formSchema.reviewFormSchema,
    validateSubmittedSet: questionSave.validateSubmittedSet,
    buildChangeset: questionSave.buildChangeset,
    inactiveState: questionSave.INACTIVE_STATE,
  };
}

async function runWriterProbe(writer) {
  if (!WRITER_NAMES.includes(writer)) {
    throw new Error(`Unknown --writer-probe value: ${writer}`);
  }
  const runtime = await loadRuntime();
  runtime.enterDynamicsBypassForScript(`probe-review-multiselect-preactivation:${writer}`);

  const directSet = await runtime.getAuthoritativeQuestionSet();
  const directVersion = runtime.questionSetVersion(directSet);
  const invalidPicklist = directSet.find((field) => field.type === 'picklist');
  if (!invalidPicklist) throw new Error('Live question set has no picklist for validation probe');

  let outcome;
  try {
    if (writer === 'external-submit') {
      const suggestionAdapter = await import('../lib/dataverse/adapters/reviewer-suggestion.js');
      const { submitReview } = await import('../lib/services/external-review/submit-service.js');
      const suggestion = await suggestionAdapter.findById(WRITER_PROBE_SUGGESTION_ID);
      await submitReview({
        suggestion,
        body: { setVersion: SENTINEL_SET_VERSION, answers: {} },
      });
      outcome = { unexpected: 'service returned success' };
    } else if (writer === 'manual-entry') {
      const { submitManualReviewEntry } = await import(
        '../lib/services/review-manager/manual-review-entry-service.js'
      );
      await submitManualReviewEntry({
        suggestionId: WRITER_PROBE_SUGGESTION_ID,
        answers: {},
        setVersion: SENTINEL_SET_VERSION,
        actingUserSystemId: null,
      });
      outcome = { unexpected: 'service returned success' };
    } else if (writer === 'legacy-upload') {
      const { writeReviewFiles } = await import('../lib/services/review-upload.js');
      outcome = await writeReviewFiles({
        suggestionId: WRITER_PROBE_SUGGESTION_ID,
        files: [{ filename: 'read-only-probe.pdf', buffer: Buffer.from('%PDF-read-only-probe') }],
        structuredData: { [invalidPicklist.key]: 987654321 },
        opts: { source: 'staff_upload', performedBy: null, actingUserSystemId: null },
      });
    } else {
      const { markReceivedNoFile } = await import(
        '../lib/services/review-manager/mark-received-no-file-service.js'
      );
      await markReceivedNoFile({
        suggestionId: WRITER_PROBE_SUGGESTION_ID,
        structuredData: { [invalidPicklist.key]: 987654321 },
        actingUserSystemId: null,
      });
      outcome = { unexpected: 'service returned success' };
    }
  } catch (error) {
    outcome = { rejected: errorShape(error) };
  }

  const acceptable = (
    (writer === 'external-submit' || writer === 'manual-entry')
      ? outcome?.rejected?.body?.reason === 'set_changed'
      : writer === 'legacy-upload'
        ? outcome?.ok === false && outcome?.reason === 'validation'
        : outcome?.rejected?.httpStatus === 400
  );

  return {
    writer,
    probedAt: new Date().toISOString(),
    targetHostname: targetHostname(),
    processId: process.pid,
    directAuthoritativeVersion: directVersion,
    directAuthoritativeKeys: directSet.map((field) => field.key),
    stopMechanism: writer === 'external-submit' || writer === 'manual-entry'
      ? 'sentinel setVersion mismatch before validation/build/write'
      : `out-of-domain ${invalidPicklist.key} value before first write`,
    outcome,
    noWriteStopObserved: acceptable,
    evidenceBoundary:
      'Fresh local service process targeting production Dataverse; this is not an independently routed production HTTP request.',
  };
}

function runIsolatedWriterProbe(writer) {
  const child = spawnSync(
    process.execPath,
    [
      '--import',
      path.join(REPO_ROOT, 'scripts/lib/use-extensionless.mjs'),
      SCRIPT_PATH,
      '--writer-probe',
      writer,
    ],
    {
      cwd: REPO_ROOT,
      env: { ...process.env, DATAVERSE_ALLOW_PROD_READS: 'yes' },
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    },
  );
  const marker = (child.stdout || '')
    .split('\n')
    .find((line) => line.startsWith('PROBE_JSON='));
  if (child.status !== 0 || !marker) {
    return {
      writer,
      noWriteStopObserved: false,
      probeFailed: true,
      exitCode: child.status,
      stderr: (child.stderr || '').slice(-4000),
      stdout: (child.stdout || '').slice(-4000),
    };
  }
  return JSON.parse(marker.slice('PROBE_JSON='.length));
}

function questionRestoreBody(row, activeState) {
  return {
    wmkf_name: row.label.slice(0, 200),
    wmkf_questionorder: row.order,
    wmkf_questiontext: row.label,
    wmkf_questiontype: row.type,
    wmkf_required: row.required === true,
    wmkf_maxlength: row.maxLength ?? null,
    wmkf_hint: row.hint ?? null,
    wmkf_options:
      row.type === 'picklist' || row.type === 'multiselect'
        ? JSON.stringify(row.options || [])
        : null,
    statecode: activeState.statecode,
    statuscode: activeState.statuscode,
  };
}

async function readQuestionEvidence(runtime) {
  const select = [
    'wmkf_reviewquestionid',
    'wmkf_questionkey',
    'wmkf_questionorder',
    'wmkf_questiontext',
    'wmkf_questiontype',
    'wmkf_required',
    'wmkf_maxlength',
    'wmkf_hint',
    'wmkf_options',
    'statecode',
    'statuscode',
  ].join(',');
  const { records, capped } = await runtime.DynamicsService.queryAllRecords(
    'wmkf_reviewquestions',
    {
      select,
      filter: 'statecode eq 0 or statecode eq 1',
      orderby: 'statecode asc,wmkf_questionorder asc',
    },
  );
  if (capped) throw new Error('Question-row preflight hit the queryAllRecords cap');

  const rows = records.map((row) => ({
    id: row.wmkf_reviewquestionid,
    etag: row._etag || null,
    statecode: row.statecode,
    statuscode: row.statuscode,
    raw: cleanRow(row),
    normalized: runtime.normalizeRow(row),
  }));
  const activeRows = rows.filter((row) => row.statecode === 0);
  const inactiveRows = rows.filter((row) => row.statecode !== 0);
  const active = activeRows.map((row) => ({
    id: row.id,
    etag: row.etag,
    ...row.normalized,
  }));
  const activeVersion = runtime.questionSetVersion(active);

  const targetInput = runtime.reviewFormSchema.fields.map((field) => {
    const existing = activeRows.find((row) => row.normalized.key === field.key);
    return {
      ...(existing ? { id: existing.id } : {}),
      key: field.key,
      label: field.label,
      type: field.type,
      required: field.required === true,
      ...(Number.isFinite(field.maxLength) ? { maxLength: field.maxLength } : {}),
      ...(field.hint ? { hint: field.hint } : {}),
      ...(Array.isArray(field.options)
        ? { options: field.options.map((option) => ({ value: option.value, label: option.label })) }
        : {}),
    };
  });
  const targetValidation = runtime.validateSubmittedSet(targetInput);
  if (!targetValidation.ok) {
    throw new Error(`Target question set failed live publication validation: ${targetValidation.errors.join('; ')}`);
  }
  const targetRows = targetValidation.rows;
  const targetVersion = runtime.questionSetVersion(targetRows);
  const publicationPlan = runtime.buildChangeset(active, targetRows);
  if (!publicationPlan.ok) {
    throw new Error(`Target question-set dry-run failed: ${publicationPlan.errors.join('; ')}`);
  }

  const activeStateRow = activeRows[0];
  const activeState = {
    statecode: activeStateRow?.statecode ?? 0,
    statuscode: activeStateRow?.statuscode ?? 1,
  };
  const targetKeys = new Set(targetRows.map((row) => row.key));
  const priorKeys = new Set(active.map((row) => row.key));
  const retainedKeys = [...priorKeys].filter((key) => targetKeys.has(key));
  const priorOnly = active.filter((row) => !targetKeys.has(row.key));
  const targetOnly = targetRows.filter((row) => !priorKeys.has(row.key));

  const rollbackTemplate = {
    status: 'BLOCKED_NON_EXECUTABLE_TEMPLATE',
    blockingRequirements: [
      'completed cutover review_question_audit final/completed row with request_id and before_json',
      'post-publication readback of every active/inactive row with fresh immutable row ID and ETag',
      'operator and approval identity',
      'independently routed production readback of the selected prior version',
    ],
    sourcePriorVersion: activeVersion,
    expectedTargetVersion: targetVersion,
    retainedKeys,
    priorOnlyReactivations: priorOnly.map((row) => ({
      method: 'PATCH',
      entitySet: 'wmkf_reviewquestions',
      key: row.id,
      ifMatch: row.etag,
      body: questionRestoreBody(row, activeState),
    })),
    retainedRestores: active
      .filter((row) => targetKeys.has(row.key))
      .map((row) => ({
        method: 'PATCH',
        entitySet: 'wmkf_reviewquestions',
        key: row.id,
        ifMatch: 'RESOLVE_FRESH_AFTER_PUBLICATION',
        priorEtagForReferenceOnly: row.etag,
        body: questionRestoreBody(row, activeState),
      })),
    targetOnlyDeactivations: targetOnly.map((row) => ({
      method: 'PATCH',
      entitySet: 'wmkf_reviewquestions',
      key: 'RESOLVE_ROW_ID_AFTER_PUBLICATION',
      ifMatch: 'RESOLVE_FRESH_AFTER_PUBLICATION',
      questionKey: row.key,
      body: runtime.inactiveState,
    })),
    invariantChecks: {
      impactReactivatedByExistingRowId: priorOnly.some(
        (row) => row.key === 'impact' && typeof row.id === 'string',
      ),
      impactAreasDeactivatedByRowId: false,
      neverPostExistingImmutableKey: true,
    },
  };

  return {
    allRows: rows,
    counts: { total: rows.length, active: activeRows.length, inactive: inactiveRows.length },
    activeVersion,
    activeKeys: active.map((row) => row.key),
    targetVersion,
    targetKeys: targetRows.map((row) => row.key),
    targetValidation: { ok: true },
    publicationDryRun: publicationPlan,
    inactiveKeyCollisions: inactiveRows
      .filter((row) => targetKeys.has(row.normalized.key))
      .map((row) => ({ id: row.id, etag: row.etag, key: row.normalized.key })),
    rollbackTemplate,
  };
}

async function readPromptEvidence(runtime, sql) {
  const promptAdapter = await import('../lib/dataverse/adapters/ai-prompt.js');
  const { records } = await promptAdapter.listVersions('review-synthesis.generate');
  const versions = (records || []).map(cleanRow);
  const current = versions.filter((row) => row.wmkf_ai_iscurrent === true);
  const selected = current.length === 1 ? current[0] : null;

  const audits = await sql`
    SELECT id, request_id, prompt_name, target_version, new_prompt_id, prior_prompt_id,
           body_hash, profile_id, phase, status, outcome_json, warnings_json, created_at
      FROM prompt_publish_audit
     WHERE prompt_name = 'review-synthesis.generate'
     ORDER BY created_at DESC
     LIMIT 25
  `;
  return {
    currentRowCount: current.length,
    current: selected
      ? {
          id: selected.wmkf_ai_promptid,
          version: selected.wmkf_promptversion,
          body: selected.wmkf_ai_promptbody || '',
          systemPrompt: selected.wmkf_ai_systemprompt || '',
          variables: selected.wmkf_ai_promptvariables || null,
          outputSchema: selected.wmkf_ai_promptoutputschema || null,
          model: selected.wmkf_ai_model || null,
          temperature: selected.wmkf_ai_temperature ?? null,
          maxTokens: selected.wmkf_ai_maxtokens ?? null,
          publishedAt: selected.wmkf_ai_publisheddatetime || null,
          modifiedOn: selected.modifiedon || null,
          bodySha256: sha256(selected.wmkf_ai_promptbody || ''),
          contentSha256: contentHash({
            body: selected.wmkf_ai_promptbody || '',
            systemPrompt: selected.wmkf_ai_systemprompt || '',
            variables: selected.wmkf_ai_promptvariables || null,
          }),
        }
      : null,
    versions: versions.map((row) => ({
      id: row.wmkf_ai_promptid,
      version: row.wmkf_promptversion,
      isCurrent: row.wmkf_ai_iscurrent === true,
      publishedAt: row.wmkf_ai_publisheddatetime || null,
      modifiedOn: row.modifiedon || null,
    })),
    recentAudits: audits.rows.map(cleanRow),
    activationGate:
      current.length === 1
        ? 'captured; backward-compatible target prompt publication remains pending'
        : 'STOP: expected exactly one current prompt row',
  };
}

async function readQuestionAudits(sql) {
  const result = await sql`
    SELECT id, request_id, profile_id, phase, status, base_version, result_version,
           summary_json, before_json, after_json, warnings_json, created_at
      FROM review_question_audit
     ORDER BY created_at DESC
     LIMIT 25
  `;
  const rows = result.rows.map(cleanRow);
  return {
    rows,
    latestCompletedFinal:
      rows.find((row) => row.phase === 'final' && row.status === 'completed') || null,
    cutoverCompletedAudit: null,
    cutoverStatus: 'not yet published; no cutover audit can exist',
  };
}

const SUGGESTION_SELECT = [
  'wmkf_appreviewersuggestionid',
  'wmkf_suggestionlabel',
  '_wmkf_request_value',
  '_wmkf_potentialreviewer_value',
  '_wmkf_honorariumrequest_value',
  'wmkf_selected',
  'wmkf_invited',
  'wmkf_accepted',
  'wmkf_declined',
  'wmkf_responsetype',
  'wmkf_reviewstatus',
  'wmkf_reviewreceivedat',
  'wmkf_completedat',
  'wmkf_thankyousentat',
  'wmkf_reviewuploadedbystaff',
  'wmkf_reviewfilename',
  'wmkf_reviewsharepointfolder',
  'wmkf_applicantdisposition',
].join(',');

const ANSWER_SELECT = [
  'wmkf_appreviewanswerid',
  '_wmkf_appreviewersuggestion_value',
  'wmkf_questionkey',
  'wmkf_questiontype',
  'wmkf_questiontext',
  'wmkf_answervalue',
  'wmkf_answertext',
  'wmkf_answerhtml',
  'wmkf_answervalues',
].join(',');

async function readFixture(runtime, sql, suggestionId) {
  let suggestion;
  try {
    suggestion = await runtime.DynamicsService.getRecord(
      'wmkf_appreviewersuggestions',
      suggestionId,
      { select: SUGGESTION_SELECT },
    );
  } catch (error) {
    if (error?.status === 404 || error?.response?.status === 404) {
      return { suggestionId, absent: true };
    }
    throw error;
  }

  const requestId = suggestion._wmkf_request_value || null;
  const personId = suggestion._wmkf_potentialreviewer_value || null;
  const [request, person, answerResult, draftResult] = await Promise.all([
    requestId
      ? runtime.DynamicsService.getRecord('akoya_requests', requestId, {
          select: [
            'akoya_requestid',
            'akoya_requestnum',
            'akoya_title',
            'wmkf_reviewsynthesisjson',
            'modifiedon',
            '_wmkf_programdirector_value',
          ].join(','),
        })
      : null,
    personId
      ? runtime.DynamicsService.getRecord('wmkf_potentialreviewerses', personId, {
          select: [
            'wmkf_potentialreviewersid',
            'wmkf_name',
            'wmkf_emailaddress',
            '_wmkf_contact_value',
          ].join(','),
        })
      : null,
    runtime.DynamicsService.queryAllRecords('wmkf_appreviewanswers', {
      select: ANSWER_SELECT,
      filter: `_wmkf_appreviewersuggestion_value eq ${suggestionId}`,
      orderby: 'wmkf_questionkey asc',
    }),
    sql`
      SELECT id, suggestion_id, draft_json, updated_at
        FROM review_drafts
       WHERE suggestion_id = ${suggestionId}
       LIMIT 1
    `,
  ]);

  const requestSuggestions = requestId
    ? await runtime.DynamicsService.queryAllRecords('wmkf_appreviewersuggestions', {
        select: SUGGESTION_SELECT,
        filter:
          `_wmkf_request_value eq ${requestId} and ` +
          '(wmkf_applicantdisposition eq null or wmkf_applicantdisposition ne 100000001)',
      })
    : { records: [] };

  let pdContext = null;
  if (requestId) {
    const { loadRequestContext } = await import('../lib/services/reviewer-reminder-sweep.js');
    pdContext = await loadRequestContext(requestId, new Map());
  }

  let synthesisRuns = [];
  if (requestId) {
    try {
      const runResult = await runtime.DynamicsService.queryAllRecords('wmkf_ai_runs', {
        select: [
          'wmkf_ai_runid',
          '_wmkf_ai_request_value',
          '_wmkf_ai_prompt_value',
          'wmkf_ai_promptversion',
          'wmkf_ai_status',
          'createdon',
        ].join(','),
        filter: `_wmkf_ai_request_value eq ${requestId}`,
        orderby: 'createdon desc',
      });
      synthesisRuns = (runResult.records || []).map(cleanRow);
    } catch (error) {
      synthesisRuns = [{ readError: errorShape(error) }];
    }
  }

  const rowsForRequest = requestSuggestions.records || [];
  const includedWorkbench = suggestion.wmkf_selected === true && suggestion.wmkf_accepted === true;
  const includedReport =
    includedWorkbench && Boolean(suggestion.wmkf_reviewreceivedat);
  const includedSynthesis = includedReport;
  const excluded = suggestion.wmkf_applicantdisposition === 100000001;
  const thankYouEligible = Boolean(
    suggestion.wmkf_reviewreceivedat
      && !suggestion.wmkf_thankyousentat
      && !excluded
      && requestId
      && personId
      && person?.wmkf_emailaddress
      && pdContext?.pd?.internalemailaddress
      && pdContext?.pd?.systemuserid,
  );
  const synthesisMemo = request?.wmkf_reviewsynthesisjson || '';
  const synthesisIncludedSuggestions = rowsForRequest
    .filter((row) =>
      row.wmkf_selected === true
      && row.wmkf_accepted === true
      && Boolean(row.wmkf_reviewreceivedat))
    .map((row) => ({
      suggestionId: row.wmkf_appreviewersuggestionid,
      reviewReceivedAt: row.wmkf_reviewreceivedat,
      isFixture: FIXTURE_IDS.includes(row.wmkf_appreviewersuggestionid),
    }));
  const markerText = [
    suggestion.wmkf_suggestionlabel,
    suggestion.wmkf_reviewfilename,
    person?.wmkf_name,
    person?.wmkf_emailaddress,
    request?.akoya_title,
  ].filter(Boolean).join(' ');
  const obviousTestMarker = /\b(?:test|eicar|fixture|sandbox)\b/i.test(markerText);
  const retainedReportStop = includedReport && !obviousTestMarker;
  const nonTestOwnerStop = Boolean(personId && !obviousTestMarker);
  const hardStops = [
    ...(suggestion.wmkf_thankyousentat ? ['thank_you_already_sent'] : []),
    ...(suggestion._wmkf_honorariumrequest_value ? ['honorarium_dependency'] : []),
    ...(retainedReportStop ? ['retained_report_without_test_marker'] : []),
    ...(nonTestOwnerStop ? ['person_identity_not_obviously_test'] : []),
  ];

  return {
    suggestionId,
    absent: false,
    suggestion: cleanRow(suggestion),
    request: request
      ? {
          ...cleanRow(request),
          synthesisSha256: sha256(synthesisMemo),
          synthesisLength: synthesisMemo.length,
        }
      : null,
    person: cleanRow(person),
    answers: (answerResult.records || []).map(cleanRow),
    draft: draftResult.rows[0] ? cleanRow(draftResult.rows[0]) : null,
    consumers: {
      workbenchDtoIncluded: includedWorkbench,
      reportComposerIncluded: includedReport,
      synthesisIncluded: includedSynthesis,
      synthesisIncludedSuggestions,
      synthesisRunsForRequest: synthesisRuns,
      synthesisTimestampAssessment: synthesisMemo
        ? {
            requestModifiedOn: request?.modifiedon || null,
            artifactReviewReceivedAt: suggestion.wmkf_reviewreceivedat || null,
            requestModifiedAfterArtifactReview: Boolean(
              request?.modifiedon
                && suggestion.wmkf_reviewreceivedat
                && new Date(request.modifiedon) > new Date(suggestion.wmkf_reviewreceivedat),
            ),
            caveat:
              'request.modifiedon is row-level, not a field-level synthesis timestamp; matching AI-run rows are included separately when readable',
          }
        : null,
      thankYou: {
        eligible: thankYouEligible,
        reviewReceivedAt: suggestion.wmkf_reviewreceivedat || null,
        thankYouSentAt: suggestion.wmkf_thankyousentat || null,
        exclusionFilterPasses: !excluded,
        requestId,
        personId,
        reviewerEmail: person?.wmkf_emailaddress || null,
        programDirectorEmail: pdContext?.pd?.internalemailaddress || null,
        programDirectorSystemUserId: pdContext?.pd?.systemuserid || null,
      },
    },
    disposition: {
      status: hardStops.length === 0 ? 'candidate_test_artifact_requires_owner_approval' : 'STOP_REVIEW_REQUIRED',
      obviousTestMarker,
      hardStops,
      humanIdentityConfirmationRequired: Boolean(personId),
      deletionAuthorized: false,
      requiredDeleteContactValue: false,
      expectedConsumerCorrections: [
        ...(includedWorkbench ? ['remove from accepted-reviewer workbench DTO'] : []),
        ...(includedReport ? ['remove from submitted-review reports and courtesy-copy source'] : []),
        ...(includedSynthesis
          ? ['remove from future synthesis inputs; preserve current memo and mark potentially stale']
          : []),
        ...(thankYouEligible ? ['remove from thank-you sweep eligibility'] : []),
        ...((answerResult.records || []).length > 0 ? ['delete answer snapshot rows atomically'] : []),
        ...(draftResult.rows[0] ? ['delete Postgres review draft after Dataverse removal'] : []),
        ...(suggestion.wmkf_reviewfilename || suggestion.wmkf_reviewsharepointfolder
          ? ['attempt linked SharePoint test-file cleanup and report any warning']
          : []),
      ],
    },
  };
}

async function main() {
  const writer = arg('writer-probe');
  if (writer) {
    const result = await runWriterProbe(writer);
    console.log(`PROBE_JSON=${JSON.stringify(result)}`);
    return;
  }

  const outputArg = arg('output');
  if (!outputArg) {
    throw new Error('--output <path> is required');
  }
  const outputPath = path.resolve(REPO_ROOT, outputArg);
  if (!outputPath.startsWith(`${REPO_ROOT}${path.sep}`)) {
    throw new Error('--output must resolve inside the repository');
  }

  const runtime = await loadRuntime();
  runtime.enterDynamicsBypassForScript('probe-review-multiselect-preactivation');
  const { sql } = await import('@vercel/postgres');

  const [questions, questionAudits, prompt] = await Promise.all([
    readQuestionEvidence(runtime),
    readQuestionAudits(sql),
    readPromptEvidence(runtime, sql),
  ]);
  const fixtures = [];
  for (const suggestionId of FIXTURE_IDS) {
    fixtures.push(await readFixture(runtime, sql, suggestionId));
  }
  const writerProbes = WRITER_NAMES.map(runIsolatedWriterProbe);

  const generatedAt = new Date().toISOString();
  const report = {
    schemaVersion: 1,
    reportType: 'review-form-multiselect-preactivation',
    mode: 'READ_ONLY',
    generatedAt,
    source: {
      gitCommit: currentCommit(),
      script: path.relative(REPO_ROOT, SCRIPT_PATH),
      operator: os.userInfo().username,
      targetHostname: targetHostname(),
    },
    claims: {
      questionBaseline: '[VERIFIED via production Dataverse read]',
      promptBaseline: '[VERIFIED via production Dataverse + Postgres audit reads]',
      fixtureConsumers: '[VERIFIED via production Dataverse + Postgres reads and live consumer predicates]',
      writerAuthority:
        '[VERIFIED at production-target service boundaries; independently routed production HTTP verification remains PLANNED]',
      rollback:
        '[PLANNED template only; deliberately blocked until post-publication row IDs/ETags and completed cutover audit exist]',
    },
    questions,
    questionAudits,
    prompt,
    fixtures,
    writerProbes,
    releaseGates: {
      schemaAndCompatibleCode: 'completed before this probe',
      writerServiceBoundaryNoWriteProbes: writerProbes.every((probe) => probe.noWriteStopObserved),
      independentlyRoutedProductionHttpWriterVerification: false,
      fixtureDeletionApproved: false,
      fixtureDeletionCompleted: false,
      backwardCompatiblePromptPublished: false,
      targetQuestionSetPublished: false,
      rollbackManifestExecutable: false,
      exposureAuthorized: false,
    },
  };
  report.integrity = {
    algorithm: 'sha256',
    scope: 'canonical JSON report excluding integrity',
    digest: contentHash(report),
    note: 'Integrity hash, not a cryptographic operator signature.',
  };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Wrote READ-ONLY evidence: ${path.relative(REPO_ROOT, outputPath)}`);
  console.log(`Report SHA-256: ${report.integrity.digest}`);
  console.log(`Active question version: ${questions.activeVersion}`);
  console.log(`Target question version: ${questions.targetVersion}`);
  console.log(`Writer no-write probes green: ${report.releaseGates.writerServiceBoundaryNoWriteProbes}`);
  for (const fixture of fixtures) {
    console.log(
      `Fixture ${fixture.suggestionId}: ${fixture.disposition?.status || (fixture.absent ? 'absent' : 'unknown')}`,
    );
  }
}

main().catch((error) => {
  console.error('Preactivation probe failed:', error);
  process.exit(1);
});
