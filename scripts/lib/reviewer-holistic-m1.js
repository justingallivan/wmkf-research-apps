const crypto = require('node:crypto');

const SHA256_RE = /^[0-9a-f]{64}$/i;
const RANDOMIZATION_SEED_RE = /^[0-9a-f]{64}$/;
const BLIND_PROPOSAL_ID_RE = /^RPE-[0-9A-F]{10}$/;
const ORCID_RE = /^\d{4}-\d{4}-\d{4}-[\dX]{4}$/;
const OPENALEX_AUTHOR_RE = /^A[1-9]\d*$/;

const IDENTITY_TOP_LEVEL_KEYS = new Set([
  'schemaVersion',
  'status',
  'benchmarkVersion',
  'labelingPolicy',
  'pipelineOutputsVisibleToLabelers',
  'labelers',
  'adjudicator',
  'frozenAt',
  'cases',
]);
const IDENTITY_CASE_KEYS = new Set([
  'caseId',
  'caseStatus',
  'stratum',
  'hazardTypes',
  'frozenInput',
  'expected',
  'evidence',
  'labeler',
  'adjudication',
]);
const FROZEN_INPUT_KEYS = new Set(['candidate', 'upstreamResponses']);
const EXPECTED_KEYS = new Set([
  'personAnchor',
  'abstain',
  'actionEligible',
  'correctionIntegrity',
]);
const EVIDENCE_KEYS = new Set(['url', 'sourceType', 'claim', 'accessedAt']);
const ADJUDICATION_KEYS = new Set(['status', 'adjudicator']);
const EVIDENCE_TYPES = new Set([
  'discovery',
  'orcid_record',
  'institutional_profile',
  'publisher_record',
]);
const AUTHORITATIVE_EVIDENCE_TYPES = new Set([
  'orcid_record',
  'institutional_profile',
  'publisher_record',
]);
const HAZARD_TYPES = new Set([
  'namesake',
  'wrong_forename',
  'initials',
  'affiliation_drift',
  'merged_cluster',
  'stale_binding_correction',
  'no_orcid_early_career',
]);

const IDENTITY_BENCHMARK_VERSIONS = new Set([
  'reviewer-identity-v1',
  'reviewer-identity-v2',
]);
const IDENTITY_IMPORT_VERSIONS = new Map([
  ['reviewer-identity-v1', 'reviewer-identity-workbook-import-v1'],
  ['reviewer-identity-v2', 'reviewer-identity-workbook-import-v2'],
]);

const LABELING_IMPORT_TOP_LEVEL_KEYS = new Set([
  'schemaVersion',
  'importVersion',
  'benchmarkVersion',
  'labelingPolicy',
  'sourceWorkbook',
  'normalizationRules',
  'ownerClarifications',
  'rows',
]);
const LABELING_IMPORT_SOURCE_KEYS = new Set([
  'fileName',
  'sha256',
  'reviewer',
  'importedAt',
]);
const LABELING_IMPORT_CLARIFICATION_KEYS = new Set(['blindCaseId', 'resolution']);
const LABELING_IMPORT_ROW_KEYS = new Set([
  'blindCaseId',
  'caseId',
  'raw',
  'normalized',
  'normalizationNotes',
]);
const LABELING_IMPORT_RAW_KEYS = new Set([
  'decision',
  'personAnchor',
  'actionEligible',
  'correctionIntegrity',
  'evidenceReliedUpon',
  'rationale',
  'status',
]);

const PROPOSAL_TOP_LEVEL_KEYS = new Set([
  'schemaVersion',
  'status',
  'evaluationVersion',
  'selectionPolicy',
  'replicatesPerArm',
  'scorer',
  'randomizationSeedHash',
  'frozenAt',
  'proposals',
]);
const PROPOSAL_KEYS = new Set([
  'proposalId',
  'blindProposalId',
  'programArea',
  'signalLevel',
  'documentHash',
  'usedForTuning',
  'runs',
  'candidateArmMembership',
  'candidateScores',
]);
const RUN_KEYS = new Set(['baseline', 'redesign']);
const ARM_MEMBERSHIP_KEYS = new Set(['blindCandidateId', 'arms']);
const SCORE_KEYS = new Set([
  'blindCandidateId',
  'correctPerson',
  'onTopic',
  'independentEligible',
  'shortlist',
  'disqualifierReason',
  'coverageContribution',
  'panelReadyWithoutAnotherSearch',
]);

const COHORT_PROPOSAL_TOP_LEVEL_KEYS = new Set([
  'schemaVersion',
  'status',
  'proposalVersion',
  'observedAt',
  'approvedAt',
  'scorer',
  'source',
  'selectionPolicy',
  'signalPolicy',
  'tuningExclusion',
  'proposals',
  'excludedCandidates',
]);
const COHORT_PROPOSAL_SOURCE_KEYS = new Set([
  'target',
  'targetHostname',
  'populationObservedAt',
  'documentsObservedAt',
  'eligibleCount',
  'filter',
]);
const COHORT_PROPOSAL_SIGNAL_POLICY_KEYS = new Set(['thin', 'full', 'assignment']);
const COHORT_PROPOSAL_TUNING_KEYS = new Set([
  'repositorySweepStatus',
  'selectedReferencesFound',
  'telemetryStatus',
  'ownerAttestation',
]);
const COHORT_PROPOSAL_KEYS = new Set([
  'proposalId',
  'requestNumber',
  'title',
  'programArea',
  'researchProgramAreas',
  'signalLevel',
  'documentFileKey',
  'documentHash',
  'documentBytes',
  'extractedChars',
  'extractedWords',
  'tuningStatus',
]);
const COHORT_PROPOSAL_EXCLUSION_KEYS = new Set(['proposalId', 'requestNumber', 'reason']);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function rejectUnknown(value, allowed, pathName, add) {
  if (!isObject(value)) return;
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) add(`${pathName}.${key}`, 'unknown field');
  }
}

function validTimestamp(value) {
  return nonEmptyString(value) && !Number.isNaN(Date.parse(value));
}

function blindCaseIdFor(caseId) {
  if (!nonEmptyString(caseId)) throw new TypeError('caseId must be a non-empty string');
  const digest = crypto
    .createHash('sha256')
    .update(`reviewer-identity-v1:${caseId}`)
    .digest('hex')
    .slice(0, 10)
    .toUpperCase();
  return `RIB-${digest}`;
}

