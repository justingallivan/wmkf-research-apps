import crypto from 'crypto';
import { ServiceHttpError } from '../service-http-error.js';
import { isGuid } from '../../utils/guid.js';
import {
  PRE_SITE_VISIT_TEMPLATE,
} from './docx-renderer.js';
import {
  PROMPT_OUTPUT_SCHEMA,
  PROMPT_VARIABLES,
  PROPOSAL_CORE_KEYS,
  REQUIRED_SYSTEM_ASSERTIONS,
  USER_PROMPT_TEMPLATE,
} from '../../../shared/config/prompts/pre-site-visit-proposal-core.js';
import {
  isPreSiteDistributionSnapshot,
  PRE_SITE_VISIT_CONTRACT,
  REQUEST_DOCUMENT_ARTIFACT_TYPE,
  REQUEST_DOCUMENT_LIFECYCLE_STATE,
  REQUEST_DOCUMENT_OPERATION_STATUS,
} from '../../../shared/config/requestDocument.js';
import {
  prepareGeneratedCore,
  validateGeneratedCore,
} from './proposal-core-service.js';

const GENERATING_LEASE_MS = 15 * 60 * 1000;
const UNCHANGED_RETRY_BLOCKED_CODES = new Set([
  'claude_output_schema_invalid',
  'pre_site_visit_prompt_invalid',
  'pre_site_visit_prompt_empty_section',
  'pre_site_visit_prompt_reserved_token',
  'pre_site_visit_core_reconciliation_required',
  'pre_site_visit_draft_incomplete',
  'pre_site_visit_snapshot_mismatch',
]);
const REQUEST_LINEAGE_SELECT = [
  'akoya_requestid',
  '_wmkf_currentpresitevisit_value',
].join(',');
const SECTION_FIELDS = Object.freeze({
  executiveSummary: 'wmkf_presiteexecutivesummary',
  impactOverview: 'wmkf_presiteimpactoverview',
  methodologyOverview: 'wmkf_presitemethodologyoverview',
  personnelOverview: 'wmkf_presitepersonneloverview',
  keckFundingRationale: 'wmkf_presitekeckfundingrationale',
  backgroundAndImpact: 'wmkf_presitebackgroundandimpact',
  detailedMethodology: 'wmkf_presitedetailedmethodology',
  personnelDetails: 'wmkf_presitepersonneldetails',
});

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function sameNullableId(left, right) {
  if (!left && !right) return true;
  return String(left || '').toLowerCase() === String(right || '').toLowerCase();
}

function staleGenerationReplayError() {
  return new ServiceHttpError(
    'This generation request refers to a Pre-Site draft that is no longer current. Reload and try again.',
    {
      httpStatus: 409,
      code: 'pre_site_visit_generation_replay_stale',
      body: {
        error: 'This generation request refers to a Pre-Site draft that is no longer current. Reload and try again.',
        code: 'pre_site_visit_generation_replay_stale',
      },
    },
  );
}

