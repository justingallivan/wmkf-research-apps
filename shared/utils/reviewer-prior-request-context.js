const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function priorRequestCycleLabel(request) {
  const meetingDate = typeof request?.meetingDate === 'string' ? request.meetingDate.trim() : '';
  const match = /^(\d{4})-(\d{2})(?:-\d{2})?/.exec(meetingDate);
  if (match) {
    const month = Number(match[2]);
    if (month >= 1 && month <= 12) return `${MONTHS[month - 1]} ${match[1]}`;
  }
  return typeof request?.fiscalYear === 'string' && request.fiscalYear.trim()
    ? request.fiscalYear.trim()
    : null;
}

export function priorRequestReference(request, { includeTitle = true } = {}) {
  const requestNumber = typeof request?.requestNumber === 'string' && request.requestNumber.trim()
    ? `#${request.requestNumber.trim()}`
    : 'a prior request';
  const title = includeTitle && typeof request?.title === 'string' && request.title.trim()
    ? ` — ${request.title.trim()}`
    : '';
  const cycle = priorRequestCycleLabel(request);
  return `${requestNumber}${title}${cycle ? ` (${cycle})` : ''}`;
}

export function priorRequestRows(context) {
  return Array.isArray(context?.requests)
    ? context.requests.filter((request) => request && typeof request === 'object').slice(0, 3)
    : [];
}

export function priorRequestCardSummary(context) {
  const requests = priorRequestRows(context);
  if (requests.length === 0) return null;
  const mostRecent = priorRequestReference(requests[0]);
  if (context?.complete === true && Number.isInteger(context.totalCount) && context.totalCount > 1) {
    return `Already in AkoyaGO. Linked to ${context.totalCount} prior requests; most recent: ${mostRecent}.`;
  }
  if (context?.complete !== true) {
    return `Already in AkoyaGO. Previously listed as a potential reviewer on ${mostRecent}. Additional request history may be available.`;
  }
  return `Already in AkoyaGO. Previously listed as a potential reviewer on ${mostRecent}.`;
}
