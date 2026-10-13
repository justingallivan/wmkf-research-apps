/**
 * Staff discussion sentiment analysis (plan: docs/plans/DELIBERATION_SENTIMENT_PLAN_2026-10-13.md §4).
 *
 * One Executor run per proposal over the bound Staff Discussion Transcript, using the same verified
 * loader as the discussion summary (transcript-summary-service.js). The model returns only `time` and
 * `quote` for each evidence item. This service validates the record's shape itself (the Executor checks
 * only top-level keys), then rebuilds the speaker turns from the verified source content the TXT was
 * produced from (refusing unless formatting it reproduces the TXT the model read exactly), finds the one
 * turn each quote came from, and derives `speakerLabel` and `speaker` from that turn, so the model never
 * attaches a quote to a person. Any invalid shape or unverified quote saves nothing.
 *
 * Actor ids (`ownerProfileId`, `actingUserSystemId`) are arguments the route passes from authenticated
 * context only. The run is staff-only; routes and pages are a later stage.
 */
import { isGuid } from '../../utils/guid.js';
import { executePrompt } from '../execute-prompt.js';
import { getExecutorBudget } from '../executor-budget-service.js';
import { loadModelOverrides } from '../model-override-loader.js';
import { fetchCurrentPrompt, PROMPT_STORE_ERROR_CODES } from '../prompt-store.js';
import {
  PROMPT_NAME, SENTIMENT_LIMITS, ENTHUSIASM_VALUES, RECEPTION_VALUES,
} from '../../../shared/config/prompts/meeting-staff-discussion-sentiment.js';
import {
  groupTranscriptByTurn, formatTranscriptText, formatTranscriptTurnTime,
} from '../transcription-pilot/transcript-format.js';
import { ServiceHttpError } from '../service-http-error.js';
import { materialError } from './material-service.js';
import {
  TRANSCRIPT_SUMMARY_DEPENDENCIES, assertEnabled, bindCurrent, loadVerifiedDiscussionTranscript,
} from './transcript-summary-service.js';
import * as sentimentStore from './discussion-sentiment-store.js';
import { SENTIMENT_GENERATION_ABANDONED_SECONDS } from './discussion-sentiment-store.js';

export const DISCUSSION_SENTIMENT_DEPENDENCIES = Object.freeze({
  ...TRANSCRIPT_SUMMARY_DEPENDENCIES,
  loadModelOverrides,
  getExecutorBudget,
  executePrompt,
  fetchCurrentPrompt,
  sentiments: sentimentStore,
});

const UNIDENTIFIED = 'Unidentified speaker';
const TIME_RE = /^\d{1,2}(?::\d{2}){1,2}$/;
// Same control-character handling as the TXT formatter's safePlainText, then whitespace collapsed.
const normalizeSpace = (text) => String(text || '').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim();
const sameId = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();

// Executor failures a staff member can act on; anything else is a 502.
const EXECUTOR_FAILURES = Object.freeze({
  claude_output_refused: [422, 'The AI provider declined to analyze this discussion.'],
  claude_output_truncated: [422, 'The analysis ran past its length budget. Ask an administrator to raise the budget, then try again.'],
  claude_context_window_exceeded: [422, 'The discussion is too long to analyze in one request.'],
});

// The shared loader words its refusals for the summary; the codes stay, the copy says "analyze".
const LOADER_MESSAGES = Object.freeze({
  staff_discussion_transcript_not_ready: 'Generate the staff discussion transcript for the confirmed presentation end first.',
  staff_discussion_transcript_integrity_failed: 'The staff discussion transcript could not be verified. Generate it again, then analyze.',
  staff_discussion_transcript_too_long: 'The staff discussion transcript is too long to analyze in one request.',
});

const promptNotReady = () => materialError(
  'Sentiment analysis is not set up yet. Ask an administrator to check the prompt.', 'sentiment_prompt_not_ready', 409);
const isPromptStoreError = (error) => Boolean(error?.code)
  && (error.code === PROMPT_STORE_ERROR_CODES?.NOT_FOUND || error.code === PROMPT_STORE_ERROR_CODES?.DUPLICATE_CURRENT);

