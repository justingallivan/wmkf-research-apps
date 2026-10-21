/** Prompt draft validation and versioned publication form; the parent owns loading and outcome display. */
import { useRef, useState } from 'react';
import { validatePromptForSave } from '../../../lib/utils/prompt-validators';
import { requestEnvelope } from '../../utils/api-request';
import { TONE, newRequestId, fmtInt, ROW_DEFAULT_MAX_TOKENS } from './prompt-editor-utils';

function parseOutputSchema(value) {
  try {
    return typeof value === 'string' ? JSON.parse(value) : value;
  } catch {
    return null;
  }
}

function validateOutputSchemaText(value) {
  if (value === '') return { valid: true, issue: null };
  const parsed = parseOutputSchema(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { valid: false, issue: 'Output schema must be blank or a valid JSON object.' };
  }
  return { valid: true, issue: null };
}

function buildModelOptions(prompt, modelCatalog) {
  const nativeStructured = parseOutputSchema(prompt.outputSchema)?.generationMode === 'native-json-schema';
  const statuses = modelCatalog?.modelStatuses || {};
  const options = [];
  if (!nativeStructured) {
    for (const tier of modelCatalog?.tiers || []) {
      options.push({ value: tier.key, label: `${tier.key} tier` });
    }
  }
  for (const candidate of modelCatalog?.availableModels || []) {
    const status = statuses[candidate.id];
    if (!status?.ok) continue;
    if (nativeStructured && status.capability?.supportsStructuredOutput !== true) continue;
    options.push({ value: candidate.id, label: candidate.display_name || candidate.id });
  }
  if (prompt.model && !options.some((option) => option.value === prompt.model)) {
    options.unshift({
      value: prompt.model,
      label: nativeStructured
        ? `${prompt.model} (current — incompatible; choose another)`
        : `${prompt.model} (current)`,
      disabled: nativeStructured,
    });
  }
  return { nativeStructured, options };
}

// Mirrors prompts-publish-service.js: the reviewed output ceiling of the
// selected model (a tier resolves to its current concrete model; a blank model
// has no knowable ceiling, so none is enforced).
function modelOutputCeiling(model, modelCatalog) {
  const raw = String(model || '').trim();
  if (!raw) return null;
  const tier = (modelCatalog?.tiers || []).find((t) => t.key === raw);
  const id = tier ? tier.resolvedId : raw;
  const ceiling = id ? modelCatalog?.modelStatuses?.[id]?.capability?.maxOutputTokens : null;
  return Number.isInteger(ceiling) ? ceiling : null;
}

// Blank is allowed (keeps the stored budget). Otherwise a positive whole number
// no larger than the selected model's ceiling.
function validateMaxTokensInput(text, ceiling) {
  const trimmed = String(text).trim();
  if (trimmed === '') return { valid: true, value: null };
  if (!/^\d+$/.test(trimmed) || Number(trimmed) <= 0) {
    return { valid: false, issue: 'Max tokens must be a positive whole number.' };
  }
  const value = Number(trimmed);
  if (ceiling != null && value > ceiling) {
    return { valid: false, issue: `Max tokens ${fmtInt(value)} exceeds this model's output limit of ${fmtInt(ceiling)}.` };
  }
  return { valid: true, value };
}

