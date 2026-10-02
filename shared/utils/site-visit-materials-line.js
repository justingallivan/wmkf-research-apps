/**
 * One-line applicant-materials status for staff list surfaces (plan §16.3,
 * PR 3): the Staff Deliberations tab and cycle view, and the tracker list row.
 * Copy is code-owned; the checklist labels stay in the collection.
 */

function shortDate(iso) {
  const ms = Date.parse(iso || '');
  return Number.isFinite(ms) ? new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
}

/**
 * @param {{ state: string, receivedCount: number, requiredCount: number, dueAt: string, overdue: boolean, invited: boolean }|null} summary
 * @returns {string|null} null when there is no collection to speak of.
 */
export function siteVisitMaterialsLine(summary) {
  if (!summary) return null;
  const counts = `${summary.receivedCount} of ${summary.requiredCount} received`;
  const attentionCount = Number.isSafeInteger(summary.attentionCount) ? summary.attentionCount : 0;
  const processingCount = Number.isSafeInteger(summary.processingCount) ? summary.processingCount : 0;
  const activity = [
    attentionCount ? `${attentionCount} upload${attentionCount === 1 ? ' needs' : 's need'} coordinator attention` : '',
    processingCount ? `${processingCount} upload${processingCount === 1 ? '' : 's'} processing` : '',
  ].filter(Boolean).join(' · ');
  if (summary.state === 'closed') return `Materials: closed, ${counts}${activity ? ` · ${activity}` : ''}.`;
  if (summary.state === 'needs_attention' || attentionCount) return `Materials: ${counts} · ${activity || 'An upload needs coordinator attention'}.`;
  if (summary.state === 'processing' || processingCount) return `Materials: ${counts} · ${activity || 'An upload is processing'}.`;
  if (summary.state === 'ready') return `Materials: ready (${counts}).`;
  if (!summary.invited) return `Materials: invitation not sent (${counts}).`;
  if (summary.state === 'received') return `Materials: ${counts}, awaiting confirmation.`;
  const due = shortDate(summary.dueAt);
  if (summary.overdue) return `Materials: ${counts} · overdue${due ? ` (due ${due})` : ''}.`;
  return `Materials: ${counts}${due ? ` · due ${due}` : ''}.`;
}