function blindProposalIdFor(proposalId, randomizationSeed) {
  if (!nonEmptyString(proposalId)) throw new TypeError('proposalId must be a non-empty string');
  if (!RANDOMIZATION_SEED_RE.test(String(randomizationSeed || ''))) {
    throw new TypeError('randomizationSeed must be 64 lowercase hexadecimal characters');
  }
  const digest = crypto
    .createHmac('sha256', randomizationSeed)
    .update(`reviewer-proposal-head-to-head-v1:${proposalId}`)
    .digest('hex')
    .slice(0, 10)
    .toUpperCase();
  return `RPE-${digest}`;
}

function orcidChecksumValid(identifier) {
  const compact = identifier.replace(/-/g, '');
  if (!/^\d{15}[\dX]$/.test(compact)) return false;
  let total = 0;
  for (const digit of compact.slice(0, 15)) total = (total + Number(digit)) * 2;
  const result = (12 - (total % 11)) % 11;
  return compact.at(-1) === (result === 10 ? 'X' : String(result));
}

function normalizeBenchmarkPersonAnchor(raw, evidence = []) {
  if (!nonEmptyString(raw)) return { ok: false, error: 'person anchor must be non-empty' };
  const value = raw.trim();
  const separator = value.indexOf(':');
  if (separator <= 0) return { ok: false, error: 'person anchor namespace is missing' };
  const namespace = value.slice(0, separator);
  const identifier = value.slice(separator + 1);

  if (namespace === 'orcid') {
    if (!ORCID_RE.test(identifier) || !orcidChecksumValid(identifier)) {
      return { ok: false, error: 'person anchor ORCID is malformed' };
    }
    return { ok: true, namespace, value };
  }
  if (namespace === 'openalex') {
    if (!OPENALEX_AUTHOR_RE.test(identifier)) {
      return { ok: false, error: 'person anchor OpenAlex author ID is malformed' };
    }
    return { ok: true, namespace, value };
  }
  if (namespace === 'institutional-profile') {
    let parsed;
    try {
      parsed = new URL(identifier);
    } catch {
      return { ok: false, error: 'institutional-profile anchor URL is malformed' };
    }
    if (
      parsed.protocol !== 'https:'
      || parsed.username
      || parsed.password
      || parsed.hash
      || !Array.isArray(evidence)
      || !evidence.some((entry) => (
        entry?.sourceType === 'institutional_profile' && entry.url === identifier
      ))
    ) {
      return {
        ok: false,
        error: 'institutional-profile anchor must exactly match authoritative HTTPS evidence',
      };
    }
    return { ok: true, namespace, value };
  }
  return { ok: false, error: `unsupported person anchor namespace '${namespace}'` };
}

