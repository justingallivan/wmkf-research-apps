#!/usr/bin/env node

/**
 * Read-only Stage 0/1 evaluator for page-first reviewer-email discovery.
 *
 * It runs the current identity/domain finalization path with persist:false,
 * compares the current SerpAPI contact query with two page-first queries, and
 * feeds only anchored first-party URLs through the existing SSRF-safe,
 * candidate-grounded institution-page email tier. Snippet emails are recorded
 * only inside search evidence and never become the machine endpoint.
 *
 * Default mode is dry-run. Paid SerpAPI calls require --execute.
 *
 * Usage:
 *   node scripts/evaluate-reviewer-page-first-email.mjs --dry-run --limit 2
 *   node scripts/evaluate-reviewer-page-first-email.mjs --execute --limit 2
 *   node scripts/evaluate-reviewer-page-first-email.mjs --execute --include-controls
 *   node scripts/evaluate-reviewer-page-first-email.mjs --execute --subject <key> --arm page-first
 *   node scripts/evaluate-reviewer-page-first-email.mjs \
 *     --replay-search-artifact outputs/reviewer-holistic-m1/reviewer-email-page-first-stage1-v1.json
 */

import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import './lib/use-extensionless.mjs';

const require = createRequire(import.meta.url);
const {
  buildControlViews,
  buildManualReviewRows,
  buildQueries,
  experimentDomainEvidence,
  fingerprintSubjects,
  mapWithConcurrency,
  prepassOptions,
  rankCandidatePageUrls,
  selectFrozenPrimarySubjects,
  summarizeResults,
} = require('./lib/reviewer-page-first-email');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_INPUT = 'outputs/reviewer-holistic-m1/reviewer-email-serp-lab-query-variants-v1.json';
const DEFAULT_OUTPUT = 'outputs/reviewer-holistic-m1/reviewer-email-page-first-stage1-v1.json';
const DEFAULT_REVIEW_OUTPUT = 'outputs/reviewer-holistic-m1/reviewer-email-page-first-stage1-manual-review-v1.json';
const DEFAULT_STAGE1_REPLAY = 'outputs/reviewer-holistic-m1/reviewer-email-page-first-stage1-replay-v1.json';
const DEFAULT_STAGE1_REVIEW = 'outputs/reviewer-holistic-m1/reviewer-email-page-first-stage1-replay-manual-review-v1.json';
const DEFAULT_STAGE2_OUTPUT = 'outputs/reviewer-holistic-m1/reviewer-email-page-first-stage2-v1.json';
const DEFAULT_STAGE2_REVIEW_OUTPUT = 'outputs/reviewer-holistic-m1/reviewer-email-page-first-stage2-manual-review-v1.json';
const DEFAULT_STAGE3_COHORT = 'outputs/reviewer-holistic-m1/reviewer-email-page-first-stage3-cohort-v1.json';
const DEFAULT_STAGE3_OUTPUT = 'outputs/reviewer-holistic-m1/reviewer-email-page-first-stage3-v1.json';
const DEFAULT_STAGE3_REVIEW_OUTPUT = 'outputs/reviewer-holistic-m1/reviewer-email-page-first-stage3-manual-review-v1.json';
const SERP_ALLOCATED_COST_USD = 0.015;
const MANUAL_REVIEW_CAP = 25;

