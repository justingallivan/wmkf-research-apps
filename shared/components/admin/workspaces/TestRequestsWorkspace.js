import { useState } from 'react';
import { AdminEditorPanel } from '../AdminWorkspaceNavigation';
import TestRequestEmailAllowlistSection from '../TestRequestEmailAllowlistSection';
import TestRequestPreviewSection from '../TestRequestPreviewSection';
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
        id="test-request-email-allowlist"
        title="Test-request email allowlist"
        description="Who may receive email about a test request, for testing and training. Everyone else is refused."
        scope="Global setting"
        dataverseFields={TEST_REQUEST_EMAIL_ALLOWLIST_DATAVERSE_FIELDS}
      >
        <TestRequestEmailAllowlistSection />
      </AdminEditorPanel>
      <AdminEditorPanel
        id="test-request-preview"
        title="Basic Request clone preview"
        description="Resolve one sandbox Request, choose proposal files, and inspect the server-controlled field and filename plan. This panel has no create or copy action."
        scope="Sandbox data · Shared files · Read-only"
      >
        <TestRequestPreviewSection />
      </AdminEditorPanel>
      <AdminEditorPanel
        id="test-request-factory"
        title="Create a test Request"
        description="Clone one production Request into a labelled test Request, step by step, then set its Phase I or Phase II status. Each step writes real data, so every control says why it is off."
        scope={factoryScope}
      >
        <TestRequestFactorySection onTarget={setFactoryTarget} />
      </AdminEditorPanel>
    </div>
  );
}
