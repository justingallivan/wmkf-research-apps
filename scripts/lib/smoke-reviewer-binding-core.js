/**
 * Pure, unit-testable safety logic for scripts/smoke-reviewer-binding.js.
 *
 * The smoke runner performs real production writes, so every guard that keeps
 * it narrow lives here where CI can pin it without live state: the frozen job
 * payload shape (repeat + opted-out + no board identity), the whole-second
 * event timestamp, the clean-init precondition, the Wave 13 binding assertion
 * set (a legacy-fallback pass must FAIL), and the no-cleanup-while-active rule.
 *
 * Contract sources: docs/REVIEWER_HOLISTIC_REVIEW_IMPLEMENTATION_PLAN.md and
 * the adversarial-review smoke contract
 * (outputs/reviewer-identity-binding-production-smoke-adversarial-review-2026-07-13.md §9).
 */

import {
  IDENTITY_LINEAGE_FIELDS,
  normalizeIdentityTimestamp,
} from '../../lib/services/reviewer-identity-binding-contract.js';
import { REVIEWER_ACCEPTANCE_JOB_TERMINAL_STATUSES } from '../../lib/services/reviewer-acceptance-job-service.js';

export const SMOKE_SOURCE_TAG = 'smoke-reviewer-binding';

const BINDING_FIELDS = Object.freeze([
  'wmkf_identitybindingversion',
  'wmkf_identitybindingsource',
  'wmkf_identitybindinganchor',
  'wmkf_identityboundat',
  'wmkf_identityderivedbindingversion',
  'wmkf_identityfieldlineagejson',
]);

/**
 * Floor a date to the whole second, in the canonical millisecond ISO form
 * (`….000Z`). Dataverse DateTime columns drop fractional seconds, so the
 * event identity must be a whole second for the stored binding to round-trip
 * as an exact replay.
 */
export function wholeSecondIso(date = new Date()) {
  const ms = date instanceof Date ? date.getTime() : Date.parse(String(date));
  if (!Number.isFinite(ms)) throw new Error('wholeSecondIso: unparseable date');
  return new Date(Math.floor(ms / 1000) * 1000).toISOString();
}

export function isWholeSecondIso(value) {
  const normalized = normalizeIdentityTimestamp(value);
  return typeof normalized === 'string' && normalized.endsWith('.000Z');
}

/** Compare two timestamps at second granularity (Dataverse storage fidelity). */
export function secondEqual(left, right) {
  const l = Date.parse(String(left));
  const r = Date.parse(String(right));
  if (!Number.isFinite(l) || !Number.isFinite(r)) return false;
  return Math.floor(l / 1000) === Math.floor(r / 1000);
}

export function buildSmokeKey(now = new Date()) {
  return `${SMOKE_SOURCE_TAG}-${now.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`;
}

/**
 * Frozen job-staging arguments for the smoke event. Invariants:
 * - `isAcceptRepeat: true` — the drain skips the acceptance-confirmation email
 *   and quota notification while still executing the binding step;
 * - `optedOut: true` — honorarium onboarding never runs;
 * - `body` carries NO `boardIdentity` key — the board-identity capture returns
 *   `skipped: nothing_to_write` (no person write, no failure alert);
 * - `status: 'queued'` — the accepted state must already be visible in
 *   Dataverse BEFORE this job is staged, or the drain retries then fails;
 * - `acceptedAt` must be a whole second (see wholeSecondIso).
 */
export function buildSmokeJobArgs({ acceptanceKey, acceptedAt, suggestion, request, reviewer, orcid }) {
  if (!acceptanceKey) throw new Error('buildSmokeJobArgs: acceptanceKey required');
  if (!isWholeSecondIso(acceptedAt)) {
    throw new Error('buildSmokeJobArgs: acceptedAt must be a whole-second canonical UTC timestamp');
  }
  if (!suggestion?.wmkf_appreviewersuggestionid) throw new Error('buildSmokeJobArgs: suggestion row required');
  if (!reviewer?.wmkf_potentialreviewersid) throw new Error('buildSmokeJobArgs: reviewer row required');
  if (!orcid) throw new Error('buildSmokeJobArgs: orcid required');
  return {
    acceptanceKey,
    acceptedAt,
    suggestion,
    request: request || null,
    reviewer,
    body: { honorariumOptOut: true },
    acks: null,
    isAcceptRepeat: true,
    optedOut: true,
    acceptedSuggestion: suggestion,
    acceptOrcidRaw: orcid,
    status: 'queued',
  };
}

/**
 * Clean-init precondition: the person row must be fully unbound with no legacy
 * identity values, so the writer takes the `init` path rather than the typed
 * `legacy_classification_required` fallback (which would make the smoke prove
 * the wrong path).
 */
export function assertCleanInitRow(row) {
  const problems = [];
  if (!row || typeof row !== 'object') return { ok: false, problems: ['person binding row missing'] };
  for (const field of BINDING_FIELDS) {
    if (row[field] !== null && row[field] !== undefined) {
      problems.push(`${field} is already populated (${JSON.stringify(row[field])})`);
    }
  }
  for (const field of IDENTITY_LINEAGE_FIELDS) {
    if (row[field] !== null && row[field] !== undefined) {
      problems.push(`legacy identity field ${field} is populated — init would be blocked as legacy_classification_required`);
    }
  }
  return { ok: problems.length === 0, problems };
}

/**
 * The positive-control assertion set. A run in which only the transitional
 * legacy writes happened (person ORCID + confirmed status, binding fields
 * null) MUST fail here — that is the false-confidence mode this smoke exists
 * to rule out.
 */
