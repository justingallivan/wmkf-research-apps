/**
 * Virtual Review Panel Phase A application service.
 * docs/plans/VIRTUAL_REVIEW_PANEL_PHASE_A_BUILD_PLAN_2026-09-12.md §5 A.1-A.8.
 *
 * Keeps the routes thin (check:route-service-boundary): roster load, launch
 * (selection + rollout assertions + snapshotConfiguration + reservation
 * estimate + run/entry creation), status projection, operator stop, and
 * retry all live here. Entry revisions/runs are shared across active
 * superusers, mirroring cycle-dossier-service.js's own header note — no
 * request input ever supplies identity.
 *
 * Entries cannot be created directly by this service: createReviewPanelEntry
 * (review-panel-store.js) requires the run's CURRENT worker lease, which a
 * route never holds. launchReviewPanel instead resolves and freezes each
 * selected request's input DTO now (so the narrative is captured at launch,
 * not re-fetched later) and parks it in the new run's data.pendingEntries;
 * the worker (review-panel-worker.js's materializePendingEntries) creates the
 * real entry rows under its own lease on its next claim.
 */
import { randomUUID } from 'crypto';
import * as requests from '../dataverse/adapters/grant-request';
import { isGuid } from '../utils/guid';
import { resolveWorkbenchProgramScope } from './workbench/program-scope-service';
import { prepareReviewPanelInput } from './review-panel-input';
import { snapshotConfiguration, estimateReservationCost, ReviewPanelGenerationError } from './review-panel-generation';
import * as store from './review-panel-store';
import { assertReviewPanelStorageConfigured, reviewPanelDigest, readReviewPanelFile } from './review-panel-storage';
import { REVIEW_PANEL_SEATS, getReviewPanelSeatLabel } from '../../shared/config/reviewPanelSeats';
import {
  assertReviewPanelPilotEnabled, assertReviewPanelCohortConfigured, assertReviewPanelRequestAllowed,
  assertReviewPanelModeValid, buildReviewPanelRosterFilter,
} from './review-panel-rollout';

export async function reviewPanelPool(values, fn, limit = 3) {
  const results = new Array(values.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (next < values.length) { const i = next++; results[i] = await fn(values[i], i); }
  }));
  return results;
}

function ids(value, name) {
  if (!Array.isArray(value) || !value.length || value.length > 50 || value.some((v) => !isGuid(v))) {
    throw store.reviewPanelError(`Invalid ${name}.`, 400);
  }
  return [...new Set(value.map((v) => v.toLowerCase()))].sort();
}
function guid(value, name) { if (!isGuid(value)) throw store.reviewPanelError(`Invalid ${name}.`, 400); return value; }

/** Same server-scoped Research roster and selection model as the dossier (A.2), with NO cycle restriction (D5). */
export async function loadReviewPanelRoster() {
  assertReviewPanelPilotEnabled();
  assertReviewPanelCohortConfigured();
  const programScope = await resolveWorkbenchProgramScope({});
  const result = await requests.queryAllRequests({
    select: 'akoya_requestid,akoya_requestnum,akoya_title,akoya_requeststatus,_akoya_applicantid_value,_wmkf_projectleader_value,_wmkf_programdirector_value',
    filter: buildReviewPanelRosterFilter(programScope.programId),
    orderby: 'akoya_requestnum asc',
  });
  if (result.capped || !Array.isArray(result.records)) throw store.reviewPanelError('The review panel roster list is incomplete. Please retry.', 503);
  return result.records
    .map((r) => ({
      requestId: r.akoya_requestid.toLowerCase(), requestNumber: r.akoya_requestnum,
      title: r.akoya_title || '', institution: r._akoya_applicantid_value_formatted || '',
      pi: r._wmkf_projectleader_value_formatted || '', programDirector: r._wmkf_programdirector_value_formatted || 'Unassigned',
    }))
    .filter((item) => {
      try { assertReviewPanelRequestAllowed(item); return true; }
      catch (error) { if (error.httpStatus === 403) return false; throw error; }
    });
}

const ENABLED_SEATS = REVIEW_PANEL_SEATS.filter((s) => s.enabled);

/** Per-seat detail for one entry, derived from that entry's attempts (latest attempt_no wins per seat). Never carries usage tokens or prompt snapshots — `attempts` rows only ever have the explicit columns listEntryAttempts selects. */
function projectEntrySeats(entryId, attemptsByEntryAndSeat) {
  return ENABLED_SEATS.map((seat) => {
    const attempt = attemptsByEntryAndSeat.get(`${entryId}::${seat.key}`);
    if (!attempt) {
      return { seatKey: seat.key, label: getReviewPanelSeatLabel(seat.key), provider: null, model: null, state: 'pending', costCents: null, costState: null, error: null };
    }
    return {
      seatKey: seat.key,
      label: getReviewPanelSeatLabel(seat.key),
      provider: attempt.provider || null,
      model: attempt.model || null,
      state: attempt.state,
      costCents: attempt.cost_cents == null ? null : Number(attempt.cost_cents),
      costState: attempt.cost_state || null,
      error: attempt.error_text || null,
    };
  });
}

