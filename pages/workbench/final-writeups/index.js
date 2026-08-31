import RequireAppAccess from '../../../shared/components/RequireAppAccess';
import { FinalWriteupsDashboardView } from '../../../shared/components/final-writeups/FinalWriteupsViews';

export default function FinalWriteupsDashboardPage() {
  return (
    <RequireAppAccess appKey="reviewers">
      <FinalWriteupsDashboardView />
    </RequireAppAccess>
  );
}