function validateIdentityBenchmark(asset, { requireFrozen = false } = {}) {
  const errors = [];
  const add = (pathName, message) => errors.push({ path: pathName, message });
  if (!isObject(asset)) {
    return { ok: false, errors: [{ path: '$', message: 'benchmark must be an object' }] };
  }
  rejectUnknown(asset, IDENTITY_TOP_LEVEL_KEYS, '$', add);
  if (asset.schemaVersion !== 1) add('schemaVersion', 'must equal 1');
  if (!['draft', 'frozen'].includes(asset.status)) add('status', 'must be draft or frozen');
  if (!IDENTITY_BENCHMARK_VERSIONS.has(asset.benchmarkVersion)) {
    add('benchmarkVersion', 'must be a supported reviewer-identity version');
  }
  if (asset.labelingPolicy !== 'single_reviewer_blinded') {
    add('labelingPolicy', 'must equal single_reviewer_blinded');
  }
  if (asset.pipelineOutputsVisibleToLabelers !== false) {
    add('pipelineOutputsVisibleToLabelers', 'must equal false');
  }
  if (!Array.isArray(asset.labelers)) add('labelers', 'must be an array');
  if (asset.adjudicator !== null) add('adjudicator', 'must be null for single-reviewer labeling');
  if (!Array.isArray(asset.cases)) add('cases', 'must be an array');

  const cases = Array.isArray(asset.cases) ? asset.cases : [];
  const caseIds = new Set();
  for (let index = 0; index < cases.length; index += 1) {
    const item = cases[index];
    const base = `cases[${index}]`;
    if (!isObject(item)) {
      add(base, 'must be an object');
      continue;
    }
    rejectUnknown(item, IDENTITY_CASE_KEYS, base, add);
    if (!nonEmptyString(item.caseId)) add(`${base}.caseId`, 'must be non-empty');
    if (caseIds.has(item.caseId)) add(`${base}.caseId`, 'must be unique');
    caseIds.add(item.caseId);
    if (!['proposed', 'labeled'].includes(item.caseStatus)) {
      add(`${base}.caseStatus`, 'must be proposed or labeled');
    }
    if (!['hazard', 'clean_positive'].includes(item.stratum)) {
      add(`${base}.stratum`, 'must be hazard or clean_positive');
    }
    if (!Array.isArray(item.hazardTypes)) {
      add(`${base}.hazardTypes`, 'must be an array');
    } else {
      if (item.hazardTypes.some((type) => !HAZARD_TYPES.has(type))) {
        add(`${base}.hazardTypes`, 'contains an unknown hazard type');
      }
      if (new Set(item.hazardTypes).size !== item.hazardTypes.length) {
        add(`${base}.hazardTypes`, 'must not contain duplicates');
      }
      if (item.stratum === 'hazard' && item.hazardTypes.length === 0) {
        add(`${base}.hazardTypes`, 'hazard cases require at least one hazard type');
      }
      if (item.stratum === 'clean_positive' && item.hazardTypes.length > 0) {
        add(`${base}.hazardTypes`, 'clean-positive cases cannot carry hazard types');
      }
    }

    if (!isObject(item.frozenInput)) add(`${base}.frozenInput`, 'must be an object');
    rejectUnknown(item.frozenInput, FROZEN_INPUT_KEYS, `${base}.frozenInput`, add);
    if (!isObject(item.frozenInput?.candidate)) {
      add(`${base}.frozenInput.candidate`, 'must be an object');
    }
    if (!isObject(item.frozenInput?.upstreamResponses)) {
      add(`${base}.frozenInput.upstreamResponses`, 'must be an object');
    }

    if (item.caseStatus === 'proposed') {
      if (item.expected !== null) add(`${base}.expected`, 'must be null until labeled');
    } else {
      if (!isObject(item.expected)) add(`${base}.expected`, 'must be an object for a labeled case');
      rejectUnknown(item.expected, EXPECTED_KEYS, `${base}.expected`, add);
      if (typeof item.expected?.abstain !== 'boolean') {
        add(`${base}.expected.abstain`, 'must be a boolean');
      }
      if (typeof item.expected?.actionEligible !== 'boolean') {
        add(`${base}.expected.actionEligible`, 'must be a boolean');
      }
      if (!['not_applicable', 'must_invalidate_and_recompute'].includes(item.expected?.correctionIntegrity)) {
        add(`${base}.expected.correctionIntegrity`, 'has an unsupported value');
      }
      if (item.expected?.abstain === true && item.expected?.personAnchor !== null) {
        add(`${base}.expected.personAnchor`, 'must be null when abstention is required');
      }
      if (item.expected?.abstain === false && !nonEmptyString(item.expected?.personAnchor)) {
        add(`${base}.expected.personAnchor`, 'must be non-empty when a binding is expected');
      } else if (item.expected?.abstain === false) {
        const anchor = normalizeBenchmarkPersonAnchor(item.expected?.personAnchor, item.evidence);
        if (!anchor.ok) add(`${base}.expected.personAnchor`, anchor.error);
      }
      if (item.expected?.abstain === true && item.expected?.actionEligible === true) {
        add(`${base}.expected.actionEligible`, 'cannot be true when abstention is required');
      }
    }

    if (!Array.isArray(item.evidence) || item.evidence.length === 0) {
      add(`${base}.evidence`, 'must contain authoritative evidence');
    } else {
      item.evidence.forEach((evidence, evidenceIndex) => {
        const evidencePath = `${base}.evidence[${evidenceIndex}]`;
        if (!isObject(evidence)) {
          add(evidencePath, 'must be an object');
          return;
        }
        rejectUnknown(evidence, EVIDENCE_KEYS, evidencePath, add);
        if (!/^https:\/\//i.test(String(evidence.url || ''))) {
          add(`${evidencePath}.url`, 'must be an HTTPS URL');
        }
        if (!EVIDENCE_TYPES.has(evidence.sourceType)) {
          add(`${evidencePath}.sourceType`, 'has an unsupported value');
        }
        if (!nonEmptyString(evidence.claim)) add(`${evidencePath}.claim`, 'must be non-empty');
        if (!validTimestamp(evidence.accessedAt)) {
          add(`${evidencePath}.accessedAt`, 'must be an ISO-compatible timestamp');
        }
      });
    }
    if (item.caseStatus === 'proposed') {
      if (item.labeler !== null) add(`${base}.labeler`, 'must be null until labeled');
    } else {
      if (!nonEmptyString(item.labeler)) add(`${base}.labeler`, 'must be non-empty');
      if (
        nonEmptyString(item.labeler)
        && Array.isArray(asset.labelers)
        && !asset.labelers.includes(item.labeler)
      ) {
        add(`${base}.labeler`, 'must be registered in the top-level labelers list');
      }
    }
    if (!isObject(item.adjudication)) add(`${base}.adjudication`, 'must be an object');
    rejectUnknown(item.adjudication, ADJUDICATION_KEYS, `${base}.adjudication`, add);
    if (!['pending', 'not_applicable'].includes(item.adjudication?.status)) {
      add(`${base}.adjudication.status`, 'must be pending or not_applicable');
    }
    if (item.caseStatus === 'proposed' && item.adjudication?.status !== 'pending') {
      add(`${base}.adjudication.status`, 'must remain pending until labeled');
    }
    if (item.caseStatus === 'proposed' && item.adjudication?.adjudicator !== null) {
      add(`${base}.adjudication.adjudicator`, 'must be null');
    }
    if (item.caseStatus === 'labeled' && item.adjudication?.status !== 'not_applicable') {
      add(`${base}.adjudication.status`, 'must be not_applicable for single-reviewer labeling');
    }
    if (item.adjudication?.adjudicator !== null) {
      add(`${base}.adjudication.adjudicator`, 'must be null for single-reviewer labeling');
    }
  }

  const mustBeFrozen = requireFrozen || asset.status === 'frozen';
  if (mustBeFrozen) {
    if (asset.status !== 'frozen') add('status', 'must be frozen');
    if (!validTimestamp(asset.frozenAt)) add('frozenAt', 'must be an ISO-compatible timestamp');
    if (
      !Array.isArray(asset.labelers)
      || asset.labelers.length !== 1
      || !nonEmptyString(asset.labelers[0])
    ) {
      add('labelers', 'must contain exactly one named reviewer');
    }
    const hazards = cases.filter((item) => item?.stratum === 'hazard').length;
    const clean = cases.filter((item) => item?.stratum === 'clean_positive').length;
    if (cases.length < 40) add('cases', 'must contain at least 40 cases');
    if (hazards < 20) add('cases', 'must contain at least 20 hazard cases');
    if (clean < 20) add('cases', 'must contain at least 20 clean-positive cases');
    cases.forEach((item, index) => {
      if (item?.caseStatus !== 'labeled') {
        add(`cases[${index}].caseStatus`, 'must be labeled before freezing');
      }
      if (!item?.evidence?.some((entry) => AUTHORITATIVE_EVIDENCE_TYPES.has(entry?.sourceType))) {
        add(`cases[${index}].evidence`, 'must include authoritative ORCID, institutional, or publisher evidence');
      }
      if (item?.adjudication?.status !== 'not_applicable') {
        add(`cases[${index}].adjudication.status`, 'must be not_applicable before freezing');
      }
      if (
        Array.isArray(asset.labelers)
        && asset.labelers.length >= 1
        && item?.labeler !== asset.labelers[0]
      ) {
        add(`cases[${index}].labeler`, 'must match the benchmark reviewer');
      }
    });
  }
  return { ok: errors.length === 0, errors };
}