/** Typed 409 for a missing or duplicated current prompt, and sentiment wording for the loader's refusals. */
function asSentimentError(error) {
  if (isPromptStoreError(error)) return promptNotReady();
  const message = LOADER_MESSAGES[error?.code];
  if (message && error instanceof ServiceHttpError) return materialError(message, error.code, error.httpStatus);
  return error;
}

// ---- record validation (plan §4.4) -------------------------------------------------------------

function hasExactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function text(value, max, label, errors) {
  if (typeof value !== 'string') { errors.push(`${label} must be a string`); return ''; }
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) errors.push(`${label} must be 1 to ${max} characters`);
  return trimmed;
}

function quoteText(value, label, errors) {
  const trimmed = text(value, SENTIMENT_LIMITS.quoteMax, label, errors);
  if (trimmed && normalizeSpace(trimmed).length < SENTIMENT_LIMITS.quoteMin) {
    errors.push(`${label} must be at least ${SENTIMENT_LIMITS.quoteMin} characters`);
  }
  return trimmed;
}

function evidenceList(value, { min = 0, max, label }, errors) {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    errors.push(`${label} must be a list of ${min} to ${max} items`);
    return [];
  }
  return value.map((item, index) => {
    const where = `${label}[${index}]`;
    if (!hasExactKeys(item, ['time', 'quote'])) { errors.push(`${where} must have exactly time and quote`); return null; }
    const time = typeof item.time === 'string' ? item.time.trim() : '';
    if (!TIME_RE.test(time) || time.length > SENTIMENT_LIMITS.timeMax) errors.push(`${where}.time is not a turn time`);
    return { time, quote: quoteText(item.quote, `${where}.quote`, errors) };
  }).filter(Boolean);
}

/**
 * Validate the model's parsed output against DeliberationSentiment v1 minus the server-derived fields.
 * Returns { ok: true, value } with a freshly built object (unknown keys never survive) or { ok: false, errors }.
 */
export function validateSentimentOutput(parsed) {
  const errors = [];
  const keys = ['schemaVersion', 'enthusiasm', 'reception', 'headline', 'supportPoints', 'concernPoints', 'disagreements', 'uncertainties'];
  if (!hasExactKeys(parsed, keys)) return { ok: false, errors: ['record must have exactly the declared keys'] };
  if (parsed.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  if (!ENTHUSIASM_VALUES.includes(parsed.enthusiasm)) errors.push('enthusiasm is not an allowed value');
  if (!RECEPTION_VALUES.includes(parsed.reception)) errors.push('reception is not an allowed value');
  const headline = text(parsed.headline, SENTIMENT_LIMITS.headlineMax, 'headline', errors);
  const supportPoints = evidenceList(parsed.supportPoints, { max: SENTIMENT_LIMITS.pointsMax, label: 'supportPoints' }, errors);
  const concernPoints = evidenceList(parsed.concernPoints, { max: SENTIMENT_LIMITS.pointsMax, label: 'concernPoints' }, errors);
  const disagreements = [];
  if (!Array.isArray(parsed.disagreements) || parsed.disagreements.length > SENTIMENT_LIMITS.disagreementsMax) {
    errors.push('disagreements must be a list of at most the allowed size');
  } else {
    parsed.disagreements.forEach((item, index) => {
      if (!hasExactKeys(item, ['topic', 'sides'])) { errors.push(`disagreements[${index}] must have exactly topic and sides`); return; }
      disagreements.push({
        topic: text(item.topic, SENTIMENT_LIMITS.topicMax, `disagreements[${index}].topic`, errors),
        sides: evidenceList(item.sides, { min: 2, max: SENTIMENT_LIMITS.sidesMax, label: `disagreements[${index}].sides` }, errors),
      });
    });
  }
  const uncertainties = [];
  if (!Array.isArray(parsed.uncertainties) || parsed.uncertainties.length > SENTIMENT_LIMITS.uncertaintiesMax) {
    errors.push('uncertainties must be a list of at most the allowed size');
  } else {
    parsed.uncertainties.forEach((item, index) => {
      if (!hasExactKeys(item, ['topic', 'evidence'])) { errors.push(`uncertainties[${index}] must have exactly topic and evidence`); return; }
      uncertainties.push({
        topic: text(item.topic, SENTIMENT_LIMITS.topicMax, `uncertainties[${index}].topic`, errors),
        evidence: evidenceList(item.evidence, { min: 1, max: SENTIMENT_LIMITS.uncertaintyEvidenceMax, label: `uncertainties[${index}].evidence` }, errors),
      });
    });
  }
  const evidenceCount = supportPoints.length + concernPoints.length
    + disagreements.reduce((n, d) => n + d.sides.length, 0) + uncertainties.reduce((n, u) => n + u.evidence.length, 0);
  const strong = ['high', 'low'].includes(parsed.enthusiasm) || ['positive', 'negative'].includes(parsed.reception);
  if (strong && evidenceCount === 0) errors.push('a strong rating needs at least one evidence item');
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      schemaVersion: 1, enthusiasm: parsed.enthusiasm, reception: parsed.reception, headline,
      supportPoints, concernPoints, disagreements, uncertainties,
    },
  };
}

