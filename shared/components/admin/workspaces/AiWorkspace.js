import { AdminEditorPanel } from '../AdminWorkspaceNavigation';
import ModelConfigSection from '../ModelConfigSection';
import PromptTemplatesSection from '../PromptTemplatesSection';
import UsageSection from '../UsageSection';
import ResourceLinks from '../ResourceLinks';
import { appSystemSettingPattern } from '../DataverseFieldInfoButton';

const MODEL_CONFIG_DATAVERSE_FIELDS = [
  appSystemSettingPattern(
    'Saved model override dropdown',
    'model_override:<appKey>:<modelType>',
    'Only saved overrides live here. Defaults, environment overrides, model registry status, and pricing are not stored in this Dataverse row.',
  ),
];

const PROMPT_SECTION_DATAVERSE_FIELDS = [
  {
    label: 'Prompt inventory and editable body',
    entity: 'wmkf_ai_prompt',
    entitySet: 'wmkf_ai_prompts',
    field: 'wmkf_ai_promptname / wmkf_promptversion / wmkf_ai_systemprompt / wmkf_ai_promptbody / wmkf_ai_iscurrent',
    row: 'Prompt panels are grouped by wmkf_ai_promptname.',
  },
];

export function AiWorkspace({ view }) {
  switch (view) {
    case 'models':
      return (
        <div className="space-y-6">
          <AdminEditorPanel
            id="ai-model-routing"
            title="Model routing"
            description="Set reviewed model overrides by application and capability. Defaults remain in effect where no override is saved."
            scope="Per application"
            dataverseFields={MODEL_CONFIG_DATAVERSE_FIELDS}
          >
            <ModelConfigSection />
          </AdminEditorPanel>
          <ResourceLinks
            title="AI resources"
            links={[
              { name: 'Anthropic console', href: 'https://console.anthropic.com', description: 'Provider usage and billing.', external: true },
            ]}
          />
        </div>
      );
    case 'prompts':
      return (
        <AdminEditorPanel
          id="ai-prompts"
          title="Prompts and execution budgets"
          description="Publish versioned prompt bodies and maintain the reviewed token and timeout limits coupled to them."
          scope="Per prompt"
          dataverseFields={PROMPT_SECTION_DATAVERSE_FIELDS}
        >
          <PromptTemplatesSection />
        </AdminEditorPanel>
      );
    case 'usage':
    default:
      return <UsageSection />;
  }
}
