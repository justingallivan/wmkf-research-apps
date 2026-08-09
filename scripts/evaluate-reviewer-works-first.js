#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  changedCases,
  combineIdentityDecisions,
  createAnchorMatcher,
  evaluatePromotion,
  normalizeOrcid,
  resolveWorksFirst,
  scoreDecision,
  shortOpenAlexAuthorId,
  shortOpenAlexInstitutionId,
} = require('../lib/services/reviewer-works-first');
const {
  createInstitutionIdentityResolver,
} = require('../lib/services/institution-identity-resolver');
const {
  createRorInstitutionIdentityResolver,
} = require('../lib/services/ror-institution-identity-resolver');
const {
  ReviewerIdentityEvidence,
} = require('../lib/services/reviewer-identity-evidence');
const { OpenAlexService } = require('../lib/services/openalex-service');

const INSTITUTION_RESOLVER_ARMS = ['incumbent', 'ror'];

const REPO_ROOT = path.resolve(__dirname, '..');
const OPENALEX_API = 'https://api.openalex.org';
const DEFAULT_BENCHMARK = path.join(
  REPO_ROOT,
  'docs/audits/reviewer-holistic-identity-benchmark-v2.json',
);
const DEFAULT_OUTPUT = path.join(
  REPO_ROOT,
  'outputs/reviewer-holistic-m1/reviewer-identity-works-first-w2-v1.json',
);
const DEFAULT_EQUIVALENCE_OVERLAY = path.join(
  REPO_ROOT,
  'docs/audits/reviewer-identity-w2-person-equivalence-v1.json',
);
const FROZEN_BENCHMARK_SHA256 = 'f815fe270ff1b36db3f76ab5f90803476fccd890e42ab7ffcd0801762cf8e375';
const FROZEN_EQUIVALENCE_OVERLAY_SHA256 = '53016ca14dc09ba2ff6391760667e6345ef1d4565ec3e436a773b4918d9a2aa0';