function sanitizeFilePart(value) {
  return String(value || '')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

function sanitizeError(error) {
  return {
    code: String(error?.code || error?.status || 'pre_site_visit_failed').slice(0, 100),
    message: String(error?.message || 'Pre-Site Visit generation failed')
      .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
      .replace(/[A-Za-z0-9_~.-]{40,}/g, '[redacted]')
      .slice(0, 2000),
  };
}

function conditionalOptions(row, actingUserSystemId = null) {
  if (!row?._etag) {
    throw new ServiceHttpError('Pre-Site request-document row is missing its write fence.', {
      httpStatus: 500,
    });
  }
  return {
    ifMatch: row._etag,
    ...(actingUserSystemId ? { actingUserSystemId } : {}),
  };
}

function parseJsonField(value, label) {
  try {
    return typeof value === 'string' ? JSON.parse(value) : value;
  } catch {
    throw new ServiceHttpError(`The ${label} JSON is invalid.`, { httpStatus: 500 });
  }
}

function validateNarrativePrompt(prompt) {
  const promptId = prompt?.wmkf_ai_promptid;
  const promptVersion = Number(prompt?.wmkf_promptversion);
  const variables = parseJsonField(prompt?.wmkf_ai_promptvariables, 'current Pre-Site prompt variables');
  const declared = (variables?.variables || []).map((variable) => variable?.name);
  const names = new Set(declared);
  const required = ['request_context_json', 'proposal_text'];
  const missing = required.filter((name) => !names.has(name));
  const unexpected = declared.filter((name) => !required.includes(name));
  let outputSchema = null;
  try {
    outputSchema = parseJsonField(
      prompt?.wmkf_ai_promptoutputschema,
      'current Pre-Site prompt output schema',
    );
  } catch {
    outputSchema = null;
  }
  const expectedVariables = JSON.stringify(PROMPT_VARIABLES);
  const expectedOutputSchema = JSON.stringify(PROMPT_OUTPUT_SCHEMA);
  const systemPrompt = String(prompt?.wmkf_ai_systemprompt || '');
  const promptBody = String(prompt?.wmkf_ai_promptbody || '');
  const contractMatches = JSON.stringify(variables) === expectedVariables
    && JSON.stringify(outputSchema) === expectedOutputSchema
    && promptBody === USER_PROMPT_TEMPLATE
    && REQUIRED_SYSTEM_ASSERTIONS.every((assertion) => systemPrompt.includes(assertion));
  if (!isGuid(promptId) || !Number.isInteger(promptVersion) || promptVersion < 1
      || missing.length || unexpected.length || names.size !== required.length
      || declared.length !== required.length || !contractMatches) {
    throw new ServiceHttpError(
      'The current Pre-Site prompt is not a published narrative-only prompt version.',
      {
        httpStatus: 409,
        code: 'pre_site_visit_prompt_not_ready',
        body: {
          error: 'The current Pre-Site prompt is not a published narrative-only prompt version.',
          code: 'pre_site_visit_prompt_not_ready',
        },
      },
    );
  }
  return {
    promptId: promptId.toLowerCase(),
    promptName: String(prompt.wmkf_ai_promptname || PRE_SITE_VISIT_CONTRACT.promptName),
    promptVersion,
  };
}

function validateTemplateContract() {
  if (PRE_SITE_VISIT_TEMPLATE.id !== PRE_SITE_VISIT_CONTRACT.templateId
    || String(PRE_SITE_VISIT_TEMPLATE.version) !== PRE_SITE_VISIT_CONTRACT.templateVersion) {
    throw new ServiceHttpError('The Pre-Site renderer and artifact template contracts have drifted.', {
      httpStatus: 500,
      code: 'pre_site_visit_template_contract_drift',
    });
  }
}

function parseCleanupQueue(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) throw new Error('not an array');
    return parsed;
  } catch {
    throw new ServiceHttpError('Pre-Site SharePoint cleanup state is unreadable.', {
      httpStatus: 500,
    });
  }
}

function sourceManifest(source) {
  const manifest = {
    role: 'proposalNarrative',
    filename: source?.filename || null,
    siteId: source?.siteId || null,
    driveId: source?.driveId || null,
    itemId: source?.itemId || null,
    versionId: source?.versionId || null,
    contentHash: source?.contentHash || null,
  };
  if (!manifest.filename || !manifest.siteId || !manifest.driveId || !manifest.itemId
    || !manifest.versionId || !/^[a-f0-9]{64}$/i.test(manifest.contentHash || '')) {
    throw new ServiceHttpError('Pre-Site proposal source identity is incomplete.', {
      httpStatus: 409,
      code: 'pre_site_visit_source_identity_incomplete',
    });
  }
  return [manifest];
}

export function buildPreSiteVisitInputSnapshot(inputs) {
  const { context } = inputs;
  return {
    // Slice 4 (S467 v3 precedent, plan §4.5): v4 adds request.refereeSection.
    schemaVersion: 4,
    request: {
      requestId: context.requestId,
      requestNumber: context.requestNumber,
      projectTitle: context.projectTitle,
      applicantInstitution: context.applicantInstitution,
      cityState: context.documentFields.cityState,
      internalProgram: context.documentFields.internalProgram,
      meetingDate: context.documentFields.meetingDate,
      requestedAmount: context.documentFields.requestedAmount,
      invitedAmount: context.documentFields.invitedAmount,
      totalProjectBudget: context.documentFields.totalProjectBudget,
      programDirector: context.documentFields.programDirector,
      institutionalFundingHistory: context.documentFields.institutionalFundingHistory,
      projectPeriod: context.projectPeriod,
      personnel: context.personnel,
      refereeSection: context.documentFields.refereeSection ?? null,
    },
    proposalSources: sourceManifest(inputs.proposalNarrative),
  };
}

