/**
 * Create a brand-new prompt and publish it as v1 (owner decision 2026-11-02:
 * no draft step). `{{placeholders}}` are declared on the server automatically.
 * The parent owns reloading and outcome display. Server contract: createPrompt
 * in lib/services/admin/prompts-publish-service.js (POST /api/admin/prompts).
 */
import { useRef, useState } from 'react';
import { validatePromptForSave } from '../../../lib/utils/prompt-validators';
import { requestEnvelope } from '../../utils/api-request';
import { TONE, newRequestId, fmtInt } from './prompt-editor-utils';
import { ADMIN_PROMPT_GROUPS, ADMIN_PROMPT_USAGES } from '../../config/adminPromptCatalog';
import {
  buildModelOptions, modelOutputCeiling, validateMaxTokensInput, validateOutputSchemaText,
} from './PromptPublishForm';

// Mirrors createPrompt's name rule.
const NAME_RE = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const MAX_NAME_LEN = 64;
const PLACEHOLDER_RE = /\{\{\s*(\w+)\s*\}\}/g;
const USAGE_LABELS = {
  application: 'Application caller',
  reference: 'Stored reference',
  diagnostic: 'Developer diagnostic',
  unconnected: 'No application caller',
};

export default function AddPromptForm({ existingNames, modelCatalog, onCreated, onOutcome, onCancel }) {
  const [values, setValues] = useState({
    name: '', title: '', description: '', group: '', section: '', usedBy: '', usage: 'unconnected',
    systemPrompt: '', body: '', model: '', maxTokens: '', outputSchema: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const requestRef = useRef({ payloadKey: null, requestId: null });
  const set = (key) => (event) => {
    const value = event.target.value;
    setValues((current) => (key === 'group' ? { ...current, group: value, section: '' } : { ...current, [key]: value }));
  };

  const name = values.name.trim();
  const group = ADMIN_PROMPT_GROUPS.find((candidate) => candidate.id === values.group);
  const { nativeStructured, options: modelOptions } = buildModelOptions({ model: null, outputSchema: values.outputSchema.trim() }, modelCatalog);
  const maxTokens = validateMaxTokensInput(values.maxTokens, modelOutputCeiling(values.model, modelCatalog));
  const outputSchema = validateOutputSchemaText(values.outputSchema.trim());
  const placeholders = [...new Set([...`${values.systemPrompt}\n${values.body}`.matchAll(PLACEHOLDER_RE)].map((m) => m[1]))];

  const issues = [];
  if (name && (name.length > MAX_NAME_LEN || !NAME_RE.test(name))) {
    issues.push(`Name must be lowercase letters and digits separated by dots or hyphens, at most ${MAX_NAME_LEN} characters.`);
  }
  if (name && existingNames.has(name)) issues.push(`A prompt named "${name}" already exists. Use Edit & publish to change it.`);
  if (group?.sections && !group.sections.some((section) => section.id === values.section)) issues.push(`Choose a section for ${group.label}.`);
  if (values.body.trim()) issues.push(...validatePromptForSave(name, values.body).issues);
  if (!maxTokens.valid) issues.push(maxTokens.issue);
  if (!outputSchema.valid) issues.push(outputSchema.issue);
  if (nativeStructured && !modelOptions.some((option) => option.value === values.model && !option.disabled)) {
    issues.push('This output schema uses native structured output: choose a compatible concrete model.');
  }
  const ready = name && values.title.trim() && values.body.trim() && issues.length === 0;

  const submit = async () => {
    setSubmitting(true);
    try {
      const body = {
        name,
        catalog: {
          title: values.title.trim(),
          description: values.description.trim() || null,
          group: values.group || null,
          section: group?.sections ? values.section || null : null,
          usedBy: values.usedBy.trim() || null,
          usage: values.usage || null,
        },
        systemPrompt: values.systemPrompt,
        body: values.body,
        outputSchema: values.outputSchema.trim(),
        model: values.model,
        ...(maxTokens.value != null ? { maxTokens: maxTokens.value } : {}),
      };
      // Same request id for a retry of the same content (duplicate-click safe).
      const payloadKey = JSON.stringify(body);
      if (requestRef.current.payloadKey !== payloadKey) requestRef.current = { payloadKey, requestId: newRequestId() };
      const envelope = await requestEnvelope('/api/admin/prompts', {
        method: 'POST',
        body: { ...body, requestId: requestRef.current.requestId },
      });
      const { data } = envelope;
      if (data.status === 'completed' || data.status === 'already_published') onCreated(data);
      else if (!envelope.ok && !data.status) onOutcome({ status: 'failed', warnings: [envelope.error.message] });
      else onOutcome(data);
    } catch (err) {
      onOutcome({ status: 'failed', warnings: [err.message] });
    } finally {
      setSubmitting(false);
    }
  };

  const input = 'mt-1 w-full px-2 py-1.5 border border-gray-300 rounded text-sm';
  const mono = `${input} font-mono text-xs`;
  return (
    <section aria-label="Add prompt" className="mb-6 border rounded-lg p-4 space-y-3 bg-white">
      <h3 className="font-medium text-gray-900">Add prompt</h3>
      <p className="text-xs text-gray-500">
        Creates a new prompt and publishes it as version 1. No application uses it until a developer connects it by name, so publishing it changes nothing that is already running. Later changes go through Edit &amp; publish.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs text-gray-700">
          Name
          <input type="text" value={values.name} onChange={set('name')} placeholder="grants.budget-check" className={`${input} font-mono`} />
          <span className="mt-1 block text-[10px] text-gray-400">Lowercase letters and digits, separated by dots or hyphens. It can&apos;t be changed later.</span>
        </label>
        <label className="block text-xs text-gray-700">
          Title
          <input type="text" value={values.title} onChange={set('title')} maxLength={200} className={input} />
        </label>
      </div>
      <label className="block text-xs text-gray-700">
        Description <span className="text-gray-400">(optional)</span>
        <textarea value={values.description} onChange={set('description')} rows={2} className={input} />
      </label>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block text-xs text-gray-700">
          Group
          <select value={values.group} onChange={set('group')} className={input}>
            <option value="">None</option>
            {ADMIN_PROMPT_GROUPS.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.label}</option>)}
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
            {ADMIN_PROMPT_USAGES.filter((usage) => USAGE_LABELS[usage]).map((usage) => <option key={usage} value={usage}>{USAGE_LABELS[usage]}</option>)}
          </select>
        </label>
      </div>
      <label className="block text-xs text-gray-700">
        Used by <span className="text-gray-400">(optional)</span>
        <input type="text" value={values.usedBy} onChange={set('usedBy')} className={input} />
      </label>
      <label className="block text-xs text-gray-700">
        System prompt <span className="text-gray-400">(the rules and instructions; optional)</span>
        <textarea value={values.systemPrompt} onChange={set('systemPrompt')} rows={10} className={mono} />
      </label>
      <label className="block text-xs text-gray-700">
        Prompt body
        <textarea value={values.body} onChange={set('body')} rows={10} className={mono} />
        <span className="mt-1 block text-[10px] text-gray-400">
          Write <code>{'{{name}}'}</code> where a value is filled in at run time. If you want the answer in a set format, such as a JSON example, put that example here or in the system prompt.
        </span>
      </label>
      <p className="text-xs text-gray-600">
        {placeholders.length > 0
          ? <>This prompt expects: {placeholders.map((p, i) => <span key={p}>{i > 0 && ', '}<code>{p}</code></span>)}. Whatever runs it must supply these values.</>
          : 'This prompt has no placeholders.'}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs text-gray-700">
          Model
          <select value={values.model} onChange={set('model')} className={input}>
            {!nativeStructured && <option value="">Use Executor fallback</option>}
            {nativeStructured && <option value="">Choose a model</option>}
            {modelOptions.map((option) => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)}
          </select>
        </label>
        <label className="block text-xs text-gray-700">
          Max output tokens <span className="text-gray-400">(optional)</span>
          <input type="number" min={1} step={1} inputMode="numeric" value={values.maxTokens} onChange={set('maxTokens')} className={input} />
          {modelOutputCeiling(values.model, modelCatalog) != null && (
            <span className="mt-1 block text-[10px] text-gray-400">Up to {fmtInt(modelOutputCeiling(values.model, modelCatalog))} for this model.</span>
          )}
        </label>
      </div>
      <label className="block text-xs text-gray-700">
        Output schema <span className="text-gray-400">(app settings; usually blank)</span>
        <textarea value={values.outputSchema} onChange={set('outputSchema')} rows={4} className={mono} />
        <span className="mt-1 block text-[10px] text-gray-400">
          Settings that tell the app how to read and store the reply. Leave blank unless a developer gives you one. This is not where an example of the answer goes.
        </span>
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
          disabled={submitting || !ready}
          className="px-4 py-1.5 bg-gray-900 text-white text-sm font-medium rounded hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {submitting ? 'Publishing…' : 'Create and publish v1'}
        </button>
      </div>
    </section>
  );
}
