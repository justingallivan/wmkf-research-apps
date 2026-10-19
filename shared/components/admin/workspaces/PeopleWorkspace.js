import StaffingPanel from '../../staffing/StaffingPanel';
import { AdminEditorPanel } from '../AdminWorkspaceNavigation';
import AppAccessSection from '../AppAccessSection';
import DynamicsIdentitySection from '../DynamicsIdentitySection';
import RoleManagementSection from '../RoleManagementSection';

export function PeopleWorkspace({ view }) {
  switch (view) {
    case 'staffing':
      return <StaffingPanel includeFinalWriteups />;
    case 'app-access':
      return (
        <AdminEditorPanel
          id="staff-app-access"
          title="Application access"
          description="Grant or revoke access by staff member. Changes are saved against the current canonical grant snapshot."
          scope="Per staff member"
        >
          <AppAccessSection />
        </AdminEditorPanel>
      );
    case 'identity':
      return (
        <AdminEditorPanel
          id="staff-identity-linkage"
          title="Dataverse identity linkage"
          description="Review active staff profiles and reconcile their Dataverse system-user identities."
          scope="Per staff member"
        >
          <DynamicsIdentitySection />
        </AdminEditorPanel>
      );
    case 'roles':
    default:
      return (
        <AdminEditorPanel
          id="staff-roles"
          title="Users and Dynamics Explorer roles"
          description="Assign internal Dynamics Explorer permissions. Removing a role returns the person to read-only access."
          scope="Per staff member"
        >
          <RoleManagementSection />
        </AdminEditorPanel>
      );
  }
}
