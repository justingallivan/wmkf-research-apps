/**
 * Admin section for editing + versioned-publishing `wmkf_ai_prompt` rows (S222).
 *
 * Mounted in pages/admin.js alongside PoliciesSection (which this mirrors). The
 * route (/api/admin/prompts/[name]) owns all the concurrency / idempotency /
 * audit complexity; this component presents prompts, validates edits client-side
 * (same validators the server enforces), and surfaces outcomes.
 *
 * Editing is immutable-by-version: a publish creates a NEW wmkf_ai_prompt row
 * (iscurrent=true, version+1) and flips the prior row down. A draft-only name
 * (no current row) publishes its first version as a copy of the draft row.
 */
import { useEffect, useRef, useState } from 'react';
import DataverseFieldInfoButton from './DataverseFieldInfoButton';
import { requestEnvelope } from '../../utils/api-request';
import { ExecutorBudgetEditor } from './ExecutorBudgetEditor';
import { TONE, fmtTs, fmtInt, ROW_DEFAULT_MAX_TOKENS, newRequestId } from './prompt-editor-utils';
import PublishForm from './PromptPublishForm';
import PromptCatalogForm from './PromptCatalogForm';
import AddPromptForm from './AddPromptForm';
import ManagePromptGroupsPanel from './ManagePromptGroupsPanel';
import SharedPromptEditor from './SharedPromptEditor';
import { ADMIN_PROMPT_GROUPS, getAdminPromptDescription, resolveAdminPromptDescription } from '../../config/adminPromptCatalog';
import { describePromptDestinations } from '../../config/adminPromptDestinations';

export { ExecutorBudgetEditor };

const USAGE_BADGES = {
  application: { label: 'Application caller', tone: 'green' },
  'power-automate': { label: 'Power Automate flow', tone: 'green' },
  reference: { label: 'Stored reference', tone: 'amber' },
  diagnostic: { label: 'Developer diagnostic', tone: 'gray' },
  unconnected: { label: 'No application caller', tone: 'gray' },
  uncataloged: { label: 'Not cataloged', tone: 'gray' },
};

const STATUS_COPY = {
  completed:             { tone: 'green', text: 'Published — new version is now current.' },
  already_published:     { tone: 'gray',  text: 'No change — that request was already published.' },
  partial:               { tone: 'amber', text: 'Published with warnings — see details below.' },
  concurrency_conflict:  { tone: 'amber', text: 'Another admin published while you were editing. Reload and re-apply.' },
  no_current_row:        { tone: 'red',   text: 'No rows exist for this prompt name. Reload the list.' },
  duplicate_current_rows:{ tone: 'red',   text: 'Multiple current rows (store corruption). Resolve in Dynamics.' },
  invalid_body:          { tone: 'red',   text: 'Prompt body failed validation.' },
  invalid_model:         { tone: 'red',   text: 'The selected model is not compatible with this prompt.' },
  invalid_max_tokens:    { tone: 'red',   text: 'Max tokens must be a positive whole number.' },
  invalid_output_schema: { tone: 'red',   text: 'The stored output schema is invalid.' },
  invalid_variables:     { tone: 'red',   text: 'The stored prompt-variable declaration is invalid.' },
  idempotency_key_reuse: { tone: 'red',   text: 'This edit changed after publishing began. Retry the edited payload.' },
  audit_unavailable:     { tone: 'red',   text: 'Audit table unavailable; refused to publish.' },
  failed:                { tone: 'red',   text: 'Publish failed. Check server logs.' },
  catalog_updated:       { tone: 'green', text: 'Details saved.' },
  catalog_conflict:      { tone: 'amber', text: 'These details changed since you opened them. Reload and re-apply your edits.' },
  catalog_superseded:    { tone: 'amber', text: 'Details saved, but a new version was published at the same time and does not have them. Reopen the details and save again.' },
  invalid_catalog:       { tone: 'red',   text: 'Those details could not be saved.' },
  created:               { tone: 'green', text: 'Prompt created and published as v1.' },
  groups_saved:          { tone: 'green', text: 'Groups saved.' },
  retired:               { tone: 'green', text: 'Prompt retired. Apps can no longer use it. It is listed under Retired prompts; use Review & publish there to bring it back.' },
  retire_blocked_application: { tone: 'red', text: 'This prompt is marked Application caller, so it can’t be retired here.' },
  name_exists:           { tone: 'red',   text: 'A prompt with that name already exists. Use Edit & publish to change it.' },
  invalid_name:          { tone: 'red',   text: 'That name is not allowed.' },
  invalid_input:         { tone: 'red',   text: 'The prompt could not be created.' },
};
export default function PromptTemplatesSection() {
  return <><SharedPromptEditor /><LegacyPromptTemplatesSection /></>;
}