export function buildPreSiteVisitIdentity({
  requestId,
  inputSnapshot,
  promptIdentity,
  reopenCycleId = null,
}) {
  const inputFingerprint = sha256(JSON.stringify(inputSnapshot));
  const generationKey = sha256(JSON.stringify({
    requestId: requestId.toLowerCase(),
    artifactType: PRE_SITE_VISIT_CONTRACT.artifactType,
    inputFingerprint,
    promptId: promptIdentity.promptId,
    promptName: promptIdentity.promptName,
    promptVersion: promptIdentity.promptVersion,
    templateId: PRE_SITE_VISIT_CONTRACT.templateId,
    templateVersion: PRE_SITE_VISIT_CONTRACT.templateVersion,
    ...(reopenCycleId ? { reopenCycleId: String(reopenCycleId).toLowerCase() } : {}),
  }));
  return { inputFingerprint, generationKey };
}

function fileNameFor(requestNumber, generationKey, claimToken) {
  return `${sanitizeFilePart(requestNumber)} Pre-Site Visit `
    + `${generationKey.slice(0, 8)}-${claimToken.slice(0, 8)}.docx`;
}

function assertPreSiteWordRow(row) {
  if (!row
    || row.wmkf_artifacttype !== REQUEST_DOCUMENT_ARTIFACT_TYPE.PRE_SITE_VISIT
    || row.wmkf_contenttype !== PRE_SITE_VISIT_CONTRACT.contentType) {
    throw new ServiceHttpError('Request-document row is not a governed Pre-Site Word document.', {
      httpStatus: 500,
    });
  }
  if (!Object.values(REQUEST_DOCUMENT_OPERATION_STATUS).includes(row.wmkf_operationstatus)
    || !Object.values(REQUEST_DOCUMENT_LIFECYCLE_STATE).includes(row.wmkf_lifecyclestate)) {
    throw new ServiceHttpError('Pre-Site request-document row has an unknown state.', {
      httpStatus: 500,
    });
  }
  return row;
}

const WARNING_MESSAGES = Object.freeze({
  section_over_target: 'A generated section is longer than suggested and may need editing.',
  long_form_over_target: 'Background and Methodology may require layout editing.',
  paragraphs_over_target: 'A generated section has more paragraphs than suggested.',
  personnel_name_not_matched: 'A roster name was not found exactly in a Personnel section.',
  proposal_input_truncated: 'Claude received a truncated proposal input; review the draft for omitted material.',
  extra_output_key_dropped: 'Claude returned an undeclared field that was excluded from the draft.',
  unknown_review_warning: 'The draft completed with a review warning.',
  funding_history_manual: 'Institutional Funding History was not filled automatically (this document was generated before the Dataverse fill). Check that it is completed in Word; this note stays until the document is regenerated.',
  referee_section_manual: 'The Reviews paragraph was not filled automatically (no submitted reviews at generation, or generated before the Dataverse fill). Check that it is completed in Word; this note stays until the document is regenerated.',
  referee_name_not_matched: 'A reviewer name was not found exactly in the Reviews paragraph.',
  referee_blocker_unnamed: 'An unresolved reviewer invitation could not be attributed to a name and was counted generically instead.',
  referee_rating_unlabelled: 'A submitted review has a rating outside the current form scale; the Reviews paragraph score tally omits it.',
});
const SECTION_LABELS = Object.freeze({
  executiveSummary: 'Executive Summary',
  impactOverview: 'Impact Overview',
  methodologyOverview: 'Methodology Overview',
  personnelOverview: 'Personnel Overview',
  keckFundingRationale: 'Keck Funding Rationale',
  backgroundAndImpact: 'Background and Impact',
  detailedMethodology: 'Detailed Methodology',
  personnelDetails: 'Personnel Details',
});

