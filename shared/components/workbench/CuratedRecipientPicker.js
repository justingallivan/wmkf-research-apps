import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const CATEGORY_LABELS = {
  staff: 'Staff',
  consultant: 'Consultants',
  board: 'Board',
};

function emailsIn(value) {
  return new Set(String(value || '').split(/[;,\n]/)
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean));
}

export default function CuratedRecipientPicker({
  open,
  target,
  toValue,
  ccValue,
  onAdd,
  onClose,
}) {
  const [recipients, setRecipients] = useState(null);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState(() => new Set());
  const loadSequence = useRef(0);

  const close = useCallback(() => {
    setFilter('');
    setSelected(new Set());
    setError(null);
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!open) return undefined;
    if (recipients === null && !error) {
      const sequence = ++loadSequence.current;
      fetch('/api/workbench/pre-site-visit/recipient-options')
        .then(async (response) => {
          const data = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(data.error || 'The recipient directory could not be loaded.');
          return data;
        })
        .then((data) => {
          if (loadSequence.current === sequence) setRecipients(data.recipients || []);
        })
        .catch((loadError) => {
          if (loadSequence.current === sequence) setError(loadError.message);
        });
    }
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [close, error, open, recipients]);

  useEffect(() => () => {
    loadSequence.current += 1;
  }, []);

  const toEmails = useMemo(() => emailsIn(toValue), [toValue]);
  const ccEmails = useMemo(() => emailsIn(ccValue), [ccValue]);
  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return recipients || [];
    return (recipients || []).filter((row) => (
      row.name.toLowerCase().includes(needle)
        || row.email.toLowerCase().includes(needle)
    ));
  }, [filter, recipients]);

  if (!open) return null;

  const toggle = (email) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(email)) next.delete(email);
      else next.add(email);
      return next;
    });
  };

  const addSelected = () => {
    if (selected.size === 0) return;
    onAdd(target, Array.from(selected));
    close();
  };

  const retry = () => {
    setError(null);
    setRecipients(null);
  };

  const loading = recipients === null && !error;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="presentation">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="curated-recipient-picker-title"
        className="max-h-[80vh] w-full max-w-lg overflow-hidden rounded-xl bg-white shadow-xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-gray-200 p-4">
          <div>
            <h3 id="curated-recipient-picker-title" className="font-semibold text-gray-900">
              Add recipients to {target === 'cc' ? 'Cc' : 'To'}
            </h3>
            <p className="mt-1 text-xs text-gray-500">Choose from the directory maintained in Admin.</p>
          </div>
          <button type="button" onClick={close} className="text-sm text-gray-500 hover:text-gray-800">Close</button>
        </div>

        <div className="p-4">
          <label htmlFor="curated-recipient-filter" className="sr-only">Filter recipients</label>
          <input
            id="curated-recipient-filter"
            type="search"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Filter by name or email"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>

        <div className="max-h-[50vh] overflow-y-auto px-4 pb-4">
          {loading && <p className="py-6 text-center text-sm text-gray-500">Loading directory…</p>}
          {error && (
            <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">
              <p>{error}</p>
              <button type="button" onClick={retry} className="mt-2 font-medium underline">Retry</button>
            </div>
          )}
          {!loading && !error && visible.length === 0 && (
            <p className="py-6 text-center text-sm text-gray-500">
              {recipients?.length ? 'No recipients match this filter.' : 'No recipients have been configured.'}
            </p>
          )}
          {!loading && !error && Object.keys(CATEGORY_LABELS).map((category) => {
            const rows = visible.filter((row) => row.category === category);
            if (rows.length === 0) return null;
            return (
              <fieldset key={category} className="mb-5">
                <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  {CATEGORY_LABELS[category]}
                </legend>
                <div className="space-y-2">
                  {rows.map((person) => {
                    const inTo = toEmails.has(person.email);
                    const inCc = ccEmails.has(person.email);
                    const alreadyPresent = inTo || inCc;
                    return (
                      <label
                        key={person.key}
                        className={'flex items-start gap-3 rounded border p-3 '
                          + (alreadyPresent ? 'border-gray-100 bg-gray-50 text-gray-500' : 'border-gray-200')}
                      >
                        <input
                          type="checkbox"
                          checked={selected.has(person.email)}
                          disabled={alreadyPresent}
                          onChange={() => toggle(person.email)}
                          className="mt-0.5"
                        />
                        <span className="min-w-0">
                          <span className="block font-medium">{person.name}</span>
                          <span className="block truncate text-xs">{person.email}</span>
                          {alreadyPresent && (
                            <span className="mt-1 block text-xs">Already in {inTo ? 'To' : 'Cc'}</span>
                          )}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            );
          })}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-gray-200 p-4">
          <button type="button" onClick={close} className="rounded border border-gray-300 px-3 py-2 text-sm">Cancel</button>
          <button
            type="button"
            onClick={addSelected}
            disabled={selected.size === 0}
            className="rounded bg-blue-800 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {selected.size ? `Add ${selected.size} recipient${selected.size === 1 ? '' : 's'}` : 'Add recipients'}
          </button>
        </div>
      </section>
    </div>
  );
}