// ---- quote check (plan §4.4) -------------------------------------------------------------------

/**
 * Rebuild the discussion's turns from the verified, attribution-resolved content the TXT was produced
 * from, using the formatter's own turn grouping, so labels come from structured data and never from
 * parsing text. Returns null unless formatting that content gives exactly the verified TXT.
 * Each turn is { time, label, text } with the label as the TXT shows it (or null) and the text as the
 * TXT shows it, whitespace normalized.
 */
export function rebuildTurns(discussionContent, speakerNames, transcriptText) {
  const names = speakerNames || {};
  if (formatTranscriptText(discussionContent, names, { layout: 'turn' }) !== transcriptText) return null;
  return groupTranscriptByTurn(discussionContent, names).map((turn) => ({
    time: formatTranscriptTurnTime(turn.start), label: turn.speakerName || null, text: normalizeSpace(turn.text),
    // A real name only: the turn's speaker id has a mapped name and the turn is not shown as unidentified.
    named: Boolean(turn.speakerName) && turn.speakerName !== UNIDENTIFIED
      && Boolean(turn.speaker) && Object.hasOwn(names, turn.speaker) && Boolean(names[turn.speaker]),
  }));
}

/**
 * Attach the speaker to every evidence item from the one turn whose time and text match, or fail.
 * `speaker` is the turn's label only when it is a real name. Returns { ok, value } or { ok: false }.
 */
export function attachSpeakers(record, turns) {
  const resolve = (item) => {
    const quote = normalizeSpace(item.quote);
    const matches = turns.filter((turn) => turn.time === item.time && turn.text.includes(quote));
    if (matches.length !== 1) return null;
    const { label, named } = matches[0];
    return { evidence: { time: item.time, quote: item.quote, speakerLabel: label, speaker: named ? label : null },
      turn: turns.indexOf(matches[0]), quote };
  };
  let failed = false;
  const resolveAll = (items) => items.map((item) => {
    const resolved = resolve(item);
    if (!resolved) failed = true;
    return resolved;
  });
  const plain = (resolved) => resolved.map((entry) => entry?.evidence ?? null);
  const supportPoints = plain(resolveAll(record.supportPoints));
  const concernPoints = plain(resolveAll(record.concernPoints));
  const uncertainties = record.uncertainties.map((u) => ({ topic: u.topic, evidence: plain(resolveAll(u.evidence)) }));
  const disagreements = record.disagreements.map((d) => {
    const sides = resolveAll(d.sides);
    if (!failed && sides.length) {
      // One piece of evidence repeated, or one known person on every side, cannot be a disagreement.
      const keys = sides.map((entry) => `${entry.turn}\u0000${entry.quote}`);
      const speakers = sides.map((entry) => entry.evidence.speaker);
      if (new Set(keys).size !== keys.length || (speakers[0] !== null && speakers.every((name) => name === speakers[0]))) failed = true;
    }
    return { topic: d.topic, sides: plain(sides) };
  });
  const value = { ...record, supportPoints, concernPoints, disagreements, uncertainties };
  return failed ? { ok: false } : { ok: true, value };
}

