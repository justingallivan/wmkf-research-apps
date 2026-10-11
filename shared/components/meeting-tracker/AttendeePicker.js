/**
 * Site Visit people picker (Site Visit redesign §3.1, DESIGN.md People Picker Rule): one search box over the staff
 * and Board directory and one list of the people chosen, instead of every name rendered twice. In `single` mode it
 * picks one person (the organizer). Saved refs keep their shape; manual applicant attendees are not shown here.
 */
import { useId, useState } from 'react';
import { Button } from '../Layout';

const MAX_RESULTS = 8;
const GROUP_LABEL = { staff: 'Staff', roster: 'Board' };

function same(left, right) {
  if (!left || !right || left.kind !== right.kind) return false;
  if (left.kind === 'staff') return left.profileId === right.profileId;
  if (left.kind === 'roster') return left.rosterId === right.rosterId;
  return false;
}
function keyOf(ref) { return `${ref.kind}-${ref.profileId ?? ref.rosterId}`; }

export default function AttendeePicker({
  label, people, selected = [], roles = null, onAdd, onRemove, onRole, disabled = false, single = false, hintFor, full = false,
  roleFull = () => false,
}) {
  const [query, setQuery] = useState('');
  const inputId = useId();
  const listId = useId();
  const chosen = selected.filter((ref) => ref && (ref.kind === 'staff' || ref.kind === 'roster'));
  const find = (ref) => people.find((person) => same(person.ref, ref));
  const needle = query.trim().toLowerCase();
  const results = needle
    ? people.filter((person) => !chosen.some((ref) => same(ref, person.ref))
      && String(person.name || '').toLowerCase().includes(needle)).slice(0, MAX_RESULTS)
    : [];
  const add = (person) => { onAdd(person.ref); setQuery(''); };
  return (
    <div>
      {(!single || chosen.length === 0) && (
        <>
          <label htmlFor={inputId} className="block text-sm font-medium text-gray-700">{label}</label>
          <input id={inputId} type="search" value={query} disabled={disabled || full} autoComplete="off"
            aria-controls={listId} aria-describedby={full ? `${inputId}-full` : undefined}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Type a name"
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 md:w-96" />
          {full && <p id={`${inputId}-full`} className="mt-1 text-xs text-gray-500">Both attendee lists are full.</p>}
          {results.length > 0 && (
            <ul id={listId} aria-label={`Matches for ${label}`} className="mt-1 w-full divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white md:w-96">
              {results.map((person) => {
                const noEmail = !person.email;
                return (
                  <li key={keyOf(person.ref)}>
                    <button type="button" disabled={disabled || noEmail} title={noEmail ? hintFor?.(person) : undefined} onClick={() => add(person)}
                      className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50">
                      <span>{single ? 'Choose' : 'Add'} {person.name}{noEmail ? ' · no email' : ''}</span>
                      <span className="text-xs text-gray-500">{GROUP_LABEL[person.ref.kind]}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {needle && results.length === 0 && <p className="mt-1 text-xs text-gray-500">No one matches “{query.trim()}”.</p>}
        </>
      )}
      {chosen.length > 0 && (
        <ul className={`${single ? '' : 'mt-3 '}divide-y divide-gray-100 rounded-lg border border-gray-200`} aria-label={single ? label : `${label}: chosen`}>
          {chosen.map((ref) => {
            const person = find(ref);
            const name = person?.name || 'Unknown person';
            const role = roles?.(ref);
            return (
              <li key={keyOf(ref)} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                <span className="min-w-0">
                  {single && <span className="mr-2 text-xs font-medium text-gray-500">{label}</span>}
                  <span className="font-medium text-gray-900">{name}</span>
                  <span className="ml-2 text-xs text-gray-500">{GROUP_LABEL[ref.kind]}{person && !person.email ? ' · no email' : ''}</span>
                </span>
                <span className="flex items-center gap-2">
                  {onRole && (
                    <span role="group" aria-label={`${name}: attendance`} className="inline-flex overflow-hidden rounded-lg border border-gray-300">
                      {['required', 'optional'].map((value) => (
                        <button key={value} type="button" aria-pressed={role === value} disabled={disabled || (role !== value && roleFull(value))}
                          title={role !== value && roleFull(value) ? `The ${value === 'required' ? 'Required' : 'Optional'} list is full.` : undefined}
                          onClick={() => onRole(ref, value)}
                          className={`px-3 py-1.5 text-xs font-medium ${role === value ? 'bg-gray-900 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'} disabled:opacity-50`}>
                          {value === 'required' ? 'Required' : 'Optional'}
                        </button>
                      ))}
                    </span>
                  )}
                  <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => onRemove(ref)} aria-label={single ? `Change ${label.toLowerCase()}` : `Remove ${name}`}>
                    {single ? 'Change' : 'Remove'}
                  </Button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
