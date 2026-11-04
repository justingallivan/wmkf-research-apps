/**
 * Edit a prompt's catalog details (title, description, group, section, used by,
 * usage) in place. Saves only those six fields on the loaded row; no new version.
 * The parent owns reloading and outcome display. Server contract:
 * lib/services/admin/prompts-catalog-service.js (PATCH /api/admin/prompts/[name]).
 */
import { useState } from 'react';
import { requestEnvelope } from '../../utils/api-request';
import { TONE } from './prompt-editor-utils';
import { ADMIN_PROMPT_GROUPS, ADMIN_PROMPT_USAGES } from '../../config/adminPromptCatalog';

const LIMITS = { title: 200, description: 4000, usedBy: 4000 };
const USAGE_LABELS = {
  application: 'Application caller',
  'power-automate': 'Power Automate flow',
  reference: 'Stored reference',
  diagnostic: 'Developer diagnostic',
  unconnected: 'No application caller',
  uncataloged: 'Not cataloged',
};
const FIELDS = ['title', 'description', 'group', 'section', 'usedBy', 'usage'];

function initialValues(prompt) {
  const stored = prompt.catalog || {};
  return Object.fromEntries(FIELDS.map((key) => [key, stored[key] || '']));
}

function validate(values, groups) {
  const issues = [];
  for (const [key, max] of Object.entries(LIMITS)) {
    if (values[key].trim().length > max) issues.push(`${key === 'usedBy' ? 'Used by' : key[0].toUpperCase() + key.slice(1)} must be at most ${max} characters.`);
  }
  const group = groups.find((candidate) => candidate.id === values.group);
  if (group?.sections && !group.sections.some((section) => section.id === values.section)) {
    issues.push(`Choose a section for ${group.label}.`);
  }
  return issues;
}

export default function PromptCatalogForm({ prompt, fallback, groups = ADMIN_PROMPT_GROUPS, onSuccess, onOutcome, onCancel }) {
  const [values, setValues] = useState(() => initialValues(prompt));
  const [submitting, setSubmitting] = useState(false);
  const set = (key) => (event) => {
    const value = event.target.value;
    setValues((current) => (key === 'group' ? { ...current, group: value, section: '' } : { ...current, [key]: value }));
  };
  const group = groups.find((candidate) => candidate.id === values.group);
  const issues = validate(values, groups);
  const unchanged = FIELDS.every((key) => values[key].trim() === (prompt.catalog?.[key] || ''));

  const submit = async () => {
    setSubmitting(true);
    try {
      const catalog = Object.fromEntries(FIELDS.map((key) => [key, values[key].trim() || null]));
      if (!group?.sections) catalog.section = null;
      const envelope = await requestEnvelope(`/api/admin/prompts/${encodeURIComponent(prompt.name)}`, {
        method: 'PATCH',
        body: { rowId: prompt.id, expected: prompt.catalog || {}, catalog },
      });
      const { data } = envelope;
      if (data.status === 'catalog_updated') onSuccess({ status: data.status });
      else if (!envelope.ok && !data.status) onOutcome({ status: 'failed', error: envelope.error.message });
      else onOutcome({ status: data.status, error: data.error });
    } catch (err) {
      onOutcome({ status: 'failed', error: err.message });
    } finally {
      setSubmitting(false);
    }
  };

  const input = 'mt-1 w-full px-2 py-1.5 border border-gray-300 rounded text-sm';
  return (
    <div className="p-4 space-y-3">
      <p className="text-xs text-gray-500">
        These details describe the prompt in Admin. Saving changes them on the {prompt.hasCurrent ? 'current' : 'latest'} version without publishing a new one. A blank field shows the built-in description instead.
      </p>
      <label className="block text-xs text-gray-700">
        Title
        <input type="text" value={values.title} onChange={set('title')} maxLength={LIMITS.title} placeholder={fallback.title} className={input} />
      </label>
      <label className="block text-xs text-gray-700">
        Description
        <textarea value={values.description} onChange={set('description')} rows={3} placeholder={fallback.description} className={input} />
      </label>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block text-xs text-gray-700">
          Group
          <select value={values.group} onChange={set('group')} className={input}>
            <option value="">Built-in ({groups.find((candidate) => candidate.id === fallback.group)?.label || 'none'})</option>
            {groups.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.label}</option>)}
          </select>
        </label>
        {group?.sections && (
          <label className="block text-xs text-gray-700">
            Section
            <select value={values.section} onChange={set('section')} className={input}>
              <option value="">Choose a section</option>
              {group.sections.map((section) => <option key={section.id} value={section.id}>{section.label}</option>)}
            </select>
          </label>
        )}
        <label className="block text-xs text-gray-700">
          Usage
          <select value={values.usage} onChange={set('usage')} className={input}>
            <option value="">Built-in ({USAGE_LABELS[fallback.usage] || 'none'})</option>
            {ADMIN_PROMPT_USAGES.map((usage) => <option key={usage} value={usage}>{USAGE_LABELS[usage] || usage}</option>)}
          </select>
        </label>
      </div>
      <label className="block text-xs text-gray-700">
        Used by
        <textarea value={values.usedBy} onChange={set('usedBy')} rows={2} placeholder={fallback.usedBy} className={input} />
      </label>
      {issues.length > 0 && (
        <ul className={`text-xs px-3 py-2 rounded border list-disc pl-6 ${TONE.red}`}>
          {issues.map((issue) => <li key={issue}>{issue}</li>)}
        </ul>
      )}
      <div className="flex items-center justify-end gap-3">
        <button type="button" onClick={onCancel} className="text-xs text-gray-600 hover:text-gray-900">Cancel</button>
        <button
          type="button"
          onClick={submit}
          disabled={submitting || unchanged || issues.length > 0 || !prompt.id}
          className="px-4 py-1.5 bg-gray-900 text-white text-sm font-medium rounded hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {submitting ? 'Saving…' : 'Save details'}
        </button>
      </div>
    </div>
  );
}
