import { useEffect, useMemo, useRef, useState } from 'react';

const VERSION = 1;

function entryKey(entry) {
  if (entry?.kind === 'staff') return `staff:${entry.profileId}`;
  if (entry?.kind === 'contact') return `contact:${String(entry.contactId || '').toLowerCase()}`;
  return '';
}

function configFromEntries(entries) {
  return {
    version: VERSION,
    entries: entries.map((entry) => (
      entry.kind === 'staff'
        ? { kind: 'staff', profileId: entry.profileId }
        : { kind: 'contact', contactId: entry.contactId, category: entry.category }
    )),
  };
}

export default function SiteVisitRecipientsSection() {
  const [staff, setStaff] = useState([]);
  const [resolvedEntries, setResolvedEntries] = useState([]);
  const [draftEntries, setDraftEntries] = useState([]);
  const [savedKeys, setSavedKeys] = useState(() => new Set());
  const [baseline, setBaseline] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [search, setSearch] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState([]);
  const [searchPerformed, setSearchPerformed] = useState(false);
  const [searchTruncated, setSearchTruncated] = useState(false);
  const [searchLimit, setSearchLimit] = useState(50);
  const [contactCategory, setContactCategory] = useState('consultant');
  const [maxEntries, setMaxEntries] = useState(50);
  const [limitNotice, setLimitNotice] = useState(null);
  const loadSequence = useRef(0);
  const searchSequence = useRef(0);

  const applyState = (data) => {
    const nextConfig = data.config || { version: VERSION, entries: [] };
    setStaff(data.staff || []);
    setResolvedEntries(data.entries || []);
    setDraftEntries(nextConfig.entries || []);
    setSavedKeys(new Set((nextConfig.entries || []).map(entryKey)));
    setBaseline(JSON.stringify(configFromEntries(nextConfig.entries || [])));
    if (Number.isInteger(data.maxEntries) && data.maxEntries > 0) setMaxEntries(data.maxEntries);
  };

  const load = async () => {
    const sequence = ++loadSequence.current;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/site-visit-recipients');
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'The recipient directory could not be loaded.');
      if (loadSequence.current !== sequence) return;
      applyState(data);
    } catch (loadError) {
      if (loadSequence.current === sequence) setError(loadError.message);
    } finally {
      if (loadSequence.current === sequence) setLoading(false);
    }
  };

  useEffect(() => {
    const sequence = ++loadSequence.current;
    fetch('/api/admin/site-visit-recipients')
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'The recipient directory could not be loaded.');
        return data;
      })
      .then((data) => {
        if (loadSequence.current === sequence) applyState(data);
      })
      .catch((loadError) => {
        if (loadSequence.current === sequence) setError(loadError.message);
      })
      .finally(() => {
        if (loadSequence.current === sequence) setLoading(false);
      });
    return () => {
      loadSequence.current += 1;
      searchSequence.current += 1;
    };
  }, []);

  const selectedKeys = useMemo(() => new Set(draftEntries.map(entryKey)), [draftEntries]);
  const changed = baseline !== JSON.stringify(configFromEntries(draftEntries));
  const atCapacity = draftEntries.length >= maxEntries;

  const toggleStaff = (profileId) => {
    const key = `staff:${profileId}`;
    if (!selectedKeys.has(key) && atCapacity) {
      setLimitNotice(`The directory supports at most ${maxEntries} recipients.`);
      return;
    }
    setDraftEntries((current) => (
      current.some((entry) => entryKey(entry) === key)
        ? current.filter((entry) => entryKey(entry) !== key)
        : [...current, { kind: 'staff', profileId }]
    ));
    setLimitNotice(null);
    setNotice(null);
  };

  const removeEntry = (entry) => {
    const key = entryKey(entry);
    setDraftEntries((current) => current.filter((entry) => entryKey(entry) !== key));
    setResolvedEntries((current) => current.filter((entry) => entryKey(entry) !== key));
    setLimitNotice(null);
    setNotice(null);
  };

  const addContact = (contact) => {
    const key = `contact:${String(contact.contactId || '').toLowerCase()}`;
    if (selectedKeys.has(key) || !contact.available) return;
    if (atCapacity) {
      setLimitNotice(`The directory supports at most ${maxEntries} recipients.`);
      return;
    }
    setDraftEntries((current) => [...current, {
      kind: 'contact',
      contactId: contact.contactId,
      category: contactCategory,
    }]);
    setResolvedEntries((current) => [...current, {
      kind: 'contact',
      contactId: contact.contactId,
      key,
      category: contactCategory,
      name: contact.name,
      email: contact.email,
      available: true,
    }]);
    setLimitNotice(null);
    setNotice(null);
  };

  const searchContacts = async (event) => {
    event.preventDefault();
    const sequence = ++searchSequence.current;
    setSearching(true);
    setError(null);
    setSearchResults([]);
    setSearchPerformed(false);
    setSearchTruncated(false);
    try {
      const response = await fetch(`/api/admin/site-visit-recipients?search=${encodeURIComponent(search.trim())}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Contact search failed.');
      if (searchSequence.current !== sequence) return;
      setSearchResults(data.contacts || []);
      setSearchTruncated(data.truncated === true);
      if (Number.isInteger(data.limit) && data.limit > 0) setSearchLimit(data.limit);
      setSearchPerformed(true);
    } catch (searchError) {
      if (searchSequence.current === sequence) setError(searchError.message);
    } finally {
      if (searchSequence.current === sequence) setSearching(false);
    }
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch('/api/admin/site-visit-recipients', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: configFromEntries(draftEntries) }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'The recipient directory could not be saved.');
      setDraftEntries(data.config?.entries || []);
      setResolvedEntries(data.entries || []);
      setSavedKeys(new Set((data.config?.entries || []).map(entryKey)));
      setBaseline(JSON.stringify(configFromEntries(data.config?.entries || [])));
      setNotice('Recipient changes saved.');
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  };

  const unavailableStaff = resolvedEntries.filter((entry) => entry.kind === 'staff' && !entry.available);
  const externalEntries = resolvedEntries.filter((entry) => entry.kind === 'contact');

  if (loading) return <p className="text-sm text-gray-500">Loading recipient directory…</p>;
  if (error && !baseline) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-red-700" role="alert">{error}</p>
        <button type="button" onClick={load} className="rounded border border-gray-300 px-3 py-1.5 text-sm">Retry</button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-gray-600">
        Choose who is available in the Site Visit materials recipient menu. This does not add anyone
        to an email draft automatically; the sender chooses recipients from the menu for each email.
        Checking, adding, or removing someone changes this draft only; choose Save changes to publish
        the directory. Names and email addresses remain owned by their source records and are resolved live.
      </p>

      {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
      {notice && <p className="text-sm text-green-700" role="status">{notice}</p>}
      {limitNotice && <p className="text-sm text-amber-700" role="status">{limitNotice}</p>}

      <section>
        <h3 className="text-sm font-semibold text-gray-900">Staff</h3>
        <p className="mt-1 text-xs text-gray-500">
          Checked staff are included in the recipient menu. Only active app profiles linked exactly
          to an enabled Dataverse user are eligible.
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {staff.map((person) => (
            <label key={person.key} className="flex items-start gap-2 rounded border border-gray-200 p-3 text-sm">
              <input
                type="checkbox"
                checked={selectedKeys.has(person.key)}
                disabled={!selectedKeys.has(person.key) && atCapacity}
                onChange={() => toggleStaff(person.profileId)}
                className="mt-0.5"
              />
              <span>
                <span className="block font-medium text-gray-900">{person.name}</span>
                <span className="block text-xs text-gray-500">{person.email}</span>
              </span>
            </label>
          ))}
          {staff.length === 0 && <p className="text-sm text-gray-500">No eligible staff users found.</p>}
        </div>
        {unavailableStaff.length > 0 && (
          <div className="mt-3 space-y-2">
            {unavailableStaff.map((person) => (
              <div key={person.key} className="flex items-start justify-between gap-3 rounded border border-amber-300 bg-amber-50 p-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900">Unavailable staff profile</p>
                  <p className="text-xs text-gray-600">{person.detail}</p>
                </div>
                <button
                  type="button"
                  onClick={() => removeEntry(person)}
                  className="text-sm text-red-700 hover:text-red-900"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h3 className="text-sm font-semibold text-gray-900">Consultants and Board</h3>
        <p className="mt-1 text-xs text-gray-500">
          Available people listed below are included in the recipient menu. A highlighted unavailable
          Contact remains saved for correction or removal but does not appear in the menu.
        </p>
        <div className="mt-3 space-y-2">
          {externalEntries.map((person) => (
            <div key={person.key} className={`flex items-start justify-between gap-3 rounded border p-3 ${person.available ? 'border-gray-200' : 'border-amber-300 bg-amber-50'}`}>
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900">{person.name || 'Unavailable Contact'}</p>
                <p className="text-xs text-gray-500">{person.email || person.detail}</p>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs font-medium">
                  <span className="capitalize text-gray-600">{person.category}</span>
                  <span className={`rounded-full px-2 py-0.5 ${person.available ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}`}>
                    {person.available
                      ? savedKeys.has(person.key) ? 'Included in recipient menu' : 'Added — unsaved'
                      : 'Saved but unavailable'}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => removeEntry(person)}
                className="text-sm text-red-700 hover:text-red-900"
              >
                Remove from directory
              </button>
            </div>
          ))}
          {externalEntries.length === 0 && (
            <p className="text-sm text-gray-500">No consultants or board members are included in the directory.</p>
          )}
        </div>

        <form onSubmit={searchContacts} className="mt-4 rounded border border-gray-200 bg-gray-50 p-3">
          <label htmlFor="site-visit-contact-search" className="block text-sm font-medium text-gray-800">Find a Dataverse Contact</label>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <input
              id="site-visit-contact-search"
              type="search"
              minLength={2}
              maxLength={100}
              required
              value={search}
              onChange={(event) => {
                searchSequence.current += 1;
                setSearch(event.target.value);
                setSearching(false);
                setSearchResults([]);
                setSearchPerformed(false);
                setSearchTruncated(false);
              }}
              placeholder="Name or exact email"
              className="min-w-0 flex-1 rounded border border-gray-300 px-3 py-2 text-sm"
            />
            <select
              aria-label="External recipient category"
              value={contactCategory}
              onChange={(event) => setContactCategory(event.target.value)}
              className="rounded border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="consultant">Consultant</option>
              <option value="board">Board</option>
            </select>
            <button
              type="submit"
              disabled={searching || search.trim().length < 2}
              className="rounded bg-gray-800 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {searching ? 'Searching…' : 'Search'}
            </button>
          </div>
          {searchResults.length > 0 && (
            <ul className="mt-3 space-y-2">
              {searchResults.map((contact) => {
                const key = `contact:${String(contact.contactId || '').toLowerCase()}`;
                const selected = selectedKeys.has(key);
                const persisted = savedKeys.has(key);
                return (
                  <li key={contact.contactId} className="flex items-center justify-between gap-3 rounded bg-white p-2 text-sm">
                    <span className="min-w-0">
                      <span className="block font-medium text-gray-900">{contact.name || 'Unnamed Contact'}</span>
                      <span className="block truncate text-xs text-gray-500">{contact.email || 'No valid primary email'}</span>
                    </span>
                    <button
                      type="button"
                      disabled={!contact.available || selected || atCapacity}
                      onClick={() => addContact(contact)}
                      className="rounded border border-gray-300 px-2 py-1 text-xs disabled:opacity-50"
                    >
                      {selected
                        ? persisted ? 'Already saved' : 'Added — unsaved'
                        : !contact.available
                          ? 'Unavailable'
                          : atCapacity
                            ? 'Directory full'
                            : `Add as ${contactCategory === 'board' ? 'Board' : 'Consultant'}`}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="mt-2 text-xs text-amber-700" role="status" aria-live="polite" aria-atomic="true">
            {!searching && searchPerformed && searchTruncated
              ? `Showing the first ${searchLimit} matches. Refine the search to see other Contacts.`
              : ''}
          </p>
          {!searching && searchPerformed && searchResults.length === 0 && (
            <p className="mt-2 text-xs text-gray-500">No matching Contacts found.</p>
          )}
        </form>
      </section>

      <div className="flex items-center justify-between gap-3 border-t border-gray-200 pt-4">
        <div>
          <p className="text-xs text-gray-500">
            {draftEntries.length} of {maxEntries} selected recipient{draftEntries.length === 1 ? '' : 's'}
          </p>
          <p className={`mt-1 text-xs font-medium ${changed ? 'text-amber-700' : 'text-green-700'}`} role="status">
            {changed ? 'Unsaved changes' : 'All changes saved'}
          </p>
        </div>
        <button
          type="button"
          onClick={save}
          disabled={saving || !changed}
          className="rounded bg-blue-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </div>
  );
}