function validateDiagnostics(value) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 100) {
    throw new ServiceHttpError('Pre-Site proposal-core diagnostics require reconciliation.', {
      httpStatus: 500,
      code: 'pre_site_visit_diagnostics_invalid',
    });
  }
  return value.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)
      || typeof entry.code !== 'string' || !/^[a-z0-9_]{1,80}$/.test(entry.code)) {
      throw new ServiceHttpError('Pre-Site proposal-core diagnostics require reconciliation.', {
        httpStatus: 500,
        code: 'pre_site_visit_diagnostics_invalid',
      });
    }
    const diagnostic = { code: entry.code };
    for (const key of [
      'section', 'rosterDisplayName', 'path',
      'observedWords', 'observedChars', 'targetWords', 'targetChars',
      'observed', 'target', 'originalChars', 'transmittedChars',
      // Slice 4 (plan §4.5): referee_blocker_unnamed carries `reason`;
      // referee_name_not_matched carries `name`.
      'reason', 'name',
    ]) {
      if (typeof entry[key] === 'string') diagnostic[key] = entry[key].slice(0, 200);
      if (Number.isFinite(entry[key])) diagnostic[key] = Number(entry[key]);
      if (entry[key] === null) diagnostic[key] = null;
    }
    return diagnostic;
  });
}

function diagnosticsForRow(row) {
  if (!row.wmkf_presiteproposalcorejson) return [];
  const coreEnvelope = parseJsonField(row.wmkf_presiteproposalcorejson, 'Pre-Site proposal core');
  // Slice 4 (plan §4.5): v4 keeps the coreEnvelope/inputSnapshot versions in
  // lockstep with S467's v3 precedent, even though the referee fill lives
  // entirely in the input snapshot/documentFields, not the proposalCore
  // content itself.
  if (![2, 3, 4].includes(coreEnvelope?.schemaVersion)) {
    throw new ServiceHttpError('The Pre-Site proposal-core envelope version is unsupported.', {
      httpStatus: 409,
      code: 'pre_site_visit_core_version_unsupported',
    });
  }
  const inputSnapshot = row.wmkf_presiteinputsnapshotjson
    ? parseJsonField(row.wmkf_presiteinputsnapshotjson, 'Pre-Site input snapshot')
    : null;
  // Ready rows persisted before S467 carry v2 snapshots (no funding history);
  // v3 adds it; v4 (Slice 4) adds request.refereeSection. All three remain
  // readable for warnings/diagnostics.
  if (![2, 3, 4].includes(inputSnapshot?.schemaVersion)) {
    throw new ServiceHttpError('The Pre-Site input snapshot version is unsupported.', {
      httpStatus: 409,
      code: 'pre_site_visit_snapshot_version_unsupported',
    });
  }
  const personnelNames = (inputSnapshot.request?.personnel || []).map((person) => person?.name);
  const prepared = prepareGeneratedCore(coreEnvelope.proposalCore, { personnelNames });
  const namedCore = validateGeneratedCore(
    Object.fromEntries(PROPOSAL_CORE_KEYS.map((key) => [key, row[SECTION_FIELDS[key]]])),
  );
  if (JSON.stringify(namedCore) !== JSON.stringify(prepared.proposalCore)) {
    throw new ServiceHttpError('Pre-Site proposal-core fields do not match the audited envelope.', {
      httpStatus: 409,
      code: 'pre_site_visit_core_reconciliation_required',
    });
  }
  const stored = [3, 4].includes(coreEnvelope.schemaVersion)
    ? validateDiagnostics(coreEnvelope.diagnostics)
    : [];
  // v2 documents still carry the [[AI:InstitutionalFundingHistory]] placeholder
  // in Word; surface that as a per-document edit task instead of letting the
  // generic help text imply it was filled.
  const legacy = inputSnapshot.schemaVersion === 2 ? [{ code: 'funding_history_manual' }] : [];
  // Slice 4: a document whose input snapshot predates the referee feature
  // (v2 or v3), OR whose v4 snapshot has no composed referee section (zero
  // submitted reviews at generation), never had [[STAFF:RefereeSection]]
  // filled automatically — surface the same manual note either way, derived
  // purely from the stored snapshot content (modelled on funding_history_manual).
  const refereeManual = inputSnapshot.schemaVersion < 4 || !inputSnapshot.request?.refereeSection
    ? [{ code: 'referee_section_manual' }]
    : [];
  const unique = new Map();
  for (const diagnostic of [...prepared.diagnostics, ...stored, ...legacy, ...refereeManual]) {
    unique.set(JSON.stringify(diagnostic), diagnostic);
  }
  return [...unique.values()];
}

