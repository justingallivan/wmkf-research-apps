import { useEffect, useState } from 'react';
import { requestJson, requestEnvelope } from '../../utils/api-request';

// --- Section B2: Model Configuration ---
const MODEL_TYPE_LABELS = {
  model: 'Primary',
  visionModel: 'Vision',
  fallback: 'Fallback',
};

// Friendly names for APP_MODELS keys. App-registry keys don't always match
// APP_MODELS keys (e.g. APP_MODELS uses 'batch-phase-i' while the registry
// uses 'batch-phase-i-summaries'), so this is maintained inline.
const APP_MODEL_NAMES = {
  'multi-perspective-evaluator': 'Multi-Perspective Evaluator',
  'literature-analyzer': 'Literature Analyzer',
  'batch-phase-i': 'Batch Phase I',
  'batch-phase-ii': 'Batch Phase II',
  'phase-i-writeup': 'Phase I Writeup',
  'phase-ii-writeup': 'Phase II Writeup',
  'reviewer-finder': 'Reviewer Finder Pipeline',
  'reviewer-exclusion': 'Reviewer Exclusion Parser',
  'reviewers': 'Reviewers',
  'peer-review-summarizer': 'Peer Review Summarizer',
  'funding-analysis': 'Funding Analysis',
  'qa': 'Q&A',
  'refine': 'Refinement',
  'expense-reporter': 'Expense Reporter',
  'contact-enrichment': 'Contact Enrichment',
  'email-personalization': 'Email Personalization',
  'dynamics-explorer': 'Dynamics Explorer',
  // 'virtual-review-panel' (legacy multi-LLM panel) retired 2026-10-04 (Session 573).
  'review-panel': 'Review Panel',
  'grant-reporting': 'Grant Reporting',
};

// Strip the 'claude-' prefix and a trailing YYYYMMDD date stamp so dropdown
// labels stay readable. 'claude-sonnet-4-20250514' → 'sonnet-4'.
function shortModelLabel(id) {
  if (!id) return '—';
  return String(id).replace(/^claude-/, '').replace(/-\d{8}$/, '');
}

function formatPriceDollars(cents) {
  if (typeof cents !== 'number') return '—';
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}

function RegistryStatusPills({ status }) {
  if (!status) return null;
  const capabilityOk = status.capability?.status === 'reviewed';
  const pricingOk = status.pricing?.status === 'reviewed';
  const base = 'inline-flex items-center rounded border px-1.5 py-0.5 text-xs font-medium';
  const okClass = 'bg-emerald-50 text-emerald-700 border-emerald-200';
  const warnClass = 'bg-amber-50 text-amber-700 border-amber-200';
  const capTitle = capabilityOk
    ? `Reviewed ${status.capability.reviewedAt || 'date unknown'}; temperature=${status.capability.supportsTemperature ? 'yes' : 'no'}; effort=${status.capability.supportsEffort ? 'yes' : 'no'}; retention=${status.capability.dataRetentionClass || 'unknown'}`
    : 'Missing capability registry entry';
  const pricingTitle = pricingOk
    ? `Pricing reviewed ${status.pricing.lastReviewedAt || 'date unknown'}; input ${formatPriceDollars(status.pricing.inputCentsPerMTok)}/MTok; output ${formatPriceDollars(status.pricing.outputCentsPerMTok)}/MTok`
    : 'Missing pricing table entry';

  return (
    <div className="mt-1 flex flex-wrap items-center gap-1">
      <span className={`${base} ${capabilityOk ? okClass : warnClass}`} title={capTitle}>
        cap {capabilityOk ? 'ok' : 'missing'}
      </span>
      <span className={`${base} ${pricingOk ? okClass : warnClass}`} title={pricingTitle}>
        price {pricingOk ? 'ok' : 'missing'}
      </span>
    </div>
  );
}

