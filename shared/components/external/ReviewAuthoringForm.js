/**
 * ReviewAuthoringForm — the in-browser reviewer review form (stage2b).
 *
 * Replaces the old file-upload card. Renders all review questions from
 * reviewFormSchema in order: affiliation (text), the three ratings (radios),
 * and the eight narrative questions (RichReviewEditor). Work autosaves to the
 * Postgres draft route as the reviewer types.
 *
 * CONTROLLED (unlike the legacy uncontrolled ReviewFormFields) because autosave
 * needs the live values. Initial values = the saved draft overlaid on the
 * server prefill (CRM affiliation / any previously-saved ratings).
 *
 * Final submit (Phase 3) POSTs the answers to /submit, which atomically writes
 * the Dataverse answer-snapshot rows + parent ratings and deletes the draft. On
 * success the form locks read-only. The security boundary is server-side: both
 * the draft PUT and /submit sanitize + validate every answer regardless of what
 * this client sends; the client-side completeness check only gates the button.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { reviewFormSchema } from '../../../lib/external/review-form-schema';
import RichReviewEditor from './RichReviewEditor';

const AUTOSAVE_DEBOUNCE_MS = 1200;

function buildInitialValues(prefill = {}, draftJson = {}) {
  const values = {};
  for (const field of reviewFormSchema.fields) {
    if (field.type === 'richtext') {
      values[field.key] = draftJson[field.key] ?? '';
    } else if (field.type === 'picklist') {
      // Normalize to a valid option value or null — never 0/NaN/out-of-range,
      // so an empty/garbage stored value can't render as a phantom selection or
      // get spread back into the draft on autosave (Codex S301 P2).
      const raw = draftJson[field.key] ?? prefill[field.key] ?? null;
      const n = Number(raw);
      values[field.key] = (raw === null || raw === undefined || raw === ''
        || !Number.isFinite(n) || !field.options.some((o) => o.value === n)) ? null : n;
    } else {
      values[field.key] = draftJson[field.key] ?? prefill[field.key] ?? '';
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

function isComplete(values) {
  for (const field of reviewFormSchema.fields) {
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
  const [values, setValues] = useState(() => buildInitialValues(data.prefill));
  const [loaded, setLoaded] = useState(false);
  const [saveState, setSaveState] = useState('idle'); // idle | saving | saved | error
  const [submitState, setSubmitState] = useState('idle'); // idle | submitting | submitted | error
  const [submitErrors, setSubmitErrors] = useState([]);
  const [submittedAt, setSubmittedAt] = useState(null);
  const timerRef = useRef(null);

  // Load any existing draft once, then merge it over the prefill.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const resp = await fetch(`/api/external/review/${encodeURIComponent(token)}/draft`);
        const json = await resp.json().catch(() => ({}));
        if (!cancelled && resp.ok && json.ok && json.draftJson) {
          setValues(buildInitialValues(data.prefill, json.draftJson));
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
    try {
      const resp = await fetch(`/api/external/review/${encodeURIComponent(token)}/draft`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draftJson: next }),
      });
      setSaveState(resp.ok ? 'saved' : 'error');
    } catch {
      setSaveState('error');
    }
  }, [token]);

  // Debounced autosave. Never fires until the initial draft load has settled
  // (so loading a draft can't immediately re-PUT the same content).
  const scheduleSave = useCallback((next) => {
    if (!loaded) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => persist(next), AUTOSAVE_DEBOUNCE_MS);
  }, [loaded, persist]);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  const update = useCallback((key, val) => {
    setValues((prev) => {
      const next = { ...prev, [key]: val };
      scheduleSave(next);
      return next;
    });
  }, [scheduleSave]);

  const handleSubmit = useCallback(async () => {
    setSubmitState('submitting');
    setSubmitErrors([]);
    // Cancel any pending autosave so it can't race the submit (and so it doesn't
    // fire a post-submit PUT that the server would 409).
    if (timerRef.current) clearTimeout(timerRef.current);
    try {
      const resp = await fetch(`/api/external/review/${encodeURIComponent(token)}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers: values }),
      });
      const json = await resp.json().catch(() => ({}));
      if (resp.ok && json.ok) {
        setSubmittedAt(json.receivedAt || new Date().toISOString());
        setSubmitState('submitted');
        return;
      }
      if (resp.status === 400 && Array.isArray(json.errors)) {
        setSubmitErrors(json.errors);
      } else if (resp.status === 409) {
        setSubmitErrors([json.message || 'This review has already been submitted or changed. Please reload the page.']);
      } else {
        setSubmitErrors(['Something went wrong submitting your review. Please try again.']);
      }
      setSubmitState('error');
    } catch {
      setSubmitErrors(['Network error — your review was not submitted. Please try again.']);
      setSubmitState('error');
    }
  }, [token, values]);

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

  const submitting = submitState === 'submitting';
  const canSubmit = isComplete(values) && !submitting;

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-6">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold text-gray-900">Submit your review</h3>
        <SaveIndicator state={saveState} />
      </div>
      <p className="text-sm text-gray-600 mt-2">
        Answer each question below. Your work saves automatically as you go.
      </p>

      <div className="mt-6 space-y-6">
        {reviewFormSchema.fields.map((field) => (
          <FieldRow key={field.key} field={field} value={values[field.key]} onChange={update} />
        ))}
      </div>

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

function FieldRow({ field, value, onChange }) {
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
          onChange={(e) => onChange(field.key, e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
        />
      )}

      {field.type === 'picklist' && (
        <fieldset className="space-y-2">
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
