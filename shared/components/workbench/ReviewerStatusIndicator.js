const STATUS_META = [
  { key: 'accepted', label: 'accepted', color: 'bg-green-500', text: 'text-green-700' },
  { key: 'pending', label: 'pending', color: 'bg-amber-400', text: 'text-amber-700' },
  { key: 'declined', label: 'declined', color: 'bg-red-500', text: 'text-red-700' },
  { key: 'uninvited', label: 'not invited', color: 'bg-gray-300', text: 'text-gray-500' },
];

const count = (value) => (Number.isFinite(value) && value > 0 ? Math.floor(value) : 0);

/**
 * Compact reviewer traffic-light for dashboard cards. Each reviewer contributes
 * one fixed-width unit, so the total bar width communicates how many were found;
 * segment widths communicate the status mix. Text keeps the signal usable without
 * color and preserves the accepted-reviewer goal.
 */
export default function ReviewerStatusIndicator({ reviewers = {} }) {
  const hasProgress = !!reviewers.progress && typeof reviewers.progress === 'object';
  const progress = reviewers.progress || {};
  const statuses = STATUS_META.map((status) => ({ ...status, count: count(progress[status.key]) }));
  const bucketTotal = statuses.reduce((sum, status) => sum + status.count, 0);
  const total = hasProgress ? (count(progress.total) || bucketTotal) : count(reviewers.candidates);
  const needed = count(reviewers.needed);
  const accepted = hasProgress
    ? statuses.find((status) => status.key === 'accepted')?.count || 0
    : count(reviewers.accepted);
  const ariaSummary = statuses
    .filter((status) => status.count > 0)
    .map((status) => `${status.count} ${status.label}`)
    .join(', ');
  const barWidth = Math.min(total * 18, 180);

  return (
    <div role="group" className="mt-1.5 flex flex-col items-end" aria-label={`${total} reviewers found${ariaSummary ? `: ${ariaSummary}` : ''}`}>
      <div className="text-xs text-gray-500">
        {accepted}{needed ? `/${needed}` : ''} accepted · {total} found
      </div>
      {hasProgress && total > 0 && (
        <>
          <div
            className="mt-1 flex h-2 overflow-hidden rounded-full bg-gray-100 ring-1 ring-inset ring-gray-200"
            style={{ width: `${barWidth}px` }}
            aria-hidden="true"
          >
            {statuses.filter((status) => status.count > 0).map((status) => (
              <span
                key={status.key}
                className={status.color}
                style={{ flexGrow: status.count, flexBasis: 0 }}
                title={`${status.count} ${status.label}`}
              />
            ))}
          </div>
          <div className="mt-1 flex max-w-[18rem] flex-wrap justify-end gap-x-2 text-[10px] leading-4">
            {statuses.filter((status) => status.count > 0).map((status) => (
              <span key={status.key} className={status.text}>{status.count} {status.label}</span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
