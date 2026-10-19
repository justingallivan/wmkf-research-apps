import Layout from '../shared/components/Layout';
import RequireAppAccess from '../shared/components/RequireAppAccess';
import StaffingPanel from '../shared/components/staffing/StaffingPanel';
export default function StaffingPage() {
  return <RequireAppAccess appKey="reviewers"><Layout title="Staffing"><div className="space-y-6 py-6"><header><h1 className="text-2xl font-semibold">Staffing</h1><p className="mt-1 text-gray-600">Manage shared staff assignments for Board workflows.</p></header><StaffingPanel /></div></Layout></RequireAppAccess>;
}