const TERMINAL_ATTEMPT_STATES = new Set(['completed', 'failed', 'unknown_outcome']);
const TERMINAL_ATTEMPT_STATE_VERB = { completed: 'completed', failed: 'failed', unknown_outcome: 'ended with an unknown outcome' };
const CHAIR_SEAT_KEY = 'chair';

/**
 * Compact per-run operator timeline for the Progress tab — built ONLY from
 * data this projection already reads (row/entries/attempts); no new query.
 * Never carries usage tokens or prompt text, matching the seats projection's
 * own privacy bar. Sorted ascending (oldest first / newest last), since the
 * page renders it newest-last per the build plan.
 */
function buildReviewPanelTimeline(row, entries, attempts) {
  const events = [];
  if (row.created_at) events.push({ at: row.created_at, label: 'Launched' });

  const dispatchedAts = attempts.map((a) => a.dispatched_at).filter(Boolean);
  if (dispatchedAts.length) {
    const earliest = dispatchedAts.reduce((min, at) => (new Date(at) < new Date(min) ? at : min));
    events.push({ at: earliest, label: 'Worker picked up the run' });
  }

  // Same "latest attempt_no wins per seat" rule as projectEntrySeats, but kept
  // as a separate pass here since the timeline needs the full attempt row
  // (dispatched_at/updated_at), not the seats projection's public shape.
  const latestByEntryAndSeat = new Map();
  attempts.forEach((a) => latestByEntryAndSeat.set(`${a.entry_id}::${a.seat_key}`, a));
  for (const attempt of latestByEntryAndSeat.values()) {
    // The chair's own dispatch (seats-done → synthesis-started) is the one
    // dispatch worth surfacing beyond the run-wide earliest: it is usually a
    // reviewer seat's, not the chair's, so the chair would otherwise never
    // appear until it finishes.
    if (attempt.seat_key === CHAIR_SEAT_KEY && attempt.dispatched_at) {
      events.push({ at: attempt.dispatched_at, label: 'Chair dispatched' });
    }
    if (!TERMINAL_ATTEMPT_STATES.has(attempt.state) || !attempt.updated_at) continue;
    const label = getReviewPanelSeatLabel(attempt.seat_key);
    events.push({ at: attempt.updated_at, label: `${label} ${TERMINAL_ATTEMPT_STATE_VERB[attempt.state]}` });
  }

  for (const entry of entries) {
    const hasFiles = Boolean(entry.data?.files?.docx && entry.data?.files?.pdf);
    if (hasFiles && entry.status === 'completed' && entry.updated_at) {
      events.push({ at: entry.updated_at, label: 'Edition completed' });
    }
    // Visible immediately on the operator's own retry/re-render click,
    // independent of the worker's next pass (which is the only thing that
    // ever clears it) — the owner-reported gap was exactly this: no retry
    // signal in the timeline until the run itself later changed state.
    // data.rerender distinguishes a re-render request (completed entry, no
    // model calls) from an ordinary failed-entry retry — same marker column,
    // different labels, so an operator watching the timeline never confuses
    // "re-deriving the saved reviews' document" with "re-running the panel".
    if (entry.retry_requested_at) {
      events.push({ at: entry.retry_requested_at, label: entry.data?.rerender ? 'Re-render requested' : 'Retry requested' });
    }
    // "Report saved" mirrors "Edition completed"'s own condition (both
    // editions present, entry settled) but is kept as its own, differently
    // worded event: "Edition completed" already existed before this change,
    // while "Report saved" is the signal an operator watching a RETRY or
    // re-render specifically needs. Prefers the later of the two saved
    // files' own `savedAt` stamps (set by completeEntryWithReport) when
    // present — the exact moment THIS edition landed, which for a
    // re-rendered entry is well after entry.updated_at's last unrelated
    // write; falls back to entry.updated_at, then the run's own updated_at,
    // and is omitted entirely (never invented) if none exist.
    if (hasFiles && entry.status === 'completed') {
      const savedAts = [entry.data.files.docx?.savedAt, entry.data.files.pdf?.savedAt].filter(Boolean);
      const latestSavedAt = savedAts.length ? savedAts.reduce((max, at) => (new Date(at) > new Date(max) ? at : max)) : null;
      const at = latestSavedAt || entry.updated_at || row.updated_at;
      if (at) events.push({ at, label: 'Report saved' });
    }
  }

  return events.sort((a, b) => new Date(a.at) - new Date(b.at));
}

