import { Fragment, useSyncExternalStore } from 'react';
const desktopQuery = '(min-width: 1024px)';
const isDesktop = () => typeof window !== 'undefined' && Boolean(window.matchMedia?.(desktopQuery).matches);
function subscribeOrientation(listener) {
  const media = window.matchMedia?.(desktopQuery);
  media?.addEventListener('change', listener);
  return () => media?.removeEventListener('change', listener);
}

/** Task navigation keeps setup, sending and preparation distinct without changing their persisted owners. */
export default function MeetingTaskNavigation({ idPrefix, tabs, selected, onChange }) {
  const vertical = useSyncExternalStore(subscribeOrientation, isDesktop, () => false);
  const activate = (index) => {
    if (tabs[index]?.disabled || onChange(tabs[index].id) === false) return;
    document.getElementById(`${idPrefix}-task-${tabs[index].id}`)?.focus();
  };
  return <div role="tablist" aria-label="Meeting tasks" aria-orientation={vertical ? 'vertical' : 'horizontal'} className="mb-6 grid content-start grid-cols-2 gap-2 lg:col-start-1 lg:row-start-1 lg:grid-cols-1 lg:gap-1">
    {tabs.map((tab, index) => <Fragment key={tab.id}>
      {(index === 0 || tabs[index - 1].group !== tab.group) && <span role="presentation" aria-hidden="true" className={`col-span-full px-3 text-xs text-gray-500 ${index ? 'mt-4' : ''}`}>{tab.group}</span>}
      <button key={tab.id} id={`${idPrefix}-task-${tab.id}`} type="button" role="tab"
      aria-selected={selected === tab.id} aria-controls={`${idPrefix}-panel-${tab.id}`} tabIndex={selected === tab.id ? 0 : -1}
      disabled={tab.disabled} onClick={() => activate(index)} onKeyDown={event => {
        const enabled = tabs.map((item, i) => item.disabled ? -1 : i).filter(i => i >= 0);
        const position = enabled.indexOf(index); let next;
        if (['ArrowRight', 'ArrowDown'].includes(event.key)) next = enabled[(position + 1) % enabled.length];
        else if (['ArrowLeft', 'ArrowUp'].includes(event.key)) next = enabled[(position + enabled.length - 1) % enabled.length];
        else if (event.key === 'Home') next = enabled[0]; else if (event.key === 'End') next = enabled[enabled.length - 1];
        if (next !== undefined) { event.preventDefault(); activate(next); }
      }} className={`rounded-lg border px-3 py-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 disabled:opacity-50 ${selected === tab.id ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-100 lg:border-transparent lg:bg-transparent'}`}>
      <span className="sr-only">{tab.group}</span>
      <span className="mt-1 block text-sm font-semibold">{tab.label}</span>
    </button></Fragment>)}
  </div>;
}
