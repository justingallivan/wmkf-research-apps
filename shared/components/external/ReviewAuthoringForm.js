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
 * Autosave only — FINAL SUBMIT is Phase 3 (the /submit route + atomic Dataverse
 * changeset don't exist yet), so the Submit button is present but disabled. The
 * security boundary is server-side: the draft PUT sanitizes every rich-text
 * answer regardless of what this client sends.
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
      const v = draftJson[field.key] ?? prefill[field.key] ?? null;
      values[field.key] = v === null || v === undefined ? null : Number(v);
    } else {
      values[field.key] = draftJson[field.key] ?? prefill[field.key] ?? '';
    }
  }
  return values;
}

export default function ReviewAuthoringForm({ data, token }) {
  const [values, setValues] = useState(() => buildInitialValues(data.prefill));
  const [loaded, setLoaded] = useState(false);
  const [saveState, setSaveState] = useState('idle'); // idle | saving | saved | error
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

      <div className="mt-8 border-t border-gray-100 pt-5 flex items-center justify-between gap-4">
        <p className="text-xs text-gray-500">
          Final submission will be enabled shortly. Your answers are saved as a draft until then.
        </p>
        {/* TODO(Phase 3): wire to POST /api/external/review/[token]/submit once the
            atomic changeset submit exists; then lock the form read-only on success. */}
        <button
          type="button"
          disabled
          title="Final submission is not available yet"
          className="px-5 py-2.5 bg-gray-300 text-white text-sm font-semibold rounded-lg cursor-not-allowed"
        >
          Submit review
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
