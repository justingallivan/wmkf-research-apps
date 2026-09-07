/**
 * ToolbarSelect — the Workbench toolbar dropdown (Final writeups style).
 *
 * A labeled `<select>` in a 48px rounded-xl box with a drawn chevron. The
 * select opts out of the native menu-button appearance because Safari ignores
 * height and padding on a native `<select>`, which left toolbar dropdowns
 * ~30px tall beside 48px sibling controls. Use this wherever a page-level
 * toolbar offers a dropdown, so the suite's toolbars share one control.
 */

export const TOOLBAR_CONTROL_HEIGHT_CLASS = 'h-12';

export const TOOLBAR_SELECT_CLASS = `${TOOLBAR_CONTROL_HEIGHT_CLASS} w-full appearance-none rounded-xl border border-gray-300 bg-white pl-4 pr-10 text-base text-gray-900 shadow-sm focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-400/30 disabled:opacity-60`;

function ChevronsIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
      <path d="m7 9 5-5 5 5M7 15l5 5 5-5" />
    </svg>
  );
}

export default function ToolbarSelect({
  id,
  label,
  value,
  disabled = false,
  onChange,
  children,
  className = '',
}) {
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label htmlFor={id} className="text-sm font-medium text-gray-700">{label}</label>
      <div className="relative">
        <select
          id={id}
          value={value}
          disabled={disabled}
          onChange={onChange}
          className={TOOLBAR_SELECT_CLASS}
        >
          {children}
        </select>
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-gray-500">
          <ChevronsIcon />
        </span>
      </div>
    </div>
  );
}
