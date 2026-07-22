/**
 * ReviewAuthoringForm — the in-browser reviewer review form (stage2b).
 *
 * Replaces the old file-upload card. Renders all review questions from the
 * STAFF-EDITABLE question set delivered by /context (`data.questions`, the
 * Dataverse `wmkf_reviewquestion` set) in order: affiliation (text), the
 * ratings (radios), and the narrative questions (RichReviewEditor). Work
 * autosaves to the Postgres draft route as the reviewer types.
 *
 * The set is supplied as a prop (no static import) so staff edits flow through
 * without a deploy (staff-editable-questions epic Phase B2). `data.questions`
 * is loaded synchronously with the rest of the context payload — context is
 * fail-closed, so this view never renders against an unknown/empty set.
 *
 * CONTROLLED (unlike the legacy uncontrolled ReviewFormFields) because autosave
 * needs the live values. Initial values = the saved draft overlaid on the
 * server prefill (CRM affiliation / any previously-saved ratings), reconciled
 * type-aware against the CURRENT set so a question whose type changed since the
 * draft was saved can't feed the wrong control shape (Codex P1).
 *
 * Final submit POSTs the answers + the `setVersion` it rendered to /submit,
 * which atomically writes the Dataverse answer-snapshot rows + parent ratings
 * and deletes the draft. A stale setVersion comes back 409 `set_changed` →
 * reload. On success the form locks read-only. The security boundary is
 * server-side: both the draft PUT and /submit sanitize + validate every answer
 * regardless of what this client sends; the client-side completeness check only
 * gates the button.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import RichReviewEditor from './RichReviewEditor';

const AUTOSAVE_DEBOUNCE_MS = 1200;

export function buildInitialValues(fields, prefill = {}, draftJson = {}) {
  const values = {};
  for (const field of (fields || [])) {
    if (field.type === 'richtext') {
      // Type-aware reconciliation (Codex P1): only a string is a valid richtext
      // answer. A value left behind by a question that USED to be a picklist
      // (a number) is discarded → empty, never fed to the rich-text editor.
      const d = draftJson[field.key];
      values[field.key] = typeof d === 'string' ? d : '';
    } else if (field.type === 'picklist') {
      // Prefer a shape-valid draft value; a draft value that doesn't coerce to
      // one of THIS field's options (e.g. HTML left behind by a former richtext
      // question, or empty/garbage) is discarded and we fall back to the
      // CRM/parent prefill. Never render a phantom selection or spread garbage
      // back into the draft on autosave (Codex S301 P2 + S304 reconciliation).
      const draftRaw = draftJson[field.key];
      const draftNum = Number(draftRaw);
      const draftValid = draftRaw !== null && draftRaw !== undefined && draftRaw !== ''
        && typeof draftRaw !== 'object' && Number.isFinite(draftNum)
        && field.options.some((o) => o.value === draftNum);
      if (draftValid) {
        values[field.key] = draftNum;
      } else {
        const p = prefill[field.key];
        const pn = Number(p);
        values[field.key] = (p === null || p === undefined || p === ''
          || !Number.isFinite(pn) || !field.options.some((o) => o.value === pn)) ? null : pn;
      }
    } else {
      // string (affiliation): only a string draft value is valid; otherwise the
      // CRM prefill (also a string).
      const d = draftJson[field.key];
      values[field.key] = typeof d === 'string' ? d : (prefill[field.key] ?? '');
    }
  }
  return values;
}

// Cheap client-side "has visible text" check to gate the Submit button. NOT a
// security or validation boundary — /submit re-sanitizes and re-validates every
// answer (emptiness-after-strip included). Kept dependency-free so the server
// sanitizer (sanitize-html) never enters the client bundle.
function hasText(html) {
  return String(html || '').replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, ' ').trim().length > 0;
}

export function isComplete(fields, values) {
  for (const field of (fields || [])) {
    if (!field.required) continue;
    const v = values[field.key];
    if (field.type === 'richtext') {
      if (!hasText(v)) return false;
    } else if (field.type === 'picklist') {
      if (v === null || v === undefined || v === '') return false;
    } else if (typeof v !== 'string' || v.trim().length === 0) {
      return false;
    }
  }
  return true;
}

export default function ReviewAuthoringForm({ data, token }) {
  // The staff-editable question set + its version tag, delivered with /context.
  // Fail-closed: context 500s if the set can't load, so a stage2b render always
  // carries a non-empty set. We still guard below rather than render a partial
  // or empty form.
  const fields = Array.isArray(data.questions) ? data.questions : null;
  const setVersion = typeof data.questionSetVersion === 'string' ? data.questionSetVersion : null;

  const [values, setValues] = useState(() => buildInitialValues(fields, data.prefill));
  const [loaded, setLoaded] = useState(false);
  const [saveState, setSaveState] = useState('idle'); // idle | saving | saved | error
  const [submitState, setSubmitState] = useState('idle'); // idle | submitting | submitted | conflict | set_changed | error
  const [submitErrors, setSubmitErrors] = useState([]);
  const [submittedAt, setSubmittedAt] = useState(null);
  const timerRef = useRef(null);
  const autosaveAbortRef = useRef(null);
  // Editing is frozen while a submit is in flight and after a terminal conflict
  // (already-submitted / concurrent-collision) or a set_changed reload prompt —
  // none is something the reviewer can resolve by editing in place (Codex S302).
  // 'submitted' early-returns below.
  const frozen = submitState === 'submitting' || submitState === 'conflict' || submitState === 'set_changed';

  // Load any existing draft once, then merge it over the prefill.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const resp = await fetch(`/api/external/review/${encodeURIComponent(token)}/draft`);
        const json = await resp.json().catch(() => ({}));
        if (!cancelled && resp.ok && json.ok && json.draftJson) {
          setValues(buildInitialValues(fields, data.prefill, json.draftJson));
        }
      } catch {
        /* non-fatal: start from prefill */
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const persist = useCallback(async (next) => {
    setSaveState('saving');
    const controller = new AbortController();
    autosaveAbortRef.current = controller;
    try {
      const resp = await fetch(`/api/external/review/${encodeURIComponent(token)}/draft`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draftJson: next }),
        signal: controller.signal,
      });
      setSaveState(resp.ok ? 'saved' : 'error');
    } catch (e) {
      if (e?.name === 'AbortError') return; // aborted by submit — not a real save failure
      setSaveState('error');
    } finally {
      if (autosaveAbortRef.current === controller) autosaveAbortRef.current = null;
    }
  }, [token]);

  // Debounced autosave. Never fires until the initial draft load has settled
  // (so loading a draft can't immediately re-PUT the same content), and never
  // once a submit is in flight / the form is frozen (Codex S302 P2).
  const scheduleSave = useCallback((next) => {
    if (!loaded || frozen) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => persist(next), AUTOSAVE_DEBOUNCE_MS);
  }, [loaded, frozen, persist]);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  const update = useCallback((key, val) => {
    if (frozen) return; // ignore edits once a submit is in flight / form is locked
    setValues((prev) => {
      const next = { ...prev, [key]: val };
      scheduleSave(next);
      return next;
    });
  }, [frozen, scheduleSave]);

  const handleSubmit = useCallback(async () => {
    setSubmitState('submitting');
    setSubmitErrors([]);
    // Stop any autosave from racing the submit: cancel a pending debounce AND
    // abort an already-in-flight PUT (which would otherwise land post-submit and
    // 409 against the draft route).
    if (timerRef.current) clearTimeout(timerRef.current);
    if (autosaveAbortRef.current) autosaveAbortRef.current.abort();
    try {
      const resp = await fetch(`/api/external/review/${encodeURIComponent(token)}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Echo the question-set version we rendered against. A stale version
        // comes back 409 `set_changed` (questions edited since load) so we can
        // prompt a reload instead of surfacing a confusing field error. Older
        // payloads with no version skip the server-side check.
        body: JSON.stringify({ answers: values, ...(setVersion ? { setVersion } : {}) }),
      });
      const json = await resp.json().catch(() => ({}));
      if (resp.ok && json.ok) {
        setSubmittedAt(json.receivedAt || new Date().toISOString());
        setSubmitState('submitted');
        return;
      }
      if (resp.status === 409) {
        if (json.reason === 'set_changed') {
          // The staff question set changed since this form loaded. NOT terminal:
          // a reload re-fetches the current set and reconciles the draft onto it.
          // The submit did NOT commit, so the draft is still writable — flush the
          // current values first so edits made inside the autosave debounce
          // window (which handleSubmit cancelled above) aren't lost on reload.
          // This makes the "your saved answers will be kept" copy true (Codex
          // Phase B P1-B). persist() swallows its own errors; a failed flush just
          // falls back to the last autosaved draft, no worse than before.
          await persist(values);
          setSubmitErrors([json.message || 'The review questions changed since you opened this form. Please reload to see the current questions.']);
          setSubmitState('set_changed');
          return;
        }
        // Terminal: already submitted / concurrent collision / row changed —
        // none of these are resolvable by editing and resubmitting. Lock the form.
        setSubmitErrors([json.message || 'This review has already been submitted or changed.']);
        setSubmitState('conflict');
        return;
      }
      if (resp.status === 400 && Array.isArray(json.errors)) {
        setSubmitErrors(json.errors);
      } else {
        setSubmitErrors(['Something went wrong submitting your review. Please try again.']);
      }
      setSubmitState('error'); // recoverable — form stays editable
    } catch {
      setSubmitErrors(['Network error — your review was not submitted. Please try again.']);
      setSubmitState('error');
    }
  }, [token, values, setVersion, persist]);

  // Fail-closed: never render a partial or empty form. /context is fail-closed
  // and 500s when the question set can't load, so this is a defensive backstop
  // (a malformed/empty `data.questions` must show an error, not a blank form).
  if (!fields || fields.length === 0) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5" role="alert">
        <p className="text-sm font-semibold text-amber-900">The review form is temporarily unavailable</p>
        <p className="text-sm text-amber-800 mt-1">
          We couldn&apos;t load the review questions. Please reload, and contact your Program Director if this persists.
        </p>
      </div>
    );
  }

  // Don't render any editable surface until the saved draft has loaded.
  // Otherwise a returning reviewer could start typing into the prefill-seeded
  // form in the ~100-300ms before GET /draft resolves, and the load would
  // overwrite those keystrokes (Codex S301 P0). Gating render here makes the
  // race structurally impossible — the editors mount once, with merged values.
  if (!loaded) {
    return (
      <div className="bg-white rounded-2xl border border-gray-200 p-6">
        <div className="flex items-center gap-3 text-sm text-gray-500">
          <span className="inline-block w-5 h-5 border-2 border-gray-300 border-t-gray-900 rounded-full animate-spin" />
          Loading your review…
        </div>
      </div>
    );
  }

  // Submit is final — once it succeeds the form locks read-only (matches the
  // server contract: the draft is gone and /submit, /draft, and the reviewer
  // upload all refuse post-submission).
  if (submitState === 'submitted') {
    return (
      <div className="bg-green-50 border border-green-200 rounded-2xl p-5" role="status" aria-live="polite">
        <p className="text-sm font-semibold text-green-900">Review received</p>
        <p className="text-sm text-green-800 mt-1">
          Thank you — we received your review
          {submittedAt ? ` on ${new Date(submittedAt).toLocaleString(undefined, { dateStyle: 'long', timeStyle: 'short' })}` : ''}.
          Your review is final. If you need to make a change, please contact your Program Director.
        </p>
      </div>
    );
  }

  // Terminal conflict (server 409): already submitted, concurrent collision, or
  // the row changed under us. Not resolvable by editing — lock the form and
  // offer only a reload (Codex S302 P2).
  if (submitState === 'conflict') {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5" role="alert">
        <p className="text-sm font-semibold text-amber-900">This review can no longer be submitted here</p>
        <p className="text-sm text-amber-800 mt-1">
          {submitErrors[0] || 'This review has already been submitted or changed.'}
        </p>
        <button
          type="button"
          onClick={() => { if (typeof window !== 'undefined') window.location.reload(); }}
          className="mt-3 px-4 py-2 bg-amber-900 text-white text-sm font-semibold rounded-lg hover:bg-amber-800"
        >
          Reload
        </button>
      </div>
    );
  }

  // set_changed (server 409): the staff question set was edited after this form
  // loaded. NOT terminal — autosaved answers survive a reload, which re-fetches
  // the current set and reconciles the draft onto it (type-aware overlay).
  if (submitState === 'set_changed') {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5" role="alert">
        <p className="text-sm font-semibold text-amber-900">The review questions were updated</p>
        <p className="text-sm text-amber-800 mt-1">
          {submitErrors[0] || 'The review questions changed since you opened this form. Please reload to see the current questions.'}
          {' '}Your saved answers will be kept where they still apply.
        </p>
        <button
          type="button"
          onClick={() => { if (typeof window !== 'undefined') window.location.reload(); }}
          className="mt-3 px-4 py-2 bg-amber-900 text-white text-sm font-semibold rounded-lg hover:bg-amber-800"
        >
          Reload
        </button>
      </div>
    );
  }

  const submitting = submitState === 'submitting';
  const canSubmit = isComplete(fields, values) && !submitting;

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-6">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold text-gray-900">Submit your review</h3>
        <SaveIndicator state={saveState} />
      </div>
      <p className="text-sm text-gray-600 mt-2">
        Answer each question below. Your work saves automatically as you go.
      </p>

      <ReviewQuestionFields
        fields={fields}
        values={values}
        onChange={update}
        disabled={frozen}
        className="mt-6 space-y-6"
      />

      {submitState === 'error' && submitErrors.length > 0 && (
        <div className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4" role="alert">
          <p className="text-sm font-semibold text-red-900">Your review was not submitted</p>
          <ul className="mt-2 list-disc list-inside text-sm text-red-800 space-y-1">
            {submitErrors.map((err, i) => <li key={i}>{err}</li>)}
          </ul>
        </div>
      )}

      <div className="mt-8 border-t border-gray-100 pt-5 flex items-center justify-between gap-4">
        <p className="text-xs text-gray-500">
          {canSubmit
            ? 'Submitting is final — you will not be able to edit your review afterward.'
            : 'Answer every required question (marked *) to submit. Your work is saved as you go.'}
        </p>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
          title={canSubmit ? 'Submit your review' : 'Answer all required questions first'}
          className={`px-5 py-2.5 text-sm font-semibold rounded-lg ${
            canSubmit
              ? 'bg-gray-900 text-white hover:bg-gray-800'
              : 'bg-gray-300 text-white cursor-not-allowed'
          }`}
        >
          {submitting ? 'Submitting…' : 'Submit review'}
        </button>
      </div>
    </div>
  );
}

export function ReviewQuestionFields({ fields, values, onChange, disabled = false, className = 'space-y-6' }) {
  return (
    <div className={className}>
      {(fields || []).map((field) => (
        <FieldRow
          key={field.key}
          field={field}
          value={values?.[field.key]}
          onChange={onChange}
          disabled={disabled}
        />
      ))}
    </div>
  );
}

function FieldRow({ field, value, onChange, disabled = false }) {
  const id = `rf-${field.key}`;
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-sm font-semibold text-gray-900">
        {field.label}
        {field.required && <span className="text-red-600 ml-1">*</span>}
      </label>
      {field.hint && <p className="text-xs text-gray-500">{field.hint}</p>}

      {field.type === 'string' && (
        <input
          id={id}
          type="text"
          maxLength={field.maxLength}
          value={value ?? ''}
          disabled={disabled}
          onChange={(e) => onChange(field.key, e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 disabled:bg-gray-50 disabled:text-gray-500"
        />
      )}

      {field.type === 'picklist' && (
        <fieldset className="space-y-2" disabled={disabled}>
          <legend className="sr-only">{field.label}</legend>
          {field.options.map((option) => {
            const optId = `${id}-${option.value}`;
            return (
              <div key={option.value} className="flex items-start gap-2">
                <input
                  id={optId}
                  name={field.key}
                  type="radio"
                  value={option.value}
                  checked={Number(value) === option.value}
                  disabled={disabled}
                  onChange={() => onChange(field.key, option.value)}
                  className="mt-1"
                />
                <label htmlFor={optId} className="text-sm text-gray-800">{option.label}</label>
              </div>
            );
          })}
        </fieldset>
      )}

      {field.type === 'richtext' && (
        <RichReviewEditor
          value={value ?? ''}
          onChange={(html) => onChange(field.key, html)}
          ariaLabel={field.label}
          disabled={disabled}
        />
      )}
    </div>
  );
}

function SaveIndicator({ state }) {
  const map = {
    idle: { text: '', cls: 'text-gray-400' },
    saving: { text: 'Saving…', cls: 'text-gray-500' },
    saved: { text: 'Saved', cls: 'text-green-600' },
    error: { text: 'Save failed — retrying on next edit', cls: 'text-red-600' },
  };
  const { text, cls } = map[state] || map.idle;
  if (!text) return null;
  return <span className={`text-xs ${cls}`} aria-live="polite">{text}</span>;
}
