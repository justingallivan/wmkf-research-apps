/** Memory-only private assessment queue. One immutable request at a time; no shared actions. */
import { createOperationId, loadProposalRanking, sendProposalRankingAction } from './client';

const copy = (value) => JSON.parse(JSON.stringify(value));
function equal(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const keys = Object.keys(a).sort();
  return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && equal(a[key], b[key]));
}
const content = (list) => list && ({ order: list.order, boundaries: list.boundaries, confidence: list.confidence });
const ownShape = (own) => own && ({
  ...Object.fromEntries(['mr', 'se', 'co'].map(key => [key, own[key] && {
    ...content(own[key]), version: own[key].version,
    ...(key === 'co' ? { sourceVersions: own.co.sourceVersions, confirmed: own.co.confirmed } : {}),
  }])),
  ready: own.ready ?? null,
});
export function projectedPrivateOwn(own, program, draft) {
  if (!draft) return own;
  const next = copy(own);
  next[program] = { ...next[program], ...content(draft), version: next[program].version + 1 };
  if (next.co) next.co.confirmed = false;
  return next;
}
function sameScope(a, b) {
  return a?.roundId === b?.roundId && a?.viewer?.systemUserId === b?.viewer?.systemUserId
    && b?.round?.state === 'active' && a.round.policyRevision === b.round.policyRevision
    && b?.workflow?.stage === 'private' && a.workflow.preparationVersion === b.workflow.preparationVersion
    && a.workflow.revealId === b.workflow.revealId;
}
function editable(view, program) {
  return ['mr', 'se', 'co'].includes(program) && view?.round?.state === 'active'
    && view.workflow.stage === 'private' && view.own?.[program] && !view.own.ready
    && (program !== 'co' || (view.own.co.sourceVersions.mr === view.own.mr.version
      && view.own.co.sourceVersions.se === view.own.se.version));
}
const REJECTED = new Set(['stale_scope', 'conflict', 'confirmation_stale', 'stale_list', 'invalid_assessment', 'invalid_transition', 'round_closed', 'invalid_request']);
function failureKind(error) {
  if ([401, 403].includes(error.status)) return 'auth';
  if (error.code === 'operation_id_reused') return 'integrity';
  if (error.requestMethod === 'POST' && error.status >= 400 && error.status < 500 && REJECTED.has(error.code)) return 'rejected';
  return 'uncertain';
}
export const EMPTY_PRIVATE_SAVE = { draft: null, program: null, saving: false, blocked: null };

