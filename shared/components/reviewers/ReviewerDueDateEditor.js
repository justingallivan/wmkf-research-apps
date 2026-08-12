import { useEffect, useRef, useState } from 'react';
import { currentYmdInTimeZone } from '../../../lib/utils/date-ymd';

function formatDate(value) {
  if (!value) return 'Not set';
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return 'Not set';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(parsed);
}

/**
 * Shared staff editor for the per-engagement review due-date override.
 * The same component is used before acceptance (Invite Reviewers) and after
 * acceptance (Track Reviewers), and both write through the existing
 * my-candidates PATCH seam.
 */
export default function ReviewerDueDateEditor({
  suggestionId,
  overrideDate = null,
  effectiveDate = null,
  defaultDate = null,
  canManage = true,
  onSaved,
  compact = false,
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(overrideDate || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [minimumDate] = useState(() => currentYmdInTimeZone());
  const generationRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    // A parent refresh can reuse this component instance for a different row,
    // or replace the saved value while an earlier request is still in flight.
    // Invalidate that request before resetting the editor so its eventual
    // response cannot write stale UI state into the new engagement.
    generationRef.current += 1;
    setDraft(overrideDate || '');
    setEditing(false);
    setSaving(false);
    setError(null);
  }, [suggestionId, overrideDate]);

  useEffect(() => {
    // React Strict Mode replays effect setup/cleanup in development. Restore
    // the mounted flag on each setup so the replay cannot suppress saves.
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
    };
  }, []);

  const save = async (nextDraft = draft) => {
    const generation = ++generationRef.current;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch('/api/reviewer-finder/my-candidates', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          suggestionId,
          reviewDueDateOverride: nextDraft || null,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) {
        throw new Error(data.error || `Could not save review due date (${response.status})`);
      }
      if (!mountedRef.current || generation !== generationRef.current) return;
      setDraft(nextDraft || '');
      setEditing(false);
      if (onSaved) onSaved();
    } catch (saveError) {
      if (!mountedRef.current || generation !== generationRef.current) return;
      setError(saveError.message);
    } finally {
      if (mountedRef.current && generation === generationRef.current) setSaving(false);
    }
  };

  if (!canManage) {
    return (
      <span className="text-xs text-gray-500">
        {formatDate(effectiveDate)}{overrideDate ? ' (override)' : ''}
      </span>
    );
  }

  if (!editing) {
    return (
      <span className="inline-flex flex-col items-start gap-0.5">
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="text-xs text-blue-700 hover:text-blue-900 hover:underline text-left"
          title={overrideDate
            ? `Reviewer-specific override. Request default: ${formatDate(defaultDate)}`
            : `Using request default: ${formatDate(defaultDate)}`}
        >
          {compact ? '' : 'Review due: '}{formatDate(effectiveDate)}{overrideDate ? ' (override)' : ''}
        </button>
        {error && <span className="text-[11px] text-red-600">{error}</span>}
      </span>
    );
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <span className="inline-flex items-center gap-1">
        <input
          type="date"
          value={draft}
          min={minimumDate}
          onChange={(event) => setDraft(event.target.value)}
          disabled={saving}
          aria-label="Reviewer-specific review due date"
          className="w-36 px-1.5 py-1 text-xs border border-gray-300 rounded"
        />
        <button
          type="button"
          onClick={() => save()}
          disabled={saving || !draft}
          className="text-xs text-blue-700 hover:text-blue-900 disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        {overrideDate && (
          <button
            type="button"
            onClick={() => save('')}
            disabled={saving}
            className="text-xs text-gray-600 hover:text-gray-900 disabled:opacity-40"
          >
            Use default
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            generationRef.current += 1;
            setDraft(overrideDate || '');
            setEditing(false);
            setError(null);
            setSaving(false);
          }}
          disabled={saving}
          className="text-xs text-gray-400 hover:text-gray-700 disabled:opacity-40"
        >
          Cancel
        </button>
      </span>
      <span className="text-[11px] text-gray-400">Request default: {formatDate(defaultDate)}</span>
      {error && <span className="text-[11px] text-red-600">{error}</span>}
    </span>
  );
}
