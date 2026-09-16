import {
  AlertTriangle,
  CheckCircle2,
  FileCheck2,
  Info,
  XCircle,
} from 'lucide-react';
import {
  EMAIL_SEND_OUTCOME,
  EMAIL_SEND_OUTCOME_COPY,
  isEmailSendOutcome,
} from '../utils/email-send-outcome';

const APPEARANCE = Object.freeze({
  [EMAIL_SEND_OUTCOME.SENT]: {
    icon: CheckCircle2,
    shell: 'border-green-200 bg-green-50 text-green-950',
    iconClass: 'text-green-700',
  },
  [EMAIL_SEND_OUTCOME.DRAFT]: {
    icon: FileCheck2,
    shell: 'border-blue-200 bg-blue-50 text-blue-950',
    iconClass: 'text-blue-700',
  },
  [EMAIL_SEND_OUTCOME.FAILED]: {
    icon: XCircle,
    shell: 'border-red-200 bg-red-50 text-red-950',
    iconClass: 'text-red-700',
  },
  [EMAIL_SEND_OUTCOME.UNCERTAIN]: {
    icon: AlertTriangle,
    shell: 'border-amber-200 bg-amber-50 text-amber-950',
    iconClass: 'text-amber-700',
  },
  [EMAIL_SEND_OUTCOME.PARTIAL]: {
    icon: AlertTriangle,
    shell: 'border-amber-200 bg-amber-50 text-amber-950',
    iconClass: 'text-amber-700',
  },
  [EMAIL_SEND_OUTCOME.INFO]: {
    icon: Info,
    shell: 'border-blue-200 bg-blue-50 text-blue-950',
    iconClass: 'text-blue-700',
  },
});

/**
 * Consistent, accessible feedback for a completed email action.
 * Color reinforces the state; the icon, heading, and copy carry its meaning.
 */
export default function EmailSendFeedback({
  status,
  title,
  message,
  details = [],
  compact = false,
  className = '',
  'data-testid': testId,
}) {
  const resolvedStatus = isEmailSendOutcome(status) ? status : EMAIL_SEND_OUTCOME.INFO;
  const appearance = APPEARANCE[resolvedStatus];
  const defaults = EMAIL_SEND_OUTCOME_COPY[resolvedStatus];
  const Icon = appearance.icon;
  const visibleDetails = Array.isArray(details) ? details.filter(Boolean) : [];
  const role = resolvedStatus === EMAIL_SEND_OUTCOME.FAILED ? 'alert' : 'status';

  return (
    <div
      role={role}
      aria-live={role === 'alert' ? 'assertive' : 'polite'}
      aria-atomic="true"
      data-testid={testId}
      className={`rounded-lg border ${appearance.shell} ${compact ? 'px-3 py-2' : 'p-3'} ${className}`.trim()}
    >
      <div className="flex min-w-0 items-start gap-2.5">
        <Icon aria-hidden="true" className={`mt-0.5 h-4 w-4 shrink-0 ${appearance.iconClass}`} strokeWidth={2} />
        <div className="min-w-0 break-words text-sm">
          <p className="font-semibold leading-5">{title || defaults.title}</p>
          {(message || defaults.message) && (
            <p className="mt-0.5 leading-5 opacity-90">{message || defaults.message}</p>
          )}
          {visibleDetails.length > 0 && (
            <ul className="mt-2 space-y-1 pl-4 text-xs leading-5 [list-style-type:disc]">
              {visibleDetails.map((detail, index) => <li key={`${detail}-${index}`}>{detail}</li>)}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
