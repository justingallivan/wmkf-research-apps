/** Executor budget draft, conflict recovery, and versioned publication UI. */
import { useRef, useState } from 'react';
import DataverseFieldInfoButton from './DataverseFieldInfoButton';
import { requestEnvelope } from '../../utils/api-request';
import { TONE, newRequestId, fmtTs, fmtInt } from './prompt-editor-utils';
import { getAdminPromptDescription } from '../../config/adminPromptCatalog';

const BUDGET_GROUPS = [
  { label: 'Pre-flight', names: ['pre-site-visit.proposal-core.generate'] },
  { label: 'Reviews and evaluations', names: ['review-panel.seat', 'review-panel.chair', 'review-synthesis.generate'] },
  { label: 'Meetings and briefings', names: ['field-primer.generate', 'cycle-dossier.entry'] },
];

const EXECUTOR_BUDGET_EDITABLE_FIELDS = {
  'pre-site-visit.proposal-core.generate': ['maxTokensOverride', 'timeoutMsOverride'],
  'review-synthesis.generate': ['floor', 'ceiling'],
  'field-primer.generate': ['timeoutMsOverride'],
  'cycle-dossier.entry': ['timeoutMsOverride'],
  'review-panel.seat': ['maxTokensOverride', 'timeoutMsOverride'],
  'review-panel.chair': ['maxTokensOverride', 'timeoutMsOverride'],
  'initial-assessment.generate': ['maxTokensOverride', 'timeoutMsOverride'],
};

function configRevision(config) {
  return config?.latestRevision ?? config?.version ?? 0;
}

function reapplyExecutorBudgetDraft(baseBudgets, draftBudgets, currentBudgets) {
  const merged = JSON.parse(JSON.stringify(currentBudgets));
  for (const [promptName, fields] of Object.entries(EXECUTOR_BUDGET_EDITABLE_FIELDS)) {
    for (const field of fields) {
      if (draftBudgets?.[promptName]?.[field] !== baseBudgets?.[promptName]?.[field]) {
        merged[promptName][field] = draftBudgets[promptName][field];
      }
    }
  }
  return merged;
}