// ---- currentness (plan §4.4) -------------------------------------------------------------------

/** A run is current when its source artifact, content hash and prompt version equal today's. */
export function isRunCurrent(run, current) {
  return Boolean(run && current && current.sourceArtifactId && current.sourceContentHash && Number.isInteger(current.promptVersion)
    && sameId(run.source_artifact_id, current.sourceArtifactId)
    && run.source_content_hash === current.sourceContentHash
    && Number(run.prompt_version) === current.promptVersion);
}

/** The published sentiment prompt's version, or null; a missing or duplicated prompt is a typed 409. */
export async function loadPromptVersion(dependencies) {
  const prompt = await dependencies.fetchCurrentPrompt(PROMPT_NAME).catch((error) => { throw asSentimentError(error); });
  const promptVersion = Number(prompt?.wmkf_promptversion);
  return Number.isInteger(promptVersion) && promptVersion > 0 ? promptVersion : null;
}

/** The bound discussion transcript's identity and the given prompt version (shape used by isRunCurrent). */
export function currentSourceOf(bound, promptVersion) {
  const row = bound.discussion?.reason === 'bound' ? bound.discussion.staffDiscussionTranscript : null;
  return {
    sourceArtifactId: row?.wmkf_requestdocumentid || null,
    sourceContentHash: row?.wmkf_contenthash || null,
    promptVersion,
  };
}

async function loadCurrent(binding, dependencies) {
  const bound = await bindCurrent(binding.requestId, dependencies);
  return currentSourceOf(bound, await loadPromptVersion(dependencies));
}

export function runDto(row) {
  if (!row) return null;
  return {
    id: row.id, status: row.status, failureCode: row.failure_code || null,
    record: row.status === 'ready' ? row.record : null,
    promptVersion: row.prompt_version == null ? null : Number(row.prompt_version),
    createdAt: row.created_at, completedAt: row.completed_at,
    acceptedAt: row.accepted_at || null, withdrawnAt: row.withdrawn_at || null,
  };
}

// ---- read (the page's per-proposal status) -----------------------------------------------------

/**
 * One request's sentiment state for the page. `state` is one of no_transcript, not_analyzed, analyzing,
 * current, out_of_date. `run` is the result to show (the newest current ready run, else the newest ready
 * run, which is then out of date). `accepted` describes the single accepted, not withdrawn run, if any,
 * without its record. Reads only; never starts an analysis.
 */
export async function getDiscussionSentimentStatus({ requestId, ownerProfileId }, dependencies = DISCUSSION_SENTIMENT_DEPENDENCIES) {
  assertEnabled(requestId, ownerProfileId, null, dependencies, { needsActor: false });
  const binding = await dependencies.loadBinding(requestId);
  const current = await loadCurrent(binding, dependencies);
  if (!current.sourceArtifactId) return { state: 'no_transcript', run: null, runCurrent: false, accepted: null, lastRunFailed: false };
  const { sentiments } = dependencies;
  const [latest, currentReady, latestReady, acceptedRow] = await Promise.all([
    sentiments.getLatestRun({ requestId: binding.requestId }),
    current.promptVersion && current.sourceContentHash
      ? sentiments.getLatestCurrentReadyRun({ requestId: binding.requestId, ...current }) : null,
    sentiments.getLatestReadyRun({ requestId: binding.requestId }),
    sentiments.getAcceptedRun({ requestId: binding.requestId }),
  ]);
  const nowMs = (dependencies.now ? dependencies.now() : new Date()).getTime();
  const analyzing = latest?.status === 'generating'
    && nowMs - new Date(latest.created_at).getTime() < SENTIMENT_GENERATION_ABANDONED_SECONDS * 1000;
  const shown = currentReady || latestReady;
  let state = 'not_analyzed';
  if (analyzing) state = 'analyzing';
  else if (currentReady) state = 'current';
  else if (latestReady) state = 'out_of_date';
  let accepted = null;
  if (acceptedRow) {
    const acceptedByName = await sentiments.getProfileName({ profileId: acceptedRow.accepted_by_profile_id });
    accepted = {
      id: acceptedRow.id, acceptedAt: acceptedRow.accepted_at, acceptedByName: acceptedByName || null,
      current: isRunCurrent(acceptedRow, current),
    };
  }
  return {
    state,
    run: runDto(shown),
    runCurrent: Boolean(currentReady),
    accepted,
    lastRunFailed: Boolean(latest && latest.status === 'failed' && (!shown || new Date(latest.created_at) > new Date(shown.completed_at))),
  };
}

