/** PD inbox for personalized emails awaiting their scheduled send. */

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import Layout, { PageHeader, Card, Button } from '../shared/components/Layout';
import { useProfile } from '../shared/context/ProfileContext';

function formatWhen(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-US', {
    timeZone: 'America/Los_Angeles',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}

function statusLabel(message) {
  if (message.status === 'sent') return 'Sent';
  if (message.status === 'stopped') return 'Stopped';
  if (message.status === 'sending') return 'Sending';
  if (message.status === 'failed') return 'Send failed — retry available';
  if (message.editedAt) return 'Edited and scheduled';
  if (message.approvedAt) return 'Reviewed and scheduled';
  return 'Review available — will send automatically';
}

export default function ScheduledEmailsPage() {
  const router = useRouter();
  const { status: profileStatus, currentProfile } = useProfile();
  const [messages, setMessages] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [subject, setSubject] = useState('');
  const [bodyText, setBodyText] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!router.isReady || profileStatus !== 'ready' || !currentProfile?.id) return;
    const controller = new AbortController();
    setLoading(true);
    fetch('/api/scheduled-emails', { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Could not load scheduled emails.');
        return data.messages || [];
      })
      .then((rows) => {
        setMessages(rows);
        const requested = new URLSearchParams(window.location.search).get('message');
        setSelectedId(rows.some((row) => row.id === requested) ? requested : rows[0]?.id || null);
        setError(null);
      })
      .catch((err) => {
        if (err.name !== 'AbortError') setError(err.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [router.isReady, profileStatus, currentProfile?.id]);

  const selected = useMemo(
    () => messages.find((message) => message.id === selectedId) || null,
    [messages, selectedId],
  );

  useEffect(() => {
    setSubject(selected?.subject || '');
    setBodyText(selected?.bodyText || '');
  }, [selected?.id, selected?.version]);

  const chooseMessage = (id) => {
    setSelectedId(id);
    router.replace({ pathname: '/scheduled-emails', query: { message: id } }, undefined, { shallow: true });
  };

  const runAction = async (action, extra = {}) => {
    if (!selected) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/scheduled-emails/${selected.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, version: selected.version, ...extra }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'The scheduled email could not be updated.');
      setMessages((current) => current.map((message) => (
        message.id === data.message.id ? data.message : message
      )));
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const editable = selected && ['scheduled', 'failed'].includes(selected.status);
  const draftDirty = Boolean(
    selected && (subject !== selected.subject || bodyText !== selected.bodyText),
  );

  return (
    <Layout title="Scheduled Emails" maxWidth="6xl">
      <PageHeader
        title="Scheduled Emails"
        subtitle="Review personalized messages that will be sent automatically on your behalf."
      />
      <div className="py-8">
        {error && (
          <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
        )}
        {loading ? (
          <div className="py-12 text-center text-gray-500">Loading scheduled emails…</div>
        ) : messages.length === 0 ? (
          <Card>
            <div className="py-10 text-center">
              <h2 className="text-lg font-medium text-gray-900">No scheduled emails</h2>
              <p className="mt-2 text-sm text-gray-600">Messages will appear here when they enter your review window.</p>
            </div>
          </Card>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[320px,minmax(0,1fr)]">
            <Card>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">Messages</h2>
              <div className="space-y-2">
                {messages.map((message) => (
                  <button
                    key={message.id}
                    type="button"
                    onClick={() => chooseMessage(message.id)}
                    className={`w-full rounded-lg border p-3 text-left ${
                      selectedId === message.id
                        ? 'border-indigo-300 bg-indigo-50'
                        : 'border-gray-200 bg-white hover:bg-gray-50'
                    }`}
                  >
                    <span className="block truncate text-sm font-medium text-gray-900">{message.recipientName}</span>
                    <span className="mt-1 block truncate text-xs text-gray-600">{message.subject}</span>
                    <span className="mt-2 block text-xs text-gray-500">{statusLabel(message)}</span>
                  </button>
                ))}
              </div>
            </Card>

            {selected && (
              <div className="space-y-6">
                <Card>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="text-lg font-semibold text-gray-900">{statusLabel(selected)}</h2>
                      <p className="mt-1 text-sm text-gray-600">
                        Scheduled to send {formatWhen(selected.scheduledSendAt)}
                      </p>
                    </div>
                    <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700">
                      Version {selected.version}
                    </span>
                  </div>
                  <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
                    <div><dt className="font-medium text-gray-700">To</dt><dd className="text-gray-600">{selected.toRecipients.join(', ')}</dd></div>
                    <div><dt className="font-medium text-gray-700">Cc</dt><dd className="text-gray-600">{selected.ccRecipients.join(', ') || 'None'}</dd></div>
                  </dl>
                  <div className="mt-5 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
                    {selected.automationNotice}
                  </div>
                </Card>

                <Card>
                  <div className="space-y-4">
                    <label className="block text-sm font-medium text-gray-700">
                      Subject
                      <input
                        type="text"
                        value={subject}
                        onChange={(event) => setSubject(event.target.value)}
                        disabled={!editable || saving}
                        className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 disabled:bg-gray-100"
                      />
                    </label>
                    <label className="block text-sm font-medium text-gray-700">
                      Message
                      <textarea
                        value={bodyText}
                        onChange={(event) => setBodyText(event.target.value)}
                        disabled={!editable || saving}
                        rows={14}
                        className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm disabled:bg-gray-100"
                      />
                    </label>
                    <div className="rounded-lg bg-gray-50 p-3 text-sm text-gray-600">
                      Your saved signature is appended automatically and cannot be edited for only this message.
                    </div>
                    {editable && (
                      <div>
                        {draftDirty && (
                          <p className="mb-3 text-right text-sm text-amber-700">
                            Save your changes before approving or sending this message.
                          </p>
                        )}
                        <div className="flex flex-wrap justify-end gap-2">
                          <Button
                            variant="secondary"
                            size="sm"
                            type="button"
                            disabled={saving}
                            onClick={() => {
                              if (window.confirm('Stop this scheduled message? It will not be sent automatically.')) {
                                runAction('stop');
                              }
                            }}
                          >
                            Stop this message
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            type="button"
                            disabled={saving || draftDirty}
                            onClick={() => runAction('approve')}
                          >
                            Looks good
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            type="button"
                            disabled={saving || draftDirty}
                            onClick={() => {
                              if (window.confirm('Send this message now?')) runAction('send_now');
                            }}
                          >
                            Send now
                          </Button>
                          <Button
                            variant="primary"
                            size="sm"
                            type="button"
                            disabled={saving || !draftDirty || !subject.trim() || bodyText.trim().length < 10}
                            loading={saving}
                            onClick={() => runAction('edit', { subject, bodyText })}
                          >
                            Save changes
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                </Card>

                <Card>
                  <h2 className="mb-3 text-lg font-semibold text-gray-900">Recipient preview</h2>
                  <iframe
                    title="Scheduled email recipient preview"
                    sandbox=""
                    srcDoc={selected.previewHtml}
                    className="h-[520px] w-full rounded-lg border border-gray-200 bg-white"
                  />
                </Card>
              </div>
            )}
          </div>
        )}
      </div>
    </Layout>
  );
}
