/**
 * View filter input — the labeled, live-filtering search box shared by
 * Reviewer follow-up and Final writeups (Slice B of the Workbench top-matter
 * reconciliation, 2026-09-08). It filters rows already loaded for the active
 * program/cycle; it never submits or navigates. Callers own the debounced
 * `value`/`onChange` pair (typically `useUrlMirroredInput`) and the shown/total
 * counts used for the "Showing X of Y" line.
 *
 * Clear resets the local value; the caller's debounce (`useUrlMirroredInput`)
 * carries the empty string into the URL after its own pause, so Clear does not
 * call a second, separate URL-write path.
 */

/**
 * @param {object} props
 * @param {string} props.id
 * @param {string} props.label       visible label (not sr-only)
 * @param {string} props.placeholder
 * @param {string} props.value
 * @param {Function} props.onChange  (value) => void
 * @param {number} props.shown       rows visible after the filter
 * @param {number} props.total       rows visible before the filter (same program/cycle/structural filters)
 * @param {string} props.unitSingular  singular noun, e.g. "request" or "writeup"
 * @param {string} props.unitPlural    plural noun, e.g. "requests" or "writeups"
 */
export default function ViewFilterInput({ id, label, placeholder, value, onChange, shown, total, unitSingular, unitPlural }) {
  const active = value.trim().length > 0;
  const unit = total === 1 ? unitSingular : unitPlural;
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-gray-700">{label}</label>
      <div className="relative max-w-2xl">
        <input
          id={id}
          type="search"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          className="min-h-11 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 pr-16 text-sm text-gray-900 placeholder:text-gray-500 focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-400/30"
        />
        {active && (
          <button
            type="button"
            onClick={() => onChange('')}
            className="absolute inset-y-0 right-2 my-auto h-8 rounded-md px-2 text-xs font-semibold text-gray-600 hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500"
          >
            Clear
          </button>
        )}
      </div>
      {active && (
        <p className="text-xs text-gray-500" aria-live="polite">
          Showing {shown} of {total} {unit}
        </p>
      )}
    </div>
  );
}
