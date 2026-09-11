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
  if (summary.state === 'ready') return `Materials: ready (${counts}).`;
  if (summary.state === 'closed') return `Materials: closed, ${counts}.`;
  if (!summary.invited) return `Materials: invitation not sent (${counts}).`;
  if (summary.state === 'received') return `Materials: ${counts}, awaiting confirmation.`;
  const due = shortDate(summary.dueAt);
  if (summary.overdue) return `Materials: ${counts} · overdue${due ? ` (due ${due})` : ''}.`;
  return `Materials: ${counts}${due ? ` · due ${due}` : ''}.`;
}