function projectWarnings(row) {
  return diagnosticsForRow(row).map((diagnostic) => {
    const known = Object.prototype.hasOwnProperty.call(WARNING_MESSAGES, diagnostic.code);
    const code = known ? diagnostic.code : 'unknown_review_warning';
    let message = WARNING_MESSAGES[code];
    const sectionLabel = SECTION_LABELS[diagnostic.section];
    if (code === 'section_over_target' && sectionLabel) {
      message = `${sectionLabel} is longer than suggested and may need editing.`;
    } else if (code === 'paragraphs_over_target' && sectionLabel) {
      message = `${sectionLabel} has more paragraphs than suggested.`;
    } else if (code === 'personnel_name_not_matched' && sectionLabel) {
      message = `A roster name was not found exactly in ${sectionLabel}.`;
    } else if (code === 'referee_name_not_matched' && diagnostic.name) {
      message = `A reviewer name ("${diagnostic.name}") was not found exactly in the Reviews paragraph.`;
    } else if (code === 'referee_rating_unlabelled' && diagnostic.name) {
      message = `${diagnostic.name}'s submitted rating is outside the current form scale; the Reviews paragraph score tally omits it.`;
    }
    return {
      ...diagnostic,
      code,
      message,
    };
  });
}

export function projectPreSiteVisitArtifact(row) {
  assertPreSiteWordRow(row);
  const isReopenAuditEvent = Boolean(row.wmkf_reopenreasoncode);
  return {
    artifactId: row.wmkf_requestdocumentid,
    requestId: row._wmkf_request_value,
    operationStatus: row.wmkf_operationstatus,
    lifecycleState: row.wmkf_lifecyclestate,
    retryable: row.wmkf_operationstatus === REQUEST_DOCUMENT_OPERATION_STATUS.FAILED
      && !UNCHANGED_RETRY_BLOCKED_CODES.has(row.wmkf_lasterrorcode),
    warnings: projectWarnings(row),
    file: row.wmkf_sharepointitemid ? {
      siteId: row.wmkf_sharepointsiteid,
      driveId: row.wmkf_sharepointdriveid,
      itemId: row.wmkf_sharepointitemid,
      webUrl: row.wmkf_sharepointweburl,
      versionId: row.wmkf_sharepointversionid,
      eTag: row.wmkf_sharepointetag,
      folderPath: row.wmkf_sharepointfolderpath,
      name: row.wmkf_filename,
      size: row.wmkf_filesize,
      lastModified: row.wmkf_sharepointlastmodified,
    } : null,
    provenance: {
      inputFingerprint: row.wmkf_inputfingerprint,
      renderInputFingerprint: row.wmkf_renderinputfingerprint,
      promptName: row.wmkf_promptname,
      promptVersion: row.wmkf_promptversion,
      promptId: row._wmkf_aiprompt_value || null,
      runId: row._wmkf_airun_value || null,
      templateId: row.wmkf_templateid,
      templateVersion: row.wmkf_templateversion,
      contentHash: row.wmkf_contenthash,
    },
    milestone: row.wmkf_milestoneversionid ? {
      versionId: row.wmkf_milestoneversionid,
      contentHash: row.wmkf_milestonecontenthash || null,
      createdAt: row.wmkf_milestonecreatedat || null,
      actorId: row._wmkf_milestonecreatedby_value || null,
      actorName: row._wmkf_milestonecreatedby_value_formatted || null,
    } : null,
    correction: row.wmkf_reopencycleid ? {
      cycleId: row.wmkf_reopencycleid,
      reasonCode: row.wmkf_reopenreasoncode || null,
      reasonNote: row.wmkf_reopenreasonnote || null,
      sourceArtifactId: row._wmkf_sourcedocument_value || null,
      sourceVersionId: row.wmkf_sourceversionid || null,
      sourceContentHash: row.wmkf_sourcecontenthash || null,
      actorId: isReopenAuditEvent ? row._wmkf_initiatedby_value || null : null,
      actorName: isReopenAuditEvent ? row._wmkf_initiatedby_value_formatted || null : null,
      createdAt: isReopenAuditEvent ? row.wmkf_initiatedat || null : null,
    } : null,
    lastError: row.wmkf_lasterrormessage ? {
      code: row.wmkf_lasterrorcode || null,
      message: row.wmkf_lasterrormessage,
      at: row.wmkf_lastfailedat || null,
      supportReference: row._wmkf_airun_value || row.wmkf_requestdocumentid,
    } : null,
  };
}

