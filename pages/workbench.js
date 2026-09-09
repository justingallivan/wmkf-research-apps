/**
 * Request Workbench — the single-page shell (see
 * shared/components/workbench/WorkbenchShell.js). The URL carries the view,
 * Grant Program, cycle, and per-view filters so back navigation and shared
 * links land on exactly what the PD saw.
 */

import RequireAppAccess from '../shared/components/RequireAppAccess';
import { WorkbenchShell } from '../shared/components/workbench/WorkbenchShell';
import { resolvePreviewReadOnly } from '../lib/services/workbench/preview-read-only';

export async function getServerSideProps() {
  return { props: { previewReadOnly: resolvePreviewReadOnly() } };
}

export default function WorkbenchGuard(props) {
  return (
    <RequireAppAccess appKey="reviewers">
      <WorkbenchShell {...props} />
    </RequireAppAccess>
  );
}