export default function PublishForm({ prompt, modelCatalog, onSuccess, onOutcome }) {
  const [systemPrompt, setSystemPrompt] = useState(prompt.systemPrompt || '');
  const [body, setBody] = useState(prompt.body || '');
  const [outputSchema, setOutputSchema] = useState(prompt.outputSchema || '');
  const [model, setModel] = useState(prompt.model || '');
  const initialMaxTokens = Number.isInteger(prompt.maxTokens) && prompt.maxTokens > 0 ? String(prompt.maxTokens) : '';
  const [maxTokensText, setMaxTokensText] = useState(initialMaxTokens);
  const [submitting, setSubmitting] = useState(false);
  const requestRef = useRef({ payloadKey: null, requestId: null });
  const { nativeStructured, options: modelOptions } = buildModelOptions(prompt, modelCatalog);
  const nativeModelCompatible = !nativeStructured
    || modelOptions.some((option) => option.value === model && !option.disabled);
  const outputSchemaValidation = validateOutputSchemaText(outputSchema);

  const modelCeiling = modelOutputCeiling(model, modelCatalog);
  const maxTokensValidation = validateMaxTokensInput(maxTokensText, modelCeiling);
  const validation = validatePromptForSave(prompt.name, body);
  const unchanged = maxTokensText.trim() === initialMaxTokens
    && body === (prompt.body || '')
    && systemPrompt === (prompt.systemPrompt || '')
    && outputSchema === (prompt.outputSchema || '')
    && model === (prompt.model || '');

  const submit = async () => {
    setSubmitting(true);
    try {
      const payloadKey = JSON.stringify({
        body,
        systemPrompt,
        outputSchema,
        model,
        maxTokens: maxTokensValidation.value,
        expectedVersion: prompt.version,
      });
      if (requestRef.current.payloadKey !== payloadKey) {
        requestRef.current = { payloadKey, requestId: newRequestId() };
      }
      // D1 fix: a non-2xx body with a recognized structured `data.status`
      // (concurrency_conflict, etc.) is still read as before — STATUS_COPY
      // already renders those correctly. A non-2xx body with NO `status`
      // field (a plain {error} body, or an unparseable body) now routes to
      // the same failed-outcome shape the catch below already uses, instead
      // of onOutcome(data) with status: undefined rendering a blank banner
      // (docs/plans/CLIENT_REQUEST_LAYER_D1_UNGUARDED_RESPONSES_2026-09-20.md).
      const envelope = await requestEnvelope(`/api/admin/prompts/${encodeURIComponent(prompt.name)}`, {
        method: 'PUT',
        body: {
          body,
          systemPrompt,
          outputSchema,
          model,
          // Omitted when blank so the server keeps the stored budget.
          ...(maxTokensValidation.value != null ? { maxTokens: maxTokensValidation.value } : {}),
          expectedVersion: prompt.version,
          requestId: requestRef.current.requestId,
        },
      });
      const { data } = envelope;
      if (data.status === 'completed' || data.status === 'already_published') onSuccess(data);
      else if (!envelope.ok && !data.status) onOutcome({ status: 'failed', warnings: [envelope.error.message] });
      else onOutcome(data);
    } catch (err) {
      onOutcome({ status: 'failed', warnings: [err.message] });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-4 space-y-3">
      <label className="block text-xs text-gray-700">
        Model
        <select
          value={model}
          onChange={(e) => setModel(e.target.value)}
          className="mt-1 w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
        >
          {!nativeStructured && <option value="">Use Executor fallback</option>}
          {modelOptions.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>
          ))}
        </select>
        <div className="mt-1 text-[10px] text-gray-400">
          {nativeStructured
            ? 'Native structured output: choose a reviewed compatible concrete model. Publishing creates a new prompt version.'
            : 'Choose a reviewed tier or concrete model. Publishing creates a new prompt version.'}
        </div>
      </label>

      <label className="block text-xs text-gray-700">
        Max output tokens
        <input
          type="number"
          min={1}
          step={1}
          inputMode="numeric"
          value={maxTokensText}
          onChange={(e) => setMaxTokensText(e.target.value)}
          placeholder={`default ${fmtInt(ROW_DEFAULT_MAX_TOKENS)}`}
          className="mt-1 w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
        />
        <div className="mt-1 text-[10px] text-gray-400">
          {modelCeiling != null
            ? `Whole number up to ${fmtInt(modelCeiling)} (the selected model's reviewed output limit).`
            : 'Whole number. The selected model has no reviewed output limit to check against.'}
          {' '}Leave blank to keep the stored value. Publishing creates a new prompt version.
        </div>
      </label>

      {!maxTokensValidation.valid && (
        <div className={`text-xs px-3 py-2 rounded border ${TONE.red}`}>
          {maxTokensValidation.issue}
        </div>
      )}

      <label className="block text-xs text-gray-700">
        Output schema <span className="text-gray-400">(JSON object; blank for none)</span>
        <textarea
          value={outputSchema}
          onChange={(e) => setOutputSchema(e.target.value)}
          rows={16}
          className="mt-1 w-full px-2 py-1.5 border border-gray-300 rounded text-sm font-mono text-xs"
        />
        <div className="mt-1 text-[10px] text-gray-400">{outputSchema.length} chars</div>
      </label>

      {!outputSchemaValidation.valid && (
        <div className={`text-xs px-3 py-2 rounded border ${TONE.red}`}>
          {outputSchemaValidation.issue}
        </div>
      )}

      <label className="block text-xs text-gray-700">
        System prompt <span className="text-gray-400">(the rules / instructions; blank for none)</span>
        <textarea
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          rows={16}
          className="mt-1 w-full px-2 py-1.5 border border-gray-300 rounded text-sm font-mono text-xs"
        />
        <div className="mt-1 text-[10px] text-gray-400">{systemPrompt.length} chars</div>
      </label>

      <label className="block text-xs text-gray-700">
        Prompt body
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={16}
          className="mt-1 w-full px-2 py-1.5 border border-gray-300 rounded text-sm font-mono text-xs"
        />
        <div className="mt-1 text-[10px] text-gray-400">{body.length} chars</div>
      </label>

      {!validation.valid && (
        <div className={`text-xs px-3 py-2 rounded border ${TONE.red}`}>
          <div className="font-medium">Validation issues (fix before publishing):</div>
          <ul className="mt-1 list-disc ml-5">
            {validation.issues.map((iss, i) => (<li key={i}>{iss}</li>))}
          </ul>
        </div>
      )}

      {!prompt.hasCurrent && (
        <div className="text-xs px-3 py-2 rounded border bg-amber-50 text-amber-800 border-amber-200">
          This prompt has rows but no published current version, so it can&apos;t be versioned from here. Recover a current version with the seed&apos;s <code>--force</code> path (publishes max+1), or resolve in Dynamics.
        </div>
      )}

      <div className="flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={() => {
            setBody(prompt.body || '');
            setSystemPrompt(prompt.systemPrompt || '');
            setOutputSchema(prompt.outputSchema || '');
            setModel(prompt.model || '');
            setMaxTokensText(initialMaxTokens);
          }}
          disabled={unchanged}
          className="text-xs text-gray-600 hover:text-gray-900 disabled:opacity-40"
        >
          Reset
        </button>
        <button
          onClick={submit}
          disabled={submitting || !validation.valid || !outputSchemaValidation.valid
            || !maxTokensValidation.valid || unchanged || !prompt.hasCurrent || !nativeModelCompatible}
          className="px-4 py-1.5 bg-gray-900 text-white text-sm font-medium rounded hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {submitting ? 'Publishing…' : `Publish v${(prompt.version ?? 0) + 1}`}
        </button>
      </div>
    </div>
  );
}
