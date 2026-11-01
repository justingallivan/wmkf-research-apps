import { useState } from 'react';
import {
  STAFF_OUTCOME_NOTE_MAX,
  STAFF_PENDING_ENDED_BY_CHOICES,
  normalizeStaffPendingOutcome,
} from '../../utils/reviewer-staff-outcome';

/**
 * Invite Reviewers "Record outcome…" dialog for an invited reviewer who has
 * not answered (owner decision 2026-10-31).
 *
 * A pure form: it returns the choice to `onConfirm`, and the panel does the
 * write. The route re-validates the same payload with
 * normalizeStaffPendingOutcome.
 */
const KINDS = [
  { value: 'coi', label: 'Conflict of interest' },
  { value: 'other', label: 'Other' },
];

export default function StaffPendingOutcomeModal({ reviewer, saving = false, onClose, onConfirm }) {
  const [kind, setKind] = useState('coi');
  const [endedBy, setEndedBy] = useState('reviewer_before_accepting');
  const [note, setNote] = useState('');

  const payload = { kind, endedBy, note: note.trim() || undefined };
  const invalid = Boolean(normalizeStaffPendingOutcome(payload).error);

  const handleSubmit = (event) => {
    event.preventDefault();
    if (invalid || saving) return;
    onConfirm(payload);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="staff-pending-outcome-title"
        className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl"
      >
        <h2 id="staff-pending-outcome-title" className="text-lg font-semibold text-gray-900">
          Record outcome
        </h2>
        <p className="mt-1 text-sm text-gray-600">{reviewer?.name || 'Reviewer'} · invited, no answer yet</p>

        <form className="mt-5 space-y-5" onSubmit={handleSubmit}>
          <fieldset>
            <legend className="text-sm font-semibold text-gray-900">What happened?</legend>
            <div className="mt-2 space-y-2">
              {KINDS.map((option) => (
                <label key={option.value} className="flex items-center gap-2 text-sm text-gray-800">
                  <input
                    type="radio"
                    name="staff-pending-outcome-kind"
                    value={option.value}
                    checked={kind === option.value}
                    onChange={() => setKind(option.value)}
                  />
                  {option.label}
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="text-sm font-semibold text-gray-900">
              {kind === 'coi' ? 'Who raised it?' : 'Who ended it?'}
            </legend>
            <div className="mt-2 flex gap-4">
              {STAFF_PENDING_ENDED_BY_CHOICES.map((option) => (
                <label key={option.value} className="flex items-center gap-2 text-sm text-gray-800">
                  <input
                    type="radio"
                    name="staff-pending-outcome-ended-by"
                    value={option.value}
                    checked={endedBy === option.value}
                    onChange={() => setEndedBy(option.value)}
                  />
                  {option.label}
                </label>
              ))}
            </div>
          </fieldset>

          <div>
            <label htmlFor="staff-pending-outcome-note" className="block text-sm font-semibold text-gray-900">
              Note{' '}
              <span className={`font-normal ${kind === 'other' ? 'text-red-700' : 'text-gray-500'}`}>
                ({kind === 'other' ? 'required' : 'optional'})
              </span>
            </label>
            <textarea
              id="staff-pending-outcome-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={STAFF_OUTCOME_NOTE_MAX}
              required={kind === 'other'}
              rows={3}
              className="mt-2 block w-full resize-y rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
              placeholder={kind === 'other' ? 'What happened' : 'Add context when useful'}
            />
          </div>

          <p className="text-xs leading-5 text-gray-500">
            This records their response as declined and stops their invitation link from working, so they
            can no longer answer. They move to the Removed list below and cannot be restored or re-invited
            on this proposal.
          </p>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={invalid || saving}
              className="rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:bg-gray-300"
            >
              {saving ? 'Saving…' : 'Record'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
