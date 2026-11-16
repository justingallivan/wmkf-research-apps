import { useState } from 'react';
import { AdminEditorPanel } from '../AdminWorkspaceNavigation';
import TestRequestEmailAllowlistSection from '../TestRequestEmailAllowlistSection';
import TestRequestFactorySection from '../TestRequestFactorySection';
import { appSystemSettingField } from '../DataverseFieldInfoButton';

const TEST_REQUEST_EMAIL_ALLOWLIST_DATAVERSE_FIELDS = [
  appSystemSettingField(
    'Test-request email allowlist',
    'testRequestEmailAllowlist',
    'JSON { addresses: [...] }. @wmkeck.org is always allowed in code and is not stored here.',
  ),
];

export function TestRequestsWorkspace() {
  // The Factory section learns the deployment's target from its own runs request.
  const [factoryTarget, setFactoryTarget] = useState(null);
  const factoryScope = factoryTarget ? `${factoryTarget === 'production' ? 'Production' : 'Sandbox'} data · Writes` : 'Writes';
  return (
    <div className="space-y-6">
      <AdminEditorPanel
        id="test-request-factory"
        title="Create a test Request"
        description="Choose a source Request, create a marked test copy of it, then prepare the copy for review so it appears in the Workbench. Each step writes real data."
        scope={factoryScope}
      >
        <TestRequestFactorySection onTarget={setFactoryTarget} />
      </AdminEditorPanel>
      <AdminEditorPanel
        id="test-request-email-allowlist"
        title="Test-request email allowlist"
        description="Who may receive email about a test request, for testing and training. Everyone else is refused."
        scope="Global setting"
        dataverseFields={TEST_REQUEST_EMAIL_ALLOWLIST_DATAVERSE_FIELDS}
      >
        <TestRequestEmailAllowlistSection />
      </AdminEditorPanel>
    </div>
  );
}
