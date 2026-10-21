/** Controlled review-question row fields, options, and reorder controls. */
const TYPE_OPTIONS = [
  { value: 'richtext', label: 'Rich text (narrative)' },
  { value: 'picklist', label: 'Rating (single choice)' },
  { value: 'multiselect', label: 'Multiselect (check all that apply)' },
  { value: 'string', label: 'Short text (single line)' },
];

export const isOptionType = (type) => type === 'picklist' || type === 'multiselect';

export default function ReviewQuestionRowEditor({
  row, index, rowCount, conflicts, update, moveRow, removeRow,
  onDragStart, onDragOver, onDrop,
}) {
  return (
    <li
      draggable
      onDragStart={() => onDragStart(index)}
      onDragOver={onDragOver}
      onDrop={() => onDrop(index)}
      data-testid="rq-row"
      className={`rounded-lg border p-3 ${
        conflicts && row.id && conflicts.changed.has(row.id)
          ? 'border-amber-400 bg-amber-50'
          : conflicts && row.id && conflicts.removed.has(row.id)
            ? 'border-red-300 bg-red-50'
            : 'border-gray-200 bg-gray-50'
      }`}
    >
      <div className="flex items-start gap-2">
        <span className="cursor-grab select-none pt-2 text-xs font-semibold text-gray-400" title="Drag to reorder" aria-hidden="true">Drag</span>
        <div className="flex-1 min-w-0 space-y-2">
          {conflicts && row.id && conflicts.changed.has(row.id) && (
            <p className="text-xs text-amber-900" data-testid="rq-row-conflict">
              Someone else edited this question while you were working. Saving keeps your version and overwrites theirs.
            </p>
          )}
          {conflicts && row.id && conflicts.removed.has(row.id) && (
            <p className="text-xs text-red-800" data-testid="rq-row-removed">
              This question was removed on the server. Saving will recreate it under its existing key.
            </p>
          )}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold text-gray-500">Q{index + 1}</span>
            {row.id ? (
              <span className="rounded bg-gray-200 px-1.5 py-0.5 text-xs text-gray-600" title="Key is locked because it links existing reviewer answers">
                key: {row.key} (locked)
              </span>
            ) : (
              <input
                aria-label="Question key"
                placeholder="key (e.g. q12)"
                value={row.key}
                onChange={(e) => update(index, { key: e.target.value })}
                className="px-2 py-1 border border-gray-300 rounded text-xs w-40"
              />
            )}
            <select
              aria-label="Question type"
              value={row.type}
              onChange={(e) => {
                const type = e.target.value;
                update(index, {
                  type,
                  options: isOptionType(type) ? row.options : [],
                  maxLength: isOptionType(type) ? '' : row.maxLength,
                });
              }}
              className="px-2 py-1 border border-gray-300 rounded text-xs"
            >
              {TYPE_OPTIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            <label className="flex items-center gap-1 text-xs text-gray-600">
              <input type="checkbox" checked={row.required} onChange={(e) => update(index, { required: e.target.checked })} />
              Required
            </label>
            <button
              type="button"
              onClick={() => moveRow(index, -1)}
              disabled={index === 0}
              aria-label={`Move question ${index + 1} up`}
              className="min-h-9 rounded border border-gray-300 bg-white px-2 py-1 text-xs font-semibold text-gray-600 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Move up
            </button>
            <button
              type="button"
              onClick={() => moveRow(index, 1)}
              disabled={index === rowCount - 1}
              aria-label={`Move question ${index + 1} down`}
              className="min-h-9 rounded border border-gray-300 bg-white px-2 py-1 text-xs font-semibold text-gray-600 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Move down
            </button>
            <button
              onClick={() => removeRow(index)}
              className="ml-auto text-xs text-red-600 hover:text-red-800"
              title="Remove this question"
            >
              Remove
            </button>
          </div>

          <textarea
            aria-label="Question text"
            placeholder="Question text shown to the reviewer"
            value={row.label}
            onChange={(e) => update(index, { label: e.target.value })}
            rows={2}
            className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
          />

          <div className="flex items-center gap-2 flex-wrap">
            <input
              aria-label="Hint"
              placeholder="Optional hint"
              value={row.hint}
              onChange={(e) => update(index, { hint: e.target.value })}
              className="px-2 py-1 border border-gray-300 rounded text-xs flex-1 min-w-[12rem]"
            />
            {!isOptionType(row.type) && (
              <label className="flex items-center gap-1 text-xs text-gray-500">
                Max length
                <input
                  aria-label="Max length"
                  type="number"
                  min="1"
                  value={row.maxLength}
                  onChange={(e) => update(index, { maxLength: e.target.value })}
                  className="px-2 py-1 border border-gray-300 rounded text-xs w-24"
                />
              </label>
            )}
          </div>

          {isOptionType(row.type) && (
            <OptionsEditor
              options={row.options}
              onChange={(options) => update(index, { options })}
            />
          )}
        </div>
      </div>
    </li>
  );
}

function OptionsEditor({ options, onChange }) {
  const setOption = (i, patch) => onChange(options.map((o, idx) => (idx === i ? { ...o, ...patch } : o)));
  const addOption = () => {
    const nextVal = options.reduce((m, o) => Math.max(m, Number(o.value) || 0), 0) + 1;
    onChange([...options, { value: String(nextVal), label: '' }]);
  };
  const removeOption = (i) => onChange(options.filter((_, idx) => idx !== i));

  return (
    <div className="rounded border border-gray-200 bg-white p-2">
      <p className="mb-1 text-xs uppercase tracking-wide text-gray-400">Options</p>
      <div className="space-y-1">
        {options.map((o, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              aria-label={`Option ${i + 1} value`}
              type="number"
              value={o.value}
              onChange={(e) => setOption(i, { value: e.target.value })}
              className="px-2 py-1 border border-gray-300 rounded text-xs w-16"
            />
            <input
              aria-label={`Option ${i + 1} label`}
              placeholder="Option label"
              value={o.label}
              onChange={(e) => setOption(i, { label: e.target.value })}
              className="px-2 py-1 border border-gray-300 rounded text-xs flex-1"
            />
            <button onClick={() => removeOption(i)} className="text-xs text-red-600 hover:text-red-800" title="Remove option">✕</button>
          </div>
        ))}
      </div>
      <button onClick={addOption} className="mt-1 text-xs text-gray-600 hover:text-gray-900">+ Add option</button>
    </div>
  );
}
