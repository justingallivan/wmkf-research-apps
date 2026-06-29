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

const TYPE_OPTIONS = [
  { value: 'richtext', label: 'Rich text (narrative)' },
  { value: 'picklist', label: 'Rating (single choice)' },
  { value: 'string', label: 'Short text (single line)' },
];

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
    if (r.type === 'picklist') {
      out.options = r.options.map((o) => ({ value: Number(o.value), label: o.label }));
    }
    return out;
  });
}

export default function ReviewQuestionsSection() {
  const [rows, setRows] = useState([]);
  const [baseVersion, setBaseVersion] = useState(null);
  const [loadedSnapshot, setLoadedSnapshot] = useState('[]');
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
    fetch('/api/admin/review-questions')
      .then((r) => {
        if (r.status === 403) throw new Error('Admin access required');
        if (!r.ok) throw new Error('Failed to load review questions');
        return r.json();
      })
      .then((data) => {
        const editable = (data.questions || []).map(toEditable);
        setRows(editable);
        setBaseVersion(data.version || null);
        setLoadedSnapshot(JSON.stringify(toPayload(editable)));
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

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
      const res = await fetch('/api/admin/review-questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questions: toPayload(rows), baseVersion }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409 && data.status === 'set_changed') {
        setStaleReload(true); // disable Save until the user reloads a fresh version
        setMessage({ tone: 'reload', text: data.error || 'The question set changed since you loaded it. Reload to see the current version.' });
        return;
      }
      if (res.status === 400 && Array.isArray(data.errors)) {
        setValidationErrors(data.errors);
        setMessage({ tone: 'error', text: 'Fix the highlighted problems and try again.' });
        return;
      }
      if (!res.ok || data.status !== 'completed') {
        setMessage({ tone: 'error', text: data.error || 'Save failed.' });
        return;
      }
      const s = data.summary || {};
      const parts = [];
      if (s.created) parts.push(`${s.created} added`);
      if (s.updated) parts.push(`${s.updated} edited`);
      if (s.reordered) parts.push(`${s.reordered} reordered`);
      if (s.deleted) parts.push(`${s.deleted} removed`);
      setMessage({ tone: 'saved', text: data.noop || parts.length === 0 ? 'No changes to save.' : `Saved — ${parts.join(', ')}.` });
      // A committed write whose audit row failed: the change is applied but
      // under-recorded — surface a persistent warning (survives the reload).
      if (data.auditWritten === false) setAuditWarning(true);
      // Reload to pick up new ids + the fresh version (so the next save diffs correctly).
      load();
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
        These are the questions the external review form asks. Drag the ⠿ handle to reorder. Editing here
        changes the live form for new reviews; already-submitted reviews keep the wording they were authored
        against. An existing question&apos;s key is locked (it links prior answers).
      </p>

      {message && (
        <div className={`mb-3 px-3 py-2 rounded-lg text-sm border ${
          message.tone === 'saved' ? 'bg-green-50 text-green-800 border-green-200'
            : message.tone === 'reload' ? 'bg-amber-50 text-amber-800 border-amber-200'
              : 'bg-red-50 text-red-800 border-red-200'
        }`} role="alert">
          {message.text}
          {message.tone === 'reload' && (
            <button onClick={load} className="ml-3 px-2 py-1 text-xs font-semibold bg-amber-900 text-white rounded">Reload</button>
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
          <li
            key={row.id || `new-${index}`}
            draggable
            onDragStart={() => onDragStart(index)}
            onDragOver={onDragOver}
            onDrop={() => onDrop(index)}
            data-testid="rq-row"
            className="rounded-lg border border-gray-200 bg-gray-50 p-3"
          >
            <div className="flex items-start gap-2">
              <span className="cursor-grab select-none text-gray-400 pt-2" title="Drag to reorder" aria-label="Drag to reorder">⠿</span>
              <div className="flex-1 min-w-0 space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-semibold text-gray-500">Q{index + 1}</span>
                  {row.id ? (
                    <span className="text-[11px] px-1.5 py-0.5 rounded bg-gray-200 text-gray-600" title="Key is locked — it links existing reviewer answers">
                      key: {row.key} 🔒
                    </span>
                  ) : (
                    <input
                      aria-label="Question key"
                      placeholder="key (e.g. q12)"
                      value={row.key}
                      onChange={(e) => update(index, { key: e.target.value })}
                      className="px-2 py-1 border border-gray-300 rounded text-xs w-40"
                    />
                  )}
                  <select
                    aria-label="Question type"
                    value={row.type}
                    onChange={(e) => update(index, { type: e.target.value })}
                    className="px-2 py-1 border border-gray-300 rounded text-xs"
                  >
                    {TYPE_OPTIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                  <label className="flex items-center gap-1 text-xs text-gray-600">
                    <input type="checkbox" checked={row.required} onChange={(e) => update(index, { required: e.target.checked })} />
                    Required
                  </label>
                  <button
                    onClick={() => removeRow(index)}
                    className="ml-auto text-xs text-red-600 hover:text-red-800"
                    title="Remove this question"
                  >
                    Remove
                  </button>
                </div>

                <textarea
                  aria-label="Question text"
                  placeholder="Question text shown to the reviewer"
                  value={row.label}
                  onChange={(e) => update(index, { label: e.target.value })}
                  rows={2}
                  className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                />

                <div className="flex items-center gap-2 flex-wrap">
                  <input
                    aria-label="Hint"
                    placeholder="Optional hint"
                    value={row.hint}
                    onChange={(e) => update(index, { hint: e.target.value })}
                    className="px-2 py-1 border border-gray-300 rounded text-xs flex-1 min-w-[12rem]"
                  />
                  {row.type !== 'picklist' && (
                    <label className="flex items-center gap-1 text-xs text-gray-500">
                      Max length
                      <input
                        aria-label="Max length"
                        type="number"
                        min="1"
                        value={row.maxLength}
                        onChange={(e) => update(index, { maxLength: e.target.value })}
                        className="px-2 py-1 border border-gray-300 rounded text-xs w-24"
                      />
                    </label>
                  )}
                </div>

                {row.type === 'picklist' && (
                  <OptionsEditor
                    options={row.options}
                    onChange={(options) => update(index, { options })}
                  />
                )}
              </div>
            </div>
          </li>
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

function OptionsEditor({ options, onChange }) {
  const setOption = (i, patch) => onChange(options.map((o, idx) => (idx === i ? { ...o, ...patch } : o)));
  const addOption = () => {
    const nextVal = options.reduce((m, o) => Math.max(m, Number(o.value) || 0), 0) + 1;
    onChange([...options, { value: String(nextVal), label: '' }]);
  };
  const removeOption = (i) => onChange(options.filter((_, idx) => idx !== i));

  return (
    <div className="rounded border border-gray-200 bg-white p-2">
      <p className="text-[11px] uppercase tracking-wide text-gray-400 mb-1">Rating options</p>
      <div className="space-y-1">
        {options.map((o, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              aria-label={`Option ${i + 1} value`}
              type="number"
              value={o.value}
              onChange={(e) => setOption(i, { value: e.target.value })}
              className="px-2 py-1 border border-gray-300 rounded text-xs w-16"
            />
            <input
              aria-label={`Option ${i + 1} label`}
              placeholder="Option label"
              value={o.label}
              onChange={(e) => setOption(i, { label: e.target.value })}
              className="px-2 py-1 border border-gray-300 rounded text-xs flex-1"
            />
            <button onClick={() => removeOption(i)} className="text-xs text-red-600 hover:text-red-800" title="Remove option">✕</button>
          </div>
        ))}
      </div>
      <button onClick={addOption} className="mt-1 text-xs text-gray-600 hover:text-gray-900">+ Add option</button>
    </div>
  );
}