function projectReopenHistory(rows) {
  const byId = new Map(rows.map((row) => [
    String(row.wmkf_requestdocumentid || '').toLowerCase(),
    row,
  ]));
  return rows
    .filter((row) => row.wmkf_reopencycleid && row.wmkf_reopenreasoncode)
    .sort((left, right) => Date.parse(right.createdon || '') - Date.parse(left.createdon || ''))
    .map((row) => {
      const artifact = projectPreSiteVisitArtifact(row);
      const source = byId.get(String(row._wmkf_sourcedocument_value || '').toLowerCase()) || null;
      const cleanupRequired = [
        ...parseCleanupQueue(row.wmkf_orphancleanupjson),
        ...parseCleanupQueue(row.wmkf_orphancleanupoverflowjson),
      ];
      return {
        artifactId: artifact.artifactId,
        operationStatus: artifact.operationStatus,
        lifecycleState: artifact.lifecycleState,
        outcome: cleanupRequired.length > 0
          ? 'needs_reconciliation'
          : artifact.operationStatus === REQUEST_DOCUMENT_OPERATION_STATUS.READY
          ? 'completed'
          : artifact.operationStatus === REQUEST_DOCUMENT_OPERATION_STATUS.FAILED
            ? 'failed'
            : artifact.operationStatus === REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING
              ? 'in_progress'
              : 'needs_reconciliation',
        correction: artifact.correction,
        file: artifact.file,
        cleanupRequired,
        source: source ? {
          artifactId: source.wmkf_requestdocumentid,
          fileName: source.wmkf_filename || null,
          milestone: source.wmkf_milestoneversionid ? {
            versionId: source.wmkf_milestoneversionid,
            contentHash: source.wmkf_milestonecontenthash || null,
            createdAt: source.wmkf_milestonecreatedat || null,
          } : null,
        } : null,
      };
    });
}

/** Read the current Ready Word row and newest non-current operation without side effects. */

function proposalCorePatch(proposalCore) {
  return Object.fromEntries(PROPOSAL_CORE_KEYS.map((key) => [SECTION_FIELDS[key], proposalCore[key]]));
}

function documentFieldsFromSnapshot(snapshot) {
  const request = snapshot.request;
  return {
    institutionName: request.applicantInstitution,
    cityState: request.cityState,
    internalProgram: request.internalProgram,
    projectTitle: request.projectTitle,
    meetingDate: request.meetingDate,
    requestedAmount: request.requestedAmount,
    programDirector: request.programDirector,
    invitedAmount: request.invitedAmount,
    totalProjectBudget: request.totalProjectBudget,
    institutionalFundingHistory: request.institutionalFundingHistory,
    // Slice 4 (v4 snapshot only; absent/null on legacy v2/v3 rows) — so the
    // regenerate/render-only path reaches the renderer with the SAME referee
    // text/names as first generation.
    refereeSection: request.refereeSection ?? null,
  };
}

