/** Pure row classification shared by the tracker pill and its filter counts. */
export const MATERIALS_STATUS = Object.freeze({
  NOT_REQUESTED: 'not_requested', WAITING: 'waiting', LATE: 'late',
  CHECK_FILES: 'check_files', READY: 'ready', CLOSED: 'closed',
  NO_VISIT: 'no_visit', UNAVAILABLE: 'unavailable',
});

const STATES = new Set(['missing', 'received', 'ready', 'closed']);

function validSummary(summary) {
  return summary && typeof summary === 'object' && !Array.isArray(summary)
    && STATES.has(summary.state)
    && typeof summary.invited === 'boolean'
    && typeof summary.overdue === 'boolean'
    && Number.isFinite(summary.receivedCount) && summary.receivedCount >= 0
    && Number.isFinite(summary.requiredCount) && summary.requiredCount >= 0
    && summary.receivedCount <= summary.requiredCount;
}

export function classifySiteVisitMaterialsStatus(summary, { availability = 'available', hasSiteVisit = false } = {}) {
  if (availability !== 'available' || (summary !== null && !validSummary(summary))) {
    return { key: MATERIALS_STATUS.UNAVAILABLE, label: 'Status unavailable', tone: 'neutral' };
  }
  if (summary === null) {
    return hasSiteVisit
      ? { key: MATERIALS_STATUS.NOT_REQUESTED, label: 'Not requested', tone: 'neutral' }
      : { key: MATERIALS_STATUS.NO_VISIT, label: 'No visit', tone: 'neutral' };
  }
  if (summary.state === 'closed') return { key: MATERIALS_STATUS.CLOSED, label: 'Closed', tone: 'neutral' };
  if (summary.state === 'ready') return { key: MATERIALS_STATUS.READY, label: 'Ready', tone: 'success' };
  if (!summary.invited) return { key: MATERIALS_STATUS.NOT_REQUESTED, label: 'Not requested', tone: 'neutral' };
  if (summary.state === 'received') return { key: MATERIALS_STATUS.CHECK_FILES, label: 'Check files', tone: 'warning' };
  if (summary.state === 'missing') {
    return summary.overdue
      ? { key: MATERIALS_STATUS.LATE, label: 'Late', tone: 'danger' }
      : { key: MATERIALS_STATUS.WAITING, label: 'Waiting', tone: 'info' };
  }
  return { key: MATERIALS_STATUS.UNAVAILABLE, label: 'Status unavailable', tone: 'neutral' };
}

export const MATERIALS_STATUS_FILTERS = Object.freeze([
  { key: 'not_requested', label: 'Not requested' }, { key: 'waiting', label: 'Waiting' },
  { key: 'late', label: 'Late' }, { key: 'check_files', label: 'Check files' }, { key: 'ready', label: 'Ready' },
]);
