import { useEffect, useState } from 'react';
import DataverseFieldInfoButton, { appSystemSettingField } from './DataverseFieldInfoButton';
import DisclosureRow from './DisclosureRow';
import OutcomeBanner from './OutcomeBanner';
import { StatusChip } from './AdminWorkspaceNavigation';
import { Button } from '../Layout';
import { EDITABLE_TEXT_GROUPS } from '../../config/editableTextDefaults';

const INPUT_CLASS = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300 focus:border-gray-500 disabled:bg-gray-50 disabled:text-gray-500';

const TONE = {
  saved: 'text-green-700',
  error: 'text-red-700',
  muted: 'text-gray-500',
};

// A blank value only blocks sends for these keys (reviewer and grantee
// invitation subject/body); blank elsewhere just means "not customized" and
// the workflow falls back to its code default, so it gets the milder amber
// "Blank" chip instead of red.
const BLOCKING_BLANK_KEYS = new Set([
  'email.reviewer_invitation.subject',
  'email.reviewer_invitation.body',
  'email.grantee_invite.subject',
  'email.grantee_invite.body',
]);

// The catalog's `label` (e.g. "Grantee invite subject") stays the aria-label
// and field-mapping popover title (do not change what it displays). The
// *visible* field label is generic, derived from the key's last segment, so
// the card heading ("Grantee invite") carries the specific identity and the
// field just says what it is. Keys that don't end in one of these segments
// (e.g. the stage.deliberations.* staff-label keys) fall back to entry.label.
const FIELD_LABEL_BY_SUFFIX = {
  subject: 'Subject',
  body: 'Body',
  button_label: 'Button label',
};

function fieldLabel(entry) {
  const suffix = entry.key.split('.').pop();
  return FIELD_LABEL_BY_SUFFIX[suffix] || entry.label;
}

function fieldInputId(entry) {
  return `email-default-${entry.key}`;
}

