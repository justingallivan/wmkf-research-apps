import SystemAlertsSection from '../SystemAlertsSection';
import OperationalEventsSection from '../OperationalEventsSection';
import MaintenanceSection from '../MaintenanceSection';
import SecretExpirationSection from '../SecretExpirationSection';
import ResourceLinks from '../ResourceLinks';
import { AdminEditorPanel } from '../AdminWorkspaceNavigation';
import AlertRecipientsSection from '../AlertRecipientsSection';
import DynamicsFeedbackSection from '../DynamicsFeedbackSection';
import DynamicsExplorerRestrictionsSection from '../DynamicsExplorerRestrictionsSection';
import HealthSection from '../HealthSection';
import HealthHistorySection from '../HealthHistorySection';
import { appSystemSettingField } from '../DataverseFieldInfoButton';

const ALERT_RECIPIENT_DATAVERSE_FIELDS = [
  appSystemSettingField(
    'Per-category recipient JSON',
    'alertRecipientsByCategory',
    'The active-superuser fallback roster is Postgres-backed, not Dataverse.',
  ),
];

export function OperationsWorkspace({ view }) {
  switch (view) {
    case 'incidents':
      return (
        <div className="space-y-6">
          <SystemAlertsSection />
          <OperationalEventsSection />
        </div>
      );
    case 'jobs':
      return <MaintenanceSection />;
    case 'credentials':
      return (
        <div className="space-y-6">
          <SecretExpirationSection />
          <ResourceLinks
            title="Credential resources"
            links={[
              { name: 'Vercel dashboard', href: 'https://vercel.com/dashboard', description: 'Deployment settings, logs, and environment configuration.', external: true },
            ]}
          />
        </div>
      );
    case 'notifications':
      return (
        <AdminEditorPanel
          id="alert-recipients"
          title="System alert recipients"
          description="Route operational alerts to the appropriate internal recipients by category."
          scope="Global"
          dataverseFields={ALERT_RECIPIENT_DATAVERSE_FIELDS}
        >
          <AlertRecipientsSection />
        </AdminEditorPanel>
      );
    case 'feedback':
      return <DynamicsFeedbackSection />;
    case 'dynamics-safeguards':
      return (
        <AdminEditorPanel
          id="dynamics-explorer-safeguards"
          title="Dynamics Explorer data safeguards"
          description="Control what Dynamics Explorer can query or export. These settings do not change a user&apos;s underlying Dynamics permissions."
          scope="Global Explorer policy"
        >
          <DynamicsExplorerRestrictionsSection />
        </AdminEditorPanel>
      );
    case 'health':
    default:
      return (
        <div className="space-y-6">
          <HealthSection />
          <HealthHistorySection />
        </div>
      );
  }
}