export function createPrivateSaveQueue({ onChange, onView, onAuthLost, send = sendProposalRankingAction, load = loadProposalRanking, timeoutMs = 30000 }) {
  let active = true, epoch = 0, revision = 0, base = null, flight = null;
  let state = { ...EMPTY_PRIVATE_SAVE };
  const dirty = () => Boolean(state.draft || state.saving || state.blocked);
  const emit = () => { if (active) onChange({ ...state }); };
  const block = (kind, error, job) => {
    state = { ...state, saving: false, blocked: { kind, message: error.message, job } };
    emit();
  };
  async function timed(run) {
    const controller = new AbortController();
    let timer;
    try {
      return await Promise.race([
        run(controller.signal),
        new Promise((_, reject) => { timer = setTimeout(() => {
          controller.abort(); reject(new Error('Saving took too long. Check the result before continuing.'));
        }, timeoutMs); }),
      ]);
    } finally { clearTimeout(timer); }
  }
  function expected(job) {
    return projectedPrivateOwn(job.base.own, job.request.programKey, job.request.assessment);
  }
  function accepted(job, next) {
    return sameScope(job.base, next) && equal(ownShape(expected(job)), ownShape(next.own));
  }
  async function dispatch(job, replay = false) {
    const scopeEpoch = epoch;
    flight = job;
    state = { ...state, saving: true, blocked: null };
    emit();
    try {
      const next = await timed(signal => send(job.request, {
        signal, ...(replay ? {} : { baseView: job.base }),
        onAttempt: request => { if (active && epoch === scopeEpoch) job.request = copy(request); },
      }));
      if (!active || epoch !== scopeEpoch) return;
      if (next?.operation?.status !== 'confirmed' || next.operation.operationId !== job.request.operationId) {
        block('uncertain', new Error('The save response did not confirm this operation. Check its result before continuing.'), job);
        return;
      }
      if (!accepted(job, next)) {
        block('changed', new Error('Saved work changed in another tab or the round changed. Review the saved version before continuing.'), job);
        return;
      }
      base = next; // Keep the server object for transport's unchanged-own comparison.
      onView(next);
      state = { ...state, saving: false };
      if (revision === job.revision || equal(content(state.draft), content(base.own[state.program]))) {
        state = { ...EMPTY_PRIVATE_SAVE };
        emit();
      } else {
        flight = null;
        drain();
      }
    } catch (error) {
      if (!active || epoch !== scopeEpoch) return;
      if (error.pendingAction) job.request = copy(error.pendingAction);
      const kind = failureKind(error);
      if (kind === 'auth') {
        epoch++; state = { ...EMPTY_PRIVATE_SAVE }; emit(); onAuthLost();
      } else block(kind, error, job);
    } finally {
      if (flight === job) flight = null;
    }
  }
  function drain() {
    if (!active || flight || state.saving || state.blocked || !state.draft) return;
    if (equal(content(state.draft), content(base.own[state.program]))) {
      state = { ...EMPTY_PRIVATE_SAVE }; emit(); return;
    }
    const request = {
      action: 'saveAssessment', roundId: base.roundId, operationId: createOperationId(),
      roundEtag: base.round.etag, policyRevision: base.round.policyRevision,
      preparationVersion: base.workflow.preparationVersion, revealId: base.workflow.revealId,
      programKey: state.program, listVersion: base.own[state.program].version,
      assessment: copy(content(state.draft)),
    };
    void dispatch({ request, base, revision });
  }
  async function reload(discard) {
    if (state.saving || flight || !state.blocked) return;
    const blocked = state.blocked;
    const scopeEpoch = epoch;
    state = { ...state, saving: true }; emit();
    try {
      const next = await timed(signal => load({ roundId: blocked.job.base.roundId, signal }));
      if (!active || scopeEpoch !== epoch) return;
      if (discard) {
        base = next; state = { ...EMPTY_PRIVATE_SAVE }; onView(next); emit();
      } else if (sameScope(blocked.job.base, next) && equal(ownShape(blocked.job.base.own), ownShape(next.own))) {
        base = next; onView(next); state = { ...state, saving: false, blocked: null }; drain();
      } else block('changed', new Error('Your saved preparation or round has changed. Automatic retry would replace newer work.'), blocked.job);
    } catch (error) {
      if (!active || scopeEpoch !== epoch) return;
      if ([401, 403].includes(error.status)) {
        epoch++; state = { ...EMPTY_PRIVATE_SAVE }; emit(); onAuthLost();
      } else block(blocked.kind, error, blocked.job);
    }
  }
  return {
    isDirty: dirty,
    activate() { active = true; emit(); },
    dispose() {
      active = false; epoch++;
      const interrupted = flight || state.blocked?.job;
      if (state.saving && interrupted) state = { ...state, saving: false,
        blocked: { kind: 'uncertain', message: 'Saving was interrupted. Check the result before continuing.', job: interrupted } };
      flight = null;
    },
    edit(view, program, update) {
      if (!active || state.blocked || !editable(view, program)) return;
      if (dirty() && (state.program !== program || !sameScope(base, view))) return;
      // A click can precede React rendering the acknowledgement. Never replace a
      // newer acknowledged list with that older render; fresh external views still win.
      if (!dirty() && !(base && sameScope(base, view)
        && base.own?.[program]?.version > view.own[program].version)) base = view;
      const current = state.draft || base.own[program];
      const next = typeof update === 'function' ? update(current) : update;
      if (equal(content(current), content(next))) return;
      revision++;
      state = { ...state, program, draft: copy(content(next)) };
      emit(); drain();
    },
    retry() {
      if (!active || state.saving || flight || !state.blocked) return;
      if (state.blocked.kind === 'uncertain') void dispatch({ ...state.blocked.job, request: copy(state.blocked.job.request) }, true);
      else if (state.blocked.kind === 'rejected') void reload(false);
    },
    discard() { // Caller must confirm. Uncertain operations must be resolved first.
      if (!active || state.blocked?.kind === 'uncertain' || state.blocked?.kind === 'integrity') return;
      void reload(true);
    },
  };
}
