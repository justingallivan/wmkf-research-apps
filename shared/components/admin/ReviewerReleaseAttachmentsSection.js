import { useEffect, useState } from 'react';
import { requestEnvelope } from '../../utils/api-request';

export default function ReviewerReleaseAttachmentsSection() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [error, setError] = useState(null);
  const [savedAt, setSavedAt] = useState(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const envelope = await requestEnvelope('/api/review-manager/release-settings');
      if (envelope.error?.parseError) throw envelope.error.parseError;
      if (!envelope.ok) throw new Error(envelope.data?.error || 'Failed to load');
      setEnabled(!!envelope.data.attachProposalEmail);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const toggle = async () => {
    const next = !enabled;
    setSaving(true);
    setError(null);
    try {
      const envelope = await requestEnvelope('/api/review-manager/release-settings', {
        method: 'PUT',
        body: { attachProposalEmail: next },
      });
      if (envelope.error?.parseError) throw envelope.error.parseError;
      if (!envelope.ok) throw new Error(envelope.data?.error || 'Save failed');
      setEnabled(!!envelope.data.attachProposalEmail);
      setSavedAt(new Date());
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p className="text-sm text-gray-500">Loading…</p>;

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-600">
        When ON, the release (materials) email offers the SharePoint proposal auto-attach
        and manual file uploads as email attachments, in addition to the reviewer&apos;s
        secure portal link. When OFF (default), the release email is portal-link-only —
        no attachment is uploaded to Blob or sent. Read live every time the release email
        modal opens.
      </p>
      <label className="flex items-center gap-2 text-sm text-gray-900">
        <input
          type="checkbox"
          checked={enabled}
          disabled={saving}
          onChange={toggle}
          className="h-4 w-4"
        />
        Attach proposal/files to the release email (in addition to the portal link)
      </label>
      {savedAt && <span className="text-xs text-green-700">Saved</span>}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
