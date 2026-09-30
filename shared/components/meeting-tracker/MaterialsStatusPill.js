import { classifySiteVisitMaterialsStatus } from '../../utils/site-visit-materials-status';
import { Archive, CalendarX2, CheckCircle2, CircleHelp, Clock3, FileCheck2, MinusCircle, TriangleAlert } from 'lucide-react';

const TONE = {
  neutral: 'border-gray-300 bg-gray-50 text-gray-700', info: 'border-blue-200 bg-blue-50 text-blue-800',
  danger: 'border-red-200 bg-red-50 text-red-800', warning: 'border-amber-200 bg-amber-50 text-amber-900',
  success: 'border-green-200 bg-green-50 text-green-800',
};
const ICONS = { unavailable: CircleHelp, no_visit: CalendarX2, not_requested: MinusCircle, waiting: Clock3, late: TriangleAlert, check_files: FileCheck2, ready: CheckCircle2, closed: Archive };

export default function MaterialsStatusPill({ summary, availability, hasSiteVisit, requestMaterialsHref }) {
  const status = classifySiteVisitMaterialsStatus(summary, { availability, hasSiteVisit });
  const count = summary && Number.isFinite(summary.receivedCount) && Number.isFinite(summary.requiredCount)
    ? (summary.requiredCount === 0 ? 'No required items' : `${summary.receivedCount}/${summary.requiredCount}`) : null;
  const due = summary?.dueAt ? new Date(summary.dueAt) : null;
  const dueText = due && Number.isFinite(due.getTime()) ? ` · due ${due.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : '';
  const countText = count && summary?.requiredCount === 0 ? 'No required items' : count ? `${count} received` : null;
  const detail = status.key === 'unavailable'
    ? 'Reload this page to refresh materials.'
    : status.key === 'no_visit' ? 'Schedule a visit first.'
      : status.key === 'not_requested' ? (summary ? 'Invitation not sent.' : 'Request materials.')
        : countText ? `${countText}${summary?.state === 'received' ? '; awaiting confirmation' : ''}${status.key === 'waiting' || status.key === 'late' ? dueText : ''}.` : '';
  const Icon = ICONS[status.key] || CircleHelp;
  return (
    <div data-testid="materials-status" className="mt-1 flex flex-col items-start gap-1 text-sm">
      <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${TONE[status.tone] || TONE.neutral}`}>
        <Icon aria-hidden="true" size={14} strokeWidth={2} className="mr-1" />
        {status.label}
      </span>
      {status.key === 'not_requested' && !summary && requestMaterialsHref ? (
        <a href={requestMaterialsHref} data-full-page-navigation="true" className="rounded text-blue-700 underline underline-offset-2 hover:text-blue-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600">Request materials</a>
      ) : detail && <span className="text-gray-600">{detail}</span>}
      {status.key === 'check_files' && hasSiteVisit && requestMaterialsHref && (
        <a href={requestMaterialsHref} data-full-page-navigation="true" className="rounded text-blue-700 underline underline-offset-2 hover:text-blue-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600">Review materials</a>
      )}
    </div>
  );
}
