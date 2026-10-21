/**
 * ReviewQuestionsSection — the superuser editor for the external-reviewer review
 * question set (Dataverse wmkf_reviewquestion). Phase C of the
 * staff-editable-questions epic.
 *
 * A variable-length COLLECTION editor (the structural difference from the
 * fixed-field admin sections): add / remove / drag-to-reorder rows, inline edit
 * of text / type / required / hint / max-length / picklist options. It POSTs the
 * FULL ordered set to /api/admin/review-questions, which diffs by row id and
 * applies one atomic Dataverse changeset.
 *
 * Key immutability: an EXISTING question's key is the join to reviewer answers,
 * so it renders read-only. Only NEW rows expose an editable key. The server is
 * the authority — it rejects any key change on an existing id.
 *
 * Optimistic concurrency: the GET hands back a `version`; the save echoes it as
 * `baseVersion`. If another superuser saved meanwhile the POST returns 409
 * set_changed and we prompt a reload (drag/edit state is discarded — the live
 * set won).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { requestEnvelope } from '../../utils/api-request';
import ReviewQuestionRowEditor, { isOptionType } from './ReviewQuestionRowEditor';

// Editable-row shape (UI). maxLength/hint kept as strings for controlled inputs;
// the POST mapper coerces. New rows carry id:null and an editable key.
function toEditable(q) {
  return {
    id: q.id || null,
    key: q.key || '',
    label: q.label || '',
    type: q.type || 'richtext',
    required: q.required !== false,
    maxLength: q.maxLength === undefined || q.maxLength === null ? '' : String(q.maxLength),
    hint: q.hint || '',
    options: Array.isArray(q.options) ? q.options.map((o) => ({ value: String(o.value), label: o.label })) : [],
  };
}

function blankRow() {
  return { id: null, key: '', label: '', type: 'richtext', required: true, maxLength: '', hint: '', options: [] };
}

// Map editable rows → the POST body the route validates.
function toPayload(rows) {
  return rows.map((r) => {
    const out = {
      key: r.key.trim(),
      label: r.label,
      type: r.type,
      required: !!r.required,
    };
    if (r.id) out.id = r.id;
    if (r.hint && r.hint.trim()) out.hint = r.hint;
    if (r.maxLength !== '' && r.maxLength !== null) out.maxLength = Number(r.maxLength);
    if (isOptionType(r.type)) {
      out.options = r.options.map((o) => ({ value: Number(o.value), label: o.label }));
    }
    return out;
  });
}

export default function ReviewQuestionsSection() {
  const [rows, setRows] = useState([]);
  const [baseVersion, setBaseVersion] = useState(null);
  const [loadedSnapshot, setLoadedSnapshot] = useState('[]');
  // Row ids the server changed since this editor last synced, plus ids the server
  // no longer has. Populated only by a set_changed resync. `loadedSnapshot` is the
  // record of what we synced against, so no second copy of the rows is kept.
  const [conflicts, setConflicts] = useState(null); // { changed: Set, removed: Set, added: [] }
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null); // { tone, text } | { tone:'reload', text }
  const [validationErrors, setValidationErrors] = useState([]);
  // A 409 set_changed means baseVersion is stale; block Save until the user
  // reloads (re-saving the same stale version just 409s again — Codex P2).
  const [staleReload, setStaleReload] = useState(false);
  // A committed write whose 'final' audit row failed (route returns
  // auditWritten:false). Persists across the post-save reload so the operator
  // sees it — the change IS applied, but it's under-recorded (Codex P2).
  const [auditWarning, setAuditWarning] = useState(false);
  const dragIndex = useRef(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    setMessage(null);
    setValidationErrors([]);
    setStaleReload(false);
    requestEnvelope('/api/admin/review-questions')
      .then(({ status, ok, data }) => {
        if (status === 403) throw new Error('Admin access required');
        if (!ok) throw new Error('Failed to load review questions');
        return data;
      })
      .then((data) => {
        const editable = (data.questions || []).map(toEditable);
        setRows(editable);
        setBaseVersion(data.version || null);
        setLoadedSnapshot(JSON.stringify(toPayload(editable)));
        setConflicts(null);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  /**
   * Recover from a 409 set_changed WITHOUT discarding the operator's edits.
   *
   * The previous behavior blocked Save and offered only a Reload, which refetched
   * the server's set and silently threw away everything typed since load — the one
   * moment the work is least reproducible. Instead: refetch the server set, keep
   * the edited rows, re-baseline the optimistic token, and report exactly which
   * rows moved underneath so the operator can decide per row.
   *
   * Deliberately NOT an auto-merge. Re-saving after this overwrites the concurrent
   * change for any row the operator keeps, which is the right default for a
   * single-admin surface but must be visible, not implicit.
   */
  const resyncPreservingEdits = useCallback(async () => {
    const { ok, data } = await requestEnvelope('/api/admin/review-questions');
    if (!ok) throw new Error('Could not reload the current question set');
    const serverRows = (data.questions || []).map(toEditable);

    // What this editor last synced against, recovered from the snapshot rather
    // than duplicated in state.
    let priorPayload = [];
    try { priorPayload = JSON.parse(loadedSnapshot) || []; } catch { priorPayload = []; }
    const priorById = new Map(priorPayload.filter((r) => r.id).map((r) => [r.id, JSON.stringify(r)]));
    const serverPayload = toPayload(serverRows);
    const serverById = new Map(
      serverPayload.filter((r) => r.id).map((r) => [r.id, JSON.stringify(r)]),
    );

    const changed = new Set();
    for (const [id, serverJson] of serverById) {
      const priorJson = priorById.get(id);
      if (priorJson && priorJson !== serverJson) changed.add(id);
    }
    const removed = new Set([...priorById.keys()].filter((id) => !serverById.has(id)));
    const added = serverPayload.filter((r) => r.id && !priorById.has(r.id));

    setBaseVersion(data.version || null);
    // Baseline against the SERVER's state so `dirty` means "differs from what is
    // live", which is what Save is about to act on.
    setLoadedSnapshot(JSON.stringify(serverPayload));
    setConflicts({ changed, removed, added });
    return { changed, removed, added };
  }, [loadedSnapshot]);

  useEffect(() => { load(); }, [load]);

  const dirty = useMemo(
    () => JSON.stringify(toPayload(rows)) !== loadedSnapshot,
    [rows, loadedSnapshot],
  );

  const update = (index, patch) => {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };
  const addRow = () => setRows((prev) => [...prev, blankRow()]);
  const removeRow = (index) => setRows((prev) => prev.filter((_, i) => i !== index));
  const moveRow = (index, direction) => {
    const destination = index + direction;
    if (destination < 0 || destination >= rows.length) return;
    setRows((prev) => {
      const next = [...prev];
      const [moved] = next.splice(index, 1);
      next.splice(destination, 0, moved);
      return next;
    });
  };

  // Native HTML5 drag-to-reorder.
  const onDragStart = (index) => { dragIndex.current = index; };
  const onDragOver = (e) => { e.preventDefault(); };
  const onDrop = (index) => {
    const from = dragIndex.current;
    dragIndex.current = null;
    if (from === null || from === index) return;
    setRows((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(index, 0, moved);
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    setMessage(null);
    setValidationErrors([]);
    setAuditWarning(false);
    try {
      const { ok, status, data } = await requestEnvelope('/api/admin/review-questions', {
        method: 'POST',
        body: { questions: toPayload(rows), baseVersion },
        tolerantBody: true,
      });
      if (status === 409 && data.status === 'set_changed') {
        // Preserve the operator's edits and re-baseline instead of forcing a
        // discarding reload. Save stays enabled: the retry is now against a
        // current baseVersion.
        try {
          const { changed, removed, added } = await resyncPreservingEdits();
          const parts = [];
          if (changed.size) parts.push(`${changed.size} question${changed.size === 1 ? ' was' : 's were'} edited`);
          if (removed.size) parts.push(`${removed.size} removed`);
          if (added.length) parts.push(`${added.length} added`);
          setMessage({
            tone: 'conflict',
            text: parts.length
              ? `Someone else changed the question set while you were editing (${parts.join(', ')}). Your edits are kept below and highlighted. Review them, then save again — saving will overwrite their version of any row you keep.`
              : 'The question set changed while you were editing. Your edits are kept below; save again to apply them.',
          });
        } catch (resyncError) {
          setStaleReload(true);
          setMessage({ tone: 'reload', text: `${resyncError.message}. Reload to see the current version — your unsaved edits will be lost.` });
        }
        return;
      }
      if (status === 400 && Array.isArray(data.errors)) {
        setValidationErrors(data.errors);
        setMessage({ tone: 'error', text: 'Fix the highlighted problems and try again.' });
        return;
      }
      if (!ok || data.status !== 'completed') {
        setMessage({ tone: 'error', text: data.error || 'Save failed.' });
        return;
      }
      const s = data.summary || {};
      const parts = [];
      if (s.created) parts.push(`${s.created} added`);
      if (s.updated) parts.push(`${s.updated} edited`);
      if (s.reordered) parts.push(`${s.reordered} reordered`);
      if (s.deleted) parts.push(`${s.deleted} removed`);
      // A no-op is NOT a success: it means nothing was written. Giving it the same
      // green treatment as a real save made a swallowed edit look like a completed
      // one, so it gets its own neutral tone.
      const noop = Boolean(data.noop) || parts.length === 0;
      setMessage(noop
        ? { tone: 'noop', text: 'No changes to save — nothing was written. If you expected a change here, your edit may not have registered.' }
        : { tone: 'saved', text: `Saved — ${parts.join(', ')}.` });
      // A committed write whose audit row failed: the change is applied but
      // under-recorded — surface a persistent warning (survives the reload).
      if (data.auditWritten === false) setAuditWarning(true);
      // Reload to pick up new ids + the fresh version (so the next save diffs
      // correctly). Skipped on a no-op: nothing was written, so there are no new
      // ids and the version is unchanged — and `load()` clears `message`, which
      // would wipe the "nothing was written" notice before it could be read.
      if (!noop) load();
    } catch (e) {
      setMessage({ tone: 'error', text: e.message || 'Save failed.' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="text-gray-500 text-sm">Loading review questions…</div>;
  if (error) {
    return (
      <div className="text-sm">
        <p className="text-red-600">{error}</p>
        <button onClick={load} className="mt-2 px-3 py-1.5 text-xs border border-gray-300 rounded-lg hover:bg-gray-50">Retry</button>
      </div>
    );
  }

  return (
    <div data-testid="review-questions-editor">
      <p className="text-xs text-gray-500 mb-3">
        These are the questions the external review form asks. Drag a row or use its Move up and Move down buttons to reorder. Editing here
        changes the live form for new reviews; already-submitted reviews keep the wording they were authored
        against. An existing question&apos;s key is locked (it links prior answers).
      </p>

      {message && (
        <div className={`mb-3 px-3 py-2 rounded-lg text-sm border ${
          message.tone === 'saved' ? 'bg-green-50 text-green-800 border-green-200'
            : message.tone === 'noop' ? 'bg-gray-50 text-gray-700 border-gray-300'
              : message.tone === 'conflict' ? 'bg-amber-50 text-amber-900 border-amber-300'
                : message.tone === 'reload' ? 'bg-amber-50 text-amber-800 border-amber-200'
                  : 'bg-red-50 text-red-800 border-red-200'
        }`} role="alert" data-testid={`rq-message-${message.tone}`}>
          {message.text}
          {message.tone === 'reload' && (
            <button onClick={load} className="ml-3 px-2 py-1 text-xs font-semibold bg-amber-900 text-white rounded">Reload</button>
          )}
          {message.tone === 'conflict' && (
            <button
              onClick={load}
              className="ml-3 px-2 py-1 text-xs font-semibold border border-amber-700 text-amber-900 rounded"
              title="Discard your edits and load the current server version"
            >
              Discard my edits
            </button>
          )}
        </div>
      )}

      {validationErrors.length > 0 && (
        <ul className="mb-3 list-disc list-inside text-xs text-red-700 space-y-0.5">
          {validationErrors.map((e, i) => <li key={i}>{e}</li>)}
        </ul>
      )}

      {auditWarning && (
        <div className="mb-3 px-3 py-2 rounded-lg text-sm border bg-amber-50 text-amber-800 border-amber-200" role="alert" data-testid="rq-audit-warning">
          Your change was saved, but its audit record could not be written. The change is applied — please notify an admin so the edit is recorded.
        </div>
      )}

      <ol className="space-y-3">
        {rows.map((row, index) => (
          <ReviewQuestionRowEditor
            key={row.id || `new-${index}`}
            row={row}
            index={index}
            rowCount={rows.length}
            conflicts={conflicts}
            update={update}
            moveRow={moveRow}
            removeRow={removeRow}
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDrop={onDrop}
          />
        ))}
      </ol>

      <div className="mt-4 flex items-center gap-3">
        <button
          onClick={addRow}
          className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
        >
          + Add question
        </button>
        <button
          onClick={save}
          disabled={saving || !dirty || rows.length === 0 || staleReload}
          className="ml-auto px-4 py-1.5 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {saving ? 'Saving…' : staleReload ? 'Reload to save' : dirty ? 'Save changes' : 'No changes'}
        </button>
      </div>
    </div>
  );
}
