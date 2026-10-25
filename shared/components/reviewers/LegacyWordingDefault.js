/** Legacy field-override storage, presented independently from one-send copy. */
import EmailWordingDefault from '../EmailWordingDefault';
import { loadEmailTemplateState, saveEmailTemplateFamily } from './email-template-store';
export default function LegacyWordingDefault({ type, ...props }) {
  return <EmailWordingDefault {...props} scopeKey={`${props.scopeKey || ''}:${type}`}
    load={async () => {
      const state = await loadEmailTemplateState();
      return { template: state.templates[type], shared: state.shared[type], configured: Boolean(state.raw[type]),
        canWrite: state.sharedAvailable && ['configured', 'absent'].includes(state.ownStatus),
        notice: !['configured', 'absent'].includes(state.ownStatus) ? 'Your saved wording could not be loaded. Showing shared wording where available. Retry before changing your default.' : !state.sharedAvailable ? 'Shared wording could not be loaded. Retry before changing your default.' : null };
    }} write={({ template, changedFields, clear }) => saveEmailTemplateFamily(type, template, changedFields, clear)} />;
}
