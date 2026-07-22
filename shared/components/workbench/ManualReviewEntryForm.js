/**
 * ManualReviewEntryForm — staff rescue for entering a complete structured
 * review from the Workbench Reviews tab when the external portal cannot be
 * used. It deliberately reuses the external form's normalized-value and field
 * renderer contract, including RichReviewEditor, but has no draft/autosave
 * path: final submission goes to the dedicated authenticated staff endpoint.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  buildInitialValues,
  isComplete,
  ReviewQuestionFields,
} from '../external/ReviewAuthoringForm';

export default function ManualReviewEntryForm({ reviewer, onCancel, onSubmitted }) {
  const [form, setForm] = useState(null);
  const [values, setValues] = useState({});
  const [loadState, setLoadState] = useState('loading'); // loading | ready | error
  const [submitState, setSubmitState] = useState('idle'); // idle | submitting | error
  const [errorReason, setErrorReason] = useState(null);
  const [message, setMessage] = useState(null);

  const loadForm = useCallback(async ({ preserveValues = null } = {}) => {
    try {
      const response = await fetch(
        `/api/review-manager/manual-review-entry?suggestionId=${encodeURIComponent(reviewer.suggestionId)}`,
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok || !Array.isArray(data.questions) || !data.setVersion) {
        throw new Error(data.message || 'Could not load the current review form.');
      }
      setForm({ questions: data.questions, setVersion: data.setVersion });
      setValues(buildInitialValues(
        data.questions,
        { affiliation: data.affiliation || reviewer?.affiliation || '' },
        preserveValues || {},
      ));
      setLoadState('ready');
    } catch (error) {
      setLoadState('error');
      setMessage(error.message || 'Could not load the current review form.');
    }
  }, [reviewer]);

  const reloadForm = useCallback((options) => {
    setLoadState('loading');
    setErrorReason(null);
    setMessage(null);
    loadForm(options);
  }, [loadForm]);

  useEffect(() => {
    loadForm();
  }, [loadForm]);

  const update = useCallback((key, value) => {
    setValues((current) => ({ ...current, [key]: value }));
  }, []);

  const submit = useCallback(async () => {
    if (!form || submitState === 'submitting') return;
    setSubmitState('submitting');
    setErrorReason(null);
    setMessage(null);
    try {
      const response = await fetch('/api/review-manager/manual-review-entry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          suggestionId: reviewer.suggestionId,
          answers: values,
          setVersion: form.setVersion,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok && data.ok) {
        if (onSubmitted) await onSubmitted(data);
        return;
      }
      if (response.status === 409 && data.reason === 'set_changed') {
        setSubmitState('error');
        setErrorReason('set_changed');
        setMessage(data.message || 'The review questions changed while this form was open.');
        return;
      }
      throw new Error(
        Array.isArray(data.errors) && data.errors.length > 0
          ? data.errors.join(' ')
          : (data.message || 'The review could not be recorded.'),
      );
    } catch (error) {
      setSubmitState('error');
      setMessage(error.message || 'The review could not be recorded.');
    }
  }, [form, onSubmitted, reviewer, submitState, values]);

  if (loadState === 'loading') {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-5" aria-live="polite">
        <p className="text-sm text-gray-500">Loading the current review questions…</p>
      </div>
    );
  }

  if (loadState === 'error') {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-5" role="alert">
        <p className="text-sm font-semibold text-amber-900">Manual review entry is unavailable</p>
        <p className="mt-1 text-sm text-amber-800">{message}</p>
        <div className="mt-4 flex gap-2">
          <button type="button" onClick={() => reloadForm()} className="rounded-lg border border-amber-300 px-3 py-1.5 text-sm text-amber-900">
            Try again
          </button>
          <button type="button" onClick={onCancel} className="rounded-lg px-3 py-1.5 text-sm text-gray-600">
            Cancel
          </button>
        </div>
      </div>
    );
  }

  const submitting = submitState === 'submitting';
  const canSubmit = isComplete(form.questions, values) && !submitting;

  return (
    <div className="rounded-xl border border-gray-300 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-gray-900">Enter review manually</h3>
          <p className="mt-1 text-sm text-gray-600">
            Recording a complete review for {reviewer.name || 'this reviewer'}.
          </p>
          <p className="mt-1 text-xs text-gray-500">
            Use this only when the reviewer portal cannot be used. This rescue form does not autosave.
          </p>
        </div>
        <button type="button" onClick={onCancel} disabled={submitting} className="text-sm text-gray-500 hover:text-gray-800 disabled:opacity-40">
          Cancel
        </button>
      </div>

      <ReviewQuestionFields
        fields={form.questions}
        values={values}
        onChange={update}
        disabled={submitting}
        className="mt-6 space-y-6"
      />

      {message && (
        <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800" role="alert">
          <p>{message}</p>
          {submitState === 'error' && errorReason === 'set_changed' && (
            <button
              type="button"
              onClick={() => reloadForm({ preserveValues: values })}
              className="mt-2 font-semibold underline"
            >
              Reload current questions and keep compatible answers
            </button>
          )}
        </div>
      )}

      <div className="mt-7 flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-5">
        <p className="text-xs text-gray-500">
          Submitting is final and records the review as received by staff.
        </p>
        <button
          type="button"
          onClick={submit}
          disabled={!canSubmit}
          className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:bg-gray-300"
        >
          {submitting ? 'Recording…' : 'Record review as received'}
        </button>
      </div>
    </div>
  );
}