function validateIdentityLabelingImport(asset, benchmark) {
  const errors = [];
  const add = (pathName, message) => errors.push({ path: pathName, message });
  if (!isObject(asset)) {
    return { ok: false, errors: [{ path: '$', message: 'labeling import must be an object' }] };
  }
  rejectUnknown(asset, LABELING_IMPORT_TOP_LEVEL_KEYS, '$', add);
  if (asset.schemaVersion !== 1) add('schemaVersion', 'must equal 1');
  const expectedImportVersion = IDENTITY_IMPORT_VERSIONS.get(benchmark?.benchmarkVersion);
  if (asset.importVersion !== expectedImportVersion) {
    add('importVersion', `must equal ${expectedImportVersion || 'the benchmark import version'}`);
  }
  if (!IDENTITY_BENCHMARK_VERSIONS.has(asset.benchmarkVersion)) {
    add('benchmarkVersion', 'must be a supported reviewer-identity version');
  }
  if (benchmark?.benchmarkVersion && asset.benchmarkVersion !== benchmark.benchmarkVersion) {
    add('benchmarkVersion', 'must match the referenced benchmark');
  }
  if (asset.labelingPolicy !== 'single_reviewer_blinded') {
    add('labelingPolicy', 'must equal single_reviewer_blinded');
  }
  if (!isObject(asset.sourceWorkbook)) add('sourceWorkbook', 'must be an object');
  rejectUnknown(asset.sourceWorkbook, LABELING_IMPORT_SOURCE_KEYS, 'sourceWorkbook', add);
  if (!nonEmptyString(asset.sourceWorkbook?.fileName)) {
    add('sourceWorkbook.fileName', 'must be non-empty');
  }
  if (!SHA256_RE.test(String(asset.sourceWorkbook?.sha256 || ''))) {
    add('sourceWorkbook.sha256', 'must be a SHA-256 hash');
  }
  if (!nonEmptyString(asset.sourceWorkbook?.reviewer)) {
    add('sourceWorkbook.reviewer', 'must be non-empty');
  }
  if (!validTimestamp(asset.sourceWorkbook?.importedAt)) {
    add('sourceWorkbook.importedAt', 'must be an ISO-compatible timestamp');
  }
  if (
    !Array.isArray(asset.normalizationRules)
    || asset.normalizationRules.length === 0
    || asset.normalizationRules.some((rule) => !nonEmptyString(rule))
  ) {
    add('normalizationRules', 'must contain non-empty rules');
  }
  if (!Array.isArray(asset.ownerClarifications)) {
    add('ownerClarifications', 'must be an array');
  } else {
    const clarificationIds = new Set();
    asset.ownerClarifications.forEach((clarification, index) => {
      const base = `ownerClarifications[${index}]`;
      if (!isObject(clarification)) {
        add(base, 'must be an object');
        return;
      }
      rejectUnknown(clarification, LABELING_IMPORT_CLARIFICATION_KEYS, base, add);
      if (!nonEmptyString(clarification.blindCaseId)) add(`${base}.blindCaseId`, 'must be non-empty');
      if (clarificationIds.has(clarification.blindCaseId)) {
        add(`${base}.blindCaseId`, 'must be unique');
      }
      clarificationIds.add(clarification.blindCaseId);
      if (!nonEmptyString(clarification.resolution)) add(`${base}.resolution`, 'must be non-empty');
    });
  }

  const benchmarkCases = Array.isArray(benchmark?.cases) ? benchmark.cases : [];
  const benchmarkById = new Map(benchmarkCases.map((item) => [item.caseId, item]));
  if (!Array.isArray(asset.rows)) {
    add('rows', 'must be an array');
  } else {
    if (asset.rows.length !== 40) add('rows', 'must contain exactly 40 rows');
    if (asset.rows.length !== benchmarkCases.length) {
      add('rows', 'must contain exactly one row for every benchmark case');
    }
    const blindIds = new Set();
    const caseIds = new Set();
    asset.rows.forEach((row, index) => {
      const base = `rows[${index}]`;
      if (!isObject(row)) {
        add(base, 'must be an object');
        return;
      }
      rejectUnknown(row, LABELING_IMPORT_ROW_KEYS, base, add);
      if (!nonEmptyString(row.blindCaseId)) add(`${base}.blindCaseId`, 'must be non-empty');
      if (blindIds.has(row.blindCaseId)) add(`${base}.blindCaseId`, 'must be unique');
      blindIds.add(row.blindCaseId);
      if (!nonEmptyString(row.caseId)) add(`${base}.caseId`, 'must be non-empty');
      if (caseIds.has(row.caseId)) add(`${base}.caseId`, 'must be unique');
      caseIds.add(row.caseId);
      const benchmarkCase = benchmarkById.get(row.caseId);
      if (!benchmarkCase) add(`${base}.caseId`, 'must exist in the benchmark');
      if (benchmarkCase && row.blindCaseId !== blindCaseIdFor(row.caseId)) {
        add(`${base}.blindCaseId`, 'must match the deterministic case mapping');
      }
      if (!isObject(row.raw)) add(`${base}.raw`, 'must be an object');
      rejectUnknown(row.raw, LABELING_IMPORT_RAW_KEYS, `${base}.raw`, add);
      for (const field of LABELING_IMPORT_RAW_KEYS) {
        if (!(field in (row.raw || {}))) add(`${base}.raw.${field}`, 'is required');
        if (field in (row.raw || {}) && !(row.raw[field] === null || typeof row.raw[field] === 'string')) {
          add(`${base}.raw.${field}`, 'must be a string or null');
        }
      }
      if (!isObject(row.normalized)) add(`${base}.normalized`, 'must be an object');
      rejectUnknown(row.normalized, EXPECTED_KEYS, `${base}.normalized`, add);
      if (!Array.isArray(row.normalizationNotes) || row.normalizationNotes.some((note) => !nonEmptyString(note))) {
        add(`${base}.normalizationNotes`, 'must be an array of non-empty strings');
      }
      if (benchmarkCase?.expected) {
        for (const field of EXPECTED_KEYS) {
          if (row.normalized?.[field] !== benchmarkCase.expected[field]) {
            add(`${base}.normalized.${field}`, 'must match the frozen benchmark label');
          }
        }
      }
    });
    benchmarkCases.forEach((benchmarkCase) => {
      if (!caseIds.has(benchmarkCase.caseId)) {
        add('rows', `missing benchmark case '${benchmarkCase.caseId}'`);
      }
    });
  }

  if (benchmark?.status !== 'frozen') add('benchmark', 'must reference a frozen benchmark');
  if (
    Array.isArray(benchmark?.labelers)
    && benchmark.labelers.length === 1
    && asset.sourceWorkbook?.reviewer !== benchmark.labelers[0]
  ) {
    add('sourceWorkbook.reviewer', 'must match the benchmark reviewer');
  }
  if (benchmark?.frozenAt && asset.sourceWorkbook?.importedAt !== benchmark.frozenAt) {
    add('sourceWorkbook.importedAt', 'must equal the benchmark frozenAt timestamp');
  }
  return { ok: errors.length === 0, errors };
}

