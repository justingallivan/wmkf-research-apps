/**
 * Add, rename and reorder Admin prompt groups (owner decision 2026-11-02:
 * no sections for new groups, no deletion; pinned groups are not editable).
 * Saves the whole editable list under the loaded revision. Server contract:
 * lib/services/admin/prompt-groups-service.js (PUT /api/admin/prompt-groups).
 */
import { useState } from 'react';
import { requestEnvelope } from '../../utils/api-request';
import { TONE } from './prompt-editor-utils';
import { PROMPT_GROUP_LABEL_MAX, promptGroupIdFromLabel } from '../../config/adminPromptCatalog';

const PINNED_NOTE = '“Uncataloged prompts” and “Legacy app prompts” always stay at the bottom.';

export function groupListIssues(list) {
  const issues = [];
  const labels = new Set();
  for (const group of list) {
    const label = group.label.trim();
    if (!label) issues.push('Group names can’t be blank.');
    else if (label.length > PROMPT_GROUP_LABEL_MAX) issues.push(`“${label.slice(0, 30)}…” is longer than ${PROMPT_GROUP_LABEL_MAX} characters.`);
    else if (labels.has(label.toLowerCase())) issues.push(`Two groups are named “${label}”.`);
    labels.add(label.toLowerCase());
  }
  return [...new Set(issues)];
}

export default function ManagePromptGroupsPanel({ editable, revision, onSaved, onClose }) {
  const [list, setList] = useState(() => editable.map((group) => ({ ...group })));
  const [newLabel, setNewLabel] = useState('');
  const [placeAfter, setPlaceAfter] = useState(editable[editable.length - 1]?.id || '');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  const newId = promptGroupIdFromLabel(newLabel);
  const addIssue = !newLabel.trim() ? null
    : !newId ? 'Use at least one letter or digit.'
    : ['uncataloged', 'reference'].includes(newId) || list.some((group) => group.id === newId)
      ? 'A group with that name already exists.'
      : list.some((group) => group.label.trim().toLowerCase() === newLabel.trim().toLowerCase())
        ? 'A group with that name already exists.' : null;
  const issues = groupListIssues(list);
  const unchanged = JSON.stringify(list.map(({ id, label }) => ({ id, label: label.trim() })))
    === JSON.stringify(editable.map(({ id, label }) => ({ id, label })));

  const add = () => {
    const index = list.findIndex((group) => group.id === placeAfter);
    const next = [...list];
    next.splice(index + 1, 0, { id: newId, label: newLabel.trim(), isNew: true });
    setList(next);
    setPlaceAfter(newId);
    setNewLabel('');
  };
  const move = (index, delta) => {
    const next = [...list];
    const [item] = next.splice(index, 1);
    next.splice(index + delta, 0, item);
    setList(next);
  };
  const rename = (index, label) => setList(list.map((group, i) => (i === index ? { ...group, label } : group)));

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const envelope = await requestEnvelope('/api/admin/prompt-groups', {
        method: 'PUT',
        body: { groups: list.map(({ id, label }) => ({ id, label: label.trim() })), expectedRevision: revision },
      });
      const { data } = envelope;
      if (data?.status === 'groups_saved') onSaved();
      else setMessage({ tone: data?.status === 'groups_conflict' ? 'amber' : 'red', text: data?.error || envelope.error?.message || 'Groups could not be saved.' });
    } catch (err) {
      setMessage({ tone: 'red', text: err.message });
    } finally {
      setSaving(false);
    }
  };

  const input = 'px-2 py-1 border border-gray-300 rounded text-sm';
  return (
    <section aria-label="Manage groups" className="mb-6 border rounded-lg p-4 space-y-3 bg-white">
      <h3 className="font-medium text-gray-900">Manage groups</h3>
      <p className="text-xs text-gray-500">
        Groups organize the prompt list. Renaming a group keeps its prompts in it. Groups can’t be deleted. {PINNED_NOTE}
      </p>
      <ol className="space-y-1">
        {list.map((group, index) => (
          <li key={group.id} className="flex items-center gap-2">
            <input
              type="text"
              aria-label={`Name of group ${index + 1}`}
              value={group.label}
              onChange={(event) => rename(index, event.target.value)}
              className={`${input} flex-1`}
            />
            {group.isNew && <span className="text-[10px] text-gray-500">new</span>}
            <button type="button" aria-label={`Move ${group.label} up`} onClick={() => move(index, -1)} disabled={index === 0} className="px-2 text-sm text-gray-600 disabled:opacity-30">↑</button>
            <button type="button" aria-label={`Move ${group.label} down`} onClick={() => move(index, 1)} disabled={index === list.length - 1} className="px-2 text-sm text-gray-600 disabled:opacity-30">↓</button>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-end gap-2 border-t pt-3">
        <label className="block text-xs text-gray-700">
          New group
          <input type="text" value={newLabel} onChange={(event) => setNewLabel(event.target.value)} maxLength={PROMPT_GROUP_LABEL_MAX} className={`${input} mt-1 block`} />
        </label>
        <label className="block text-xs text-gray-700">
          Place after
          <select value={placeAfter} onChange={(event) => setPlaceAfter(event.target.value)} className={`${input} mt-1 block`}>
            {list.map((group) => <option key={group.id} value={group.id}>{group.label || '(blank)'}</option>)}
          </select>
        </label>
        <button type="button" onClick={add} disabled={!newLabel.trim() || !!addIssue} className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-100 disabled:opacity-40">Add</button>
        {addIssue && <span className="text-xs text-red-700">{addIssue}</span>}
      </div>
      {issues.length > 0 && (
        <ul className={`text-xs px-3 py-2 rounded border list-disc pl-6 ${TONE.red}`}>
          {issues.map((issue) => <li key={issue}>{issue}</li>)}
        </ul>
      )}
      {message && <div role="alert" className={`text-xs px-3 py-2 rounded border ${TONE[message.tone]}`}>{message.text}</div>}
      <div className="flex items-center justify-end gap-3">
        <button type="button" onClick={onClose} className="text-xs text-gray-600 hover:text-gray-900">Close</button>
        <button
          type="button"
          onClick={save}
          disabled={saving || unchanged || issues.length > 0}
          className="px-4 py-1.5 bg-gray-900 text-white text-sm font-medium rounded hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {saving ? 'Saving…' : 'Save groups'}
        </button>
      </div>
    </section>
  );
}
