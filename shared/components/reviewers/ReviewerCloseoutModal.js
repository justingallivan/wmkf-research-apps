import { useEffect, useRef, useState } from 'react';

export const CLOSEOUT_DISPOSITION_LABELS = Object.freeze({
  eligible: 'Eligible',
  not_eligible: 'Not eligible',
  not_applicable: 'Not applicable',
  unknown: 'Needs technical review',
});

const OPTIONS = [
  {
    value: 'eligible',
    label: 'Eligible',
    description: 'The completed review qualifies for the linked honorarium.',
  },
  {
    value: 'not_eligible',
    label: 'Not eligible',
    description: 'The review was received and closed, but does not qualify for payment.',
  },
  {
    value: 'not_applicable',
    label: 'Not applicable',
    description: 'No honorarium applies because the reviewer opted out or none is linked.',
  },
];

export function closeoutDispositionLabel(value) {
  if (value == null) return 'Closeout disposition not recorded';
  return CLOSEOUT_DISPOSITION_LABELS[value] || CLOSEOUT_DISPOSITION_LABELS.unknown;
}

function optionAllowed(option, reviewer) {
  const optedOut = reviewer?.honorariumOptOut === true;
  const hasHonorarium = Boolean(reviewer?.honorariumRequestId);
  if (option === 'eligible') return !optedOut && hasHonorarium;
  if (option === 'not_applicable') return optedOut || !hasHonorarium;
  return option === 'not_eligible';
}

export default function ReviewerCloseoutModal({ isOpen, reviewer, proposal, onClose, onSaved }) {
  const initialDisposition = CLOSEOUT_DISPOSITION_LABELS[reviewer?.honorariumEligibility]
    && reviewer?.honorariumEligibility !== 'unknown'
    ? reviewer.honorariumEligibility
    : '';
  const [disposition, setDisposition] = useState(initialDisposition);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const savingRef = useRef(false);
  const generationRef = useRef(0);
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
    };
  }, []);

  if (!isOpen || !reviewer) return null;

  const editing = reviewer.reviewStatus === 'complete';
  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!disposition || !optionAllowed(disposition, reviewer) || savingRef.current) return;
    const generation = generationRef.current;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch('/api/review-manager/close-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          suggestionId: reviewer.suggestionId,
          disposition,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (generation !== generationRef.current || !mountedRef.current) return;
      if (!response.ok || !data.success) {
        setError(data.error || 'The reviewer closeout could not be saved. Reload and try again.');
        return;
      }
      if (onSaved) onSaved(data);
      onClose();
    } catch (requestError) {
      if (generation === generationRef.current && mountedRef.current) {
        setError(requestError.message || 'The reviewer closeout could not be saved.');
      }
    } finally {
      if (generation === generationRef.current && mountedRef.current) {
        savingRef.current = false;
        setSaving(false);
      }
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="reviewer-closeout-title"
        className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl"
      >
        <h2 id="reviewer-closeout-title" className="text-lg font-semibold text-gray-900">
          {editing ? 'Edit reviewer closeout' : 'Close reviewer'}
        </h2>
        <p className="mt-1 text-sm text-gray-600">
          {reviewer.name || 'Reviewer'} · {reviewer.reviewStatus === 'complete' ? 'Completed review' : 'Review received'}
        </p>
        {(proposal?.requestNumber || proposal?.proposalTitle) && (
          <p className="mt-1 text-sm text-gray-500">
            {[proposal.requestNumber, proposal.proposalTitle].filter(Boolean).join(' · ')}
          </p>
        )}

        <dl className="mt-4 grid grid-cols-2 gap-3 rounded-lg bg-gray-50 p-3 text-sm">
          <div>
            <dt className="text-gray-500">Honorarium request</dt>
            <dd className="font-medium text-gray-900">{reviewer.honorariumRequestId ? 'Linked' : 'Not linked'}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Reviewer opted out</dt>
            <dd className="font-medium text-gray-900">{reviewer.honorariumOptOut ? 'Yes' : 'No'}</dd>
          </div>
        </dl>

        {reviewer.honorariumEligibility === 'unknown' && (
          <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800" role="alert">
            The saved disposition is not recognized. Technical repair is required before it can be changed here.
          </p>
        )}

        <form className="mt-5" onSubmit={handleSubmit}>
          <fieldset disabled={saving || reviewer.honorariumEligibility === 'unknown'}>
            <legend className="text-sm font-semibold text-gray-900">Honorarium eligibility</legend>
            <div className="mt-2 space-y-2">
              {OPTIONS.map((option) => {
                const allowed = optionAllowed(option.value, reviewer);
                return (
                  <label
                    key={option.value}
                    className={`flex gap-3 rounded-lg border p-3 ${allowed ? 'cursor-pointer border-gray-200 hover:border-gray-400' : 'cursor-not-allowed border-gray-100 bg-gray-50 opacity-60'}`}
                  >
                    <input
                      type="radio"
                      name="closeout-disposition"
                      value={option.value}
                      checked={disposition === option.value}
                      disabled={!allowed}
                      onChange={(event) => setDisposition(event.target.value)}
                      className="mt-1"
                    />
                    <span>
                      <span className="block text-sm font-medium text-gray-900">{option.label}</span>
                      <span className="block text-xs leading-5 text-gray-500">{option.description}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          {error && <p className="mt-3 text-sm text-red-700" role="alert">{error}</p>}

          <div className="mt-6 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!disposition || !optionAllowed(disposition, reviewer) || saving || reviewer.honorariumEligibility === 'unknown'}
              className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-gray-300"
            >
              {saving ? 'Saving…' : editing ? 'Save disposition' : 'Complete closeout'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export const _closeoutModalInternals = { optionAllowed };