function validateProposalCohortProposal(asset) {
  const errors = [];
  const add = (pathName, message) => errors.push({ path: pathName, message });
  if (!isObject(asset)) {
    return { ok: false, errors: [{ path: '$', message: 'proposal cohort proposal must be an object' }] };
  }
  rejectUnknown(asset, COHORT_PROPOSAL_TOP_LEVEL_KEYS, '$', add);
  if (asset.schemaVersion !== 1) add('schemaVersion', 'must equal 1');
  if (!['proposed_pending_owner_attestation', 'owner_approved'].includes(asset.status)) {
    add('status', 'must equal proposed_pending_owner_attestation or owner_approved');
  }
  if (asset.proposalVersion !== 'reviewer-proposal-cohort-proposal-v1') {
    add('proposalVersion', 'must equal reviewer-proposal-cohort-proposal-v1');
  }
  if (!validTimestamp(asset.observedAt)) add('observedAt', 'must be an ISO-compatible timestamp');
  if (asset.status === 'owner_approved') {
    if (!validTimestamp(asset.approvedAt)) add('approvedAt', 'must be an ISO-compatible timestamp');
    if (!nonEmptyString(asset.scorer)) add('scorer', 'must name the blinded scorer');
  } else {
    if (asset.approvedAt !== null) add('approvedAt', 'must be null before owner approval');
    if (asset.scorer !== null) add('scorer', 'must be null before owner approval');
  }
  if (asset.selectionPolicy !== 'held_out_stratified_thin_and_full_signal') {
    add('selectionPolicy', 'must equal held_out_stratified_thin_and_full_signal');
  }

  if (!isObject(asset.source)) {
    add('source', 'must be an object');
  } else {
    rejectUnknown(asset.source, COHORT_PROPOSAL_SOURCE_KEYS, 'source', add);
    if (asset.source.target !== 'production') add('source.target', 'must equal production');
    if (!nonEmptyString(asset.source.targetHostname)) add('source.targetHostname', 'must be non-empty');
    for (const field of ['populationObservedAt', 'documentsObservedAt']) {
      if (!validTimestamp(asset.source[field])) add(`source.${field}`, 'must be an ISO-compatible timestamp');
    }
    if (asset.source.eligibleCount !== 11) add('source.eligibleCount', 'must equal 11');
    if (!nonEmptyString(asset.source.filter)) add('source.filter', 'must be non-empty');
  }

  if (!isObject(asset.signalPolicy)) {
    add('signalPolicy', 'must be an object');
  } else {
    rejectUnknown(asset.signalPolicy, COHORT_PROPOSAL_SIGNAL_POLICY_KEYS, 'signalPolicy', add);
    for (const field of COHORT_PROPOSAL_SIGNAL_POLICY_KEYS) {
      if (!nonEmptyString(asset.signalPolicy[field])) add(`signalPolicy.${field}`, 'must be non-empty');
    }
  }

  if (!isObject(asset.tuningExclusion)) {
    add('tuningExclusion', 'must be an object');
  } else {
    rejectUnknown(asset.tuningExclusion, COHORT_PROPOSAL_TUNING_KEYS, 'tuningExclusion', add);
    if (asset.tuningExclusion.repositorySweepStatus !== 'passed_for_selected_request_numbers') {
      add('tuningExclusion.repositorySweepStatus', 'must equal passed_for_selected_request_numbers');
    }
    if (asset.tuningExclusion.selectedReferencesFound !== 0) {
      add('tuningExclusion.selectedReferencesFound', 'must equal 0');
    }
    if (asset.tuningExclusion.telemetryStatus !== 'insufficient_for_request_level_proof') {
      add('tuningExclusion.telemetryStatus', 'must equal insufficient_for_request_level_proof');
    }
    const expectedAttestation = asset.status === 'owner_approved'
      ? 'approved_best_of_owner_knowledge'
      : 'pending';
    if (asset.tuningExclusion.ownerAttestation !== expectedAttestation) {
      add('tuningExclusion.ownerAttestation', `must equal ${expectedAttestation}`);
    }
  }

  if (!Array.isArray(asset.proposals)) add('proposals', 'must be an array');
  const proposals = Array.isArray(asset.proposals) ? asset.proposals : [];
  if (proposals.length !== 10) add('proposals', 'must contain exactly 10 proposals');
  const proposalIds = new Set();
  const requestNumbers = new Set();
  proposals.forEach((item, index) => {
    const base = `proposals[${index}]`;
    if (!isObject(item)) {
      add(base, 'must be an object');
      return;
    }
    rejectUnknown(item, COHORT_PROPOSAL_KEYS, base, add);
    for (const [field, seen] of [['proposalId', proposalIds], ['requestNumber', requestNumbers]]) {
      if (!nonEmptyString(item[field])) add(`${base}.${field}`, 'must be non-empty');
      if (seen.has(item[field])) add(`${base}.${field}`, 'must be unique');
      seen.add(item[field]);
    }
    for (const field of ['title', 'programArea', 'documentFileKey']) {
      if (!nonEmptyString(item[field])) add(`${base}.${field}`, 'must be non-empty');
    }
    if (!Array.isArray(item.researchProgramAreas) || item.researchProgramAreas.length === 0
      || item.researchProgramAreas.some((value) => !nonEmptyString(value))) {
      add(`${base}.researchProgramAreas`, 'must contain non-empty labels');
    }
    if (!['thin', 'full'].includes(item.signalLevel)) add(`${base}.signalLevel`, 'must be thin or full');
    if (!SHA256_RE.test(String(item.documentHash || ''))) {
      add(`${base}.documentHash`, 'must be a SHA-256 hash');
    }
    for (const field of ['documentBytes', 'extractedChars', 'extractedWords']) {
      if (!Number.isInteger(item[field]) || item[field] <= 0) add(`${base}.${field}`, 'must be a positive integer');
    }
    const expectedTuningStatus = asset.status === 'owner_approved'
      ? 'owner_attested_not_used_for_tuning'
      : 'owner_attestation_pending';
    if (item.tuningStatus !== expectedTuningStatus) {
      add(`${base}.tuningStatus`, `must equal ${expectedTuningStatus}`);
    }
  });
  if (proposals.filter((item) => item?.signalLevel === 'thin').length !== 5) {
    add('proposals', 'must contain exactly five thin-signal proposals');
  }
  if (proposals.filter((item) => item?.signalLevel === 'full').length !== 5) {
    add('proposals', 'must contain exactly five full-signal proposals');
  }
  if (new Set(proposals.map((item) => item?.programArea).filter(nonEmptyString)).size < 2) {
    add('proposals', 'must span at least two program areas');
  }

  if (!Array.isArray(asset.excludedCandidates) || asset.excludedCandidates.length !== 1) {
    add('excludedCandidates', 'must contain exactly one excluded candidate');
  } else {
    const item = asset.excludedCandidates[0];
    if (!isObject(item)) {
      add('excludedCandidates[0]', 'must be an object');
    } else {
      rejectUnknown(item, COHORT_PROPOSAL_EXCLUSION_KEYS, 'excludedCandidates[0]', add);
      for (const field of COHORT_PROPOSAL_EXCLUSION_KEYS) {
        if (!nonEmptyString(item[field])) add(`excludedCandidates[0].${field}`, 'must be non-empty');
      }
      if (proposalIds.has(item.proposalId) || requestNumbers.has(item.requestNumber)) {
        add('excludedCandidates[0]', 'must not duplicate a selected proposal');
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

function validateProposalCohortFreeze(cohortProposal, evaluation) {
  const errors = [];
  const add = (pathName, message) => errors.push({ path: pathName, message });
  if (cohortProposal?.status !== 'owner_approved') {
    add('cohortProposal.status', 'must equal owner_approved before freezing');
  }
  if (evaluation?.status !== 'frozen') add('evaluation.status', 'must equal frozen');
  if (evaluation?.scorer !== cohortProposal?.scorer) {
    add('evaluation.scorer', 'must match the approved cohort scorer');
  }
  if (evaluation?.frozenAt !== cohortProposal?.approvedAt) {
    add('evaluation.frozenAt', 'must match the cohort approval timestamp');
  }

  const approved = Array.isArray(cohortProposal?.proposals) ? cohortProposal.proposals : [];
  const frozen = Array.isArray(evaluation?.proposals) ? evaluation.proposals : [];
  const approvedById = new Map(approved.map((item) => [item.proposalId, item]));
  if (frozen.length !== approved.length) {
    add('evaluation.proposals', 'must contain exactly the approved cohort');
  }
  frozen.forEach((item, index) => {
    const approvedItem = approvedById.get(item?.proposalId);
    if (!approvedItem) {
      add(`evaluation.proposals[${index}].proposalId`, 'must exist in the approved cohort');
      return;
    }
    for (const [evaluationField, cohortField] of [
      ['programArea', 'programArea'],
      ['signalLevel', 'signalLevel'],
      ['documentHash', 'documentHash'],
    ]) {
      if (item[evaluationField] !== approvedItem[cohortField]) {
        add(`evaluation.proposals[${index}].${evaluationField}`, 'must match the approved cohort');
      }
    }
    if (item.usedForTuning !== false
      || approvedItem.tuningStatus !== 'owner_attested_not_used_for_tuning') {
      add(`evaluation.proposals[${index}].usedForTuning`, 'requires approved non-tuning attestation');
    }
  });
  for (const approvedItem of approved) {
    if (!frozen.some((item) => item?.proposalId === approvedItem.proposalId)) {
      add('evaluation.proposals', `missing approved proposal '${approvedItem.proposalId}'`);
    }
  }
  return { ok: errors.length === 0, errors };
}

function validateProposalManifestConsistency(manifest, evaluation) {
  const errors = [];
  const add = (pathName, message) => errors.push({ path: pathName, message });
  const manifestIds = Array.isArray(manifest?.proposalEvaluation?.proposalIds)
    ? manifest.proposalEvaluation.proposalIds
    : [];
  const manifestHashes = isObject(manifest?.proposalEvaluation?.documentHashes)
    ? manifest.proposalEvaluation.documentHashes
    : {};
  const proposals = Array.isArray(evaluation?.proposals) ? evaluation.proposals : [];
  const evaluationIds = new Set(proposals.map((item) => item?.proposalId));
  if (manifestIds.length !== proposals.length || new Set(manifestIds).size !== proposals.length) {
    add('manifest.proposalEvaluation.proposalIds', 'must contain exactly the frozen proposal IDs');
  }
  for (const item of proposals) {
    if (!manifestIds.includes(item.proposalId)) {
      add('manifest.proposalEvaluation.proposalIds', `missing frozen proposal '${item.proposalId}'`);
    }
    if (manifestHashes[item.proposalId] !== item.documentHash) {
      add(`manifest.proposalEvaluation.documentHashes.${item.proposalId}`, 'must match the frozen document hash');
    }
  }
  for (const proposalId of manifestIds) {
    if (!evaluationIds.has(proposalId)) {
      add('manifest.proposalEvaluation.proposalIds', `contains non-frozen proposal '${proposalId}'`);
    }
  }
  for (const proposalId of Object.keys(manifestHashes)) {
    if (!evaluationIds.has(proposalId)) {
      add(`manifest.proposalEvaluation.documentHashes.${proposalId}`, 'has no frozen proposal');
    }
  }
  return { ok: errors.length === 0, errors };
}

function validateProposalEvaluation(asset, { requireFrozen = false, requireScored = false } = {}) {
  const errors = [];
  const add = (pathName, message) => errors.push({ path: pathName, message });
  if (!isObject(asset)) {
    return { ok: false, errors: [{ path: '$', message: 'proposal evaluation must be an object' }] };
  }
  rejectUnknown(asset, PROPOSAL_TOP_LEVEL_KEYS, '$', add);
  if (asset.schemaVersion !== 1) add('schemaVersion', 'must equal 1');
  if (!['draft', 'frozen', 'scored'].includes(asset.status)) {
    add('status', 'must be draft, frozen, or scored');
  }
  if (asset.evaluationVersion !== 'reviewer-proposal-head-to-head-v1') {
    add('evaluationVersion', 'must equal reviewer-proposal-head-to-head-v1');
  }
  if (asset.selectionPolicy !== 'held_out_stratified_thin_and_full_signal') {
    add('selectionPolicy', 'must equal held_out_stratified_thin_and_full_signal');
  }
  if (asset.replicatesPerArm !== 3) add('replicatesPerArm', 'must equal 3');
  if (!Array.isArray(asset.proposals)) add('proposals', 'must be an array');

  const proposals = Array.isArray(asset.proposals) ? asset.proposals : [];
  const proposalIds = new Set();
  const blindProposalIds = new Set();
  for (let index = 0; index < proposals.length; index += 1) {
    const item = proposals[index];
    const base = `proposals[${index}]`;
    if (!isObject(item)) {
      add(base, 'must be an object');
      continue;
    }
    rejectUnknown(item, PROPOSAL_KEYS, base, add);
    for (const [field, set] of [['proposalId', proposalIds], ['blindProposalId', blindProposalIds]]) {
      if (!nonEmptyString(item[field])) add(`${base}.${field}`, 'must be non-empty');
      if (set.has(item[field])) add(`${base}.${field}`, 'must be unique');
      set.add(item[field]);
    }
    if (nonEmptyString(item.blindProposalId) && !BLIND_PROPOSAL_ID_RE.test(item.blindProposalId)) {
      add(`${base}.blindProposalId`, 'must be an opaque RPE blind ID');
    }
    if (!nonEmptyString(item.programArea)) add(`${base}.programArea`, 'must be non-empty');
    if (!['thin', 'full'].includes(item.signalLevel)) {
      add(`${base}.signalLevel`, 'must be thin or full');
    }
    if (!SHA256_RE.test(String(item.documentHash || ''))) {
      add(`${base}.documentHash`, 'must be a SHA-256 hash');
    }
    if (item.usedForTuning !== false) add(`${base}.usedForTuning`, 'must equal false');
    if (!isObject(item.runs)) add(`${base}.runs`, 'must be an object');
    rejectUnknown(item.runs, RUN_KEYS, `${base}.runs`, add);
    for (const arm of RUN_KEYS) {
      if (!Array.isArray(item.runs?.[arm])) add(`${base}.runs.${arm}`, 'must be an array');
    }
    if (!Array.isArray(item.candidateArmMembership)) {
      add(`${base}.candidateArmMembership`, 'must be an array');
    } else {
      const membershipIds = new Set();
      item.candidateArmMembership.forEach((membership, membershipIndex) => {
        const membershipPath = `${base}.candidateArmMembership[${membershipIndex}]`;
        if (!isObject(membership)) {
          add(membershipPath, 'must be an object');
          return;
        }
        rejectUnknown(membership, ARM_MEMBERSHIP_KEYS, membershipPath, add);
        if (!nonEmptyString(membership.blindCandidateId)) {
          add(`${membershipPath}.blindCandidateId`, 'must be non-empty');
        }
        if (membershipIds.has(membership.blindCandidateId)) {
          add(`${membershipPath}.blindCandidateId`, 'must be unique within the proposal');
        }
        membershipIds.add(membership.blindCandidateId);
        if (
          !Array.isArray(membership.arms)
          || membership.arms.length === 0
          || membership.arms.some((arm) => !RUN_KEYS.has(arm))
        ) {
          add(`${membershipPath}.arms`, 'must contain baseline and/or redesign');
        } else if (new Set(membership.arms).size !== membership.arms.length) {
          add(`${membershipPath}.arms`, 'must not contain duplicates');
        }
      });
    }
    if (!Array.isArray(item.candidateScores)) {
      add(`${base}.candidateScores`, 'must be an array');
    } else {
      const blindCandidateIds = new Set();
      item.candidateScores.forEach((score, scoreIndex) => {
        const scorePath = `${base}.candidateScores[${scoreIndex}]`;
        if (!isObject(score)) {
          add(scorePath, 'must be an object');
          return;
        }
        rejectUnknown(score, SCORE_KEYS, scorePath, add);
        if (!nonEmptyString(score.blindCandidateId)) {
          add(`${scorePath}.blindCandidateId`, 'must be non-empty');
        }
        if (blindCandidateIds.has(score.blindCandidateId)) {
          add(`${scorePath}.blindCandidateId`, 'must be unique within the proposal');
        }
        blindCandidateIds.add(score.blindCandidateId);
        for (const field of [
          'correctPerson',
          'onTopic',
          'independentEligible',
          'shortlist',
          'panelReadyWithoutAnotherSearch',
        ]) {
          if (typeof score[field] !== 'boolean') add(`${scorePath}.${field}`, 'must be a boolean');
        }
        if (!(score.disqualifierReason === null || nonEmptyString(score.disqualifierReason))) {
          add(`${scorePath}.disqualifierReason`, 'must be null or a non-empty string');
        }
        if (!nonEmptyString(score.coverageContribution)) {
          add(`${scorePath}.coverageContribution`, 'must be non-empty');
        }
      });
    }
  }

  const mustBeFrozen = requireFrozen || requireScored || ['frozen', 'scored'].includes(asset.status);
  if (mustBeFrozen) {
    if (!['frozen', 'scored'].includes(asset.status)) add('status', 'must be frozen or scored');
    if (!validTimestamp(asset.frozenAt)) add('frozenAt', 'must be an ISO-compatible timestamp');
    if (!nonEmptyString(asset.scorer)) add('scorer', 'must name the PD scorer');
    if (!SHA256_RE.test(String(asset.randomizationSeedHash || ''))) {
      add('randomizationSeedHash', 'must be a SHA-256 hash');
    }
    if (proposals.length !== 10) add('proposals', 'must contain exactly 10 proposals');
    if (!proposals.some((item) => item?.signalLevel === 'thin')) {
      add('proposals', 'must include thin-signal proposals');
    }
    if (!proposals.some((item) => item?.signalLevel === 'full')) {
      add('proposals', 'must include full-signal proposals');
    }
    const programAreas = new Set(proposals.map((item) => item?.programArea).filter(nonEmptyString));
    if (programAreas.size < 2) add('proposals', 'must span at least two program areas');
  }

  const mustBeScored = requireScored || asset.status === 'scored';
  if (asset.status === 'frozen' && !mustBeScored) {
    proposals.forEach((item, index) => {
      for (const arm of RUN_KEYS) {
        if (Array.isArray(item?.runs?.[arm]) && item.runs[arm].length > 0) {
          add(`proposals[${index}].runs.${arm}`, 'must remain empty before execution');
        }
      }
      if (Array.isArray(item?.candidateArmMembership) && item.candidateArmMembership.length > 0) {
        add(`proposals[${index}].candidateArmMembership`, 'must remain empty before execution');
      }
      if (Array.isArray(item?.candidateScores) && item.candidateScores.length > 0) {
        add(`proposals[${index}].candidateScores`, 'must remain empty before scoring');
      }
    });
  }
  if (mustBeScored) {
    if (asset.status !== 'scored') add('status', 'must be scored');
    proposals.forEach((item, index) => {
      for (const arm of RUN_KEYS) {
        const runIds = Array.isArray(item?.runs?.[arm]) ? item.runs[arm] : [];
        if (runIds.length !== 3 || runIds.some((id) => !nonEmptyString(id))) {
          add(`proposals[${index}].runs.${arm}`, 'must contain exactly three non-empty run IDs');
        }
        if (new Set(runIds).size !== runIds.length) {
          add(`proposals[${index}].runs.${arm}`, 'must contain unique run IDs');
        }
      }
      if (!Array.isArray(item?.candidateScores) || item.candidateScores.length === 0) {
        add(`proposals[${index}].candidateScores`, 'must contain blinded PD scores');
      }
      const membershipIds = new Set(
        Array.isArray(item?.candidateArmMembership)
          ? item.candidateArmMembership.map((membership) => membership?.blindCandidateId)
          : [],
      );
      const scoreIds = new Set(
        Array.isArray(item?.candidateScores)
          ? item.candidateScores.map((score) => score?.blindCandidateId)
          : [],
      );
      if (membershipIds.size === 0) {
        add(`proposals[${index}].candidateArmMembership`, 'must map every blinded candidate to an arm');
      }
      if (
        membershipIds.size !== scoreIds.size
        || [...membershipIds].some((blindId) => !scoreIds.has(blindId))
      ) {
        add(
          `proposals[${index}].candidateScores`,
          'must score exactly the blinded candidates in candidateArmMembership',
        );
      }
    });
  }
  return { ok: errors.length === 0, errors };
}

function tokenizeSources(value) {
  if (!value) return [];
  return [...new Set(String(value).split(',').map((token) => token.trim()).filter(Boolean))];
}

function countMetric(rows, predicate, denominator = rows.length) {
  const count = rows.filter(predicate).length;
  return {
    count,
    denominator,
    rate: denominator === 0 ? null : count / denominator,
  };
}

function lifecycleMetrics(rows, totalRows) {
  const denominator = rows.length;
  return {
    sourcedRows: countMetric(rows, () => true, totalRows),
    currentlySelected: countMetric(rows, (row) => row.wmkf_selected === true, denominator),
    invited: countMetric(rows, (row) => row.wmkf_invited === true, denominator),
    accepted: countMetric(rows, (row) => row.wmkf_accepted === true, denominator),
    declined: countMetric(rows, (row) => row.wmkf_declined === true, denominator),
    declineWithReferral: countMetric(
      rows,
      (row) => row.wmkf_declined === true && nonEmptyString(row.wmkf_declinereferral),
      denominator,
    ),
    materialsSent: countMetric(rows, (row) => Boolean(row.wmkf_materialssentat), denominator),
    reviewReceived: countMetric(rows, (row) => Boolean(row.wmkf_reviewreceivedat), denominator),
  };
}

function metricsByToken(rows, totalRows) {
  const tokens = [...new Set(rows.flatMap((row) => row.__sourceTokens))].sort();
  return Object.fromEntries(tokens.map((token) => [
    token,
    lifecycleMetrics(rows.filter((row) => row.__sourceTokens.includes(token)), totalRows),
  ]));
}

function aggregateChannelBaseline(inputRows) {
  const totalRows = inputRows.length;
  const rows = inputRows.map((row) => ({ ...row, __sourceTokens: tokenizeSources(row.wmkf_sources) }));
  const missing = rows.filter((row) => row.__sourceTokens.length === 0);
  const exclusive = rows.filter((row) => row.__sourceTokens.length === 1);
  const multiTouch = rows.filter((row) => row.__sourceTokens.length > 1);
  return {
    schemaVersion: 1,
    probeVersion: 'reviewer-channel-baseline-v1',
    unit: 'suggestion_engagement_rows',
    interpretation: {
      selected: 'current mutable snapshot, not historical shortlist',
      materialsSent: 'participation proxy, not final panel seating',
      reviewReceived: 'wmkf_reviewreceivedat is the submission signal',
      attribution: 'token counts overlap; never sum token-attribution counts as unique people',
    },
    population: {
      totalRows,
      rowsWithSources: rows.length - missing.length,
      rowsWithoutSources: missing.length,
      exclusiveTokenRows: exclusive.length,
      multiTouchRows: multiTouch.length,
    },
    attributedByToken: metricsByToken(rows.filter((row) => row.__sourceTokens.length > 0), totalRows),
    exclusiveByToken: metricsByToken(exclusive, totalRows),
    multiTouchByToken: metricsByToken(multiTouch, totalRows),
    cohortMetrics: {
      missingSource: lifecycleMetrics(missing, totalRows),
      exclusiveToken: lifecycleMetrics(exclusive, totalRows),
      multiTouch: lifecycleMetrics(multiTouch, totalRows),
    },
  };
}

module.exports = {
  AUTHORITATIVE_EVIDENCE_TYPES,
  EVIDENCE_TYPES,
  HAZARD_TYPES,
  aggregateChannelBaseline,
  blindCaseIdFor,
  blindProposalIdFor,
  normalizeBenchmarkPersonAnchor,
  tokenizeSources,
  validateIdentityBenchmark,
  validateIdentityLabelingImport,
  validateProposalCohortFreeze,
  validateProposalCohortProposal,
  validateProposalEvaluation,
  validateProposalManifestConsistency,
};