export function assertWave13Binding(person, { orcid, acceptedAt }) {
  const problems = [];
  if (!person || typeof person !== 'object') return { ok: false, problems: ['person row missing'] };

  if (person.wmkf_identitybindingversion === null || person.wmkf_identitybindingversion === undefined) {
    const legacyPopulated = person.wmkf_orcid ? ' (legacy ORCID fields are populated — the transitional fallback ran instead of the durable writer)' : '';
    problems.push(`wmkf_identitybindingversion is null — no durable binding committed${legacyPopulated}`);
    return { ok: false, problems };
  }
  if (person.wmkf_identitybindingversion !== 1) {
    problems.push(`wmkf_identitybindingversion=${person.wmkf_identitybindingversion}, expected 1 (a retried event identity is not replaying as a no-op)`);
  }
  if (person.wmkf_identitybindingsource !== 'self_reported') {
    problems.push(`wmkf_identitybindingsource=${JSON.stringify(person.wmkf_identitybindingsource)}, expected 'self_reported'`);
  }
  if (person.wmkf_identitybindinganchor !== `orcid:${orcid}`) {
    problems.push(`wmkf_identitybindinganchor=${JSON.stringify(person.wmkf_identitybindinganchor)}, expected 'orcid:${orcid}'`);
  }
  if (!secondEqual(person.wmkf_identityboundat, acceptedAt)) {
    problems.push(`wmkf_identityboundat=${JSON.stringify(person.wmkf_identityboundat)} does not match acceptedAt=${acceptedAt} at second precision`);
  }
  if (person.wmkf_identityderivedbindingversion !== null && person.wmkf_identityderivedbindingversion !== undefined) {
    problems.push(`wmkf_identityderivedbindingversion=${person.wmkf_identityderivedbindingversion}, expected null for a human binding`);
  }

  let lineage = null;
  try {
    lineage = JSON.parse(person.wmkf_identityfieldlineagejson);
  } catch {
    problems.push('wmkf_identityfieldlineagejson is missing or not valid JSON');
  }
  if (lineage) {
    const expected = {
      schemaVersion: 1,
      fields: {
        wmkf_orcid: { source: 'self_reported', bindingVersion: 1 },
        wmkf_orcidurl: { source: 'self_reported', bindingVersion: 1 },
      },
    };
    if (JSON.stringify(lineage) !== JSON.stringify(expected)) {
      problems.push(`lineage JSON ${person.wmkf_identityfieldlineagejson} != expected ${JSON.stringify(expected)}`);
    }
  }

  if (person.wmkf_orcid !== orcid) {
    problems.push(`wmkf_orcid=${JSON.stringify(person.wmkf_orcid)}, expected ${orcid}`);
  }
  if (person.wmkf_orcidurl !== `https://orcid.org/${orcid}`) {
    problems.push(`wmkf_orcidurl=${JSON.stringify(person.wmkf_orcidurl)}, expected canonical pair URL`);
  }
  if (person.wmkf_identitystatus !== 'confirmed') {
    problems.push(`wmkf_identitystatus=${JSON.stringify(person.wmkf_identitystatus)}, expected 'confirmed'`);
  }
  if (person.wmkf_identityconfidenceband !== 'high') {
    problems.push(`wmkf_identityconfidenceband=${JSON.stringify(person.wmkf_identityconfidenceband)}, expected 'high'`);
  }
  if (person.wmkf_identityresolverversion !== 'self-report@accept') {
    problems.push(`wmkf_identityresolverversion=${JSON.stringify(person.wmkf_identityresolverversion)}, expected 'self-report@accept'`);
  }
  if (!secondEqual(person.wmkf_identityresolvedat, acceptedAt)) {
    problems.push(`wmkf_identityresolvedat=${JSON.stringify(person.wmkf_identityresolvedat)} does not match acceptedAt at second precision`);
  }
  return { ok: problems.length === 0, problems };
}

/**
 * Job-outcome assertion: completed, and the acceptance-confirmation step was
 * never claimed (proves the repeat-accept email/quota exclusion actually held).
 */
export function assertJobOutcome(job) {
  const problems = [];
  if (!job) return { ok: false, problems: ['job row missing'] };
  if (job.status !== 'completed') {
    problems.push(`job status=${JSON.stringify(job.status)}, expected 'completed' (last_error=${JSON.stringify(job.last_error)})`);
  }
  const steps = typeof job.steps === 'string' ? JSON.parse(job.steps || '{}') : (job.steps || {});
  if (steps.acceptance_confirmation) {
    problems.push(`steps.acceptance_confirmation is present (${JSON.stringify(steps.acceptance_confirmation)}) — the email step engaged on a repeat-accept smoke`);
  }
  return { ok: problems.length === 0, problems };
}

/** Cleanup is only legal once the job can no longer be claimed by the cron. */
export function canCleanup(job) {
  return Boolean(job && REVIEWER_ACCEPTANCE_JOB_TERMINAL_STATUSES.includes(job.status));
}

/**
 * Parse the population counts out of the preflight script's stdout, e.g.
 * `  wmkf_potentialreviewers: 3 row(s) with any Wave 13 field non-null.`
 * Returns null when the snapshot section is absent.
 */
export function parsePopulationCounts(stdout) {
  const counts = {};
  const re = /^\s*(wmkf_[a-z]+):\s+(\d+)\s+row\(s\) with any Wave 13 field non-null\./gm;
  let match;
  while ((match = re.exec(String(stdout))) !== null) {
    counts[match[1]] = Number(match[2]);
  }
  return Object.keys(counts).length > 0 ? counts : null;
}
