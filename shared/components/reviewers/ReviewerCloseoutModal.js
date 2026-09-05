import { useLayoutEffect, useRef, useState } from 'react';

export const CLOSEOUT_DISPOSITION_LABELS = Object.freeze({
  eligible: 'Eligible',
  not_eligible: 'Not eligible',
  not_applicable: 'Not applicable',
  unknown: 'Needs technical review',
});

const PAYMENT_OPTIONS = [
  { value: 'eligible', label: 'Yes' },
  { value: 'not_eligible', label: 'No' },
];

export function closeoutDispositionLabel(value) {
  if (value == null) return 'Closeout disposition not recorded';
  return CLOSEOUT_DISPOSITION_LABELS[value] || CLOSEOUT_DISPOSITION_LABELS.unknown;
}

function optionAllowed(option, reviewer) {
  const optedOut = reviewer?.honorariumOptOut === true;
  const hasHonorarium = Boolean(reviewer?.honorariumRequestId);
  if (option === 'eligible' || option === 'not_eligible') return !optedOut && hasHonorarium;
  if (option === 'not_applicable') return optedOut || !hasHonorarium;
  return false;
}

function honorariumApplies(reviewer) {
  return reviewer?.honorariumOptOut !== true && Boolean(reviewer?.honorariumRequestId);
}

function initialCloseoutDisposition(reviewer) {
  if (reviewer?.honorariumEligibility === 'unknown') return '';
  if (!honorariumApplies(reviewer)) return 'not_applicable';
  return reviewer?.honorariumEligibility === 'eligible'
    || reviewer?.honorariumEligibility === 'not_eligible'
    ? reviewer.honorariumEligibility
    : '';
}

