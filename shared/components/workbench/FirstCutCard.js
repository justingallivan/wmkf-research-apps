import { useState } from 'react';
import { Button, Card } from '../Layout';
import { FIRST_CUT_STATUS, isFirstCutEditable, SEMI_FINALIST_STATUS, isSemiFinalistEditable } from '../../config/j27FirstCut';
import { requestJson } from '../../utils/api-request';

export default function FirstCutCard({ context, canManage, refresh, semiFinalist = false }) {
  const [decision, setDecision] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const { requestId, requestVersion, phaseIStatus, phaseIStatusLabel } = context;
  const title = semiFinalist ? 'Semi-finalist recommendation' : 'First Cut';
  const statuses = semiFinalist ? SEMI_FINALIST_STATUS : FIRST_CUT_STATUS;
  const current = phaseIStatus === statuses.yes ? 'yes'
    : phaseIStatus === statuses.no ? 'no' : '';
  const editable = semiFinalist ? isSemiFinalistEditable(phaseIStatus) : isFirstCutEditable(phaseIStatus);

  async function save(event) {
    event.preventDefault();
    if (saving || !decision || decision === current || !canManage || !editable || !requestVersion) return;
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      await requestJson('/api/workbench/first-cut', {
        method: 'POST',
        body: { requestId, decision, version: requestVersion, stage: semiFinalist ? 'semi-finalist' : 'first-cut' },
        fallbackMessage: `Could not save ${title}.`,
      });
      setSaved(true);
    } catch (failure) {
      setError(failure.status === 409
        ? 'The request changed. Review the refreshed status before saving again.'
        : failure.message);
    } finally {
      await refresh();
      setDecision('');
      setSaving(false);
    }
  }

  return (
    <Card hover={false} className="mb-4">
      <h2 className="text-base font-semibold text-gray-900">{title}</h2>
      <p className="mt-1 text-sm text-gray-600">
        Phase I status: {phaseIStatusLabel || (phaseIStatus === null ? 'Not set' : 'Unavailable')}
      </p>
      {canManage && editable && requestVersion ? (
        <form onSubmit={save} className="mt-3 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm font-medium text-gray-900">
            {semiFinalist ? title : 'First Cut decision'}
            <select
              className="min-h-10 rounded-lg border border-gray-300 bg-white px-3"
              value={decision || current}
              disabled={saving}
              onChange={(event) => {
                setDecision(event.target.value);
                setSaved(false);
                setError('');
              }}
            >
              <option value="" disabled>Select a decision</option>
              <option value="yes">Yes — {semiFinalist ? 'Recommended Invite' : 'Scored'}</option>
              <option value="no">No — {semiFinalist ? 'Recommended Do Not Invite' : 'Not Scored'}</option>
            </select>
          </label>
          <Button type="submit" size="sm" loading={saving} disabled={!decision || decision === current}>
            Save {title}
          </Button>
        </form>
      ) : <p className="mt-2 text-sm text-gray-600">{title} is read-only.</p>}
      {saved && <p role="status" className="mt-2 text-sm text-gray-700">{title} saved.</p>}
      {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
    </Card>
  );
}
