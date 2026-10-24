/** Task navigation keeps setup, sending and preparation distinct without changing their persisted owners. */
export default function MeetingTaskNavigation({ idPrefix, tabs, selected, onChange }) {
  const activate = (index) => {
    if (tabs[index]?.disabled || onChange(tabs[index].id) === false) return;
    document.getElementById(`${idPrefix}-task-${tabs[index].id}`)?.focus();
  };
  return <div role="tablist" aria-label="Meeting tasks" className={`mb-6 grid gap-2 sm:grid-cols-2 ${tabs.length === 4 ? 'lg:grid-cols-4' : tabs.length === 3 ? 'lg:grid-cols-3' : 'lg:grid-cols-2'}`}>
    {tabs.map((tab, index) => <button key={tab.id} id={`${idPrefix}-task-${tab.id}`} type="button" role="tab"
      aria-selected={selected === tab.id} aria-controls={`${idPrefix}-panel-${tab.id}`} tabIndex={selected === tab.id ? 0 : -1}
      disabled={tab.disabled} onClick={() => activate(index)} onKeyDown={event => {
        const enabled = tabs.map((item, i) => item.disabled ? -1 : i).filter(i => i >= 0);
        const position = enabled.indexOf(index); let next;
        if (['ArrowRight', 'ArrowDown'].includes(event.key)) next = enabled[(position + 1) % enabled.length];
        else if (['ArrowLeft', 'ArrowUp'].includes(event.key)) next = enabled[(position + enabled.length - 1) % enabled.length];
        else if (event.key === 'Home') next = enabled[0]; else if (event.key === 'End') next = enabled[enabled.length - 1];
        if (next !== undefined) { event.preventDefault(); activate(next); }
      }} className={`rounded-lg border px-4 py-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 disabled:opacity-50 ${selected === tab.id ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'}`}>
      <span className={`block text-xs ${selected === tab.id ? 'text-gray-300' : 'text-gray-500'}`}>{tab.group}</span>
      <span className="mt-1 block text-sm font-semibold">{tab.label}</span>
    </button>)}
  </div>;
}