export default function ReviewerCloseoutModal({
  isOpen,
  reviewer,
  proposal,
  requestId,
  canManage = true,
  previewReadOnly = false,
  onClose,
  onSaved,
}) {
  const initialDisposition = initialCloseoutDisposition(reviewer);
  const [disposition, setDisposition] = useState(initialDisposition);
  const [notes, setNotes] = useState(reviewer?.notes || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const savingRef = useRef(false);
  // Per-attempt supersession token: bumped only by a new save and unmount.
  // Separate from the committed-context epoch below, so a stale attempt's
  // finally can still release the save lock by generation match alone even
  // when its epoch no longer matches (see the Stage 6B1 action-lifetime
  // registry's beginAttempt/isAttemptCurrent/finishAttempt precedent in
  // ReviewerManagePanel.js).
  const generationRef = useRef(0);
  const mountedRef = useRef(false);
  const contextRef = useRef({
    isOpen,
    suggestionId: reviewer?.suggestionId,
    requestId,
    canManage,
    previewReadOnly,
    onSaved,
    onClose,
    epoch: 0,
  });

  useLayoutEffect(() => {
    const context = contextRef.current;
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
      context.epoch += 1;
    };
  }, []);

  // Committed session reconciliation: no dependency array, no cleanup, runs
  // on every commit (mirrors the reminder action's committed-props effect
  // and the Stage 6B1 registry pattern). The EPOCH bump is the full session
  // identity: open/close, reviewer/request identity, AND parent
  // management/read-only context all invalidate in-flight feedback/
  // callbacks, since a permission or preview-mode change means the attempt
  // was started under context that's no longer current. FORM REINIT is
  // narrower — only isOpen/reviewer identity/request identity reinitialize
  // disposition/notes/error from the CURRENT row. A management/read-only
  // flip alone must invalidate feedback but must NOT erase typed notes, so
  // it bumps the epoch without resetting the form. Same-row refresh (same
  // suggestionId, new object, new callbacks) is ordinary refresh either
  // way: it updates the latest callbacks here without touching
  // disposition/notes/error. This intentionally has no dependency array
  // (session identity is a multi-field comparison, not a single prop) and
  // conditionally calls setState, so react-hooks/exhaustive-deps cannot
  // infer a correct dependency list here.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const context = contextRef.current;
    const sessionChanged = context.isOpen !== isOpen
      || context.suggestionId !== reviewer?.suggestionId
      || context.requestId !== requestId
      || context.canManage !== canManage
      || context.previewReadOnly !== previewReadOnly;
    const formSessionChanged = context.isOpen !== isOpen
      || context.suggestionId !== reviewer?.suggestionId
      || context.requestId !== requestId;
    if (sessionChanged) {
      context.epoch += 1;
      setError(null);
    }
    if (formSessionChanged) {
      setDisposition(initialCloseoutDisposition(reviewer));
      setNotes(reviewer?.notes || '');
    }
    context.isOpen = isOpen;
    context.suggestionId = reviewer?.suggestionId;
    context.requestId = requestId;
    context.canManage = canManage;
    context.previewReadOnly = previewReadOnly;
    context.onSaved = onSaved;
    context.onClose = onClose;
  });

  if (!isOpen || !reviewer) return null;

  const isCurrent = (epoch) => mountedRef.current && epoch === contextRef.current.epoch;

  const editing = reviewer.reviewStatus === 'complete';
  const paymentDecisionRequired = honorariumApplies(reviewer);
  const notesRequired = disposition === 'not_eligible';
  const missingRequiredNotes = notesRequired && !notes.trim();
  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!disposition || !optionAllowed(disposition, reviewer) || savingRef.current) return;
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    const epoch = contextRef.current.epoch;
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
          notes,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (generation !== generationRef.current || !isCurrent(epoch)) return;
      if (!response.ok || !data.success) {
        setError(data.error || 'The reviewer closeout could not be saved. Reload and try again.');
        return;
      }
      // A confirmed save is never relabeled failed by what happens next.
      // Call the LATEST committed onSaved, observe a returned promise's
      // rejection (without surfacing request-error copy) but do NOT await
      // it: a slow/never-resolving refresh must not hold the modal open or
      // the save lock. Recheck currentness synchronously (a sync onSaved
      // may still have switched the session or unmounted), then call the
      // latest committed onClose only while still current.
      const latestOnSaved = contextRef.current.onSaved;
      if (latestOnSaved) {
        try {
          const result = latestOnSaved(data);
          if (result && typeof result.then === 'function') result.catch(() => {});
        } catch {
          // Swallow: confirmed save, callback/refresh failure only.
        }
      }
      if (!isCurrent(epoch)) return;
      const latestOnClose = contextRef.current.onClose;
      if (latestOnClose) latestOnClose();
    } catch (requestError) {
      if (generation === generationRef.current && isCurrent(epoch)) {
        setError(requestError.message || 'The reviewer closeout could not be saved.');
      }
    } finally {
      if (generation === generationRef.current) {
        savingRef.current = false;
        if (mountedRef.current) setSaving(false);
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

        {reviewer.honorariumEligibility === 'unknown' && (
          <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800" role="alert">
            The saved disposition is not recognized. Technical repair is required before it can be changed here.
          </p>
        )}

        <form className="mt-5" onSubmit={handleSubmit}>
          {paymentDecisionRequired ? (
            <fieldset disabled={saving || reviewer.honorariumEligibility === 'unknown'}>
              <legend className="text-sm font-semibold text-gray-900">Should an honorarium be paid?</legend>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {PAYMENT_OPTIONS.map((option) => (
                  <label
                    key={option.value}
                    className={`flex min-h-11 cursor-pointer items-center justify-center rounded-lg border px-4 py-2 text-sm font-semibold transition-colors focus-within:ring-2 focus-within:ring-blue-600 focus-within:ring-offset-2 ${disposition === option.value ? 'border-blue-700 bg-blue-700 text-white' : 'border-gray-300 bg-white text-gray-800 hover:border-gray-500 hover:bg-gray-50'}`}
                  >
                    <input
                      type="radio"
                      name="closeout-disposition"
                      value={option.value}
                      checked={disposition === option.value}
                      onChange={(event) => setDisposition(event.target.value)}
                      className="sr-only"
                    />
                    {option.label}
                  </label>
                ))}
              </div>
            </fieldset>
          ) : (
            <p className="text-sm text-gray-600">
              {reviewer.honorariumOptOut
                ? 'The reviewer opted out, so no honorarium decision is needed.'
                : 'No honorarium is linked, so no payment decision is needed.'}
            </p>
          )}

          <div className="mt-5">
            <label htmlFor="reviewer-closeout-notes" className="block text-sm font-semibold text-gray-900">
              Closeout notes{' '}
              <span className={`font-normal ${notesRequired ? 'text-red-700' : 'text-gray-500'}`}>
                ({notesRequired ? 'required' : 'optional'})
              </span>
            </label>
            <p id="reviewer-closeout-notes-help" className="mt-1 text-xs leading-5 text-gray-500">
              {notesRequired
                ? 'Explain why an honorarium should not be paid.'
                : 'Add context about timeliness, review quality, or conduct when useful.'}
            </p>
            <textarea
              id="reviewer-closeout-notes"
              aria-describedby="reviewer-closeout-notes-help"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              maxLength={2000}
              required={notesRequired}
              aria-invalid={missingRequiredNotes ? 'true' : undefined}
              rows={3}
              disabled={saving || reviewer.honorariumEligibility === 'unknown'}
              className="mt-2 block w-full resize-y rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20 disabled:bg-gray-100 disabled:text-gray-500"
              placeholder={notesRequired ? 'Reason an honorarium should not be paid' : 'Add context when useful'}
            />
          </div>

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
              disabled={!disposition || !optionAllowed(disposition, reviewer) || missingRequiredNotes || saving || reviewer.honorariumEligibility === 'unknown'}
              className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-gray-300"
            >
              {saving ? 'Saving…' : editing ? 'Save closeout' : 'Complete closeout'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export const _closeoutModalInternals = { honorariumApplies, initialCloseoutDisposition, optionAllowed };