// ---- analyze -----------------------------------------------------------------------------------

/**
 * Analyze one request's bound Staff Discussion Transcript. Throws a typed service error for every
 * refusal; on success returns { run } for the ready row. Nothing is saved unless the record validates
 * and every quote is found in exactly one matching turn.
 */
export async function analyzeDiscussionSentiment({
  requestId, ownerProfileId, actingUserSystemId,
}, dependencies = DISCUSSION_SENTIMENT_DEPENDENCIES) {
  assertEnabled(requestId, ownerProfileId, actingUserSystemId, dependencies);
  const binding = await dependencies.loadBinding(requestId);
  const boundRequestId = binding.requestId;
  const bound = await bindCurrent(boundRequestId, dependencies);
  const loaded = await loadVerifiedDiscussionTranscript(bound, binding, boundRequestId, dependencies)
    .catch((error) => { throw asSentimentError(error); });
  const { discussionRow } = loaded;
  const sourceArtifactId = discussionRow.wmkf_requestdocumentid;
  const sourceContentHash = discussionRow.wmkf_contenthash;
  if (!isGuid(sourceArtifactId || '') || !/^[0-9a-f]{64}$/.test(sourceContentHash || '')) {
    throw materialError('The staff discussion transcript could not be verified.', 'staff_discussion_transcript_integrity_failed', 409);
  }
  if (loaded.utteranceCount === 0) {
    await dependencies.sentiments.recordFailedRun({
      id: dependencies.randomUUID(), requestId: boundRequestId, sourceArtifactId, sourceContentHash,
      promptName: PROMPT_NAME, profileId: ownerProfileId, failureCode: 'staff_discussion_not_recorded',
    });
    throw materialError('No staff discussion was recorded after the presentation ended.', 'staff_discussion_not_recorded', 422);
  }

  // Before any run row or provider call: the structured turns must reproduce the verified TXT exactly.
  const turns = rebuildTurns(loaded.discussionContent, loaded.speakerNames, loaded.transcriptText);
  if (!turns) {
    throw materialError('The staff discussion transcript could not be matched to its source.', 'sentiment_transcript_mismatch', 409);
  }

  const runId = dependencies.randomUUID();
  const reservation = await dependencies.sentiments.reserveRun({
    id: runId, requestId: boundRequestId, sourceArtifactId, sourceContentHash, promptName: PROMPT_NAME, profileId: ownerProfileId,
  });
  if (!reservation?.run) {
    throw materialError('An analysis is already running for this proposal.', 'sentiment_analysis_in_progress', 409);
  }

  // A late terminal write that finds the run no longer 'generating' means it was abandoned and replaced.
  const fail = async (failureCode, error) => {
    const row = await dependencies.sentiments.failRun({ id: runId, failureCode }).catch(() => undefined);
    if (row === null) {
      throw materialError('This analysis was replaced by a newer request.', 'sentiment_run_superseded', 409);
    }
    throw error;
  };

  let result;
  try {
    await dependencies.loadModelOverrides();
    const budget = await dependencies.getExecutorBudget(PROMPT_NAME);
    result = await dependencies.executePrompt({
      promptName: PROMPT_NAME,
      requestId: boundRequestId,
      requireNoPersistence: true,
      auditRetention: 'content-free',
      overrideVariables: { discussion_transcript: loaded.transcriptText },
      runSource: 'Vercel Interactive',
      actingUserSystemId,
      maxTokensOverride: budget.maxTokensOverride,
      timeoutMsOverride: budget.timeoutMsOverride,
    });
    if (result?.blocked) throw Object.assign(new Error('The sentiment prompt was blocked.'), { code: 'sentiment_prompt_blocked' });
  } catch (error) {
    const mapped = EXECUTOR_FAILURES[error?.code];
    await fail(error?.code || 'sentiment_provider_failed', isPromptStoreError(error) ? promptNotReady() : mapped
      ? materialError(mapped[1], `sentiment_${error.code}`, mapped[0])
      : materialError('The analysis could not be run. Try again.', 'sentiment_generation_failed', 502));
  }

  const promptVersion = Number(result?.meta?.promptVersion);
  const validated = validateSentimentOutput(result?.parsed);
  if (!validated.ok || !Number.isInteger(promptVersion) || promptVersion < 1) {
    await fail('sentiment_output_invalid', materialError('The AI provider returned an analysis that could not be used. Try again.', 'sentiment_output_invalid', 502));
  }
  const attached = attachSpeakers(validated.value, turns);
  if (!attached.ok) {
    await fail('sentiment_evidence_unverified', materialError("Couldn't verify the analysis. Try again.", 'sentiment_evidence_unverified', 502));
  }
  const ready = await dependencies.sentiments.completeRun({
    id: runId, record: attached.value, promptName: result.meta?.promptName || PROMPT_NAME, promptVersion,
    model: typeof result.meta?.modelUsed === 'string' ? result.meta.modelUsed : null,
  });
  if (!ready) throw materialError('This analysis was replaced by a newer request.', 'sentiment_run_superseded', 409);
  return { run: runDto(ready) };
}

