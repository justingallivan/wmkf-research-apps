/**
 * Add, rename and reorder Admin prompt groups (owner decision 2026-11-02:
 * no sections for new groups, no deletion; pinned groups are not editable).
 * Reordering uses the same @hello-pangea/dnd pattern as the Proposal Ranking
 * assessment list (grip handle, keyboard lift/move/drop, reduced-motion drop
 * fix, live announcements). New groups are added at the end of the list.
 * Saves the whole editable list under the loaded revision. Server contract:
 * lib/services/admin/prompt-groups-service.js (PUT /api/admin/prompt-groups).
 */
import { useEffect, useState } from 'react';
import { DragDropContext, Draggable, Droppable } from '@hello-pangea/dnd';
import { GripVertical } from 'lucide-react';
import { requestEnvelope } from '../../utils/api-request';
import { TONE } from './prompt-editor-utils';
import {
  ADMIN_PROMPT_GROUPS, PINNED_PROMPT_GROUP_IDS, PROMPT_GROUP_LABEL_MAX, promptGroupIdFromLabel,
} from '../../config/adminPromptCatalog';

const PINNED_LABELS = ADMIN_PROMPT_GROUPS.filter((group) => PINNED_PROMPT_GROUP_IDS.includes(group.id)).map((group) => group.label);

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
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  const [notice, setNotice] = useState('');
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!media) return undefined;
    const sync = () => setReduced(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  const newId = promptGroupIdFromLabel(newLabel);
  const addIssue = !newLabel.trim() ? null
    : !newId ? 'Use at least one letter or digit.'
    : PINNED_PROMPT_GROUP_IDS.includes(newId) || list.some((group) => group.id === newId)
      ? 'A group with that name already exists.'
      : list.some((group) => group.label.trim().toLowerCase() === newLabel.trim().toLowerCase())
        ? 'A group with that name already exists.' : null;
  const issues = groupListIssues(list);
  const unchanged = JSON.stringify(list.map(({ id, label }) => ({ id, label: label.trim() })))
    === JSON.stringify(editable.map(({ id, label }) => ({ id, label })));

  const add = () => {
    setList([...list, { id: newId, label: newLabel.trim(), isNew: true }]);
    setNotice(`Added ${newLabel.trim()} at the end of the list. Drag it into place.`);
    setNewLabel('');
  };
  const move = (from, to) => {
    if (from === to) return;
    const next = [...list];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    setList(next);
    setNotice(`Moved ${item.label || 'group'} to position ${to + 1} of ${next.length}.`);
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
        Groups organize the prompt list. Drag a group by its handle to reorder it, or rename it in place; its prompts stay in it. Groups can’t be deleted.
      </p>
      <p className="sr-only" aria-live="polite">{notice}</p>
      <DragDropContext onDragEnd={({ source, destination }) => { if (destination) move(source.index, destination.index); }}>
        <Droppable droppableId="prompt-groups">
          {(drop) => (
            <ol ref={drop.innerRef} {...drop.droppableProps} className="space-y-2" aria-label="Prompt groups">
              {list.map((group, index) => (
                <Draggable key={group.id} draggableId={group.id} index={index}>
                  {(drag, dragState) => (
                    <li
                      ref={drag.innerRef}
                      {...drag.draggableProps}
                      style={{
                        ...drag.draggableProps.style,
                        // The drag library completes a drop on transform transitionend.
                        // `none` (or 0s) leaves reduced-motion users stuck dropping.
                        ...(reduced ? dragState.isDropAnimating
                          ? { transitionDuration: '0.001s' }
                          : { transition: 'none' } : {}),
                      }}
                      className={`flex items-center gap-2 rounded-lg border bg-white pr-2 ${dragState.isDragging ? 'shadow-lg border-gray-300' : 'border-gray-200'}`}
                    >
                      <span
                        {...drag.dragHandleProps}
                        aria-label={`Drag ${group.label || 'group'} to reorder`}
                        className="inline-flex h-11 w-11 shrink-0 cursor-grab items-center justify-center rounded text-gray-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 active:cursor-grabbing"
                      >
                        <GripVertical size={18} />
                      </span>
                      <input
                        type="text"
                        aria-label={`Name of group ${index + 1}`}
                        value={group.label}
                        onChange={(event) => rename(index, event.target.value)}
                        className={`${input} flex-1`}
                      />
                      {group.isNew && <span className="text-[10px] text-gray-500">new</span>}
                    </li>
                  )}
                </Draggable>
              ))}
              {drop.placeholder}
            </ol>
          )}
        </Droppable>
      </DragDropContext>
      <ul className="space-y-2" aria-label="Fixed groups">
        {PINNED_LABELS.map((label) => (
          <li key={label} className="flex items-center gap-2 rounded-lg border border-dashed border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-500">
            {label} <span className="text-[10px]">(always last)</span>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-end gap-2 border-t pt-3">
        <label className="block text-xs text-gray-700">
          New group
          <input type="text" value={newLabel} onChange={(event) => setNewLabel(event.target.value)} maxLength={PROMPT_GROUP_LABEL_MAX} className={`${input} mt-1 block`} />
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
