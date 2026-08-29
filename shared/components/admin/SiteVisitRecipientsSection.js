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
  const [baseline, setBaseline] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [search, setSearch] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState([]);
  const [searchPerformed, setSearchPerformed] = useState(false);
  const [contactCategory, setContactCategory] = useState('consultant');
  const loadSequence = useRef(0);
  const searchSequence = useRef(0);

  const applyState = (data) => {
    const nextConfig = data.config || { version: VERSION, entries: [] };
    setStaff(data.staff || []);
    setResolvedEntries(data.entries || []);
    setDraftEntries(nextConfig.entries || []);
    setBaseline(JSON.stringify(configFromEntries(nextConfig.entries || [])));
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

  const toggleStaff = (profileId) => {
    const key = `staff:${profileId}`;
    setDraftEntries((current) => (
      current.some((entry) => entryKey(entry) === key)
        ? current.filter((entry) => entryKey(entry) !== key)
        : [...current, { kind: 'staff', profileId }]
    ));
    setNotice(null);
  };

  const removeContact = (contactId) => {
    const key = `contact:${String(contactId).toLowerCase()}`;
    setDraftEntries((current) => current.filter((entry) => entryKey(entry) !== key));
    setResolvedEntries((current) => current.filter((entry) => entryKey(entry) !== key));
    setNotice(null);
  };

  const addContact = (contact) => {
    const key = `contact:${contact.contactId}`;
    if (selectedKeys.has(key) || !contact.available) return;
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
    setNotice(null);
  };

  const searchContacts = async (event) => {
    event.preventDefault();
    const sequence = ++searchSequence.current;
    setSearching(true);
    setError(null);
    setSearchResults([]);
    setSearchPerformed(false);
    try {
      const response = await fetch(`/api/admin/site-visit-recipients?search=${encodeURIComponent(search.trim())}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Contact search failed.');
      if (searchSequence.current !== sequence) return;
      setSearchResults(data.contacts || []);
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
      setBaseline(JSON.stringify(configFromEntries(data.config?.entries || [])));
      setNotice('Recipient directory saved.');
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  };

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
        Choose which active staff and Dataverse Contacts appear in the Site Visit materials recipient menu.
        Names and email addresses remain owned by their source records and are resolved live.
      </p>

      {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
      {notice && <p className="text-sm text-green-700" role="status">{notice}</p>}

      <section>
        <h3 className="text-sm font-semibold text-gray-900">Staff</h3>
        <p className="mt-1 text-xs text-gray-500">Only active app profiles linked exactly to an enabled Dataverse user are eligible.</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {staff.map((person) => (
            <label key={person.key} className="flex items-start gap-2 rounded border border-gray-200 p-3 text-sm">
              <input
                type="checkbox"
                checked={selectedKeys.has(person.key)}
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
      </section>

      <section>
        <h3 className="text-sm font-semibold text-gray-900">Consultants and Board</h3>
        <p className="mt-1 text-xs text-gray-500">
          Create or edit people in Dataverse first, then search here to add an existing Contact.
        </p>
        <div className="mt-3 space-y-2">
          {externalEntries.map((person) => (
            <div key={person.key} className={`flex items-start justify-between gap-3 rounded border p-3 ${person.available ? 'border-gray-200' : 'border-amber-300 bg-amber-50'}`}>
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900">{person.name || 'Unavailable Contact'}</p>
                <p className="text-xs text-gray-500">{person.email || person.detail}</p>
                <p className="mt-1 text-xs font-medium capitalize text-gray-600">{person.category}</p>
              </div>
              <button
                type="button"
                onClick={() => removeContact(person.contactId)}
                className="text-sm text-red-700 hover:text-red-900"
              >
                Remove
              </button>
            </div>
          ))}
          {externalEntries.length === 0 && <p className="text-sm text-gray-500">No external recipients selected.</p>}
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
                setSearch(event.target.value);
                setSearchResults([]);
                setSearchPerformed(false);
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
                const selected = selectedKeys.has(`contact:${contact.contactId}`);
                return (
                  <li key={contact.contactId} className="flex items-center justify-between gap-3 rounded bg-white p-2 text-sm">
                    <span className="min-w-0">
                      <span className="block font-medium text-gray-900">{contact.name || 'Unnamed Contact'}</span>
                      <span className="block truncate text-xs text-gray-500">{contact.email || 'No valid primary email'}</span>
                    </span>
                    <button
                      type="button"
                      disabled={!contact.available || selected}
                      onClick={() => addContact(contact)}
                      className="rounded border border-gray-300 px-2 py-1 text-xs disabled:opacity-50"
                    >
                      {selected ? 'Added' : contact.available ? `Add as ${contactCategory === 'board' ? 'Board' : 'Consultant'}` : 'Unavailable'}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {!searching && searchPerformed && searchResults.length === 0 && (
            <p className="mt-2 text-xs text-gray-500">No matching Contacts found.</p>
          )}
        </form>
      </section>

      <div className="flex items-center justify-between gap-3 border-t border-gray-200 pt-4">
        <p className="text-xs text-gray-500">{draftEntries.length} selected recipient{draftEntries.length === 1 ? '' : 's'}</p>
        <button
          type="button"
          onClick={save}
          disabled={saving || !changed}
          className="rounded bg-blue-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save recipients'}
        </button>
      </div>
    </div>
  );
}