// ---- accept and withdraw -----------------------------------------------------------------------

/**
 * Accept a ready, current run. Refused with 409 when the run is not ready, is out of date (the
 * transcript or prompt version changed), or was already accepted. Accepting withdraws the previous
 * accepted run in the same transaction.
 */
export async function acceptDiscussionSentiment({ requestId, ownerProfileId, runId }, dependencies = DISCUSSION_SENTIMENT_DEPENDENCIES) {
  assertEnabled(requestId, ownerProfileId, null, dependencies, { needsActor: false });
  const binding = await dependencies.loadBinding(requestId);
  const run = isGuid(runId || '') ? await dependencies.sentiments.getRun({ id: runId, requestId: binding.requestId }) : null;
  if (!run) throw materialError('Analysis not found.', 'sentiment_not_found', 404);
  if (run.status !== 'ready') throw materialError('Only a finished analysis can be accepted.', 'sentiment_not_ready', 409);
  const current = await loadCurrent(binding, dependencies);
  if (!isRunCurrent(run, current)) {
    throw materialError('This analysis is out of date. Analyze again before accepting.', 'sentiment_out_of_date', 409);
  }
  const accepted = await dependencies.sentiments.acceptRun({
    id: run.id, requestId: binding.requestId, profileId: ownerProfileId, expected: current,
  });
  if (accepted?.conflict?.code === 'sentiment_newer_result_accepted') {
    throw materialError('A newer analysis is already accepted. Reload.', 'sentiment_newer_result_accepted', 409);
  }
  if (!accepted) throw materialError('This analysis can no longer be accepted. Reload.', 'sentiment_not_acceptable', 409);
  return { run: runDto(accepted) };
}

/** Withdraw the accepted run. There is no fallback: the request has no accepted analysis afterwards. */
export async function withdrawDiscussionSentiment({ requestId, ownerProfileId, runId }, dependencies = DISCUSSION_SENTIMENT_DEPENDENCIES) {
  assertEnabled(requestId, ownerProfileId, null, dependencies, { needsActor: false });
  const binding = await dependencies.loadBinding(requestId);
  const withdrawn = isGuid(runId || '')
    ? await dependencies.sentiments.withdrawRun({ id: runId, requestId: binding.requestId, profileId: ownerProfileId }) : null;
  if (!withdrawn) throw materialError('This analysis is not accepted. Reload.', 'sentiment_not_accepted', 409);
  return { run: runDto(withdrawn) };
}