export function projectReviewPanelRun(row, entries = [], attempts = []) {
  const attemptsByEntryAndSeat = new Map(); // ordered attempt_no ASC in: last write per key is the latest attempt
  attempts.forEach((a) => attemptsByEntryAndSeat.set(`${a.entry_id}::${a.seat_key}`, a));
  return {
    id: row.id,
    status: row.status,
    createdAt: row.created_at,
    reservation: row.data?.reservation || null, // reservation BOUND only (D6) — never a "typical cost" figure
    error: row.data?.error || null,
    failures: row.data?.failures || [], // requests that could not be prepared at launch (no entry row exists for these)
    timeline: buildReviewPanelTimeline(row, entries, attempts),
    entries: entries.map((e) => ({
      id: e.id,
      requestId: e.request_id,
      requestNumber: e.data?.input?.requestNumber || e.data?.requestNumber || null,
      status: e.status,
      error: e.data?.error || null,
      revision: e.request_revision,
      hasReport: Boolean(e.data?.files?.docx && e.data?.files?.pdf),
      retryRequested: Boolean(e.retry_requested_at),
      // Present only while a re-render request is outstanding (cleared by
      // the worker's rerenderCompletedEntries once it clears data.rerender —
      // requestReviewPanelRerender never touches data.files, so hasReport
      // and the current DOCX/PDF links stay live and correct for the ENTIRE
      // wait; only the worker's own successful atomic swap ever replaces
      // them).
      rerender: e.data?.rerender ? { requestedAt: e.data.rerender.requestedAt } : null,
      // Count only — the superseded refs themselves never reach the client.
      // Appended (never overwritten) by completeEntryWithReport's rerender
      // mode on every successful swap.
      rerenderCount: Array.isArray(e.data?.rerenderHistory) ? e.data.rerenderHistory.length : 0,
      seats: projectEntrySeats(e.id, attemptsByEntryAndSeat),
    })),
  };
}

/** Fetches this run's entries and their attempts (one batched query, never N+1) and projects them together. */
async function projectRun(run) {
  const entries = await store.listReviewPanelEntries(run.id);
  const attempts = await store.listEntryAttempts(entries.map((e) => e.id));
  return projectReviewPanelRun(run, entries, attempts);
}

async function projectRunsWithEntries(runs) {
  return reviewPanelPool(runs, async (run) => projectRun(run));
}

export async function getReviewPanelPage(owner) {
  await store.assertReviewPanelAccess(owner);
  assertReviewPanelPilotEnabled();
  const [panel, roster, runs, control] = await Promise.all([
    store.createReviewPanel(owner), loadReviewPanelRoster(), store.listReviewPanelRuns(owner), store.readReviewPanelControl(),
  ]);
  let configuration;
  try {
    const config = await snapshotConfiguration();
    configuration = {
      ready: true,
      seats: Object.values(config.seats).map((s) => ({ seatKey: s.seatKey, provider: s.provider, model: s.model })),
      chair: { provider: config.chair.provider, model: config.chair.model },
      reservationPerEntry: estimateReservationCost(config, 1), // reservation BOUND only (D6)
    };
  } catch (error) {
    console.warn('[review-panel] configuration not ready', { code: error.code, message: error.message });
    configuration = {
      ready: false,
      error: error.httpStatus ? error.message : 'Published review panel prompts are not ready. Check Admin configuration.',
      reason: error instanceof ReviewPanelGenerationError ? error.message : null,
      code: error.code || null,
    };
  }
  // Surfaced so the page can mirror the server's own smoke-mode launch rule
  // (exactly one selection) — never thrown here even on an invalid mode, so
  // a misconfigured rollout doesn't also break the read-only status page.
  configuration.mode = (() => { try { return assertReviewPanelModeValid(); } catch { return null; } })();
  return {
    panel: { id: panel.id, selection: panel.selection || [] },
    candidates: roster,
    runs: await projectRunsWithEntries(runs),
    configuration,
    control: control ? { stopRequested: !!control.stop_requested, reason: control.reason || null, updatedAt: control.updated_at || null } : null,
  };
}

