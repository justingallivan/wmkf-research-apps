/**
 * One toned outcome band, shared by PoliciesSection (publish outcomes) and
 * EmailDefaultsSection (section-level load/save errors). Extracted from
 * PoliciesSection's original inline banner (Build E, Item 4) so both
 * sections read the same way.
 */
const TONE_CLASSES = {
  green: 'bg-green-50 text-green-800 border-green-200',
  amber: 'bg-amber-50 text-amber-800 border-amber-200',
  red: 'bg-red-50 text-red-800 border-red-200',
  gray: 'bg-gray-50 text-gray-800 border-gray-200',
};

export default function OutcomeBanner({ tone = 'gray', text, children, onDismiss }) {
  return (
    <div className={`rounded-lg border p-3 text-sm ${TONE_CLASSES[tone] || TONE_CLASSES.gray}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="font-medium">{text}</div>
          {children}
        </div>
        {onDismiss && (
          <button type="button" onClick={onDismiss} className="text-xs underline">
            Dismiss
          </button>
        )}
      </div>
    </div>
  );
}