function LegacyPromptTemplatesSection() {
  const [prompts, setPrompts] = useState(null);
  const [modelCatalog, setModelCatalog] = useState(null);
  const [executorBudgetConfig, setExecutorBudgetConfig] = useState(null);
  const [executorBudgetError, setExecutorBudgetError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [expandedGroups, setExpandedGroups] = useState({});
  const [adding, setAdding] = useState(false);
  const [addOutcome, setAddOutcome] = useState(null);
  const [groupState, setGroupState] = useState({ groups: ADMIN_PROMPT_GROUPS, editable: null, revision: null, warning: null });
  const [managingGroups, setManagingGroups] = useState(false);
  const loadGeneration = useRef(0);

  const load = () => {
    const generation = ++loadGeneration.current;
    setLoading(true);
    setError(null);
    setExecutorBudgetError(null);
    Promise.all([
      requestEnvelope('/api/admin/prompts'),
      requestEnvelope('/api/admin/models'),
    ])
      .then(([promptEnvelope, modelEnvelope]) => {
        if ([promptEnvelope, modelEnvelope].some((envelope) => envelope.status === 403)) {
          throw new Error('Admin access required');
        }
        if (!promptEnvelope.ok) throw new Error('Failed to load prompts');
        if (!modelEnvelope.ok) throw new Error('Failed to load the reviewed model catalog');
        return [promptEnvelope.data, modelEnvelope.data];
      })
      .then(([promptData, modelData]) => {
        if (generation !== loadGeneration.current) return;
        setPrompts(promptData.prompts || []);
        setGroupState({
          groups: Array.isArray(promptData.groups) && promptData.groups.length ? promptData.groups : ADMIN_PROMPT_GROUPS,
          editable: Array.isArray(promptData.groupsEditable) ? promptData.groupsEditable : null,
          revision: promptData.groupsRevision ?? null,
          warning: promptData.groupsWarning || null,
        });
        setModelCatalog(modelData);
      })
      .catch((err) => {
        if (generation === loadGeneration.current) setError(err.message);
      })
      .finally(() => {
        if (generation === loadGeneration.current) setLoading(false);
      });
    requestEnvelope('/api/admin/executor-budgets')
      .then(({ status, ok, data }) => {
        if (status === 403) throw new Error('Admin access required for Executor budgets');
        if (!ok) throw new Error('Failed to load Executor budgets');
        return data;
      })
      .then((budgetData) => {
        if (generation !== loadGeneration.current) return;
        setExecutorBudgetConfig(budgetData);
      })
      .catch((err) => {
        if (generation === loadGeneration.current) setExecutorBudgetError(err.message);
      });
  };
  useEffect(() => { load(); }, []);

  if (loading && !prompts) return <div className="text-gray-500 text-sm">Loading…</div>;
  if (error && !prompts) return <div className="text-red-600 text-sm">{error}</div>;
  if (!prompts || prompts.length === 0) return <div className="text-gray-500 text-sm">No prompts found.</div>;

  const allGroups = groupState.groups;
  const legacyPrompts = prompts.filter(prompt => !['synthetic.executive-summary','synthetic.methodology'].includes(prompt.name));
  const activePrompts = legacyPrompts.filter(prompt => !prompt.isRetired);
  const retiredPrompts = legacyPrompts.filter(prompt => prompt.isRetired);
  const groups = allGroups.map(group => ({
    ...group, prompts: activePrompts.filter(prompt => resolveAdminPromptDescription(prompt, allGroups).group === group.id),
  })).filter(group => group.prompts.length > 0);
  const terms = search.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const matchingNames = new Set(legacyPrompts.filter(prompt => {
    const { title, description, usedBy, group: groupId, section: sectionId } = resolveAdminPromptDescription(prompt, allGroups);
    const group = allGroups.find(candidate => candidate.id === groupId);
    const section = group?.sections?.find(candidate => candidate.id === sectionId);
    const destination = describePromptDestinations(prompt);
    const text = [prompt.name, title, description, usedBy, group?.label, section?.label,
      destination.caller?.summary, ...(destination.caller?.fields || []),
      ...destination.configured.flatMap(item => [item.label, item.technical])].join(' ').toLowerCase();
    return terms.every(term => text.includes(term));
  }).map(prompt => prompt.name));
  const matchCount = list => list.filter(prompt => matchingNames.has(prompt.name)).length;
  // Keep every editor mounted while searching or collapsing a workflow section.
  const renderPrompt = prompt => (
    <div key={prompt.name} hidden={!matchingNames.has(prompt.name)}>
      <PromptPanel
        prompt={prompt}
        groups={allGroups}
        modelCatalog={modelCatalog}
        executorBudgetConfig={executorBudgetConfig}
        onPublished={load}
      />
    </div>
  );

  return (
    <>
      <p className="text-xs text-gray-500 mb-4">
        Edit and publish a new version of a stored prompt. Publishing creates a new immutable version and makes it current. Reviewer-finder prompts are validated against their output parse contract before save.
      </p>
      {addOutcome && (
        <div className="mb-4 border rounded-lg overflow-hidden">
          <OutcomeBanner outcome={addOutcome} onDismiss={() => setAddOutcome(null)} />
        </div>
      )}
      {adding ? (
        <AddPromptForm
          existingNames={new Set(prompts.map((prompt) => prompt.name))}
          modelCatalog={modelCatalog}
          groups={allGroups}
          onCreated={(data) => {
            setAddOutcome({ ...data, status: data.status === 'completed' ? 'created' : data.status });
            setAdding(false);
            load();
          }}
          onOutcome={setAddOutcome}
          onCancel={() => setAdding(false)}
        />
      ) : managingGroups && groupState.editable ? (
        <ManagePromptGroupsPanel
          editable={groupState.editable}
          revision={groupState.revision}
          onSaved={() => {
            setAddOutcome({ status: 'groups_saved' });
            setManagingGroups(false);
            load();
          }}
          onClose={() => setManagingGroups(false)}
        />
      ) : (
        <div className="mb-4 flex gap-2">
          <button
            type="button"
            onClick={() => { setAdding(true); setAddOutcome(null); }}
            className="px-3 py-1.5 text-sm bg-gray-900 text-white rounded hover:bg-gray-800"
          >
            Add prompt
          </button>
          <button
            type="button"
            onClick={() => { setManagingGroups(true); setAddOutcome(null); }}
            disabled={!groupState.editable}
            className="px-3 py-1.5 text-sm border border-gray-300 text-gray-700 rounded hover:bg-gray-100 disabled:opacity-40"
          >
            Manage groups
          </button>
        </div>
      )}
      {groupState.warning && <p className="mb-4 text-xs text-amber-800">{groupState.warning}</p>}
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700" htmlFor="prompt-search">Search prompts</label>
        <div className="mt-1 flex items-center gap-3">
          <input
            id="prompt-search"
            type="search"
            value={search}
            onChange={event => {
              const value = event.target.value;
              setSearch(value);
              setExpandedGroups(value.trim() ? { ...Object.fromEntries(allGroups.map(group => [group.id, true])), __retired: true } : {});
            }}
            placeholder="Search titles, descriptions, technical keys, Used by or destinations"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-500"
          />
          {search && <button type="button" onClick={() => { setSearch(''); setExpandedGroups({}); }} className="shrink-0 text-sm text-gray-600 underline">Clear search</button>}
        </div>
        <p role="status" className="mt-1 text-xs text-gray-500">{matchingNames.size} of {legacyPrompts.length} prompts</p>
      </div>
      <div className="space-y-6">
        {matchingNames.size === 0 && <p className="text-sm text-gray-600">No prompts match your search.</p>}
        {groups.map(group => (
          <details key={group.id} hidden={matchCount(group.prompts) === 0} open={expandedGroups[group.id] || undefined} className="rounded-lg border border-gray-200">
            <summary onClick={event => {
              event.preventDefault();
              setExpandedGroups(current => ({ ...current, [group.id]: !current[group.id] }));
            }} className="cursor-pointer rounded-lg bg-gray-50 p-4 text-sm font-semibold text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-500">
              {group.label} ({matchCount(group.prompts)})
            </summary>
            <div className="space-y-6 p-4">
              {group.id === 'reference' && <p className="text-sm text-gray-600">These stored prompts are kept for reference. The current application routes use code templates instead.</p>}
              {group.sections ? group.sections.map(section => {
                const sectionPrompts = group.prompts.filter(prompt => resolveAdminPromptDescription(prompt, allGroups).section === section.id);
                return (
                  <section key={section.id} aria-label={section.label} hidden={matchCount(sectionPrompts) === 0} className="space-y-4">
                    <h3 className="text-sm font-semibold text-gray-700">{section.label} ({matchCount(sectionPrompts)})</h3>
                    {sectionPrompts.map(renderPrompt)}
                  </section>
                );
              }) : group.prompts.map(renderPrompt)}
            </div>
          </details>
        ))}
        {retiredPrompts.length > 0 && (
          <details hidden={matchCount(retiredPrompts) === 0} open={expandedGroups.__retired || undefined} className="rounded-lg border border-dashed border-gray-300">
            <summary onClick={event => {
              event.preventDefault();
              setExpandedGroups(current => ({ ...current, __retired: !current.__retired }));
            }} className="cursor-pointer rounded-lg bg-gray-50 p-4 text-sm font-semibold text-gray-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-500">
              Retired prompts ({matchCount(retiredPrompts)})
            </summary>
            <div className="space-y-6 p-4">
              <p className="text-sm text-gray-600">Apps can’t use these. Use Review &amp; publish on one to bring it back as a new version.</p>
              {retiredPrompts.map(renderPrompt)}
            </div>
          </details>
        )}
        {executorBudgetError && (
          <div className={`text-xs px-3 py-2 rounded border ${TONE.red}`}>
            {executorBudgetError}. Prompt editing remains available.
          </div>
        )}
        {executorBudgetConfig ? (
          <ExecutorBudgetEditor
            config={executorBudgetConfig}
            onPublished={setExecutorBudgetConfig}
          />
        ) : null}
      </div>
    </>
  );
}

function PromptPanel({ prompt, groups, modelCatalog, executorBudgetConfig, onPublished }) {
  const [expanded, setExpanded] = useState(false);
  const [editingDetails, setEditingDetails] = useState(false);
  const [outcome, setOutcome] = useState(null);
  const [confirmingRetire, setConfirmingRetire] = useState(false);
  const [retiring, setRetiring] = useState(false);
  const retireRequest = useRef(null);
  const dataverseFields = buildPromptDataverseFields(prompt);
  const description = resolveAdminPromptDescription(prompt, groups);
  const usage = USAGE_BADGES[description.usage];
  const retireBlocked = description.usage === 'application';
  const retire = async () => {
    setRetiring(true);
    // One request id per confirmation, so a retried click replays instead of repeating.
    if (!retireRequest.current) retireRequest.current = newRequestId();
    try {
      const envelope = await requestEnvelope(`/api/admin/prompts/${encodeURIComponent(prompt.name)}`, {
        method: 'POST',
        body: { action: 'retire', expectedVersion: prompt.version, requestId: retireRequest.current },
      });
      const { data } = envelope;
      if (data.status === 'completed' || data.status === 'already_published') {
        setOutcome({ status: 'retired' });
        setConfirmingRetire(false);
        retireRequest.current = null;
        onPublished();
      } else if (!envelope.ok && !data.status) setOutcome({ status: 'failed', warnings: [envelope.error.message] });
      else setOutcome(data);
    } catch (err) {
      setOutcome({ status: 'failed', warnings: [err.message] });
    } finally {
      setRetiring(false);
    }
  };
  return (
    <article aria-label={description.title} className="border rounded-lg overflow-hidden">
      <div className="p-4 bg-gray-50 border-b flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-medium text-gray-900">{description.title}</h3>
            <span className={`px-2 py-0.5 rounded border text-xs ${TONE[usage.tone]}`}>
              {usage.label}
            </span>
            {prompt.isRetired ? (
              <span className="px-2 py-0.5 rounded border bg-gray-100 text-gray-600 border-gray-300 text-xs">
                retired
              </span>
            ) : !prompt.hasCurrent && (
              <span className="px-2 py-0.5 rounded border bg-amber-50 text-amber-800 border-amber-200 text-xs">
                draft — no published version
              </span>
            )}
          </div>
          <p className="mt-2 max-w-3xl text-sm text-gray-700">{description.description}</p>
          <p className="mt-1 text-sm text-gray-600"><span className="font-medium">Used by:</span> {description.usedBy}</p>
          <PromptDestinations prompt={prompt} />
          <p className="mt-2 mb-1 text-xs text-gray-500"><code className="break-all">{prompt.name}</code></p>
          <div className="text-xs text-gray-500">
            {prompt.hasCurrent ? 'current version' : 'latest version'} <strong>v{prompt.version ?? '?'}</strong> · {(prompt.body || '').length} chars
          </div>
          <div className="text-[11px] text-gray-400 mt-0.5">
            published {fmtTs(prompt.publishedAt || prompt.createdOn)} · last touched {fmtTs(prompt.modifiedOn)}
            {prompt.modifiedByName ? <> by {prompt.modifiedByName}</> : null}
          </div>
          <OutputBudgetLine
            prompt={prompt}
            modelCatalog={modelCatalog}
            executorBudgetConfig={executorBudgetConfig}
          />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <DataverseFieldInfoButton items={dataverseFields} />
          <button
            type="button"
            onClick={() => { setEditingDetails((e) => !e); setExpanded(false); }}
            className="px-3 py-1.5 text-sm border border-gray-300 text-gray-700 rounded hover:bg-gray-100"
          >
            {editingDetails ? 'Close details' : 'Edit details'}
          </button>
          <button
            onClick={() => { setExpanded((e) => !e); setEditingDetails(false); }}
            className="px-3 py-1.5 text-sm bg-gray-900 text-white rounded hover:bg-gray-800"
          >
            {expanded ? 'Cancel' : (prompt.hasCurrent ? 'Edit & publish' : 'Review & publish')}
          </button>
          {prompt.hasCurrent && (
            <button
              type="button"
              onClick={() => { setConfirmingRetire(true); setExpanded(false); setEditingDetails(false); }}
              disabled={retireBlocked}
              title={retireBlocked ? 'Marked Application caller: an app may depend on this prompt, so it can’t be retired here.' : undefined}
              className="px-3 py-1.5 text-sm border border-gray-300 text-gray-700 rounded hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Retire
            </button>
          )}
        </div>
      </div>
      {confirmingRetire && (
        <div role="group" aria-label="Confirm retire" className={`p-4 border-b text-sm ${TONE.amber}`}>
          <p>Retire this prompt? Apps can no longer use it. Nothing is deleted: it moves to Retired prompts, and Review &amp; publish brings it back as a new version.</p>
          <div className="mt-2 flex justify-end gap-3">
            <button type="button" onClick={() => setConfirmingRetire(false)} className="text-xs text-gray-700 hover:text-gray-900">Cancel</button>
            <button type="button" onClick={retire} disabled={retiring} className="px-3 py-1.5 text-sm bg-gray-900 text-white rounded hover:bg-gray-800 disabled:opacity-40">
              {retiring ? 'Retiring…' : 'Retire prompt'}
            </button>
          </div>
        </div>
      )}

      {editingDetails && (
        <PromptCatalogForm
          prompt={prompt}
          fallback={getAdminPromptDescription(prompt.name)}
          groups={groups}
          onSuccess={(o) => { setOutcome(o); onPublished(); setEditingDetails(false); }}
          onOutcome={setOutcome}
          onCancel={() => setEditingDetails(false)}
        />
      )}
      {expanded && (
        <PublishForm
          prompt={prompt}
          modelCatalog={modelCatalog}
          onSuccess={(o) => { setOutcome(o); onPublished(); setExpanded(false); }}
          onOutcome={setOutcome}
        />
      )}
      {outcome && <OutcomeBanner outcome={outcome} onDismiss={() => setOutcome(null)} />}
    </article>
  );
}

function PromptDestinations({ prompt }) {
  const { caller, configured, configurationIssue, fallback } = describePromptDestinations(prompt);
  return (
    <div className="mt-2 max-w-3xl text-sm text-gray-600" aria-label="Output destinations">
      <p><span className="font-medium">Writes to:</span> {caller?.summary || fallback}</p>
      {!prompt.hasCurrent && <p className="mt-1 text-xs">This version is not current; destinations describe configuration and caller behavior, not an active run.</p>}
      {configured.map(item => (
        <p key={item.technical} className="mt-1 text-xs">
          {item.label} — <code className="break-all">{item.technical}</code> (configured writeback)
        </p>
      ))}
      {caller?.fields.length > 0 && (
        <details className="mt-1 text-xs">
          <summary className="cursor-pointer">Tables and fields saved by the caller</summary>
          <ul className="mt-1 space-y-1">
            {caller.fields.map(field => <li key={field}><code className="break-all">{field}</code></li>)}
          </ul>
        </details>
      )}
      {configurationIssue && <p className="mt-1 text-xs text-amber-800">{configurationIssue}</p>}
      {!configurationIssue && configured.length === 0 && <p className="mt-1 text-xs">No direct Executor field writeback is declared.</p>}
    </div>
  );
}

function buildPromptDataverseFields(prompt) {
  const row = prompt.id
    ? `wmkf_ai_promptid = "${prompt.id}"`
    : `wmkf_ai_promptname = "${prompt.name}"`;
  return [
    {
      label: 'Prompt name',
      entity: 'wmkf_ai_prompt',
      entitySet: 'wmkf_ai_prompts',
      field: 'wmkf_ai_promptname',
      row,
    },
    {
      label: 'Version number',
      entity: 'wmkf_ai_prompt',
      entitySet: 'wmkf_ai_prompts',
      field: 'wmkf_promptversion',
      row,
    },
    {
      label: 'Current flag',
      entity: 'wmkf_ai_prompt',
      entitySet: 'wmkf_ai_prompts',
      field: 'wmkf_ai_iscurrent',
      row,
    },
    {
      label: 'System prompt',
      entity: 'wmkf_ai_prompt',
      entitySet: 'wmkf_ai_prompts',
      field: 'wmkf_ai_systemprompt',
      row,
    },
    {
      label: 'Prompt body',
      entity: 'wmkf_ai_prompt',
      entitySet: 'wmkf_ai_prompts',
      field: 'wmkf_ai_promptbody',
      row,
    },
    {
      label: 'Model',
      entity: 'wmkf_ai_prompt',
      entitySet: 'wmkf_ai_prompts',
      field: 'wmkf_ai_model',
      row,
      note: 'Publishing a model change creates a new immutable prompt version.',
    },
    {
      label: 'Prompt status',
      entity: 'wmkf_ai_prompt',
      entitySet: 'wmkf_ai_prompts',
      field: 'wmkf_ai_promptstatus',
      row,
    },
    {
      label: 'Published timestamp',
      entity: 'wmkf_ai_prompt',
      entitySet: 'wmkf_ai_prompts',
      field: 'wmkf_ai_publisheddatetime',
      row,
    },
    {
      label: 'Last touched timestamp',
      entity: 'wmkf_ai_prompt',
      entitySet: 'wmkf_ai_prompts',
      field: 'modifiedon',
      row,
    },
    {
      label: 'Last touched by',
      entity: 'wmkf_ai_prompt',
      entitySet: 'wmkf_ai_prompts',
      field: '_modifiedby_value',
      row,
      note: 'The route displays the Dataverse formatted value as the user name.',
    },
  ];
}

// Mirrors execute-prompt.js: the prompt row's model (a tier key or a model id),
// else the platform default; tier keys resolve through the catalog.
function resolvePromptModel(prompt, modelCatalog) {
  const raw = String(prompt.model || '').trim();
  const tier = raw && (modelCatalog?.tiers || []).find((t) => t.key === raw);
  if (tier) return { label: `${raw} tier → ${tier.resolvedId || '?'}`, id: tier.resolvedId || null };
  if (raw) return { label: raw, id: raw };
  const id = modelCatalog?.defaultModelResolved || modelCatalog?.defaultModel || null;
  return { label: id ? `default → ${id}` : 'default', id };
}

/**
 * The configured and effective max_tokens budget, next to the model's reviewed
 * output ceiling and the Anthropic page that ceiling was read from.
 * Server-owned overrides come from the same resolved durable revision that
 * runtime callers read, so the panel cannot drift from execution.
 */
export function OutputBudgetLine({ prompt, modelCatalog, executorBudgetConfig }) {
  const budget = executorBudgetConfig?.budgets?.[prompt.name] || null;
  const description = executorBudgetConfig?.descriptions?.[prompt.name] || null;
  const rowMax = Number.isInteger(prompt.maxTokens) && prompt.maxTokens > 0 ? prompt.maxTokens : null;
  const base = rowMax ?? ROW_DEFAULT_MAX_TOKENS;
  const effective = budget?.kind === 'standing' ? budget.maxTokensOverride : base;
  const model = resolvePromptModel(prompt, modelCatalog);
  const capability = model.id ? modelCatalog?.modelStatuses?.[model.id]?.capability : null;
  const ceiling = capability?.maxOutputTokens ?? null;
  const rowOverCeiling = Number.isFinite(ceiling) && base > ceiling;
  const overrideRequested = budget?.kind === 'standing'
    ? budget.maxTokensOverride
    : budget?.kind === 'retry' ? budget.ceiling : null;
  const overrideOverCeiling = Number.isFinite(ceiling)
    && Number.isFinite(overrideRequested)
    && overrideRequested > ceiling;
  const standingEffective = budget?.kind === 'standing' && Number.isFinite(ceiling)
    ? Math.min(effective, ceiling)
    : effective;
  const tone = rowOverCeiling
    ? 'text-red-700'
    : overrideOverCeiling ? 'text-amber-700' : budget ? 'text-gray-600' : 'text-gray-400';
  return (
    <div className={`text-[11px] mt-0.5 ${tone}`} data-testid="output-budget">
      <span className="font-medium">Output budget</span>{' '}
      <span title="max_tokens the Executor sends on this prompt's calls">{fmtInt(standingEffective)} tokens</span>
      {budget?.kind === 'standing' ? (
        <> ({fmtInt(budget.maxTokensOverride)} configured by {executorBudgetConfig?.source === 'dataverse' ? `published revision ${executorBudgetConfig.version}` : 'reviewed code fallback'}{overrideOverCeiling ? '; capped to the model ceiling at execution' : ''}; prompt row {rowMax ? fmtInt(rowMax) : `default ${fmtInt(ROW_DEFAULT_MAX_TOKENS)}`}
          {budget.timeoutMsOverride ? <>; timeout {Math.round(budget.timeoutMsOverride / 1000)}s</> : null})</>
      ) : budget?.kind === 'retry' ? (
        <> (prompt row{rowMax ? '' : ' default'}; configured retry {fmtInt(budget.floor)}–{fmtInt(budget.ceiling)} on max_tokens truncation{overrideOverCeiling ? `, effective retry ceiling ${fmtInt(ceiling)}` : ''}; {executorBudgetConfig?.source === 'dataverse' ? `published revision ${executorBudgetConfig.version}` : 'reviewed code fallback'})</>
      ) : budget?.kind === 'timeout' ? (
        <> (prompt row{rowMax ? '' : ' default'}; timeout {Math.round(budget.timeoutMsOverride / 1000)}s configured by {executorBudgetConfig?.source === 'dataverse' ? `published revision ${executorBudgetConfig.version}` : 'reviewed code fallback'})</>
      ) : (
        <> (prompt row{rowMax ? '' : ' default'})</>
      )}
      {' · '}model {model.label}
      {capability?.status === 'reviewed' ? (
        <>
          {' · '}ceiling {fmtInt(ceiling)}{rowOverCeiling
            ? ' — PROMPT ROW OVER CEILING; the Executor will reject this call'
            : overrideOverCeiling ? ' — configured override is capped at this ceiling' : ''}
          {capability.thinkingMode ? <> · thinking {capability.thinkingMode.replace(/_/g, ' ')}{capability.defaultEffort ? ` (effort ${capability.defaultEffort})` : ''}, counted inside the budget</> : null}
          {capability.source ? (
            <>
              {' · '}
              <a href={capability.source} target="_blank" rel="noreferrer" className="underline hover:text-gray-900">
                Anthropic model docs ↗
              </a>
              {capability.reviewedAt ? <> (registry reviewed {capability.reviewedAt})</> : null}
            </>
          ) : null}
        </>
      ) : model.id ? (
        <span className="text-amber-700"> · model not in the capability registry — ceiling unknown</span>
      ) : null}
      {description?.reason ? <div className="text-gray-400">{description.reason}</div> : null}
    </div>
  );
}

function OutcomeBanner({ outcome, onDismiss }) {
  const meta = STATUS_COPY[outcome.status] || { tone: 'gray', text: outcome.status };
  return (
    <div className={`p-3 border-t text-sm ${TONE[meta.tone]}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="font-medium">{meta.text}</div>
          {outcome.newPromptId && <div className="mt-1 text-xs">New version: v{outcome.targetVersion} (<code>{outcome.newPromptId}</code>)</div>}
          {outcome.error && <div className="mt-1 text-xs">{outcome.error}</div>}
          {outcome.issues && outcome.issues.length > 0 && (
            <ul className="mt-1 text-xs list-disc ml-5">{outcome.issues.map((x, i) => (<li key={i}>{x}</li>))}</ul>
          )}
          {outcome.warnings && outcome.warnings.length > 0 && (
            <ul className="mt-1 text-xs list-disc ml-5">{outcome.warnings.map((w, i) => (<li key={i}>{w}</li>))}</ul>
          )}
          {outcome.orphan && <div className="mt-1 text-xs">Orphan version: <code>{outcome.orphan.id}</code> ({outcome.orphan.reason})</div>}
          {outcome.ids && <div className="mt-1 text-xs">Current IDs: {outcome.ids.join(', ')}</div>}
        </div>
        <button onClick={onDismiss} className="text-xs underline">dismiss</button>
      </div>
    </div>
  );
}
