/**
 * Request Workbench — Status tab (read-only).
 *
 * Reflects the proposal's own Dynamics lifecycle string (`akoya_requeststatus`)
 * and the canonical class the server derived from it (`statusClass`, via the
 * shared value→class map in lib/services/dataverse-export/constants.js). This is
 * a DISPLAY surface only: staff *recommend*, the board *decides*, and the
 * decision is recorded in Dynamics elsewhere — the Workbench never edits it
 * (REQUEST_WORKBENCH_SCOPING.md §3.4).
 *
 * The taxonomy is living: a status present but absent from the authoritative map
 * arrives as `UNCLASSIFIED` and is shown raw, never coerced to a nearby bucket.
 */

import { Card } from '../Layout';

// STATUS_CLASS (server enum) → display metadata. Total over the known classes;
// any unrecognised class falls back to neutral so a new server-side class can
// never break the render (it just shows the raw status without a colored badge).
export const CLASS_META = {
  IN_FLIGHT: { label: 'In review', cls: 'bg-blue-100 text-blue-800', blurb: 'Undecided — still in the review pipeline.' },
  DECIDED_AWARD: { label: 'Awarded', cls: 'bg-green-100 text-green-800', blurb: 'Decided and funded.' },
  DECIDED_NO_AWARD: { label: 'Not funded', cls: 'bg-gray-200 text-gray-700', blurb: 'Decided — declined or ineligible (no award).' },
  WITHDRAWN: { label: 'Withdrawn', cls: 'bg-gray-200 text-gray-700', blurb: 'Terminal — no decision, no award. The cause (applicant vs. administrative) is not recorded.' },
  UNCLASSIFIED: { label: 'Unclassified', cls: 'bg-amber-100 text-amber-800', blurb: 'This status isn’t in the workbench’s known set — shown raw, not interpreted.' },
};

// Colored class pill, shared with the Overview tab. Renders nothing if the class
// is unknown (a new server class shows as the raw status with no badge).
export function StatusBadge({ statusClass }) {
  const meta = CLASS_META[statusClass];
  if (!meta) return null;
  return <span className={`inline-flex min-h-6 items-center text-[11px] px-2 py-0.5 rounded-full font-semibold ${meta.cls}`}>{meta.label}</span>;
}

export default function StatusTab({ context }) {
  if (!context) {
    return (
      <Card hover={false}>
        <p className="text-sm text-gray-500">Loading status…</p>
      </Card>
    );
  }

  const status = typeof context.requestStatus === 'string' ? context.requestStatus : null;
  const meta = status ? (CLASS_META[context.statusClass] || null) : null;

  return (
    <Card hover={false}>
      <h2 className="text-base font-semibold text-gray-900 mb-3">Status</h2>

      {status ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-lg font-semibold text-gray-900">{status}</span>
            <StatusBadge statusClass={context.statusClass} />
          </div>
          {meta && <p className="text-sm text-gray-600">{meta.blurb}</p>}
        </div>
      ) : (
        <p className="text-sm text-gray-500">No status on this request.</p>
      )}

      <p className="mt-4 text-xs text-gray-400 border-t border-gray-100 pt-3">
        Read-only reflection of the proposal’s Dynamics lifecycle status. Staff recommend; the board decides, and
        the decision is recorded in Dynamics — it can’t be changed here.
      </p>
    </Card>
  );
}
