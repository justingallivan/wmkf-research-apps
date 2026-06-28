import { useState } from 'react';
import { Info } from 'lucide-react';

const APP_SYSTEM_SETTING_ENTITY = {
  entity: 'wmkf_appsystemsetting',
  entitySet: 'wmkf_appsystemsettings',
};

export function appSystemSettingField(label, settingKey, note) {
  return {
    label,
    ...APP_SYSTEM_SETTING_ENTITY,
    field: 'wmkf_settingvalue',
    row: `wmkf_settingkey = "${settingKey}"`,
    note,
  };
}

export function appSystemSettingPattern(label, settingKeyPattern, note) {
  return {
    label,
    ...APP_SYSTEM_SETTING_ENTITY,
    field: 'wmkf_settingvalue',
    row: `wmkf_settingkey pattern: ${settingKeyPattern}`,
    note,
  };
}

export default function DataverseFieldInfoButton({ title = 'Dataverse field mapping', items = [], className = '' }) {
  const [open, setOpen] = useState(false);
  if (!items.length) return null;

  return (
    <div className={`relative inline-flex ${className}`}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((value) => !value);
        }}
        className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-gray-300 bg-white text-gray-500 shadow-sm hover:border-gray-400 hover:text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
        aria-label={title}
        aria-expanded={open}
        title={title}
      >
        <Info className="h-4 w-4" aria-hidden="true" />
      </button>

      {open && (
        <div
          className="absolute right-0 top-8 z-30 w-[min(28rem,calc(100vw-2rem))] rounded-lg border border-gray-200 bg-white p-3 text-left shadow-lg"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-2 flex items-start justify-between gap-3">
            <h3 className="text-xs font-semibold uppercase text-gray-500">{title}</h3>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-xs text-gray-400 hover:text-gray-700"
            >
              Close
            </button>
          </div>
          <div className="space-y-2">
            {items.map((item, index) => (
              <div key={`${item.label}-${index}`} className="rounded-md border border-gray-100 bg-gray-50 p-2">
                <div className="text-sm font-medium text-gray-900">{item.label}</div>
                <dl className="mt-1 grid grid-cols-[6rem_1fr] gap-x-2 gap-y-0.5 text-xs">
                  <dt className="text-gray-500">Entity</dt>
                  <dd className="font-mono text-gray-800">{item.entity}</dd>
                  {item.entitySet && (
                    <>
                      <dt className="text-gray-500">Entity set</dt>
                      <dd className="font-mono text-gray-800">{item.entitySet}</dd>
                    </>
                  )}
                  <dt className="text-gray-500">Field</dt>
                  <dd className="font-mono text-gray-800">{item.field}</dd>
                  {item.row && (
                    <>
                      <dt className="text-gray-500">Row</dt>
                      <dd className="font-mono text-gray-800 break-all">{item.row}</dd>
                    </>
                  )}
                </dl>
                {item.note && <p className="mt-1 text-xs text-gray-500">{item.note}</p>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
