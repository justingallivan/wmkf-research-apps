import { OTHER_TRIAGE_REASON } from '../../config/triageReasons';

export default function NotScoredReasonFields({ reason, otherRationale, options, maxLength = 10000, onReasonChange, onOtherRationaleChange, disabled = false }) {
  return (
    <div className="space-y-3">
      <label className="flex flex-col gap-1 text-sm font-medium text-gray-900">
        Reason
        <select className="min-h-10 w-full max-w-lg rounded-lg border border-gray-300 bg-white px-3"
          value={reason ?? ''} disabled={disabled} onChange={event => onReasonChange(Number(event.target.value))}>
          <option value="" disabled>Select a reason</option>
          {reason != null && !options.some(option => option.value === reason) && <option value={reason} disabled>Previously saved reason (unavailable)</option>}
          {options.map(({ value, label, available }) => <option key={value} value={value} disabled={!available}>{label}{!available ? ' (unavailable)' : ''}</option>)}
        </select>
      </label>
      {reason === OTHER_TRIAGE_REASON && (
        <label className="flex flex-col gap-1 text-sm font-medium text-gray-900">
          Other rationale
          <textarea className="w-full rounded-lg border border-gray-300 p-3 font-normal"
            rows={4} maxLength={maxLength} value={otherRationale} disabled={disabled}
            onChange={event => onOtherRationaleChange(event.target.value)} />
        </label>
      )}
    </div>
  );
}