export async function launchReviewPanel(owner, body) {
  await store.assertReviewPanelAccess(owner);
  assertReviewPanelPilotEnabled();
  // Fail closed BEFORE creating the run (never after) when the D11 dedicated
  // Blob store isn't fully configured — mirrors
  // scripts/check-cycle-dossier-rollout.js's blob readiness check (both the
  // token AND the store id are required). Every entry this run creates will
  // need this store to save its report at completion time; a run whose
  // editions can never be saved should never be authorized to spend in the
  // first place.
  assertReviewPanelStorageConfigured();
  const selected = ids(body.selectedRequestIds, 'selection');
  const idempotencyKey = guid(body.idempotencyKey, 'launch key');
  if (assertReviewPanelModeValid() === 'smoke' && selected.length !== 1) {
    throw store.reviewPanelError('Smoke mode requires exactly one allowlisted request.', 400);
  }
  const roster = await loadReviewPanelRoster();
  const byId = new Map(roster.map((r) => [r.requestId, r]));
  if (selected.some((id) => !byId.has(id))) throw store.reviewPanelError('The review panel roster changed. Refresh the selection.');

  const replay = await store.findReviewPanelLaunch(owner, idempotencyKey);
  if (replay) {
    return { run: await projectRun(replay) };
  }

  const config = await snapshotConfiguration();
  const prepared = await reviewPanelPool(selected, async (requestId) => {
    const info = byId.get(requestId);
    try {
      const input = await prepareReviewPanelInput(requestId, { requestNumber: info?.requestNumber });
      return { requestId, requestNumber: info.requestNumber, input, ok: true };
    } catch (error) {
      return { requestId, requestNumber: info?.requestNumber, ok: false, error: error.httpStatus ? error.message : 'The exact Proposal Narrative could not be prepared.' };
    }
  });
  const pendingEntries = prepared.filter((p) => p.ok).map((p) => ({ requestId: p.requestId, requestNumber: p.requestNumber, input: p.input }));
  const failures = prepared.filter((p) => !p.ok).map((p) => ({ requestId: p.requestId, requestNumber: p.requestNumber, error: p.error }));
  if (!pendingEntries.length) throw store.reviewPanelError('None of the selected requests could be prepared.', 422);

  const reservation = estimateReservationCost(config, pendingEntries.length); // reservation BOUND only (D6): no "typical cost" figure is ever surfaced
  const launchHash = reviewPanelDigest({ selected, idempotencyKey });
  const panel = await store.createReviewPanel(owner);
  await store.saveReviewPanelSelection(owner, selected);
  const run = await store.createReviewPanelRun({
    owner, panelId: panel.id, idempotencyKey, launchHash,
    data: { config, pendingEntries, failures, reservation },
  });
  return { run: await projectRun(run) };
}

export async function controlReviewPanel(owner, body) {
  await store.assertReviewPanelAccess(owner);
  if (body.action === 'operator-stop') {
    const control = await store.setReviewPanelOperatorStop(owner, body.stop !== false, body.reason || null);
    return { control: { stopRequested: control.stop_requested, reason: control.reason || null, updatedAt: control.updated_at } };
  }
  // Retry/rerender resolve their own run from entryIds server-side (never
  // from client input — production defect 2026-09-13: the page always sent
  // its OWN idea of "the latest run", which need not be the run an already-
  // completed or already-failed entry actually belongs to); only 'stop'
  // (which targets a whole run with no entries of its own) still needs a
  // client-supplied runId.
  if (body.action === 'retry') {
    const entryIds = ids(body.entryIds, 'entry selection');
    const run = await store.requestReviewPanelRetry(owner, entryIds);
    return { run: await projectRun(run) };
  }
  if (body.action === 'stop') {
    const runId = guid(body.runId, 'run');
    const row = await store.requestReviewPanelCancel(runId, owner);
    return { run: await projectRun(row) };
  }
  if (body.action === 'rerender') {
    const entryIds = ids(body.entryIds, 'entry selection');
    const run = await store.requestReviewPanelRerender(owner, entryIds);
    return { run: await projectRun(run) };
  }
  throw store.reviewPanelError('Unknown run action.', 400);
}

export async function reviewPanelAction(owner, body) {
  if (body.action === 'launch') return launchReviewPanel(owner, body);
  if (['operator-stop', 'stop', 'retry', 'rerender'].includes(body.action)) return controlReviewPanel(owner, body);
  throw store.reviewPanelError('Unknown review panel action.', 400);
}

export async function downloadReviewPanel(owner, query) {
  await store.assertReviewPanelAccess(owner);
  if (!['docx', 'pdf'].includes(query.format)) throw store.reviewPanelError('Choose a document format.', 400);
  const entry = await store.readReviewPanelEntry(guid(query.entryId, 'entry'));
  if (!entry) throw store.reviewPanelError('Entry not found.', 404);
  const ref = entry.data?.files?.[query.format];
  if (!ref) throw store.reviewPanelError('Saved document is unavailable.', 404);
  assertReviewPanelStorageConfigured();
  const bytes = await readReviewPanelFile(ref);
  const requestNumber = entry.data?.input?.requestNumber || entry.data?.requestNumber || entry.request_id;
  return { bytes, contentType: ref.contentType, filename: `ReviewPanel-${requestNumber}-v${entry.request_revision}.${query.format}` };
}
