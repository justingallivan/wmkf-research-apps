/**
 * Request Workbench — the single-page shell (see
 * shared/components/workbench/WorkbenchShell.js). The URL carries the view,
 * Grant Program, cycle, and per-view filters so back navigation and shared
 * links land on exactly what the PD saw.
 */

import RequireAppAccess from '../shared/components/RequireAppAccess';
import { WorkbenchShell } from '../shared/components/workbench/WorkbenchShell';
import { j27IntegrityTarget } from '../lib/utils/j27-integrity-readiness';
import { resolvePreviewReadOnly } from '../lib/services/workbench/preview-read-only';
import { workbenchPhaseReleaseAdmitted } from '../lib/utils/workbench-phase-release';

export async function getServerSideProps() {
  return { props: {
    previewReadOnly: resolvePreviewReadOnly(),
    j27IntegrityEnabled: Boolean(j27IntegrityTarget()),
    phaseRelease: workbenchPhaseReleaseAdmitted(),
  } };
}

export default function WorkbenchGuard(props) {
  return (
    <RequireAppAccess appKey="reviewers">
      <WorkbenchShell {...props} />
    </RequireAppAccess>
  );
}