function formatSavedAt(date) {
  return `Saved · ${date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}

export default function EmailDefaultsSection() {
  const [defaults, setDefaults] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [savedValues, setSavedValues] = useState({});
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState(null);
  const [savingAllCard, setSavingAllCard] = useState(null);
  const [statusByKey, setStatusByKey] = useState({});
  const [error, setError] = useState(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/email-defaults');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Failed to load email defaults.');
      const nextDefaults = data.defaults || [];
      const values = Object.fromEntries(nextDefaults.map((entry) => [entry.key, String(entry.value ?? '')]));
      setDefaults(nextDefaults);
      setDrafts(values);
      setSavedValues(values);
      setStatusByKey({});
    } catch (err) {
      setError(err.message || 'Failed to load email defaults.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  // Navigate-away guard: only while something is unsaved, and only this
  // in-page listener — no in-app route guard.
  useEffect(() => {
    if (!defaults) return undefined;
    const anyDirty = defaults.some((entry) => drafts[entry.key] !== savedValues[entry.key]);
    if (!anyDirty) return undefined;
    const handler = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [defaults, drafts, savedValues]);

  const updateDraft = (key, value) => {
    setDrafts((prev) => ({ ...prev, [key]: value }));
    setStatusByKey((prev) => ({ ...prev, [key]: null }));
  };

  const saveKey = async (key) => {
    const value = drafts[key] ?? '';
    setSavingKey(key);
    try {
      const res = await fetch('/api/admin/email-defaults', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Save failed.');
      setDefaults((prev) => (prev || []).map((item) => (
        item.key === key ? { ...item, value, unavailable: false } : item
      )));
      setSavedValues((prev) => ({ ...prev, [key]: value }));
      setStatusByKey((prev) => ({ ...prev, [key]: { tone: 'saved', text: formatSavedAt(new Date()) } }));
      return true;
    } catch (err) {
      setStatusByKey((prev) => ({
        ...prev,
        [key]: { tone: 'error', text: err.message || 'Save failed.' },
      }));
      return false;
    } finally {
      setSavingKey(null);
    }
  };

  const saveAllForCard = async (card) => {
    const dirtyKeys = card.entries
      .filter((entry) => drafts[entry.key] !== savedValues[entry.key])
      .map((entry) => entry.key);
    setSavingAllCard(card.emailKey);
    // Sequential, one PUT per dirty key, catalog order — no batching route.
    for (const key of dirtyKeys) {
      // eslint-disable-next-line no-await-in-loop
      await saveKey(key);
    }
    setSavingAllCard(null);
  };

  if (loading && !defaults) return <p className="text-sm text-gray-500">Loading…</p>;
  if (error && !defaults) return <p className="text-sm text-red-700">{error}</p>;
  if (!defaults || defaults.length === 0) return <p className="text-sm text-gray-500">No editable email defaults found.</p>;

  const renderField = (entry) => {
    const value = drafts[entry.key] ?? '';
    const status = statusByKey[entry.key];
    const dirty = drafts[entry.key] !== savedValues[entry.key];
    const Input = entry.multiline ? 'textarea' : 'input';
    const inputId = fieldInputId(entry);
    const dataverseFields = [
      appSystemSettingField(entry.label, entry.key, 'The admin editor reads and writes this setting value.'),
    ];
    return (
      <div key={entry.key} className="space-y-2">
        <div className="flex items-start justify-between gap-3">
          <label htmlFor={inputId} className="text-sm font-medium text-gray-700">{fieldLabel(entry)}</label>
          <DataverseFieldInfoButton items={dataverseFields} />
        </div>
        <p className="text-xs text-gray-500">{entry.description}</p>
        {entry.placeholders?.length ? (
          <p className="text-xs text-gray-500">
            Placeholders: {entry.placeholders.map((token) => <code key={token}>{token}</code>).reduce((acc, node, i) => (
              i === 0 ? [node] : [...acc, ', ', node]
            ), [])}
          </p>
        ) : null}

        <Input
          id={inputId}
          type={entry.multiline ? undefined : 'text'}
          value={value}
          onChange={(e) => updateDraft(entry.key, e.target.value)}
          rows={entry.multiline ? 8 : undefined}
          disabled={entry.unavailable}
          className={`${INPUT_CLASS} ${entry.multiline ? 'font-mono' : ''}`}
          aria-label={entry.label}
        />

        <div className="flex flex-wrap items-center gap-2">
          {entry.unavailable ? (
            <StatusChip tone="red">Unavailable</StatusChip>
          ) : value === '' ? (
            <StatusChip tone={BLOCKING_BLANK_KEYS.has(entry.key) ? 'red' : 'amber'}>Blank</StatusChip>
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-3">
          <span className={`text-xs ${status ? TONE[status.tone] : TONE.muted}`}>
            {status?.text || (entry.unavailable ? 'Reload before editing this setting.' : `${value.length} chars`)}
          </span>
          <div className="flex items-center gap-2">
            {entry.unavailable && (
              <Button type="button" variant="outline" size="sm" onClick={load}>
                Reload
              </Button>
            )}
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={() => saveKey(entry.key)}
              disabled={savingKey === entry.key || entry.unavailable || !dirty}
            >
              {savingKey === entry.key ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      </div>
    );
  };

  // Group by EDITABLE_TEXT_GROUPS order, then by emailKey (one card per emailKey) in catalog order.
  const buildCards = (groupEntries) => {
    const cards = [];
    const cardIndexByEmailKey = {};
    groupEntries.forEach((entry) => {
      if (!(entry.emailKey in cardIndexByEmailKey)) {
        cardIndexByEmailKey[entry.emailKey] = cards.length;
        cards.push({ emailKey: entry.emailKey, emailLabel: entry.emailLabel, entries: [] });
      }
      cards[cardIndexByEmailKey[entry.emailKey]].entries.push(entry);
    });
    return cards;
  };

  const knownGroupIds = new Set(EDITABLE_TEXT_GROUPS.map((group) => group.id));
  const groups = EDITABLE_TEXT_GROUPS
    .map((group) => ({ ...group, cards: buildCards(defaults.filter((entry) => entry.group === group.id)) }))
    .filter((group) => group.cards.length > 0);

  // Entries whose `group` doesn't match a known EDITABLE_TEXT_GROUPS id (e.g. a typo in the
  // catalog) still render, in a trailing "Other" group, instead of silently disappearing.
  const otherEntries = defaults.filter((entry) => !knownGroupIds.has(entry.group));
  if (otherEntries.length > 0) {
    groups.push({
      id: 'other',
      title: 'Other',
      description: 'Settings that are not assigned to a group yet.',
      cards: buildCards(otherEntries),
    });
  }

  return (
    <div className="space-y-3">
      {error && (
        <OutcomeBanner tone="red" text={error} />
      )}
      {groups.map((group) => (
        // Collapsed by default: an admin editing one reviewer email should not have to
        // scroll past every grantee and internal template (owner, 2026-09-10). The card
        // count stays in the summary — with the group closed it is the only size signal
        // available before opening it (Build E, Item 1 decision).
        <DisclosureRow
          key={group.id}
          id={`email-defaults-${group.id}`}
          groupName="audience"
          headingLevel={3}
          title={group.title}
          description={group.description}
          meta={`${group.cards.length} ${group.cards.length === 1 ? 'card' : 'cards'}`}
        >
          <div className="space-y-4">
            {group.cards.map((card) => {
              const cardDirty = card.entries.some((entry) => drafts[entry.key] !== savedValues[entry.key]);
              return (
                <section key={card.emailKey} className="space-y-4 rounded-lg border border-gray-200 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="text-base font-semibold text-gray-900">{card.emailLabel}</h4>
                      {cardDirty && <StatusChip tone="amber">Unsaved changes</StatusChip>}
                    </div>
                    <Button
                      type="button"
                      variant="primary"
                      size="sm"
                      onClick={() => saveAllForCard(card)}
                      disabled={!cardDirty || savingAllCard === card.emailKey}
                    >
                      {savingAllCard === card.emailKey ? 'Saving…' : 'Save all changes'}
                    </Button>
                  </div>
                  <div className="space-y-4 divide-y divide-gray-100">
                    {card.entries.map((entry) => (
                      <div key={entry.key} className="pt-4 first:pt-0">
                        {renderField(entry)}
                      </div>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        </DisclosureRow>
      ))}
    </div>
  );
}
