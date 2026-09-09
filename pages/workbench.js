/**
 * Request Workbench — the single-page shell (see
 * shared/components/workbench/WorkbenchShell.js). The URL carries the view,
 * Grant Program, cycle, and per-view filters so back navigation and shared
 * links land on exactly what the PD saw.
 */

import RequireAppAccess from '../shared/components/RequireAppAccess';
import { WorkbenchShell } from '../shared/components/workbench/WorkbenchShell';

export default function WorkbenchGuard() {
  return (
    <RequireAppAccess appKey="reviewers">
      <WorkbenchShell />
    </RequireAppAccess>
  );
}