function option(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function integerOption(name, fallback) {
  const value = Number(option(name, String(fallback)));
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return value;
}

async function loadEnv() {
  for (const filename of ['.env', '.env.local']) {
    const envPath = path.join(ROOT, filename);
    if (!existsSync(envPath)) continue;
    const body = await readFile(envPath, 'utf8');
    for (const rawLine of body.split('\n')) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const equals = line.indexOf('=');
      if (equals < 1) continue;
      const key = line.slice(0, equals).trim();
      let value = line.slice(equals + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"'))
        || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = value;
    }
  }
}

async function atomicWriteJson(outputPath, value) {
  await mkdir(path.dirname(outputPath), { recursive: true });
  const temporary = `${outputPath}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporary, outputPath);
}

function parseArgs() {
  const stage = option('--stage', '1');
  if (!['1', '2', '3'].includes(stage)) throw new Error('--stage must be 1, 2, or 3');

  const concurrency = integerOption('--concurrency', 3);
  if (concurrency < 1 || concurrency > 3) {
    throw new Error('--concurrency must be between 1 and 3');
  }
  const arm = option('--arm', 'both');
  if (!['current', 'page-first', 'both'].includes(arm)) {
    throw new Error('--arm must be current, page-first, or both');
  }
  if (hasFlag('--execute') && hasFlag('--dry-run')) {
    throw new Error('Choose either --execute or --dry-run, not both');
  }
  const replaySearchArtifact = option('--replay-search-artifact');
  return {
    stage,
    arm,
    concurrency,
    limit: integerOption('--limit', 13),
    includeControls: hasFlag('--include-controls'),
    execute: hasFlag('--execute'),
    recompute: hasFlag('--recompute'),
    subjectKeys: new Set(
      String(option('--subject', ''))
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
    ),
    inputPath: path.resolve(ROOT, option('--input', DEFAULT_INPUT)),
    replaySearchPath: replaySearchArtifact ? path.resolve(ROOT, replaySearchArtifact) : null,
    stage1Path: path.resolve(ROOT, option('--stage1-artifact', DEFAULT_STAGE1_REPLAY)),
    stage1ReviewPath: path.resolve(ROOT, option('--stage1-review', DEFAULT_STAGE1_REVIEW)),
    stage3CohortPath: path.resolve(ROOT, option('--stage3-cohort', DEFAULT_STAGE3_COHORT)),
    outputPath: path.resolve(ROOT, option(
      '--output',
      stage === '3'
        ? DEFAULT_STAGE3_OUTPUT
        : stage === '2'
        ? DEFAULT_STAGE2_OUTPUT
        : replaySearchArtifact
        ? 'outputs/reviewer-holistic-m1/reviewer-email-page-first-stage1-replay-v1.json'
        : DEFAULT_OUTPUT
    )),
    reviewOutputPath: path.resolve(ROOT, option(
      '--review-output',
      stage === '3'
        ? DEFAULT_STAGE3_REVIEW_OUTPUT
        : stage === '2'
        ? DEFAULT_STAGE2_REVIEW_OUTPUT
        : replaySearchArtifact
        ? 'outputs/reviewer-holistic-m1/reviewer-email-page-first-stage1-replay-manual-review-v1.json'
        : DEFAULT_REVIEW_OUTPUT
    )),
  };
}

function selectedArmNames(arm) {
  if (arm === 'current') return ['current'];
  if (arm === 'page-first') return ['pageFirst'];
  return ['current', 'pageFirst'];
}

function providerCallBudget(subjectCount, armNames) {
  return subjectCount * armNames.reduce(
    (total, armName) => total + (armName === 'current' ? 1 : 2),
    0
  );
}

function selectSubjects(sourceArtifact, args) {
  let subjects = selectFrozenPrimarySubjects(sourceArtifact);
  if (args.subjectKeys.size) {
    const controls = buildControlViews();
    subjects = [...subjects, ...controls].filter((subject) =>
      args.subjectKeys.has(subject.subjectKey) || args.subjectKeys.has(subject.subjectViewKey)
    );
    const found = new Set(subjects.flatMap((subject) => [subject.subjectKey, subject.subjectViewKey]));
    const missing = [...args.subjectKeys].filter((key) => !found.has(key));
    if (missing.length) throw new Error(`Unknown --subject key(s): ${missing.join(', ')}`);
    return subjects;
  }
  subjects = subjects.slice(0, args.limit || undefined);
  if (args.includeControls) subjects.push(...buildControlViews());
  return subjects;
}

function selectReplaySubjects(sourceArtifact, replayArtifact, armNames) {
  const available = [...selectFrozenPrimarySubjects(sourceArtifact), ...buildControlViews()];
  const byView = new Map(available.map((subject) => [
    subject.subjectViewKey || subject.subjectKey,
    subject,
  ]));
  const byKey = new Map(available.map((subject) => [subject.subjectKey, subject]));
  return replayArtifact.results.map((result) => {
    const subject = byView.get(result.subjectViewKey || result.subjectKey)
      || byKey.get(result.subjectKey);
    if (!subject) {
      throw new Error(`Replay artifact contains unknown subject: ${result.subjectViewKey || result.subjectKey}`);
    }
    for (const armName of armNames) {
      if (!result.arms?.[armName]) {
        throw new Error(`Replay artifact is missing ${armName} for ${result.subjectViewKey || result.subjectKey}`);
      }
    }
    return subject;
  });
}

function summarizePrepass(subject, result, latencyMs) {
  const ce = result?.contactEnrichment || {};
  const domainEvidence = experimentDomainEvidence({
    anchoredDomains: ce.anchoredInstitutionDomains,
    plausibleDomains: ce.plausibleInstitutionDomains,
  });
  return {
    latencyMs,
    identityStatus: ce.identity?.status || null,
    identityReason: ce.identity?.reason || null,
    effectiveInstitution: ce.affiliation || ce.openAlexAffiliation || subject.affiliation || null,
    affiliation: ce.affiliation || null,
    openAlexAffiliation: ce.openAlexAffiliation || null,
    anchoredDomains: Array.isArray(ce.anchoredInstitutionDomains)
      ? ce.anchoredInstitutionDomains
      : [],
    plausibleDomains: Array.isArray(ce.plausibleInstitutionDomains)
      ? ce.plausibleInstitutionDomains
      : [],
    evaluationDomainBasis: domainEvidence.basis,
    evaluationDomains: domainEvidence.domains,
    existingEmail: ce.email || null,
    existingEmailSource: ce.emailSource || null,
    existingEmailAction: ce.emailAction || null,
  };
}

async function runPrepass(subject, ContactEnrichmentService) {
  const started = Date.now();
  const options = prepassOptions();
  if (options.persist !== false) throw new Error('Evaluator prepass must use persist:false');
  const result = await ContactEnrichmentService.enrichCandidate(subject, options);
  return {
    raw: result,
    summary: summarizePrepass(subject, result, Date.now() - started),
  };
}

async function fetchSerp(query, apiKey, SerpContactService) {
  const started = Date.now();
  const params = new URLSearchParams({
    engine: 'google',
    q: query,
    num: '10',
    api_key: apiKey,
  });
  const response = await fetch(`${SerpContactService.baseUrl}?${params}`);
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(`SerpAPI ${response.status}: ${detail}`);
  }
  const data = await response.json();
  return {
    query,
    latencyMs: Date.now() - started,
    searchMetadataStatus: data.search_metadata?.status || null,
    organicResults: (data.organic_results || []).map((item) => ({
      position: item.position || null,
      title: typeof item.title === 'string' ? item.title.slice(0, 500) : null,
      link: typeof item.link === 'string' ? item.link : null,
      snippet: typeof item.snippet === 'string' ? item.snippet.slice(0, 1000) : null,
    })),
  };
}

function cloneResult(value) {
  return JSON.parse(JSON.stringify(value));
}

async function groundSelectedPages({
  subject,
  prepass,
  selected,
  ContactEnrichmentService,
  emailConfidence,
}) {
  const pageAttempts = [];
  for (const selection of selected) {
    const result = cloneResult(prepass.raw);
    const ce = result.contactEnrichment;
    // Experiment-only authorization: when identity anchoring is unavailable,
    // the owner approved a strongly matched claimed-institution domain for the
    // same safe-fetch + candidate-grounding path. This mutation is confined to
    // the cloned local result and never reaches production state.
    ce.anchoredInstitutionDomains = [...prepass.summary.evaluationDomains];
    ce.verifiedInstitutionDomain = ce.verifiedInstitutionDomain
      || prepass.summary.evaluationDomains[0]
      || null;
    ce.facultyPageUrl = selection.url;
    ce.website = null;
    ce.tierResults = { ...(ce.tierResults || {}) };
    delete ce.tierResults.institution_page;
    const deadlineAt = Date.now() + 8000;
    await ContactEnrichmentService._attachEmailFromResolvedPage(subject, result, { deadlineAt });
    const pageOutcome = ce.tierResults?.institution_page || {
      url: selection.url,
      skipped: 'page_tier_no_outcome',
    };
    pageAttempts.push({
      requestedUrl: selection.url,
      selectedScore: selection.score,
      outcome: pageOutcome,
      evaluationDomainBasis: prepass.summary.evaluationDomainBasis,
    });
    const confidence = emailConfidence({ email: ce.email, emailSource: ce.emailSource });
    if (ce.emailSource === 'institution_page' && confidence.action === 'ready') {
      return {
        pageAttempts,
        email: ce.email,
        emailSource: ce.emailSource,
        emailEvidence: ce.emailEvidence || null,
        emailAction: confidence.action,
        emailActionReason: confidence.reason,
      };
    }
  }
  return {
    pageAttempts,
    email: null,
    emailSource: null,
    emailEvidence: null,
    emailAction: 'missing',
    emailActionReason: 'No page-grounded candidate-associated address found',
  };
}

async function evaluateArm({
  armName,
  subject,
  prepass,
  queries,
  apiKey,
  SerpContactService,
  ContactEnrichmentService,
  emailConfidence,
  countCall,
}) {
  const started = Date.now();
  const searchQueries = armName === 'current' ? [queries.current] : queries.pageFirst;
  const searches = await Promise.all(searchQueries.map(async (query) => {
    countCall();
    try {
      return await fetchSerp(query, apiKey, SerpContactService);
    } catch (error) {
      return {
        query,
        latencyMs: Date.now() - started,
        error: error.message,
        retryable: true,
        organicResults: [],
      };
    }
  }));
  const successfulSearches = searches.filter((search) => !search.error);
  if (!successfulSearches.length) {
    return {
      status: 'error',
      reason: 'all_search_queries_failed',
      searches,
      urlDecisions: [],
      selectedUrls: [],
      pageAttempts: [],
      email: null,
      emailSource: null,
      emailAction: 'missing',
      latencyMs: Date.now() - started,
      retryable: true,
    };
  }

  const organicResults = successfulSearches.flatMap((search) => search.organicResults);
  const ranked = rankCandidatePageUrls(
    organicResults,
    subject,
    prepass.summary.evaluationDomains,
    2
  );
  const grounded = await groundSelectedPages({
    subject,
    prepass,
    selected: ranked.selected,
    ContactEnrichmentService,
    emailConfidence,
  });
  return {
    status: 'completed',
    reason: ranked.selected.length ? null : 'no_eligible_anchored_page',
    searches,
    urlDecisions: ranked.decisions,
    selectedUrls: ranked.selected.map((item) => ({
      url: item.url,
      position: item.position,
      score: item.score,
      anchoredDomain: item.anchoredDomain,
    })),
    ...grounded,
    latencyMs: Date.now() - started,
    retryable: false,
  };
}

async function replayArm({
  armName,
  subject,
  prepass,
  recordedArm,
  ContactEnrichmentService,
  emailConfidence,
}) {
  const started = Date.now();
  const searches = Array.isArray(recordedArm.searches)
    ? recordedArm.searches.map((search) => ({ ...search, replayed: true }))
    : [];
  const successfulSearches = searches.filter((search) => !search.error);
  if (!successfulSearches.length) {
    return {
      status: recordedArm.status === 'abstained' ? 'abstained' : 'error',
      reason: recordedArm.reason || 'no_successful_recorded_search',
      searches,
      urlDecisions: [],
      selectedUrls: [],
      pageAttempts: [],
      email: null,
      emailSource: null,
      emailAction: 'missing',
      latencyMs: Date.now() - started,
      retryable: recordedArm.status !== 'abstained',
      replayedSearches: true,
    };
  }

  const organicResults = successfulSearches.flatMap((search) => search.organicResults || []);
  const ranked = rankCandidatePageUrls(
    organicResults,
    subject,
    prepass.summary.evaluationDomains,
    2
  );
  const grounded = await groundSelectedPages({
    subject,
    prepass,
    selected: ranked.selected,
    ContactEnrichmentService,
    emailConfidence,
  });
  return {
    status: 'completed',
    reason: ranked.selected.length ? null : 'no_eligible_anchored_page',
    searches,
    urlDecisions: ranked.decisions,
    selectedUrls: ranked.selected.map((item) => ({
      url: item.url,
      position: item.position,
      score: item.score,
      anchoredDomain: item.anchoredDomain,
    })),
    ...grounded,
    latencyMs: Date.now() - started,
    retryable: false,
    replayedSearches: true,
  };
}

function claudePageSearchItems(claudeResult) {
  if (!claudeResult || typeof claudeResult !== 'object') return [];
  const items = [];
  const push = (link, title, snippet) => {
    if (typeof link !== 'string' || !link.trim()) return;
    items.push({
      position: items.length + 1,
      link,
      title: title || null,
      snippet: snippet || null,
    });
  };
  push(claudeResult.facultyPageUrl, 'Claude faculty/profile page', null);
  push(claudeResult.website, 'Claude website', null);
  for (const evidence of claudeResult.searchEvidence || []) {
    push(evidence.sourceUrl, evidence.sourceTitle, evidence.citedText);
  }
  return items;
}

async function evaluateClaudeArm({
  subject,
  prepass,
  apiKey,
  ContactEnrichmentService,
  emailConfidence,
}) {
  const started = Date.now();
  let claudeResult;
  try {
    claudeResult = await ContactEnrichmentService.claudeWebSearch(
      subject,
      apiKey,
      { deadlineAt: Date.now() + 180_000 }
    );
  } catch (error) {
    return {
      status: 'error',
      reason: 'claude_search_failed',
      error: error.message,
      retryable: true,
      providerResult: null,
      urlDecisions: [],
      selectedUrls: [],
      pageAttempts: [],
      email: null,
      emailSource: null,
      emailAction: 'missing',
      latencyMs: Date.now() - started,
    };
  }

  const ranked = rankCandidatePageUrls(
    claudePageSearchItems(claudeResult),
    subject,
    prepass.summary.evaluationDomains,
    2
  );
  const grounded = await groundSelectedPages({
    subject,
    prepass,
    selected: ranked.selected,
    ContactEnrichmentService,
    emailConfidence,
  });
  return {
    status: 'completed',
    reason: ranked.selected.length ? null : 'no_eligible_anchored_page',
    retryable: false,
    providerResult: claudeResult,
    urlDecisions: ranked.decisions,
    selectedUrls: ranked.selected.map((item) => ({
      url: item.url,
      position: item.position,
      score: item.score,
      anchoredDomain: item.anchoredDomain,
    })),
    ...grounded,
    latencyMs: Date.now() - started,
  };
}

function virtualOrderingSummary(results, firstName, secondName) {
  let readySubjects = 0;
  let fallbackSubjects = 0;
  let fallbackCallsAvoided = 0;
  let totalCalls = 0;
  const latencies = [];
  const outcomes = [];
  const callCount = (providerName, provider) => {
    if (!provider || provider.status === 'abstained') return 0;
    if (providerName === 'serpPageFirst') {
      return Array.isArray(provider.searches) ? provider.searches.length : 0;
    }
    return provider.status === 'completed' || provider.status === 'error' ? 1 : 0;
  };
  const measuredLatency = (providerName, provider) => {
    if (!provider || provider.status === 'abstained') return 0;
    if (providerName === 'serpPageFirst') {
      const searchLatency = Math.max(
        0,
        ...(provider.searches || []).map((search) =>
          Number.isFinite(search.latencyMs) ? search.latencyMs : 0
        )
      );
      return searchLatency + (Number.isFinite(provider.latencyMs) ? provider.latencyMs : 0);
    }
    return Number.isFinite(provider.latencyMs) ? provider.latencyMs : 0;
  };
  for (const result of results) {
    const first = result.providers[firstName];
    const second = result.providers[secondName];
    const firstReady = first?.emailAction === 'ready';
    const chosen = firstReady ? first : second;
    const firstCalls = callCount(firstName, first);
    const fallbackCalls = callCount(secondName, second);
    totalCalls += firstCalls;
    let latencyMs = measuredLatency(firstName, first);
    if (firstReady) {
      fallbackCallsAvoided += fallbackCalls;
    } else {
      fallbackSubjects += 1;
      totalCalls += fallbackCalls;
      latencyMs += measuredLatency(secondName, second);
    }
    latencies.push(latencyMs);
    if (chosen?.emailAction === 'ready') readySubjects += 1;
    outcomes.push({
      subjectKey: result.subjectKey,
      chosenProvider: firstReady ? firstName : secondName,
      email: chosen?.email || null,
      emailAction: chosen?.emailAction || 'missing',
    });
  }
  return {
    first: firstName,
    fallback: secondName,
    readySubjects,
    fallbackSubjects,
    fallbackCallsAvoided,
    totalCalls,
    medianLatencyMs: percentile(latencies, 0.5),
    p90LatencyMs: percentile(latencies, 0.9),
    outcomes,
  };
}

function percentile(values, quantile) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1);
  return sorted[index];
}

async function runStage2({
  args,
  sourceArtifact,
  ContactEnrichmentService,
  emailConfidence,
}) {
  const stage1Artifact = JSON.parse(await readFile(args.stage1Path, 'utf8'));
  const stage1Review = JSON.parse(await readFile(args.stage1ReviewPath, 'utf8'));
  if (stage1Artifact.runStatus !== 'completed') {
    throw new Error('Stage 1 artifact is not complete');
  }
  if ((stage1Review.rows || []).some((row) => row.adjudication !== 'correct')) {
    throw new Error('Stage 2 requires every Stage 1 review row to be adjudicated correct');
  }

  const subjects = selectFrozenPrimarySubjects(sourceArtifact);
  const stage1ByKey = new Map(stage1Artifact.results
    .filter((result) => result.control !== true)
    .map((result) => [result.subjectKey, result]));
  for (const subject of subjects) {
    if (!stage1ByKey.get(subject.subjectKey)?.arms?.pageFirst) {
      throw new Error(`Stage 1 page-first result missing for ${subject.subjectKey}`);
    }
  }

  if (args.recompute) {
    const artifact = JSON.parse(await readFile(args.outputPath, 'utf8'));
    if (artifact.runStatus !== 'completed' || !Array.isArray(artifact.results)) {
      throw new Error('Stage 2 output is not a completed artifact');
    }
    const adjudication = {
      rows: stage1Review.rows.length,
      correct: stage1Review.rows.filter((row) => row.adjudication === 'correct').length,
      wrongPerson: stage1Review.rows.filter((row) => row.adjudication === 'wrong_person').length,
      unclear: stage1Review.rows.filter((row) => row.adjudication === 'unclear').length,
    };
    const stage2Review = JSON.parse(await readFile(args.reviewOutputPath, 'utf8'));
    adjudication.rows = stage2Review.rows.length;
    adjudication.correct = stage2Review.rows.filter((row) => row.adjudication === 'correct').length;
    adjudication.wrongPerson = stage2Review.rows
      .filter((row) => row.adjudication === 'wrong_person').length;
    adjudication.unclear = stage2Review.rows.filter((row) => row.adjudication === 'unclear').length;
    const ordering = {
      serpThenClaude: virtualOrderingSummary(artifact.results, 'serpPageFirst', 'claude'),
      claudeThenSerp: virtualOrderingSummary(artifact.results, 'claude', 'serpPageFirst'),
    };
    if (adjudication.wrongPerson === 0 && adjudication.unclear === 0
      && adjudication.correct === adjudication.rows) {
      ordering.serpThenClaude.manuallyConfirmedCorrectReadySubjects =
        ordering.serpThenClaude.readySubjects;
      ordering.claudeThenSerp.manuallyConfirmedCorrectReadySubjects =
        ordering.claudeThenSerp.readySubjects;
    }
    const updated = {
      ...artifact,
      recomputedAt: new Date().toISOString(),
      reviewQueueStatus: adjudication.correct === adjudication.rows ? 'complete' : 'pending',
      adjudication,
      ordering,
    };
    await atomicWriteJson(args.outputPath, updated);
    await atomicWriteJson(args.reviewOutputPath, {
      ...stage2Review,
      pendingRowCount: stage2Review.rows.filter((row) => row.adjudication == null).length,
    });
    process.stdout.write(`${JSON.stringify({ adjudication, ordering }, null, 2)}\n`);
    process.stdout.write(`Recomputed ${args.outputPath} without provider calls\n`);
    return;
  }

  if (!args.execute) {
    process.stdout.write(`${JSON.stringify({
      dryRun: true,
      stage: 2,
      persistence: false,
      subjectCount: subjects.length,
      plannedClaudeCalls: subjects.length,
      maxPagesFetchedPerProvider: 2,
      stage1Artifact: path.relative(ROOT, args.stage1Path),
    }, null, 2)}\n`);
    return;
  }
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) throw new Error('CLAUDE_API_KEY is required for Stage 2 --execute');

  const startedAt = new Date().toISOString();
  let callsAttempted = 0;
  let checkpointQueue = Promise.resolve();
  const results = await mapWithConcurrency(
    subjects,
    args.concurrency,
    async (subject, index) => {
      const stage1Result = stage1ByKey.get(subject.subjectKey);
      const base = {
        subjectKey: subject.subjectKey,
        subjectViewKey: subject.subjectViewKey,
        personKey: subject.personKey,
        name: subject.name,
        affiliation: subject.affiliation,
        control: false,
        prepass: null,
        providers: {
          serpPageFirst: stage1Result.arms.pageFirst,
          claude: null,
        },
      };
      try {
        const prepass = await runPrepass(subject, ContactEnrichmentService);
        base.prepass = prepass.summary;
        const identityStatus = String(prepass.summary.identityStatus || '').toLowerCase();
        const identityContradictory = /ambiguous|contradict|rejected|wrong/.test(identityStatus);
        if (identityContradictory || !prepass.summary.evaluationDomains.length) {
          base.providers.claude = {
            status: 'abstained',
            reason: identityContradictory
              ? 'identity_not_safe_for_page_search'
              : 'no_strong_institution_domain',
            providerResult: null,
            urlDecisions: [],
            selectedUrls: [],
            pageAttempts: [],
            email: null,
            emailSource: null,
            emailAction: 'missing',
            latencyMs: 0,
            retryable: false,
          };
        } else {
          callsAttempted += 1;
          base.providers.claude = await evaluateClaudeArm({
            subject,
            prepass,
            apiKey,
            ContactEnrichmentService,
            emailConfidence,
          });
        }
      } catch (error) {
        base.prepassError = error.message;
        base.providers.claude = {
          status: 'error',
          reason: 'prepass_failed',
          error: error.message,
          providerResult: null,
          urlDecisions: [],
          selectedUrls: [],
          pageAttempts: [],
          email: null,
          emailSource: null,
          emailAction: 'missing',
          latencyMs: 0,
          retryable: true,
        };
      }
      process.stdout.write(`[${index + 1}/${subjects.length}] ${subject.name}\n`);
      return base;
    },
    async (_value, _index, partialResults) => {
      const snapshot = partialResults.filter(Boolean);
      checkpointQueue = checkpointQueue.then(() => atomicWriteJson(args.outputPath, {
        schemaVersion: 1,
        artifactVersion: 'reviewer-email-page-first-stage2-v1',
        runStatus: 'in_progress',
        createdAt: new Date().toISOString(),
        startedAt,
        persistence: false,
        stage1Artifact: path.relative(ROOT, args.stage1Path),
        callsAttempted,
        results: snapshot,
      }));
      await checkpointQueue;
    }
  );

  const reviewInput = results.map((result) => ({
    ...result,
    arms: {
      current: result.providers.serpPageFirst,
      pageFirst: result.providers.claude,
    },
  }));
  const manualRows = buildManualReviewRows(reviewInput, MANUAL_REVIEW_CAP);
  const priorAdjudications = new Map((stage1Review.rows || []).map((row) => [
    row.outcomeId,
    {
      adjudication: row.adjudication,
      adjudicationNote: row.adjudicationNote || null,
    },
  ]));
  for (const row of manualRows) {
    const prior = priorAdjudications.get(row.outcomeId);
    if (!prior) continue;
    row.adjudication = prior.adjudication;
    if (prior.adjudicationNote) row.adjudicationNote = prior.adjudicationNote;
  }
  const ordering = {
    serpThenClaude: virtualOrderingSummary(results, 'serpPageFirst', 'claude'),
    claudeThenSerp: virtualOrderingSummary(results, 'claude', 'serpPageFirst'),
  };
  const artifact = {
    schemaVersion: 1,
    artifactVersion: 'reviewer-email-page-first-stage2-v1',
    runStatus: 'completed',
    createdAt: new Date().toISOString(),
    startedAt,
    persistence: false,
    localWritesOnly: true,
    snippetEmailsSendable: false,
    stage1Artifact: path.relative(ROOT, args.stage1Path),
    sourceCohortFingerprint: stage1Artifact.evaluatedSubjectFingerprint,
    evaluatedSubjectFingerprint: fingerprintSubjects(subjects),
    callsAttempted,
    callCap: 13,
    maxPagesFetchedPerProvider: 2,
    reviewQueueStatus: manualRows.some((row) => row.adjudication == null)
      ? 'pending'
      : 'complete',
    ordering,
    results,
  };
  await atomicWriteJson(args.outputPath, artifact);
  await atomicWriteJson(args.reviewOutputPath, {
    schemaVersion: 1,
    artifactVersion: 'reviewer-email-page-first-stage2-manual-review-v1',
    createdAt: new Date().toISOString(),
    sourceArtifact: path.relative(ROOT, args.outputPath),
    blindedProviderLabels: true,
    cap: MANUAL_REVIEW_CAP,
    rowCount: manualRows.length,
    pendingRowCount: manualRows.filter((row) => row.adjudication == null).length,
    rows: manualRows,
  });
  process.stdout.write(`${JSON.stringify({
    callsAttempted,
    reviewRows: manualRows.length,
    pendingReviewRows: manualRows.filter((row) => row.adjudication == null).length,
    ordering,
  }, null, 2)}\n`);
  process.stdout.write(`Wrote ${args.outputPath}\n`);
  process.stdout.write(`Wrote ${args.reviewOutputPath}\n`);
}

function summarizeStage3(results, calls) {
  const armSummary = (rows, armName) => {
    const outcomes = rows.map((row) => row.arms[armName]);
    return {
      subjects: rows.length,
      readySubjects: outcomes.filter((outcome) => outcome.emailAction === 'ready').length,
      completed: outcomes.filter((outcome) => outcome.status === 'completed').length,
      abstained: outcomes.filter((outcome) => outcome.status === 'abstained').length,
      errors: outcomes.filter((outcome) => outcome.status === 'error').length,
      medianLatencyMs: percentile(outcomes.map((outcome) => outcome.latencyMs), 0.5),
      p90LatencyMs: percentile(outcomes.map((outcome) => outcome.latencyMs), 0.9),
    };
  };
  const segment = (rows) => ({
    current: armSummary(rows, 'current'),
    selectedCascade: armSummary(rows, 'pageFirst'),
  });
  const overall = segment(results);
  return {
    subjects: results.length,
    calls,
    overall: {
      ...overall,
      readySubjectDelta:
        overall.selectedCascade.readySubjects - overall.current.readySubjects,
    },
    byGeography: {
      US: segment(results.filter((row) => row.geography === 'US')),
      nonUS: segment(results.filter((row) => row.geography === 'non-US')),
    },
  };
}

function abstainedArm(reason) {
  return {
    status: 'abstained',
    reason,
    searches: [],
    urlDecisions: [],
    selectedUrls: [],
    pageAttempts: [],
    email: null,
    emailSource: null,
    emailEvidence: null,
    emailAction: 'missing',
    latencyMs: 0,
    retryable: false,
  };
}

async function runStage3({
  args,
  ContactEnrichmentService,
  SerpContactService,
  emailConfidence,
}) {
  const cohort = JSON.parse(await readFile(args.stage3CohortPath, 'utf8'));
  if (cohort.status !== 'frozen' || cohort.subjects?.length !== 20) {
    throw new Error('Stage 3 requires the frozen 20-subject cohort');
  }
  if (cohort.counts?.US !== 10 || cohort.counts?.nonUS !== 10) {
    throw new Error('Stage 3 cohort must contain exactly 10 US and 10 non-US subjects');
  }
  const subjects = cohort.subjects;
  if (args.recompute) {
    const artifact = JSON.parse(await readFile(args.outputPath, 'utf8'));
    const review = JSON.parse(await readFile(args.reviewOutputPath, 'utf8'));
    if (artifact.runStatus !== 'completed' || !Array.isArray(artifact.results)) {
      throw new Error('Stage 3 output is not a completed artifact');
    }
    const adjudication = {
      rows: review.rows.length,
      correct: review.rows.filter((row) => row.adjudication === 'correct').length,
      wrongPerson: review.rows.filter((row) => row.adjudication === 'wrong_person').length,
      unclear: review.rows.filter((row) => row.adjudication === 'unclear').length,
    };
    const summary = summarizeStage3(artifact.results, artifact.calls);
    const promotionDecision = {
      status: 'do_not_promote',
      zeroWrongPerson: adjudication.wrongPerson === 0,
      requiredReadySubjectDelta: 3,
      observedReadySubjectDelta: summary.overall.readySubjectDelta,
      yieldGatePassed: summary.overall.readySubjectDelta >= 3,
      manualReviewCapPassed: review.rows.length <= 30,
      reason: summary.overall.readySubjectDelta >= 3
        ? 'Other promotion gates require owner review'
        : 'Fresh-cohort ready-subject gain did not meet the predeclared threshold',
      productionBehaviorChanged: false,
    };
    await atomicWriteJson(args.outputPath, {
      ...artifact,
      recomputedAt: new Date().toISOString(),
      reviewQueueStatus: adjudication.correct === adjudication.rows ? 'complete' : 'pending',
      adjudication,
      summary,
      promotionDecision,
    });
    await atomicWriteJson(args.reviewOutputPath, {
      ...review,
      pendingRowCount: review.rows.filter((row) => row.adjudication == null).length,
    });
    process.stdout.write(`${JSON.stringify({
      adjudication,
      summary,
      promotionDecision,
    }, null, 2)}\n`);
    process.stdout.write(`Recomputed ${args.outputPath} without provider calls\n`);
    return;
  }
  if (!args.execute) {
    process.stdout.write(`${JSON.stringify({
      dryRun: true,
      stage: 3,
      persistence: false,
      cohortFingerprint: cohort.cohortFingerprint,
      subjects: subjects.length,
      geography: { US: 10, nonUS: 10 },
      providerCallCap: {
        currentSerp: 20,
        claude: 20,
        pageFirstSerpFallback: 40,
        total: 80,
      },
      manualReviewCap: 30,
    }, null, 2)}\n`);
    return;
  }
  const claudeApiKey = process.env.CLAUDE_API_KEY;
  const serpApiKey = process.env.SERP_API_KEY;
  if (!claudeApiKey || !serpApiKey) {
    throw new Error('CLAUDE_API_KEY and SERP_API_KEY are required for Stage 3 --execute');
  }

  const startedAt = new Date().toISOString();
  const calls = { currentSerp: 0, claude: 0, pageFirstSerpFallback: 0, total: 0 };
  let checkpointQueue = Promise.resolve();
  const results = await mapWithConcurrency(
    subjects,
    args.concurrency,
    async (subject, index) => {
      const base = {
        subjectKey: subject.subjectKey,
        subjectViewKey: subject.subjectViewKey,
        personKey: subject.personKey,
        name: subject.name,
        affiliation: subject.affiliation,
        geography: subject.geography,
        countryCode: subject.countryCode,
        control: false,
        prepass: null,
        arms: {},
        providers: { claude: null, pageFirstSerpFallback: null },
      };
      try {
        const prepass = await runPrepass(subject, ContactEnrichmentService);
        base.prepass = prepass.summary;
        base.queries = buildQueries(subject, prepass.summary);
        const identityStatus = String(prepass.summary.identityStatus || '').toLowerCase();
        const identityContradictory = /ambiguous|contradict|rejected|wrong/.test(identityStatus);
        const reason = identityContradictory
          ? 'identity_not_safe_for_page_search'
          : (!prepass.summary.evaluationDomains.length
            ? 'no_strong_institution_domain'
            : (prepass.summary.existingEmail ? 'prepass_already_has_address' : null));
        if (reason) {
          base.arms.current = abstainedArm(reason);
          base.arms.pageFirst = abstainedArm(reason);
          base.providers.claude = abstainedArm(reason);
          base.providers.pageFirstSerpFallback = abstainedArm(reason);
        } else {
          base.arms.current = await evaluateArm({
            armName: 'current',
            subject,
            prepass,
            queries: base.queries,
            apiKey: serpApiKey,
            SerpContactService,
            ContactEnrichmentService,
            emailConfidence,
            countCall: () => {
              calls.currentSerp += 1;
              calls.total += 1;
            },
          });

          calls.claude += 1;
          calls.total += 1;
          base.providers.claude = await evaluateClaudeArm({
            subject,
            prepass,
            apiKey: claudeApiKey,
            ContactEnrichmentService,
            emailConfidence,
          });
          if (base.providers.claude.emailAction === 'ready') {
            base.providers.pageFirstSerpFallback = abstainedArm('claude_ready_skip_fallback');
            base.arms.pageFirst = {
              ...base.providers.claude,
              selectedProvider: 'claude',
            };
          } else {
            base.providers.pageFirstSerpFallback = await evaluateArm({
              armName: 'pageFirst',
              subject,
              prepass,
              queries: base.queries,
              apiKey: serpApiKey,
              SerpContactService,
              ContactEnrichmentService,
              emailConfidence,
              countCall: () => {
                calls.pageFirstSerpFallback += 1;
                calls.total += 1;
              },
            });
            base.arms.pageFirst = {
              ...base.providers.pageFirstSerpFallback,
              selectedProvider: 'pageFirstSerpFallback',
              latencyMs:
                base.providers.claude.latencyMs
                + base.providers.pageFirstSerpFallback.latencyMs,
            };
          }
        }
      } catch (error) {
        base.prepassError = error.message;
        base.arms.current = base.arms.current || {
          ...abstainedArm('subject_evaluation_failed'),
          status: 'error',
          error: error.message,
          retryable: true,
        };
        base.arms.pageFirst = base.arms.pageFirst || {
          ...abstainedArm('subject_evaluation_failed'),
          status: 'error',
          error: error.message,
          retryable: true,
        };
      }
      process.stdout.write(`[${index + 1}/${subjects.length}] ${subject.name}\n`);
      return base;
    },
    async (_value, _index, partialResults) => {
      const snapshot = partialResults.filter(Boolean);
      checkpointQueue = checkpointQueue.then(() => atomicWriteJson(args.outputPath, {
        schemaVersion: 1,
        artifactVersion: 'reviewer-email-page-first-stage3-v1',
        runStatus: 'in_progress',
        createdAt: new Date().toISOString(),
        startedAt,
        persistence: false,
        cohortFingerprint: cohort.cohortFingerprint,
        calls: { ...calls },
        summary: summarizeStage3(snapshot, { ...calls }),
        results: snapshot,
      }));
      await checkpointQueue;
    }
  );

  const manualRows = buildManualReviewRows(results, 30);
  const summary = summarizeStage3(results, { ...calls });
  const artifact = {
    schemaVersion: 1,
    artifactVersion: 'reviewer-email-page-first-stage3-v1',
    runStatus: 'completed',
    createdAt: new Date().toISOString(),
    startedAt,
    persistence: false,
    localWritesOnly: true,
    snippetEmailsSendable: false,
    cohortArtifact: path.relative(ROOT, args.stage3CohortPath),
    cohortFingerprint: cohort.cohortFingerprint,
    selection: {
      current: 'one current-style SerpAPI query then first-party page grounding',
      selectedCascade: 'Claude page discovery then two-query page-first SerpAPI fallback',
    },
    callCap: 80,
    manualReviewCap: 30,
    reviewQueueStatus: 'pending',
    calls,
    summary,
    results,
  };
  await atomicWriteJson(args.outputPath, artifact);
  await atomicWriteJson(args.reviewOutputPath, {
    schemaVersion: 1,
    artifactVersion: 'reviewer-email-page-first-stage3-manual-review-v1',
    createdAt: new Date().toISOString(),
    sourceArtifact: path.relative(ROOT, args.outputPath),
    blindedArmLabels: true,
    cap: 30,
    rowCount: manualRows.length,
    pendingRowCount: manualRows.length,
    rows: manualRows,
  });
  process.stdout.write(`${JSON.stringify({
    calls,
    summary,
    reviewRows: manualRows.length,
  }, null, 2)}\n`);
  process.stdout.write(`Wrote ${args.outputPath}\n`);
  process.stdout.write(`Wrote ${args.reviewOutputPath}\n`);
}

function buildArtifact({
  args,
  sourceArtifact,
  subjects,
  results,
  startedAt,
  callsAttempted,
  runStatus,
  reviewQueueStatus = 'pending',
}) {
  return {
    schemaVersion: 1,
    artifactVersion: 'reviewer-email-page-first-stage1-v1',
    runStatus,
    createdAt: new Date().toISOString(),
    startedAt,
    sourceArtifact: path.relative(ROOT, args.inputPath),
    sourceCohortFingerprint: sourceArtifact.evaluatedSubjectFingerprint
      || sourceArtifact.sourceCohortFingerprint
      || null,
    evaluatedSubjectFingerprint: fingerprintSubjects(subjects),
    contract: {
      stage: 1,
      persistence: false,
      localWritesOnly: true,
      provider: 'SerpAPI Google',
      searchMode: args.replaySearchPath ? 'replay_saved_results' : 'live',
      replaySearchArtifact: args.replaySearchPath
        ? path.relative(ROOT, args.replaySearchPath)
        : null,
      currentQueryCount: 1,
      pageFirstQueryCount: 2,
      maxPagesFetchedPerArm: 2,
      subjectConcurrency: args.concurrency,
      pageFirstQueryConcurrency: 2,
      snippetEmailsSendable: false,
      readySourceRequired: 'institution_page',
      manualReviewCap: MANUAL_REVIEW_CAP,
      allocatedPerCallCostUsd: SERP_ALLOCATED_COST_USD,
      expectedMarginalCostUsdWhileQuotaRemains: 0,
      experimentDomainPolicy: {
        preferred: 'identity_anchored',
        fallback: 'claimed_institution_strong_match',
        productionPolicyChanged: false,
      },
      pageTierEnabledForEvaluatorProcess: process.env.REVIEWER_PAGE_EMAIL_TIER_ENABLED === 'true',
    },
    selection: {
      arm: args.arm,
      includeControls: args.includeControls,
      explicitSubjectKeys: [...args.subjectKeys],
      subjectCount: subjects.length,
    },
    reviewQueueStatus,
    summary: summarizeResults(results, callsAttempted),
    results,
  };
}

async function main() {
  const args = parseArgs();
  await loadEnv();
  if ((args.stage === '2' || args.stage === '3') && args.execute && !args.recompute) {
    const { loadModelOverrides } = await import('../lib/services/model-override-loader.js');
    await loadModelOverrides();
  }
  // Process-local experiment switch. Production configuration is not changed.
  process.env.REVIEWER_PAGE_EMAIL_TIER_ENABLED = 'true';
  if (process.env.REVIEWER_PAGE_EMAIL_TIER_ENABLED !== 'true') {
    throw new Error('Reviewer page-email tier is not enabled for the evaluator process');
  }

  // Load env-sensitive services only after .env.local has been read.
  const { ContactEnrichmentService } = require('../lib/services/contact-enrichment-service');
  const { SerpContactService } = require('../lib/services/serp-contact-service');
  const { emailConfidence } = require('../lib/utils/reviewer-invite');

  const armNames = selectedArmNames(args.arm);
  const sourceArtifact = JSON.parse(await readFile(args.inputPath, 'utf8'));
  if (args.stage === '3') {
    await runStage3({
      args,
      ContactEnrichmentService,
      SerpContactService,
      emailConfidence,
    });
    return;
  }
  if (args.stage === '2') {
    await runStage2({
      args,
      sourceArtifact,
      ContactEnrichmentService,
      emailConfidence,
    });
    return;
  }
  const replayArtifact = args.replaySearchPath
    ? JSON.parse(await readFile(args.replaySearchPath, 'utf8'))
    : null;
  const subjects = replayArtifact
    ? selectReplaySubjects(sourceArtifact, replayArtifact, armNames)
    : selectSubjects(sourceArtifact, args);
  if (!subjects.length) throw new Error('No subjects selected');
  const replayResultsByView = new Map((replayArtifact?.results || []).map((result) => [
    result.subjectViewKey || result.subjectKey,
    result,
  ]));
  const plannedCalls = replayArtifact ? 0 : providerCallBudget(subjects.length, armNames);
  if (plannedCalls > 51) {
    throw new Error(`Planned SerpAPI calls exceed Stage 1 cap: ${plannedCalls} > 51`);
  }

  if (!args.execute && !replayArtifact) {
    const previews = await mapWithConcurrency(subjects, args.concurrency, async (subject) => {
      try {
        const prepass = await runPrepass(subject, ContactEnrichmentService);
        return {
          subjectKey: subject.subjectKey,
          subjectViewKey: subject.subjectViewKey,
          personKey: subject.personKey,
          name: subject.name,
          affiliation: subject.affiliation,
          control: subject.control,
          prepass: prepass.summary,
          queries: buildQueries(subject, prepass.summary),
        };
      } catch (error) {
        return {
          subjectKey: subject.subjectKey,
          name: subject.name,
          affiliation: subject.affiliation,
          prepassError: error.message,
          retryable: true,
        };
      }
    });
    process.stdout.write(`${JSON.stringify({
      dryRun: true,
      persistence: false,
      providerCallsAttempted: 0,
      plannedProviderCalls: plannedCalls,
      allocatedQuotaValueUsd: Number((plannedCalls * SERP_ALLOCATED_COST_USD).toFixed(3)),
      expectedMarginalCostUsdWhileQuotaRemains: 0,
      subjects: previews,
    }, null, 2)}\n`);
    return;
  }

  const apiKey = process.env.SERP_API_KEY;
  if (!replayArtifact && !apiKey) throw new Error('SERP_API_KEY is required for --execute');

  const startedAt = new Date().toISOString();
  let callsAttempted = 0;
  let checkpointQueue = Promise.resolve();
  const results = await mapWithConcurrency(
    subjects,
    args.concurrency,
    async (subject, index) => {
      const base = {
        subjectKey: subject.subjectKey,
        subjectViewKey: subject.subjectViewKey,
        personKey: subject.personKey,
        name: subject.name,
        affiliation: subject.affiliation,
        control: subject.control,
        prepass: null,
        queries: null,
        arms: {},
      };
      try {
        const prepass = await runPrepass(subject, ContactEnrichmentService);
        base.prepass = prepass.summary;
        base.queries = buildQueries(subject, prepass.summary);
        const identityStatus = String(prepass.summary.identityStatus || '').toLowerCase();
        const identityContradictory = /ambiguous|contradict|rejected|wrong/.test(identityStatus);
        const hasEvaluationDomain = prepass.summary.evaluationDomains.length > 0;
        const existingAddress = Boolean(prepass.summary.existingEmail);
        if (identityContradictory || !hasEvaluationDomain || existingAddress) {
          const reason = identityContradictory
            ? 'identity_not_safe_for_page_search'
            : (!hasEvaluationDomain ? 'no_strong_institution_domain' : 'prepass_already_has_address');
          for (const armName of armNames) {
            base.arms[armName] = {
              status: 'abstained',
              reason,
              searches: [],
              urlDecisions: [],
              selectedUrls: [],
              pageAttempts: [],
              email: null,
              emailSource: null,
              emailAction: 'missing',
              latencyMs: 0,
              retryable: false,
            };
          }
        } else {
          for (const armName of armNames) {
            const recordedResult = replayResultsByView.get(subject.subjectViewKey || subject.subjectKey);
            base.arms[armName] = replayArtifact
              ? await replayArm({
                armName,
                subject,
                prepass,
                recordedArm: recordedResult.arms[armName],
                ContactEnrichmentService,
                emailConfidence,
              })
              : await evaluateArm({
                armName,
                subject,
                prepass,
                queries: base.queries,
                apiKey,
                SerpContactService,
                ContactEnrichmentService,
                emailConfidence,
                countCall: () => { callsAttempted += 1; },
              });
          }
        }
      } catch (error) {
        base.prepassError = error.message;
        for (const armName of armNames) {
          base.arms[armName] = {
            status: 'error',
            reason: 'prepass_failed',
            error: error.message,
            searches: [],
            urlDecisions: [],
            selectedUrls: [],
            pageAttempts: [],
            email: null,
            emailSource: null,
            emailAction: 'missing',
            latencyMs: 0,
            retryable: true,
          };
        }
      }
      process.stdout.write(`[${index + 1}/${subjects.length}] ${subject.name}\n`);
      return base;
    },
    async (_value, _index, partialResults) => {
      const snapshot = partialResults.filter(Boolean);
      checkpointQueue = checkpointQueue.then(() => atomicWriteJson(
        args.outputPath,
        buildArtifact({
          args,
          sourceArtifact,
          subjects,
          results: snapshot,
          startedAt,
          callsAttempted,
          runStatus: 'in_progress',
        })
      ));
      await checkpointQueue;
    }
  );

  let manualRows;
  let reviewQueueStatus = 'ready';
  try {
    manualRows = buildManualReviewRows(results, MANUAL_REVIEW_CAP);
  } catch (error) {
    reviewQueueStatus = 'blocked_manual_review_cap';
    await atomicWriteJson(args.outputPath, buildArtifact({
      args,
      sourceArtifact,
      subjects,
      results,
      startedAt,
      callsAttempted,
      runStatus: 'completed',
      reviewQueueStatus,
    }));
    throw error;
  }

  const artifact = buildArtifact({
    args,
    sourceArtifact,
    subjects,
    results,
    startedAt,
    callsAttempted,
    runStatus: 'completed',
    reviewQueueStatus,
  });
  await atomicWriteJson(args.outputPath, artifact);
  await atomicWriteJson(args.reviewOutputPath, {
    schemaVersion: 1,
    artifactVersion: 'reviewer-email-page-first-stage1-manual-review-v1',
    createdAt: new Date().toISOString(),
    sourceArtifact: path.relative(ROOT, args.outputPath),
    blindedArmLabels: true,
    cap: MANUAL_REVIEW_CAP,
    rowCount: manualRows.length,
    rows: manualRows,
  });

  process.stdout.write(`${JSON.stringify(artifact.summary, null, 2)}\n`);
  process.stdout.write(`Wrote ${args.outputPath}\n`);
  process.stdout.write(`Wrote ${args.reviewOutputPath}\n`);
}

await main();
