import { useState } from 'react';
import {
  STAFF_ENDED_BY_CHOICES,
  STAFF_OUTCOME_NOTE_MAX,
  STAFF_WITHDRAWAL_REASONS,
  normalizeStaffWithdrawal,
} from '../../utils/reviewer-staff-outcome';

/**
 * Track Reviewers "Record reviewer withdrawal" dialog (outcomes slice 3b-3).
 *
 * A pure form: it returns the chosen ending to `onConfirm` and the panel's
 * existing terminal-transition attempt (Saving…, supersession, refresh) does
 * the write. The route re-validates the same payload with
 * normalizeStaffWithdrawal.
 */
const KINDS = [
  { value: 'withdrew', label: 'Reviewer withdrew' },
  { value: 'coi', label: 'Conflict of interest' },
  { value: 'other', label: 'Other' },
];

export default function StaffWithdrawalModal({ reviewer, onClose, onConfirm }) {
  const [kind, setKind] = useState('withdrew');
  const [reason, setReason] = useState('too-busy');
  const [endedBy, setEndedBy] = useState('reviewer_after_accepting');
  const [note, setNote] = useState('');

  const payload = {
    kind,
    note: note.trim() || undefined,
    ...(kind === 'withdrew' ? { reason } : { endedBy }),
  };
  const invalid = Boolean(normalizeStaffWithdrawal(payload).error);

  const handleSubmit = (event) => {
    event.preventDefault();
    if (invalid) return;
    onConfirm(payload);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="staff-withdrawal-title"
        className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl"
      >
        <h2 id="staff-withdrawal-title" className="text-lg font-semibold text-gray-900">
          End engagement
        </h2>
        <p className="mt-1 text-sm text-gray-600">{reviewer?.name || 'Reviewer'} · accepted</p>

        <form className="mt-5 space-y-5" onSubmit={handleSubmit}>
          <fieldset>
            <legend className="text-sm font-semibold text-gray-900">Why is it ending?</legend>
            <div className="mt-2 space-y-2">
              {KINDS.map((option) => (
                <label key={option.value} className="flex items-center gap-2 text-sm text-gray-800">
                  <input
                    type="radio"
                    name="staff-withdrawal-kind"
                    value={option.value}
                    checked={kind === option.value}
                    onChange={() => setKind(option.value)}
                  />
                  {option.label}
                </label>
              ))}
            </div>
          </fieldset>

          {kind === 'withdrew' ? (
            <div>
              <label htmlFor="staff-withdrawal-reason" className="block text-sm font-semibold text-gray-900">Reason</label>
              <select
                id="staff-withdrawal-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                className="mt-2 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900"
              >
                {STAFF_WITHDRAWAL_REASONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
          ) : (
            <fieldset>
              <legend className="text-sm font-semibold text-gray-900">
                {kind === 'coi' ? 'Who raised it?' : 'Who ended it?'}
              </legend>
              <div className="mt-2 flex gap-4">
                {STAFF_ENDED_BY_CHOICES.map((option) => (
                  <label key={option.value} className="flex items-center gap-2 text-sm text-gray-800">
                    <input
                      type="radio"
                      name="staff-withdrawal-ended-by"
                      value={option.value}
                      checked={endedBy === option.value}
                      onChange={() => setEndedBy(option.value)}
                    />
                    {option.label}
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          <div>
            <label htmlFor="staff-withdrawal-note" className="block text-sm font-semibold text-gray-900">
              Note{' '}
              <span className={`font-normal ${kind === 'other' ? 'text-red-700' : 'text-gray-500'}`}>
                ({kind === 'other' ? 'required' : 'optional'})
              </span>
            </label>
            <textarea
              id="staff-withdrawal-note"
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
            This changes their response to declined, updates reviewer counts, and revokes their portal link.
            Any linked honorarium request is kept and marked Withdrawn; a paid or payment-authorized
            honorarium stops this change. Saving can take up to half a minute.
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
              disabled={invalid}
              className="rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:bg-gray-300"
            >
              Record
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