function loadEnvLocal() {
  const envPath = path.join(REPO_ROOT, '.env.local');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const [key, ...parts] = trimmed.split('=');
    if (!key || parts.length === 0 || key in process.env) continue;
    let value = parts.join('=').trim();
    if ((value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function parseCli(argv) {
  const options = {
    benchmarkPath: DEFAULT_BENCHMARK,
    outputPath: DEFAULT_OUTPUT,
    caseIds: [],
    institutionResolverArm: 'incumbent',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--benchmark') {
      options.benchmarkPath = path.resolve(argv[++index] || '');
    } else if (argument === '--output') {
      options.outputPath = path.resolve(argv[++index] || '');
    } else if (argument === '--case') {
      options.caseIds.push(argv[++index] || '');
    } else if (argument === '--institution-resolver') {
      options.institutionResolverArm = argv[++index] || '';
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (!options.benchmarkPath || !options.outputPath || options.caseIds.includes('')) {
    throw new Error('--benchmark, --output, and --case require non-empty values');
  }
  if (!INSTITUTION_RESOLVER_ARMS.includes(options.institutionResolverArm)) {
    throw new Error(
      `--institution-resolver must be one of: ${INSTITUTION_RESOLVER_ARMS.join(', ')}`,
    );
  }
  return options;
}

function readPinnedJson(filePath, expectedSha256, label) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const actualSha256 = crypto.createHash('sha256').update(raw).digest('hex');
  if (actualSha256 !== expectedSha256) {
    throw new Error(`${label} hash drifted; create a new version instead of mutating the frozen asset`);
  }
  return JSON.parse(raw);
}

function readFrozenBenchmark(filePath) {
  const benchmark = readPinnedJson(
    filePath,
    FROZEN_BENCHMARK_SHA256,
    'W2 identity benchmark',
  );
  if (benchmark?.status !== 'frozen'
    || benchmark?.benchmarkVersion !== 'reviewer-identity-v2'
    || !Array.isArray(benchmark.cases)
    || benchmark.cases.length !== 40) {
    throw new Error('W2 evaluation requires the frozen 40-case reviewer-identity-v2 benchmark');
  }
  return benchmark;
}

function readEquivalenceOverlay(filePath, benchmark) {
  const overlay = readPinnedJson(
    filePath,
    FROZEN_EQUIVALENCE_OVERLAY_SHA256,
    'W2 person-equivalence overlay',
  );
  if (overlay?.schemaVersion !== 1
    || overlay?.status !== 'frozen'
    || overlay?.benchmarkVersion !== benchmark?.benchmarkVersion
    || !Array.isArray(overlay.equivalences)
    || !Array.isArray(overlay.rightPersonPolicyReviews)) {
    throw new Error('W2 person-equivalence overlay is malformed or targets another benchmark');
  }
  const benchmarkCaseIds = new Set(benchmark.cases.map((item) => item.caseId));
  for (const item of overlay.equivalences) {
    if (!Array.isArray(item?.anchors)
      || item.anchors.length < 2
      || new Set(item.anchors).size !== item.anchors.length
      || !Array.isArray(item.caseIds)
      || item.caseIds.some((caseId) => !benchmarkCaseIds.has(caseId))
      || !Array.isArray(item.evidence)
      || item.evidence.length < 2
      || item.evidence.some((entry) => !entry?.url || !entry?.claim)) {
      throw new Error('W2 person-equivalence overlay contains an invalid equivalence');
    }
  }
  for (const item of overlay.rightPersonPolicyReviews) {
    if (!benchmarkCaseIds.has(item?.caseId)
      || !Array.isArray(item?.anchors)
      || item.anchors.length === 0
      || item.anchors.some((anchor) => typeof anchor !== 'string' || !anchor)
      || !item.reason) {
      throw new Error('W2 person-equivalence overlay contains an invalid policy review');
    }
  }
  return overlay;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function mapInstitutionRecord(record = {}) {
  return {
    openAlexId: record.id || null,
    displayName: record.display_name || null,
    ror: record.ror || null,
    country: record.country_code || null,
    associatedInstitutions: (Array.isArray(record.associated_institutions)
      ? record.associated_institutions
      : [])
      .map((institution) => ({
        openAlexId: institution?.id || null,
        displayName: institution?.display_name || null,
        ror: institution?.ror || null,
        country: institution?.country_code || null,
        relationship: institution?.relationship || null,
      }))
      .filter((institution) => institution.openAlexId || institution.ror),
  };
}

function createOpenAlexClient() {
  let calls = 0;
  let costUsd = 0;
  let nextRequestAt = 0;
  const authorCache = new Map();
  const institutionCache = new Map();
  const institutionDetailCache = new Map();

  async function paceRequest() {
    const waitMs = Math.max(0, nextRequestAt - Date.now());
    if (waitMs) await delay(waitMs);
    nextRequestAt = Date.now() + 125;
  }

  async function fetchJson(url) {
    const requestUrl = new URL(url);
    const apiKey = String(process.env.OPENALEX_API_KEY || '').trim();
    if (apiKey) requestUrl.searchParams.set('api_key', apiKey);
    let lastError = null;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await paceRequest();
      const response = await fetch(requestUrl, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'WMKF-reviewer-identity-W2-evaluation/1.0',
        },
      });
      calls += 1;
      if (response.status === 429 || response.status >= 500) {
        lastError = new Error(`OpenAlex request failed: ${response.status}`);
        const retryAfterSeconds = Number(response.headers.get('retry-after'));
        const retryDelay = Number.isFinite(retryAfterSeconds)
          ? Math.min(Math.max(retryAfterSeconds * 1000, 0), 10_000)
          : 1000 * (attempt + 1);
        await delay(Math.max(retryDelay, 1000 * (attempt + 1)));
        continue;
      }
      if (!response.ok) throw new Error(`OpenAlex request failed: ${response.status}`);
      const body = await response.json();
      costUsd += Number(body?.meta?.cost_usd || 0);
      return body;
    }
    throw lastError || new Error('OpenAlex retries exhausted');
  }

  return {
    async searchWorks(variant) {
      const filter = `raw_author_name.search:${JSON.stringify(variant)},type:!paratext`;
      const params = new URLSearchParams({
        filter,
        'per-page': '50',
        sort: 'publication_date:desc',
      });
      const body = await fetchJson(`${OPENALEX_API}/works?${params.toString()}`);
      return Array.isArray(body?.results) ? body.results : [];
    },
    async searchInstitutions(query, { limit = 10 } = {}) {
      const normalized = String(query || '').trim();
      if (!normalized) return [];
      if (!institutionCache.has(normalized)) {
        const params = new URLSearchParams({
          search: normalized,
          'per-page': String(Math.max(1, Math.min(Number(limit) || 10, 10))),
        });
        const body = await fetchJson(`${OPENALEX_API}/institutions?${params.toString()}`);
        institutionCache.set(normalized, (Array.isArray(body?.results) ? body.results : [])
          .map(mapInstitutionRecord));
      }
      return institutionCache.get(normalized);
    },
    async getInstitution(institutionId) {
      const normalized = shortOpenAlexInstitutionId(institutionId);
      if (!normalized) return null;
      if (!institutionDetailCache.has(normalized)) {
        const body = await fetchJson(`${OPENALEX_API}/institutions/${normalized}`);
        const record = Array.isArray(body?.results) ? body.results[0] : body;
        institutionDetailCache.set(
          normalized,
          record?.id ? mapInstitutionRecord(record) : null,
        );
      }
      return institutionDetailCache.get(normalized);
    },
    async getAuthor(authorId) {
      const normalized = shortOpenAlexAuthorId(authorId);
      if (!normalized) return null;
      if (!authorCache.has(normalized)) {
        const body = await fetchJson(`${OPENALEX_API}/authors/${normalized}`);
        const record = Array.isArray(body?.results) ? body.results[0] : body;
        const institution = record?.last_known_institutions?.[0]
          || record?.last_known_institution
          || null;
        authorCache.set(normalized, record?.id ? {
          openAlexId: record.id,
          displayName: record.display_name || null,
          orcid: normalizeOrcid(record.orcid),
          lastKnownInstitutionId: institution?.id || null,
          worksCount: Number(record.works_count || 0),
        } : null);
      }
      return authorCache.get(normalized);
    },
    metrics() {
      return {
        calls,
        costUsd: Number(costUsd.toFixed(4)),
      };
    },
  };
}

function createEvaluationInstitutionResolver(openAlex) {
  return createInstitutionIdentityResolver({
    propagateProviderErrors: true,
    openAlexService: {
      searchInstitutions: openAlex.searchInstitutions,
      getInstitution: openAlex.getInstitution,
    },
  });
}

function createSearchInstitutionAdapter(institutionResolver) {
  return async (query, { signal } = {}) => {
    const identity = await institutionResolver.resolve(query, { signal });
    return identity ? [identity] : [];
  };
}

function suggestionFor(candidate) {
  return {
    name: candidate.name,
    suggestedInstitution: candidate.claimedAffiliation,
    expertiseAreas: candidate.fieldSamplingHint ? [candidate.fieldSamplingHint] : [],
    field: candidate.fieldSamplingHint || null,
  };
}

async function evaluateSpine(candidate) {
  const suggestion = suggestionFor(candidate);
  const proposalInfo = {
    primaryResearchArea: candidate.fieldSamplingHint || null,
    title: candidate.fieldSamplingHint || null,
  };
  const result = await ReviewerIdentityEvidence.evaluateSuggestion(suggestion, { proposalInfo });
  const bind = result.status === 'confirmed' || result.status === 'probable';
  const orcid = normalizeOrcid(result.orcid);
  const authorId = shortOpenAlexAuthorId(result.selectedRecord?.openAlexId);
  const anchor = orcid
    ? `orcid:${orcid}`
    : (authorId ? `openalex:${authorId}` : null);
  return {
    decision: bind && anchor ? 'bind' : 'abstain',
    anchor: bind && anchor ? anchor : null,
    reason: result.reason || result.status,
  };
}

function createRightPersonPolicyMatcher(equivalenceOverlay, anchorsMatch) {
  const byCaseId = new Map(
    (equivalenceOverlay.rightPersonPolicyReviews || [])
      .map((item) => [item.caseId, item.anchors]),
  );
  return async (caseId, anchor) => {
    const expectedAnchors = byCaseId.get(caseId) || [];
    for (const expectedAnchor of expectedAnchors) {
      if (await anchorsMatch(expectedAnchor, anchor)) return true;
    }
    return false;
  };
}

async function main() {
  loadEnvLocal();
  const options = parseCli(process.argv.slice(2));
  const benchmark = readFrozenBenchmark(options.benchmarkPath);
  const equivalenceOverlay = readEquivalenceOverlay(DEFAULT_EQUIVALENCE_OVERLAY, benchmark);
  const selectedCases = options.caseIds.length
    ? benchmark.cases.filter((item) => options.caseIds.includes(item.caseId))
    : benchmark.cases;
  if (selectedCases.length !== (options.caseIds.length || benchmark.cases.length)) {
    throw new Error('One or more requested --case values are absent from the benchmark');
  }
  if (fs.existsSync(options.outputPath)) {
    throw new Error(
      `Refusing to overwrite existing output file: ${options.outputPath}`,
    );
  }

  const openAlex = createOpenAlexClient();
  const institutionResolver = createEvaluationInstitutionResolver(openAlex);
  const rorInstitutionResolver = options.institutionResolverArm === 'ror'
    ? createRorInstitutionIdentityResolver()
    : null;
  const worksSearchInstitution = rorInstitutionResolver
    ? createSearchInstitutionAdapter(rorInstitutionResolver)
    : async (query) => {
      const identity = await institutionResolver.resolve(query);
      return identity ? [identity] : [];
    };
  const resolverAnchorsMatch = createAnchorMatcher({
    getAuthorById: openAlex.getAuthor,
    propagateProviderErrors: true,
  });
  const scoringAnchorsMatch = createAnchorMatcher({
    equivalenceOverlay,
    getAuthorById: openAlex.getAuthor,
    propagateProviderErrors: true,
  });
  const rightPersonPolicyMatch = createRightPersonPolicyMatcher(
    equivalenceOverlay,
    scoringAnchorsMatch,
  );
  const rows = [];

  for (const item of selectedCases) {
    const candidate = item.frozenInput.candidate;
    let spine;
    let works;
    try {
      spine = await evaluateSpine(candidate);
    } catch (error) {
      spine = { decision: 'abstain', anchor: null, reason: `error:${error.message}` };
    }
    try {
      works = await resolveWorksFirst(candidate, {
        searchWorks: openAlex.searchWorks,
        searchInstitution: worksSearchInstitution,
        getAuthor: openAlex.getAuthor,
      });
    } catch (error) {
      works = { decision: 'review', anchor: null, reason: `error:${error.message}` };
    }
    const anchorsAgree = spine.anchor && works.anchor
      ? await resolverAnchorsMatch(spine.anchor, works.anchor)
      : false;
    const combined = combineIdentityDecisions(candidate, spine, works, { anchorsAgree });
    spine.outcome = await scoreDecision(item.expected, spine, scoringAnchorsMatch, {
      rightPersonPolicyMatch: spine.anchor
        ? await rightPersonPolicyMatch(item.caseId, spine.anchor)
        : false,
    });
    works.outcome = await scoreDecision(item.expected, works, scoringAnchorsMatch, {
      rightPersonPolicyMatch: works.anchor
        ? await rightPersonPolicyMatch(item.caseId, works.anchor)
        : false,
    });
    combined.outcome = await scoreDecision(item.expected, combined, scoringAnchorsMatch, {
      rightPersonPolicyMatch: combined.anchor
        ? await rightPersonPolicyMatch(item.caseId, combined.anchor)
        : false,
    });
    rows.push({
      caseId: item.caseId,
      stratum: item.stratum,
      expected: item.expected,
      candidate,
      spine,
      works,
      combined,
    });
    console.log(
      `${item.caseId.padEnd(36)} spine=${spine.outcome.padEnd(15)} `
      + `works=${works.outcome.padEnd(15)} combined=${combined.outcome}`,
    );
  }

  const fullRun = selectedCases.length === benchmark.cases.length;
  const promotion = fullRun ? evaluatePromotion(rows) : null;
  const changed = changedCases(rows);
  const optionalReviewLeads = rows.filter((row) =>
    row.combined.decision === 'review'
    && !changed.some((changedRow) => changedRow.caseId === row.caseId));
  const artifact = {
    artifactVersion: 'reviewer-identity-works-first-w2-v1',
    benchmarkVersion: benchmark.benchmarkVersion,
    benchmarkFrozenAt: benchmark.frozenAt,
    personEquivalenceOverlayVersion: equivalenceOverlay.overlayVersion,
    ranAt: new Date().toISOString(),
    evaluationOnly: true,
    productionBehaviorChanged: false,
    persistenceWrites: false,
    institutionResolverArm: options.institutionResolverArm,
    ...(rorInstitutionResolver
      ? { institutionResolverMetrics: rorInstitutionResolver.metrics }
      : {}),
    selectedCaseCount: selectedCases.length,
    w2AndScoringOpenAlex: {
      ...openAlex.metrics(),
      scope: 'works arm, resolver consensus, and benchmark scoring only',
      excludes: 'current-spine internal OpenAlex requests',
    },
    promotion,
    changedCaseCount: changed.length,
    reviewQueueCount: changed.filter((row) => row.combined.decision === 'review').length,
    reviewQueue: changed.filter((row) => row.combined.decision === 'review').map((row) => ({
      caseId: row.caseId,
      candidate: row.candidate,
      spine: row.spine,
      works: row.works,
      combined: row.combined,
    })),
    optionalReviewLeadCount: optionalReviewLeads.length,
    optionalReviewLeads: optionalReviewLeads.map((row) => ({
      caseId: row.caseId,
      candidate: row.candidate,
      reason: row.combined.reason,
      candidateAnchor: row.combined.anchor || row.works.anchor || null,
    })),
    changedCases: changed,
    rows,
  };

  fs.mkdirSync(path.dirname(options.outputPath), { recursive: true });
  fs.writeFileSync(options.outputPath, `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(JSON.stringify({
    output: options.outputPath,
    promotion,
    changedCaseCount: changed.length,
    reviewQueueCount: artifact.reviewQueue.length,
    optionalReviewLeadCount: artifact.optionalReviewLeads.length,
    w2AndScoringOpenAlex: artifact.w2AndScoringOpenAlex,
  }, null, 2));
  if (fullRun && !promotion.pass) process.exitCode = 2;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_BENCHMARK,
  DEFAULT_EQUIVALENCE_OVERLAY,
  DEFAULT_OUTPUT,
  FROZEN_BENCHMARK_SHA256,
  FROZEN_EQUIVALENCE_OVERLAY_SHA256,
  createAnchorMatcher,
  createEvaluationInstitutionResolver,
  createOpenAlexClient,
  createRightPersonPolicyMatcher,
  parseCli,
  readEquivalenceOverlay,
  readFrozenBenchmark,
};