export function ExecutorBudgetEditor({ config, onPublished }) {
  // Each entry is [promptName, output-tokens field label, timeout field label].
  const standingNames = [
    ['pre-site-visit.proposal-core.generate', 'Maximum output tokens', 'Timeout (milliseconds)'],
    ['review-panel.seat', 'Seat output tokens (counts adaptive thinking/reasoning)', 'Seat timeout (milliseconds)'],
    ['review-panel.chair', 'Chair output tokens (counts adaptive thinking)', 'Chair timeout (milliseconds)'],
  ];
  const retryName = 'review-synthesis.generate';
  const timeoutNames = [
    ['field-primer.generate', 'Field primer timeout (milliseconds)'],
    ['cycle-dossier.entry', 'Cycle Dossier entry timeout (milliseconds)'],
  ];
  const [values, setValues] = useState(() => config?.budgets || {});
  const [baseBudgets, setBaseBudgets] = useState(() => config?.budgets || {});
  const [baseRevision, setBaseRevision] = useState(() => configRevision(config));
  const [conflictConfig, setConflictConfig] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [outcome, setOutcome] = useState(null);
  const requestRef = useRef({ payloadKey: null, requestId: null });

  if (!config?.budgets) return null;
  const currentConfig = configRevision(config) >= configRevision(conflictConfig)
    ? config
    : conflictConfig;
  const retry = values[retryName] || {};
  const limits = config.limits || {};
  const integers = [
    ...standingNames.flatMap(([name]) => [values[name]?.maxTokensOverride, values[name]?.timeoutMsOverride]),
    retry.floor,
    retry.ceiling,
    ...timeoutNames.map(([name]) => values[name]?.timeoutMsOverride),
  ].every(Number.isInteger);
  const within = (value, range) => Number.isInteger(value)
    && value >= range?.min && value <= range?.max;
  const valid = integers
    && standingNames.every(([name]) => within(values[name]?.maxTokensOverride, limits[name]?.maxTokensOverride)
      && within(values[name]?.timeoutMsOverride, limits[name]?.timeoutMsOverride))
    && within(retry.floor, limits[retryName]?.floor)
    && within(retry.ceiling, limits[retryName]?.ceiling)
    && timeoutNames.every(([name]) => within(values[name]?.timeoutMsOverride, limits[name]?.timeoutMsOverride))
    && retry.floor <= retry.ceiling;
  const unchanged = JSON.stringify(values) === JSON.stringify(baseBudgets);
  const unsupportedSchema = (currentConfig.storageWarnings || []).some(
    warning => warning.code === 'unsupported_executor_budget_schema',
  );

  const setBudgetValue = (promptName, field, rawValue) => {
    const nextValue = rawValue === '' ? null : Number(rawValue);
    setValues((current) => ({
      ...current,
      [promptName]: { ...current[promptName], [field]: nextValue },
    }));
  };

  const submit = async () => {
    setSubmitting(true);
    setOutcome(null);
    try {
      const payloadKey = JSON.stringify({ budgets: values, expectedVersion: baseRevision });
      if (requestRef.current.payloadKey !== payloadKey) {
        requestRef.current = { payloadKey, requestId: newRequestId() };
      }
      const envelope = await requestEnvelope('/api/admin/executor-budgets', {
        method: 'PUT',
        body: {
          budgets: values,
          expectedVersion: baseRevision,
          requestId: requestRef.current.requestId,
        },
      });
      // A bare `.json()` today parses BEFORE the ok check, so a malformed
      // body (2xx or non-2xx) throws its native parse error straight to the
      // catch below rather than reaching the status/body-flag branches. The
      // helper parses a non-2xx body tolerantly instead of throwing, so that
      // ordering is restored here (never silent, plan §6 Stage 2 rule ii).
      if (envelope.error?.parseError) {
        throw envelope.error.parseError;
      }
      const { ok, status, data } = envelope;
      if (!ok) {
        if (status === 409 && data.code === 'version_conflict' && data.current?.budgets) {
          setConflictConfig(data.current);
          requestRef.current = { payloadKey: null, requestId: null };
          onPublished(data.current);
          setOutcome({
            tone: 'amber',
            text: `${data.error || 'Executor budgets changed.'} Your draft was retained; reapply its changed fields or reset to the current revision.`,
          });
          return;
        }
        if (status === 409
            && data.code === 'unsupported_executor_budget_schema'
            && data.current?.budgets) {
          setConflictConfig(data.current);
          onPublished(data.current);
        }
        throw new Error(data.error || 'Executor budget publication failed.');
      }
      setValues(data.config.budgets);
      setBaseBudgets(data.config.budgets);
      setBaseRevision(configRevision(data.config));
      setConflictConfig(data.config);
      requestRef.current = { payloadKey: null, requestId: null };
      const publishedVersion = data.publishedConfig?.version ?? data.config.version;
      const advanced = data.config.version !== publishedVersion
        ? ` Current revision is v${data.config.version}.`
        : '';
      setOutcome({ tone: 'green', text: data.status === 'already_published'
        ? `That budget revision was already published.${advanced}`
        : `Published Executor budget revision ${publishedVersion}.${advanced}` });
      onPublished(data.config);
    } catch (error) {
      setOutcome({ tone: 'red', text: error.message });
    } finally {
      setSubmitting(false);
    }
  };

  const settingRow = currentConfig.settingKey
    ? `wmkf_settingkey = "${currentConfig.settingKey}"`
    : `wmkf_settingkey starts with "executor.budgets.v"`;
  const reset = () => {
    setValues(currentConfig.budgets);
    setBaseBudgets(currentConfig.budgets);
    setBaseRevision(configRevision(currentConfig));
    requestRef.current = { payloadKey: null, requestId: null };
    setOutcome(null);
  };
  const reapplyDraft = () => {
    const reapplied = reapplyExecutorBudgetDraft(baseBudgets, values, currentConfig.budgets);
    setValues(reapplied);
    setBaseBudgets(currentConfig.budgets);
    setBaseRevision(configRevision(currentConfig));
    requestRef.current = { payloadKey: null, requestId: null };
    setOutcome(null);
  };
  const staleDraft = baseRevision !== configRevision(currentConfig);
  return (
    <details className="border border-gray-300 rounded-lg">
      <summary className="cursor-pointer rounded-lg bg-gray-50 p-4 text-sm font-semibold text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-500">
        Execution budgets ({BUDGET_GROUPS.reduce((count, group) => count + group.names.length, 0)})
        {' '}<span className="ml-2 text-xs font-normal text-gray-500">{currentConfig.source === 'dataverse' ? `v${currentConfig.version}` : 'Code fallback'}</span>
        {(!unchanged || staleDraft) && <span className="ml-2 text-xs font-normal text-amber-800">Unpublished changes</span>}
        {(currentConfig.storageWarnings || []).length > 0 && <span className="ml-2 text-xs font-normal text-amber-800">Needs attention</span>}
      </summary>
      <div className="p-4 bg-gray-50 border-b flex items-start justify-between gap-3">
        <div>
          <div className="font-medium text-gray-900">Execution budgets</div>
          <div className="text-xs text-gray-500 mt-0.5">
            {currentConfig.source === 'dataverse'
              ? <>Current immutable revision <strong>v{currentConfig.version}</strong> · published {fmtTs(currentConfig.publishedAt)}{currentConfig.updatedByName ? <> by {currentConfig.updatedByName}</> : null}</>
              : <>No published revision · using reviewed code fallback</>}
          </div>
        </div>
        <DataverseFieldInfoButton items={[{
          label: 'Versioned Executor budgets',
          entity: 'wmkf_appsystemsetting',
          entitySet: 'wmkf_appsystemsettings',
          field: 'wmkf_settingvalue',
          row: settingRow,
          note: 'Each publication creates a new row; existing revisions are never updated.',
        }]} />
      </div>
      <div className="p-4 space-y-4">
        <p className="text-sm text-gray-600">Set output-token limits and timeouts for these workflows. Publish all budget changes together as one revision.</p>
        {BUDGET_GROUPS.map(group => (
          <section key={group.label} aria-label={`${group.label} execution budgets`} className="space-y-4 border-t border-gray-200 pt-4">
            <h3 className="text-sm font-semibold text-gray-900">{group.label} ({group.names.length})</h3>
            {group.names.map(name => {
              const standing = standingNames.find(([key]) => key === name);
              const timeout = timeoutNames.find(([key]) => key === name);
              return (
                <div key={name}>
                  <h4 className="text-sm font-medium text-gray-800">{getAdminPromptDescription(name).title}</h4>
                  <p className="mt-1 text-xs text-gray-500"><code className="break-all">{name}</code></p>
                  <div className="grid sm:grid-cols-2 gap-3 mt-2">
                    {standing ? <>
                      <BudgetNumberField label={standing[1]} value={values[name]?.maxTokensOverride} limits={limits[name]?.maxTokensOverride} onChange={value => setBudgetValue(name, 'maxTokensOverride', value)} />
                      <BudgetNumberField label={standing[2]} value={values[name]?.timeoutMsOverride} limits={limits[name]?.timeoutMsOverride} onChange={value => setBudgetValue(name, 'timeoutMsOverride', value)} />
                    </> : name === retryName ? <>
                      <BudgetNumberField label="Retry floor (tokens)" value={retry.floor} limits={limits[name]?.floor} onChange={value => setBudgetValue(name, 'floor', value)} />
                      <BudgetNumberField label="Retry ceiling (tokens)" value={retry.ceiling} limits={limits[name]?.ceiling} onChange={value => setBudgetValue(name, 'ceiling', value)} />
                    </> : timeout ? <BudgetNumberField label={timeout[1]} value={values[name]?.timeoutMsOverride} limits={limits[name]?.timeoutMsOverride} onChange={value => setBudgetValue(name, 'timeoutMsOverride', value)} /> : null}
                  </div>
                </div>
              );
            })}
          </section>
        ))}
        {!valid && (
          <div className={`text-xs px-3 py-2 rounded border ${TONE.red}`}>
            Use whole numbers inside each displayed safety range; the retry floor cannot exceed its ceiling.
          </div>
        )}
        {(currentConfig.storageWarnings || []).map((warning) => (
          <div
            key={warning.settingKey}
            className={`text-xs px-3 py-2 rounded border ${TONE[
              warning.code === 'unsupported_executor_budget_schema' ? 'red' : 'amber'
            ]}`}
          >
            Stored budget row <code>{warning.settingKey}</code> was skipped: {warning.message}
          </div>
        ))}
        {staleDraft && (
          <div className={`text-xs px-3 py-2 rounded border ${TONE.amber}`}>
            Executor budgets changed after this draft was loaded. Publishing is paused until you reset to the current values or explicitly reapply only this draft's changed fields.
          </div>
        )}
        {outcome && (
          <div className={`text-xs px-3 py-2 rounded border ${TONE[outcome.tone]}`}>{outcome.text}</div>
        )}
        <div className="flex justify-end gap-3">
          {staleDraft && !unchanged && (
            <button
              type="button"
              onClick={reapplyDraft}
              disabled={submitting}
              className="text-xs text-amber-700 hover:text-amber-900 disabled:opacity-40"
            >
              Reapply my changes to v{configRevision(currentConfig)}
            </button>
          )}
          <button
            type="button"
            onClick={reset}
            disabled={(!staleDraft && unchanged) || submitting}
            className="text-xs text-gray-600 hover:text-gray-900 disabled:opacity-40"
          >
            Reset
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting || staleDraft || unsupportedSchema || unchanged || !valid}
            className="px-4 py-1.5 bg-gray-900 text-white text-sm font-medium rounded hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {submitting ? 'Publishing…' : `Publish v${baseRevision + 1}`}
          </button>
        </div>
      </div>
    </details>
  );
}

function BudgetNumberField({ label, value, limits, onChange }) {
  return (
    <label className="block text-xs text-gray-700">
      {label}
      <input
        type="number"
        step="1"
        min={limits?.min}
        max={limits?.max}
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
      />
      <div className="mt-1 text-xs text-gray-500">
        Safety range: {fmtInt(limits?.min)}–{fmtInt(limits?.max)}
      </div>
    </label>
  );
}