function persistedDraft(row, expectedInputSnapshot) {
  const hasCore = Boolean(row.wmkf_presiteproposalcorejson);
  const hasInputs = Boolean(row.wmkf_presiteinputsnapshotjson);
  // A failed Executor attempt may be linked without having produced a usable
  // draft. That state is retryable: only a partial core/snapshot pair is
  // corruption. Once both snapshots exist, a successful run link is required.
  if (!hasCore && !hasInputs) return null;
  if (!hasCore || !hasInputs || !row._wmkf_airun_value) {
    throw new ServiceHttpError('Pre-Site draft persistence is incomplete and requires reconciliation.', {
      httpStatus: 409,
      code: 'pre_site_visit_draft_incomplete',
    });
  }
  const coreEnvelope = parseJsonField(row.wmkf_presiteproposalcorejson, 'Pre-Site proposal core');
  const inputSnapshot = parseJsonField(row.wmkf_presiteinputsnapshotjson, 'Pre-Site input snapshot');
  // Snapshot v4 (Slice 4, plan §4.5) added request.refereeSection, following
  // the S467 v3 precedent (institutionalFundingHistory). The fingerprint is
  // part of the generation key, so a v2/v3 draft can never be reached from a
  // new key; only the current shape is accepted here. coreEnvelope admits
  // [2,3,4] rather than exactly 4 as a narrow race-window tolerance (a
  // mid-deploy claim whose input snapshot already matches the new v4
  // `expectedInputSnapshot` but whose core write landed just before the
  // schemaVersion bump) — the input-snapshot equality check below is the
  // real discriminator.
  if (![2, 3, 4].includes(coreEnvelope?.schemaVersion) || inputSnapshot?.schemaVersion !== 4
    || JSON.stringify(inputSnapshot) !== JSON.stringify(expectedInputSnapshot)) {
    throw new ServiceHttpError('Pre-Site persisted snapshots do not match the claimed generation.', {
      httpStatus: 409,
      code: 'pre_site_visit_snapshot_mismatch',
    });
  }
  const personnelNames = (inputSnapshot.request.personnel || []).map((person) => person.name);
  const preparedEnvelope = prepareGeneratedCore(coreEnvelope.proposalCore, {
    personnelNames,
  });
  const namedCore = validateGeneratedCore(
    Object.fromEntries(PROPOSAL_CORE_KEYS.map((key) => [key, row[SECTION_FIELDS[key]]])),
  );
  if (JSON.stringify(namedCore) !== JSON.stringify(preparedEnvelope.proposalCore)) {
    throw new ServiceHttpError('Pre-Site proposal-core fields do not match the audited envelope.', {
      httpStatus: 409,
      code: 'pre_site_visit_core_reconciliation_required',
    });
  }
  return {
    proposalCore: namedCore,
    diagnostics: [...new Map([
      ...preparedEnvelope.diagnostics,
      ...([3, 4].includes(coreEnvelope.schemaVersion) ? validateDiagnostics(coreEnvelope.diagnostics) : []),
    ].map((diagnostic) => [JSON.stringify(diagnostic), diagnostic])).values()],
    inputSnapshot,
    documentFields: documentFieldsFromSnapshot(inputSnapshot),
    personnelNames,
  };
}

function renderFingerprint(draft) {
  return sha256(JSON.stringify({
    templateId: PRE_SITE_VISIT_CONTRACT.templateId,
    templateVersion: PRE_SITE_VISIT_CONTRACT.templateVersion,
    documentFields: draft.documentFields,
    proposalCore: draft.proposalCore,
    personnelNames: draft.personnelNames,
  }));
}

export {
  GENERATING_LEASE_MS,
  REQUEST_LINEAGE_SELECT,
  SECTION_FIELDS,
  UNCHANGED_RETRY_BLOCKED_CODES,
  assertPreSiteWordRow,
  conditionalOptions,
  documentFieldsFromSnapshot,
  fileNameFor,
  parseCleanupQueue,
  persistedDraft,
  prepareGeneratedCore,
  projectReopenHistory,
  proposalCorePatch,
  renderFingerprint,
  sanitizeError,
  sameNullableId,
  staleGenerationReplayError,
  validateDiagnostics,
  validateGeneratedCore,
  validateNarrativePrompt,
  validateTemplateContract,
};