export default function ModelConfigSection() {
  const [serverState, setServerState] = useState(null); // { apps, availableModels, tiers, defaultModel }
  const [localOverrides, setLocalOverrides] = useState({}); // { "appKey:modelType": tier|modelId|null }
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);

  const fetchConfig = (opts = {}) => {
    const { refresh = false } = opts;
    if (refresh) setRefreshing(true); else setLoading(true);
    setError(null);
    const url = refresh ? '/api/admin/models?refresh=1' : '/api/admin/models';
    requestEnvelope(url)
      .then(envelope => {
        if (envelope.status === 403) throw new Error('Admin access required');
        if (!envelope.ok) throw new Error('Failed to fetch model config');
        return envelope.data;
      })
      .then(data => {
        setServerState(data);
        // Initialize local overrides from server DB overrides
        const overrides = {};
        (data.apps || []).forEach(app => {
          Object.entries(app.models).forEach(([type, info]) => {
            if (info.dbOverride) {
              overrides[`${app.appKey}:${type}`] = info.dbOverride;
            }
          });
        });
        setLocalOverrides(overrides);
      })
      .catch(err => setError(err.message))
      .finally(() => { setLoading(false); setRefreshing(false); });
  };

  useEffect(() => { fetchConfig(); }, []);

  if (loading) {
    return <div className="text-gray-500 text-sm">Loading model configuration...</div>;
  }

  if (error) {
    return <div className="text-red-600 text-sm">{error}</div>;
  }

  if (!serverState) return null;

  const { apps, availableModels, tiers = [], defaultModel, modelStatuses = {} } = serverState;
  const reviewPanel = apps.find(app => app.appKey === 'review-panel');

  // Build server-side DB override map for diff calculation
  const serverDbOverrides = {};
  apps.forEach(app => {
    Object.entries(app.models).forEach(([type, info]) => {
      if (info.dbOverride) {
        serverDbOverrides[`${app.appKey}:${type}`] = info.dbOverride;
      }
    });
  });

  // Handle dropdown change
  const handleChange = (appKey, modelType, value) => {
    setLocalOverrides(prev => {
      const next = { ...prev };
      const key = `${appKey}:${modelType}`;
      if (value === '') {
        // "Default" selected — clear the override
        delete next[key];
      } else {
        next[key] = value;
      }
      return next;
    });
  };

  // Compute diff between server DB overrides and local state
  const computeDiff = () => {
    const changes = [];
    const allKeys = new Set([...Object.keys(serverDbOverrides), ...Object.keys(localOverrides)]);
    for (const key of allKeys) {
      const serverVal = serverDbOverrides[key] || null;
      const localVal = localOverrides[key] || null;
      if (serverVal !== localVal) {
        const [appKey, modelType] = [key.substring(0, key.lastIndexOf(':')), key.substring(key.lastIndexOf(':') + 1)];
        changes.push({ appKey, modelType, modelId: localVal });
      }
    }
    return changes;
  };

  const diff = computeDiff();
  const hasChanges = diff.length > 0;

  const saveAll = async () => {
    setSaving(true);
    setMessage(null);
    try {
      for (const change of diff) {
        await requestJson('/api/admin/models', {
          method: 'PUT',
          body: change,
          tolerantBody: true,
          fallbackMessage: 'Failed to save',
        });
      }
      setMessage({ type: 'success', text: `Saved ${diff.length} model override(s)` });
      fetchConfig();
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setSaving(false);
    }
  };

  const discardChanges = () => {
    const overrides = {};
    apps.forEach(app => {
      Object.entries(app.models).forEach(([type, info]) => {
        if (info.dbOverride) {
          overrides[`${app.appKey}:${type}`] = info.dbOverride;
        }
      });
    });
    setLocalOverrides(overrides);
    setMessage(null);
  };

  const shortModelName = shortModelLabel;

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs text-gray-500">
          Tier picks (Fable / Opus / Sonnet / Haiku) auto-track the latest model in that family. Pin a specific version only if you need to reproduce historical behavior. Changes take effect within 5 minutes.
        </p>
        <div className="flex items-center gap-2 ml-3 shrink-0">
          <button
            onClick={() => fetchConfig({ refresh: true })}
            disabled={refreshing || saving}
            title="Re-fetch the Anthropic model list (bypasses the 24h cache)"
            className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {refreshing ? 'Refreshing…' : 'Refresh model list'}
          </button>
          {hasChanges && (
            <button
              onClick={discardChanges}
              className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Discard
            </button>
          )}
          <button
            onClick={saveAll}
            disabled={!hasChanges || saving}
            className="px-4 py-1.5 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? 'Saving...' : hasChanges ? 'Save Changes' : 'No Changes'}
          </button>
        </div>
      </div>

      {message && (
        <div className={`mb-4 px-3 py-2 rounded-lg text-sm ${
          message.type === 'success' ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'
        }`}>
          {message.text}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="text-left py-2 px-2 font-medium text-gray-600 min-w-[160px]">App</th>
              {Object.entries(MODEL_TYPE_LABELS).map(([type, label]) => (
                <th key={type} className="text-left py-2 px-2 font-medium text-gray-600 min-w-[220px]">{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {apps.filter(app => !app.providerBound).map(app => (
              <tr key={app.appKey} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="py-2 px-2 text-gray-900 font-medium whitespace-nowrap">
                  {APP_MODEL_NAMES[app.appKey] || app.appKey}
                </td>
                {Object.keys(MODEL_TYPE_LABELS).map(modelType => {
                  const info = app.models[modelType];
                  const key = `${app.appKey}:${modelType}`;
                  const localVal = localOverrides[key] || '';
                  const serverVal = serverDbOverrides[key] || '';
                  const changed = localVal !== serverVal;
                  const hasHardcoded = !!info.hardcoded;
                  // Resolve what would actually be sent to Anthropic given
                  // the current selection (tier → concrete via the tiers
                  // catalog from the server).
                  const tierMap = Object.fromEntries(tiers.map(t => [t.key, t.resolvedId]));
                  const effectiveStored = localVal || info.stored || '';
                  const tierKey = typeof effectiveStored === 'string' ? effectiveStored.toLowerCase() : effectiveStored;
                  const effectiveResolved = tierMap[tierKey] || effectiveStored;
                  const registryStatus = modelStatuses[effectiveResolved] || info.registryStatus;

                  return (
                    <td key={modelType} className="py-2 px-2">
                      {hasHardcoded ? (
                        <div>
                          <select
                            value={localVal}
                            onChange={e => handleChange(app.appKey, modelType, e.target.value)}
                            className={`w-full px-2 py-1.5 border rounded-lg text-xs focus:ring-2 focus:ring-gray-400 focus:border-gray-400 ${
                              changed ? 'border-amber-400 ring-2 ring-amber-200' : 'border-gray-300'
                            }`}
                          >
                            <option value="">
                              Default ({info.hardcoded})
                            </option>
                            {tiers.length > 0 && (
                              <optgroup label="Tiers (auto-track latest)">
                                {tiers.map(t => (
                                  <option key={t.key} value={t.key}>
                                    {t.anthropic} ({t.tier})
                                  </option>
                                ))}
                              </optgroup>
                            )}
                            {availableModels.length > 0 && (
                              <optgroup label="Pin specific version">
                                {availableModels.map(m => (
                                  <option key={m.id} value={m.id}>{m.display_name}</option>
                                ))}
                              </optgroup>
                            )}
                          </select>
                          <div className="mt-1 flex items-center gap-2 text-xs text-gray-500">
                            <span title="Concrete model id that will be sent to Anthropic">
                              → {shortModelName(effectiveResolved)}
                            </span>
                            {info.envOverride && (
                              <span className="text-gray-400" title={`Environment variable override: ${info.envOverride}`}>
                                env: {shortModelName(info.envOverride)}
                              </span>
                            )}
                          </div>
                          <RegistryStatusPills status={registryStatus} />
                        </div>
                      ) : (
                        <span className="text-gray-400 text-xs">—</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {reviewPanel && (
        <div className="mt-8">
          <div className="mb-3">
            <h3 className="text-sm font-semibold text-gray-900">Virtual Review Panel</h3>
            <p className="text-xs text-gray-500 mt-1">
              Each slot has a fixed provider. Only reviewed models with pricing coverage can be selected.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 px-2 font-medium text-gray-600">Slot</th>
                  <th className="text-left py-2 px-2 font-medium text-gray-600">Provider</th>
                  <th className="text-left py-2 px-2 font-medium text-gray-600 min-w-[320px]">Model</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(reviewPanel.models).map(([slotKey, info]) => {
                  const key = `${reviewPanel.appKey}:${slotKey}`;
                  const localVal = localOverrides[key] || '';
                  const serverVal = serverDbOverrides[key] || '';
                  const changed = localVal !== serverVal;
                  const effective = localVal || info.stored;
                  const registryStatus = modelStatuses[effective] || info.registryStatus;
                  return (
                    <tr key={slotKey} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="py-2 px-2 text-gray-900 font-medium">
                        {info.label || slotKey}
                        <div className="text-xs text-gray-400 font-normal">{slotKey}</div>
                      </td>
                      <td className="py-2 px-2 text-gray-700 capitalize">{info.vendor}</td>
                      <td className="py-2 px-2">
                        <select
                          value={localVal}
                          onChange={e => handleChange(reviewPanel.appKey, slotKey, e.target.value)}
                          className={`w-full px-2 py-1.5 border rounded-lg text-xs focus:ring-2 focus:ring-gray-400 focus:border-gray-400 ${
                            changed ? 'border-amber-400 ring-2 ring-amber-200' : 'border-gray-300'
                          }`}
                        >
                          <option value="">Default ({info.hardcoded})</option>
                          {(info.availableModels || []).map(model => (
                            <option key={model.id} value={model.id}>{model.display_name}</option>
                          ))}
                        </select>
                        <div className="mt-1 text-xs text-gray-500">
                          → {shortModelName(effective)}
                        </div>
                        <RegistryStatusPills status={registryStatus} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {hasChanges && (
        <p className="text-xs text-amber-600 mt-3">
          {diff.length} unsaved change(s). Changed dropdowns are highlighted.
        </p>
      )}
    </>
  );
}
