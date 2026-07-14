const SHA256_RE = /^[0-9a-f]{64}$/i;

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

function validateIdentityBenchmark(asset, { requireFrozen = false } = {}) {
  const errors = [];
  const add = (pathName, message) => errors.push({ path: pathName, message });
  if (!isObject(asset)) {
    return { ok: false, errors: [{ path: '$', message: 'benchmark must be an object' }] };
  }
  rejectUnknown(asset, IDENTITY_TOP_LEVEL_KEYS, '$', add);
  if (asset.schemaVersion !== 1) add('schemaVersion', 'must equal 1');
  if (!['draft', 'frozen'].includes(asset.status)) add('status', 'must be draft or frozen');
  if (asset.benchmarkVersion !== 'reviewer-identity-v1') {
    add('benchmarkVersion', 'must equal reviewer-identity-v1');
  }
  if (asset.labelingPolicy !== 'independent_blinded_adjudicated') {
    add('labelingPolicy', 'must equal independent_blinded_adjudicated');
  }
  if (asset.pipelineOutputsVisibleToLabelers !== false) {
    add('pipelineOutputsVisibleToLabelers', 'must equal false');
  }
  if (!Array.isArray(asset.labelers)) add('labelers', 'must be an array');
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
      if (item.expected !== null) add(`${base}.expected`, 'must be null until independently labeled');
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
      if (item.labeler !== null) add(`${base}.labeler`, 'must be null until independently labeled');
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
    if (!['pending', 'agreed', 'adjudicated'].includes(item.adjudication?.status)) {
      add(`${base}.adjudication.status`, 'must be pending, agreed, or adjudicated');
    }
    if (item.caseStatus === 'proposed' && item.adjudication?.status !== 'pending') {
      add(`${base}.adjudication.status`, 'must remain pending until independently labeled');
    }
    if (item.caseStatus === 'proposed' && item.adjudication?.adjudicator !== null) {
      add(`${base}.adjudication.adjudicator`, 'must be null until adjudication');
    }
    if (item.adjudication?.status === 'adjudicated' && !nonEmptyString(item.adjudication?.adjudicator)) {
      add(`${base}.adjudication.adjudicator`, 'must name the adjudicator');
    }
  }

  const mustBeFrozen = requireFrozen || asset.status === 'frozen';
  if (mustBeFrozen) {
    if (asset.status !== 'frozen') add('status', 'must be frozen');
    if (!validTimestamp(asset.frozenAt)) add('frozenAt', 'must be an ISO-compatible timestamp');
    if (!Array.isArray(asset.labelers) || asset.labelers.length === 0 || asset.labelers.some((x) => !nonEmptyString(x))) {
      add('labelers', 'must contain named labelers');
    }
    if (!nonEmptyString(asset.adjudicator)) add('adjudicator', 'must be non-empty');
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
      if (!['agreed', 'adjudicated'].includes(item?.adjudication?.status)) {
        add(`cases[${index}].adjudication.status`, 'must be resolved before freezing');
      }
      if (
        item?.adjudication?.status === 'adjudicated'
        && item.adjudication.adjudicator !== asset.adjudicator
      ) {
        add(`cases[${index}].adjudication.adjudicator`, 'must match the benchmark adjudicator');
      }
    });
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
  tokenizeSources,
  validateIdentityBenchmark,
  validateProposalEvaluation,
};
