import { useEffect, useId, useRef, useState } from 'react';

const REASON_LABELS = Object.freeze({
  contact_missing: 'Contact no longer exists',
  contact_inactive: 'Inactive contact',
  contact_email_missing: 'No primary email',
  contact_name_missing: 'No display name',
  contact_lookup_failed: 'Contact status could not be loaded',
});

export default function RosterContactField({
  contactId,
  memberName = '',
  onSelect,
  onClear,
}) {
  const [query, setQuery] = useState(memberName);
  const [results, setResults] = useState([]);
  const [resolvedContact, setResolvedContact] = useState({ contactId: null, contact: null });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [truncated, setTruncated] = useState(false);
  const generationRef = useRef(0);
  const controllerRef = useRef(null);
  const queryDirtyRef = useRef(false);
  const resolutionGenerationRef = useRef(0);
  const resolutionControllerRef = useRef(null);
  const searchInputId = useId();

  useEffect(() => () => {
    generationRef.current += 1;
    controllerRef.current?.abort();
  }, []);

  useEffect(() => {
    if (!queryDirtyRef.current) setQuery(memberName);
  }, [memberName]);

  useEffect(() => {
    const normalizedContactId = String(contactId || '').trim().toLowerCase();
    const generation = resolutionGenerationRef.current + 1;
    resolutionGenerationRef.current = generation;
    resolutionControllerRef.current?.abort();
    if (!normalizedContactId) {
      return undefined;
    }
    const controller = new AbortController();
    resolutionControllerRef.current = controller;
    (async () => {
      try {
        const response = await fetch(`/api/expertise-finder/contact-search?contactId=${encodeURIComponent(normalizedContactId)}`, {
          signal: controller.signal,
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Linked contact read failed.');
        if (generation === resolutionGenerationRef.current) {
          setResolvedContact({ contactId: normalizedContactId, contact: data.contact });
        }
      } catch (lookupError) {
        if (lookupError?.name === 'AbortError' || generation !== resolutionGenerationRef.current) return;
        setResolvedContact({
          contactId: normalizedContactId,
          contact: { contactId: normalizedContactId, available: false, reason: 'contact_lookup_failed' },
        });
      }
    })();
    return () => {
      resolutionGenerationRef.current += 1;
      controller.abort();
    };
  }, [contactId]);

  const runSearch = async () => {
    const clean = query.trim().replace(/\s+/g, ' ');
    if (clean.length < 2 || clean.length > 100) {
      setError('Enter between 2 and 100 characters.');
      setResults([]);
      setTruncated(false);
      return;
    }
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/expertise-finder/contact-search?q=${encodeURIComponent(clean)}`, {
        signal: controller.signal,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Contact search failed.');
      if (generation !== generationRef.current) return;
      setResults(data.contacts || []);
      setTruncated(Boolean(data.truncated));
    } catch (searchError) {
      if (searchError?.name === 'AbortError' || generation !== generationRef.current) return;
      setResults([]);
      setTruncated(false);
      setError(searchError?.message || 'Contact search failed.');
    } finally {
      if (generation === generationRef.current) setLoading(false);
    }
  };

  const changeQuery = (value) => {
    queryDirtyRef.current = true;
    generationRef.current += 1;
    controllerRef.current?.abort();
    controllerRef.current = null;
    setLoading(false);
    setQuery(value);
  };

  const choose = (contact) => {
    if (!contact.available) return;
    setResolvedContact({ contactId: contact.contactId, contact });
    onSelect(contact);
  };

  const clear = () => {
    generationRef.current += 1;
    controllerRef.current?.abort();
    setResolvedContact({ contactId: null, contact: null });
    setResults([]);
    setTruncated(false);
    setError(null);
    onClear();
  };

  const normalizedContactId = String(contactId || '').trim().toLowerCase();
  const linked = Boolean(normalizedContactId);
  const selectedContact = resolvedContact.contactId === normalizedContactId
    ? resolvedContact.contact
    : null;
  const resolving = linked && !selectedContact;
  const linkedUnavailable = linked && !resolving && selectedContact?.available === false;

  return (
    <div className="space-y-2 md:col-span-2">
      <label htmlFor={searchInputId} className="block text-sm font-medium text-gray-700">
        Dataverse contact
      </label>
      {linked && (
        <div className={`rounded-lg border p-3 text-sm ${linkedUnavailable ? 'border-red-200 bg-red-50' : 'border-blue-200 bg-blue-50'}`}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className={`font-medium ${linkedUnavailable ? 'text-red-900' : 'text-blue-900'}`}>
                {resolving ? 'Checking linked Dataverse contact…' : selectedContact?.name || 'Linked Dataverse contact'}
              </p>
              <p className={linkedUnavailable ? 'text-red-800' : 'text-blue-800'}>
                {resolving
                  ? 'Loading current name, status, and primary email.'
                  : selectedContact?.email || REASON_LABELS[selectedContact?.reason] || 'Primary email is resolved live from Dataverse.'}
              </p>
              {linkedUnavailable && (
                <p className="mt-1 text-xs text-red-700">
                  Attendee selection will fail until this Contact is fixed, relinked, or the roster row is unlinked.
                </p>
              )}
            </div>
            <button type="button" onClick={clear} className="text-sm font-medium text-blue-700 hover:text-blue-900">
              Unlink
            </button>
          </div>
        </div>
      )}
      {!linked && <p className="text-xs text-gray-500">Not linked — attendee email uses the manual preferred email.</p>}
      <div className="flex gap-2">
        <input
          id={searchInputId}
          type="search"
          value={query}
          onChange={(event) => changeQuery(event.target.value)}
          placeholder="Search existing contacts by name"
          className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
        />
        <button
          type="button"
          onClick={runSearch}
          disabled={loading}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {loading ? 'Searching…' : 'Search'}
        </button>
      </div>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {results.length > 0 && (
        <div className="max-h-56 overflow-y-auto rounded-lg border border-gray-200 divide-y divide-gray-100">
          {results.map((contact) => (
            <button
              key={contact.contactId}
              type="button"
              disabled={!contact.available}
              onClick={() => choose(contact)}
              className="block w-full px-3 py-2 text-left text-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400"
            >
              <span className="block font-medium">{contact.name || 'Unnamed contact'}</span>
              <span className="block text-xs">{contact.email || REASON_LABELS[contact.reason] || 'Unavailable'}</span>
            </button>
          ))}
        </div>
      )}
      {truncated && <p className="text-xs text-gray-500">Showing the first 50 matches. Refine the name to narrow the list.</p>}
    </div>
  );
}
